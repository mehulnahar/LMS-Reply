---
phase: 19-inbox-workflow
plan: 01
subsystem: ui, api
tags: [react, express, search, inbox, reactivation, optimistic-ui]

# Dependency graph
requires:
  - phase: 14-objection-handling
    provides: kill switch / dormant job logic
  - phase: 18-prompt-quality
    provides: prompt pipeline and email status management
provides:
  - PUT /api/jobs/:id/reactivate endpoint with 30-day window logic
  - Inbox search input with debounced backend filtering
  - Optimistic auto-move on status change (replied/lost)
  - Re-activate button for lost/ignored/dormant leads
affects: [19-02-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [optimistic-removal, debounced-search, conditional-reactivation]

key-files:
  created: []
  modified:
    - src/routes/jobs.js
    - client/src/pages/Inbox.jsx
    - client/src/api.js

key-decisions:
  - "Re-activate route placed before /:id GET to avoid Express param matching conflict"
  - "Auto-move removes from sidebar on replied/lost even in 'all' view for cleaner workflow"
  - "Partial reactivation keeps kill_switch_at and follow_up_count to respect 30-day cooldown"

patterns-established:
  - "Optimistic removal: filter email from list immediately, clear selection on status auto-move"
  - "Debounced search: 300ms timer ref to avoid API spam on keystroke"

requirements-completed: [FLOW-01, FLOW-02, FLOW-03]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 19 Plan 01: Inbox Workflow Summary

**Inbox search with debounced filtering, optimistic auto-move on status change, and lead re-activation with 30-day kill switch window logic**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-06T18:27:26Z
- **Completed:** 2026-03-06T18:30:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Backend PUT /api/jobs/:id/reactivate endpoint with full/partial reactivation based on 30-day kill_switch_at window
- Inbox search input with 300ms debounce, clear button, and contextual empty state messaging
- Optimistic auto-move: changing email status to replied/lost removes it from sidebar immediately
- Re-activate button conditionally shown for lost/ignored emails and dormant jobs

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend re-activate endpoint + frontend API binding** - `c0d4ecf` (feat)
2. **Task 2: Inbox search input, auto-move on status change, re-activate button** - `d9c408e` (feat)

## Files Created/Modified
- `src/routes/jobs.js` - Added PUT /:id/reactivate endpoint with 30-day window logic, ownership verification via emails join
- `client/src/pages/Inbox.jsx` - Search input, debounced filter, auto-move handleStatusChange, handleReactivate, re-activate button
- `client/src/api.js` - Added reactivateJob API function

## Decisions Made
- Re-activate route placed before /:id GET route to avoid Express interpreting "reactivate" as an ID parameter
- Auto-move removes email from sidebar on replied/lost even in unfiltered "all" view (FLOW-02 spec)
- Partial reactivation (within 30 days) keeps kill_switch_at and follow_up_count intact so follow-up generation stays blocked

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All FLOW-01, FLOW-02, FLOW-03 requirements complete
- Ready for 19-02-PLAN.md (remaining inbox workflow features)

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 19-inbox-workflow*
*Completed: 2026-03-07*
