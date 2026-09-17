import { R2Bucket } from '@cloudflare/workers-types';
import { SupabaseClient } from '@supabase/supabase-js';
import { upsertSubjectIdentity, upsertMediaFile, DbNftAsset } from './db';
import { NormalizedNFT } from './types';

export interface IngestEnv {
  R2_BUCKET: R2Bucket;
  IPFS_GATEWAY_URL: string;
}

function resolveSourceUrl(uri: string, ipfsGateway: string): string {
  if (uri.startsWith('ipfs://')) {
    const gw = ipfsGateway.endsWith('/') ? ipfsGateway : `${ipfsGateway}/`;
    return uri.replace('ipfs://', gw);
  }
  if (uri.startsWith('ar://')) {
    return uri.replace('ar://', 'https://arweave.net/');
  }
  return uri;
}

export async function ingestAsset(
  env: IngestEnv,
  db: SupabaseClient,
  nft: NormalizedNFT
) {
  // 1. Save NFT to DB
  const dbNft: DbNftAsset = {
    chain: nft.chain,
    contract: nft.contract,
    token_id: nft.tokenId,
    name: nft.name,
    collection_name: nft.collection,
    media_type: nft.mediaType,
  };
  const subjectId = await upsertSubjectIdentity(db, dbNft);

  // Prices based on prompt: thumbnail free, image $0.01, video $0.05, audio $0.02
  const priceMap: Record<string, number> = {
    'thumbnail': 0,
    'image': 0.01,
    'video': 0.05,
    'audio': 0.02,
    'unknown': 0.01
  };

  const processFormat = async (format: 'thumbnail' | 'image' | 'video' | 'audio', sourceUrl: string) => {
    if (!sourceUrl) return;

    try {
      const url = resolveSourceUrl(sourceUrl, env.IPFS_GATEWAY_URL);
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);

      const contentType = res.headers.get('content-type') || 'application/octet-stream';

      const r2Key = `cast/${nft.chain}/${nft.contract}/${nft.tokenId}/${format}`;

      // Read stream into buffer to satisfy R2's known length requirement
      const buffer = await res.arrayBuffer();

      // Upload stream to R2
      const r2Object = await env.R2_BUCKET.put(r2Key, buffer, {
        httpMetadata: { contentType }
      });

      if (!r2Object) {
        throw new Error('R2 put failed, returned null');
      }

      const byteSize = r2Object.size;

      // Save asset record to DB
      await upsertMediaFile(db, subjectId, {
        format,
        resolution: 'original',
        r2_key: r2Key,
        content_type: contentType,
        byte_size: byteSize,
        price_usdc: priceMap[format] ?? 0.01
      });

    } catch (err) {
      console.error(`Failed to ingest format ${format} for ${nft.contract}/${nft.tokenId}`, err);
    }
  };

  const mainFormat = (nft.mediaType === 'unknown' ? 'image' : nft.mediaType) as 'image' | 'video' | 'audio';
  
  // Ingest main asset
  await processFormat(mainFormat, nft.sourceUri);

  // Ingest thumbnail
  if (nft.thumbnailUri) {
    await processFormat('thumbnail', nft.thumbnailUri);
  } else if (mainFormat === 'image') {
    // Fallback: use main image as thumbnail if no dedicated thumbnail URL
    await processFormat('thumbnail', nft.sourceUri);
  }
}
