# Requirements: LMS Reply (Upwork Proposal & Reply Cockpit)

**Defined:** 2026-02-28
**Updated:** 2026-03-06 — v2.1 roadmap created, all requirements mapped to phases 18-19
**Core Value:** When a client emails about an Upwork job, the system instantly surfaces the full job context and generates a tailored AI reply — reducing response time from minutes to seconds.

---

## v1.0 Requirements (Validated — shipped in codebase)

These are implemented and verified in the existing codebase. Not re-built in v2.0.

### Configuration
- ✓ **CONF-01**: User can add/update/remove API keys (Anthropic, leadhack) with encrypted storage
- ✓ **CONF-02**: User can connect multiple Gmail accounts via OAuth
- ✓ **CONF-03**: User can disconnect/reconnect Gmail accounts when OAuth tokens expire
- ✓ **CONF-04**: User can view integration status dashboard (connected/disconnected/error per service)
- ✓ **CONF-05**: User can create/edit/delete AI prompt templates stored in database
- ✓ **CONF-06**: User can configure email sync frequency

### Email Inbox
- ✓ **INBOX-01**: System pulls only emails with "Upwork" in subject line
- ✓ **INBOX-02**: System never marks emails as read in Gmail (read-only)
- ✓ **INBOX-03**: Emails display in unified inbox across all connected Gmail accounts
- ✓ **INBOX-04**: Emails grouped by conversation thread (Gmail threadId)
- ✓ **INBOX-05**: Time-since-received indicator (green <1hr, yellow 1-4hr, red >4hr)
- ✓ **INBOX-06**: Sync status with manual refresh button
- ✓ **INBOX-07**: Lead status labels: New / Replied / Proposal Sent / Won / Lost
- ✓ **INBOX-08**: Sender name, email, subject, preview snippet

### Job Context Matching
- ✓ **JOB-01**: Auto-matches emails to jobs via leadhack.info (email_id + email_subject)
- ✓ **JOB-02**: Matched job context displays alongside email
- ✓ **JOB-03**: Match status indicator: Matched / No Match
- ✓ **JOB-04**: Caches leadhack responses locally
- ✓ **JOB-05**: Handles leadhack API failures gracefully

### AI Reply Generator (basic)
- ✓ **REPLY-01**: One-click AI reply using email content + job context
- ✓ **REPLY-02**: Intent classification (15 categories)
- ✓ **REPLY-03**: Tone selection (Professional / Friendly / Concise / Detailed)
- ✓ **REPLY-04**: Generated reply in editable text area
- ✓ **REPLY-05**: Copy to clipboard with proper formatting
- ✓ **REPLY-06**: Uses company profile from prompt templates
- ✓ **REPLY-07**: Loading state with progress indication

### Email Intelligence
- ✓ **INTEL-01**: Extracts phone numbers, flags "Call Requested"
- ✓ **INTEL-02**: Detects OOO in 5 languages, extracts return date
- ✓ **INTEL-03**: Detects email redirect instructions
- ✓ **INTEL-04**: Parses professional name titles
- ✓ **INTEL-05**: Detects time expressions, converts to date/time with timezone
- ✓ **INTEL-06**: Detects urgent/time-sensitive jobs

### Lovable Prompt Generator (basic)
- ✓ **LOV-01**: Detects UI/visual jobs
- ✓ **LOV-02**: Generates Lovable-compatible prompt
- ✓ **LOV-03**: Displays in dedicated section
- ✓ **LOV-04**: Copy to clipboard
- ✓ **LOV-05**: Hidden for non-visual jobs

### Lead Scoring
- ✓ **SCORE-01 through SCORE-05**: Auto-scoring, color indicators, sort/filter

### Authentication
- ✓ **AUTH-01 through AUTH-06**: Signup, login, session, VA accounts, permissions, audit trail

### UI/UX
- ✓ **UI-01 through UI-04**: Dark/light theme, polished design, skeletons, responsive

---

## v2.0 Requirements — Full Pipeline Upgrade

All 26 features from System_Improvement_Spec_V3.md. Phases start at 11.

### Prompt Routing (PROMPT)

- [ ] **PROMPT-01**: System stores all 5 prompt documents (Proposal V4, Reply V2, Follow-Up V2, Thread Continuation V1, Lovable Mockup V1) as editable templates in the database (prompt_templates table, versioned)
- [ ] **PROMPT-02**: When user clicks "Generate Reply", system auto-selects the correct prompt: first client reply → Reply V2; ongoing thread (2+ exchanges) → Thread Continuation V1; client silent ≥3 days → Follow-Up V2; "Generate Proposal" clicked → Proposal V4; "Generate Mockup" clicked → Lovable Mockup V1; STOP classification → suppress, no output
- [ ] **PROMPT-03**: Reply editor shows a small badge indicating which prompt is active (e.g., "Using: First Reply" / "Using: Thread Continuation")
- [ ] **PROMPT-04**: User can manually override the auto-selected prompt via a dropdown in the reply editor

### Pre-Generation Pipeline (PREFETCH)

- [ ] **PREFETCH-01**: Before generating ANY output (reply, proposal, or follow-up), system ensures the full job description is loaded from LeadHack — if already cached on the email record, use it; if not, auto-fetch via `POST /getJobDetails` before proceeding
- [ ] **PREFETCH-02**: System scans job description and all email thread messages for URLs using regex (http/https); extracts all found URLs and stores as JSON on the lead record
- [ ] **PREFETCH-03**: For each extracted URL, system fetches and analyzes the page content (load speed, mobile UX, tech stack, SEO gaps, broken elements) before generating output; stores findings as structured JSON (URL, findings array, best_finding_for_reply)
- [ ] **PREFETCH-04**: Link analysis runs before generation and the best finding is injected into the prompt context so the AI can reference it in the output
- [ ] **PREFETCH-05**: Generated output includes an internal [JOB ANALYSIS] block (job title, client need, tech stack, budget signal, key insight) and [LINK ANALYSIS] block (URL, findings, best finding) stored on the reply record — never included in copy-to-clipboard output

### Post-Generation Validation (VALIDATE)

- [ ] **VALIDATE-01**: Proposal Gate — post-generation scanner detects pricing patterns ($, USD, "price", "cost", "budget", "phase 1/2/3", "timeline", "weeks", deliverables list) in reply emails and strips them, replacing with call-redirect language; exception: Proposal V4 output is allowed pricing if client explicitly requested it
- [ ] **VALIDATE-02**: Banned Phrase Scanner — post-generation scanner checks output against 40+ banned phrases (stored in banned_phrases table); auto-rewrites or highlights in red before showing to user; tracks count of violations caught
- [ ] **VALIDATE-03**: Live word count displayed in reply editor with color indicator: green (under limit), yellow (within 10% of limit), red (over limit); limits vary by classification type (Positive=80, Neutral=120, Follow-Up 1=80, Follow-Up 2=70, Proposal cold=200)
- [ ] **VALIDATE-04**: Next-Step Enforcement — scanner checks last 2 sentences of every reply for a specific action + timeframe or question; if absent, warns user before copy is allowed (cannot copy a reply without a next step)

### Objection Handling (OBJECTION)

- [ ] **OBJECTION-01**: System detects objection type from client email text before generating: Pricing ("how much", "too expensive"), Agency ("no agencies", "individual"), Comparison ("comparing options", "found someone cheaper"), Technical Q (contains framework/API/tech terms), Already Hired ("found someone", "already resolved"), None
- [ ] **OBJECTION-02**: When objection detected, Reply Generator selects the matching counter-move template from counter_moves table (configurable in Settings) and generates reply within the word limit for that counter-move type
- [ ] **OBJECTION-03**: When client asks a technical question, reply follows Answer → Curiosity Question → CTA pattern; curiosity question is about their specific use case ("That'll shape the approach" framing); only ONE curiosity question per reply
- [ ] **OBJECTION-04**: System detects agency-sensitivity in job post text ("individual", "freelancer", "no agencies", "solo developer"); if detected, Proposal Generator and Reply Generator auto-insert the agency disclosure template in the first paragraph; if not detected, disclosure is never mentioned
- [ ] **OBJECTION-05**: System detects client's scope framing from email thread (mentions hours → hourly framing; mentions phases/milestones → phase framing; mentions fixed budget → fixed framing); this framing is passed to Proposal Generator and mirrors the client's structure
- [ ] **OBJECTION-06**: Follow-Up Kill Switch — system tracks follow_up_count per lead; after 2 unanswered follow-ups (Follow-Up 1 at Day 3, Follow-Up 2 at Day 7), lead status automatically moves to DORMANT for 30 days; Follow-Up Engine is blocked from generating a 3rd follow-up and outputs Kill Switch notice instead

### Quality Gates (QUALITY)

- [ ] **QUALITY-01**: Follow-Up Specificity Test — after Follow-Up Engine generates a draft, a secondary Claude Haiku call checks: "Does this follow-up contain at least one detail specific to [client name]'s [project type]?" If answer is NO, regenerates with stronger specificity instruction; maximum 2 regeneration attempts; if still generic after 2, flags for manual writing
- [ ] **QUALITY-02**: Angle Differentiation — Follow-Up 1 and Follow-Up 2 must use different angles from each other and from the original reply; angle_used is stored on each follow-up record; when generating Follow-Up 2, Follow-Up 1's angle is passed as context with instruction to use a completely different angle
- [ ] **QUALITY-03**: Pricing Intelligence in Proposals — Proposal V4 output is post-scanned for $ amounts in the proposal body; if found, they are stripped and replaced with call-redirect language; rate/bid field in Proposal Workspace is for internal use only, never included in the copy-paste output
- [ ] **QUALITY-04**: Proof Quality Gate — after Proposal generation, the proof section is scanned for metric patterns (%, numbers, timeframes); if no metrics found, proof section is removed entirely rather than keeping vague claims like "we've worked with similar clients"

### Thread Continuation Engine (THREAD)

- [ ] **THREAD-01**: System detects conversation stage for threads with 2+ exchanges: DISCOVERY (exploring fit, questions, no commitment), CALL_BOOKING (agreed to talk, confirming time), POST_CALL (call has happened), NEGOTIATION (pricing/scope being discussed), CLOSING (ready to start, contract talk), STALLED (long gaps, hedging, vague); stage is stored on lead record and shown in lead detail
- [ ] **THREAD-02**: Reply tone shifts based on thread depth — messages 2-3: slightly formal, lead with insights; messages 4-6: more casual, use first name, shorter sentences; messages 7+: ultra-casual, drop sales tone; after a call: match call tone, reference what was discussed
- [ ] **THREAD-03**: Post-Call default output is Recap (not full proposal) — under 100 words, bullet format, specific next step; full proposal only generated when client explicitly says "send me a proposal" or "what would this cost"; a toggle "Client requested proposal: Yes/No" controls which is generated
- [ ] **THREAD-04**: When client CC's a new person, reply addresses the new person by name in the first sentence with 1-sentence context ("Hi [Name], quick context: [Name] and I have been discussing [project] — we've covered [X] and next step is [Y]"); CC'd contacts are stored as JSON on the lead record
- [ ] **THREAD-05**: Stall recovery uses different strategies based on what stalled — after "let me think": wait Day 3, add new value, no call CTA; after pricing → silence: Day 3 suggest Phase 1 option, Day 7 graceful close; after call → silence: Day 2 recap, Day 5 value-add, Day 10 graceful close; after multiple replies with no call commitment: attach a tangible (mockup, audit, diagram)
- [ ] **THREAD-06**: When Kill Switch fires, system stores a re_engagement_strategy field on the lead record — AI generates one sentence describing what new value would justify reaching out again in 30 days (e.g., "New case study from similar Shopify project" or "Industry trend affecting CAPI setup"); Dead Lead Rescue Queue uses this as starting point
- [ ] **THREAD-07**: Hot Signal Detection — if email open tracking data shows 10+ opens on a sent reply, system flags the lead as "Sharing Internally — High Interest Signal" and suggests generating a simpler/phased option to make internal sharing easier
- [ ] **THREAD-08**: Client Energy Matching — system measures client's last email word count; passes to Reply Generator as short (<30 words), medium (30-100), or long (>100); Reply Generator adjusts output length proportionally (short client message → reply under 60 words)
- [ ] **THREAD-09**: Internal Next-Step Summary generated after every Thread Continuation reply — stored on next_steps table: what we promised (our_action + our_deadline), what we expect from them (their_action), when to follow up if no response (followup_date), recommended follow-up approach (value-add / mockup / soft-close / none)

### Lovable Mockup Generator (MOCKUP)

- [ ] **MOCKUP-01**: Mockup Decision Matrix — system checks job type against decision matrix: web app, SaaS, landing page, e-commerce, mobile app, dashboard, AI chatbot, automation tool → YES build mockup; SEO/marketing, DevOps/backend, content writing, budget under $1K, client hasn't engaged yet → NO with alternative suggestion (keyword analysis, architecture diagram, case study)
- [ ] **MOCKUP-02**: When YES, system generates a complete Lovable-compatible prompt including: design specs (colors extracted from client's site via link analysis, typography, layout), sections list (up to 6 sections with specific copy/content), functionality (interactive elements, realistic sample data — never Lorem ipsum), importance notes; prompt must generate a working prototype in under 5 minutes in Lovable
- [ ] **MOCKUP-03**: System generates a stage-appropriate send message (≤60 words) to accompany the mockup link — different templates for: with proposal (cold), after a call, Follow-Up Day 3; never says "I built this for you" — says "I put together a quick concept"
- [ ] **MOCKUP-04**: "Generate Mockup" button is available in Proposal Workspace and Lead Detail screens; clicking it runs the decision matrix check, then generates the Lovable prompt + send message; prompt is copyable to clipboard
- [ ] **MOCKUP-05**: Follow-Up Day 7 mockup option is grayed out with tooltip "Mockups should be sent at Day 3 or earlier — use a different value angle for Day 7"; mockup_sent boolean tracks whether a mockup was shared for this lead

### Data Model (DB)

- [ ] **DB-01**: leads table extended with all prompt system fields: job_description_raw (TEXT), job_heading (VARCHAR 500), job_analysis_json (JSON), link_analysis_json (JSON), objection_detected (ENUM: NONE/PRICING/AGENCY/COMPARISON/TECHNICAL_Q/ALREADY_HIRED), follow_up_count (INTEGER default 0), follow_up_1_angle (VARCHAR 200), follow_up_2_angle (VARCHAR 200), agency_sensitive (BOOLEAN), client_scope_framing (ENUM: HOURS/PHASES/FIXED/UNKNOWN), client_message_length (ENUM: SHORT/MEDIUM/LONG), re_engagement_strategy (TEXT), mockup_sent (BOOLEAN default false), mockup_lovable_prompt (TEXT), post_call_recap_sent (BOOLEAN default false), thread_stage (ENUM: DISCOVERY/CALL_BOOKING/POST_CALL/NEGOTIATION/CLOSING/STALLED), thread_depth (INTEGER), thread_client_messages (INTEGER), last_prompt_used (ENUM: EMAIL_REPLY_V2/THREAD_CONTINUATION_V1/FOLLOW_UP_V2/PROPOSAL_V4/LOVABLE_MOCKUP_V1), next_step_ours (TEXT), next_step_theirs (TEXT), next_step_followup_date (DATE), next_step_approach (VARCHAR 100), cc_contacts (JSON)
- [ ] **DB-02**: banned_phrases table: id (SERIAL), phrase (VARCHAR 200), category (ENUM: CORPORATE/ENTHUSIASM/FILLER/FOLLOWUP/ASSUMPTION/PASSIVE/SELF_FOCUSED/GUILT), replacement_suggestion (VARCHAR 200 nullable), active (BOOLEAN default true); pre-populated with all 40+ phrases from prompt documents
- [ ] **DB-03**: counter_moves table: id (SERIAL), objection_pattern (VARCHAR 200), counter_move_name (VARCHAR 100), counter_move_template (TEXT), max_words (INTEGER), active (BOOLEAN); pre-populated with all 10 counter-moves from Reply V2 and Thread Continuation V1
- [ ] **DB-04**: reply_generations analytics table: id (SERIAL), lead_id (FK leads), prompt_used (ENUM), thread_stage_detected (ENUM nullable), thread_depth_at_gen (INTEGER), variant_selected (VARCHAR 50), was_edited (BOOLEAN), was_sent (BOOLEAN), had_next_step (BOOLEAN), banned_phrases_caught (INTEGER), word_count (INTEGER), generated_at (TIMESTAMP), sent_at (TIMESTAMP nullable)
- [ ] **DB-05**: next_steps tracking table: id (SERIAL), lead_id (FK leads), reply_generation_id (FK reply_generations), our_action (TEXT), our_deadline (DATE), their_action (TEXT), followup_date (DATE), followup_approach (VARCHAR 100), status (ENUM: PENDING/COMPLETED/OVERDUE/CANCELLED), created_at (TIMESTAMP), completed_at (TIMESTAMP nullable)

### UI Upgrades (UIUP)

- [ ] **UIUP-01**: Collapsible analysis panel displayed above reply editor showing [JOB ANALYSIS] and [LINK ANALYSIS] blocks in readable format; panel is team-only viewing (never included in copy-to-clipboard output); collapsed by default, expandable with one click
- [ ] **UIUP-02**: Banned phrase violations highlighted in red within the reply editor after generation; two modes toggleable in Settings: "Auto-rewrite" (AI rewrites the sentence) or "Flag" (highlights red, requires manual edit before copy is allowed); dashboard metric shows "Banned phrase violations caught this week"
- [ ] **UIUP-03**: Live word count displayed below reply editor in format "X / 120 words" with color: green (under limit), yellow (within 10%), red (over limit); limit adjusts dynamically based on detected classification
- [ ] **UIUP-04**: Reply editor header shows "Using: [Prompt Name]" badge (e.g., "Using: First Reply", "Using: Thread Continuation"); manual override dropdown available next to badge; prompt_used is recorded on reply_generations record
- [ ] **UIUP-05**: For prompts that generate 2 variants (Reply V2, Follow-Up V2), both Variant A (Direct) and Variant B (Value-First) are shown side-by-side; user selects one before copying; selected variant is recorded on reply_generations record
- [ ] **UIUP-06**: Next-step validation: if reply editor contains no clear next step, a yellow warning bar appears "No next step detected — add a call ask or action before copying"; copy button remains functional but warning persists until user edits

---

## v2.1 Requirements — Prompt Quality & Inbox UX Fixes

9 requirements from production usage feedback. Phases start at 18.

### Prompt Quality (CTA)

- [ ] **CTA-01**: Generated replies use "11 am your time" as the default meeting CTA, with the client's IANA timezone used to display the correct local time
- [ ] **CTA-02**: Follow-up emails (Follow-Up V2) generate from Ashish's perspective as the sender, not from the client's POV
- [ ] **CTA-03**: All reply types (Reply V2, Follow-Up V2, Proposal V4) include a polite opening greeting (e.g., "Thanks for your response", "I hope you're doing well") before the main content
- [ ] **CTA-04**: Thread Continuation V1 replies include a greeting/salutation (e.g., "Hi [Name]," or "Good to hear back") before jumping into the reply body
- [ ] **CTA-05**: When client's email mentions cost, pricing, or budget, AI suggests a scope-based cost estimate range in the reply (e.g., "Based on the scope, this would typically be in the $X-$Y range")
- [ ] **CTA-06**: Generated replies include a company signature block with HipHype Tech website URL and portfolio link

### Inbox Workflow (FLOW)

- [ ] **FLOW-01**: User can re-activate a lead previously marked as "Lost" or "Rejected" — changing it back to "New" or another active status
- [ ] **FLOW-02**: When a lead status is changed to "Replied" or "Lost", the email automatically moves from the Inbox tab to the corresponding status tab without manual refresh
- [ ] **FLOW-03**: User can search/filter the inbox by email address using a search input field

### Testing (TEST)

- [ ] **TEST-01**: Every phase includes comprehensive Jest tests with positive cases, negative cases, AND edge cases — minimum 3 test categories per phase

---

## v3 Requirements (Deferred)

### Advanced Re-Engagement
- **REENG-01**: Dead Lead Rescue Queue — automated surface of dormant leads at re-engagement date
- **REENG-02**: Win/loss analysis feeding back into prompt improvement
- **REENG-03**: A/B testing framework for reply variants (track which variant gets more responses)

### Deeper Integrations
- **INT-01**: Mailsuite / email tracking integration (open count → hot signal without manual input)
- **INT-02**: Calendar invite generation (Calendly/Google Calendar) from CTA timestamps
- **INT-03**: Direct Lovable API integration (auto-generate, no manual paste required)
- **INT-04**: Multi-sender support (parameterize sender name/role from user profile)

### Feedback Loop
- **FEED-01**: Automated tracking of which AI-generated replies received client responses (reply rate by prompt type)
- **FEED-02**: Prompt quality scores surfaced in analytics dashboard

---

## Out of Scope (v2.1)

| Feature | Reason |
|---------|--------|
| "I" vs "we" voice enforcement | User explicitly skipped — not a priority |
| Upwork direct submission | Platform ToS risk, manual paste is safer |
| Gmail send permissions | System remains read-only copy-paste |
| Calendar invite auto-send | User controls scheduling (Calendly link in CTA) |
| Direct Lovable API | Manual paste workflow is sufficient; API is unstable |
| Multi-sender parameterization | Single sender (Ashish) for now; v3 if needed |
| Automated feedback loop | Needs reply tracking data first; v3 |
| WhatsApp Digest | Different channel; v3 |
| Pipeline Board (Kanban) | v3 |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Phase 11: DB + Prompt Foundation | Pending |
| PROMPT-02 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PROMPT-03 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PROMPT-04 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PREFETCH-01 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PREFETCH-02 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PREFETCH-03 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PREFETCH-04 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| PREFETCH-05 | Phase 12: Prompt Routing + Pre-Generation | Pending |
| VALIDATE-01 | Phase 13: Post-Generation Validation | Pending |
| VALIDATE-02 | Phase 13: Post-Generation Validation | Pending |
| VALIDATE-03 | Phase 13: Post-Generation Validation | Pending |
| VALIDATE-04 | Phase 13: Post-Generation Validation | Pending |
| QUALITY-01 | Phase 13: Post-Generation Validation | Pending |
| QUALITY-02 | Phase 13: Post-Generation Validation | Pending |
| QUALITY-03 | Phase 13: Post-Generation Validation | Pending |
| QUALITY-04 | Phase 13: Post-Generation Validation | Pending |
| OBJECTION-01 | Phase 14: Objection Handling + Kill Switch | Pending |
| OBJECTION-02 | Phase 14: Objection Handling + Kill Switch | Pending |
| OBJECTION-03 | Phase 14: Objection Handling + Kill Switch | Pending |
| OBJECTION-04 | Phase 14: Objection Handling + Kill Switch | Pending |
| OBJECTION-05 | Phase 14: Objection Handling + Kill Switch | Pending |
| OBJECTION-06 | Phase 14: Objection Handling + Kill Switch | Pending |
| THREAD-01 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-02 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-03 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-04 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-05 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-06 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-07 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-08 | Phase 15: Thread Continuation Engine | Pending |
| THREAD-09 | Phase 15: Thread Continuation Engine | Pending |
| MOCKUP-01 | Phase 16: Lovable Mockup Generator | Pending |
| MOCKUP-02 | Phase 16: Lovable Mockup Generator | Pending |
| MOCKUP-03 | Phase 16: Lovable Mockup Generator | Pending |
| MOCKUP-04 | Phase 16: Lovable Mockup Generator | Pending |
| MOCKUP-05 | Phase 16: Lovable Mockup Generator | Pending |
| DB-01 | Phase 11: DB + Prompt Foundation | Pending |
| DB-02 | Phase 11: DB + Prompt Foundation | Pending |
| DB-03 | Phase 11: DB + Prompt Foundation | Pending |
| DB-04 | Phase 11: DB + Prompt Foundation | Pending |
| DB-05 | Phase 11: DB + Prompt Foundation | Pending |
| UIUP-01 | Phase 17: UI Upgrades | Pending |
| UIUP-02 | Phase 17: UI Upgrades | Pending |
| UIUP-03 | Phase 17: UI Upgrades | Pending |
| UIUP-04 | Phase 17: UI Upgrades | Pending |
| UIUP-05 | Phase 17: UI Upgrades | Pending |
| UIUP-06 | Phase 17: UI Upgrades | Pending |

**Coverage (v2.0):**
- v2.0 requirements: 49 total
- Mapped to phases: 49/49
- Unmapped: 0 ✓

### v2.1 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CTA-01 | Phase 18: Prompt Quality Fixes | Pending |
| CTA-02 | Phase 18: Prompt Quality Fixes | Pending |
| CTA-03 | Phase 18: Prompt Quality Fixes | Pending |
| CTA-04 | Phase 18: Prompt Quality Fixes | Pending |
| CTA-05 | Phase 18: Prompt Quality Fixes | Pending |
| CTA-06 | Phase 18: Prompt Quality Fixes | Pending |
| FLOW-01 | Phase 19: Inbox Workflow | Pending |
| FLOW-02 | Phase 19: Inbox Workflow | Pending |
| FLOW-03 | Phase 19: Inbox Workflow | Pending |
| TEST-01 | All phases (18, 19) | Pending |

**Coverage (v2.1):**
- v2.1 requirements: 10 total
- Mapped to phases: 10/10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-03-06 — v2.1 roadmap created, all requirements mapped to phases 18-19*
