export async function fetchArtwork(urls, { maxBytes }) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > maxBytes) continue;
      
      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      return {
        url,
        buffer,
        contentType
      };
    } catch (e) {
      continue;
    }
  }
  throw new Error("Could not fetch artwork from any provided URL.");
}

import { Buffer } from 'node:buffer';

export function toDataUri(artwork) {
  const base64 = Buffer.from(artwork.buffer).toString('base64');
  return `data:${artwork.contentType};base64,${base64}`;
}
