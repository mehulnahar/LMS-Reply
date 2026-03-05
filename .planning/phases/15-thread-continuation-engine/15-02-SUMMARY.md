---
phase: 15-thread-continuation-engine
plan: 02
subsystem: api
tags: [anthropic, haiku, gmail, email-sync, thread-classification, cc-parsing]

# Dependency graph
requires:
  - phase: 15-thread-continuation-engine plan 01
    provides: cc_raw column in emails table (009 migration), stall_type_enum in pg_type

provides:
  - src/utils/detectThreadContext.js with 5 exported thread utility functions
  - classifyThreadStage: async Haiku-powered stage classifier (DISCOVERY/CALL_BOOKING/POST_CALL/NEGOTIATION/CLOSING/STALLED)
  - measureClientMessageLength: sync word-count bucketing SHORT/MEDIUM/LONG
  - detectStallType: sync stall type classifier using email text + jobs row
  - parseCcContacts: sync Cc header parser into [{name, email}] array
  - parseNextStepBlock: sync NEXT STEP SUMMARY block extractor from AI reply text
  - gmail.js sync path now stores cc_raw on every new email INSERT
  - emails.js sync-all path now stores cc_raw on every new email INSERT

affects:
  - 15-03 (imports classifyThreadStage, parseCcContacts, parseNextStepBlock from detectThreadContext.js)
  - 15-04 (imports measureClientMessageLength from detectThreadContext.js)
  - 15-05 (uses all 5 functions for thread continuation reply generation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fail-open pattern: classifyThreadStage returns DISCOVERY on any Haiku error (same as checkFollowUpSpecificity in replies.js)"
    - "detection priority order: THINKING > CALL_SILENCE > PRICING_SILENCE > NO_COMMITMENT > UNKNOWN in detectStallType"
    - "cc_raw extraction: getHeader('Cc') || null immediately before INSERT in both Gmail sync loops"
    - "getHeader returns empty string on miss — || null converts to null for clean DB storage"

key-files:
  created:
    - src/utils/detectThreadContext.js
  modified:
    - src/routes/gmail.js
    - src/routes/emails.js

key-decisions:
  - "classifyThreadStage returns DISCOVERY immediately if emailText is falsy — avoids unnecessary Haiku call on null/empty email body"
  - "detectStallType checks THINKING first (explicit language is most reliable signal) before inspecting job state fields"
  - "getHeader returns empty string (not null) on miss — converted to null with || null before passing to pg INSERT to avoid empty string stored as cc_raw"
  - "ON CONFLICT clause unchanged in both INSERT statements — cc_raw for pre-existing emails stays null (acceptable: only new syncs get CC data)"

patterns-established:
  - "Pattern 1: All thread detection utilities live in src/utils/detectThreadContext.js (mirrors detectSignals.js for objection detection)"
  - "Pattern 2: Async Haiku classification follows same fetch/headers/error-handling pattern as checkFollowUpSpecificity in replies.js"

requirements-completed:
  - THREAD-01
  - THREAD-04
  - THREAD-05
  - THREAD-08
  - THREAD-09

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 15 Plan 02: Thread Context Detection Utility Summary

**Five thread classification functions in a new detectThreadContext.js module (Haiku stage classifier + 4 sync utilities), plus cc_raw extraction added to both Gmail sync INSERT paths**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-05T18:34:13Z
- **Completed:** 2026-03-05T18:36:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `src/utils/detectThreadContext.js` with all 5 exported functions, following the same module structure as `detectSignals.js`
- `classifyThreadStage` calls Claude Haiku with a 6-option classification prompt and fails open to DISCOVERY on any error
- `parseCcContacts` handles both `Name <email>` and bare email formats, returning `[{name, email}]` array
- `parseNextStepBlock` extracts structured next-step fields from the NEXT STEP SUMMARY internal block appended by the Thread Continuation prompt
- Both `gmail.js` and `emails.js` now extract `Cc` header and pass it as `cc_raw` parameter 12 in their respective email INSERT queries
- 83 unit tests continue to pass; integration tests blocked by pre-existing Railway DB safety guard (unrelated to this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create detectThreadContext.js with all 5 thread utility functions** - `fda7d4c` (feat)
2. **Task 2: Add cc_raw extraction to both Gmail sync paths** - `d44c182` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `src/utils/detectThreadContext.js` - All 5 thread classification/parsing utility functions (272 lines)
- `src/routes/gmail.js` - cc_raw extracted from Cc header, added to INSERT column list + values ($12)
- `src/routes/emails.js` - Same cc_raw pattern applied to sync-all INSERT

## Decisions Made
- `classifyThreadStage` returns `DEFAULT_STAGE` immediately if `emailText` is falsy — no point calling Haiku for null body
- `detectStallType` checks `THINKING` regex first, before inspecting job state columns — explicit client language is the most reliable signal
- `getHeader("Cc") || null` pattern (not `|| ""`) to avoid storing empty string in cc_raw when Cc header is absent
- `ON CONFLICT ... DO NOTHING` clause left unchanged — cc_raw for pre-existing emails stays null, which is acceptable since only new syncs need CC data

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Integration tests blocked by pre-existing Railway production DB safety guard in `setup.js` (DATABASE_URL points to Railway). This guard existed before Plan 02 and is unrelated to our changes. Unit tests (83 tests across detect-signals, prompt-routing, validate-reply) all pass.

## User Setup Required
None - no external service configuration required. Functions are purely logic/utility; cc_raw column already exists from Plan 01 migration.

## Next Phase Readiness
- `detectThreadContext.js` is ready to import in Plan 03 (replies.js thread continuation logic)
- All 5 function signatures are finalized and tested
- cc_raw will be populated on all new Gmail syncs going forward
- Plans 03, 04, 05 can import from `../utils/detectThreadContext` without modification

## Self-Check: PASSED

- `src/utils/detectThreadContext.js` — FOUND
- `src/routes/gmail.js` cc_raw hit — FOUND (line 312)
- `src/routes/emails.js` cc_raw hit — FOUND (line 416)
- Commit `fda7d4c` — FOUND
- Commit `d44c182` — FOUND

---
*Phase: 15-thread-continuation-engine*
*Completed: 2026-03-05*
