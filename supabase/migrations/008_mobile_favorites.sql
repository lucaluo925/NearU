-- ── Mobile favorites tables ───────────────────────────────────────────────────
-- Supports the NearU mobile app's collection-based favorites system.
-- The web app uses localStorage; the mobile app persists to Supabase so
-- favorites survive app reinstalls and device changes.

-- user_collections: named lists a user creates (mirrors DEFAULT_COLLECTIONS)
CREATE TABLE IF NOT EXISTS user_collections (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

-- user_favorites: one row per saved item, linked to a collection
CREATE TABLE IF NOT EXISTS user_favorites (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id         uuid        NOT NULL REFERENCES items(id)       ON DELETE CASCADE,
  collection_name text        NOT NULL DEFAULT 'Want to try',
  created_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, item_id)   -- one row per item regardless of collection
);

-- Indexes for fast per-user lookups
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id   ON user_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_user_collections_user_id ON user_collections (user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorites   ENABLE ROW LEVEL SECURITY;

-- user_collections
CREATE POLICY "users can select own collections"
  ON user_collections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users can insert own collections"
  ON user_collections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own collections"
  ON user_collections FOR DELETE
  USING (auth.uid() = user_id);

-- user_favorites
CREATE POLICY "users can select own favorites"
  ON user_favorites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users can insert own favorites"
  ON user_favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own favorites"
  ON user_favorites FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own favorites"
  ON user_favorites FOR DELETE
  USING (auth.uid() = user_id);
