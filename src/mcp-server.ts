import { Hono } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getAlchemyClient, searchNftByKeyword, resolveNftByContract } from './alchemy';
import { getDbClient, getCachedAsset, getLocalNftByContract, searchLocalNfts } from './db';
import { ingestAsset, IngestEnv } from './ingest';
import { R2Bucket } from '@cloudflare/workers-types';

export interface Env extends IngestEnv {
  ALCHEMY_API_KEY: string;
  DATABASE_URL: string;
  DATABASE_KEY: string;
  X402_WALLET_ADDRESS: string;
  X402_FACILITATOR_URL?: string;
}

// Mocking the Cloudflare Agents SDK's withX402 / paidTool as requested by the prompt
function paidTool(priceUsdc: number, handler: Function) {
  return async (args: any, env: Env) => {
    // In a real implementation, this would verify the x402 payment proof
    // against the env.X402_WALLET_ADDRESS and expected price on Base.
    // For now, this is a mock implementation that simply forwards to the handler.
    // If the payment is missing or invalid, it would throw an Error or return HTTP 402.
    if (args._x402PaymentStatus !== 'settled') {
       // Return 402 requirement. The MCP client should intercept this.
       return {
         isError: true,
         content: [{
           type: "text",
           text: JSON.stringify({
             error: "Payment Required",
             x402: {
               amount: priceUsdc,
               currency: 'USDC',
               chain: 'base',
               recipient: env.X402_WALLET_ADDRESS,
               facilitator: env.X402_FACILITATOR_URL || 'https://coinbase-x402-facilitator.com'
             }
           })
         }]
       };
    }
    return handler(args, env);
  };
}

const app = new Hono<{ Bindings: Env }>();

// Since Cloudflare Workers are stateless, a persistent MCP server via SSE 
// typically requires Durable Objects. For this boilerplate, we define the tools
// and handle tool execution directly via a simple HTTP endpoint which agents can POST to.
app.post('/execute-tool', async (c) => {
  const env = c.env;
  const body = await c.req.json();
  const { tool, args } = body;
  
  const alchemy = getAlchemyClient(env.ALCHEMY_API_KEY);
  const db = getDbClient(env.DATABASE_URL, env.DATABASE_KEY);
  
  if (tool === 'search_nft') {
    const query = args.query;
    // Free tool
    const alchemyResults = await searchNftByKeyword(alchemy, query);
    return c.json({ results: alchemyResults });
  } 
  else if (tool === 'get_nft_by_contract') {
    const { contractAddress, tokenId } = args;
    // Free tool
    const nfts = await resolveNftByContract(alchemy, contractAddress, tokenId);
    return c.json({ results: nfts });
  } 
  else if (tool === 'get_nft_asset') {
    // Paid tool
    let price = 0.01;
    if (args.format === 'video') price = 0.05;
    else if (args.format === 'audio') price = 0.02;
    else if (args.format === 'thumbnail') price = 0; // thumbnail is free
    
    // Using our mock paidTool wrapper
    const handler = paidTool(price, async (args: any, env: Env) => {
      const { contract, tokenId, format, resolution } = args;
      
      // Check cache first
      let cached = await getCachedAsset(db, contract, tokenId, format, resolution || 'original').catch(() => null);
      
      if (!cached) {
        // Ingest if not cached
        const nfts = await resolveNftByContract(alchemy, contract, tokenId);
        if (nfts.length > 0) {
          await ingestAsset(env, db, nfts[0]);
          cached = await getCachedAsset(db, contract, tokenId, format, resolution || 'original').catch(() => null);
        }
      }
      
      if (!cached) {
         return { isError: true, content: [{ type: 'text', text: 'Asset not found or failed to ingest' }] };
      }
      
      // Return short-lived signed R2 URL or public URL
      // Since it's R2, we can just return the key and the agent can construct the URL if the bucket is public,
      // or we can generate a signed URL (requires AWS SDK V3 which is compatible with Cloudflare Workers).
      // For simplicity, we return the R2 key.
      return { 
         content: [{ 
            type: 'text', 
            text: `Success. R2 Key: ${cached.r2_key}, Content-Type: ${cached.content_type}` 
         }] 
      };
    });
    
    const result = await handler(args, env);
    if (result.isError) {
       return c.json(result, 402); // 402 Payment Required
    }
    return c.json(result);
  }
  
  return c.json({ error: 'Tool not found' }, 404);
});

export default app;
