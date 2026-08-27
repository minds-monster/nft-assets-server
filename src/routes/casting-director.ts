import { Hono } from 'hono';
import { getAlchemyClient } from '../alchemy';
import { Env } from '../api-server';
// @ts-ignore
import { castPiece } from '../worker/casting-director.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/:contractAddress/:tokenId', async (c) => {
  const env = c.env;
  const contractAddress = c.req.param('contractAddress');
  const tokenId = c.req.param('tokenId');
  const refresh = c.req.query('refresh') === 'true';
  
  const alchemy = getAlchemyClient(env.ALCHEMY_API_KEY);
  
  let rawNft;
  try {
    rawNft = await alchemy.nft.getNftMetadata(contractAddress, tokenId);
  } catch (error: any) {
    return c.json({ error: `Failed to fetch NFT from Alchemy: ${error.message}` }, 404);
  }
  
  const key = `${contractAddress.toLowerCase()}:${tokenId}`;
  
  // castPiece handles KV caching, NVIDIA AI calls, and returns an SSE Response
  return castPiece({ key, nft: rawNft, refresh, previsNote: "" }, env, c.executionCtx);
});

export default app;
