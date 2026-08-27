import { Hono } from 'hono';
import { getDbClient, getCachedAsset, DbAsset, upsertAsset } from '../db';
import { Env } from '../api-server';

const app = new Hono<{ Bindings: Env }>();

app.get('/:contractAddress/:tokenId', async (c) => {
  const env = c.env;
  const contractAddress = c.req.param('contractAddress');
  const tokenId = c.req.param('tokenId');
  
  const db = getDbClient(env.DATABASE_URL, env.DATABASE_KEY);
  
  // Check if 3D model already exists (format = '3d_model', resolution = 'v1' for now)
  const format = '3d_model';
  let cached = await getCachedAsset(db, contractAddress, tokenId, format, 'v1').catch(() => null);
  
  if (cached) {
    return c.json({
      success: true,
      r2_key: cached.r2_key,
      content_type: cached.content_type,
      version: cached.resolution
    });
  }
  
  // We need the nft_id to insert an asset. 
  const { data: nftsFromDb } = await db.from('nfts')
    .select('id')
    .eq('contract', contractAddress.toLowerCase())
    .eq('token_id', tokenId)
    .maybeSingle();
    
  if (!nftsFromDb) {
    return c.json({ error: 'NFT not found. Please ingest it first using the /asset endpoint.' }, 404);
  }
  
  // Generate 3D model placeholder
  const placeholder3dModelData = Buffer.from('mock 3d object data (e.g. glTF/obj)', 'utf-8');
  const version = 'v1';
  const r2Key = `ethereum/${contractAddress.toLowerCase()}/${tokenId}/${format}_${version}.glb`;
  
  // Store in R2 bucket
  await env.R2_BUCKET.put(r2Key, placeholder3dModelData, {
    httpMetadata: { contentType: 'model/gltf-binary' }
  });
  
  // Store info in Supabase
  const asset: DbAsset = {
    format,
    resolution: version,
    r2_key: r2Key,
    content_type: 'model/gltf-binary',
    byte_size: placeholder3dModelData.length,
    price_usdc: 0
  };
  
  try {
    await upsertAsset(db, nftsFromDb.id, asset);
  } catch (error: any) {
    return c.json({ error: `Failed to store asset metadata: ${error.message}` }, 500);
  }
  
  return c.json({
    success: true,
    r2_key: r2Key,
    content_type: asset.content_type,
    version: version
  });
});

export default app;
