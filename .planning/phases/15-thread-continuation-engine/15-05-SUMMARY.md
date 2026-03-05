---
phase: 15-thread-continuation-engine
plan: 05
subsystem: ui
tags: [react, inbox, thread-stage, hot-signal, open-count, post-call, next-steps, tailwind]

# Dependency graph
requires:
  - phase: 15-thread-continuation-engine plan 03
    provides: replies.js full thread-continuation pipeline (threadStage, next_steps INSERT, kill switch re-engagement)
  - phase: 15-thread-continuation-engine plan 04
    provides: POST /api/emails/:id/open-count endpoint for hot signal detection

provides:
  - Thread stage badge in Job Context panel (6 color-coded stages)
  - Hot signal badge ("Sharing Internally") + clickable open count button
  - Post-call recap toggle (Recap Only / Full Proposal) persisted via PUT /api/jobs/:id/client-proposal-toggle
  - Next Steps panel displaying up to 3 recent next_steps records via GET /api/jobs/:id/next-steps
  - Three API helpers in client/src/api.js (incrementOpenCount, togglePostCallRecap, getNextSteps)
  - formatJob returns threadStage and clientRequestedProposal
  - GET /api/emails/:id returns openCount and hotSignalFlagged on email object

affects:
  - Phase 16+ (UI now surfaces all Phase 15 thread context — further UI refinements can build on this)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thread awareness state (emailOpenCount, hotSignalFlagged, clientRequestedProposal, nextSteps) cleared on email switch alongside existing state resets"
    - "Optimistic toggle for post-call recap: set state immediately, revert on API failure"
    - "Next steps loaded via fire-and-forget in selectEmail callback when job.id is available"

key-files:
  created: []
  modified:
    - client/src/pages/Inbox.jsx
    - client/src/api.js
    - src/routes/jobs.js
    - src/routes/emails.js

key-decisions:
  - "API helpers added as methods on existing api object (not standalone exports) — matches codebase convention in api.js"
  - "Next steps fetched alongside email detail load (not in a separate useEffect) — avoids extra render cycle and matches existing fire-and-forget pattern"
  - "Thread stage badge, open count, post-call toggle, and next steps all placed within Job Title section of Job Context panel — co-located with the job heading for visual coherence"
  - "GET /api/emails/:id job object also returns threadStage and clientRequestedProposal — detail view gets data from this endpoint, not from formatJob in jobs.js GET route"

patterns-established:
  - "Pattern 1: Thread awareness state follows same clear-on-switch, init-from-detail pattern as killSwitch/suppressed state"
  - "Pattern 2: Optimistic UI toggle with rollback (setClientRequestedProposal then revert on catch) for low-latency button interactions"

requirements-completed:
  - THREAD-01
  - THREAD-03
  - THREAD-07

# Metrics
duration: 3min
completed: 2026-03-06
---

# Phase 15 Plan 05: Thread Awareness UI Summary

**Thread stage badge, hot signal open count button, post-call recap toggle, and next steps panel surfaced in Inbox.jsx Job Context panel with three new API helpers and two new backend endpoints**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-05T18:48:26Z
- **Completed:** 2026-03-05T18:51:13Z
- **Tasks:** 3 (2 auto + 1 auto-approved checkpoint)
- **Files modified:** 4

## Accomplishments
- Four UI elements added to the Job Context panel: thread stage badge (6 colors), open count button with hot signal badge, post-call recap toggle, and next steps panel
- PUT /api/jobs/:id/client-proposal-toggle endpoint for persisting post-call recap mode
- GET /api/jobs/:id/next-steps endpoint returning newest next_steps rows for a job
- formatJob now returns threadStage and clientRequestedProposal fields
- GET /api/emails/:id response now includes openCount, hotSignalFlagged on email and threadStage, clientRequestedProposal on job
- Three API helper methods: incrementOpenCount, togglePostCallRecap, getNextSteps
- State properly clears on email switch and initializes from loaded detail data

## Task Commits

Each task was committed atomically:

1. **Task 1: Add API helpers, backend endpoints, and UI state for thread awareness** - `2f4b1d3` (feat)
2. **Task 2: Add GET /api/jobs/:id/next-steps endpoint (THREAD-09)** - `4b8d45a` (feat)
3. **Task 3: Verify thread stage badge, hot signal, post-call toggle, and next steps panel** - Auto-approved (checkpoint)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `client/src/pages/Inbox.jsx` - Thread stage badge, hot signal badge + open count button, post-call recap toggle, next steps panel in Job Context; 4 new useState hooks; state clear/init logic
- `client/src/api.js` - Three new API helpers: incrementOpenCount, togglePostCallRecap, getNextSteps
- `src/routes/jobs.js` - PUT /:id/client-proposal-toggle endpoint, GET /:id/next-steps endpoint, formatJob extended with threadStage + clientRequestedProposal
- `src/routes/emails.js` - GET /:id response includes openCount, hotSignalFlagged on email object and threadStage, clientRequestedProposal on job object

## Decisions Made
- API helpers added as methods on the existing `api` object rather than standalone named exports -- the entire codebase uses the `api.method()` pattern via the `request()` helper
- Next steps loaded in the `selectEmail` callback right after detail loads, rather than in a separate useEffect -- avoids extra render and matches existing fire-and-forget fetch patterns
- GET /api/emails/:id job object also extended with threadStage and clientRequestedProposal -- the detail view loads data from this endpoint, not from the GET /api/jobs/:id route
- Thread awareness UI elements placed in the Job Title section, after category/subcategory, before Client Info card -- visually coherent grouping

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added threadStage and clientRequestedProposal to GET /api/emails/:id job response**
- **Found during:** Task 1 (wiring UI state initialization)
- **Issue:** Plan specified adding fields to formatJob in jobs.js, but Inbox.jsx loads email detail from GET /api/emails/:id which builds the job object inline (not via formatJob). Without adding the fields here, the UI would never receive threadStage or clientRequestedProposal.
- **Fix:** Added `threadStage: jobRows[0].thread_stage || null` and `clientRequestedProposal: jobRows[0].client_requested_proposal || false` to the job object in emails.js GET /:id response.
- **Files modified:** src/routes/emails.js
- **Verification:** Frontend build succeeds; detail.job.threadStage available in Inbox.jsx
- **Committed in:** `2f4b1d3` (Task 1 commit)

**2. [Rule 1 - Bug] Used api.method() pattern instead of standalone exports for API helpers**
- **Found during:** Task 1 (adding API helpers)
- **Issue:** Plan specified standalone `export const incrementOpenCount = ...` pattern, but api.js uses a single `api` object with all methods. Standalone exports would break the import pattern used throughout the codebase.
- **Fix:** Added incrementOpenCount, togglePostCallRecap, getNextSteps as methods on the `api` object using the existing `request()` helper function.
- **Files modified:** client/src/api.js
- **Verification:** `npm run lint` passes; frontend build succeeds; all methods accessible via `api.incrementOpenCount()` etc.
- **Committed in:** `2f4b1d3` (Task 1 commit)

**3. [Rule 2 - Missing Critical] Combined next steps UI and API helper into Task 1**
- **Found during:** Task 1 (planning UI additions)
- **Issue:** Plan split next steps across Task 1 (state) and Task 2 (endpoint + UI). The getNextSteps API helper and nextSteps state were logically needed in Task 1 when adding the JSX panel and the selectEmail initialization logic.
- **Fix:** Added getNextSteps helper, nextSteps state, and Next Steps panel JSX in Task 1 commit. Task 2 focused purely on the backend endpoint.
- **Files modified:** client/src/api.js, client/src/pages/Inbox.jsx
- **Verification:** Frontend build succeeds; nextSteps state clears on email switch and loads from API
- **Committed in:** `2f4b1d3` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing critical)
**Impact on plan:** All auto-fixes necessary for correctness. The emails.js fix prevents a data gap (UI would never receive thread fields). The api.js pattern fix prevents import errors. The task reordering has no functional impact. No scope creep.

## Issues Encountered
None - all changes compiled, linted, and built on first attempt.

## User Setup Required
None - no external service configuration required. All changes use existing database columns from migration 009 and existing API infrastructure.

## Next Phase Readiness
- Phase 15 is now fully complete: all 5 plans delivered
- Thread continuation engine is end-to-end operational: schema (P01), detection logic (P02), pipeline integration (P03), open-count endpoint (P04), and UI surfacing (P05)
- All THREAD-01 through THREAD-09 requirements addressed across the phase
- Phase 16+ can build on the thread awareness UI for further refinements

## Self-Check: PASSED

- `client/src/pages/Inbox.jsx` - FOUND
- `client/src/api.js` - FOUND
- `src/routes/jobs.js` - FOUND
- `src/routes/emails.js` - FOUND
- Thread stage badge JSX - FOUND
- Open count button JSX - FOUND
- Post-call toggle JSX - FOUND
- Next steps panel JSX - FOUND
- incrementOpenCount in api.js - FOUND
- togglePostCallRecap in api.js - FOUND
- getNextSteps in api.js - FOUND
- client-proposal-toggle route in jobs.js - FOUND
- next-steps route in jobs.js - FOUND
- openCount in emails.js response - FOUND
- hotSignalFlagged in emails.js response - FOUND
- Commit `2f4b1d3` - FOUND
- Commit `4b8d45a` - FOUND

---
*Phase: 15-thread-continuation-engine*
*Completed: 2026-03-06*
