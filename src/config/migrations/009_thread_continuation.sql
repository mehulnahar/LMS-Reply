-- Migration 009: Thread Continuation Engine Schema
-- Phase 15: THREAD-03, THREAD-04, THREAD-05, THREAD-07

-- THREAD-03: Client requested full proposal toggle (per-lead, persisted)
-- Drives proposalGate override in replies.js — default false = recap mode
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_requested_proposal BOOLEAN NOT NULL DEFAULT false;

-- THREAD-04: CC raw header stored at Gmail sync time
-- Parsed into jobs.cc_contacts JSONB at reply generation time
ALTER TABLE emails ADD COLUMN IF NOT EXISTS cc_raw TEXT;

-- THREAD-05: Stall type classification
DO $$ BEGIN
  CREATE TYPE stall_type_enum AS ENUM (
    'THINKING', 'PRICING_SILENCE', 'CALL_SILENCE', 'NO_COMMITMENT', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stall_type stall_type_enum;

-- THREAD-07: Email open tracking (manual-only path for Phase 15)
-- open_count on emails table (per individual email message, not per job)
-- hot_signal_flagged set when open_count >= 10
ALTER TABLE emails ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS hot_signal_flagged BOOLEAN NOT NULL DEFAULT false;

-- Sparse index for hot signal queries (only rows where true — keeps index small)
CREATE INDEX IF NOT EXISTS idx_emails_hot_signal
  ON emails (hot_signal_flagged) WHERE hot_signal_flagged = true;
