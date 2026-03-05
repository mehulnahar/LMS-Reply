-- ============================================================
-- Migration 005: v2.0 Prompt Foundation Schema
-- Phase 11: DB + Prompt Foundation
-- Requirements: DB-01, DB-02, DB-03, DB-04, DB-05, PROMPT-01
-- ============================================================

-- ============================================================
-- Custom ENUM Types for v2.0
-- ============================================================

DO $$ BEGIN
  CREATE TYPE prompt_type_enum AS ENUM (
    'EMAIL_REPLY_V2',
    'THREAD_CONTINUATION_V1',
    'FOLLOW_UP_V2',
    'PROPOSAL_V4',
    'LOVABLE_MOCKUP_V1'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE objection_type_enum AS ENUM (
    'NONE', 'PRICING', 'AGENCY', 'COMPARISON', 'TECHNICAL_Q', 'ALREADY_HIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE scope_framing_enum AS ENUM (
    'HOURS', 'PHASES', 'FIXED', 'UNKNOWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_length_enum AS ENUM (
    'SHORT', 'MEDIUM', 'LONG'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE thread_stage_enum AS ENUM (
    'DISCOVERY', 'CALL_BOOKING', 'POST_CALL', 'NEGOTIATION', 'CLOSING', 'STALLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE banned_phrase_category_enum AS ENUM (
    'CORPORATE', 'ENTHUSIASM', 'FILLER', 'FOLLOWUP', 'ASSUMPTION', 'PASSIVE', 'SELF_FOCUSED', 'GUILT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE next_step_status_enum AS ENUM (
    'PENDING', 'COMPLETED', 'OVERDUE', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- prompt_templates table (CONF-05 + PROMPT-01)
-- Stores editable AI prompt templates — both legacy category
-- templates and v2.0 system prompts.
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_templates (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  content    TEXT NOT NULL,
  category   VARCHAR(50) NOT NULL DEFAULT 'reply',  -- legacy: reply, proposal, scoring
  prompt_type prompt_type_enum,                      -- v2.0: typed system prompts
  version    INTEGER NOT NULL DEFAULT 1,
  is_system  BOOLEAN NOT NULL DEFAULT false,         -- true = pre-seeded, shows in UI but locked from delete
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_user ON prompt_templates (user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_type ON prompt_templates (user_id, prompt_type) WHERE prompt_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates (user_id, category);

-- ============================================================
-- DB-01: Extend jobs table with all v2.0 prompt system fields
-- Note: The "leads" in the spec = the "jobs" table in this codebase
-- ============================================================

-- Job context & analysis
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_description_raw      TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis_json        JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS link_analysis_json       JSONB;

-- Objection & follow-up tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS objection_detected       objection_type_enum NOT NULL DEFAULT 'NONE';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS follow_up_count          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS follow_up_1_angle        VARCHAR(200);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS follow_up_2_angle        VARCHAR(200);

-- Agency & scope signals
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS agency_sensitive         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_scope_framing     scope_framing_enum NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_message_length    message_length_enum;

-- Re-engagement & dormant state
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS re_engagement_strategy   TEXT;

-- Mockup tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mockup_sent              BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mockup_lovable_prompt    TEXT;

-- Post-call tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS post_call_recap_sent     BOOLEAN NOT NULL DEFAULT false;

-- Thread tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thread_stage             thread_stage_enum;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thread_depth             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thread_client_messages   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_prompt_used         prompt_type_enum;

-- Next step tracking (summary on lead record)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_step_ours           TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_step_theirs         TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_step_followup_date  DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_step_approach       VARCHAR(100);

-- CC contact tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cc_contacts              JSONB;

-- Indexes for new fields
CREATE INDEX IF NOT EXISTS idx_jobs_thread_stage ON jobs (thread_stage) WHERE thread_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_follow_up_count ON jobs (follow_up_count);
CREATE INDEX IF NOT EXISTS idx_jobs_objection ON jobs (objection_detected);

-- ============================================================
-- DB-02: banned_phrases table
-- Pre-populated via seed script with 40+ phrases
-- ============================================================
CREATE TABLE IF NOT EXISTS banned_phrases (
  id                    SERIAL PRIMARY KEY,
  phrase                VARCHAR(200) NOT NULL UNIQUE,
  category              banned_phrase_category_enum NOT NULL,
  replacement_suggestion VARCHAR(200),
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banned_phrases_category ON banned_phrases (category);
CREATE INDEX IF NOT EXISTS idx_banned_phrases_active ON banned_phrases (active);

-- ============================================================
-- DB-03: counter_moves table
-- Pre-populated via seed script with 10 objection counter-moves
-- ============================================================
CREATE TABLE IF NOT EXISTS counter_moves (
  id                    SERIAL PRIMARY KEY,
  objection_type        objection_type_enum NOT NULL,
  objection_pattern     VARCHAR(200) NOT NULL,
  counter_move_name     VARCHAR(100) NOT NULL,
  counter_move_template TEXT NOT NULL,
  max_words             INTEGER NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counter_moves_objection ON counter_moves (objection_type);

-- ============================================================
-- DB-04: reply_generations analytics table
-- Tracks every AI reply generation for analytics + debugging
-- ============================================================
CREATE TABLE IF NOT EXISTS reply_generations (
  id                    SERIAL PRIMARY KEY,
  lead_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  prompt_used           prompt_type_enum NOT NULL,
  thread_stage_detected thread_stage_enum,
  thread_depth_at_gen   INTEGER,
  variant_selected      VARCHAR(50),
  was_edited            BOOLEAN NOT NULL DEFAULT false,
  was_sent              BOOLEAN NOT NULL DEFAULT false,
  had_next_step         BOOLEAN NOT NULL DEFAULT false,
  banned_phrases_caught INTEGER NOT NULL DEFAULT 0,
  word_count            INTEGER,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reply_gen_lead ON reply_generations (lead_id);
CREATE INDEX IF NOT EXISTS idx_reply_gen_prompt ON reply_generations (prompt_used);
CREATE INDEX IF NOT EXISTS idx_reply_gen_generated_at ON reply_generations (generated_at DESC);

-- ============================================================
-- DB-05: next_steps tracking table
-- Stores internal next-step summary after every thread reply
-- ============================================================
CREATE TABLE IF NOT EXISTS next_steps (
  id                    SERIAL PRIMARY KEY,
  lead_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reply_generation_id   INTEGER REFERENCES reply_generations(id) ON DELETE SET NULL,
  our_action            TEXT NOT NULL,
  our_deadline          DATE,
  their_action          TEXT,
  followup_date         DATE,
  followup_approach     VARCHAR(100),
  status                next_step_status_enum NOT NULL DEFAULT 'PENDING',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_next_steps_lead ON next_steps (lead_id);
CREATE INDEX IF NOT EXISTS idx_next_steps_status ON next_steps (status);
CREATE INDEX IF NOT EXISTS idx_next_steps_followup ON next_steps (followup_date) WHERE followup_date IS NOT NULL;
