# Build Prompt: x402-Gated NFT Asset MCP Server

Copy everything below into your coding agent (Claude Code, Cursor, etc.)

---

Build an MCP server that indexes high-resolution Ethereum NFT assets (images, videos, audio) and serves them to AI agents behind x402 stablecoin micropayments.

## Scope

Ethereum mainnet only for now. Node.js + TypeScript. Deploy target: Cloudflare Workers.

## Core user flows

1. Agent provides a contract address (and optional tokenId), OR a keyword search string.
2. Server resolves matching NFT(s) via Alchemy NFT API, returns a lightweight list (name, collection, tokenId, thumbnail URL, available resolutions/formats, price per format).
3. Agent selects a specific NFT + asset format/resolution and calls the "get asset" tool.
4. If unpaid, respond with HTTP 402 and x402 payment requirements (price in USDC on Base, recipient wallet, facilitator info).
5. Agent retries with payment proof. Server verifies via facilitator, then returns a signed/expiring URL (or streams) the cached high-res asset from storage.

## Components to build

### 1. Metadata & search layer (Alchemy NFT API)
- `resolveNftByContract(contractAddress, tokenId?)` — call Alchemy `getNFTMetadata` / `getNFTsForContract`.
- `searchNftByKeyword(query)` — call Alchemy `searchContractMetadata` (and/or maintain a local search index once collections have been indexed once, since Alchemy's keyword search is collection-level, not full NFT-name search).
- Normalize Alchemy's raw metadata (handle `ipfs://`, `ar://`, HTTP, and malformed/relative URIs) into a clean internal schema: `{ contract, tokenId, name, collection, mediaType, sourceUri, thumbnailUri }`.
- Detect media type from metadata (image/video/audio) using `animation_url` vs `image` fields and content-type sniffing as fallback.

### 2. Asset ingestion & caching pipeline
- On first request for a given `(contract, tokenId)`, fetch the source asset from its origin:
  - IPFS via a dedicated gateway (Pinata or Filebase) — do NOT use public ipfs.io in production.
  - Arweave via `arweave.net` or `ar-io.net`.
  - Direct HTTP fallback.
- Store the fetched asset in Cloudflare R2 under a deterministic key: `ethereum/{contract}/{tokenId}/{format}` (e.g. `original.png`, `original.mp4`, `thumb.jpg`).
- Generate a thumbnail/preview automatically for free-tier discovery (no payment required for thumbnails).
- Record an index row in the metadata DB: contract, tokenId, name, collection, r2 keys per format, content type, byte size, cachedAt.
- All subsequent requests serve directly from R2 — never re-fetch from IPFS/Arweave unless cache is missing.

### 3. Metadata index DB
- Use Postgres (Supabase or Neon is fine) with a simple schema:
  - `nfts (contract, token_id, name, collection_name, media_type, cached_at)`
  - `assets (nft_id, format, resolution, r2_key, content_type, byte_size, price_usdc)`
- Add a basic full-text/trigram index on `name` + `collection_name` for keyword search fallback once assets have been indexed at least once.

### 4. MCP server with x402 gating
- Use `@modelcontextprotocol/sdk` for the MCP server, deployed on Cloudflare Workers.
- Use Cloudflare Agents SDK's `withX402` / `paidTool` helpers to gate tools with per-call USDC pricing on Base, via Coinbase's public facilitator to start.
- Expose these MCP tools:
  - `search_nft(query: string)` — free. Returns list of candidate NFTs with thumbnails, no payment required.
  - `get_nft_by_contract(contractAddress: string, tokenId?: string)` — free. Returns metadata + available formats/prices.
  - `get_nft_asset(contract: string, tokenId: string, format: "thumbnail"|"image"|"video"|"audio", resolution?: string)` — paid via x402. Price varies by format (e.g. thumbnail free, image $0.01, video $0.05, audio $0.02). Triggers ingestion pipeline if not cached, then returns a short-lived signed R2 URL.
- Payment verification must check the actual settled amount/token/chain against the tool's expected price before releasing the asset — don't trust client-declared amounts.
- Add per-agent/per-session basic rate limiting to avoid abuse of the free tools.

### 5. Discovery
- Once deployed, generate the x402 Bazaar listing manifest so the server is discoverable by other agents without prior knowledge of it.

## Deliverables

- `/src/alchemy.ts` — Alchemy client + metadata normalization
- `/src/ingest.ts` — asset fetch (IPFS/Arweave/HTTP) + R2 upload pipeline
- `/src/db.ts` — Postgres schema + query helpers
- `/src/mcp-server.ts` — MCP tool definitions + x402 gating wiring
- `/wrangler.toml` — Cloudflare Workers config (R2 binding, env vars for Alchemy API key, facilitator config, DB connection)
- `.env.example` — required secrets (ALCHEMY_API_KEY, DATABASE_URL, X402_WALLET_ADDRESS, R2 credentials, IPFS_GATEWAY_KEY)
- `README.md` — setup, how pricing is configured per format, how to test locally with x402 payment simulation

## Constraints & notes

- Keep the free tools (search, metadata lookup) genuinely free — payment should only gate the actual high-res binary delivery, since that's what drives agent trust and discovery.
- Don't proxy live IPFS/Arweave fetches on the hot path — always serve from R2 cache once ingested.
- Handle malformed/legacy tokenURI metadata gracefully (many older ERC-721 contracts have broken or relative IPFS paths) — log and skip rather than crash the ingestion pipeline.
- Start with Coinbase's free public x402 facilitator; make the facilitator URL configurable so it can be swapped later.

Build this incrementally: metadata/search layer first (testable without any payment logic), then ingestion + R2 caching, then wire in x402 gating last.
