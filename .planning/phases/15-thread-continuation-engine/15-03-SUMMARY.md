---
phase: 15-thread-continuation-engine
plan: 03
subsystem: api
tags: [anthropic, haiku, thread-classification, stall-recovery, cc-handling, next-steps]

# Dependency graph
requires:
  - phase: 15-thread-continuation-engine plan 01
    provides: migration 009 (thread_stage_enum, message_length_enum, stall_type_enum, cc_contacts, thread_stage, stall_type, client_message_length, re_engagement_strategy, next_steps table)
  - phase: 15-thread-continuation-engine plan 02
    provides: detectThreadContext.js with classifyThreadStage, measureClientMessageLength, detectStallType, parseCcContacts, parseNextStepBlock

provides:
  - replies.js full thread-continuation pipeline across 8 hooks
  - Step 2.5a: THREAD-01 Haiku stage classification (non-regressing), THREAD-08 message length, THREAD-05 stall type, THREAD-04 CC parsing, fire-and-forget DB persist
  - buildPromptWithContext: THREAD-02/03 depth-based tone + energy + POST_CALL recap gate, THREAD-05 stall_recovery block, THREAD-04 cc_handling block
  - extractInternalBlocks: THREAD-09 NEXT STEP SUMMARY strip + nextStepRawBlock extraction
  - Kill Switch: THREAD-06 fire-and-forget re_engagement_strategy via Haiku
  - Step 7: THREAD-09 next_steps INSERT (guarded by our_action NOT NULL), THREAD-01 final thread_stage persist

affects:
  - 15-04 (uses threadStage, clientMessageLength in prompt building — context now available)
  - 15-05 (full THREAD_CONTINUATION_V1 pipeline is live)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-regressing stage upgrade: STALLED always upgrades, forward-only progression for all other stages"
    - "threadContext object passed as 8th param to buildPromptWithContext — mirrors objectionContext pattern"
    - "nextStepRawBlock returned from extractInternalBlocks — caller (Step 7) uses it for next_steps INSERT without re-reading rawText"
    - "Fire-and-forget async IIFE for re_engagement_strategy — never blocks kill switch response"
    - "NOT NULL guard on our_action before INSERT INTO next_steps — DB constraint enforcement in application layer"

key-files:
  created: []
  modified:
    - src/routes/replies.js

key-decisions:
  - "Thread context detection placed after Step 2 (not literally in Step 0.5) because promptType must be known before THREAD_CONTINUATION_V1 gate — plan's intended semantic is preserved, placement corrected for correctness"
  - "STAGE_RANK maps STALLED to -1 (below DISCOVERY) so STALLED can always override any stage — models 'going quiet' as orthogonal to forward progression"
  - "re_engagement_strategy fire-and-forget IIFE wraps its own try/catch — kill switch response is never delayed by Haiku latency"
  - "reply_generation_id passed as null in next_steps INSERT — linking to audit table INTEGER FK is not required in Phase 15"

patterns-established:
  - "Pattern 1: Thread context detection lives between Step 2 (promptType) and Step 2.5 (kill switch) — any prompt-type-conditional async work follows this ordering"
  - "Pattern 2: extractInternalBlocks returns all extracted blocks in result object — callers never re-read rawText"

requirements-completed:
  - THREAD-01
  - THREAD-02
  - THREAD-03
  - THREAD-04
  - THREAD-05
  - THREAD-06
  - THREAD-08
  - THREAD-09

# Metrics
duration: 5min
completed: 2026-03-05
---

# Phase 15 Plan 03: Thread Continuation Pipeline Summary

**8 thread-continuation hooks wired into replies.js: Haiku stage classification, depth-adaptive tone injection, POST_CALL recap gate, stall recovery strategy, CC contact handling, kill-switch re-engagement via Haiku, NEXT STEP block stripping, and next_steps DB INSERT**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-05T18:39:05Z
- **Completed:** 2026-03-05T18:44:03Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- `detectThreadContext` imported into `replies.js` with all 5 functions (classifyThreadStage, measureClientMessageLength, detectStallType, parseCcContacts, parseNextStepBlock)
- Thread context detection block (Steps 2.5a) fires for THREAD_CONTINUATION_V1: stage classified via Haiku, message length bucketed, stall type detected, CC contacts parsed, and all 4 fields persisted to jobs via fire-and-forget UPDATE
- `buildPromptWithContext` extended with `threadContext` 8th parameter: injects `<thread_context>` (depth, tone, energy, post-call gate), `<stall_recovery>` (stall-type strategy), and `<cc_handling>` (address new CC'd person by name) blocks
- `extractInternalBlocks` strips `--- NEXT STEP SUMMARY` dash-block before returning `cleanText` — the internal block never appears in the reply shown to the user; `nextStepRawBlock` returned for Step 7 use
- Kill Switch branch now fire-and-forgets a Haiku call to generate `re_engagement_strategy` and store it on the jobs row before returning `killSwitch: true`
- Step 7 inserts into `next_steps` table using `parseNextStepBlock(nextStepRawBlock)` with NOT NULL guard on `our_action`; also persists final `thread_stage` to jobs

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire thread context detection into Step 0.5 and store results on jobs** - `b289fce` (feat)
2. **Task 2: Extend pipeline with thread-aware prompt injection, NEXT STEP stripping, and next_steps INSERT** - `884a4cc` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `src/routes/replies.js` — Full thread-continuation pipeline: 8 hooks across import, Step 2.5a, Step 2.5 kill switch, buildPromptWithContext, extractInternalBlocks, Step 6 destructure, Step 7 next_steps INSERT + thread_stage persist (1162 lines, +223 from plan start)

## Decisions Made
- Thread context detection placed after `promptType = determinePromptType(...)` (labeled Step 2.5a) rather than literally in Step 0.5 as the plan described — `promptType` must be known before the `if (promptType === 'THREAD_CONTINUATION_V1')` gate. The plan's intent was preserved; only the file position was corrected for correctness.
- `STALLED` maps to rank -1 in the non-regressing logic so it can always override any forward stage — STALLED is orthogonal to the discovery-to-closing progression (going quiet can happen at any stage)
- `re_engagement_strategy` Haiku call uses an async IIFE so the kill switch response fires immediately; no response latency from Haiku
- `reply_generation_id` passed as `null` to `next_steps` INSERT — linking to the integer FK in `reply_generations` is not required in Phase 15 (plan explicitly calls this out as BLOCKER-01 fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved thread context detection block after promptType determination**
- **Found during:** Task 1 (wiring thread context detection)
- **Issue:** Plan instructed placement "in Step 0.5, before Step 2" but the block uses `promptType === 'THREAD_CONTINUATION_V1'` as a gate, and `promptType` is only defined in Step 2. Placing the block before Step 2 would cause a ReferenceError at runtime.
- **Fix:** Placed the block immediately after the Step 2 OOO short-circuit return (labeled "Step 2.5a") and before the existing Step 2.5 kill switch. All functionality is identical; only the file position changed.
- **Files modified:** src/routes/replies.js
- **Verification:** `node -e "require('./src/routes/replies')"` — no crash. All 83 unit tests pass. `npm run lint` — clean.
- **Committed in:** `b289fce` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — forward reference / placement error in plan)
**Impact on plan:** Auto-fix necessary for correctness (ReferenceError prevention). No scope creep. All 8 thread-continuation hooks delivered exactly as specified.

## Issues Encountered
- Integration tests blocked by pre-existing Railway production DB safety guard in `setup.js` (DATABASE_URL points to Railway). This guard existed before Plan 03 and is unrelated to our changes. Unit tests (83 tests across detect-signals, prompt-routing, validate-reply) all pass.

## User Setup Required
None - no external service configuration required. All changes are backend pipeline logic using already-configured Anthropic API key and existing DB schema from migration 009.

## Next Phase Readiness
- `replies.js` full thread-continuation pipeline is live for THREAD_CONTINUATION_V1 prompt type
- All 8 THREAD-0x requirements completed in this plan
- Plans 04 and 05 can proceed — threadStage, clientMessageLength, stallType, ccContacts are all in scope and passed to buildPromptWithContext via threadContext
- next_steps table will receive rows on every THREAD_CONTINUATION_V1 generation that produces a parseable NEXT STEP SUMMARY block

## Self-Check: PASSED

- `src/routes/replies.js` — FOUND (1162 lines, min_lines 980 satisfied)
- `detectThreadContext` import — FOUND (line 21)
- Thread context detection block (classifyThreadStage call) — FOUND
- `<thread_context>` injection in buildPromptWithContext — FOUND
- `<stall_recovery>` injection in buildPromptWithContext — FOUND
- `<cc_handling>` injection in buildPromptWithContext — FOUND
- NEXT STEP SUMMARY strip in extractInternalBlocks — FOUND
- `nextStepRawBlock` in return objects — FOUND (3 occurrences)
- `re_engagement_strategy` Haiku call in Kill Switch — FOUND
- `INSERT INTO next_steps` in Step 7 — FOUND
- `thread_stage persist` UPDATE in Step 7 — FOUND
- Commit `b289fce` — FOUND
- Commit `884a4cc` — FOUND

---
*Phase: 15-thread-continuation-engine*
*Completed: 2026-03-05*
