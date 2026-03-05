---
phase: 14-objection-handling-thread-engine
plan: 02
subsystem: api
tags: [objection-handling, signal-detection, kill-switch, prompt-augmentation, follow-up-count, replies-pipeline]

# Dependency graph
requires:
  - phase: 14-01
    provides: detectSignals.js (detectObjection, detectAgencySensitivity, detectScopeFraming), kill_switch_at column, counter_moves table with 10 seed rows
  - phase: 13-post-generation-validation
    provides: 7-step pipeline in replies.js (Phase 12 + Step 6b) that this plan extends
provides:
  - Extended replies.js pipeline: Step 0.5 signal detection + DB persist, Step 2.5 kill switch with 30-day re-engagement gate, 4 prompt augmentation blocks in buildPromptWithContext(), follow_up_count increment in Step 7
  - All 6 OBJECTION requirements (OBJECTION-01 through OBJECTION-06) wired into production pipeline
affects:
  - 14-03 (tests verify kill switch, signal detection, prompt injection — all implemented here)
  - 14-04 (dormant state tracking uses kill_switch_at + match_status='dormant' set here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget DB update pattern: pool.query().catch() for non-blocking signal persist"
    - "Fail-open counter-move lookup: try/catch around DB fetch, proceed without counter-move on error"
    - "Kill switch gate: FOLLOW_UP_V2 + follow_up_count >= 2 → early return before Claude is called (zero API cost)"
    - "30-day re-engagement: Date.now() - killSwitchAt.getTime() > THIRTY_DAYS_MS before resetting sequence"
    - "Backward-compatible function signature extension: objectionContext = {} default parameter"
    - "Prefer stored values over re-detection: agency_sensitive and client_scope_framing use DB value if already set"

key-files:
  created: []
  modified:
    - src/routes/replies.js

key-decisions:
  - "Step 0.5 placed AFTER Step 1 (email+job loaded) but BEFORE Step 2 (prompt routing) — signal detection needs email body text, which requires email to be loaded first"
  - "Kill switch Step 2.5 placed AFTER Step 2 (promptType known) — kill switch only fires for FOLLOW_UP_V2, so promptType must be determined before checking"
  - "Signal persist is fire-and-forget (no await) — never blocks response even if DB update fails"
  - "Counter-move lookup IS awaited — result is needed for prompt building in Step 5"
  - "Agency_sensitive and client_scope_framing prefer stored DB values over fresh re-detection to avoid overwriting known signals with false negatives"
  - "max_words from counter_moves is a soft prompt instruction (not server-side hard enforcement) — plan explicitly accepts this for Phase 14"
  - "follow_up_count increment placed BEFORE reply_generations audit INSERT so count is accurate if audit write fails"

patterns-established:
  - "Objection context object: { objectionType, agencySensitive, scopeFraming, counterMove } — passed as 7th param to buildPromptWithContext() with {} default"
  - "XML block injection pattern in system prompt: <counter_move>, <technical_q_pattern>, <agency_disclosure>, <scope_framing> — consistent formatting for Claude instruction blocks"
  - "Kill switch returns { killSwitch: true, reason, followUpCount, promptType } — structured early exit with enough context for UI to handle"

requirements-completed:
  - OBJECTION-01
  - OBJECTION-02
  - OBJECTION-03
  - OBJECTION-04
  - OBJECTION-05
  - OBJECTION-06

# Metrics
duration: 2min
completed: 2026-03-05
---

# Phase 14 Plan 02: Pipeline Integration (Signal Detection + Kill Switch + Prompt Augmentation) Summary

**Extended replies.js 7-step pipeline with Step 0.5 signal detection (detectObjection/detectAgencySensitivity/detectScopeFraming), Step 2.5 kill switch with 30-day re-engagement gate, four XML prompt injection blocks in buildPromptWithContext(), and follow_up_count atomic increment in Step 7 — all 6 OBJECTION requirements wired**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-05T17:54:55Z
- **Completed:** 2026-03-05T17:56:56Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added Step 0.5 signal detection block: detects objectionType, agencySensitive, scopeFraming from email/job text; fires non-blocking DB UPDATE; loads counter-move template from DB (awaited); builds `objectionContext` object
- Added Step 2.5 kill switch: fires for FOLLOW_UP_V2 when follow_up_count >= 2, sets match_status='dormant' + kill_switch_at=NOW(); 30-day re-engagement gate clears kill_switch_at and resets count for stale leads; zero Claude API cost on kill (early return before Step 3)
- Updated `buildPromptWithContext()` with 7th param `objectionContext = {}` and four XML injection blocks: counter-move strategy (OBJECTION-02), TECHNICAL_Q Answer→Curiosity→CTA structure (OBJECTION-03), agency disclosure paragraph (OBJECTION-04), scope framing mirror (OBJECTION-05)
- Fixed missing `follow_up_count` increment in Step 7: atomic UPDATE increments count for every completed FOLLOW_UP_V2 — kill switch now has accurate data to fire on the 3rd attempt

## Task Commits

No commits were made — user specified "Do NOT commit" for this execution.

## Files Created/Modified

- `src/routes/replies.js` — Extended with Step 0.5 signal detection (lines ~144-195), Step 2.5 kill switch (lines ~211-242), 4 prompt injection blocks in buildPromptWithContext() (lines ~722-769), follow_up_count increment in Step 7 (lines ~529-540)

## Decisions Made

- **Step 0.5 before Step 2**: Signal detection needs the loaded email/job objects (from Step 1) but must run before promptType is determined (Step 2) because `currentFollowUpCount` is needed at Step 2.5. Naming it "Step 0.5" reflects it logically sits between the loaded data and the routing decision — the naming is intentional for readability.
- **Counter-move IS awaited, signal UPDATE is not**: The signal persist (objection_detected, agency_sensitive, client_scope_framing) is fire-and-forget because the values are already available in-memory via `objectionContext`. The counter-move lookup must be awaited because it fetches a template text needed for prompt building.
- **Prefer stored DB values for re-detection**: `agency_sensitive === true` and `client_scope_framing !== 'UNKNOWN'` use the stored value instead of re-running detection. This prevents a job with no job text on a subsequent call from overwriting a previously-detected value with a false negative.
- **Soft max_words enforcement**: Counter-move max_words appears in the `<counter_move>` XML block as a CRITICAL instruction to Claude but is not enforced server-side. Plan explicitly accepts this — hard enforcement is out of scope for Phase 14.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - lint passed cleanly on first run, all changes applied without conflicts.

## User Setup Required

None - no new environment variables, migrations, or external configuration required. All changes are server-side logic using existing DB columns (added in 14-01).

## Next Phase Readiness

- `src/routes/replies.js` now implements all 6 OBJECTION requirements — ready for Phase 14-03 test coverage
- Kill switch state machine is live: follow_up_count increments on every FOLLOW_UP_V2, fires at count=2, clears at 30 days
- All four prompt augmentation blocks are in production code — can be tested end-to-end with real emails
- No blockers for 14-03 (tests) or 14-04 (dormant state UI)

---
*Phase: 14-objection-handling-thread-engine*
*Completed: 2026-03-05*

## Self-Check: PASSED

- FOUND: src/routes/replies.js (modified — detectSignals import, Step 0.5, Step 2.5, buildPromptWithContext 7th param, 4 injection blocks, follow_up_count increment)
- FOUND: .planning/phases/14-objection-handling-thread-engine/14-02-SUMMARY.md
- Lint: PASSED (npm run lint — no errors, no output)
- No commits made (per user instruction)
