-- ============================================================
-- Aggie Map — Menu Link + Known For Migration
-- Run this ONCE in: Supabase Dashboard → SQL Editor
-- ============================================================

-- menu_link: official menu page URL for food places
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS menu_link text;

-- known_for: array of signature dishes / notable items
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS known_for text[];

-- Index for finding enriched food items quickly
CREATE INDEX IF NOT EXISTS idx_items_menu_link ON items(category) WHERE menu_link IS NOT NULL;
