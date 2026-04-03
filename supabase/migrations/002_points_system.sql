-- ── NearU Points & Rewards System ────────────────────────────────────────────
-- Run this SQL in the Supabase dashboard → SQL Editor.
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE).

-- ── Tables ────────────────────────────────────────────────────────────────────

-- user_points: current balance and lifetime total per user
CREATE TABLE IF NOT EXISTS user_points (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_points      INTEGER NOT NULL DEFAULT 0 CHECK (current_points >= 0),
  total_points_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_points_earned >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- point_events: immutable ledger of every point-earning / point-spending action
CREATE TABLE IF NOT EXISTS point_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,   -- e.g. 'save_item', 'share_homepage'
  points     INTEGER     NOT NULL,   -- positive = earned, negative = spent
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS point_events_user_id_idx   ON point_events(user_id);
CREATE INDEX IF NOT EXISTS point_events_user_type_idx ON point_events(user_id, type);
CREATE INDEX IF NOT EXISTS point_events_created_idx   ON point_events(user_id, created_at DESC);

-- user_themes: which themes are unlocked and which is currently active
CREATE TABLE IF NOT EXISTS user_themes (
  user_id         UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unlocked_themes TEXT[]  NOT NULL DEFAULT '{default}',
  active_theme    TEXT    NOT NULL DEFAULT 'default',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Atomic increment/decrement helper ─────────────────────────────────────────
-- Called by API routes to safely update point balances without race conditions.

CREATE OR REPLACE FUNCTION increment_user_points(p_user_id UUID, p_delta INTEGER)
RETURNS TABLE(current_points INTEGER, total_points_earned INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INTEGER;
  v_total   INTEGER;
BEGIN
  INSERT INTO user_points (user_id, current_points, total_points_earned, updated_at)
  VALUES (
    p_user_id,
    GREATEST(0, p_delta),
    GREATEST(0, p_delta),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    current_points      = GREATEST(0, user_points.current_points + p_delta),
    total_points_earned = CASE
      WHEN p_delta > 0 THEN user_points.total_points_earned + p_delta
      ELSE user_points.total_points_earned
    END,
    updated_at = now()
  RETURNING user_points.current_points, user_points.total_points_earned
  INTO v_current, v_total;

  RETURN QUERY SELECT v_current, v_total;
END;
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Service role (used by API routes) bypasses RLS automatically.
-- These policies allow authenticated users to read their own data via the
-- Supabase client with the anon key.

ALTER TABLE user_points  ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_themes  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_points'  AND policyname='Users read own points') THEN
    CREATE POLICY "Users read own points"       ON user_points  FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='point_events' AND policyname='Users read own events') THEN
    CREATE POLICY "Users read own events"       ON point_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_themes'  AND policyname='Users read own themes') THEN
    CREATE POLICY "Users read own themes"       ON user_themes  FOR SELECT USING (auth.uid() = user_id);
  END IF;
END;
$$;
