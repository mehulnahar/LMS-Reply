# Phase 16: Lovable Mockup Generator - Research

**Researched:** 2026-03-06
**Domain:** AI-powered mockup decision matrix + Lovable prompt generation + color extraction + stage-aware messaging
**Confidence:** HIGH

## Summary

Phase 16 implements a "Generate Mockup" feature that decides whether a mockup is appropriate for a given lead (decision matrix), then generates a complete Lovable-compatible prompt with design specs (including colors extracted from client sites), sections, realistic data, and a stage-appropriate send message. The feature integrates into the existing 7-step generation pipeline via `source: 'mockup'` which already routes to `LOVABLE_MOCKUP_V1` in promptRouter.js.

The codebase is well-prepared for this phase. The `LOVABLE_MOCKUP_V1` prompt type already exists in the enum, the prompt template is already seeded in the database, the `mockup_sent` and `mockup_lovable_prompt` columns exist on the jobs table (migration 005), and the prompt router already handles `source === 'mockup'`. The primary new work is: (1) a decision matrix utility, (2) enhancing `analyzeUrl()` to extract colors from client sites, (3) parsing Claude's structured output into separate Lovable prompt + send message sections, (4) a "Generate Mockup" button in the UI with clipboard copy for each section, and (5) tracking `mockup_sent` state.

**Primary recommendation:** Build a pure-function decision matrix module (`src/utils/mockupDecision.js`), enhance `analyzeUrl()` in prefetch.js with color extraction via Cheerio, add a custom response parser for the structured `[MOCKUP ANALYSIS] / [LOVABLE PROMPT] / [SEND MESSAGE]` output format, and wire a "Generate Mockup" button into the Inbox.jsx detail panel that calls `handleGenerate('mockup')`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MOCKUP-01 | Mockup Decision Matrix -- system checks job type against decision matrix: web app, SaaS, landing page, e-commerce, mobile app, dashboard, AI chatbot, automation tool -> YES; SEO/marketing, DevOps/backend, content writing, budget under $1K, client hasn't engaged yet -> NO with alternative suggestion | Decision matrix is a pure function with keyword matching + budget check + engagement check. Pattern: Architecture Patterns > Decision Matrix Module |
| MOCKUP-02 | When YES, generate complete Lovable-compatible prompt including design specs (colors from client site via link analysis), typography, layout, sections list (up to 6), interactive elements, realistic sample data (never Lorem ipsum) | Lovable prompts follow a specific structure (Purpose > Design > Sections > Functionality > Important). Color extraction via Cheerio CSS inline/style parsing. Pattern: Architecture Patterns > Color Extraction Enhancement |
| MOCKUP-03 | Stage-appropriate send message (<=60 words) -- different templates for: with proposal (cold), after a call, Follow-Up Day 3; never "I built this for you" | Three template variants keyed by thread_stage. Pattern: Architecture Patterns > Stage-Aware Send Message |
| MOCKUP-04 | "Generate Mockup" button in Proposal Workspace and Lead Detail screens; runs decision matrix -> generates prompt + send message; copyable to clipboard | Button calls `handleGenerate('mockup')` using existing pipeline. Custom output parsing splits into Lovable prompt vs send message for separate copy buttons. Pattern: Architecture Patterns > UI Integration |
| MOCKUP-05 | Follow-Up Day 7 grayed out with tooltip; mockup_sent boolean tracks whether mockup was shared | Already exists as `mockup_sent BOOLEAN DEFAULT false` + `mockup_lovable_prompt TEXT` on jobs table. Set `mockup_sent = true` after generation. Disable button when follow_up_count >= 2. Pattern: Common Pitfalls > Follow-Up Day 7 Gate |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cheerio | (already installed) | Parse client site HTML for color extraction | Already used in prefetch.js for URL analysis |
| Anthropic Claude (Sonnet) | claude-sonnet-4-6 | Generate Lovable prompt + send message | Already used for all reply generation |
| Express.js | (already installed) | Route handling | Existing backend |
| React + Tailwind | (already installed) | Frontend UI components | Existing frontend |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Anthropic Claude (Haiku) | claude-3-5-haiku-20241022 | Decision matrix classification for ambiguous cases | Only if keyword matching is insufficient -- start with pure regex/keyword approach |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cheerio color extraction | Puppeteer for full computed styles | Puppeteer is heavyweight (headless Chrome), adds 300MB+ dependency, slow on Railway. Cheerio extracts inline styles + style tags which covers 80%+ of cases |
| Pure keyword decision matrix | Claude Haiku classification | Keyword matching is free, instant, deterministic. Use Haiku only as fallback for ambiguous cases. Start simple |
| Custom CSS parser | css-color-extractor npm | Extra dependency for minimal gain. Regex on style tags covers the needed cases |

**Installation:**
```bash
# No new dependencies needed -- all tools already available in the codebase
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  utils/
    mockupDecision.js    # NEW: Decision matrix (pure function, no DB/Express)
    prefetch.js          # MODIFIED: Add extractColors() to analyzeUrl result
  routes/
    replies.js           # MODIFIED: Parse mockup-specific output blocks, persist mockup_lovable_prompt + mockup_sent
client/src/
  pages/
    Inbox.jsx            # MODIFIED: Add "Generate Mockup" button, mockup output display with dual clipboard (prompt + message)
  api.js                 # MODIFIED: No changes needed (already supports source param)
```

### Pattern 1: Decision Matrix Module
**What:** Pure function that takes job data and returns `{ shouldBuild: boolean, projectType: string, whatToMockup: string, alternativeSuggestion: string|null }`
**When to use:** Called before generation to gate the mockup flow
**Example:**
```javascript
// src/utils/mockupDecision.js
'use strict';

// Keywords that indicate visual/UI work (YES build mockup)
const YES_KEYWORDS = [
  // Web app / SaaS
  /\b(web\s?app|saas|platform|portal|crm|erp)\b/i,
  // Landing page / website
  /\b(landing\s?page|website|web\s?site|homepage|marketing\s?site)\b/i,
  // E-commerce
  /\b(e-?commerce|shopify|woo\s?commerce|online\s?store|storefront|product\s?page)\b/i,
  // Mobile app
  /\b(mobile\s?app|ios\s?app|android\s?app|react\s?native|flutter)\b/i,
  // Dashboard / admin panel
  /\b(dashboard|admin\s?panel|analytics|data\s?viz|chart|reporting\s?tool)\b/i,
  // AI chatbot
  /\b(chatbot|chat\s?interface|conversational\s?ui|ai\s?assistant)\b/i,
  // Automation tool
  /\b(automation\s?tool|workflow\s?builder|pipeline\s?ui|status\s?dashboard)\b/i,
  // Generic UI signals
  /\b(ui|ux|design|redesign|frontend|front-?end|user\s?interface|prototype)\b/i,
];

// Keywords that indicate NON-visual work (NO mockup)
const NO_KEYWORDS = [
  /\b(seo|search\s?engine\s?optim|marketing\s?campaign|ppc|adwords|social\s?media\s?management)\b/i,
  /\b(devops|ci\/?cd|docker|kubernetes|infrastructure|server\s?setup|deployment)\b/i,
  /\b(content\s?writ|blog\s?post|copywriting|article|ghostwriting)\b/i,
  /\b(data\s?entry|bookkeeping|virtual\s?assistant|transcription)\b/i,
  /\b(api\s?only|backend\s?only|microservice|cron\s?job|script)\b/i,
];

const ALTERNATIVES = {
  seo: 'Quick keyword/competitor analysis',
  devops: 'Architecture diagram',
  content: 'Sample content calendar',
  backend: 'Code audit with 3 findings',
  budget: 'Relevant case study instead',
  cold: 'Use link analysis + insight in the proposal',
};

/**
 * @param {Object} job - Job record from DB
 * @param {Object} email - Email record from DB
 * @returns {{ shouldBuild, projectType, whatToMockup, alternativeSuggestion }}
 */
function evaluateMockupDecision(job, email) {
  const text = [
    job?.job_heading,
    job?.job_description_raw || job?.job_description,
    job?.category,
    job?.sub_category,
  ].filter(Boolean).join(' ');

  // Budget gate: under $1K fixed = NO
  const amount = parseFloat(job?.amount || '0');
  if (amount > 0 && amount < 1000) {
    return {
      shouldBuild: false,
      projectType: 'low_budget',
      whatToMockup: null,
      alternativeSuggestion: ALTERNATIVES.budget,
    };
  }

  // Engagement gate: if no thread depth and email is initial (cold), skip
  const threadDepth = job?.thread_depth || 0;
  // Note: "cold proposal" means source='proposal' with thread_depth=0
  // The decision matrix should allow mockups WITH cold proposals per MOCKUP-03

  // Check NO keywords first (more restrictive)
  for (const pattern of NO_KEYWORDS) {
    if (pattern.test(text)) {
      const category = detectNoCategory(pattern);
      return {
        shouldBuild: false,
        projectType: category,
        whatToMockup: null,
        alternativeSuggestion: ALTERNATIVES[category] || 'Focus on the reply',
      };
    }
  }

  // Check YES keywords
  for (const pattern of YES_KEYWORDS) {
    if (pattern.test(text)) {
      return {
        shouldBuild: true,
        projectType: detectYesCategory(pattern),
        whatToMockup: inferWhatToMockup(text),
        alternativeSuggestion: null,
      };
    }
  }

  // Default: no strong signal -> NO
  return {
    shouldBuild: false,
    projectType: 'unknown',
    whatToMockup: null,
    alternativeSuggestion: 'Unclear project type -- focus on insight in the reply',
  };
}

module.exports = { evaluateMockupDecision };
```

### Pattern 2: Color Extraction Enhancement for prefetch.js
**What:** Extend `analyzeUrl()` result object with a `colors` array extracted from the client's site HTML
**When to use:** During pre-generation pipeline (Step 4b) -- already runs for all URL analysis
**Example:**
```javascript
// Addition to analyzeUrl() in src/utils/prefetch.js
// After loading cheerio $:

// Extract colors from inline styles and <style> tags
function extractColorsFromHtml($) {
  const colorSet = new Set();
  const HEX_REGEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
  const RGB_REGEX = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)/g;

  // 1. Scan all style attributes on elements
  $('[style]').each(function () {
    const style = $(this).attr('style') || '';
    const hexMatches = style.match(HEX_REGEX) || [];
    const rgbMatches = style.match(RGB_REGEX) || [];
    hexMatches.forEach((c) => colorSet.add(c.toLowerCase()));
    rgbMatches.forEach((c) => colorSet.add(c));
  });

  // 2. Scan <style> tag contents
  $('style').each(function () {
    const css = $(this).text() || '';
    const hexMatches = css.match(HEX_REGEX) || [];
    const rgbMatches = css.match(RGB_REGEX) || [];
    hexMatches.forEach((c) => colorSet.add(c.toLowerCase()));
    rgbMatches.forEach((c) => colorSet.add(c));
  });

  // 3. Check meta theme-color
  const themeColor = $('meta[name="theme-color"]').attr('content');
  if (themeColor) colorSet.add(themeColor.toLowerCase());

  // Filter common non-brand colors (pure black/white/gray)
  const filtered = [...colorSet].filter((c) => {
    const lower = c.toLowerCase();
    return lower !== '#000' && lower !== '#000000' &&
           lower !== '#fff' && lower !== '#ffffff' &&
           lower !== '#333' && lower !== '#333333' &&
           lower !== '#666' && lower !== '#666666' &&
           lower !== '#999' && lower !== '#999999' &&
           lower !== '#ccc' && lower !== '#cccccc';
  });

  return filtered.slice(0, 10); // Cap at 10 colors
}

// Add to analyzeUrl result:
// result.colors = extractColorsFromHtml($);
```

### Pattern 3: Structured Output Parsing for Mockup Response
**What:** Parse Claude's LOVABLE_MOCKUP_V1 output into separate blocks: MOCKUP ANALYSIS, LOVABLE PROMPT, SEND MESSAGE
**When to use:** In replies.js after Claude returns -- only for LOVABLE_MOCKUP_V1 prompt type
**Example:**
```javascript
// In replies.js -- new helper function
function parseMockupOutput(rawText) {
  const result = {
    mockupAnalysis: null,
    lovablePrompt: null,
    sendMessage: null,
    deploymentNote: null,
  };

  // Extract [MOCKUP ANALYSIS] block
  const analysisMatch = rawText.match(
    /\[MOCKUP ANALYSIS\]([\s\S]*?)(?=\[LOVABLE PROMPT\]|$)/i
  );
  if (analysisMatch) {
    result.mockupAnalysis = analysisMatch[1].trim();
  }

  // Extract [LOVABLE PROMPT] block
  const promptMatch = rawText.match(
    /\[LOVABLE PROMPT\]([\s\S]*?)(?=\[SEND MESSAGE\]|$)/i
  );
  if (promptMatch) {
    result.lovablePrompt = promptMatch[1].trim();
  }

  // Extract [SEND MESSAGE] block
  const messageMatch = rawText.match(
    /\[SEND MESSAGE\]([\s\S]*?)(?=\[DEPLOYMENT NOTE\]|$)/i
  );
  if (messageMatch) {
    result.sendMessage = messageMatch[1].trim();
  }

  // Extract [DEPLOYMENT NOTE] block (optional)
  const deployMatch = rawText.match(/\[DEPLOYMENT NOTE\]([\s\S]*?)$/i);
  if (deployMatch) {
    result.deploymentNote = deployMatch[1].trim();
  }

  return result;
}
```

### Pattern 4: Stage-Aware Send Message Context Injection
**What:** Inject thread_stage into the system prompt so Claude generates the correct send message variant
**When to use:** When building prompt context for LOVABLE_MOCKUP_V1 in `buildPromptWithContext()`
**Example:**
```javascript
// In buildPromptWithContext(), add a LOVABLE_MOCKUP_V1 specific block:
if (promptType === 'LOVABLE_MOCKUP_V1') {
  // Determine conversation stage for send message
  let mockupStage = 'with_proposal'; // default: cold
  if (job) {
    const depth = job.thread_depth || 0;
    const stage = threadContext?.threadStage || job.thread_stage || 'DISCOVERY';
    if (stage === 'POST_CALL') {
      mockupStage = 'after_call';
    } else if (depth >= 1 || job.follow_up_count >= 1) {
      mockupStage = 'follow_up_day_3';
    }
  }

  prompt += `\n\n<mockup_context>
Conversation Stage for Send Message: ${mockupStage}
Generate the SEND MESSAGE using the "${mockupStage}" template from the prompt.
</mockup_context>`;

  // Inject color data from link analysis if available
  if (Array.isArray(linkAnalysis) && linkAnalysis.length > 0) {
    const siteWithColors = linkAnalysis.find((r) => r.colors && r.colors.length > 0);
    if (siteWithColors) {
      prompt += `\n\n<brand_colors>
Colors extracted from client's site (${siteWithColors.url}):
${siteWithColors.colors.join(', ')}
Use these as the primary color palette in the DESIGN section of the Lovable prompt.
</brand_colors>`;
    }
  }
}
```

### Pattern 5: UI -- Generate Mockup Button
**What:** A dedicated "Generate Mockup" button alongside the existing "Generate Reply" button
**When to use:** In the detail panel of Inbox.jsx, within the reply generation toolbar
**Example:**
```jsx
{/* Generate Mockup button -- next to Generate Reply */}
<button
  onClick={() => handleGenerate('mockup')}
  disabled={generating || (detail?.job?.follow_up_count >= 2 && !detail?.job?.mockup_sent)}
  title={
    detail?.job?.follow_up_count >= 2
      ? 'Mockups should be sent at Day 3 or earlier'
      : 'Generate Lovable mockup prompt'
  }
  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
  {/* Paintbrush/mockup icon */}
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
  </svg>
  Generate Mockup
</button>
```

### Anti-Patterns to Avoid
- **Separate API route for mockups:** Do NOT create a new `/api/lovable/generate` or `/api/lovable/detect` route. The existing `/api/replies/generate` with `source: 'mockup'` already routes to `LOVABLE_MOCKUP_V1`. Keep the pipeline unified.
- **Using Claude for the decision matrix:** The YES/NO decision is deterministic based on job type keywords. Do not burn API tokens on something regex can handle. The prompt template already contains the decision logic -- but the backend should gate it BEFORE calling Claude.
- **Puppeteer for color extraction:** Adding headless Chrome to Railway would be expensive, slow, and fragile. Cheerio-based extraction of inline styles + `<style>` tags covers the vast majority of client sites.
- **Storing the full Claude output as generatedText:** The Lovable prompt should be parsed out and stored separately in `jobs.mockup_lovable_prompt`. The `replies.generated_text` should contain the send message (what the user actually sends to the client).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color extraction from HTML | Custom CSS parser or Puppeteer setup | Cheerio regex on `<style>` tags + `[style]` attributes + `meta[name="theme-color"]` | Already have Cheerio; covers 80%+ of sites; zero new dependencies |
| Prompt routing to LOVABLE_MOCKUP_V1 | New routing logic | Existing `determinePromptType()` with `source: 'mockup'` | Already built in Phase 12 |
| Prompt template storage | Hardcoded prompt in JS | Existing `prompt_templates` table with `LOVABLE_MOCKUP_V1` type | Already seeded in Phase 11 |
| Mockup tracking columns | New migration | Existing `mockup_sent` + `mockup_lovable_prompt` on jobs table | Already added in migration 005 |
| Clipboard copy | Custom clipboard implementation | `navigator.clipboard.writeText()` pattern already used in Inbox.jsx | Existing pattern works perfectly |

**Key insight:** Phase 11 and Phase 12 did the heavy lifting for mockup infrastructure. This phase is primarily about the decision matrix logic, color extraction, output parsing, and UI integration. No new DB migrations, no new API routes, no new dependencies.

## Common Pitfalls

### Pitfall 1: Decision Matrix False Positives on Mixed Projects
**What goes wrong:** A job like "Build REST API with React frontend" matches both YES (React/frontend) and NO (API) keywords. The matrix returns contradictory results.
**Why it happens:** Simple regex matching without priority ordering.
**How to avoid:** Check NO keywords FIRST. If any NO keyword matches, check if there are also YES keywords. If both match (mixed project like "API + dashboard"), default to YES because the visual component exists. Only pure NO-keyword matches (no YES keywords at all) should return false.
**Warning signs:** Test with mixed descriptions like "DevOps pipeline with monitoring dashboard" -- should be YES because dashboard is visual.

### Pitfall 2: Color Extraction Returns Empty on JavaScript-Heavy Sites
**What goes wrong:** Modern SPAs (React, Vue, Angular) often load styles via JavaScript bundles. Cheerio parses static HTML only, so CSS-in-JS styles are invisible.
**Why it happens:** Cheerio does not execute JavaScript.
**How to avoid:** This is a known limitation. When no colors are extracted, the Lovable prompt should still work -- Claude will use generic modern colors. Add a fallback in the prompt context: "No brand colors available -- use a clean modern palette". Do NOT attempt to add Puppeteer to solve this. The cost/benefit is not there.
**Warning signs:** `colors` array is empty for most client sites. This is acceptable -- not a blocker.

### Pitfall 3: Claude's Output Misses Block Markers
**What goes wrong:** Claude sometimes omits `[LOVABLE PROMPT]` or `[SEND MESSAGE]` markers, especially under token pressure.
**Why it happens:** Creative freedom in generation; the markers are instructions, not guaranteed.
**How to avoid:** Make the output parsing robust with fallback: if `[LOVABLE PROMPT]` marker not found, treat everything between `[MOCKUP ANALYSIS]` and `[SEND MESSAGE]` as the Lovable prompt. If NO markers found at all, use the full response as the Lovable prompt and generate a default send message from the stage template.
**Warning signs:** `parseMockupOutput()` returns null for lovablePrompt or sendMessage -- add defensive fallbacks.

### Pitfall 4: Follow-Up Day 7 Gate Not Enforced
**What goes wrong:** User clicks "Generate Mockup" on a lead that has already had 2 follow-ups (Day 7 territory). The prompt says "mockup window is closed" but the system still generates one.
**Why it happens:** Gate is only in the prompt text, not enforced in code.
**How to avoid:** Enforce in two places: (1) backend `replies.js` -- if `source === 'mockup'` AND `job.follow_up_count >= 2`, return early with `{ mockupDeclined: true, reason: 'Day 7+ -- mockup window closed' }`; (2) frontend button disabled state when `follow_up_count >= 2`.
**Warning signs:** Mockups generated for leads deep in the follow-up sequence.

### Pitfall 5: mockup_sent Not Updated After Generation
**What goes wrong:** User generates a mockup prompt, copies it, but `mockup_sent` stays `false` because only generating (not actually sending) the mockup happened.
**Why it happens:** Confusion about when to set the flag -- at generation or at actual send.
**How to avoid:** Set `mockup_sent = true` when the user copies the send message to clipboard (similar to `was_copied` on replies). Add a dedicated action: "Mark Mockup as Sent" button, or set it on copy of the send message.
**Warning signs:** `mockup_sent` is always `false` even after mockup prompts have been generated and used.

### Pitfall 6: Existing Test File Has Old API Structure
**What goes wrong:** `src/tests/lovable-generator.test.js` references `/api/lovable/detect` and `/api/lovable/generate` -- routes that do NOT exist and should NOT be built.
**Why it happens:** That test file was written before the Phase 12 pipeline unified all generation under `/api/replies/generate`.
**How to avoid:** Do NOT implement those old routes. Either delete or rewrite the test file to use `/api/replies/generate` with `source: 'mockup'`. The tests should call the unified pipeline.
**Warning signs:** Tests pass against non-existent routes, or someone creates `/api/lovable/*` routes unnecessarily.

## Code Examples

### Calling Generate Mockup from Frontend
```javascript
// In client/src/api.js -- no changes needed, already supports source
api.generateReply(emailId, { tone: 'professional', source: 'mockup' })

// In Inbox.jsx handleGenerate('mockup') is already handled:
// handleGenerate(source = null) → source gets passed to api.generateReply
```

### Backend: Decision Matrix Gate in replies.js
```javascript
// After Step 2 (prompt routing), before Step 3 (template loading):
if (promptType === 'LOVABLE_MOCKUP_V1') {
  const { evaluateMockupDecision } = require('../utils/mockupDecision');
  const decision = evaluateMockupDecision(job, email);

  // Follow-up Day 7 gate (MOCKUP-05)
  if (job && job.follow_up_count >= 2) {
    return res.json({
      mockupDeclined: true,
      reason: 'Mockup window closed -- Day 7+ leads should use a different value angle',
      alternativeSuggestion: 'Use a technical insight or case study instead',
    });
  }

  if (!decision.shouldBuild) {
    return res.json({
      mockupDeclined: true,
      reason: `Not a visual project type (${decision.projectType})`,
      alternativeSuggestion: decision.alternativeSuggestion,
    });
  }

  // Pass decision context to prompt builder (for the LOVABLE_MOCKUP_V1 template)
  // Continue to Step 3...
}
```

### Backend: Persisting Mockup Data After Generation
```javascript
// After Step 6 (output parsing), for LOVABLE_MOCKUP_V1:
if (promptType === 'LOVABLE_MOCKUP_V1' && job) {
  const mockupParsed = parseMockupOutput(rawText);

  // Store Lovable prompt on jobs table
  if (mockupParsed.lovablePrompt) {
    pool.query(
      'UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2',
      [mockupParsed.lovablePrompt, job.id]
    ).catch((err) => console.error('replies: mockup prompt persist failed:', err.message));
  }

  // The cleanText for the reply should be the send message
  // Override validatedText with the send message portion
  if (mockupParsed.sendMessage) {
    validatedText = mockupParsed.sendMessage;
  }
}
```

### Frontend: Mockup Output Display
```jsx
{/* When activePromptType === 'LOVABLE_MOCKUP_V1', show split display */}
{activePromptType === 'LOVABLE_MOCKUP_V1' && mockupData && (
  <div className="space-y-4">
    {/* Decision analysis (collapsible) */}
    {mockupData.mockupAnalysis && (
      <details className="text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer font-medium">Mockup Analysis</summary>
        <pre className="mt-1 whitespace-pre-wrap">{mockupData.mockupAnalysis}</pre>
      </details>
    )}

    {/* Lovable Prompt -- primary copyable block */}
    <div className="border border-violet-200 dark:border-violet-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-violet-700 dark:text-violet-300">
          Lovable Prompt
        </h4>
        <button onClick={() => copyToClipboard(mockupData.lovablePrompt)}>
          Copy Prompt
        </button>
      </div>
      <pre className="text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
        {mockupData.lovablePrompt}
      </pre>
    </div>

    {/* Send Message -- secondary copyable block */}
    <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300">
          Send Message ({'>'}=60 words)
        </h4>
        <button onClick={() => {
          copyToClipboard(mockupData.sendMessage);
          // Mark mockup as sent
          if (detail?.job?.id) {
            api.markMockupSent(detail.job.id);
          }
        }}>
          Copy & Mark Sent
        </button>
      </div>
      <textarea
        value={sendMessageText}
        onChange={(e) => setSendMessageText(e.target.value)}
        rows={3}
        className="w-full text-sm"
      />
    </div>
  </div>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate `/api/lovable/*` routes (test file) | Unified `/api/replies/generate` with `source: 'mockup'` | Phase 12 (promptRouter.js) | Single pipeline for all generation types |
| No color extraction in URL analysis | Colors extracted from HTML via Cheerio during prefetch | Phase 16 (this phase) | Enables brand-matched mockup prompts |
| Manual mockup decision | Deterministic keyword-based decision matrix | Phase 16 (this phase) | Consistent, instant, free (no API call) |

**Deprecated/outdated:**
- `src/tests/lovable-generator.test.js`: References old `/api/lovable/detect` and `/api/lovable/generate` routes. These were never implemented. The test file should be rewritten to use the unified pipeline.

## Open Questions

1. **When exactly should `mockup_sent` be set to true?**
   - What we know: Column exists on jobs table. MOCKUP-05 says it "tracks whether a mockup was shared".
   - What's unclear: Is "shared" when the user copies the send message, or when they manually confirm they sent it?
   - Recommendation: Set `mockup_sent = true` when the user clicks "Copy Send Message" (same pattern as `was_copied` on replies). This is the closest proxy for "sent" without actual email send tracking.

2. **Should the decision matrix run client-side or server-side?**
   - What we know: The generation pipeline is server-side. The button disable state needs client-side knowledge.
   - What's unclear: Whether to show/hide the button before calling the API.
   - Recommendation: Run decision matrix on BOTH sides. Client-side: simple check to enable/disable button (job type keywords). Server-side: authoritative check that returns `mockupDeclined` response if inappropriate. This prevents wasted API calls while keeping the gate reliable.

3. **Budget check: where does `amount` come from for the "$1K gate"?**
   - What we know: `jobs.amount` exists (migration 004) and stores fixed budget from LeadHack.
   - What's unclear: What format it's stored in (string vs number), whether it's reliably populated.
   - Recommendation: Parse as float, treat null/empty as "no budget restriction" (don't block). Only block when a clear amount under 1000 is detected.

4. **Should the "Generate Mockup" button be in its own section or inline with reply generation?**
   - What we know: MOCKUP-04 says "Proposal Workspace and Lead Detail screens". Currently there's no separate "Proposal Workspace" view.
   - What's unclear: Whether a new screen is needed.
   - Recommendation: Add the button inline in the existing reply generation toolbar (Inbox.jsx detail panel). When the button is clicked, the output display switches to the dual-panel mockup view (Lovable prompt + send message). No new screen needed -- the detail panel IS the workspace.

## Lovable Prompt Best Practices (from Official Docs)

Based on the Lovable Prompting Bible and official best practices documentation:

1. **Structure:** Purpose > Features > User Flow > Data Model > UI Style > Extras
2. **Be explicit:** Specify exact technologies, colors, layout patterns
3. **One page max:** Build one key screen or 2-3 mobile screens, never the whole app
4. **Realistic data:** Real-sounding names, numbers, descriptions -- never "Lorem ipsum"
5. **Responsive:** Always include "Make it fully responsive" instruction
6. **Constraints:** Tell Lovable what NOT to do as well as what to do
7. **Lovable stack:** React + Vite + Tailwind CSS + TypeScript (Lovable's native stack)

The LOVABLE_MOCKUP_V1 template already encodes these guidelines. Claude generates the prompt following this structure.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/utils/promptRouter.js` -- LOVABLE_MOCKUP_V1 routing already implemented
- Codebase: `src/config/seeds/seed_v2_foundation.js` -- Full LOVABLE_MOCKUP_V1 template (lines 393-486)
- Codebase: `src/config/migrations/005_v2_prompt_foundation.sql` -- mockup_sent + mockup_lovable_prompt columns
- Codebase: `src/utils/prefetch.js` -- analyzeUrl() with Cheerio, existing URL analysis pipeline
- Codebase: `src/routes/replies.js` -- 7-step generation pipeline, extractInternalBlocks() parser pattern
- Codebase: `client/src/pages/Inbox.jsx` -- handleGenerate(source) pattern, existing button UI
- Codebase: `client/src/api.js` -- generateReply already passes `source` param
- Codebase: `src/tests/lovable-generator.test.js` -- old test file referencing non-existent routes (needs rewrite)

### Secondary (MEDIUM confidence)
- [Lovable Prompting Bible](https://lovable.dev/blog/2025-01-16-lovable-prompting-handbook) -- Official prompt structure and best practices
- [Lovable Best Practices Documentation](https://docs.lovable.dev/tips-tricks/best-practice) -- Prompt formatting and technology constraints
- [Lovable Prompts Guide 2026](https://promptxl.com/best-lovable-prompts-2026-guide/) -- Community-verified prompt patterns

### Tertiary (LOW confidence)
- Color extraction approach via Cheerio regex -- based on general web scraping patterns, not a specific library. Effectiveness depends on how client sites are built (CSS-in-JS sites will yield no colors). Verified that no lightweight Node.js library exists for this specific task that doesn't require Puppeteer.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- everything already exists in the codebase, no new dependencies
- Architecture: HIGH -- follows established patterns (promptRouter, prefetch, replies pipeline)
- Decision matrix: HIGH -- deterministic keyword matching, well-defined requirements
- Color extraction: MEDIUM -- Cheerio is limited to static HTML; JavaScript-rendered styles will be missed. Acceptable degradation.
- Lovable prompt quality: MEDIUM -- depends on Claude's adherence to the structured output format. Parsing needs robust fallbacks.
- Pitfalls: HIGH -- based on direct codebase analysis and known system behavior

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- no external dependencies changing)
