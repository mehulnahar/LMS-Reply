-- Migration 008: Kill Switch tracking + counter_moves seed
-- Phase 14: Objection Handling + Kill Switch
-- Requirements: OBJECTION-06 (kill switch), OBJECTION-01/02/03/04/05 (counter_moves seed)
-- Date: 2026-03-05
--
-- Adds kill_switch_at to jobs table to record when follow-up sequence was capped.
-- Seeds counter_moves table with baseline data (idempotent — WHERE NOT EXISTS per row).
-- jobs.match_status will be set to 'dormant' by application code (VARCHAR field, no constraint change needed).
--
-- Note: counter_moves has no UNIQUE constraint on counter_move_name (only a PRIMARY KEY on id).
-- ON CONFLICT DO NOTHING cannot be used without a UNIQUE constraint.
-- Instead, each INSERT uses WHERE NOT EXISTS to check for duplicates by counter_move_name.
-- This makes the migration safe to re-run.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS kill_switch_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_kill_switch
  ON jobs (kill_switch_at)
  WHERE kill_switch_at IS NOT NULL;

-- Seed counter_moves with all 10 baseline objection counter-moves
-- Source: src/config/seeds/seed_v2_foundation.js COUNTER_MOVES array
-- WHERE NOT EXISTS: safe to re-run, skips rows that already exist by counter_move_name

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'PRICING'::objection_type_enum, 'How much? / What''s the cost? / What are your rates?', 'Pricing — Deflect to Call',
  'Pricing depends on scope — would tomorrow at 11 AM your time work to map this out? I can give you a firm number right after.',
  40
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Pricing — Deflect to Call');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'PRICING'::objection_type_enum, '$X is too expensive / Outside our budget / Can you do it cheaper?', 'Price Too High — Ask Their Budget',
  'What budget range works for your team?',
  15
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Price Too High — Ask Their Budget');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'AGENCY'::objection_type_enum, 'No agencies / Looking for an individual / Freelancer only / Solo developer', 'Agency Objection — Transparency + Direct Contact',
  'To be upfront — we''re an agency, but for this project you''d work directly with [Name], a dedicated [role]. Same person on every call, direct Slack access.',
  40
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Agency Objection — Transparency + Direct Contact');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'COMPARISON'::objection_type_enum, 'We''re comparing options / Found someone cheaper / Got other proposals', 'Comparison — Differentiate on Risk',
  'Makes sense. One thing worth checking: does the other option include [specific differentiator]? That''s usually where the real cost difference shows up. Happy to walk through our approach — would tomorrow at 11 AM your time work?',
  50
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Comparison — Differentiate on Risk');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'ALREADY_HIRED'::objection_type_enum, 'We found someone else / Already resolved / Already hired someone', 'Already Hired — Graceful Close',
  'Glad you found a fit. If anything changes down the line, the door''s open.',
  20
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Already Hired — Graceful Close');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'NONE'::objection_type_enum, 'I need to think about it / Not sure yet / Let me consider', 'Needs Time — Add Value, No Push',
  '[Add one project-specific insight here]. No rush — happy to answer any questions you have. [NO call CTA in this reply — let the Day 3 follow-up carry it]',
  60
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Needs Time — Add Value, No Push');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'NONE'::objection_type_enum, 'Can you send a proposal? / What would this cost? / Send me a quote', 'Proposal Request — Scoping Call First',
  'Absolutely. To make sure it''s tailored to your exact needs — would tomorrow at 11 AM your time work for a quick 20-minute scoping call? I''ll have the proposal to you within 24 hours after.',
  50
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Proposal Request — Scoping Call First');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'TECHNICAL_Q'::objection_type_enum, 'Client asks a specific technical question about framework / API / architecture', 'Technical Question — Answer + Curiosity + Call',
  '[Answer in 1-2 sentences]. Quick question: [curiosity question about their specific use case]? That''ll shape the approach. Would tomorrow at 11 AM your time work to dig into the specifics?',
  80
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Technical Question — Answer + Curiosity + Call');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'NONE'::objection_type_enum, 'Client gives their own scope/hours/phases breakdown', 'Scope Mirror — Match Their Framing',
  '[Mirror their framing exactly. If they think in hours, quote in hours. If phases, use phases. NEVER impose a different structure or add complexity they didn''t ask for.]',
  60
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Scope Mirror — Match Their Framing');

INSERT INTO counter_moves (objection_type, objection_pattern, counter_move_name, counter_move_template, max_words)
SELECT 'NONE'::objection_type_enum, 'I need to check with my team / partner / co-founder', 'Team Approval — Offer to Present Directly',
  'Happy to jump on a quick call with your team to walk through the approach. Often easier than forwarding emails.',
  40
WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = 'Team Approval — Offer to Present Directly');
