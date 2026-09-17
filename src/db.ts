import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DbMediaFile {
  id?: string;
  nft_asset_id?: string;
  format: 'thumbnail' | 'image' | 'video' | 'audio' | '3d_model';
  resolution?: string; // defaults to 'original' in DB
  r2_key: string;
  content_type: string;
  byte_size: number;
  price_usdc: number;
}

export interface DbNftAsset {
  id?: string;
  chain: string;
  contract: string;
  token_id: string;
  name: string;
  collection_name: string;
  media_type: string;
  ai_description?: string;
}

export function getDbClient(url: string, key: string): SupabaseClient {
  return createClient(url, key);
}

export async function upsertSubjectIdentity(db: SupabaseClient, nft: DbNftAsset): Promise<string> {
  const { data, error } = await db.from('nft_assets').upsert({
    chain: nft.chain,
    contract: nft.contract.toLowerCase(),
    token_id: nft.token_id,
    name: nft.name,
    collection_name: nft.collection_name,
    media_type: nft.media_type,
    ...(nft.ai_description ? { ai_description: nft.ai_description } : {}),
    cached_at: new Date().toISOString()
  }, { onConflict: 'chain, contract, token_id' }).select('id').single();

  if (error || !data) throw new Error(`Failed to upsert subject identity: ${error?.message}`);
  return data.id;
}

export async function upsertMediaFile(db: SupabaseClient, subjectId: string, asset: DbMediaFile): Promise<void> {
  const { error } = await db.from('media_files').upsert({
    nft_asset_id: subjectId,
    format: asset.format,
    resolution: asset.resolution || 'original',
    r2_key: asset.r2_key,
    content_type: asset.content_type,
    byte_size: asset.byte_size,
    price_usdc: asset.price_usdc
  }, { onConflict: 'nft_asset_id, format, resolution' });

  if (error) throw new Error(`Failed to upsert Asset: ${error.message}`);
}

export async function getCachedMediaFile(
  db: SupabaseClient, 
  chain: string,
  contract: string, 
  tokenId: string, 
  format: string,
  resolution: string = 'original'
): Promise<(DbMediaFile & { nft_assets: DbNftAsset }) | null> {
  const query = db.from('media_files').select('*, nft_assets!inner(*)')
    .eq('nft_assets.chain', chain)
    .eq('nft_assets.contract', contract.toLowerCase())
    .eq('nft_assets.token_id', tokenId)
    .eq('format', format)
    .eq('resolution', resolution);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to get cached asset: ${error.message}`);
  return data;
}

export async function searchLocalNfts(db: SupabaseClient, query: string) {
  const { data, error } = await db.from('nft_assets')
    .select('*')
    .or(`name.ilike.%${query}%,collection_name.ilike.%${query}%`)
    .limit(10);
    
  if (error) throw new Error(`Failed to search local subjects: ${error.message}`);
  return data as DbNftAsset[];
}

export async function getLocalNftByContract(db: SupabaseClient, contract: string, tokenId?: string) {
  let query = db.from('nft_assets').select('*, media_files(*)').eq('contract', contract.toLowerCase());
  if (tokenId) {
    query = query.eq('token_id', tokenId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to get local subject: ${error.message}`);
  return data;
}

export async function getSubject(db: SupabaseClient, chain: string, contract: string, tokenId: string) {
  const { data, error } = await db.from('nft_assets').select('*, media_files(*)')
    .eq('chain', chain)
    .eq('contract', contract.toLowerCase())
    .eq('token_id', tokenId)
    .maybeSingle();
  if (error) throw new Error(`Failed to get subject: ${error.message}`);
  return data;
}

export async function upsertSubjectDossier(db: SupabaseClient, chain: string, contract: string, tokenId: string, version: number, dossierData: any) {
  // First, fetch existing dossier_data so we can merge it
  const { data: existing } = await db.from('nft_assets')
    .select('dossier_data')
    .eq('chain', chain)
    .eq('contract', contract.toLowerCase())
    .eq('token_id', tokenId)
    .maybeSingle();
    
  const mergedDossierData = {
    ...(existing?.dossier_data || {}),
    ...dossierData
  };

  const { data, error } = await db.from('nft_assets').upsert({
    chain,
    contract: contract.toLowerCase(),
    token_id: tokenId,
    dossier_version: version,
    dossier_data: mergedDossierData,
    updated_at: new Date().toISOString()
  }, { onConflict: 'chain, contract, token_id' }).select('*').single();
  
  if (error) throw new Error(`Failed to upsert subject dossier: ${error.message}`);
  return data;
}

export async function upsertSubjectMesh(db: SupabaseClient, chain: string, contract: string, tokenId: string, record: any) {
  const meshData = {
    progress: record.progress || 0,
    taskId: record.taskId || null,
    meshVersion: record.meshVersion || 1,
    medium: record.medium || null,
    representation: record.representation || null,
    inference: record.inference || null,
    caveat: record.caveat || null,
    reason: record.reason || null,
    faceLimit: record.faceLimit || null,
    sourceUrl: record.sourceUrl || null,
    model: record.model || null,
    pollError: record.pollError || null,
    bytes: record.bytes || null,
  };

  const { data: subject, error: subjectError } = await db.from('nft_assets').upsert({
    chain,
    contract: contract.toLowerCase(),
    token_id: tokenId,
    generation_status: record.status || 'unknown',
    r2_key: record.r2Key || null,
    mesh_data: meshData,
    updated_at: new Date().toISOString()
  }, { onConflict: 'chain, contract, token_id' }).select('id').single();

  if (subjectError) throw new Error(`Failed to upsert subject mesh tracking: ${subjectError.message}`);

  // 2. Upsert the media_files row only if we have an r2Key for the 3D model
  if (record.status === 'ready' && record.r2Key) {
    const { data, error } = await db.from('media_files').upsert({
      nft_asset_id: subject.id,
      format: '3d_model',
      resolution: 'original',
      r2_key: record.r2Key,
      byte_size: record.bytes || 0,
      content_type: 'model/gltf-binary',
      price_usdc: 0
    }, { onConflict: 'nft_asset_id, format, resolution' }).select('*').single();

    if (error) throw new Error(`Failed to upsert subject mesh into media_files: ${error.message}`);
    return data;
  }

  return subject;
}

export async function getNftsWith3dModels(db: SupabaseClient, skip: number = 0, take: number = 10, search?: string) {
  let query = db.from('nft_assets')
    .select(`
      *,
      media_files!inner(*)
    `, { count: 'exact' })
    .eq('media_files.format', '3d_model');

  if (search) {
    query = query.or(`name.ilike.%${search}%,collection_name.ilike.%${search}%,contract.ilike.%${search}%`);
  }

  // Supabase uses 0-based inclusive indices for range.
  query = query.range(skip, skip + take - 1);

  const { data, error, count } = await query;
  
  if (error) throw new Error(`Failed to get NFTs with 3D models: ${error.message}`);
  return { data, count };
}

export async function getAssetByTaskId(db: SupabaseClient, taskId: string) {
  const { data, error } = await db.from('nft_assets').select('chain, contract, token_id').eq('task_id', taskId).maybeSingle();
  if (error) throw new Error(`Failed to get asset by task id: ${error.message}`);
  if (!data) return null;
  return `${data.chain}:${data.contract}:${data.token_id}`;
}
