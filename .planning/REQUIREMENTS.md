# Requirements: LMS Reply (Upwork Proposal & Reply Cockpit)

**Defined:** 2026-02-28
**Core Value:** When a client emails about an Upwork job, the system instantly surfaces the full job context and generates a tailored AI reply — reducing response time from minutes to seconds.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Configuration

- [ ] **CONF-01**: User can add/update/remove API keys (Anthropic, leadhack) with encrypted storage
- [ ] **CONF-02**: User can connect multiple Gmail accounts via OAuth with per-account sync settings
- [ ] **CONF-03**: User can disconnect/reconnect Gmail accounts when OAuth tokens expire
- [ ] **CONF-04**: User can view integration status dashboard (connected/disconnected/error per service)
- [ ] **CONF-05**: User can create/edit/delete AI prompt templates stored in database
- [ ] **CONF-06**: User can configure email sync frequency (1min / 5min / 15min)

### Email Inbox

- [ ] **INBOX-01**: System pulls only emails with "Upwork" in subject line (configurable filter)
- [ ] **INBOX-02**: System never marks emails as read in Gmail (read-only access)
- [ ] **INBOX-03**: Emails display in unified inbox view across all connected Gmail accounts
- [ ] **INBOX-04**: Emails are grouped by conversation thread (Gmail threadId)
- [ ] **INBOX-05**: Each email shows time-since-received indicator with color coding (green < 1hr, yellow 1-4hr, red > 4hr)
- [ ] **INBOX-06**: Inbox shows sync status ("Last synced: X min ago") with manual refresh button
- [ ] **INBOX-07**: User can assign lead status labels: New / Replied / Proposal Sent / Won / Lost
- [ ] **INBOX-08**: Inbox displays sender name, email, subject, and preview snippet

### Job Context Matching

- [ ] **JOB-01**: System auto-matches emails to Upwork jobs via leadhack.info API (email_id + email_subject)
- [ ] **JOB-02**: Matched job context displays alongside email (job heading, full description, client name)
- [ ] **JOB-03**: Match status indicator shows: Matched / No Match
- [ ] **JOB-04**: System caches leadhack responses locally to avoid redundant API calls
- [ ] **JOB-05**: System handles leadhack API failures gracefully (show cached data or "unavailable" state)

### AI Smart Reply Generator

- [ ] **REPLY-01**: User can generate an AI reply with one click, using full job context + email content
- [ ] **REPLY-02**: AI classifies email intent into 15 categories validated by real email analysis: Pricing Inquiry, Specific Requirements, Call Acceptance, Direct Call Request, Portfolio/Proof Request, Time Zone Objection, Agency Size Inquiry, Polite Decline, Hostile Feedback, STOP/Opt-Out, OOO Auto-Reply, Email Redirect, Internal Forward, Package Inquiry, Structured Application — each generates a different reply strategy
- [ ] **REPLY-03**: User can select tone before generating: Professional / Friendly / Concise / Detailed. AI also auto-matches communication style length to client's style (5-word emails get 2-sentence replies, detailed briefs get structured proposals)
- [ ] **REPLY-04**: Generated reply displays in editable text area for review/modification
- [ ] **REPLY-05**: User can copy reply to clipboard with proper spacing and indentation for Gmail paste
- [ ] **REPLY-06**: AI uses company profile data from prompt templates (HipHype Tech, team, rates, specialties)
- [ ] **REPLY-07**: System shows AI generation loading state with progress indication

### Email Intelligence (validated by 50-email analysis)

- [ ] **INTEL-01**: System extracts phone numbers from email signatures and flags as "Call Requested" when paired with "please call" or similar
- [ ] **INTEL-02**: System detects OOO auto-replies in English, German, Italian, French, Spanish — extracts return date and pauses follow-up sequence
- [ ] **INTEL-03**: System detects email redirect ("use this email instead") and extracts alternative contact address
- [ ] **INTEL-04**: System parses professional name titles (Dr., Dr. med., Prof., Ing.) to extract correct first name — never addresses "Dr. med." as "Med"
- [ ] **INTEL-05**: System detects time expressions in client replies ("tomorrow", "next Monday", "1230") and converts to specific date/time with timezone
- [ ] **INTEL-06**: System detects urgent/time-sensitive jobs ("fix", "broken", "down", "urgent", "ASAP" in description) and prioritizes speed over nurture cadence

### Lovable Prompt Generator

- [ ] **LOV-01**: System detects when a job involves UI/visual work (website, app, dashboard, landing page, storefront)
- [ ] **LOV-02**: When detected, auto-generates a Lovable-compatible prompt tailored to the specific job description
- [ ] **LOV-03**: Lovable prompt displays in a dedicated section with 🎨 icon indicator
- [ ] **LOV-04**: User can copy Lovable prompt to clipboard with one click
- [ ] **LOV-05**: Lovable prompt section is hidden for non-visual jobs (e.g., data entry, bookkeeping)

### Lead Scoring

- [ ] **SCORE-01**: System auto-scores leads based on job description analysis (skills match, scope, budget signals)
- [ ] **SCORE-02**: Score factors include: email domain (corporate vs personal), job heading complexity, urgency signals in text, response type (detailed reply = HIGH, call acceptance = HIGH, pricing only = MEDIUM, two-word reply = LOW), phone number presence in signature (HIGH intent), internal forward signals ("FW:" in subject = HIGH)
- [ ] **SCORE-03**: Score displays as color-coded indicator in inbox (green = high, yellow = medium, red = low)
- [ ] **SCORE-04**: User can sort inbox by lead score (highest first)
- [ ] **SCORE-05**: User can filter inbox by score range

### Authentication & Access

- [ ] **AUTH-01**: User can sign up with email and password
- [ ] **AUTH-02**: User can log in and session persists across browser refresh (JWT)
- [ ] **AUTH-03**: User can log out from any page
- [ ] **AUTH-04**: Owner can create VA accounts with custom role permissions
- [ ] **AUTH-05**: Owner can define per-module access for each VA role (view only, draft, full access)
- [ ] **AUTH-06**: VA actions are logged with timestamp and user identity (audit trail)

### UI/UX

- [ ] **UI-01**: Dark and light theme toggle, persisted per user preference
- [ ] **UI-02**: Minimalist, polished, professional design (not generic template look)
- [ ] **UI-03**: Loading skeleton states for inbox, job context panel, and AI generation
- [ ] **UI-04**: Responsive layout (desktop-first, functional on tablet)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Configuration Enhancements

- **CONF-V2-01**: Company profile settings (HipHype info, team members, rates, specialties as structured data)
- **CONF-V2-02**: LinkedIn enrichment API configuration (Proxycurl/Apollo credentials)

### Inbox Enhancements

- **INBOX-V2-01**: Manual job linking fallback (paste job URL when auto-match fails)
- **INBOX-V2-02**: Full-text search across emails and job descriptions
- **INBOX-V2-03**: Keyboard shortcuts (j/k navigation, r to reply)
- **INBOX-V2-04**: Snooze / follow-up reminders
- **INBOX-V2-05**: Reply history per lead (see previous replies in thread context)

### Team Features

- **TEAM-V2-01**: VA approval queue (VA drafts → owner reviews → approved)
- **TEAM-V2-02**: Batch AI reply generation (select multiple, generate all)

### Analytics & Pipeline

- **PIPE-V2-01**: Pipeline board (Kanban view of leads by status)
- **PIPE-V2-02**: Email-to-lead conversion tracking with analytics
- **PIPE-V2-03**: Analytics dashboard (response times, conversion rates, AI acceptance rates)

### Pre-Call Briefing

- **CALL-V2-01**: Pre-call briefing using LinkedIn profile enrichment
- **CALL-V2-02**: Client history aggregation across multiple jobs

### Advanced AI

- **AI-V2-01**: Proposal generation (full Upwork proposals, not just email replies)
- **AI-V2-02**: Follow-up engine (automated follow-up sequences)
- **AI-V2-03**: Win/loss analysis feeding back into prompt improvement

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Full CRM (invoicing, contracts, time tracking) | Upwork handles this natively. Stay focused on reply pipeline. |
| Upwork direct scraping | Legal risk (ToS violation). leadhack.info handles this. |
| Multi-platform (Freelancer.com, Toptal, Fiverr) | Each platform is different. Upwork only. |
| Gmail send permissions | System is read-only. User copies reply and pastes in Gmail. |
| Mobile native app | Web-first. Responsive web works for quick checks. |
| Real-time push notifications | Gmail polling (configurable interval) is sufficient for v1. |
| Auto-send without review | AI hallucination risk. Always show draft for review. |
| Custom AI model fine-tuning | Few-shot prompting with example replies is simpler and nearly as effective. |
| Built-in calendar/scheduling | Users already have Calendly/Cal.com. |
| WhatsApp Digest | Different communication channel. Defer to v2+. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 1: Foundation | Pending |
| CONF-02 | Phase 2: Configuration UI | Pending |
| CONF-03 | Phase 2: Configuration UI | Pending |
| CONF-04 | Phase 2: Configuration UI | Pending |
| CONF-05 | Phase 2: Configuration UI | Pending |
| CONF-06 | Phase 2: Configuration UI | Pending |
| INBOX-01 | Phase 3: Email Inbox | Pending |
| INBOX-02 | Phase 3: Email Inbox | Pending |
| INBOX-03 | Phase 3: Email Inbox | Pending |
| INBOX-04 | Phase 3: Email Inbox | Pending |
| INBOX-05 | Phase 3: Email Inbox | Pending |
| INBOX-06 | Phase 3: Email Inbox | Pending |
| INBOX-07 | Phase 3: Email Inbox | Pending |
| INBOX-08 | Phase 3: Email Inbox | Pending |
| JOB-01 | Phase 4: Job Context Matching | Pending |
| JOB-02 | Phase 4: Job Context Matching | Pending |
| JOB-03 | Phase 4: Job Context Matching | Pending |
| JOB-04 | Phase 4: Job Context Matching | Pending |
| JOB-05 | Phase 4: Job Context Matching | Pending |
| REPLY-01 | Phase 5: AI Smart Reply Generator | Pending |
| REPLY-02 | Phase 5: AI Smart Reply Generator | Pending |
| REPLY-03 | Phase 5: AI Smart Reply Generator | Pending |
| REPLY-04 | Phase 5: AI Smart Reply Generator | Pending |
| REPLY-05 | Phase 5: AI Smart Reply Generator | Pending |
| REPLY-06 | Phase 5: AI Smart Reply Generator | Pending |
| REPLY-07 | Phase 5: AI Smart Reply Generator | Pending |
| INTEL-01 | Phase 6: Email Intelligence | Pending |
| INTEL-02 | Phase 6: Email Intelligence | Pending |
| INTEL-03 | Phase 6: Email Intelligence | Pending |
| INTEL-04 | Phase 6: Email Intelligence | Pending |
| INTEL-05 | Phase 6: Email Intelligence | Pending |
| INTEL-06 | Phase 6: Email Intelligence | Pending |
| LOV-01 | Phase 7: Lovable Prompt Generator | Pending |
| LOV-02 | Phase 7: Lovable Prompt Generator | Pending |
| LOV-03 | Phase 7: Lovable Prompt Generator | Pending |
| LOV-04 | Phase 7: Lovable Prompt Generator | Pending |
| LOV-05 | Phase 7: Lovable Prompt Generator | Pending |
| SCORE-01 | Phase 8: Lead Scoring | Pending |
| SCORE-02 | Phase 8: Lead Scoring | Pending |
| SCORE-03 | Phase 8: Lead Scoring | Pending |
| SCORE-04 | Phase 8: Lead Scoring | Pending |
| SCORE-05 | Phase 8: Lead Scoring | Pending |
| AUTH-01 | Phase 1: Foundation | Pending |
| AUTH-02 | Phase 1: Foundation | Pending |
| AUTH-03 | Phase 1: Foundation | Pending |
| AUTH-04 | Phase 9: Team & VA Access | Pending |
| AUTH-05 | Phase 9: Team & VA Access | Pending |
| AUTH-06 | Phase 9: Team & VA Access | Pending |
| UI-01 | Phase 10: UI Polish | Pending |
| UI-02 | Phase 10: UI Polish | Pending |
| UI-03 | Phase 10: UI Polish | Pending |
| UI-04 | Phase 10: UI Polish | Pending |

**Coverage:**
- v1 requirements: 52 total (41 original + 6 email-intelligence + 5 Lovable)
- Mapped to phases: 52/52
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 -- traceability updated with phase mappings from ROADMAP.md*
