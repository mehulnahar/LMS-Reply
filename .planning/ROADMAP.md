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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

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
