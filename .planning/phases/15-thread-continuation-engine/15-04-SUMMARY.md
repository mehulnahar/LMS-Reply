---
phase: 15-thread-continuation-engine
plan: 04
subsystem: api
tags: [postgres, open-tracking, hot-signal, emails, thread-engine]

# Dependency graph
requires:
  - phase: 15-thread-continuation-engine plan 01
    provides: open_count and hot_signal_flagged columns in emails table (migration 009)

provides:
  - POST /api/emails/:id/open-count endpoint with atomic increment + hot signal flag logic

affects:
  - 15-05 (thread continuation reply generation can read hot_signal_flagged when enriching context)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic UPDATE + RETURNING avoids race conditions: open_count incremented and RETURNING used in one statement"
    - "CASE WHEN (open_count + 1) >= 10 pattern reads post-increment value for correct threshold check"
    - "hot_signal_flagged stays true once set (ELSE hot_signal_flagged) — flag is permanent once triggered"

key-files:
  created: []
  modified:
    - src/routes/emails.js

key-decisions:
  - "CASE uses (open_count + 1) not open_count — reads post-increment value so flag fires exactly at 10, not 11"
  - "hot_signal_flagged uses ELSE hot_signal_flagged (not ELSE false) — once flagged, stays flagged on subsequent increments"
  - "updated_at included — confirmed existing in emails table via grep before adding to UPDATE"

patterns-established:
  - "Pattern: Manual open tracking via API endpoint is the Phase 15 path — no pixel/tracking infrastructure needed"

requirements-completed:
  - THREAD-07

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 15 Plan 04: Open Count Increment Endpoint Summary

**Atomic POST /api/emails/:id/open-count endpoint that increments open_count and auto-sets hot_signal_flagged at 10 opens using a single UPDATE...RETURNING statement**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-05T18:39:14Z
- **Completed:** 2026-03-05T18:44:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `POST /:id/open-count` route to `src/routes/emails.js` before the DELETE endpoint
- Atomic UPDATE via `UPDATE emails SET open_count = open_count + 1, hot_signal_flagged = CASE WHEN (open_count + 1) >= 10 THEN true ELSE hot_signal_flagged END, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id, open_count, hot_signal_flagged`
- `requireAuth` enforced — 404 returned when email not found or owned by another user
- Returns `{ openCount, hotSignalFlagged }` — caller immediately knows current state
- 83 unit tests pass; integration tests blocked by pre-existing Railway DB safety guard (unrelated)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add POST /api/emails/:id/open-count endpoint to emails.js** - `b26ea6e` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `src/routes/emails.js` - Added open-count route (32 lines inserted before DELETE endpoint)

## Decisions Made
- `CASE WHEN (open_count + 1) >= 10` reads the post-increment value — ensures the flag fires at exactly 10 (not 11)
- `ELSE hot_signal_flagged` used in CASE — hot signal is permanent once triggered, not reversible by subsequent reads
- `updated_at = NOW()` included — confirmed the column exists in emails table before adding (used in 9 other UPDATE statements in this file)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Integration tests blocked by pre-existing Railway production DB safety guard in `setup.js` (DATABASE_URL points to Railway). This guard existed before Plan 04 and is unrelated to our changes. Unit tests (83 tests) all pass.

## User Setup Required
None - no external service configuration required. `open_count` and `hot_signal_flagged` columns were created in migration 009 (Plan 01).

## Next Phase Readiness
- Open-count endpoint is live and callable from the UI
- Plan 05 (thread continuation reply generation) can read `hot_signal_flagged` from the emails row for context enrichment
- Frontend can increment opens via `POST /api/emails/:id/open-count` and display the current count

## Self-Check: PASSED

- `src/routes/emails.js` open-count route — FOUND (lines 288–292)
- Commit `b26ea6e` — FOUND

---
*Phase: 15-thread-continuation-engine*
*Completed: 2026-03-06*
