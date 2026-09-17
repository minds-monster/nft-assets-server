CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS nft_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  chain text NOT NULL,
  contract text NOT NULL,
  token_id text NOT NULL,
  name text NOT NULL,
  collection_name text,
  media_type text,
  ai_description text,
  
  -- Casting Director Data
  dossier_data jsonb,
  dossier_version integer,
  
  -- 3D Mesh Generation Tracking
  generation_status text NOT NULL DEFAULT 'absent',
  r2_key text,
  mesh_data jsonb,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE (chain, contract, token_id)
);

CREATE TABLE IF NOT EXISTS media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nft_asset_id uuid REFERENCES nft_assets(id) ON DELETE CASCADE,
  format text NOT NULL, -- 'thumbnail' | 'image' | 'video' | 'audio' | '3d_model'
  resolution text NOT NULL DEFAULT 'original',
  r2_key text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint,
  price_usdc numeric(10, 6) DEFAULT 0,
  UNIQUE (nft_asset_id, format, resolution)
);

-- Trigram index for keyword search fallback
CREATE INDEX IF NOT EXISTS nft_assets_name_collection_trgm_idx ON nft_assets USING gin (
  (name || ' ' || coalesce(collection_name, '')) gin_trgm_ops
);
