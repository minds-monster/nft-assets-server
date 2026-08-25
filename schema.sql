CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS nfts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract text NOT NULL,
  token_id text NOT NULL,
  name text NOT NULL,
  collection_name text,
  media_type text,
  cached_at timestamptz DEFAULT now(),
  UNIQUE (contract, token_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nft_id uuid REFERENCES nfts(id) ON DELETE CASCADE,
  format text NOT NULL, -- 'thumbnail' | 'image' | 'video' | 'audio'
  resolution text NOT NULL DEFAULT 'original',
  r2_key text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint,
  price_usdc numeric(10, 6) DEFAULT 0,
  UNIQUE (nft_id, format, resolution)
);

-- Trigram index for keyword search fallback
CREATE INDEX IF NOT EXISTS nfts_name_collection_trgm_idx ON nfts USING gin (
  (name || ' ' || coalesce(collection_name, '')) gin_trgm_ops
);
