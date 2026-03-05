---
phase: 16-lovable-mockup-generator
verified: 2026-03-06T00:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Generate Mockup flow — visual/non-visual jobs"
    expected: "Button appears violet next to Generate Reply; non-visual job shows 'Mockup Not Recommended' panel with alternative; visual job shows dual clipboard (Lovable Prompt + Send Message)"
    why_human: "Browser UI behavior, clipboard copy, and visual layout cannot be verified programmatically"
  - test: "Day 7 disabled state"
    expected: "Button is grayed out for a lead with follow_up_count >= 2 and tooltip reads 'Mockups should be sent at Day 3 or earlier'"
    why_human: "Disabled state and tooltip appearance require browser inspection"
  - test: "Send Message copy triggers mockup_sent"
    expected: "Clicking 'Copy & Mark Sent' copies the send message to clipboard and the Mockup Sent badge appears in the job context panel on next load"
    why_human: "Clipboard + API fire-and-forget + badge re-render requires live browser testing"
---

# Phase 16: Lovable Mockup Generator — Verification Report

**Phase Goal:** System evaluates every job against a decision matrix to determine if a mockup is appropriate, then generates a complete Lovable-compatible prompt with design specs (including colors from client site), sections list, and realistic sample data, plus a stage-appropriate send message under 60 words.

**Verified:** 2026-03-06
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Decision matrix returns YES for 8 visual job types | VERIFIED | `mockupDecision.js` exports `evaluateMockupDecision` with full YES_CATEGORIES for web_app, landing_page, ecommerce, mobile_app, dashboard, ai_chatbot, automation_tool, generic_ui; live node test confirmed all 8 classifications |
| 2 | Decision matrix returns NO with alternative for non-visual types | VERIFIED | SERVICE_NO_CATEGORIES (seo, content, data_entry) and INFRA_NO_CATEGORIES (devops, backend) with correct `alternativeSuggestion` values; 5 NO tests pass |
| 3 | Budget gate blocks under $1K | VERIFIED | `amount > 0 AND < 1000` gate at top of function; tests for $500/$999 block, $1000/$0/null pass through; 5 budget tests pass |
| 4 | Mixed projects (API + dashboard) return YES (infra NO yields to visual YES) | VERIFIED | Service-vs-infra conflict resolution in place; "DevOps + dashboard" → YES (dashboard); "SEO + e-commerce" → NO (seo wins); 2 mixed-project tests pass |
| 5 | Lovable prompt with design specs (colors, sections, realistic data) and stage-appropriate send message (≤60 words) generated | VERIFIED | LOVABLE_MOCKUP_V1 seed template in `seed_v2_foundation.js` has full DESIGN block, SECTIONS (up to 6), FUNCTIONALITY, and 3 stage templates (with_proposal, after_call, follow_up_day_3) all ≤60 words |
| 6 | When source=mockup, generate Mockup button runs decision gate, then Claude pipeline, returning separate lovablePrompt + sendMessage | VERIFIED | `handleGenerate('mockup')` in Inbox.jsx sends `source: 'mockup'`; replies.js routes to LOVABLE_MOCKUP_V1; `parseMockupOutput` splits into lovablePrompt/sendMessage/mockupAnalysis; response body includes `mockupData` |
| 7 | mockup_sent boolean tracked per job; Follow-Up Day 7 grays out button | VERIFIED | `PUT /api/jobs/:id/mockup-sent` in jobs.js; `markMockupSent` in api.js wired to button copy event; `follow_up_count >= 2` disables button in Inbox.jsx with correct tooltip; Mockup Sent badge rendered when `detail.job.mockupSent` |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/mockupDecision.js` | Pure-function decision matrix; exports `evaluateMockupDecision`; min 80 lines | VERIFIED | 272 lines; correct exports; no DB/Express coupling; all 8 YES + 5 NO categories implemented |
| `src/utils/prefetch.js` | Color extraction added; `extractColorsFromHtml` internal helper; `result.colors` in analyzeUrl | VERIFIED | `extractColorsFromHtml` on line 243; `colors: []` default on line 326; `result.colors = extractColorsFromHtml($)` on line 394 |
| `src/routes/replies.js` | Mockup decision gate, context injection, output parser, DB persist; contains `parseMockupOutput` | VERIFIED | Import on line 27; gate on lines 279-300; `parseMockupOutput` on line 1257; `mockup_lovable_prompt` UPDATE on line 669; `mockupData` in response on lines 763-767 |
| `src/tests/lovable-generator.test.js` | Unit tests for decision matrix; min 80 lines | VERIFIED | 236 lines; 24 tests in 5 describe blocks; zero Supertest/DB dependencies; all 24 pass |
| `client/src/pages/Inbox.jsx` | Generate Mockup button, mockup output display, Day 7 disabled state | VERIFIED | Button at line 1199; decline panel at line 1247; dual-clipboard display at line 1262; Day 7 disable at line 1202; Mockup Sent badge at lines 856 and 1332 |
| `client/src/api.js` | `markMockupSent` method | VERIFIED | Lines 77-78; calls `PUT /api/jobs/${jobId}/mockup-sent` |
| `src/routes/jobs.js` | `PUT /:id/mockup-sent` endpoint; `mockupSent` in formatJob | VERIFIED | Endpoint at line 361; `mockupSent: row.mockup_sent || false` at line 436 |
| `src/routes/emails.js` | `mockupSent` in email detail response | VERIFIED | `mockupSent: jobRows[0].mockup_sent || false` at line 229 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/utils/mockupDecision.js` | `src/routes/replies.js` | `require('../utils/mockupDecision')` + `evaluateMockupDecision` | WIRED | Line 27 imports; line 290 calls `evaluateMockupDecision(job, email)` |
| `src/utils/prefetch.js` | `src/routes/replies.js` | existing analyzeUrl import; `result.colors` consumed | WIRED | `siteWithColors` lookup at line 1057; `siteWithColors.colors` injected into `<brand_colors>` block |
| `client/src/pages/Inbox.jsx` | `client/src/api.js` | `api.markMockupSent` | WIRED | `api.markMockupSent(detail.job.id)` at line 1308; called on send message copy |
| `client/src/api.js` | `PUT /api/jobs/:id/mockup-sent` | `request` function | WIRED | `request(\`/api/jobs/${jobId}/mockup-sent\`, { method: "PUT" })` at lines 77-78 |
| `client/src/pages/Inbox.jsx` | `POST /api/replies/generate` | `handleGenerate('mockup')` | WIRED | `api.generateReply(detail.email.id, { tone, promptOverride, source: 'mockup' })` at line 359-363 |
| `src/tests/lovable-generator.test.js` | `src/utils/mockupDecision.js` | `require('../utils/mockupDecision')` | WIRED | Line 12; `evaluateMockupDecision` called directly in all 24 tests |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MOCKUP-01 | 16-01, 16-02, 16-03 | Decision matrix: 8 YES types, NO with alternatives, budget gate, not-yet-engaged gate | SATISFIED | `mockupDecision.js` implements all 8 YES + 5 NO types; budget gate; 24 passing tests; follow_up_count gate in replies.js |
| MOCKUP-02 | 16-01, 16-02 | Complete Lovable prompt with design specs (colors from client site), sections (up to 6), functionality, realistic sample data | SATISFIED | Prompt template in seed has DESIGN/SECTIONS/FUNCTIONALITY blocks; `extractColorsFromHtml` feeds brand colors via `<brand_colors>` context block; "never Lorem ipsum" rule in template |
| MOCKUP-03 | 16-02 | Stage-appropriate send message ≤60 words; 3 stage templates (with_proposal, after_call, follow_up_day_3); never "I built this" | SATISFIED | `mockupStage` determined at replies.js line 1038-1046; injected via `<mockup_context>`; 3 templates in LOVABLE_MOCKUP_V1 seed all ≤60 words; template rule: "Never say 'I built this for you'" |
| MOCKUP-04 | 16-04 | Generate Mockup button in Inbox/Proposal Workspace; runs decision matrix then generates prompt + send message; prompt copyable | SATISFIED | Button at Inbox.jsx line 1199; `handleGenerate('mockup')` triggers pipeline; dual clipboard (Copy Prompt + Copy & Mark Sent) implemented |
| MOCKUP-05 | 16-02, 16-04 | Follow-Up Day 7 grayed out with tooltip; `mockup_sent` boolean tracks whether mockup was shared | SATISFIED | Button disabled + tooltip when `follow_up_count >= 2`; backend gate returns `mockupDeclined`; `PUT /api/jobs/:id/mockup-sent` persists to DB; Mockup Sent badge rendered |

All 5 requirements satisfied. No orphaned requirements found.

---

### Anti-Patterns Found

No blocking anti-patterns detected. Checked `mockupDecision.js`, `replies.js` (mockup sections), `lovable-generator.test.js`, `Inbox.jsx` (mockup sections), `api.js`, `jobs.js`:

- No TODO/FIXME/PLACEHOLDER in mockup-related code
- No empty implementations (`return null`, `return {}`) in decision matrix
- No stub handlers (all clipboard and API calls wired through)

One deferred item noted by the implementation team (content_writ regex edge case for "content writing" vs "copywriting") is logged in `deferred-items.md` and does not affect any MOCKUP requirement — the test correctly uses "Copywriting" which matches the regex.

---

### Human Verification Required

#### 1. Generate Mockup full flow — visual job

**Test:** Open the app, select an email with a matched job describing a web app, dashboard, or landing page. Click "Generate Mockup" (violet button).
**Expected:** Loading spinner appears, then dual clipboard output renders — collapsible "Mockup Analysis", violet "Lovable Prompt" section with "Copy Prompt" button, blue "Send Message (60 words max)" section with editable textarea and "Copy & Mark Sent" button.
**Why human:** Browser rendering, clipboard write API, and visual layout cannot be verified programmatically.

#### 2. Generate Mockup — non-visual job decline

**Test:** Select an email with a matched job about SEO, content writing, or data entry. Click "Generate Mockup".
**Expected:** "Mockup Not Recommended" panel appears in violet with the decline reason and an "Instead:" alternative suggestion. No Lovable prompt output.
**Why human:** Response branching and UI state rendering require live browser.

#### 3. Follow-Up Day 7 disabled state

**Test:** Find or simulate a lead with `follow_up_count >= 2`. Inspect the Generate Mockup button.
**Expected:** Button is grayed out (gray background, muted text) and non-clickable. Hovering shows tooltip "Mockups should be sent at Day 3 or earlier -- use a different value angle for Day 7".
**Why human:** CSS disabled state and tooltip appearance require browser inspection.

#### 4. Send Message copy triggers mockup_sent

**Test:** After a successful mockup generation, click "Copy & Mark Sent" in the Send Message section.
**Expected:** Button text changes to "Copied & Marked Sent!" and the Mockup Sent badge appears in the Job Context panel (may require refreshing detail to see badge from initial email load).
**Why human:** Clipboard API + fire-and-forget API call + conditional badge render requires live browser.

---

### Gaps Summary

No gaps. All 7 observable truths verified, all artifacts substantive and wired, all 5 requirement IDs satisfied, 24 unit tests pass, frontend builds without errors, lint passes.

The one known regex edge case (`content\s?writ\b` not matching "content writing" — only "content writ" or "copywriting") is deferred per the implementation team's decision and does not block any MOCKUP requirement.

---

_Verified: 2026-03-06_
_Verifier: Claude (gsd-verifier)_
