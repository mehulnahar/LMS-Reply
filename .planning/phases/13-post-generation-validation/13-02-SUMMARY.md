---
phase: 13-post-generation-validation
plan: 02
subsystem: api
tags: [validation, anthropic, banned-phrases, follow-up, reply-generation, haiku]

# Dependency graph
requires:
  - phase: 13-01
    provides: validateReply.js utility (proposalGate, bannedPhraseScanner, nextStepScanner, metricsScanner)
  - phase: 12
    provides: 7-step reply generation pipeline in replies.js
  - phase: 11
    provides: banned_phrases table, reply_generations table, follow_up_1_angle/follow_up_2_angle columns on jobs
provides:
  - Step 6b validation pipeline inserted between extractInternalBlocks and INSERT in replies.js
  - Banned phrase cache (module-scope, 5-min TTL, fail-open)
  - Proposal gate scan on every generated reply
  - Banned phrase auto-rewrite with violation tracking
  - Next-step detection on every reply
  - Haiku specificity check loop (max 2 retries) for FOLLOW_UP_V2
  - Haiku angle extraction for FOLLOW_UP_V2 with DB storage
  - FU2 angle differentiation context injected before Claude Sonnet call
  - Extended API response: bannedPhraseViolations, hasNextStep, specificityFlag, followUpSequence
  - reply_generations audit row on every generation (fail-open, skipped when no job)
  - Extended INSERT with validation columns: banned_phrases_caught, has_next_step, proposal_gate_fired, specificity_attempts, specificity_flag, validation_warnings
affects:
  - 13-03 (frontend validation display)
  - 13-04 (analytics dashboard will read reply_generations)
  - Phase 14 UI Upgrades (flag-mode highlighting deferred here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Module-scope cache with TTL refresh for banned phrases (avoids per-request DB hit)
    - Fail-open validation (all scanner failures return empty/default, never block generation)
    - Haiku as lightweight classifier (YES/NO specificity check, angle extraction)
    - Validation pipeline slotted between extraction and INSERT so stored text is always clean

key-files:
  created: []
  modified:
    - src/routes/replies.js

key-decisions:
  - "Banned phrase cache is module-scope with 5-min TTL — avoids per-request DB round trip while staying responsive to Settings changes"
  - "reply_generations insert is skipped (not just failed) when job.id is null — lead_id is NOT NULL in DB, skip prevents guaranteed failure"
  - "thread_stage_detected column omitted from reply_generations insert — its type is thread_stage_enum, not prompt_type_enum; passing promptType would cause a DB type error"
  - "FU2 angle differentiation injected before the initial Claude call (inside buildPromptWithContext) — ensures angle avoidance is baked into generation, not just post-hoc"
  - "clientRequestedPricing hardcoded to false (Phase 14+ toggle) — documented clearly in code"
  - "Specificity retry loop uses while loop capped at 2 attempts — specificityFlag=true only after both attempts exhausted"

patterns-established:
  - "Fail-open validation: catch every scanner call, return safe defaults, never block response"
  - "Validated text replaces cleanText before INSERT — DB always contains post-scan clean text"
  - "Audit record writes are wrapped in try/catch inside the route — generation never fails due to audit failure"

requirements-completed:
  - VALIDATE-01
  - VALIDATE-02
  - QUALITY-01
  - QUALITY-02
  - QUALITY-03
  - QUALITY-04

# Metrics
duration: 25min
completed: 2026-03-05
---

# Phase 13 Plan 02: Post-Generation Validation Pipeline Summary

**Step 6b validation pipeline integrated into replies.js: proposal gate + banned phrase auto-rewrite + next-step detection on every generation, plus Haiku specificity retry loop and angle extraction for FOLLOW_UP_V2**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-05T00:00:00Z
- **Completed:** 2026-03-05T00:25:00Z
- **Tasks:** 1 (single comprehensive task)
- **Files modified:** 1

## Accomplishments

- Added module-scope banned phrase cache with 5-minute TTL and fail-open stale fallback
- Inserted Step 6b between Step 6 (extractInternalBlocks) and Step 7 (INSERT) — stored reply text is always post-validation clean
- Extended replies INSERT to write 6 new validation columns (banned_phrases_caught, has_next_step, proposal_gate_fired, specificity_attempts, specificity_flag, validation_warnings)
- Added reply_generations audit row on every generation with job match (fail-open, skipped when no job)
- Extended API response with bannedPhraseViolations, hasNextStep, specificityFlag, followUpSequence, validationWarnings
- Added two Haiku helper functions: checkFollowUpSpecificity (YES/NO classifier) and extractFollowUpAngle (5-10 word angle description)
- Injected FU1 angle differentiation into buildPromptWithContext for FOLLOW_UP_V2 FU2 generation

## Task Commits

No commits made — user requested implementation + lint-check only (no commit).

## Files Created/Modified

- `src/routes/replies.js` — Added Step 6b pipeline, banned phrase cache, 2 Haiku helpers, extended INSERT + API response, FU2 angle differentiation in buildPromptWithContext

## Decisions Made

- Banned phrase cache is module-scope with 5-min TTL — avoids per-request DB round trip while staying responsive to Settings changes without server restart
- reply_generations insert is skipped (not just caught-and-failed) when job.id is null — lead_id is NOT NULL in the DB schema, passing null would always error
- thread_stage_detected column omitted from reply_generations insert — its DB type is thread_stage_enum, but promptType is prompt_type_enum; passing the wrong type would cause a DB cast error at runtime
- FU2 angle differentiation injected before the Claude Sonnet call (inside buildPromptWithContext), not after — ensures angle avoidance shapes generation rather than just informing post-hoc review
- clientRequestedPricing hardcoded to false — documented in code for Phase 14+ toggle implementation
- Specificity retry loop uses `while (specificityAttempts < 2)` — flag only set after both attempts exhausted (matches spec: "max 2 retries")

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Omitted thread_stage_detected from reply_generations insert**
- **Found during:** Task 1 (Step 6b implementation)
- **Issue:** Plan specified `thread_stage_detected = promptType` but thread_stage_detected is typed as `thread_stage_enum` in the DB (DISCOVERY, CALL_BOOKING, POST_CALL, etc.) while promptType is a `prompt_type_enum` value (EMAIL_REPLY_V2, FOLLOW_UP_V2, etc.). PostgreSQL would reject the insert with a type cast error.
- **Fix:** Omitted thread_stage_detected from the INSERT — column has no DEFAULT so it will be NULL, which is valid. Column is nullable in the schema.
- **Files modified:** src/routes/replies.js
- **Verification:** Lint passes; no type mismatch in INSERT column list

**2. [Rule 1 - Bug] Guarded reply_generations insert with `if (job && job.id)` check**
- **Found during:** Task 1 (Step 6b implementation)
- **Issue:** Plan's reply_generations INSERT used `job?.id || null` for lead_id, but the schema defines lead_id as `UUID NOT NULL REFERENCES jobs(id)` — a null lead_id would always error when there's no matched job
- **Fix:** Wrapped the entire reply_generations INSERT in `if (job && job.id)` so it only runs when a job exists. Emails without job matches skip the audit row entirely (fail-open by omission, not by error-catch)
- **Files modified:** src/routes/replies.js
- **Verification:** Lint passes; insert only executes with valid non-null job.id

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes prevent guaranteed DB type/constraint errors at runtime. No scope creep — plan intent is preserved.

## Issues Encountered

The test suite refused to run because the environment points to the production Railway database and `src/tests/setup.js` has a production DB guard that calls `process.exit(1)`. This is a pre-existing behavior unrelated to this plan's changes. Lint verification confirmed clean with `npm run lint`.

## User Setup Required

None — no new external service configuration required. Migration 007 must be applied to the production DB (adds validation columns to replies table) — this was handled in Phase 13 Plan 01.

## Next Phase Readiness

- Plan 13-02 complete: Step 6b validation pipeline is live in replies.js
- API response now carries bannedPhraseViolations, hasNextStep, specificityFlag, followUpSequence for frontend to display
- Plan 13-03 (frontend validation display) can now consume these new response fields
- Plan 13-04 (analytics dashboard) can query reply_generations table for validation metrics

---

*Phase: 13-post-generation-validation*
*Completed: 2026-03-05*

## Self-Check: PASSED

- `src/routes/replies.js` — FOUND (modified in place)
- `src/utils/validateReply.js` — FOUND (required by replies.js, unchanged)
- `npm run lint` — PASSED (no ESLint errors)
- No commits made per user instruction
