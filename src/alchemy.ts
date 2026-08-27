import { Alchemy, Network, Nft } from 'alchemy-sdk';
import { NormalizedNFT } from './types';
import { resolveNftMedia, resolveNftThumb, resolveNftDescription, resolveNftName } from './worker/nftMedia';

export function getAlchemyClient(apiKey: string): Alchemy {
  return new Alchemy({
    apiKey,
    network: Network.ETH_MAINNET,
  });
}

/**
 * Normalizes an IPFS/Arweave URI to a standard HTTP gateway URI for fallback usage.
 * Note: The ingestion layer will use its own dedicated gateway for actual caching.
 */
export function normalizeUri(uri: string | undefined): string {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) {
    return uri.replace('ipfs://', 'https://cloudflare-ipfs.com/ipfs/');
  }
  if (uri.startsWith('ar://')) {
    return uri.replace('ar://', 'https://arweave.net/');
  }
  return uri;
}

/**
 * Converts Alchemy's raw NFT metadata into our normalized internal schema.
 */
export function normalizeNftMetadata(nft: Nft): NormalizedNFT {
  const media = resolveNftMedia(nft as any);
  
  let mediaType: NormalizedNFT['mediaType'] = 'unknown';
  let sourceUri = '';

  if (media.video) {
    mediaType = 'video';
    sourceUri = media.video;
  } else if (media.image) {
    mediaType = 'image';
    sourceUri = media.image;
  }

  // Handle malformed or relative URIs (if any)
  sourceUri = normalizeUri(sourceUri);
  
  return {
    contract: nft.contract.address.toLowerCase(),
    tokenId: nft.tokenId,
    name: resolveNftName(nft as any),
    collection: nft.contract.name || nft.contract.symbol || 'Unknown Collection',
    mediaType,
    sourceUri,
    thumbnailUri: resolveNftThumb(nft as any) || undefined,
    description: resolveNftDescription(nft as any)
  };
}

/**
 * Resolves one or many NFTs for a given contract.
 */
export async function resolveNftByContract(
  alchemy: Alchemy, 
  contractAddress: string, 
  tokenId?: string
): Promise<NormalizedNFT[]> {
  if (tokenId) {
    const nft = await alchemy.nft.getNftMetadata(contractAddress, tokenId);
    return [normalizeNftMetadata(nft)];
  } else {
    // If no tokenId, return the first 20 NFTs for the contract
    const res = await alchemy.nft.getNftsForContract(contractAddress, { pageSize: 20 });
    return res.nfts.map(normalizeNftMetadata);
  }
}

/**
 * Searches for NFTs by keyword. Alchemy supports searching contract metadata.
 * We fetch top matching contracts and then grab a few sample NFTs for each.
 */
export async function searchNftByKeyword(
  alchemy: Alchemy, 
  query: string
): Promise<NormalizedNFT[]> {
  // `searchContractMetadata` searches for contracts by name/symbol
  const res = await alchemy.nft.searchContractMetadata(query);
  
  const results: NormalizedNFT[] = [];
  
  // Grab up to 3 contracts to keep it fast
  const topContracts = res.contracts.slice(0, 3);
  
  for (const contract of topContracts) {
    try {
      const nfts = await alchemy.nft.getNftsForContract(contract.address, { pageSize: 5 });
      results.push(...nfts.nfts.map(normalizeNftMetadata));
    } catch (err) {
      console.warn(`Failed to fetch NFTs for contract ${contract.address}`, err);
    }
  }
  
  return results;
}
