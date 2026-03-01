-- ============================================================
-- Migration 002: Email Accounts, Emails, Jobs, Replies
-- Phases 2-5: CONF-02, INBOX-01, JOB-01, REPLY-01
-- ============================================================

-- ============================================================
-- Gmail accounts connected via OAuth
-- ============================================================
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  sync_frequency INTEGER NOT NULL DEFAULT 5,  -- minutes: 1, 5, 15
  last_sync_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'connected',  -- connected, error, disconnected
  error_message TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#4F46E5',  -- hex color for UI badge
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts (user_id);

-- ============================================================
-- Emails pulled from Gmail (UNREAD only)
-- ============================================================
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  gmail_id VARCHAR(255) NOT NULL,         -- Gmail message ID
  thread_id VARCHAR(255),                  -- Gmail thread ID for grouping
  from_email VARCHAR(254) NOT NULL,
  from_name VARCHAR(255),
  subject TEXT NOT NULL,
  snippet TEXT,                             -- Gmail snippet (preview text)
  body_text TEXT,                           -- Plain text body
  body_html TEXT,                           -- HTML body (for display)
  received_at TIMESTAMPTZ NOT NULL,
  is_unread BOOLEAN NOT NULL DEFAULT true,  -- Tracks Gmail unread state
  status VARCHAR(20) NOT NULL DEFAULT 'new', -- new, replied, proposal_sent, won, lost, ignored
  lead_score INTEGER,                       -- 0-100 score
  has_phone BOOLEAN DEFAULT false,
  has_urgency BOOLEAN DEFAULT false,
  is_ooo BOOLEAN DEFAULT false,
  is_redirect BOOLEAN DEFAULT false,
  extracted_phone VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, gmail_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_user ON emails (user_id);
CREATE INDEX IF NOT EXISTS idx_emails_account ON emails (account_id);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails (user_id, status);
CREATE INDEX IF NOT EXISTS idx_emails_unread ON emails (user_id, is_unread);
CREATE INDEX IF NOT EXISTS idx_emails_received ON emails (received_at DESC);

-- ============================================================
-- Matched jobs from LeadHack API
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  leadhack_id VARCHAR(255),               -- ID from leadhack.info
  client_first_name VARCHAR(255),
  client_last_name VARCHAR(255),
  client_email VARCHAR(254),
  email_subject TEXT,
  job_heading TEXT,
  job_description TEXT,
  match_status VARCHAR(20) NOT NULL DEFAULT 'matched', -- matched, no_match, error
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_email ON jobs (email_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs (user_id);

-- ============================================================
-- Generated replies (AI drafts)
-- ============================================================
CREATE TABLE IF NOT EXISTS replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  tone VARCHAR(20) NOT NULL DEFAULT 'professional', -- professional, friendly, concise, detailed
  intent VARCHAR(50),                        -- detected intent category
  generated_text TEXT NOT NULL,
  edited_text TEXT,                           -- User-edited version (null if unedited)
  was_copied BOOLEAN DEFAULT false,          -- Track if user copied it
  model VARCHAR(50),                         -- e.g. claude-sonnet-4-20250514
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replies_email ON replies (email_id);
CREATE INDEX IF NOT EXISTS idx_replies_user ON replies (user_id);
