# Roadmap: LMS Reply (Upwork Proposal & Reply Cockpit)

## Overview

LMS Reply transforms incoming Upwork client emails into context-rich, AI-generated reply drafts by connecting Gmail inboxes to Upwork job data via leadhack.info and Claude AI. The build follows the natural data pipeline: foundation and auth first, then email ingestion, then job context enrichment, then AI reply generation, then intelligence layers (email parsing, Lovable prompts, lead scoring), then team access controls, and finally UI polish. Each phase delivers a testable, standalone capability. The user tests each module before the next is built.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Project scaffold, database schema, authentication, and encrypted settings store
- [ ] **Phase 2: Configuration UI** - Gmail OAuth, integration dashboard, prompt template editor, and sync settings
- [ ] **Phase 3: Email Inbox** - Gmail sync engine, unified inbox view, threading, and status labels
- [ ] **Phase 4: Job Context Matching** - Leadhack.info integration, auto-matching emails to jobs, local caching
- [ ] **Phase 5: AI Smart Reply Generator** - Claude-powered reply generation with intent detection and tone control
- [ ] **Phase 6: Email Intelligence** - Structured data extraction from email content (phone, OOO, redirects, names, times, urgency)
- [ ] **Phase 7: Lovable Prompt Generator** - Auto-detect visual jobs and generate Lovable-compatible UI prompts
- [ ] **Phase 8: Lead Scoring** - Auto-score leads from job and email signals, sort and filter inbox by score
- [ ] **Phase 9: Team & VA Access** - Owner creates VA accounts with per-module permissions and audit trail
- [ ] **Phase 10: UI Polish** - Dark/light theme, design quality pass, loading skeletons, responsive layout
- [ ] **Phase 11: DB + Prompt Foundation** - All v2.0 schema migrations deployed and all 5 prompt documents stored as editable, versioned templates
- [ ] **Phase 12: Prompt Routing + Pre-Generation Pipeline** - Every Generate Reply click auto-selects the correct prompt AND pre-fetches job context + analyzes client URLs before generating
- [ ] **Phase 13: Post-Generation Validation** - Every generated reply passes 4 quality gates (Proposal Gate, Banned Phrase Scanner, Word Count, Next-Step) plus 4 quality gates (Specificity, Angle Differentiation, Pricing Intelligence, Proof Quality)
- [ ] **Phase 14: Objection Handling + Kill Switch** - System detects client objections and routes to correct counter-move; follow-up sequence is capped at 2 with automatic DORMANT transition
- [ ] **Phase 15: Thread Continuation Engine** - Ongoing conversations are stage-aware, tone-shifting, post-call aware, and every reply ends with a tracked next step
- [x] **Phase 16: Lovable Mockup Generator** - System determines whether a mockup is appropriate and generates a complete, stage-aware Lovable prompt plus send message (completed 2026-03-05)
- [x] **Phase 17: UI Upgrades** - The reply editor surfaces all intelligence (analysis panel, prompt badge, variant selection, banned phrase highlights, word count, next-step warning) (completed 2026-03-06)
- [ ] **Phase 18: Prompt Quality Fixes** - AI replies use correct CTA timezone format, follow-ups generate from Ashish's POV, all reply types include greeting, cost suggestions for pricing questions, and company signature block
- [ ] **Phase 19: Inbox Workflow** - Re-activate lost/rejected leads, auto-route replied/lost emails to status tabs, and search inbox by email address

## Phase Details

### Phase 1: Foundation
**Goal**: Users can sign up, log in, and the application has a working database, encrypted credential storage, and a deployable frontend scaffold
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):
  1. User can sign up with email/password, log in, and session persists across browser refresh
  2. User can log out from any page and is redirected to login
  3. User can add/update/remove API keys (Anthropic, leadhack) and they are stored encrypted at rest (AES-256-GCM)
  4. Application deploys to Railway via GitHub Actions with frontend and backend services running
  5. Database schema is migrated with all core tables (users, email_accounts, emails, jobs, replies, leads, settings, audit_log)
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD

### Phase 2: Configuration UI
**Goal**: Users can connect Gmail accounts, manage integrations, configure AI prompt templates, and set sync preferences through a polished settings interface
**Depends on**: Phase 1
**Requirements**: CONF-02, CONF-03, CONF-04, CONF-05, CONF-06
**Success Criteria** (what must be TRUE):
  1. User can connect multiple Gmail accounts via OAuth and see them listed with connection status
  2. User can disconnect and reconnect a Gmail account when its OAuth token expires (re-auth flow)
  3. User can view an integration status dashboard showing connected/disconnected/error state for each service (Gmail accounts, Anthropic API, leadhack API)
  4. User can create, edit, and delete AI prompt templates that are stored in the database
  5. User can set email sync frequency (1min / 5min / 15min) per account
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Email Inbox
**Goal**: Users see a unified, threaded inbox of Upwork-related emails from all connected Gmail accounts with real-time sync status and lead tracking labels
**Depends on**: Phase 2
**Requirements**: INBOX-01, INBOX-02, INBOX-03, INBOX-04, INBOX-05, INBOX-06, INBOX-07, INBOX-08
**Success Criteria** (what must be TRUE):
  1. Inbox displays only emails with "Upwork" in the subject line, pulled from all connected Gmail accounts into a single unified view
  2. Opening the app never marks emails as read in Gmail (read-only access verified)
  3. Emails are grouped by conversation thread (Gmail threadId) and each shows sender name, email address, subject, and preview snippet
  4. Each email displays a color-coded time-since-received indicator (green under 1hr, yellow 1-4hr, red over 4hr)
  5. User can see "Last synced: X min ago" status, trigger a manual refresh, and assign lead status labels (New / Replied / Proposal Sent / Won / Lost)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Job Context Matching
**Goal**: Every Upwork email is automatically matched to its job posting via leadhack.info, with the full job description displayed alongside the email
**Depends on**: Phase 3
**Requirements**: JOB-01, JOB-02, JOB-03, JOB-04, JOB-05
**Success Criteria** (what must be TRUE):
  1. When an email arrives, the system automatically queries leadhack.info using email_id and email_subject and displays the matched job context (heading, full description, client name) alongside the email
  2. Each email shows a match status indicator: Matched or No Match
  3. Matched job data is cached locally in the database so repeat views do not re-call the leadhack API
  4. When leadhack.info is unreachable, the system shows cached data if available or an "unavailable" state without crashing or blocking the inbox
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: AI Smart Reply Generator
**Goal**: Users can generate context-aware AI reply drafts with one click, using full job context and email content, with intent detection, tone selection, and clipboard copy
**Depends on**: Phase 3, Phase 4
**Requirements**: REPLY-01, REPLY-02, REPLY-03, REPLY-04, REPLY-05, REPLY-06, REPLY-07
**Success Criteria** (what must be TRUE):
  1. User can click one button to generate an AI reply that incorporates both the email content and the matched job description
  2. AI classifies the email intent (from 15 categories: Pricing Inquiry, Specific Requirements, Call Acceptance, etc.) and generates a reply strategy appropriate to that intent
  3. User can select a tone (Professional / Friendly / Concise / Detailed) before generating, and the AI auto-matches reply length to the client's communication style
  4. Generated reply appears in an editable text area where the user can review and modify it before copying
  5. User can copy the final reply to clipboard with proper spacing and indentation ready for Gmail paste, and sees a loading indicator with progress during AI generation
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Email Intelligence
**Goal**: The system automatically extracts structured data from email content -- phone numbers, OOO dates, redirect addresses, professional titles, time expressions, and urgency signals -- to enrich the reply workflow
**Depends on**: Phase 3
**Requirements**: INTEL-01, INTEL-02, INTEL-03, INTEL-04, INTEL-05, INTEL-06
**Success Criteria** (what must be TRUE):
  1. System extracts phone numbers from email signatures and flags emails as "Call Requested" when paired with call-related language
  2. System detects OOO auto-replies in English, German, Italian, French, and Spanish, and extracts the return date
  3. System detects email redirect instructions ("use this email instead") and extracts the alternative contact address
  4. System parses professional name titles (Dr., Dr. med., Prof., Ing.) to extract the correct first name without addressing someone as "Med" or "Prof"
  5. System detects time expressions ("tomorrow", "next Monday", "1230") and converts them to specific date/time with timezone, and detects urgent/time-sensitive jobs ("fix", "broken", "urgent", "ASAP") for prioritization
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Lovable Prompt Generator
**Goal**: When a job involves UI/visual work, the system auto-generates a Lovable-compatible prompt so the user can quickly create a mockup to attach with their reply
**Depends on**: Phase 4, Phase 5
**Requirements**: LOV-01, LOV-02, LOV-03, LOV-04, LOV-05
**Success Criteria** (what must be TRUE):
  1. System automatically detects when a matched job involves UI/visual work (website, app, dashboard, landing page, storefront)
  2. When detected, a Lovable-compatible prompt is auto-generated based on the specific job description and displayed in a dedicated section with a visual indicator
  3. User can copy the Lovable prompt to clipboard with one click
  4. The Lovable prompt section is completely hidden for non-visual jobs (data entry, bookkeeping, etc.)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Lead Scoring
**Goal**: Every lead is automatically scored based on job and email signals, with scores visible in the inbox for sorting and filtering
**Depends on**: Phase 3, Phase 4, Phase 6
**Requirements**: SCORE-01, SCORE-02, SCORE-03, SCORE-04, SCORE-05
**Success Criteria** (what must be TRUE):
  1. System auto-scores leads based on job description analysis (skills match, scope, budget signals) and email signals (domain type, response quality, phone presence, urgency, forward indicators)
  2. Lead score displays as a color-coded indicator in the inbox (green = high, yellow = medium, red = low)
  3. User can sort the inbox by lead score (highest first) and filter by score range
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

### Phase 9: Team & VA Access
**Goal**: Owner can create VA accounts with granular per-module permissions, and all VA actions are logged for accountability
**Depends on**: Phase 1, Phase 5
**Requirements**: AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. Owner can create VA accounts with email/password and assign a custom role
  2. Owner can define per-module access for each VA role (view only, draft, full access) and VAs are restricted accordingly
  3. All VA actions are logged with timestamp and user identity, viewable by the owner as an audit trail
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

### Phase 10: UI Polish
**Goal**: The application has a polished, professional look with dark/light theming, loading skeletons, and responsive layout
**Depends on**: Phase 3, Phase 5
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. User can toggle between dark and light themes, and the preference persists across sessions
  2. The application has a minimalist, polished, professional design that does not look like a generic template
  3. Loading skeleton states appear for the inbox, job context panel, and AI generation areas while data is loading
  4. Layout is desktop-first and remains functional on tablet screen sizes
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD

---

## v2.0 — Full Pipeline Upgrade (Phases 11-17)

### Phase 11: DB + Prompt Foundation
**Goal**: All v2.0 database schema changes are deployed (4 new tables + leads table extended) and all 5 prompt documents are stored as editable, versioned templates in the database — the foundation every downstream phase depends on
**Depends on**: Phase 1 (database infrastructure)
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05, PROMPT-01
**Success Criteria** (what must be TRUE):
  1. (Positive) All 5 new/extended schema objects are present in production: leads table has every v2.0 column (job_description_raw, job_analysis_json, link_analysis_json, objection_detected, follow_up_count, follow_up_1_angle, follow_up_2_angle, agency_sensitive, client_scope_framing, client_message_length, re_engagement_strategy, mockup_sent, mockup_lovable_prompt, post_call_recap_sent, thread_stage, thread_depth, thread_client_messages, last_prompt_used, next_step_ours, next_step_theirs, next_step_followup_date, next_step_approach, cc_contacts); all 4 new tables (banned_phrases, counter_moves, reply_generations, next_steps) exist with correct columns, types, and foreign keys
  2. (Positive) banned_phrases table is pre-populated with 40+ phrases across all 8 categories (CORPORATE, ENTHUSIASM, FILLER, FOLLOWUP, ASSUMPTION, PASSIVE, SELF_FOCUSED, GUILT); counter_moves table is pre-populated with all 10 counter-move templates with correct max_words values
  3. (Positive) All 5 prompt documents (Proposal V4, Reply V2, Follow-Up V2, Thread Continuation V1, Lovable Mockup V1) are stored in the prompt_templates table with version numbers, correct prompt_type enum values, and full template text; they are retrievable via the Settings UI prompt editor
  4. (Positive) Schema migrations are idempotent — running the migration script twice does not error or duplicate data; rollback scripts exist and work
  5. (Negative) Inserting a row into reply_generations with an invalid lead_id (non-existent FK) raises a foreign key constraint error, not a silent failure
  6. (Negative) Inserting a banned_phrase row with a category value not in the enum (e.g. "RANDOM") is rejected by the database with a constraint error
**Test mandate**:
  - Positive: Run migration on a clean schema; verify all table/column existence with `\d` queries; verify seed counts (banned_phrases >= 40, counter_moves >= 10, prompt_templates = 5)
  - Positive: Query each prompt template by prompt_type enum value and verify non-empty template text is returned
  - Negative: Attempt FK violation on reply_generations; attempt invalid enum insert on banned_phrases; verify both error at DB level, not application level
  - Edge case: Run migration on a database that already has some columns (partial migration); verify it completes without dropping existing data
**Plans**: TBD

### Phase 12: Prompt Routing + Pre-Generation Pipeline
**Goal**: Every "Generate Reply" click auto-selects the correct prompt based on conversation context AND pre-fetches the full job description and analyzes any client URLs before generating — so the AI always has complete context
**Depends on**: Phase 11
**Requirements**: PROMPT-02, PROMPT-03, PROMPT-04, PREFETCH-01, PREFETCH-02, PREFETCH-03, PREFETCH-04, PREFETCH-05
**Success Criteria** (what must be TRUE):
  1. (Positive) Prompt routing selects the correct template in all 6 switching scenarios: first client reply → Reply V2; thread with 2+ exchanges → Thread Continuation V1; client silent 3+ days with no reply → Follow-Up V2; "Generate Proposal" action → Proposal V4; "Generate Mockup" action → Lovable Mockup V1; STOP classification → no output, suppressed with explanation shown to user
  2. (Positive) Pre-generation pipeline always fires before AI call: if job description is not cached on the email record, system fetches from LeadHack via POST /getJobDetails and caches it before proceeding; generation does not start until job context is confirmed present
  3. (Positive) URL extraction finds all http/https URLs in both the job description and all email thread messages; extracted URLs are stored as JSON on the lead record; link analysis fetches each URL and stores findings (load speed, mobile UX, tech stack, SEO gaps) as structured JSON with a best_finding_for_reply field
  4. (Positive) The best link finding is injected into the AI prompt context; generated output includes an internal [JOB ANALYSIS] block and [LINK ANALYSIS] block stored on the reply record; these blocks are NOT included when user copies to clipboard
  5. (Positive) Reply editor shows a badge "Using: [Prompt Name]" and user can override the auto-selected prompt via a dropdown; the overridden prompt is used for the next generation and recorded on the reply_generations record
  6. (Negative) If LeadHack is unreachable during the pre-fetch step, generation proceeds with a warning "Job context unavailable — using email content only"; the system does not block or crash; cached data is used if available
**Test mandate**:
  - Positive: Create test leads representing each routing scenario; trigger generation; verify correct prompt_used recorded on reply_generations table for each
  - Positive: Test with an email that has no cached job description; verify LeadHack fetch fires and result is cached before generation completes
  - Positive: Test URL extraction on a job description containing 2 URLs and an email thread containing 1 URL; verify all 3 are stored in link_analysis_json; verify best_finding_for_reply is non-empty
  - Negative: Mock LeadHack to return a 500 error; verify generation still proceeds with warning, not hard error
  - Negative: Test with a job description containing no URLs and emails with no URLs; verify link_analysis_json is empty array, not null/undefined; verify generation still completes
  - Edge case: Test STOP classification scenario; verify no AI call is made and no reply is generated; verify user sees explanation, not blank reply area
**Plans**: 4 plans

Plans:
- [ ] 12-01-PLAN.md — Migration 006 + promptRouter.js utility + prefetch.js utility (foundation infrastructure)
- [ ] 12-02-PLAN.md — Extend POST /api/replies/generate as full pre-generation pipeline
- [ ] 12-03-PLAN.md — Unit tests for prompt routing and URL extraction/analysis (TDD)
- [ ] 12-04-PLAN.md — Frontend prompt badge, override dropdown, suppression UI (Inbox.jsx + api.js)

### Phase 13: Post-Generation Validation
**Goal**: Every generated reply passes 4 validation gates before reaching the user — Proposal Gate, Banned Phrase Scanner, Word Count Enforcement, and Next-Step Enforcement — plus 4 quality gates for follow-up and proposal output: Specificity Test, Angle Differentiation, Pricing Intelligence, and Proof Quality Gate
**Depends on**: Phase 12
**Requirements**: VALIDATE-01, VALIDATE-02, VALIDATE-03, VALIDATE-04, QUALITY-01, QUALITY-02, QUALITY-03, QUALITY-04
**Success Criteria** (what must be TRUE):
  1. (Positive) Proposal Gate strips pricing patterns ($, USD, "price", "cost", "budget", "phase 1/2/3", "timeline", "weeks", deliverables lists) from reply email output and replaces them with call-redirect language; Proposal V4 output retains pricing only when client explicitly requested it (toggle active)
  2. (Positive) Banned Phrase Scanner runs post-generation and catches phrases from the banned_phrases table; in "Flag" mode, matched phrases are highlighted red in the editor; in "Auto-rewrite" mode, AI rewrites the offending sentence; banned_phrases_caught count is recorded on reply_generations
  3. (Positive) Live word count displays below the editor as "X / [limit] words" with correct color (green = under limit, yellow = within 10%, red = over); limit is dynamically set by classification type (Positive=80, Neutral=120, Follow-Up 1=80, Follow-Up 2=70, Proposal cold=200)
  4. (Positive) Next-Step Enforcement scans the last 2 sentences; if no specific action + timeframe or question is found, a yellow warning bar appears "No next step detected"; copy button remains functional but warning persists until user edits
  5. (Positive) Follow-Up Specificity Test fires a secondary Haiku call after follow-up generation; if the draft lacks client-specific detail, it regenerates with stronger specificity instruction; after 2 failed regenerations, the reply is flagged "Needs manual writing" and shown to the user as-is with a flag badge
  6. (Positive) Angle Differentiation: Follow-Up 2 generation receives Follow-Up 1's angle_used as context; generated Follow-Up 2 uses a demonstrably different angle; both angles are recorded on the lead record
  7. (Negative) A reply that contains pricing language in a non-proposal reply type (e.g., Thread Continuation) is always stripped by the Proposal Gate — there is no way for pricing to reach the clipboard from a non-proposal prompt
  8. (Negative) Proof Quality Gate: a proposal body with no metric patterns (no %, no numbers, no timeframes) has its proof section removed entirely rather than passing vague claims like "we've worked with similar clients" through to the user
**Test mandate**:
  - Positive: Generate a reply using Thread Continuation with injected pricing language; verify Proposal Gate strips it and copy-to-clipboard output contains no pricing; verify call-redirect language is present
  - Positive: Seed banned_phrases table; generate a reply known to contain a phrase; verify flag mode highlights it; verify auto-rewrite mode changes the sentence; verify banned_phrases_caught = 1 on the reply_generations record
  - Positive: Generate replies for each classification type; verify word count limit shown matches classification; generate a reply over the limit; verify editor shows red count
  - Positive: Generate a follow-up; verify Haiku specificity check fires (mock Haiku to return "NO"); verify regeneration happens; verify after 2 failures the "Needs manual writing" badge appears
  - Negative: Generate a proposal with no metrics in the proof section; verify proof section is stripped from clipboard output, not passed through
  - Negative: Generate a follow-up with a next step present; verify no warning bar appears; then remove the next step from the editor; verify warning bar reappears
  - Edge case: Generate Follow-Up 2 when Follow-Up 1 has never been generated (no angle stored); verify system handles gracefully with no crash, uses a default angle
**Plans**: 4 plans

Plans:
- [ ] 13-01-PLAN.md — Migration 007 + validateReply.js utility (all scanner functions)
- [ ] 13-02-PLAN.md — replies.js Step 6b validation pipeline + Haiku specificity loop + angle extraction
- [ ] 13-03-PLAN.md — Unit tests for validateReply.js (TDD)
- [ ] 13-04-PLAN.md — Inbox.jsx: word count badge, next-step warning bar, banned phrase list, specificity badge

### Phase 14: Objection Handling + Kill Switch
**Goal**: System detects client objections before generating and routes to the correct counter-move template; agency sensitivity auto-inserts disclosure; scope framing is mirrored; follow-up sequence is capped at 2 with automatic DORMANT transition on the third attempt
**Depends on**: Phase 12
**Requirements**: OBJECTION-01, OBJECTION-02, OBJECTION-03, OBJECTION-04, OBJECTION-05, OBJECTION-06
**Success Criteria** (what must be TRUE):
  1. (Positive) Objection detection correctly classifies all 6 objection types from client email text before generation: Pricing ("how much", "too expensive"), Agency ("no agencies", "individual"), Comparison ("comparing options", "found someone cheaper"), Technical Q (framework/API/tech terms), Already Hired ("found someone", "already resolved"), None — and stores the detected objection on the lead record
  2. (Positive) When an objection is detected, the correct counter-move template is selected from counter_moves table and the generated reply stays within the max_words limit defined for that counter-move type
  3. (Positive) Technical question replies follow Answer → Curiosity Question → CTA pattern; exactly ONE curiosity question appears per reply, framed around the client's specific use case; if a technical reply is generated with 0 or 2+ curiosity questions, it fails validation
  4. (Positive) Agency sensitivity detection scans job post text for "individual", "freelancer", "no agencies", "solo developer"; when detected, agency disclosure is inserted in the first paragraph of both Proposal and Reply output; when NOT detected, agency disclosure does not appear anywhere in the output
  5. (Positive) Follow-Up Kill Switch: after follow_up_count = 2, any attempt to generate a third follow-up returns a Kill Switch notice instead of a reply; lead status moves to DORMANT; the system is blocked from generating follow-up output until 30 days have elapsed
  6. (Negative) A lead with follow_up_count = 1 correctly generates Follow-Up 2 (not blocked); a lead with follow_up_count = 2 is blocked from generating Follow-Up 3 and shows Kill Switch notice; a lead with follow_up_count = 0 generates Follow-Up 1 correctly
**Test mandate**:
  - Positive: Craft test emails for each of the 6 objection types; trigger generation; verify objection_detected stored correctly for each; verify correct counter-move template selected
  - Positive: Craft a technical question email; generate reply; count curiosity questions in output; verify exactly 1; generate 3 different technical replies; verify pattern holds consistently
  - Positive: Create job post text with "no agencies"; generate proposal; verify disclosure in first paragraph; create job post without agency restriction; generate proposal; verify no disclosure
  - Positive: Set follow_up_count = 2 on a test lead; attempt to generate follow-up; verify Kill Switch notice returned, no AI call made, lead status = DORMANT
  - Negative: Set follow_up_count = 2 and attempt generation twice more (Day 32 and Day 15); verify Day 32 is unblocked (30 days elapsed), Day 15 still blocked
  - Edge case: Email containing both Pricing and Agency objection keywords; verify system picks the dominant objection (first detected or highest priority) and does not crash with ambiguous classification
**Plans**: 4 plans

Plans:
- [ ] 14-01-PLAN.md — detectSignals.js module (pure sync detection functions) + Migration 008 (kill_switch_at column)
- [ ] 14-02-PLAN.md — replies.js pipeline extension: Step 0.5 signal detection, Step 2.5 kill switch, prompt augmentation, follow_up_count increment fix
- [ ] 14-03-PLAN.md — Unit tests for detectSignals.js (TDD)
- [ ] 14-04-PLAN.md — Inbox.jsx: Kill Switch notice panel (red panel, DORMANT notice, state management)

### Phase 15: Thread Continuation Engine
**Goal**: Ongoing conversations are automatically classified into 6 stages, tone shifts with thread depth, post-call replies default to recap format, CC'd contacts are addressed, stall recovery strategies vary by stall type, and every reply ends with a tracked next step stored in the next_steps table
**Depends on**: Phase 12, Phase 14
**Requirements**: THREAD-01, THREAD-02, THREAD-03, THREAD-04, THREAD-05, THREAD-06, THREAD-07, THREAD-08, THREAD-09
**Success Criteria** (what must be TRUE):
  1. (Positive) Thread stage is correctly detected and stored for all 6 stages: DISCOVERY (exploring fit), CALL_BOOKING (confirming time), POST_CALL (call happened), NEGOTIATION (pricing/scope active), CLOSING (ready to start), STALLED (long gaps or hedging); stage is visible in the lead detail view
  2. (Positive) Tone shifts with thread depth: messages 2-3 use slightly formal tone with insights; messages 4-6 use first name and shorter sentences; messages 7+ use ultra-casual tone without sales language; post-call messages reference what was discussed
  3. (Positive) Post-Call stage defaults to Recap output (under 100 words, bullet format, specific next step); full proposal is only generated when "Client requested proposal: Yes" toggle is active; the toggle state is persisted per lead
  4. (Positive) When a CC'd contact is detected in an email, the reply addresses the new person by name in the first sentence with 1-sentence context; CC'd contacts are stored as JSON on the lead record
  5. (Positive) After every Thread Continuation reply, a next_steps record is created with: our_action, our_deadline, their_action, followup_date, followup_approach; these are visible in the lead detail view
  6. (Positive) Hot Signal Detection: when email open count >= 10 (from tracking data), lead is flagged "Sharing Internally — High Interest Signal" and system suggests generating a simpler/phased option
  7. (Negative) A thread with 1 message (single email, no response yet) does not trigger Thread Continuation engine — it routes to Reply V2 (first reply); Thread Continuation only activates for threads with 2+ exchanges
  8. (Negative) Client Energy Matching: a short client email (<30 words) produces a reply under 60 words; a long client email (>100 words) allows a proportionally longer reply; a medium client email is not forced into short mode
**Test mandate**:
  - Positive: Create test threads at each depth (1, 3, 5, 8 messages); verify thread_stage detected correctly; verify tone descriptors shift at the right thresholds
  - Positive: Set thread stage to POST_CALL; generate reply with "Client requested proposal: No"; verify Recap format (under 100 words, bullets); flip toggle to "Yes"; verify full proposal generates
  - Positive: Create an email with a CC recipient; generate reply; verify first sentence addresses CC'd person by name with context; verify cc_contacts JSON updated on lead record
  - Positive: Generate 3 Thread Continuation replies in sequence; verify next_steps table has 3 new records each with non-null our_action, their_action, followup_date
  - Negative: Single-email thread (first contact from client); verify prompt routing selects Reply V2, not Thread Continuation; verify no thread_stage stored
  - Negative: Create a client email of 25 words; generate reply; verify word count is under 60; create a client email of 150 words; verify reply is not capped at 60
  - Edge case: Thread stage = STALLED after "let me think" response; verify system generates a Day 3 value-add reply with no call CTA (not a hard close); verify different strategy fires for "after pricing silence" stall vs "after call silence"
**Plans**: 5 plans

Plans:
- [ ] 15-01-PLAN.md — Migration 009: schema additions for Phase 15 (client_requested_proposal, cc_raw, stall_type, open_count, hot_signal_flagged)
- [ ] 15-02-PLAN.md — detectThreadContext.js utility module + CC header extraction in both Gmail sync paths
- [ ] 15-03-PLAN.md — replies.js pipeline extension: stage detection, tone injection, CC handling, stall recovery, re-engagement, NEXT STEP block, next_steps INSERT
- [ ] 15-04-PLAN.md — POST /api/emails/:id/open-count endpoint for manual hot signal tracking
- [ ] 15-05-PLAN.md — Inbox.jsx UI: thread stage badge, hot signal badge, post-call recap toggle

### Phase 16: Lovable Mockup Generator
**Goal**: System evaluates every job against a decision matrix to determine if a mockup is appropriate, then generates a complete Lovable-compatible prompt with design specs (including colors from client site), sections list, and realistic sample data, plus a stage-appropriate send message under 60 words
**Depends on**: Phase 12, Phase 15
**Requirements**: MOCKUP-01, MOCKUP-02, MOCKUP-03, MOCKUP-04, MOCKUP-05
**Success Criteria** (what must be TRUE):
  1. (Positive) Decision matrix correctly classifies all 14 job types: YES for web app, SaaS, landing page, e-commerce, mobile app, dashboard, AI chatbot, automation tool; NO with alternative suggestion for SEO/marketing, DevOps/backend, content writing, budget under $1K, client hasn't engaged yet
  2. (Positive) When YES, generated Lovable prompt includes: design specs (colors extracted from client site via link analysis, or sensible defaults if no site URL), typography, layout style, sections list (up to 6 with specific copy), interactive elements, realistic sample data — never Lorem ipsum; prompt must be self-contained enough to generate a working prototype in Lovable without additional instructions
  3. (Positive) System generates a stage-appropriate send message (60 words or under) to accompany the mockup link; different templates used for: with cold proposal, after a call, Follow-Up Day 3; message says "I put together a quick concept" — never "I built this for you"
  4. (Positive) "Generate Mockup" button is available in Proposal Workspace and Lead Detail screens; clicking it first runs the decision matrix check and shows the result; if YES, Lovable prompt and send message are generated and both are copyable to clipboard; mockup_sent boolean is updated when user copies the send message
  5. (Negative) Follow-Up Day 7 mockup option is grayed out with tooltip "Mockups should be sent at Day 3 or earlier — use a different value angle for Day 7"; clicking the grayed-out button does not trigger generation
  6. (Negative) When decision matrix returns NO (e.g., job is SEO/content writing), system does NOT generate a Lovable prompt; instead it shows the appropriate alternative suggestion (keyword analysis, architecture diagram, case study) based on job type
**Test mandate**:
  - Positive: Run decision matrix against job descriptions for all 14 job types; verify each returns the correct YES/NO with correct alternative suggestion for NO cases
  - Positive: Trigger Lovable prompt generation on a web app job with a client site URL present; verify colors in design specs are populated from link analysis, not generic defaults; verify no Lorem ipsum in sample data
  - Positive: Trigger generation for 3 stages (cold proposal, after call, Follow-Up Day 3); verify send message differs for each; verify word count is 60 or under for all 3; verify "I put together a quick concept" phrasing used
  - Negative: Set lead to Follow-Up Day 7 context; verify Generate Mockup button is grayed out; verify clicking it shows tooltip and does not call the AI
  - Negative: Run against a content writing job; verify NO classification, no Lovable prompt generated, alternative suggestion displayed
  - Edge case: Client site URL in link_analysis_json returns no color data (site blocked or CSS not parseable); verify system falls back to sensible design defaults without error; generated prompt is still valid
**Plans**: 4 plans

Plans:
- [x] 16-01-PLAN.md — Decision matrix utility (mockupDecision.js) + color extraction in prefetch.js
- [x] 16-02-PLAN.md — replies.js pipeline extension: decision gate, mockup context injection, output parser, DB persist
- [x] 16-03-PLAN.md — Unit tests for mockupDecision.js decision matrix (TDD)
- [x] 16-04-PLAN.md — Inbox.jsx: Generate Mockup button, dual clipboard, mockup decline display, Day 7 disabled state

### Phase 17: UI Upgrades
**Goal**: The reply editor surfaces all v2.0 intelligence in a clean, non-intrusive way — analysis panel above the editor, prompt badge with manual override, variant A/B selection for prompts that produce two variants, banned phrase highlights with mode toggle, live word count with dynamic limit, and next-step warning bar
**Depends on**: Phase 13, Phase 14, Phase 15, Phase 16
**Requirements**: UIUP-01, UIUP-02, UIUP-03, UIUP-04, UIUP-05, UIUP-06
**Success Criteria** (what must be TRUE):
  1. (Positive) Collapsible analysis panel appears above the reply editor, showing [JOB ANALYSIS] and [LINK ANALYSIS] blocks in human-readable format; panel is collapsed by default; one click expands it; expanded state persists for the session; panel content is never included in copy-to-clipboard output
  2. (Positive) Banned phrase violations are highlighted red in the reply editor immediately after generation; Settings shows a toggle between "Auto-rewrite" and "Flag" modes; in Flag mode, copy is blocked until all red highlights are manually resolved or dismissed; "Banned phrase violations caught this week" metric is visible on the dashboard
  3. (Positive) Live word count displays below the reply editor in format "X / [limit] words"; color is green when under limit, yellow within 10%, red when over; the limit number displayed changes dynamically when the detected classification changes (e.g., switching from Positive=80 to Neutral=120)
  4. (Positive) Reply editor header shows "Using: [Prompt Name]" badge; a manual override dropdown is next to the badge; selecting a different prompt from the dropdown triggers a re-generation using the selected prompt; the final prompt_used is recorded on reply_generations
  5. (Positive) For Reply V2 and Follow-Up V2 (which generate 2 variants), both Variant A (Direct) and Variant B (Value-First) are displayed side-by-side or in tabs; user must select one before the copy button activates; selected variant is recorded on reply_generations
  6. (Negative) If the reply editor contains no clear next step after generation, a yellow warning bar appears "No next step detected — add a call ask or action before copying"; the copy button remains functional (soft warning, not hard block); if user edits the reply to add a next step, the warning bar disappears automatically
**Test mandate**:
  - Positive: Generate a reply; verify analysis panel is collapsed by default; click to expand; verify JOB ANALYSIS and LINK ANALYSIS content is present; copy to clipboard; verify neither block appears in clipboard content
  - Positive: Generate a reply with a known banned phrase; verify red highlight in editor; switch to Auto-rewrite mode; regenerate; verify phrase is rewritten, no red highlight; check dashboard metric incremented
  - Positive: Change classification type via manual override dropdown; verify word count limit displayed updates to match the new classification; generate a reply over the limit; verify red count displayed
  - Positive: Use Reply V2 prompt; verify two variants displayed; verify copy button is disabled until one variant is selected; select Variant B; copy; verify variant_selected = "B" on reply_generations record
  - Negative: Generate a reply with no next step; verify yellow warning bar present; edit the reply to include "Can we jump on a call Thursday at 2pm?"; verify warning bar disappears without page refresh
  - Negative: Verify analysis panel content is never serialized into the clipboard payload regardless of panel expand/collapse state
  - Edge case: Generate a reply using a prompt that produces only 1 variant (Thread Continuation, Proposal V4); verify no variant selection UI appears; copy is available immediately after generation
**Plans**: 4 plans

Plans:
- [x] 17-01-PLAN.md — Backend: analysis blocks in API response + variant A/B parsing + variant selection endpoint
- [x] 17-02-PLAN.md — Frontend: collapsible analysis panel (UIUP-01) + variant A/B selector (UIUP-05) + verify UIUP-03/04/06
- [x] 17-03-PLAN.md — Frontend: banned phrase inline highlights + mode toggle + copy-blocking (UIUP-02)
- [x] 17-04-PLAN.md — Lint/build verification + human verification checkpoint for all 6 UIUP requirements

---

## v2.1 — Prompt Quality & Inbox UX Fixes (Phases 18-19)

### Phase 18: Prompt Quality Fixes
**Goal**: AI-generated replies produce correct CTA timezone format, follow-ups generate from Ashish's perspective, all reply types open with a polite greeting, cost suggestions appear when clients ask about pricing, and every reply includes the HipHype Tech signature block
**Depends on**: Phase 17 (v2.0 complete)
**Requirements**: CTA-01, CTA-02, CTA-03, CTA-04, CTA-05, CTA-06, TEST-01
**Success Criteria** (what must be TRUE):
  1. (Positive) Generated replies that include a meeting CTA use the format "11 am your time" with the client's IANA timezone resolved to their local time; the CTA never says a raw timezone abbreviation like "EST" or "PST" without the "your time" phrasing
  2. (Positive) Follow-up emails (Follow-Up V2 prompt) generate from Ashish's perspective as the sender — first person "I", referencing "your project" to the client — never generating text that reads as if the client is writing to Ashish
  3. (Positive) All reply types (Reply V2, Follow-Up V2, Proposal V4) begin with a polite opening greeting line (e.g., "Thanks for reaching out", "I hope you're doing well", "Good to hear from you") before the main reply body; the greeting is contextually appropriate to the reply type
  4. (Positive) Thread Continuation V1 replies include a greeting/salutation line (e.g., "Hi [Name]," or "Good to hear back, [Name]") before jumping into the reply body; a thread continuation that starts with raw content and no greeting fails validation
  5. (Positive) When the client's email contains pricing language (mentions cost, budget, pricing, rates, "how much", hourly/fixed), the generated reply includes a scope-based cost estimate range (e.g., "Based on the scope, this would typically fall in the $X-$Y range") with a call CTA to discuss further; the estimate is calibrated to the job scope, not a generic number
  6. (Negative) When the client's email does NOT mention pricing/cost/budget, the reply does NOT include any cost estimate or pricing language — cost suggestions only appear when the client explicitly raises the topic
  7. (Positive) Every generated reply ends with a company signature block containing "HipHype Tech" and a website/portfolio URL; the signature appears after the reply body and before any internal analysis blocks; copied-to-clipboard output includes the signature
  8. (Negative) A follow-up email that reads from the client's POV (e.g., "I was impressed by your proposal" where "your" refers to Ashish's proposal) is detected as a POV error in testing; only Ashish-as-sender POV passes
  9. (Edge) When timezone data is unavailable for the client (no city/country on job record), the CTA falls back to "11 am your time" without a specific timezone conversion rather than crashing or omitting the CTA entirely
  10. (Edge) When the client mentions pricing in a language other than English (e.g., "Kosten", "prix", "presupuesto"), the cost detection still triggers if the email has been translated or contains English pricing keywords alongside the foreign language
**Test mandate (per TEST-01)**:
  - Positive: Generate a Reply V2 for a client in Auckland (IANA: Pacific/Auckland); verify CTA output contains "11 am your time" with the correct NZ local time displayed
  - Positive: Generate a Follow-Up V2; verify the output reads from Ashish's POV ("I wanted to follow up on [project]") not the client's POV
  - Positive: Generate Reply V2, Follow-Up V2, and Proposal V4; verify each begins with a polite greeting line; generate Thread Continuation V1; verify it begins with "Hi [Name]" or equivalent greeting
  - Positive: Send an email containing "What would this cost?" and generate a reply; verify a scope-based cost range appears in the output with a call CTA
  - Positive: Verify every generated reply contains the HipHype Tech signature block with website URL in the clipboard output
  - Negative: Send an email about project requirements with no pricing language; generate reply; verify zero cost/pricing language in the output
  - Negative: Generate a Follow-Up V2 and scan for client-POV markers ("your proposal", "your team sent"); verify none present
  - Edge: Generate a reply for a client with no city/country data; verify CTA says "11 am your time" (graceful fallback), no crash
  - Edge: Generate a reply where the prompt template already has a greeting hardcoded; verify no double-greeting (greeting does not appear twice)
**Plans**: 3 plans

Plans:
- [ ] 18-01-PLAN.md — Prompt enhancement utilities + template content updates (greetings, POV, signature, cost instructions)
- [ ] 18-02-PLAN.md — Pipeline integration: timezone CTA, cost detection, signature appending in replies.js
- [ ] 18-03-PLAN.md — Comprehensive Jest tests for all CTA requirements (TEST-01)

### Phase 19: Inbox Workflow
**Goal**: Users can re-activate lost/rejected leads, replied/lost emails automatically move out of the Inbox tab to their respective status tabs, and users can search the inbox by email address
**Depends on**: Phase 18
**Requirements**: FLOW-01, FLOW-02, FLOW-03, TEST-01
**Success Criteria** (what must be TRUE):
  1. (Positive) User can change a lead marked "Lost" or "Rejected" back to "New" or another active status (Replied, Proposal Sent) using a re-activate action in the lead detail view; the lead reappears in the appropriate status tab after re-activation
  2. (Positive) When a lead's status changes to "Replied" or "Lost", the email immediately disappears from the Inbox tab and appears in the corresponding status tab (Replied tab or Lost tab) without requiring a manual page refresh or re-sync
  3. (Positive) A search input field is visible in the Inbox view; typing an email address filters the inbox list in real-time to show only emails matching that address; clearing the search restores the full inbox list
  4. (Negative) A lead that is already in "New" status does not show a "Re-activate" option — re-activation is only available for leads in "Lost" or "Rejected" status
  5. (Negative) Search with an email address that matches zero leads shows an empty state message (e.g., "No emails found for [address]"), not a broken/blank inbox
  6. (Edge) Re-activating a DORMANT lead (from kill switch) respects the 30-day window — if 30 days have not elapsed, re-activation changes status but does not unblock follow-up generation; if 30 days have elapsed, both status and follow-up generation are restored
  7. (Edge) Search input handles partial email matches (e.g., typing "john" matches "john@example.com" and "johnson@work.com"); search is case-insensitive
  8. (Edge) When multiple emails are rapidly moved out of Inbox (bulk status changes), the Inbox list updates correctly without duplicate entries or stale rows remaining
**Test mandate (per TEST-01)**:
  - Positive: Set a lead to "Lost"; click re-activate; verify status changes to "New"; verify lead appears in New/Inbox tab
  - Positive: Change a lead status to "Replied" from the inbox; verify it disappears from Inbox tab immediately; navigate to Replied tab; verify it appears there
  - Positive: Type "test@example.com" in search bar; verify only matching emails shown; clear search; verify full inbox restored
  - Negative: View a lead already in "New" status; verify no re-activate button/option is present
  - Negative: Search for "nonexistent@fake.com"; verify empty state message displayed, not broken UI
  - Edge: Re-activate a DORMANT lead at day 15 (within 30-day window); verify status changes but follow-up generation remains blocked
  - Edge: Type partial email "john" in search; verify case-insensitive partial matching works across all visible emails
  - Edge: Change 3 leads to "Lost" in quick succession; verify all 3 disappear from Inbox and appear in Lost tab without duplicates
**Plans**: 2 plans

Plans:
- [ ] 19-01-PLAN.md -- Backend re-activate endpoint + frontend search, auto-move, re-activate button
- [ ] 19-02-PLAN.md -- Comprehensive Jest tests for inbox workflow (TEST-01)

---

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/2 | Not started | - |
| 2. Configuration UI | 0/2 | Not started | - |
| 3. Email Inbox | 0/3 | Not started | - |
| 4. Job Context Matching | 0/2 | Not started | - |
| 5. AI Smart Reply Generator | 0/3 | Not started | - |
| 6. Email Intelligence | 0/2 | Not started | - |
| 7. Lovable Prompt Generator | 0/1 | Not started | - |
| 8. Lead Scoring | 0/1 | Not started | - |
| 9. Team & VA Access | 0/1 | Not started | - |
| 10. UI Polish | 0/2 | Not started | - |
| 11. DB + Prompt Foundation | 0/TBD | Not started | - |
| 12. Prompt Routing + Pre-Generation | 0/4 | Not started | - |
| 13. Post-Generation Validation | 0/4 | Ready to execute | - |
| 14. Objection Handling + Kill Switch | 0/4 | Ready to execute | - |
| 15. Thread Continuation Engine | 0/5 | Planned | - |
| 16. Lovable Mockup Generator | 4/4 | Complete | 2026-03-05 |
| 17. UI Upgrades | 4/4 | Complete | 2026-03-06 |
| 18. Prompt Quality Fixes | 0/TBD | Not started | - |
| 19. Inbox Workflow | 0/TBD | Not started | - |
