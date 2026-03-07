-- 011: Store the To: address each email was originally addressed to.
-- For forwarded outreach emails this captures the alias (e.g. janet@hypeit.ink).
-- Used to detect persona context (Janet vs Ashish) and drive persona-intro block.

ALTER TABLE emails ADD COLUMN IF NOT EXISTS to_email VARCHAR(255);

INSERT INTO migrations (name) VALUES ('011_email_to_address') ON CONFLICT DO NOTHING;
