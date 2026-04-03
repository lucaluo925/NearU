-- ── NearU Pet System ──────────────────────────────────────────────────────────
-- Run this in the Supabase dashboard → SQL Editor.
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE).

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_pets (
  user_id        UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_type       TEXT        NOT NULL DEFAULT 'dog',
  xp             INTEGER     NOT NULL DEFAULT 0 CHECK (xp >= 0),
  last_action_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Atomic XP increment ───────────────────────────────────────────────────────
-- Creates a pet row on first call (default dog, 0 xp) and atomically adds XP.

CREATE OR REPLACE FUNCTION add_pet_xp(p_user_id UUID, p_xp INTEGER)
RETURNS TABLE(xp INTEGER, last_action_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_xp INTEGER;
  v_ts TIMESTAMPTZ;
BEGIN
  INSERT INTO user_pets (user_id, pet_type, xp, last_action_at, updated_at)
  VALUES (p_user_id, 'dog', GREATEST(0, p_xp), now(), now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    xp             = user_pets.xp + p_xp,
    last_action_at = now(),
    updated_at     = now()
  RETURNING user_pets.xp, user_pets.last_action_at
  INTO v_xp, v_ts;

  RETURN QUERY SELECT v_xp, v_ts;
END;
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE user_pets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_pets' AND policyname = 'Users read own pet'
  ) THEN
    CREATE POLICY "Users read own pet" ON user_pets FOR SELECT USING (auth.uid() = user_id);
  END IF;
END;
$$;
