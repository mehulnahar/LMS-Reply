-- Migration 015: Call Prep overrides table
-- Stores user edits for call preparation data (overrides auto-enriched values)

CREATE TABLE IF NOT EXISTS call_prep (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id VARCHAR(1024) NOT NULL,
  client_name VARCHAR(255),
  client_email VARCHAR(255),
  lead_score INTEGER,
  country VARCHAR(100),
  job_heading TEXT,
  job_description TEXT,
  what_they_said TEXT,
  our_last_reply TEXT,
  notes TEXT,
  has_phone BOOLEAN,
  has_urgency BOOLEAN,
  hot_signal_flagged BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_call_prep_user_event
  ON call_prep (user_id, google_event_id);
