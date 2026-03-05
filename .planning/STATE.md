# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** When a client emails about an Upwork job, the system instantly surfaces the full job context and generates a tailored AI reply -- reducing response time from minutes to seconds.
**Current milestone:** v2.0 — Full Pipeline Upgrade
**Current focus:** Phase 12: Prompt Routing + Pre-Generation

## Current Position

Phase: 15 of 17 (Thread Continuation Engine)
Plan: 1 of TBD in current phase
Status: In progress — Plan 01 complete
Last activity: 2026-03-05 -- Phase 15 Plan 01 complete (migration 009: 5 schema columns for thread continuation engine)

Progress (v2.0): [█░░░░░░░░░] 14% (1/7 phases)
Progress (overall): [███████░░░] Phase 11 of 17 complete

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

### Pending Todos

- Confirm LeadHack error response shapes for pre-fetch failure handling (Phase 12)
- Confirm email open tracking data availability for Hot Signal Detection (THREAD-07 in Phase 15) — may require Mailsuite/tracking integration or manual input
- Run production seed after Railway deploys Phase 11: `node src/config/seeds/seed_v2_foundation.js`

### Blockers/Concerns

- Email open tracking (THREAD-07) may require a third-party integration (Mailsuite) not yet connected — clarify data source before Phase 15 planning
- Link analysis (PREFETCH-03) fetches external URLs: need to decide if this runs server-side (privacy, rate limits) or client-side (CORS); Railway server-side is safer

## Session Continuity

Last session: 2026-03-05
Stopped at: Completed 15-01-PLAN.md (Phase 15 schema migration 009 — all 5 thread continuation columns applied to Railway PostgreSQL)
Resume file: None
