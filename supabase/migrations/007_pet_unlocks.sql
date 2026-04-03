-- ── NearU Pet Unlock System ───────────────────────────────────────────────────
-- Adds an unlocked_pets column to user_pets so each user tracks which pet
-- types they've purchased.  Safe to run multiple times.

ALTER TABLE user_pets
  ADD COLUMN IF NOT EXISTS unlocked_pets TEXT[] NOT NULL DEFAULT '{dog}';

-- Ensure an UPDATE policy exists (service role bypasses RLS, but good hygiene)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_pets' AND policyname = 'Users update own pet'
  ) THEN
    CREATE POLICY "Users update own pet" ON user_pets
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END;
$$;
