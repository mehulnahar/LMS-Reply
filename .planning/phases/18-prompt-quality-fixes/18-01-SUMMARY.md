---
phase: 18-prompt-quality-fixes
plan: 01
subsystem: ai-prompts
tags: [prompt-engineering, signature, timezone, pricing-detection, pure-functions]

# Dependency graph
requires:
  - phase: 11-db-prompt-foundation
    provides: "seed_v2_foundation.js with PROMPT_TEMPLATES_CONTENT structure"
  - phase: 14-objection-handling
    provides: "validateReply.js pricing patterns for reply output (distinct from detectPricingLanguage for input)"
provides:
  - "promptEnhancements.js: detectPricingLanguage, appendSignatureBlock, formatTimezoneCTA"
  - "Updated prompt templates: greeting rules, POV guard, signature delegation"
affects: [18-02-PLAN, 18-03-PLAN, replies-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-utility-functions, intl-datetimeformat-timezone-formatting, word-boundary-regex-matching]

key-files:
  created:
    - src/utils/promptEnhancements.js
  modified:
    - src/config/seeds/seed_v2_foundation.js

key-decisions:
  - "Used word-boundary regex for single keywords and indexOf for multi-word phrases in detectPricingLanguage"
  - "Signature block strips existing sign-off with flexible regex before appending full company block"
  - "formatTimezoneCTA extracts only the timezone abbreviation via Intl.DateTimeFormat formatToParts, always displaying 11:00 AM"
  - "EMAIL_REPLY_V2 sign-off uses slightly different wording than other templates for contextual clarity"

patterns-established:
  - "Pure utility pattern: no DB, no API, no async -- synchronous functions that never throw"
  - "Graceful degradation: all functions return safe defaults for null/undefined/empty/invalid input"

requirements-completed: [CTA-01, CTA-02, CTA-03, CTA-04, CTA-05, CTA-06]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 18 Plan 01: Prompt Enhancement Utilities + Template Updates Summary

**Three pure utility functions (pricing detection, signature block, timezone CTA) plus greeting rules, POV guard, and signature delegation across all 4 prompt templates**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-06T17:59:45Z
- **Completed:** 2026-03-06T18:03:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `promptEnhancements.js` with 3 exported pure functions handling pricing keyword detection (English + 5 non-English languages), HipHype Tech signature block appending, and timezone CTA formatting with Intl.DateTimeFormat
- Added mandatory Greeting Rule sections to all 4 prompt templates (EMAIL_REPLY_V2, FOLLOW_UP_V2, THREAD_CONTINUATION_V1, PROPOSAL_V4)
- Added CRITICAL POV RULE to FOLLOW_UP_V2 preventing Claude from generating replies in client perspective
- Replaced all "Best, Ashish" sign-offs with system signature delegation instructions across all templates

## Task Commits

Each task was committed atomically:

1. **Task 1: Create promptEnhancements.js utility module** - `f8fe479` (feat)
2. **Task 2: Update prompt template content in seed file** - `0bc4c61` (feat)

## Files Created/Modified
- `src/utils/promptEnhancements.js` - New module: detectPricingLanguage, appendSignatureBlock, formatTimezoneCTA
- `src/config/seeds/seed_v2_foundation.js` - Updated PROMPT_TEMPLATES_CONTENT with greeting rules, POV guard, signature delegation

## Decisions Made
- Used word-boundary regex (`\b`) for single-word pricing keywords and simple `indexOf` for multi-word phrases like "how much" and "fixed price" to avoid regex complexity
- `formatTimezoneCTA` uses `Intl.DateTimeFormat.formatToParts()` to extract only the timezone abbreviation, always displaying "11:00 AM [ABBR] (your time)" -- the time is fixed at 11 AM per CTA convention
- Signature block regex strips existing sign-offs flexibly (handles "Best,\nAshish", "Best, Ashish", and partial old signatures with title/URL)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Seed Re-Run Required

Template changes in `seed_v2_foundation.js` are source-only until the seed is executed against the database. To apply changes:

```bash
node src/config/seeds/seed_v2_foundation.js
```

This must be run:
- Locally after pulling the changes
- In production (Railway) after deployment

The seed uses UPSERT (`INSERT ... ON CONFLICT DO UPDATE`), so re-running is safe and idempotent.

## Next Phase Readiness
- `promptEnhancements.js` exports are ready for Plan 02 to wire into the reply generation pipeline via `require('../utils/promptEnhancements')`
- Template content is updated; once seed is re-run, Claude will receive greeting, POV, and signature instructions in all prompts
- No blockers for Plan 02 or 03

## Self-Check: PASSED

- FOUND: src/utils/promptEnhancements.js
- FOUND: src/config/seeds/seed_v2_foundation.js
- FOUND: .planning/phases/18-prompt-quality-fixes/18-01-SUMMARY.md
- FOUND: f8fe479 (Task 1 commit)
- FOUND: 0bc4c61 (Task 2 commit)

---
*Phase: 18-prompt-quality-fixes*
*Completed: 2026-03-06*
