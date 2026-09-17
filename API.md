# API Documentation

This document outlines the available REST API endpoints in the `api-server.ts`. Many endpoints optionally support a `/x402/*` prefix for gated access (via the `x402Middleware`).

---

## 1. Discovery & Search

### `GET /brands`
Retrieves categorized branding data.
*   **Response (JSON):** Contains `sectors`, `brands`, `brandsBySector`, `liveBrands`, and `liveCollections`.

### `GET /search`
Searches for NFTs by a given keyword.
*   **Query Parameters:**
    *   `q` (string, required): The keyword to search for.
*   **Response (JSON):** `{ "results": [...] }`

### `GET /nfts/3d`
Retrieves a paginated list of existing NFTs that have a 3D model generated.
*   **Query Parameters:**
    *   `skip` (number, optional): The number of records to skip for pagination. Defaults to `0`.
    *   `take` (number, optional): The number of records to return. Defaults to `10` (maximum `50`).
    *   `q` or `search` (string, optional): A keyword to search across NFT names, collection names, and contract addresses.
*   **Response (JSON):** 
    *   `200 OK`: `{ "data": [...], "count": <total_number>, "skip": <skip_value>, "take": <take_value> }`
    *   `500 Internal Server Error`: `{ "error": "Error message" }`

### `GET /nft/:contractAddress/:tokenId`
Resolves basic NFT metadata directly from Alchemy.
*   **Path Parameters:**
    *   `contractAddress` (string)
    *   `tokenId` (string)
*   **Query Parameters:**
    *   `chain` (string, optional): The chain ID, e.g., `eth-mainnet`. Defaults to `eth-mainnet`.
*   **Response (JSON):** `{ "results": [...] }`

---

## 2. Asset & Media Ingestion

### `GET /asset/:contractAddress/:tokenId`
Retrieves or ingests media information for an NFT and stores it in Supabase / R2 cache.
*   **Path Parameters:**
    *   `contractAddress` (string)
    *   `tokenId` (string)
*   **Query Parameters:**
    *   `chain` (string, optional): Defaults to `eth-mainnet`.
    *   `format` (string, optional): e.g., `thumbnail`, `video`, `audio`, `image`. If omitted, determines automatically from DB or ingest.
    *   `resolution` (string, optional): Defaults to `original`.
*   **Response (JSON):** 
    *   `200 OK`: `{ "success": true, "r2_key": "...", "content_type": "..." }`
    *   `404 Not Found`: If asset failed to ingest or couldn't be found.

### `GET /r2/*`
*(Also available at `/x402/r2/*`)*
Proxy to retrieve raw files stored in the R2 bucket.
*   **Path:** The relative key within R2 (e.g. `/r2/ethereum/0x.../2/thumbnail.png`).
*   **Response:** Raw file stream with associated `content-type` headers, or `404 Not Found` if missing.

---

## 3. 3D Mesh Generation

### `GET /3d-mesh`
Retrieves the generated 3D mesh (GLB) for a given NFT, or its generation status.
*   **Query Parameters:**
    *   `asset` (string, required): The unique identifier in the format `chain:address:tokenId`.
*   **Response:**
    *   `200 OK` (binary): The `.glb` mesh file (`model/gltf-binary`).
    *   `200 OK` (JSON): If not ready, e.g., `{"status": "pending", "progress": 50}`.
    *   `404 Not Found`: If absent.
    *   `400/502`: Bad request or generation failed.

### `POST /3d-mesh/generate`
Initiates a 3D mesh generation task.
*   **Body (JSON):**
    *   `asset` (string, required): `chain:address:tokenId`.
    *   `force` (boolean, optional): Bypass cache.
    *   `nft` (object, optional): Provide NFT info for database upsertion.
*   **Response (JSON):** Information about the pending task (e.g., `taskId`).

---

## 4. Casting Director & Storyboard

### `GET /casting-director/:chain/:contractAddress/:tokenId`
*(Also available at `/x402/casting-director/*`)*
Streams AI character casting generation from NVIDIA AI models using SSE (Server-Sent Events).
*   **Query Parameters:**
    *   `refresh` (boolean, optional): Set to `true` to force a new generation.

### `GET /storyboard/:contractAddress/:tokenId`
*(Also available at `/x402/storyboard/*`)*
Generates a storyboard placeholder or retrieves cached versions from the database/R2.
*   **Response (JSON):** `{ "success": true, "r2_key": "...", "content_type": "...", "version": "v1" }`

---

## 5. Payments & Funding

### `POST /fund`
Sends 100 test X402 tokens to a specified address.
*   **Body/Query (JSON or Query String):**
    *   `address` (string, required): The recipient's wallet address.
*   **Response (JSON):** `{ "success": true, "txHash": "...", "recipient": "...", "amount": "100", "symbol": "..." }`

### `POST /pay-owners`
Pays OpenSea collection owners a specific amount of tokens based on screen time or other logic.
*   **Body (JSON):**
    *   `items` (array, required): Array of objects with `{ contractAddress, chain, tokenId, noOfSeconds }`.
*   **Response (JSON):** `{ "results": [{ item, owner, txHash, amount }] }`

---

## 6. Admin

### `POST /admin/migrate-kv-assets`
Migrates legacy KV store dossier/mesh assets into the new Supabase relational schema.
*   **Body (JSON):**
    *   `cursor` (string, optional): KV listing cursor.
    *   `limit` (number, optional): Maximum items to process. Defaults to 10.
*   **Response (JSON):** Details the success and failures of migrated objects.
