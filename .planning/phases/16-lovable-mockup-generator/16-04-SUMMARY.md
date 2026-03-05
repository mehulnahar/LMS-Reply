---
phase: 16-lovable-mockup-generator
plan: 04
subsystem: ui, api
tags: [mockup-ui, dual-clipboard, lovable-prompt, generate-mockup-button, mockup-sent-tracking]

# Dependency graph
requires:
  - phase: 16-lovable-mockup-generator
    plan: 02
    provides: "mockupDeclined/mockupData response objects from replies pipeline"
provides:
  - "Generate Mockup button in Inbox reply toolbar (violet, disabled for Day 7)"
  - "Mockup decline panel with reason and alternative suggestion"
  - "Dual clipboard output: Lovable Prompt (violet) + Send Message (blue) as separate copyable sections"
  - "markMockupSent API method and PUT /api/jobs/:id/mockup-sent backend endpoint"
  - "mockupSent field in job formatJob and email detail response"
  - "Mockup Sent badge in Job Context panel"
affects: [client-inbox-ui, job-tracking]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual clipboard pattern: two independent copy-to-clipboard blocks with separate state tracking"
    - "Conditional ternary chain extension: new branches inserted between suppressed and replyText"
    - "Fire-and-forget API call on clipboard copy: markMockupSent triggered when send message copied"

key-files:
  created: []
  modified:
    - client/src/pages/Inbox.jsx
    - client/src/api.js
    - src/routes/jobs.js
    - src/routes/emails.js

key-decisions:
  - "Generate Mockup button placed after Generate Reply in same flex container -- visual distinction via violet color"
  - "Mockup-sent endpoint added to jobs.js (not replies.js) -- follows existing pattern where /api/jobs/:id/* routes live"
  - "mockupSent added to both formatJob (jobs.js) and email detail response (emails.js) -- ensures visibility from both endpoints"
  - "Ternary chain extended (killSwitch > suppressed > mockupDeclined > mockupData > replyText > fallback) rather than nested conditionals"

patterns-established:
  - "Dual clipboard UI pattern: two copyable sections with independent copy state and different visual themes"
  - "Mockup decline flow: early return from pipeline renders informational panel instead of editor"

requirements-completed: [MOCKUP-04, MOCKUP-05]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 16 Plan 04: Mockup Frontend UI Summary

**Generate Mockup button with dual clipboard output (Lovable Prompt + Send Message), mockup decline display, Day 7 disabled state, and mockup_sent tracking via PUT /api/jobs/:id/mockup-sent**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T19:39:05Z
- **Completed:** 2026-03-05T19:42:43Z
- **Tasks:** 2 auto + 1 checkpoint (auto-approved)
- **Files modified:** 4

## Accomplishments
- Generate Mockup button appears inline with Generate Reply in violet styling, disabled for Day 7 follow-ups (follow_up_count >= 2) with explanatory tooltip
- Mockup decline panel (non-visual jobs) shows reason and alternative suggestion in violet themed info box
- Dual clipboard output: Lovable Prompt block (violet header, copy button) and Send Message block (blue header, editable textarea, Copy & Mark Sent button)
- Collapsible Mockup Analysis details section for transparency into decision reasoning
- Copying send message triggers markMockupSent API call (fire-and-forget) to set mockup_sent=true on job
- Mockup Sent badge shown in Job Context panel alongside thread stage badge
- Backend PUT /api/jobs/:id/mockup-sent endpoint added to jobs.js with requireAuth + user_id scoping
- mockupSent field added to both formatJob (jobs.js) and email detail response (emails.js)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add markMockupSent API + backend endpoint** - `54b68a8` (feat)
2. **Task 2: Add Generate Mockup button + mockup output display to Inbox.jsx** - `dc22555` (feat)
3. **Task 3: Visual verification of mockup generator UI** - Auto-approved (checkpoint)

## Files Created/Modified
- `client/src/api.js` - Added markMockupSent method calling PUT /api/jobs/:id/mockup-sent
- `client/src/pages/Inbox.jsx` - Added 161 lines: mockup state variables, handleGenerate mockupDeclined/mockupData handling, Generate Mockup button (violet), mockup decline panel, dual clipboard output (Lovable Prompt + Send Message), Mockup Sent badge in job context
- `src/routes/jobs.js` - Added PUT /:id/mockup-sent endpoint (MOCKUP-05), added mockupSent to formatJob
- `src/routes/emails.js` - Added mockupSent to email detail job response

## Decisions Made
- **Mockup-sent endpoint in jobs.js:** Plan suggested replies.js but noted the path would be awkward (/api/replies/jobs/:id/mockup-sent). Since /api/jobs/:id/client-proposal-toggle already exists in jobs.js, added the endpoint there following the identical pattern (requireAuth, user_id scoping, RETURNING clause)
- **mockupSent in emails.js too:** The email detail endpoint returns job data inline (not via formatJob). Added mockupSent there to ensure the Inbox detail view has the field on initial load, not just after explicit job fetch
- **Ternary chain ordering:** Inserted mockupDeclined and mockupData branches between suppressed and replyText. This ensures kill switch and suppression take priority, while mockup states take priority over normal reply display
- **Editable Send Message textarea:** The send message uses a textarea (not pre) so users can tweak the 60-word message before copying -- follows the same edit-before-copy pattern as the main reply textarea

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added mockupSent to emails.js detail response**
- **Found during:** Task 1
- **Issue:** Plan only mentions jobs.js formatJob but the Inbox detail view loads job data from GET /api/emails/:id which has its own inline job object
- **Fix:** Added `mockupSent: jobRows[0].mockup_sent || false` to the emails.js detail response
- **Files modified:** src/routes/emails.js
- **Verification:** grep confirms field present, lint passes
- **Committed in:** 54b68a8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality)
**Impact on plan:** Essential for correct mockupSent display on initial email load. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 16 (Lovable Mockup Generator) is now complete across all 4 plans
- Full pipeline: decision gate (Plan 01) -> pipeline integration (Plan 02) -> unit tests (Plan 03) -> frontend UI (Plan 04)
- Ready for Phase 17 or production deployment

## Self-Check: PASSED

- [x] client/src/api.js exists and contains markMockupSent (1 match)
- [x] client/src/pages/Inbox.jsx exists and contains Generate Mockup (2), mockupDeclined (6), mockupData (10), Lovable Prompt (2), Copy & Mark Sent (1), Mockup Sent badge (2)
- [x] src/routes/jobs.js exists and contains mockup-sent endpoint (2 matches)
- [x] src/routes/emails.js exists and contains mockupSent (1 match)
- [x] Commit 54b68a8 found in git log (Task 1)
- [x] Commit dc22555 found in git log (Task 2)
- [x] Frontend builds successfully (vite build, 0 errors)
- [x] Backend lint passes (eslint src/)

---
*Phase: 16-lovable-mockup-generator*
*Completed: 2026-03-06*
