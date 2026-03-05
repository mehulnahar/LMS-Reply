-- Migration 007: Post-Generation Validation Columns
-- Phase 13: Post-Generation Validation
-- Requirements: VALIDATE-01, VALIDATE-02, VALIDATE-04, QUALITY-04

ALTER TABLE replies ADD COLUMN IF NOT EXISTS banned_phrases_caught  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS has_next_step          BOOLEAN;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS proposal_gate_fired    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS specificity_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS specificity_flag       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS validation_warnings    TEXT[];

CREATE INDEX IF NOT EXISTS idx_replies_banned_phrases
  ON replies (banned_phrases_caught)
  WHERE banned_phrases_caught > 0;

CREATE INDEX IF NOT EXISTS idx_replies_proposal_gate
  ON replies (proposal_gate_fired)
  WHERE proposal_gate_fired = true;
