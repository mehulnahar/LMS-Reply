# Upwork Proposal & Reply Cockpit (LMS Reply)

## What This Is

An intelligent Upwork client management system that pulls emails from Gmail, matches them to job postings via the leadhack.info API, and uses Claude AI to generate context-aware replies and proposals. Built for a freelancer + VA team workflow with role-based access, configurable integrations, and a clean minimalist UI with dark/light mode.

## Core Value

When a client emails about an Upwork job, the system instantly surfaces the full job context and generates a tailored AI reply — reducing response time from minutes to seconds.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Configuration settings (multi-email, API keys, integrations)
- [ ] Reply Inbox with job context matching
- [ ] AI-powered Smart Reply Generator (contextual — detects intent: question, quote request, availability, etc.)
- [ ] Lovable Prompt Generator (auto-generates Lovable UI prompt when a visual mockup would help win the deal)
- [ ] Lead Research & Scoring (based on job description + email domain only — no external enrichment in v1)
- [ ] User authentication with custom role-based access (owner + VA roles)
- [ ] Dark/light theme toggle
- [ ] Minimalist, polished UI
- [ ] Pre-Call Briefing with LinkedIn enrichment (Proxycurl/Apollo — configurable)

### Out of Scope

- Pipeline Board (Kanban) — deferred to v2
- Follow-Up Engine — deferred to v2
- WhatsApp Digest — deferred to v2
- Proposal Recycler — deferred to v2
- All other PRD modules (15+) — deferred to future milestones
- Mobile app — web-first
- Multi-platform support (Freelancer.com, Toptal) — Upwork only for now

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

---
*Last updated: 2026-02-28 after questioning (email workflow, Lovable feature, LinkedIn enrichment clarified)*
