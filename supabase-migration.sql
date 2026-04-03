-- Aggie Map: Schema migration for geographic expansion + ingestion pipeline
-- Run this in Supabase SQL Editor on existing databases

-- Geographic fields
ALTER TABLE items ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS region text;

-- Ingestion tracking fields
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'user';
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Backfill source_type for existing rows
UPDATE items SET source_type = source WHERE source_type IS NULL;

-- Unique index for ingestion deduplication (prevents duplicate ingested events)
CREATE UNIQUE INDEX IF NOT EXISTS items_external_id_source_unique
  ON items (source_type, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;

-- Index for city/region filtering
CREATE INDEX IF NOT EXISTS items_city_idx ON items (city) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS items_region_idx ON items (region) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS items_source_type_idx ON items (source_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS items_last_seen_at_idx ON items (last_seen_at) WHERE deleted_at IS NULL;

-- Pet egg inventory: tracks how many unhatched eggs a user owns
ALTER TABLE user_pets ADD COLUMN IF NOT EXISTS egg_count INTEGER DEFAULT 0 NOT NULL;
