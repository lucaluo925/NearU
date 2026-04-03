-- ============================================================
-- Aggie Map — Ingestion Logs Migration
-- Run this ONCE in: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS ingestion_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          timestamptz NOT NULL DEFAULT now(),
  source          text        NOT NULL,          -- e.g. 'ucd-website', 'ucd-library', 'ucd-arboretum'
  inserted_count  int         NOT NULL DEFAULT 0,
  updated_count   int         NOT NULL DEFAULT 0,
  skipped_count   int         NOT NULL DEFAULT 0,
  failed_count    int         NOT NULL DEFAULT 0,
  total_parsed    int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'success', -- 'success' | 'partial' | 'failed'
  error_message   text                                    -- null when status = 'success'
);

-- Fast DESC lookup for the admin dashboard
CREATE INDEX IF NOT EXISTS idx_ingestion_logs_run_at ON ingestion_logs(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_logs_source ON ingestion_logs(source, run_at DESC);

-- ============================================================
-- status values:
--   success → failed_count = 0
--   partial → failed_count > 0 but some rows succeeded
--   failed  → everything failed (zero inserted+updated, or unhandled exception)
-- ============================================================
