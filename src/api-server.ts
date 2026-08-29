import { Hono } from 'hono';
import { ethers } from 'ethers';
import { getAlchemyClient, searchNftByKeyword, resolveNftByContract } from './alchemy';
import { getDbClient, getCachedAsset } from './db';
import { ingestAsset, IngestEnv } from './ingest';
import { BRANDS, SECTORS, BRANDS_BY_SECTOR, LIVE_BRANDS, LIVE_COLLECTIONS } from './brands';
import castingDirectorRouter from './routes/casting-director';
import storyboardRouter from './routes/storyboard';
import { x402Middleware } from './middleware/x402';
// @ts-ignore
import { getOpenseaCollectionOwner } from './worker/casting-director.js';

import { cors } from 'hono/cors';

export interface Env extends IngestEnv {
  ALCHEMY_API_KEY: string;
  DATABASE_URL: string;
  DATABASE_KEY: string;
  X402_WALLET_ADDRESS: string;
  X402_FACILITATOR_URL?: string;
  X402_TOKEN_ADDRESS?: string;
  PRIVATE_KEY?: string;
  
  DOSSIERS?: any; // KVNamespace for caching
  CASTING_MODEL: string;
  NVIDIA_API_KEY: string;
  NVIDIA_BASE_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/brands', (c) => {
  return c.json({
    sectors: SECTORS,
    brands: BRANDS,
    brandsBySector: BRANDS_BY_SECTOR,
    liveBrands: LIVE_BRANDS,
    liveCollections: LIVE_COLLECTIONS
  });
});

app.get('/search', async (c) => {
  const env = c.env;
  const query = c.req.query('q');
  
  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const alchemy = getAlchemyClient(env.ALCHEMY_API_KEY);
  const results = await searchNftByKeyword(alchemy, query);
  
  return c.json({ results });
});

app.get('/nft/:contractAddress/:tokenId', async (c) => {
  const env = c.env;
  const contractAddress = c.req.param('contractAddress');
  const tokenId = c.req.param('tokenId');
  
  const alchemy = getAlchemyClient(env.ALCHEMY_API_KEY);
  const results = await resolveNftByContract(alchemy, contractAddress, tokenId);
  
  return c.json({ results });
});

app.get('/asset/:contractAddress/:tokenId', async (c) => {
  const env = c.env;
  const contractAddress = c.req.param('contractAddress');
  const tokenId = c.req.param('tokenId');
  
  let format = c.req.query('format'); // e.g., 'thumbnail', 'video', 'audio', 'image'
  const resolution = c.req.query('resolution') || 'original';
  
  const alchemy = getAlchemyClient(env.ALCHEMY_API_KEY);
  const db = getDbClient(env.DATABASE_URL, env.DATABASE_KEY);
  
  // If format is not specified, determine the main format from the local DB
  if (!format) {
    const { data: nftsFromDb } = await db.from('nfts')
      .select('media_type')
      .eq('contract', contractAddress.toLowerCase())
      .eq('token_id', tokenId)
      .maybeSingle();
      
    if (nftsFromDb) {
      format = nftsFromDb.media_type === 'unknown' ? 'image' : nftsFromDb.media_type;
    }
  }
  
  // Check cache first
  let cached = null;
  if (format) {
    cached = await getCachedAsset(db, contractAddress, tokenId, format, resolution).catch(() => null);
  }
  
  if (!cached) {
    // Ingest if not cached
    const nfts = await resolveNftByContract(alchemy, contractAddress, tokenId);
    if (nfts.length > 0) {
      await ingestAsset(env, db, nfts[0]);
      
      // If format was still unknown (NFT wasn't in DB), determine it now
      if (!format) {
        format = nfts[0].mediaType === 'unknown' ? 'image' : nfts[0].mediaType;
      }
      
      cached = await getCachedAsset(db, contractAddress, tokenId, format, resolution).catch(() => null);
    }
  }
  
  if (!cached) {
    return c.json({ error: 'Asset not found or failed to ingest' }, 404);
  }
  
  return c.json({
    success: true,
    r2_key: cached.r2_key,
    content_type: cached.content_type
  });
});

// Casting Director (Free & Paid)
app.route('/casting-director', castingDirectorRouter);
app.use('/x402/casting-director/*', x402Middleware(1)); 
app.route('/x402/casting-director', castingDirectorRouter);

// Storyboard (Free & Paid)
app.route('/storyboard', storyboardRouter);
app.use('/x402/storyboard/*', x402Middleware(1)); 
app.route('/x402/storyboard', storyboardRouter);

app.use('/r2/*', x402Middleware(1));
app.get('/r2/*', async (c) => {
  const env = c.env;
  // Extract the r2_key from the path (e.g., /r2/ethereum/0x.../2/thumbnail.png)
  const r2Key = c.req.path.replace('/r2/', '');
  
  if (!r2Key) {
    return c.json({ error: 'Missing R2 key' }, 400);
  }

  const object = await env.R2_BUCKET.get(r2Key);

  if (object === null) {
    return c.json({ error: 'File not found in R2' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, {
    headers,
  });
});

app.post('/fund', async (c) => {
  const env = c.env;
  let address = '';
  
  try {
    const body = await c.req.json().catch(() => ({}));
    address = body.address || c.req.query('address') || '';
  } catch (e) {
    address = c.req.query('address') || '';
  }
  
  if (!address) {
    return c.json({ error: 'Recipient address is required' }, 400);
  }
  
  const tokenAddress = env.X402_TOKEN_ADDRESS;
  const privateKey = env.PRIVATE_KEY;
  
  if (!tokenAddress) {
    return c.json({ error: 'X402_TOKEN_ADDRESS is not configured in the environment' }, 500);
  }
  
  if (!privateKey) {
    return c.json({ error: 'PRIVATE_KEY is not configured in the environment' }, 500);
  }
  
  try {
    const rpcUrl = env.ALCHEMY_API_KEY 
      ? `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
      : 'https://sepolia.base.org';
      
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const erc20Abi = [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)"
    ];
    
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    
    const amountToSend = ethers.parseUnits('100', decimals);
    
    const tx = await tokenContract.transfer(address, amountToSend);
    await tx.wait();
    
    return c.json({
      success: true,
      txHash: tx.hash,
      recipient: address,
      amount: '100',
      symbol: symbol
    });
  } catch (err: any) {
    console.error('Funding failed:', err);
    return c.json({ error: `Funding failed: ${err.message || err}` }, 500);
  }
});

app.post('/pay-owners', async (c) => {
  const env = c.env;
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const items = body.items || [];
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'Array of items is required' }, 400);
  }

  const tokenAddress = env.X402_TOKEN_ADDRESS;
  const privateKey = env.PRIVATE_KEY;
  
  if (!tokenAddress || !privateKey) {
    return c.json({ error: 'Token address or private key missing in env' }, 500);
  }

  const rpcUrl = env.ALCHEMY_API_KEY 
    ? `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
    : 'https://sepolia.base.org';
    
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
  const decimals = await tokenContract.decimals();

  const results = [];
  
  for (const item of items) {
    const { contractAddress, chain, tokenId, noOfSeconds } = item;
    
    if (!contractAddress || !chain || !tokenId || !noOfSeconds) {
       results.push({ item, error: 'Missing required fields' });
       continue;
    }
    
    try {
      const owner = await getOpenseaCollectionOwner(chain, contractAddress, tokenId, env);
      if (!owner) {
        results.push({ item, error: 'Could not find owner via OpenSea' });
        continue;
      }
      
      const amountToSend = ethers.parseUnits(noOfSeconds.toString(), decimals);
      const tx = await tokenContract.transfer(owner, amountToSend);
      await tx.wait();
      
      results.push({ item, owner, txHash: tx.hash, amount: noOfSeconds.toString() });
    } catch (err: any) {
      results.push({ item, error: err.message || err });
    }
  }
  
  return c.json({ results });
});

export default app;
