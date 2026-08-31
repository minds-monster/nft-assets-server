import { Hono } from 'hono';
import { getAlchemyClient } from '../alchemy';
import { Env } from '../api-server';
// @ts-ignore
import { castPiece } from '../worker/casting-director.js';

const app = new Hono<{ Bindings: Env }>();

const ALLOWED_CHAINS = [
  'eth-mainnet',
  'polygon-mainnet',
  'base-mainnet',
  'opt-mainnet',
  'arb-mainnet',
  'apechain-mainnet',
  'ronin-mainnet',
  'shape-mainnet',
  'zksync-mainnet',
  'flow-mainnet',
  'abstract-mainnet',
  'berachain-mainnet',
  'anime-mainnet',
  'zora-mainnet',
  'story-mainnet',
  'robinhood-mainnet'
];

app.get('/:chain/:contractAddress/:tokenId', async (c) => {
  const env = c.env;
  const chain = c.req.param('chain');
  
  if (!ALLOWED_CHAINS.includes(chain)) {
    return c.json({ error: `Unsupported chain: ${chain}. Allowed chains are: ${ALLOWED_CHAINS.join(', ')}` }, 400);
  }

  const contractAddress = c.req.param('contractAddress');
  const tokenId = c.req.param('tokenId');
  const refresh = c.req.query('refresh') === 'true';
  
  const alchemy = getAlchemyClient(env.ALCHEMY_API_KEY, chain);
  
  let rawNft;
  try {
    rawNft = await alchemy.nft.getNftMetadata(contractAddress, tokenId);
  } catch (error: any) {
    return c.json({ error: `Failed to fetch NFT from Alchemy: ${error.message}` }, 404);
  }
  
  const key = `${chain}:${contractAddress.toLowerCase()}:${tokenId}`;
  
  // castPiece handles KV caching, NVIDIA AI calls, and returns an SSE Response
  return castPiece({ key, nft: rawNft, refresh, previsNote: "" }, env, c.executionCtx);
});

export default app;
