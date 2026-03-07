-- 010: User email aliases
-- Stores outreach email IDs owned by the user (e.g. ashish@elevatehub.link).
-- These addresses are filtered out of CC contact detection during Thread Continuation
-- so the AI doesn't treat the user's own forwarding addresses as third-party recipients.

CREATE TABLE IF NOT EXISTS user_email_aliases (
  id           SERIAL       PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_email  VARCHAR(255) NOT NULL,
  label        VARCHAR(100),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(user_id, alias_email)
);

INSERT INTO migrations (name) VALUES ('010_email_aliases') ON CONFLICT DO NOTHING;
