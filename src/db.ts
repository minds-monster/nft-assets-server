import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DbAsset {
  id?: string;
  nft_id?: string;
  format: 'thumbnail' | 'image' | 'video' | 'audio';
  resolution?: string; // defaults to 'original' in DB
  r2_key: string;
  content_type: string;
  byte_size: number;
  price_usdc: number;
}

export interface DbNft {
  id?: string;
  contract: string;
  token_id: string;
  name: string;
  collection_name: string;
  media_type: string;
  cached_at?: string;
}

export function getDbClient(url: string, key: string): SupabaseClient {
  return createClient(url, key);
}

export async function upsertNft(db: SupabaseClient, nft: DbNft): Promise<string> {
  const { data, error } = await db.from('nfts').upsert({
    contract: nft.contract.toLowerCase(),
    token_id: nft.token_id,
    name: nft.name,
    collection_name: nft.collection_name,
    media_type: nft.media_type,
    cached_at: new Date().toISOString()
  }, { onConflict: 'contract, token_id' }).select('id').single();

  if (error || !data) throw new Error(`Failed to upsert NFT: ${error?.message}`);
  return data.id;
}

export async function upsertAsset(db: SupabaseClient, nftId: string, asset: DbAsset): Promise<void> {
  const { error } = await db.from('assets').upsert({
    nft_id: nftId,
    format: asset.format,
    resolution: asset.resolution || 'original',
    r2_key: asset.r2_key,
    content_type: asset.content_type,
    byte_size: asset.byte_size,
    price_usdc: asset.price_usdc
  }, { onConflict: 'nft_id, format, resolution' });

  if (error) throw new Error(`Failed to upsert Asset: ${error.message}`);
}

export async function getCachedAsset(
  db: SupabaseClient, 
  contract: string, 
  tokenId: string, 
  format: string,
  resolution: string = 'original'
): Promise<(DbAsset & { nfts: DbNft }) | null> {
  const query = db.from('assets').select('*, nfts!inner(*)')
    .eq('nfts.contract', contract.toLowerCase())
    .eq('nfts.token_id', tokenId)
    .eq('format', format)
    .eq('resolution', resolution);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to get cached asset: ${error.message}`);
  return data;
}

export async function searchLocalNfts(db: SupabaseClient, query: string) {
  // Using ilike for simple full-text/trigram fallback.
  const { data, error } = await db.from('nfts')
    .select('*')
    .or(`name.ilike.%${query}%,collection_name.ilike.%${query}%`)
    .limit(10);
    
  if (error) throw new Error(`Failed to search local NFTs: ${error.message}`);
  return data as DbNft[];
}

export async function getLocalNftByContract(db: SupabaseClient, contract: string, tokenId?: string) {
  let query = db.from('nfts').select('*, assets(*)').eq('contract', contract.toLowerCase());
  if (tokenId) {
    query = query.eq('token_id', tokenId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to get local NFT: ${error.message}`);
  return data;
}
