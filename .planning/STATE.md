# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** When a client emails about an Upwork job, the system instantly surfaces the full job context and generates a tailored AI reply -- reducing response time from minutes to seconds.
**Current milestone:** v2.0 — Full Pipeline Upgrade
**Current focus:** Phase 12: Prompt Routing + Pre-Generation

## Current Position

Phase: 15 of 17 (Thread Continuation Engine)
Plan: 5 of 5 in current phase -- PHASE COMPLETE
Status: Phase 15 complete -- all 5 plans delivered
Last activity: 2026-03-06 -- Phase 15 Plan 05 complete (thread awareness UI: stage badge, hot signal, post-call toggle, next steps panel)

Progress (v2.0): [██░░░░░░░░] 28% (2/7 phases)
Progress (overall): [████████░░] Phase 15 of 17 complete

## Performance Metrics

**Velocity:**
- Total plans completed: 1 (v2.0)
- Average duration: ~1 session
- Total execution time: ~2 hours (v2.0)

**By Phase (v2.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 11 (DB + Prompt Foundation) | 1 | ~2h | ~2h |

**Recent Trend:**
- Last 5 plans: Phase 11
- Trend: On track

*Updated after each plan completion*
| Phase 14-objection-handling-thread-engine P01 | 20 | 2 tasks | 2 files |
| Phase 14-objection-handling-thread-engine P03 | 15 | 1 tasks | 3 files |
| Phase 15-thread-continuation-engine P01 | 8 | 1 tasks | 1 files |
| Phase 15-thread-continuation-engine P02 | 3 | 2 tasks | 3 files |
| Phase 15-thread-continuation-engine P03 | 5 | 2 tasks | 1 files |
| Phase 15 P04 | 5 | 1 tasks | 1 files |
| Phase 15 P05 | 3 | 3 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.0 Roadmap]: 10-phase comprehensive build — SHIPPED
- [v2.0 Roadmap]: 7-phase full pipeline upgrade (phases 11–17); DB foundation first, UI upgrades last
- [v2.0 Roadmap]: Quality-over-quantity testing mandate — positive + negative + edge tests after every phase
- [Phase 11]: Migration strategy = additive ALTER TABLE in new numbered migration file (005) — clean, idempotent
- [Phase 11]: Banned phrases seeded from Email_Reply_Prompt_V2 + Thread_Continuation_Prompt_V1 (55 phrases, 8 categories)
- [Phase 11]: Counter-moves seeded from Email_Reply_Prompt_V2 Instruction 6 + Thread_Continuation_Prompt_V1 Instruction 4 (10 moves)
- [Phase 11]: System prompt templates stored per-user for the first owner account (is_system=true, not deletable)
- [v2.0 Roadmap]: Phase 12 (Prompt Routing + Pre-Generation) is the dependency gateway — Phases 13, 14, 15, 16 all depend on it
- [Phase 14]: WHERE NOT EXISTS pattern for counter_moves seed — table has no UNIQUE constraint on counter_move_name (only PRIMARY KEY on id)
- [Phase 14]: detectAgencySensitivity reads job post text (not email body) — input distinction documented in JSDoc
- [Phase 14]: ALREADY_HIRED priority first in detectObjection — closed deals short-circuit before counter-move logic
- [Phase 14-objection-handling-thread-engine]: ALREADY_HIRED regex narrowed with negative lookahead to exclude 'found someone cheaper' — price-comparison case belongs to COMPARISON not ALREADY_HIRED
- [Phase 14-objection-handling-thread-engine]: detect-signals.test.js uses Jest unit project (no setup.js) — pure-function tests don't need DB
- [Phase 14-objection-handling-thread-engine]: Kill Switch panel is purely informational — no action button, user re-engages manually after 30 days
- [Phase 14-objection-handling-thread-engine]: killSwitch check placed before suppressed check in handleGenerate — DORMANT state is higher severity than OOO suppression
- [Phase 15-thread-continuation-engine]: Migration 009 uses IF NOT EXISTS guards throughout — safe to re-run on any environment
- [Phase 15-thread-continuation-engine]: open_count stored per email message (not per job) — hot_signal_flagged set by application when count >= 10
- [Phase 15-thread-continuation-engine]: Sparse index on hot_signal_flagged (WHERE = true) avoids bloating index with majority-false rows
- [Phase 15]: classifyThreadStage returns DISCOVERY immediately if emailText is falsy — avoids unnecessary Haiku call on null/empty email body
- [Phase 15]: detectStallType checks THINKING pattern first before inspecting job state columns — explicit client language is the most reliable stall signal
- [Phase 15]: cc_raw uses getHeader('Cc') || null pattern to avoid storing empty string when Cc header is absent
- [Phase 15-03]: Thread context detection placed after promptType determination (Step 2.5a) not literally in Step 0.5 — promptType must be known before THREAD_CONTINUATION_V1 gate (ReferenceError prevention)
- [Phase 15-03]: STALLED maps to rank -1 in non-regressing stage logic — STALLED is orthogonal to forward progression, can override any stage
- [Phase 15-03]: re_engagement_strategy Haiku call wrapped in async IIFE — kill switch response fires immediately without Haiku latency
- [Phase 15-03]: reply_generation_id passed as null in next_steps INSERT — integer FK linking not required in Phase 15 (BLOCKER-01 fix)
- [Phase 15-04]: CASE uses (open_count + 1) not open_count — reads post-increment value so hot_signal_flagged fires at exactly 10 opens
- [Phase 15-04]: hot_signal_flagged uses ELSE hot_signal_flagged (not ELSE false) — once flagged, stays flagged permanently
- [Phase 15-05]: API helpers added as methods on existing api object (not standalone exports) — matches codebase convention
- [Phase 15-05]: GET /api/emails/:id job object extended with threadStage and clientRequestedProposal — detail view loads from this endpoint
- [Phase 15-05]: Next steps fetched in selectEmail callback alongside detail load (fire-and-forget pattern)

### Pending Todos

- Confirm LeadHack error response shapes for pre-fetch failure handling (Phase 12)
- Run production seed after Railway deploys Phase 11: `node src/config/seeds/seed_v2_foundation.js`

### Blockers/Concerns

- Link analysis (PREFETCH-03) fetches external URLs: need to decide if this runs server-side (privacy, rate limits) or client-side (CORS); Railway server-side is safer

## Session Continuity

Last session: 2026-03-06
Stopped at: Completed 15-05-PLAN.md (Phase 15 complete — thread awareness UI surfaced in Inbox.jsx)
Resume file: None
