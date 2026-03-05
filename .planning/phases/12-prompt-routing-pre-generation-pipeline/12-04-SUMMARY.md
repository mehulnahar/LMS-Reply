---
phase: 12-prompt-routing-pre-generation-pipeline
plan: "04"
subsystem: ui
tags: [react, inbox, prompt-routing, reply-generation, jsx, tailwind]

requires:
  - phase: 12-02
    provides: POST /api/replies/generate returning reply.promptTypeUsed, data.suppressed, data.reason, data.warning

provides:
  - Prompt badge "Using: [Prompt Name]" rendered after generation in reply editor header
  - Override dropdown with 6 options (Auto-detect + 5 prompt types) next to tone selector
  - STOP suppression amber panel replacing blank editor when data.suppressed is true
  - Prefetch warning yellow banner above textarea when data.warning is present
  - api.generateReply() extended to accept options object with tone, promptOverride, source
  - selectEmail() clears all new prompt-routing state on email switch

affects:
  - 12-05
  - 12-06
  - Future phases consuming reply editor UI

tech-stack:
  added: []
  patterns:
    - "Three-way conditional render: suppressed panel OR reply textarea OR placeholder text"
    - "Prompt badge only shown after generation (activePromptType truthy) and not suppressed"
    - "handleGenerate(source) pattern: null=reply, 'proposal', 'mockup' for future source-specific buttons"

key-files:
  created: []
  modified:
    - client/src/api.js
    - client/src/pages/Inbox.jsx

key-decisions:
  - "PROMPT_TYPE_LABELS and PROMPT_OPTIONS defined in Inbox.jsx (not imported from backend) — frontend-only copy avoids cross-boundary import"
  - "Override dropdown placed before tone selector in header controls — matches visual priority (prompt is more specific than tone)"
  - "Generate Reply button calls handleGenerate(null) explicitly to enable future source-specific generate buttons"
  - "Regenerate button also calls handleGenerate(null) — consistent behavior with main generate button"

patterns-established:
  - "State clearing pattern: selectEmail() resets all generation-related state (activePromptType, generationWarning, suppressed, suppressedReason)"
  - "Warning display: generationWarning shown above textarea only when replyText is present (not on suppressed path)"

requirements-completed:
  - PROMPT-03
  - PROMPT-04
  - PREFETCH-05

duration: 15min
completed: 2026-03-05
---

# Phase 12 Plan 04: Frontend Prompt Routing Surface Summary

**Prompt badge ("Using: First Reply"), override dropdown, OOO suppression panel, and prefetch warning display wired into Inbox.jsx reply editor; api.generateReply() extended with promptOverride + source params**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-05T00:00:00Z
- **Completed:** 2026-03-05T00:15:00Z
- **Tasks:** 1 (Task 2 is a checkpoint)
- **Files modified:** 2

## Accomplishments

- `api.generateReply()` now accepts `options` object with `tone`, `promptOverride`, and `source` — passes all three to backend
- Reply editor header shows prompt badge "Using: [Prompt Name]" after generation using `PROMPT_TYPE_LABELS` lookup
- Override dropdown with 6 options (Auto-detect + 5 named prompt types) lets users force a specific prompt on next generation
- STOP/OOO suppression path renders amber "Generation Suppressed" panel with reason text instead of blank textarea
- Prefetch warning (LeadHack failure) shows yellow banner above textarea when `data.warning` is present in response
- Copy to clipboard still writes `replyText` directly — always clean text (internal analysis blocks stripped by backend pipeline)
- Frontend builds with zero errors (vite build: 51 modules, 0 warnings)

## Task Commits

Note: Per instructions, no commits were made. Implementation only.

1. **Task 1: Extend api.js + add all frontend state + update handleGenerate + update Reply JSX** — both files modified

## Files Created/Modified

- `client/src/api.js` — `generateReply` signature changed from `(emailId, tone)` to `(emailId, options)` accepting `tone`, `promptOverride`, `source`
- `client/src/pages/Inbox.jsx` — Added `PROMPT_TYPE_LABELS`, `PROMPT_OPTIONS` constants; 5 new state vars; updated `selectEmail`, `handleGenerate`, reply editor JSX

## Decisions Made

- `PROMPT_TYPE_LABELS` duplicated in frontend (not imported from `src/utils/promptRouter.js`) — correct decision: frontend is a separate build context, no backend imports allowed in client code
- `handleGenerate(source = null)` signature makes the existing "Generate Reply" button pass `null` (= reply source), ready for future proposal/mockup buttons to pass `'proposal'`/`'mockup'` without changing the function
- Override dropdown placed before tone selector in the header controls row — prompt type is a more fundamental choice than tone, so it reads left-to-right in priority order

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. This is a pure frontend change.

## Next Phase Readiness

- Full Phase 12 frontend surface is live: prompt badge + override dropdown + suppression UI + warning display
- Backend pipeline (12-02) + frontend surface (12-04) are both complete
- Phase 12-03 (reply_generations tracking) and 12-05+ can build on the current pipeline
- Users will immediately see which prompt type was used after each generation

---
*Phase: 12-prompt-routing-pre-generation-pipeline*
*Completed: 2026-03-05*

## Self-Check: PASSED

- FOUND: `D:/LMS Reply/client/src/api.js` — contains `promptOverride` (verified)
- FOUND: `D:/LMS Reply/client/src/pages/Inbox.jsx` — contains `Using:`, `promptOverride`, `suppressed`, `generationWarning` (all verified)
- FOUND: `D:/LMS Reply/.planning/phases/12-prompt-routing-pre-generation-pipeline/12-04-SUMMARY.md`
- Build: `vite build` exits 0 — 51 modules, no errors, no warnings
- Clipboard: `navigator.clipboard.writeText(replyText)` — still writes clean replyText (verified)
