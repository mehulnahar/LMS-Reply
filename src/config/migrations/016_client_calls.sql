-- Migration 016: Client Calls (TLDV integration)
-- Stores synced TLDV meetings with AI analysis, Gmail thread matching, and draft storage

CREATE TABLE IF NOT EXISTS client_calls (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  meeting_name TEXT,
  duration FLOAT,
  call_date DATE,
  invitee_emails TEXT[],
  transcript TEXT,
  highlights JSONB,
  status TEXT DEFAULT 'prospect',
  -- status: hot_lead | no_show | delivery | prospect | lost | re_engaging
  analysis JSONB,
  -- { summary, promise, open_questions, signals, client_name, company, meeting_type }
  research JSONB,
  gmail_thread_id TEXT,
  gmail_thread_subject TEXT,
  gmail_email_count INTEGER DEFAULT 0,
  gmail_last_email_date DATE,
  reply_draft TEXT,
  fu1_draft TEXT,
  fu2_draft TEXT,
  fu3_draft TEXT,
  rebook_draft TEXT,
  rebook_fu1_draft TEXT,
  reply_sent_at TIMESTAMP,
  fu1_sent_at TIMESTAMP,
  fu2_sent_at TIMESTAMP,
  fu3_sent_at TIMESTAMP,
  analyzed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_calls_user_id_idx ON client_calls(user_id);
CREATE INDEX IF NOT EXISTS client_calls_status_idx ON client_calls(status);
CREATE INDEX IF NOT EXISTS client_calls_call_date_idx ON client_calls(call_date DESC);
