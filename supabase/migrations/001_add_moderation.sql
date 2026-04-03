-- ============================================================
-- Aggie Map — Moderation System Migration
-- Run this ONCE in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Add moderation columns to items table
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS status            text        NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS review_notes      text,
  ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by       text,
  ADD COLUMN IF NOT EXISTS risk_score        numeric,
  ADD COLUMN IF NOT EXISTS moderation_reason text;

-- All existing items (ingested data) are trusted → approved
UPDATE items SET status = 'approved' WHERE deleted_at IS NULL;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_items_status     ON items(status)           WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_status_cat ON items(status, category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_status_src ON items(status, source_type);

-- ============================================================
-- Status values:
--   approved  → visible publicly (all ingested items)
--   pending   → user submissions awaiting review
--   rejected  → hidden, not shown anywhere
--   flagged   → needs urgent review (auto-flagged by AI)
-- ============================================================
