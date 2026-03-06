# Upwork Proposal & Reply Cockpit (LMS Reply)

## What This Is

An intelligent Upwork client management system that pulls emails from Gmail, matches them to job postings via the leadhack.info API, and uses Claude AI to generate context-aware replies and proposals. Built for a freelancer + VA team workflow with role-based access, configurable integrations, and a clean minimalist UI with dark/light mode.

## Core Value

When a client emails about an Upwork job, the system instantly surfaces the full job context and generates a tailored AI reply — reducing response time from minutes to seconds.

## Current Milestone: v2.1 — Prompt Quality & Inbox UX Fixes

**Goal:** Fix AI reply quality issues from real-world usage (wrong CTA format, missing greetings, wrong POV in follow-ups, no portfolio link) and add inbox workflow features (search, auto-tab-routing, lead re-activation, cost suggestions).

**Source:** 9 user-reported issues from production usage feedback

**Target features:**
- Fix CTA to say "11 am your time" using client timezone
- Fix follow-up POV bug (generating from client's POV instead of Ashish's)
- Add polite greeting/salutation to all reply types including thread continuations
- Add cost suggestion when client asks about pricing (scope-based)
- Add company website/portfolio link in reply signature
- Re-activate rejected/lost leads when prospect loops in correct person
- Auto-remove replied/lost emails from Inbox to respective tabs
- Search bar for email addresses in Inbox
- Comprehensive test coverage (positive + negative + edge cases) for every phase

**Testing mandate:** Every phase must have positive, negative, AND edge case tests. No exceptions.

## Requirements

### Validated

- ✓ Auth (signup/login/session/JWT) — v1.0
- ✓ Encrypted API key storage (AES-256-GCM) — v1.0
- ✓ Gmail OAuth multi-account sync — v1.0
- ✓ Unified inbox with email status labels — v1.0
- ✓ LeadHack job context matching (auto + manual link) — v1.0
- ✓ Basic AI reply generation (single prompt) — v1.0
- ✓ Email analysis: lead score, intent, phone, OOO, urgency — v1.0
- ✓ Timezone lookup (Haiku-powered) — v1.0
- ✓ Dark/light theme — v1.0
- ✓ Prompt routing engine (5 prompts, auto-selected by context) — v2.0
- ✓ Pre-generation pipeline (job auto-fetch + link analysis) — v2.0
- ✓ Post-generation validation layer (banned phrases, proposal gate, word count, next-step) — v2.0
- ✓ Objection detection + counter-move library (10 objection types) — v2.0
- ✓ Follow-up kill switch (max 2, then DORMANT) — v2.0
- ✓ Thread continuation engine (6 conversation stages) — v2.0
- ✓ Lovable mockup generator (decision matrix + Lovable prompt + send message) — v2.0
- ✓ DB data model upgrades (reply_generations, next_steps, banned_phrases, counter_moves tables) — v2.0
- ✓ UI upgrades (analysis panel, variant A/B, validation indicators) — v2.0

### Active

- [ ] CTA uses "11 am your time" format with client timezone
- [ ] Follow-ups generate from Ashish's POV (not client's)
- [ ] All reply types include polite greeting/salutation
- [ ] Thread continuations include greeting (not just jumping into content)
- [ ] Cost suggestion when client asks about pricing (scope-based estimate)
- [ ] Company website/portfolio link in reply signature
- [ ] Re-activate rejected/lost leads (undo lost status)
- [ ] Auto-remove replied/lost emails from Inbox to respective tabs
- [ ] Search bar for email addresses in Inbox

### Out of Scope

- Pipeline Board (Kanban) — deferred to future
- WhatsApp Digest — deferred to future
- Proposal Recycler — deferred to future
- All other PRD modules (15+) — deferred to future milestones
- Mobile app — web-first
- Multi-platform support (Freelancer.com, Toptal) — Upwork only for now
- "I" vs "we" voice enforcement — user explicitly skipped this

## Context

### Existing Infrastructure
- **leadhack.info API** — Already operational. Three endpoints:
  - `POST /api/admin/getAuthToken` — JWT authentication (email + password)
  - `POST /api/admin/addDataV4` — Ingest job/lead data (from RSS scraper)
  - `POST /api/admin/getJobDetails` — Query job by client email + email subject
- **Data model** from leadhack: `id, first_name, last_name, email_id, email_subject, job_heading, job_description`
- **Existing skeleton**: Express.js API on Railway with health check, PostgreSQL, CI/CD pipeline (GitHub Actions → Railway auto-deploy)

### Technical Environment
- **Backend**: Node.js + Express.js (existing)
- **Frontend**: React (building from scratch)
- **Database**: PostgreSQL on Railway (existing)
- **AI**: Claude Sonnet (heavy tasks) / Haiku (lightweight tasks) via Anthropic API
- **Email**: Gmail API (OAuth, multiple accounts)
- **Deployment**: Railway (API + Frontend services + Postgres)
- **CI/CD**: GitHub Actions (lint + test) → Railway auto-deploy

### Email Workflow (Critical Design Decisions)
- **Gmail is READ-ONLY** — system never marks emails as read, never sends through Gmail API
- **Filter**: Only pull emails with "Upwork" in subject line
- **Reply output**: Copy-to-clipboard (proper spacing/indentation for Gmail paste)
- **Intent detection**: AI classifies what client is asking (question, quote, availability, experience, vague interest) and generates appropriate reply type
- **Lovable prompt**: When AI detects a UI/visual job, auto-generates a Lovable prompt so user can quickly create a mockup to attach with reply
- **Company**: HipHype Tech (NO MindCrew references anywhere)

### Existing AI Prompts
- User has battle-tested proposal writing prompt (hook formula, anti-patterns, structured approach)
- Email reply prompt and follow-up prompt exist but need significant improvement
- All prompts must be configurable templates stored in database, editable via settings UI
- Company name, team members, rates, specialties pulled from settings (never hardcoded)

### PRD Reference
- Full 25-module PRD exists: `Upwork_Cockpit_PRD_V2.docx`
- Building incrementally — module by module, test after each
- 10 AI prompts defined in PRD for various reply/proposal scenarios

## Constraints

- **Tech Stack**: Node.js + Express backend, React frontend, PostgreSQL — already deployed on Railway
- **Data Source**: leadhack.info API is the source of truth for job data — do not rebuild, integrate with it
- **Email**: Gmail API only (Google Cloud OAuth credentials exist)
- **AI Provider**: Anthropic Claude API (user has API key)
- **UI Quality**: Must be minimalist, polished, and professional — not generic template look
- **Configurability**: Everything must be configurable — no hardcoded API keys, emails, or integration URLs
- **Team Access**: Owner + VA team with custom role-based permissions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use leadhack.info as external data source | Already operational, handles scraping/ingestion | — Pending |
| Module-by-module development | User wants to test each module before building next | — Pending |
| React from scratch for LMS Reply UI | Full control over UI quality and customization | — Pending |
| Lovable prompts as a FEATURE inside the product | Auto-generate UI mockups for client proposals — differentiator | — Pending |
| Gmail read-only, copy-to-clipboard for replies | Simpler OAuth, no send risk, user controls the send | — Pending |
| No Gmail send scope | Easier Google verification, no "sent from wrong account" risk | — Pending |
| Dark + light mode from day one | User preference, affects all component design | — Pending |
| Custom roles over simple admin/VA split | User wants granular control over VA permissions | — Pending |
| Configuration module built first | Foundation for all other modules (API keys, emails) | — Pending |

| Quality-over-quantity testing | User + Codex + Antigravity all building in parallel; need verifiable quality per phase | — Pending |
| All 26 spec features in v2.0 | Full pipeline upgrade in one milestone — no feature left behind | — Pending |
| Jest + manual checklist testing | Automated coverage + human UAT after every phase | — Pending |

---
*Last updated: 2026-03-06 after v2.1 milestone started — Prompt Quality & Inbox UX Fixes (9 user feedback items)*
