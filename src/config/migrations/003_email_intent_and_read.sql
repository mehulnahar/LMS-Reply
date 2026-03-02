-- ============================================================
-- Migration 003: Add intent + summary to emails, enable auto-status
-- ============================================================

-- Store AI-detected intent directly on the email (was only on replies before)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS intent VARCHAR(50);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS summary TEXT;

-- Index for filtering by intent
CREATE INDEX IF NOT EXISTS idx_emails_intent ON emails (intent);
