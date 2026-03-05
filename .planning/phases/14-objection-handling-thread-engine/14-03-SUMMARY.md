---
phase: 14-objection-handling-thread-engine
plan: 03
subsystem: testing
tags: [jest, unit-tests, detectSignals, objection-detection, regex, pure-functions]

# Dependency graph
requires:
  - phase: 14-01
    provides: src/utils/detectSignals.js with detectObjection, detectAgencySensitivity, detectScopeFraming

provides:
  - Unit test suite for all three detectSignals functions (32 tests)
  - Verified coverage of all 6 objection types including NONE
  - Priority ordering verification for ALREADY_HIRED > AGENCY > PRICING > COMPARISON > TECHNICAL_Q
  - Edge case coverage (null, empty string, undefined) for all three functions

affects:
  - Phase 14 plans that depend on detectSignals correctness
  - Any future refactoring of detectSignals.js

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unit tests for pure sync functions use Jest 'unit' project (no setup.js, no DB)"
    - "detect-signals.test.js added to both unit testMatch and integration testPathIgnorePatterns"

key-files:
  created:
    - src/tests/detect-signals.test.js
  modified:
    - src/utils/detectSignals.js (bug fix: ALREADY_HIRED pattern too broad)
    - package.json (added detect-signals.test.js to jest unit project)

key-decisions:
  - "ALREADY_HIRED pattern /found someone/ narrowed to /found someone(?!\\s+cheaper)/ — 'found someone cheaper' is COMPARISON not ALREADY_HIRED"
  - "detect-signals.test.js placed in jest unit project (no setup.js) matching prompt-routing and validate-reply pattern"

patterns-established:
  - "Pure-function tests: no supertest, no DB, no mocks — just require + expect"
  - "Jest describe grouping: sub-describe per return value + priority ordering + edge cases"

requirements-completed:
  - OBJECTION-01
  - OBJECTION-04
  - OBJECTION-05

# Metrics
duration: 15min
completed: 2026-03-05
---

# Phase 14 Plan 03: detectSignals Unit Tests Summary

**32-test Jest unit suite covering all three detectSignals pure functions with regex priority verification and null/empty edge cases**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-05T17:42:00Z
- **Completed:** 2026-03-05T17:57:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Created `src/tests/detect-signals.test.js` with 32 passing tests across all three detection functions
- Verified priority ordering: ALREADY_HIRED beats PRICING and AGENCY in detectObjection; PHASES beats HOURS in detectScopeFraming
- Covered all edge cases: null, undefined, and empty string for detectObjection (NONE), detectAgencySensitivity (false), and detectScopeFraming (UNKNOWN)
- Auto-fixed a bug in detectSignals.js: ALREADY_HIRED pattern `/\bfound someone\b/` was too broad — it incorrectly matched "found someone cheaper" which is a COMPARISON signal

## Task Commits

This plan does not commit per instructions (no commit requested by user).

## Files Created/Modified

- `src/tests/detect-signals.test.js` — 32-test unit suite for detectObjection, detectAgencySensitivity, detectScopeFraming
- `src/utils/detectSignals.js` — Bug fix: ALREADY_HIRED regex narrowed with negative lookahead to exclude "found someone cheaper"
- `package.json` — Added detect-signals.test.js to jest "unit" project testMatch and integration testPathIgnorePatterns

## Decisions Made

- Added detect-signals.test.js to the jest "unit" project (no setup.js) matching the established pattern for pure-function tests
- Fixed ALREADY_HIRED regex pattern to use negative lookahead `(?!\s+cheaper)` rather than adding a new pattern — minimal, targeted fix
- Kept the test assertions true to the plan spec: "found someone cheaper, sorry" → COMPARISON (which required the bug fix to match)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ALREADY_HIRED regex matched "found someone cheaper" incorrectly**
- **Found during:** Task 1 (writing and running tests for detectObjection COMPARISON cases)
- **Issue:** The pattern `/\bfound someone\b/i` in OBJECTION_PATTERNS ALREADY_HIRED group matches "found someone cheaper, sorry" before the COMPARISON pattern `/\bfound someone cheaper\b/i` can fire (ALREADY_HIRED has higher priority). The plan spec correctly documents "found someone cheaper" as COMPARISON.
- **Fix:** Changed `/\bfound someone\b/i` to `/\bfound someone(?!\s+cheaper)\b/i` — negative lookahead excludes the price-comparison case while preserving "found someone else already" and similar phrases
- **Files modified:** `src/utils/detectSignals.js`
- **Verification:** All 32 tests pass including the two COMPARISON cases and both ALREADY_HIRED cases

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix — without it the COMPARISON test case specified in the plan would never pass. Lookahead is surgical and doesn't affect any other ALREADY_HIRED patterns.

## Issues Encountered

- Full `npm test` suite shows pre-existing DB connection failure in setup.js (integration tests require Railway PostgreSQL). This is unrelated to this plan's changes — unit tests run cleanly in isolation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- detectSignals.js is now fully tested and the ALREADY_HIRED regex is corrected
- All three detection functions verified correct against real-world email phrases
- Ready for Phase 14 plans that consume detectSignals results for prompt augmentation

---
*Phase: 14-objection-handling-thread-engine*
*Completed: 2026-03-05*

## Self-Check: PASSED

- FOUND: src/tests/detect-signals.test.js
- FOUND: src/utils/detectSignals.js (modified)
- FOUND: .planning/phases/14-objection-handling-thread-engine/14-03-SUMMARY.md
- All 32 tests pass (verified via npx jest)
- npm run lint: clean (no errors)
