---
phase: 17-ui-upgrades
plan: 01
subsystem: api
tags: [express, reply-generation, variant-parsing, analysis-blocks]

# Dependency graph
requires:
  - phase: 12-prompt-routing-pre-generation
    provides: "extractInternalBlocks, promptType routing, reply generation pipeline"
  - phase: 11-db-prompt-foundation
    provides: "reply_generations table with variant_selected column (migration 005)"
provides:
  - "jobAnalysisBlock and linkAnalysisBlock in POST /api/replies/generate response"
  - "variantA and variantB fields for EMAIL_REPLY_V2 and FOLLOW_UP_V2 prompt types"
  - "PUT /api/replies/:id/variant endpoint for recording variant selection"
  - "recordVariantSelected frontend API helper"
affects: [17-02-PLAN, 17-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Variant delimiter parsing with case-insensitive regex", "Conditional response field inclusion"]

key-files:
  created: []
  modified:
    - src/routes/replies.js
    - client/src/api.js

key-decisions:
  - "Variant parsing only for EMAIL_REPLY_V2 and FOLLOW_UP_V2 -- single-variant prompt types unaffected"
  - "Validation pipeline runs on Variant A when variants present -- Variant A is the primary text"
  - "Variant fields omitted from response when no delimiter found -- backwards compatible"
  - "Variant endpoint updates most recent reply_generations record for the reply's job"

patterns-established:
  - "Conditional response fields: only include variantA/variantB when both are non-null"
  - "Variant delimiter format: ---VARIANT A--- / ---VARIANT B--- with flexible whitespace and casing"

requirements-completed: [UIUP-01, UIUP-05]

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 17 Plan 01: Reply API Extensions Summary

**Analysis blocks (job + link) and dual variant A/B parsing added to reply generation API response with variant selection tracking endpoint**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-05T20:10:55Z
- **Completed:** 2026-03-05T20:12:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- POST /api/replies/generate now returns jobAnalysisBlock and linkAnalysisBlock for the frontend collapsible analysis panel
- Dual variant parsing splits AI output on VARIANT B delimiter for EMAIL_REPLY_V2 and FOLLOW_UP_V2 prompt types
- New PUT /api/replies/:id/variant endpoint records which variant (A or B) the user selected
- Frontend recordVariantSelected API helper added to client/src/api.js

## Task Commits

Each task was committed atomically:

1. **Task 1: Add analysis blocks + variant parsing to generate response** - `889d6aa` (feat)
2. **Task 2: Add PUT /api/replies/:id/variant endpoint + frontend API helper** - `6df8f41` (feat)

## Files Created/Modified
- `src/routes/replies.js` - Added variant parsing (Step 6a), analysis blocks in response, PUT /:id/variant endpoint
- `client/src/api.js` - Added recordVariantSelected method

## Decisions Made
- Variant parsing runs only for EMAIL_REPLY_V2 and FOLLOW_UP_V2 prompt types -- other types (THREAD_CONTINUATION_V1, PROPOSAL_V4, LOVABLE_MOCKUP_V1) are unaffected
- When variants are parsed, cleanText is reassigned to variantA so the existing validation pipeline (Step 6b) runs on the primary text
- variantA and variantB are only added to the response when both are non-null -- if the AI doesn't produce the delimiter, the response is backwards compatible
- The variant endpoint looks up the reply's job_id then updates the most recent reply_generations record for that job

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Frontend plans 17-02 (collapsible analysis panel) and 17-03 (variant selector UI) can now consume the new API response fields
- All data needed by the frontend is available: jobAnalysisBlock, linkAnalysisBlock, variantA, variantB
- Variant selection tracking is ready via PUT /api/replies/:id/variant

## Self-Check: PASSED

- [x] src/routes/replies.js exists
- [x] client/src/api.js exists
- [x] 17-01-SUMMARY.md exists
- [x] Commit 889d6aa found (Task 1)
- [x] Commit 6df8f41 found (Task 2)
- [x] npm run lint passes clean

---
*Phase: 17-ui-upgrades*
*Completed: 2026-03-06*
