# Research Summary

**Project:** LMS Reply — AI-Powered Upwork Freelancer Reply Cockpit
**Synthesized:** 2026-02-28
**Synthesizer:** gsd-research-synthesizer

---

## Executive Summary

LMS Reply is a specialized email reply cockpit for Upwork freelancers, not a general-purpose CRM. The product sits at the intersection of email workflow tooling (Superhuman, Front) and freelance business management (Bonsai, HoneyBook), but wins by doing one thing neither category does: automatically enriching incoming client emails with the relevant Upwork job description from the leadhack.info API, then feeding that full context to Claude to generate a contextualized, human-reviewable reply draft. This is a genuinely novel workflow that no existing competitor addresses. The moat is narrow but real — the leadhack.info integration is the core differentiator, and the product must be designed to degrade gracefully when that dependency is unavailable.

The technical foundation is already deployed on Railway (Node.js 18 / Express 4 / PostgreSQL). The recommended build path adds Drizzle ORM for schema management, a React + Vite + Tailwind v4 frontend, TanStack Query and Zustand for state, and shadcn/ui for components. Gmail integration uses the googleapis SDK with OAuth2 per account, incremental historyId-based sync, and Server-Sent Events for AI streaming. Claude (claude-sonnet-4-20250514) handles reply generation via the Anthropic SDK with SSE streaming to the frontend. Background jobs (BullMQ + Redis, or pg-boss if Redis is not available) manage Gmail sync, watch renewal, and AI generation queuing.

The most critical risk is the OAuth2 token lifecycle: Google's 7-day expiry for unverified apps, silent token revocation, and the Gmail watch() expiry after 7 days can silently kill the entire email ingestion pipeline. Claude API cost is the second critical risk — without per-user token budgets, rate limits, and max_tokens constraints, costs can spiral quickly with VA users regenerating replies. The recommended build order is: (1) Foundation (auth, settings, DB schema, encrypted credential store), (2) Email Ingestion (Gmail OAuth + sync engine), (3) Job Context + AI Replies (the core value proposition), (4) Lead Scoring + Polish. Each phase has clear acceptance criteria and must not be shipped without the pitfall mitigations in place.

---

## Key Findings

### From STACK.md

**Core technologies with rationale:**

| Technology | Rationale |
|------------|-----------|
| Node.js 18 + Express 4 | Already deployed; Express 5 has breaking changes with no benefit for this domain |
| PostgreSQL (Railway-managed) | Already deployed; primary store for emails, jobs, replies, settings |
| Drizzle ORM 0.45.1 | Wraps existing pg Pool directly, TypeScript schema-as-code, no binary engine overhead vs. Prisma |
| React 19 + Vite 7 | SPA is correct choice (dashboard, not content site); sub-second HMR; SSR via Next.js adds unnecessary complexity |
| Tailwind CSS v4 + shadcn/ui | CSS-first config, dark/light via CSS variables, component primitives copied into codebase for full control |
| TanStack Query v5 + Zustand v5 | TQ for server state (email/lead data), Zustand for UI state (auth, theme, draft). Combined ~15kb vs Redux Toolkit ~40kb |
| googleapis + google-auth-library | Official SDK; handles OAuth2 per-account with per-instance token refresh |
| @anthropic-ai/sdk 0.78 | Streaming support for SSE reply generation; prompt caching for up to 90% token cost reduction on system prompts |
| Socket.IO 4.8 | Bidirectional real-time for inbox notifications; SSE for AI streaming (unidirectional is sufficient there) |
| BullMQ 5 + ioredis | Reliable job queuing for Gmail sync and AI generation; pg-boss is valid Redis-free alternative |
| jsonwebtoken + bcryptjs | Direct JWT/password auth; Passport.js is over-abstracted for 2 auth strategies |
| Zod v4 + React Hook Form v7 | Shared validation schemas between frontend and backend API boundaries |

**Critical version requirements:**
- Tailwind v4 requires `@tailwindcss/vite` plugin (no tailwind.config.js)
- shadcn/ui CLI v3.8.5 required for Tailwind v4 compatibility
- BullMQ v5 requires ioredis v5 (must match)
- Zod v4 requires @hookform/resolvers v5

**Budget fallback:** If Railway Redis is not available, replace BullMQ + ioredis with pg-boss (PostgreSQL-backed queue, no Redis dependency).

---

### From FEATURES.md

**Table stakes (v1 — product is broken without these):**
- Multi-account Gmail inbox with unified view and threading
- Email composition and sending (reply via Gmail API)
- Job context auto-matching via leadhack.info API
- One-click AI reply generation with job context injected (Claude)
- Edit-before-send UI for AI drafts (never auto-send)
- Basic lead scoring by budget, fit, client history
- User auth + Owner / VA role separation
- Dark/light mode (retrofit is painful; design both from day one)
- Configuration settings: API keys, Gmail accounts, integration status

**Differentiators (v1.x — add once core loop is stable):**
- VA approval queue (draft -> pending_review -> approved -> sent)
- Smart reply templates for 10 PRD-defined scenarios (start with 1 in v1)
- Full-text email search (basic filter in v1)
- Snooze / follow-up reminders
- Client history view (aggregate interactions per client email)
- Manual job linking (escape hatch when auto-match fails)
- Batch AI reply generation for high-volume VAs

**Defer to v2+:**
- Proposal generation (different infrastructure and context requirements from replies)
- Pipeline/Kanban board (inbox status labels provide 80% of value now)
- Follow-up engine (requires reliable scheduled send infrastructure)
- Analytics dashboard (needs data accumulation first)
- WhatsApp digest / notifications

**Anti-features (deliberate non-scope):**
- Full CRM with invoicing/contracts (Upwork handles this natively)
- Upwork direct scraping (ToS violation; leadhack.info handles this)
- Multi-platform support (Freelancer.com, Fiverr) in v1
- Auto-send without human review (non-negotiable UX safety)
- Gmail push notifications in MVP (polling every 60-90s is sufficient and far simpler)
- Mobile native app (desktop workflow; responsive web is sufficient)

**Feature dependency chain:**
Gmail OAuth + Multi-Account -> Email Sync Engine -> Unified Inbox -> Job Context Matching -> AI Reply Generation -> Smart Templates / Proposal Generation. All features downstream of Gmail OAuth; auth and configuration are required before anything else can be tested.

---

### From ARCHITECTURE.md

**Major components and responsibilities:**

| Layer | Responsibility |
|-------|----------------|
| React SPA (Vite) | All UI; no SSR needed for a dashboard |
| API Client Layer | Axios/fetch wrapper with auth interceptors; components never call external services directly |
| Route Layer (Express) | Thin controllers: validate input, call service, format response |
| Service Layer | All business logic; orchestrates integrations and repositories |
| Repository Layer | Thin SQL query layer only; no business logic |
| Integration Clients | One client per external service (Gmail, Claude, leadhack); singletons; encapsulate auth, retries, rate limiting |
| PostgreSQL | Primary data store for all application entities |

**Key patterns to follow:**
1. **Service Layer Orchestration:** Routes are thin; services orchestrate; repositories handle data only. This is not optional — it's required for testability and for reusing logic across API requests and background jobs.
2. **Integration Client Wrapper:** Each external API (Gmail, Claude, leadhack) gets a dedicated module that handles auth, retries, and error mapping. No other layer makes direct HTTP calls to external services.
3. **Encrypted Settings Store:** AES-256-GCM encryption for all credentials at rest. Encryption key lives in environment variables, never in the database. This is foundational, not a later enhancement.
4. **Gmail Incremental Sync (historyId):** Use `history.list(startHistoryId)` for all syncs after initial setup. Never full-list poll on every cycle. Dramatically reduces quota usage.
5. **Async AI Generation:** Never block the request handler for Claude API calls. Return a job ID with `status: 'generating'`; frontend polls or uses SSE for completion.

**Database schema highlights:**
- 7 core tables: users, email_accounts, emails, jobs, replies, leads, settings, (audit_log, knowledge_base)
- UUIDs everywhere (no auto-increment integer IDs)
- JSONB for flexible schema fields (permissions, score_breakdown, labels, raw_headers)
- jobs table caches leadhack responses locally (critical for resilience)
- knowledge_base table stores portfolio pieces / rate cards injected into AI prompts
- audit_log tracks all significant actions (essential for Owner oversight of VA activity)

**Recommended build order (from ARCHITECTURE.md):**
- Phase 1: DB schema + Auth + Settings + Frontend scaffold
- Phase 2: Gmail OAuth + sync engine + inbox UI
- Phase 3: Leadhack integration + Claude integration + Reply composer
- Phase 4: Lead scoring + knowledge base + VA permissions + audit logging

---

### From PITFALLS.md

**Top 6 critical pitfalls with prevention strategies:**

**1. OAuth2 refresh token silent expiry (CRITICAL)**
Google expires refresh tokens after 7 days for unverified apps. All Gmail accounts silently disconnect. Prevention: push app to Production status in Google Console (budget 2-4 weeks for OAuth verification); implement proactive token health check every 4 hours; build re-auth UI banner for disconnected accounts; request all scopes upfront (gmail.modify covers read + send + label).

**2. Gmail watch() expiry every 7 days (CRITICAL)**
Push notifications stop silently after 7 days. Prevention for MVP: skip push notifications entirely and use polling only (every 60-90 seconds). For post-MVP: implement a cron job that renews watch() every 6 days per account. Always run polling as a fallback regardless.

**3. Claude API cost explosion (CRITICAL)**
Unconstrained generation (no max_tokens, no regeneration limits, full job descriptions) can cause invoice shock. Prevention: per-user daily token budgets in DB; max_tokens: 1024 for replies; truncate job descriptions to 2,000 characters; hard cap on regenerations (warn at 3, stop at 5); never auto-generate; log every API call with token count and estimated cost.

**4. LeadHack as single point of failure (HIGH)**
leadhack.info going down kills job context and degrades AI replies to generic output. Prevention: cache all job data in the local jobs table; implement circuit breaker (stop requests after 3 consecutive failures, serve from cache); 5-second timeout on all leadhack calls; UI degrades gracefully without job context (show email, allow manual job entry).

**5. Gmail API quota exhaustion with multiple accounts (HIGH)**
Concurrent syncs for multiple accounts on server restart cause thundering herd. Prevention: stagger account polling (one account every N seconds across the interval); incremental historyId sync; exponential backoff with jitter on 429 responses; paginate initial sync (last 7 days first, backfill async).

**6. Insecure credential storage (CRITICAL)**
Plain-text OAuth tokens + API keys in PostgreSQL = catastrophic breach surface. Prevention: AES-256-GCM encryption for all sensitive settings; encryption key in env variables only; configure morgan to redact Authorization/Cookie headers; all API keys stay server-side (never in frontend bundle); parameterized queries only (no SQL string interpolation).

**Additional domain-specific risks:**
- Email-to-job matching is inherently fragile (fuzzy match required, not exact string; manual linking escape hatch needed)
- Multi-account send identity confusion (always lock reply account to receiving account; color-code by account in UI)
- Theme flash on page load in dark mode (apply theme via blocking `<script>` in `<head>` before React hydrates)
- Gmail message parsing complexity (multipart MIME is deeply nested; build a robust recursive parser, not a happy-path one)
- Hardcoded Claude model names break when models are deprecated (use config/env variable for model selection)

---

## Implications for Roadmap

### Recommended Phase Structure

**Phase 1: Foundation**
Rationale: Every other feature requires authenticated users, encrypted credential storage, and a working database schema. Cannot test Gmail without stored OAuth tokens. Cannot test Claude without stored Anthropic API key. Build this first and build it right — security shortcuts taken here propagate everywhere.

Delivers: User login, Owner/VA roles, settings management (API keys, encrypted at rest), base DB schema (all 7 core tables + migrations), React SPA scaffold with routing, dark/light theme, login page.

Features from FEATURES.md: User auth + roles, dark/light mode, configuration settings, API key management, integration status dashboard.

Pitfalls to address: Encrypted settings store (AES-256-GCM), CORS origin whitelist, JWT expiry/refresh token rotation, morgan header redaction.

Research flag: Standard patterns. No `/gsd:research-phase` needed.

---

**Phase 2: Email Ingestion**
Rationale: Emails are the raw input to all other features. Cannot build job matching, AI replies, or lead scoring without actual emails in the database. The sync engine architecture (historyId, staggered polling, quota management) must be designed correctly from the start — retrofitting is painful.

Delivers: Gmail OAuth flow (multi-account add/reconnect), incremental Gmail sync with historyId, email parsing (robust multipart MIME), unified inbox UI with threading, read/unread status, account filters, manual sync trigger, sync status indicator.

Features from FEATURES.md: Multi-account Gmail inbox, unified inbox view, email threading, read/unread, email composition/sending, manual refresh/sync indicator.

Pitfalls to address: OAuth token silent expiry (proactive health check + re-auth UI), gmail.modify scope requested upfront, polling-only sync (no push in MVP), staggered multi-account polling, incremental historyId sync, duplicate detection, account-isolated error handling.

Research flag: Needs `/gsd:research-phase` for Gmail OAuth verification flow and historyId incremental sync implementation details.

---

**Phase 3: Job Context + AI Replies**
Rationale: This is the core value proposition of the product. Requires Phase 2 (emails must exist) and Phase 1 (Claude API key must be configured). The AI generation pipeline must be async from day one (never block the request handler). Cost controls must be built into the generation layer before VAs start using it.

Delivers: leadhack.info client with caching and circuit breaker, job auto-matching on email ingestion, manual job linking fallback, Claude API integration with SSE streaming, prompt template system (start with 1 general template), reply composer UI (generate, preview, edit, send), async generation with polling/SSE, per-user token budgets, regeneration limits.

Features from FEATURES.md: Job context auto-matching, job description display, match confidence indicator, manual job linking, one-click AI reply generation, edit-before-send UI, tone/style selection.

Pitfalls to address: Claude cost controls (max_tokens, token budgets, regeneration cap), job description truncation (2,000 chars), leadhack circuit breaker + local cache, async AI generation (never block request handler), input sanitization for email content in prompts.

Research flag: Needs `/gsd:research-phase` for prompt template design and Claude streaming SSE pattern verification.

---

**Phase 4: Lead Scoring + VA Workflow + Polish**
Rationale: Enhances the core loop but is not blocking for the primary workflow. Lead scoring uses the same job context infrastructure from Phase 3. VA delegation requires stable auth (Phase 1) and a working reply flow (Phase 3).

Delivers: Lead scoring algorithm (budget, fit, client history, urgency), lead dashboard UI, knowledge base management (portfolio pieces, rates, example replies for few-shot prompting), VA approval queue (draft -> pending_review -> approved -> sent), granular VA permissions, audit logging, expanded prompt templates (up to 10 PRD scenarios).

Features from FEATURES.md: Lead scoring (basic), VA approval queue, smart reply templates (expanded), email-to-lead conversion tracking, client history view.

Pitfalls to address: Row-level filtering for VA access (VAs cannot see other accounts' data), approval state transitions, audit log for owner visibility.

Research flag: Standard patterns. No `/gsd:research-phase` needed.

---

**Phase 5: v1.x Enhancements**
Rationale: Quality-of-life features that increase stickiness once the core loop is validated.

Delivers: Full-text email search, keyboard shortcuts (j/k/r/g/Enter), snooze/follow-up reminders, batch AI reply generation, manual job linking (if auto-match failure rate > 15%).

Features from FEATURES.md: Search, keyboard shortcuts, snooze/reminders, batch processing, conversion tracking.

Research flag: Standard patterns. No `/gsd:research-phase` needed.

---

### Cross-Phase Principles

1. **Degrade gracefully at every integration boundary.** If leadhack is down: show email, hide job panel, allow manual entry. If Claude is slow: show progress, handle timeout, show partial output. If Gmail token expires: show re-auth banner, don't block the rest of the inbox.

2. **Security is Phase 1, not a retrospective.** Encrypted credentials, redacted logs, CORS origin whitelist, and JWT rotation must all be in place before any external credential is stored. No exceptions.

3. **Never auto-send AI-generated content.** Every AI reply must pass through human review and an explicit "Approve & Send" action. This is a product safety invariant, not a preference.

4. **Claude API costs require active management.** Token budgets, max_tokens, and generation limits are not optional features — they are required infrastructure before VAs use the system at any volume.

5. **Gmail is a quota-constrained resource.** The sync engine must treat Gmail API quota as a finite shared resource across all connected accounts from day one.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry on 2026-02-28. Existing codebase confirms Node/Express/PostgreSQL versions. Compatibility matrix explicitly verified. |
| Features | MEDIUM | Competitor feature landscape based on training data through May 2025. Core product features derived from PROJECT.md (HIGH confidence). Competitor details may have evolved. |
| Architecture | MEDIUM | Service/repository/integration patterns are well-established (HIGH confidence). Gmail API historyId sync and Claude streaming SSE patterns are training data (MEDIUM — verify against current docs during Phase 2 and 3 implementation). |
| Pitfalls | MEDIUM-HIGH | OAuth 7-day expiry and Gmail watch() expiry are well-documented, long-standing behaviors (HIGH confidence). Specific Gmail quota numbers and Claude API pricing should be verified against current docs at implementation time. |
| Overall | MEDIUM-HIGH | Core architectural decisions and technology choices are solid. External API behavior details (Gmail quotas, OAuth verification process, Claude pricing tiers) require verification against live documentation before Phase 2 and 3 implementation begins. |

---

## Gaps to Address

The following were identified during research but could not be fully resolved. Flag these for validation during planning and early implementation:

1. **Gmail OAuth app verification timeline.** Google's verification process for sensitive scopes (gmail.modify) can take 2-4 weeks and may require a security assessment. This needs to be started before Phase 2 development begins, not after. Verify current requirements at myaccount.google.com/permissions.

2. **leadhack.info API contract.** The API is a first-party custom service documented in PROJECT.md, but specific response shapes for edge cases (no match, partial match, multiple matches) need to be confirmed against actual API responses during early Phase 2/3 development.

3. **Railway Redis pricing.** BullMQ requires Redis. If Railway Redis cost is prohibitive, the fallback is pg-boss (PostgreSQL as queue backend). This decision should be made before Phase 2 begins to avoid rebuilding the job queue.

4. **Claude model availability.** Research uses claude-sonnet-4-20250514 as the recommended model. Model IDs are version-specific and can be deprecated. Confirm current available model IDs at docs.anthropic.com before Phase 3 implementation and store the model name in environment configuration, not hardcoded.

5. **Google Cloud Pub/Sub requirement for push notifications.** If push notifications are desired post-MVP, this requires a Google Cloud project separate from OAuth credentials (different setup, different billing account). This should be scoped separately if it becomes a requirement.

6. **Upwork email subject patterns.** Job matching relies on parsing Upwork's email subject format. These patterns (e.g., "New Upwork Message from [Client Name]") are not officially documented and can change. Early Phase 2 testing should validate the actual email formats received before building the matcher.

---

## Sources

Aggregated from research files:

**Stack.md sources:**
- npm registry (all versions verified 2026-02-28) — HIGH confidence
- Existing project package.json and source code (D:/LMS Reply/) — HIGH confidence
- Gmail push notifications pattern (Google Cloud Pub/Sub) — MEDIUM confidence (verify at implementation)
- Anthropic SDK streaming pattern — MEDIUM confidence (verify at implementation)

**Features.md sources:**
- PROJECT.md requirements and constraints — HIGH confidence
- Upwork built-in tools — HIGH confidence
- Competitor products (Bonsai, HoneyBook, Superhuman, Front) — MEDIUM confidence (training data, may have evolved since May 2025)

**Architecture.md sources:**
- Existing codebase (D:/LMS Reply/src/) — HIGH confidence
- PROJECT.md (requirements, leadhack endpoints) — HIGH confidence
- Gmail API historyId sync pattern — MEDIUM confidence (training data; verify docs)
- Express service layer patterns — HIGH confidence (well-established)
- PostgreSQL schema design — HIGH confidence

**Pitfalls.md sources:**
- Google OAuth 7-day testing mode expiry — HIGH confidence (long-standing documented behavior)
- Gmail watch() 7-day expiry — HIGH confidence
- Gmail API quotas — MEDIUM confidence (specific numbers may have changed)
- Claude API pricing/rate limits — MEDIUM confidence (verify before implementation)
- OWASP OAuth security best practices — HIGH confidence

---

*Research summary for: LMS Reply — AI-Powered Upwork Freelancer Reply Cockpit*
*Synthesized: 2026-02-28*
