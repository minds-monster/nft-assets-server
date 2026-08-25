# x402-Gated NFT Asset MCP Server

This MCP server indexes high-resolution Ethereum NFT assets and serves them to AI agents using x402 stablecoin micropayments. It runs on Cloudflare Workers and utilizes Supabase (PostgreSQL) for metadata indexing and Cloudflare R2 for asset caching.

## Architecture

1. **Metadata & Search**: Integrates with Alchemy NFT API to resolve contracts and search by keyword.
2. **Asset Ingestion Pipeline**: Automatically fetches NFT media from IPFS/Arweave/HTTP and caches them in Cloudflare R2 on the first request.
3. **Database Layer**: Stores normalized NFT metadata and cached asset information using Supabase.
4. **x402 Gating**: Exposes free tools for search/metadata and gates the actual high-res asset retrieval behind x402 payment requirements.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in your Supabase credentials, Alchemy API key, and your Base USDC wallet address for x402 payments.

3. Setup the database schema in Supabase:
   Run the SQL commands provided in `schema.sql` in your Supabase project's SQL editor.

4. Create the R2 Bucket:
   ```bash
   npx wrangler r2 bucket create nft-assets
   ```

5. Run locally:
   ```bash
   npm run dev
   ```

## Pricing Configuration

Pricing is statically configured per asset format in `src/ingest.ts` and `src/mcp-server.ts`. Current defaults:

- `thumbnail`: Free ($0.00)
- `image`: $0.01 USDC
- `audio`: $0.02 USDC
- `video`: $0.05 USDC

## Testing x402 Locally

When calling the `get_nft_asset` tool without payment, the server will return an HTTP 402 error alongside a JSON payload detailing the required payment (amount, currency, chain, recipient, facilitator).

To bypass this in local testing, the mock implementation of `paidTool` (in `src/mcp-server.ts`) allows you to inject `_x402PaymentStatus: 'settled'` in the tool arguments. In production, this requires an actual cryptographic proof validated by the designated facilitator.

## MCP Tools Exposed

- `search_nft(query: string)`: Searches for NFT contracts and returns sample NFTs (Free).
- `get_nft_by_contract(contractAddress: string, tokenId?: string)`: Retrieves NFT metadata (Free).
- `get_nft_asset(contract: string, tokenId: string, format: string, resolution?: string)`: Paid asset retrieval. Triggers ingestion on cache miss and returns an R2 key (x402 Gated).
