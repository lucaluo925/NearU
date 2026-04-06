-- ── NearU / Davis Explorer: Storage migration v2
-- Run this in the Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS / DO $$ guards throughout).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. user_interests
--    Stores onboarding selections (cuisines, vibes, prices, categories).
--    Replaces aggie-map-interests localStorage for authenticated users.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_interests (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cuisines    text[]      NOT NULL DEFAULT '{}',
  vibes       text[]      NOT NULL DEFAULT '{}',
  prices      text[]      NOT NULL DEFAULT '{}',
  categories  text[]      NOT NULL DEFAULT '{}',
  shown       boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_interests' AND policyname = 'interests_self_select'
  ) THEN
    CREATE POLICY "interests_self_select" ON user_interests
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_interests' AND policyname = 'interests_self_insert'
  ) THEN
    CREATE POLICY "interests_self_insert" ON user_interests
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_interests' AND policyname = 'interests_self_update'
  ) THEN
    CREATE POLICY "interests_self_update" ON user_interests
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. user_collections
--    Tracks custom collection names so empty collections are preserved.
--    The three default collections (Want to try / This week / Date ideas)
--    are synthetic — not stored here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_collections (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);

ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_collections' AND policyname = 'collections_self_select'
  ) THEN
    CREATE POLICY "collections_self_select" ON user_collections
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_collections' AND policyname = 'collections_self_insert'
  ) THEN
    CREATE POLICY "collections_self_insert" ON user_collections
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_collections' AND policyname = 'collections_self_delete'
  ) THEN
    CREATE POLICY "collections_self_delete" ON user_collections
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. user_favorites
--    Stores saved items grouped by collection name.
--    Replaces aggie-map-favorites-v2 localStorage for authenticated users.
--    A single item can only be in one collection per user (UNIQUE constraint).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_favorites (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id         text        NOT NULL,
  collection_name text        NOT NULL DEFAULT 'Want to try',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS user_favorites_user_idx ON user_favorites (user_id);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_favorites' AND policyname = 'favorites_self_select'
  ) THEN
    CREATE POLICY "favorites_self_select" ON user_favorites
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_favorites' AND policyname = 'favorites_self_insert'
  ) THEN
    CREATE POLICY "favorites_self_insert" ON user_favorites
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_favorites' AND policyname = 'favorites_self_update'
  ) THEN
    CREATE POLICY "favorites_self_update" ON user_favorites
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_favorites' AND policyname = 'favorites_self_delete'
  ) THEN
    CREATE POLICY "favorites_self_delete" ON user_favorites
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;
