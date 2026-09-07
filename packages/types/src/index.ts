export interface NormalizedNFT {
  contract: string;
  tokenId: string;
  name: string;
  collection: string;
  mediaType: "image" | "video" | "audio" | "unknown";
  sourceUri: string;
  thumbnailUri?: string;
  description?: string;
}
