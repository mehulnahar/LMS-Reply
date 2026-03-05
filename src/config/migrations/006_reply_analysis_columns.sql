-- Migration 006: Prompt Routing + Pre-Generation Pipeline columns
-- Phase 12: Prompt Routing + Pre-Generation Pipeline
-- Requirements: PROMPT-02, PREFETCH-05

ALTER TABLE replies ADD COLUMN IF NOT EXISTS prompt_type_used    prompt_type_enum;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS job_analysis_block  TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS link_analysis_block TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS prefetch_warnings   TEXT[];

CREATE INDEX IF NOT EXISTS idx_replies_prompt_type
  ON replies (prompt_type_used)
  WHERE prompt_type_used IS NOT NULL;
