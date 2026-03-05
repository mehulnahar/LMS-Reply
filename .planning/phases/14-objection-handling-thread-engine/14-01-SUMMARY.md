---
phase: 14-objection-handling-thread-engine
plan: 01
subsystem: api
tags: [objection-detection, signal-detection, postgresql, migrations, counter-moves, kill-switch]

# Dependency graph
requires:
  - phase: 11-db-prompt-foundation
    provides: counter_moves table schema + objection_type_enum + scope_framing_enum
  - phase: 13-post-generation-validation
    provides: validateReply.js pattern (pure sync utility module structure)
provides:
  - detectSignals.js pure sync module with detectObjection, detectAgencySensitivity, detectScopeFraming
  - migration 008: kill_switch_at TIMESTAMPTZ column on jobs + sparse index
  - counter_moves seeded with 10 baseline rows covering all 5 active objection types
affects:
  - 14-02 (imports detectSignals.js for reply pipeline integration)
  - 14-03 (tests detectSignals.js functions)
  - 14-04 (uses kill_switch_at column for dormant state tracking)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure sync utility module pattern (no DB, no async, no side effects) — mirrors validateReply.js"
    - "Priority-ordered pattern matching with first-match-wins semantics"
    - "WHERE NOT EXISTS idempotency pattern for tables without UNIQUE constraints"

key-files:
  created:
    - src/utils/detectSignals.js
    - src/config/migrations/008_kill_switch.sql
  modified: []

key-decisions:
  - "WHERE NOT EXISTS pattern used for counter_moves seed — table has no UNIQUE constraint on counter_move_name (only PRIMARY KEY on id), so ON CONFLICT DO NOTHING cannot be used"
  - "Priority order ALREADY_HIRED > AGENCY > PRICING > COMPARISON > TECHNICAL_Q — closed deals short-circuit before any counter-move logic runs"
  - "detectAgencySensitivity() reads job post text (not email body) — critical input distinction documented in JSDoc to prevent future confusion"
  - "jobs.match_status='dormant' set by app code — VARCHAR is unconstrained, no migration needed for this value"

patterns-established:
  - "Input source distinction: detectObjection/detectScopeFraming take email text; detectAgencySensitivity takes job post text — documented in module header"
  - "Regex patterns as named constants (OBJECTION_PATTERNS, AGENCY_SENSITIVITY_PATTERNS, SCOPE_FRAMING_PATTERNS) for maintainability"

requirements-completed:
  - OBJECTION-01
  - OBJECTION-04
  - OBJECTION-05
  - OBJECTION-06

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 14 Plan 01: detectSignals + Kill Switch Migration Summary

**Three pure sync detection functions (detectObjection, detectAgencySensitivity, detectScopeFraming) plus migration 008 adding kill_switch_at to jobs and seeding 10 counter_moves rows across all 5 active objection types**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-05T17:28:50Z
- **Completed:** 2026-03-05T17:52:24Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Created `src/utils/detectSignals.js` — pure CommonJS detection module with no DB, no async, no side effects
- `detectObjection()` uses priority-ordered pattern matching: ALREADY_HIRED > AGENCY > PRICING > COMPARISON > TECHNICAL_Q, returns NONE for no match
- `detectAgencySensitivity()` scans job post text (not email body) for agency-restriction keywords, returns boolean
- `detectScopeFraming()` detects client scope mental model: PHASES > HOURS > FIXED | UNKNOWN
- Created migration 008 with idempotent DDL (IF NOT EXISTS) and WHERE NOT EXISTS seed inserts
- Applied migration to Railway PostgreSQL — kill_switch_at column and idx_jobs_kill_switch confirmed present
- All 10 counter_moves rows inserted covering PRICING (x2), AGENCY (x1), COMPARISON (x1), ALREADY_HIRED (x1), TECHNICAL_Q (x1), NONE (x4)

## Task Commits

Each task was committed atomically:

1. **Task 1: detectSignals.js** - `abd0c8a` (feat)
2. **Task 2: migration 008_kill_switch.sql** - `cc488b7` (feat)

## Files Created/Modified

- `src/utils/detectSignals.js` — Three pure sync detection functions for objection/agency/scope signal detection
- `src/config/migrations/008_kill_switch.sql` — Idempotent DDL adding kill_switch_at column + index + 10 counter_moves seed rows

## Decisions Made

- **WHERE NOT EXISTS pattern** for counter_moves seed: The table has no UNIQUE constraint on `counter_move_name` (only PRIMARY KEY on `id`), so `ON CONFLICT DO NOTHING` cannot be used. Each of the 10 INSERT statements uses `WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = ...)` for idempotency.
- **Priority ordering ALREADY_HIRED first**: Closed deals must be detected before any other objection to avoid wasteful counter-move logic on lost leads.
- **Input source documented in JSDoc**: `detectObjection` and `detectScopeFraming` take email body text; `detectAgencySensitivity` takes job post text. This distinction is critical for correct usage in Plan 02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used WHERE NOT EXISTS instead of ON CONFLICT DO NOTHING**
- **Found during:** Task 2 (migration creation)
- **Issue:** Plan's primary INSERT form used `ON CONFLICT DO NOTHING`, which requires a UNIQUE constraint. The `counter_moves` table has only a PRIMARY KEY on `id` — no UNIQUE constraint on `counter_move_name` or any other column.
- **Fix:** Used the alternative pattern from the plan's own note: individual `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM counter_moves WHERE counter_move_name = v.counter_move_name)` for each of the 10 rows.
- **Files modified:** `src/config/migrations/008_kill_switch.sql`
- **Verification:** Migration applied twice with no errors. Counter_moves has exactly 10 rows after both runs.
- **Committed in:** `cc488b7` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix for idempotency. Plan itself anticipated this scenario and documented the fallback pattern. No scope creep.

## Issues Encountered

- npm test fails due to pre-existing production DB guard in `src/tests/setup.js` — intentional, non-regression. The `.env` DATABASE_URL points to Railway (production host), which the setup.js refuses to test against. This existed before Plan 14-01.

## User Setup Required

None - migration applied directly to Railway PostgreSQL during execution. No new environment variables required.

## Next Phase Readiness

- `detectSignals.js` ready for Plan 14-02 import: `require('../utils/detectSignals')` — exports verified
- `kill_switch_at` column exists in production jobs table — Plan 14-02's kill switch timestamp persistence is unblocked
- `counter_moves` table has all 10 seed rows — Plan 14-02's objection counter-move lookup is unblocked
- No blockers for Plan 14-02

---
*Phase: 14-objection-handling-thread-engine*
*Completed: 2026-03-05*

## Self-Check: PASSED

- FOUND: src/utils/detectSignals.js
- FOUND: src/config/migrations/008_kill_switch.sql
- FOUND: .planning/phases/14-objection-handling-thread-engine/14-01-SUMMARY.md
- FOUND commit: abd0c8a (feat: detectSignals.js)
- FOUND commit: cc488b7 (feat: migration 008)
