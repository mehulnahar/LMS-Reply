---
phase: 14-objection-handling-thread-engine
plan: 04
subsystem: ui
tags: [react, inbox, kill-switch, dormant, reply-generation]

# Dependency graph
requires:
  - phase: 14-02
    provides: killSwitch boolean and killSwitchReason string in API response from /api/replies/generate
  - phase: 12
    provides: suppressed/suppressedReason amber panel pattern used as visual reference

provides:
  - Kill Switch red notice panel in Inbox.jsx reply editor area
  - killSwitch + killSwitchReason useState declarations
  - State cleared on email switch (no stale kill switch notice)
  - killSwitch check fires before suppressed check in handleGenerate

affects: [14-05, future-reply-flow-enhancements]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Kill Switch panel uses red color scheme (bg-red-50/border-red-200) to visually distinguish from amber suppressed panel"
    - "killSwitch check placed BEFORE suppressed check in handleGenerate — exhausted limit takes priority over OOO suppression"
    - "No-symbol SVG icon (circle with line) used for kill switch vs warning triangle used for suppressed"

key-files:
  created: []
  modified:
    - client/src/pages/Inbox.jsx

key-decisions:
  - "Kill Switch panel is purely informational — no action button added, user must re-engage manually"
  - "killSwitch check before suppressed in handleGenerate — DORMANT state is higher severity than OOO suppression"
  - "Kill switch panel shows 30-day re-engage note as a static secondary line, not configurable"

patterns-established:
  - "Panel hierarchy: killSwitch (red) > suppressed (amber) > replyText (editor) > empty state"

requirements-completed:
  - OBJECTION-06

# Metrics
duration: 8min
completed: 2026-03-05
---

# Phase 14 Plan 04: Kill Switch UI Summary

**Red kill-switch notice panel added to Inbox.jsx reply area, rendering when API returns killSwitch:true with full DORMANT messaging and state cleared on email switch**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-05T09:19:04Z
- **Completed:** 2026-03-05T09:27:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added `killSwitch` and `killSwitchReason` useState declarations adjacent to existing suppressed state
- Wired `setKillSwitch(false)` resets into both `selectEmail()` and the top of `handleGenerate()` — state never bleeds across emails
- Added early-return kill switch handler in `handleGenerate()` before the suppressed check — fires when `data.killSwitch` is truthy
- Rendered red Kill Switch panel (bg-red-50 / border-red-200) as first branch in the reply area conditional, before the amber suppressed panel
- Vite build passes clean with all 51 modules transformed — no React or JS errors

## Task Commits

No commits made per user instruction ("Do NOT commit").

## Files Created/Modified
- `client/src/pages/Inbox.jsx` - Added killSwitch state, clear on email switch, early return in handleGenerate, red Kill Switch notice panel in JSX conditional chain

## Decisions Made
- Kill Switch panel is purely informational with no interactive elements — user action (manual re-engage) happens outside the tool after 30 days
- Kill switch check placed before suppressed check in handleGenerate since an exhausted follow-up sequence is higher severity than OOO suppression
- Static "30 days" re-engage text chosen over configurable value — keeps implementation simple for this plan scope

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — Vite build succeeded on first attempt with no warnings related to the changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Kill Switch UI is complete and ready for end-to-end testing with a real DB job having follow_up_count = 2
- Phase 14-05 can proceed — Kill Switch panel display is now handled frontend-side

---
*Phase: 14-objection-handling-thread-engine*
*Completed: 2026-03-05*

## Self-Check: PASSED

- FOUND: `.planning/phases/14-objection-handling-thread-engine/14-04-SUMMARY.md`
- FOUND: `client/src/pages/Inbox.jsx` with all 8 killSwitch references (state declarations, clears in selectEmail, reset + check in handleGenerate, JSX panel)
- Vite build: clean, 51 modules, no errors
