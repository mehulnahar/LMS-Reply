# Phase 12: Prompt Routing + Pre-Generation Pipeline - Research

**Researched:** 2026-03-05
**Domain:** Prompt routing logic, server-side URL analysis (Cheerio), pre-generation context pipeline, Anthropic API context injection
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROMPT-02 | Auto-select correct prompt based on conversation context: first reply → EMAIL_REPLY_V2; ongoing thread (2+ exchanges) → THREAD_CONTINUATION_V1; silent ≥3 days → FOLLOW_UP_V2; "Generate Proposal" → PROPOSAL_V4; "Generate Mockup" → LOVABLE_MOCKUP_V1; STOP classification → suppress | Rule-based router reads `thread_depth`, `thread_client_messages`, last email `received_at`, and UI button source from request body — all data already on the jobs and emails tables |
| PROMPT-03 | Reply editor shows badge indicating active prompt (e.g., "Using: First Reply") | Frontend badge component reads `promptType` from generate response; DB columns `last_prompt_used` already exists on jobs table |
| PROMPT-04 | User can manually override auto-selected prompt via dropdown in reply editor | Frontend adds `promptOverride` param to generate call; backend accepts and respects it |
| PREFETCH-01 | Before generating, ensure full job description is loaded from LeadHack; if cached on job record use it; if not, auto-fetch via POST /getJobDetails | jobs.job_description_raw column already exists (migration 005); fetch pattern identical to existing match route |
| PREFETCH-02 | Scan job description and email thread for URLs via regex (http/https); store as JSON on job record | jobs.link_analysis_json column already exists; URL regex pattern is simple and well-understood |
| PREFETCH-03 | For each extracted URL, fetch and analyze page content server-side (load speed, mobile UX, tech stack, SEO gaps, broken elements); store findings as structured JSON | Cheerio 1.x (CJS) + Node.js native fetch + AbortController for timeouts — no Puppeteer needed |
| PREFETCH-04 | Link analysis runs before generation; best finding injected into prompt context | Context building pattern: append structured block to system prompt before Claude API call |
| PREFETCH-05 | Generated output includes internal [JOB ANALYSIS] and [LINK ANALYSIS] blocks stored on reply record — never included in copy-to-clipboard | Replies table needs new columns (`prompt_type_used`, `job_analysis_block`, `link_analysis_block`); frontend strips internal blocks before clipboard |
</phase_requirements>

---

## Summary

Phase 12 wires together the Phase 11 infrastructure (prompt templates in DB, jobs schema v2 columns) into a working pre-generation pipeline. The generation route (`POST /api/replies/generate`) is expanded into a multi-step orchestrator: (1) route to correct prompt template based on conversation signals, (2) ensure job description is cached, (3) extract and analyze URLs from job description + email body, (4) inject all context into Claude, (5) store structured analysis blocks alongside the generated reply.

The prompt routing logic is a straightforward rule-based switch — no ML needed. The inputs (thread depth, message count, time since last email, which button was clicked) are all already available or easily derived from existing DB columns. The URL analysis is the most novel piece: it uses Cheerio 1.x (CommonJS-compatible) plus Node.js native `fetch` with `AbortController` timeouts to fetch and parse pages server-side on Railway, avoiding all CORS issues.

The key architectural insight is that all five steps run **serially within a single route handler** before Claude is called. There is no separate endpoint for pre-fetching — the "Generate Reply" click triggers the whole pipeline. Failures at prefetch steps (LeadHack unreachable, URL fetch times out, URL returns 403) must degrade gracefully: proceed with a warning, never block generation entirely.

**Primary recommendation:** Extend the existing `POST /api/replies/generate` route into a sequential pipeline (route → prefetch job → extract URLs → analyze URLs → build context → call Claude → store results). Add `cheerio` to backend dependencies. Add a migration (006) for new `replies` columns. Keep all analysis server-side.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js native `fetch` | Node 18+ built-in | HTTP requests for URL analysis and LeadHack calls | Already used throughout codebase (see replies.js, timezone.js) — no extra dependency |
| `cheerio` | 1.x (latest: 1.2.0) | Parse fetched HTML — extract title, meta description, headings, links, tech signals | Industry standard for server-side HTML parsing; CJS-compatible; no headless browser needed; Node 18.17+ required (already met) |
| `AbortController` | Node 18+ built-in | Add per-URL fetch timeouts (5000ms) to prevent Railway request hangs | Critical — Railway has known issues with native fetch hanging; AbortController is the standard fix |
| PostgreSQL `JSONB` | Existing (pg 8.x) | Store URL analysis findings and job analysis blocks as structured JSON | Already used (`link_analysis_json`, `job_analysis_json` columns exist in jobs table) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Anthropic Claude Sonnet | `claude-sonnet-4-6` | Heavy generation: reply, proposal, follow-up, mockup | All 5 prompt types |
| Anthropic Claude Haiku | `claude-3-5-haiku-20241022` | Optional: fast classification/scoring if needed inside pipeline | Lightweight sub-tasks only — do NOT use for main generation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cheerio` | `puppeteer` / `playwright` | Puppeteer requires a Chromium install — adds ~300MB to Railway deployment, 4-6s per page vs ~0.5s for cheerio. Overkill: most client sites are server-rendered or have meaningful static HTML |
| `cheerio` | `node-html-parser` | Lighter alternative to cheerio, but fewer selectors and no `.attr()` chaining. Cheerio is more battle-tested for meta tag extraction |
| Rule-based routing | ML classifier | ML adds complexity, latency, and training data needs. Rule-based is perfectly adequate: the 5 prompt types have clear, non-overlapping signals |

**Installation (backend):**
```bash
npm install cheerio
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── routes/
│   └── replies.js          # Extend existing: add pipeline orchestration
├── utils/
│   ├── promptRouter.js     # NEW: determinePromptType(email, job, options) → prompt_type_enum
│   ├── prefetch.js         # NEW: ensureJobDescription(), extractUrls(), analyzeUrl(), analyzeAllUrls()
│   └── emailAnalysis.js    # Existing — no changes
├── config/
│   └── migrations/
│       └── 006_reply_analysis_columns.sql  # NEW: add columns to replies table
```

### Pattern 1: Rule-Based Prompt Router

**What:** A pure function that takes email/job/context signals and returns one of the 5 `prompt_type_enum` values (or `null` for STOP suppression).

**When to use:** Every time "Generate Reply", "Generate Proposal", or "Generate Mockup" is clicked.

**Decision tree (in priority order):**
1. If `options.promptOverride` provided and valid → use it (PROMPT-04 manual override)
2. If `options.source === 'proposal'` → `PROPOSAL_V4`
3. If `options.source === 'mockup'` → `LOVABLE_MOCKUP_V1`
4. If email `intent === 'ooo'` or `is_ooo === true` → `null` (STOP — suppress)
5. If `thread_client_messages >= 2` OR `thread_depth >= 2` → `THREAD_CONTINUATION_V1`
6. If days since last email in thread >= 3 AND `thread_depth >= 1` → `FOLLOW_UP_V2`
7. Default → `EMAIL_REPLY_V2`

**Example:**
```javascript
// Source: codebase pattern (promptRouter.js — new file)
// Uses data already available in emails + jobs tables

function determinePromptType(email, job, options = {}) {
  const VALID_TYPES = ['EMAIL_REPLY_V2', 'THREAD_CONTINUATION_V1', 'FOLLOW_UP_V2', 'PROPOSAL_V4', 'LOVABLE_MOCKUP_V1'];

  // 1. Manual override (PROMPT-04)
  if (options.promptOverride && VALID_TYPES.includes(options.promptOverride)) {
    return options.promptOverride;
  }

  // 2. Explicit button source
  if (options.source === 'proposal') return 'PROPOSAL_V4';
  if (options.source === 'mockup') return 'LOVABLE_MOCKUP_V1';

  // 3. STOP — suppress generation
  if (email.is_ooo || email.intent === 'ooo') return null;

  // 4. Ongoing thread
  const threadClientMsgs = job?.thread_client_messages || 0;
  const threadDepth = job?.thread_depth || 0;
  if (threadClientMsgs >= 2 || threadDepth >= 2) return 'THREAD_CONTINUATION_V1';

  // 5. Follow-up (client silent ≥3 days, thread has started)
  const daysSinceEmail = (Date.now() - new Date(email.received_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceEmail >= 3 && threadDepth >= 1) return 'FOLLOW_UP_V2';

  // 6. Default: first reply
  return 'EMAIL_REPLY_V2';
}

module.exports = { determinePromptType };
```

### Pattern 2: Pre-Generation Pipeline in replies.js

**What:** Sequential async steps before calling Claude. Each step degrades gracefully on failure.

**When to use:** Every call to `POST /api/replies/generate`.

**Example:**
```javascript
// Pseudocode for extended replies.js POST /generate handler

router.post('/generate', requireAuth, async (req, res, next) => {
  try {
    const { emailId, tone, promptOverride, source } = req.body;

    // --- Get email + job (existing pattern) ---
    const email = await getEmail(emailId, req.user.id);
    const job = await getJobForEmail(email.id);

    // --- STEP 1: Prompt routing ---
    const promptType = determinePromptType(email, job, { promptOverride, source });
    if (promptType === null) {
      return res.json({ suppressed: true, reason: 'STOP classification — OOO or suppressed intent' });
    }

    // --- STEP 2: Load prompt template from DB ---
    const template = await getPromptTemplate(promptType, req.user.id);

    // --- STEP 3: Ensure job description (PREFETCH-01) ---
    let jobDescriptionWarning = null;
    if (job && !job.job_description_raw && !job.job_description) {
      try {
        await ensureJobDescription(job, email, req.user.id);
      } catch (err) {
        jobDescriptionWarning = `LeadHack prefetch failed: ${err.message}`;
        // Proceed anyway — generation still runs
      }
    }

    // --- STEP 4: Extract + analyze URLs (PREFETCH-02, PREFETCH-03) ---
    let linkAnalysis = job?.link_analysis_json;
    if (!linkAnalysis) {
      const urls = extractUrls(job?.job_description_raw || job?.job_description, email.body_text);
      if (urls.length > 0) {
        linkAnalysis = await analyzeAllUrls(urls); // stores to job.link_analysis_json
        await pool.query('UPDATE jobs SET link_analysis_json = $1 WHERE id = $2', [JSON.stringify(linkAnalysis), job.id]);
      }
    }

    // --- STEP 5: Build context + call Claude (PREFETCH-04) ---
    const { systemPrompt, userMessage } = buildPromptWithContext(template, email, job, linkAnalysis, tone);
    const claudeResponse = await callClaude(systemPrompt, userMessage, anthropicKey);

    // --- STEP 6: Extract internal blocks (PREFETCH-05) ---
    const { cleanText, jobAnalysisBlock, linkAnalysisBlock } = extractInternalBlocks(claudeResponse.text);

    // --- STEP 7: Store reply with metadata ---
    const reply = await saveReply({
      userId: req.user.id, emailId, jobId: job?.id,
      tone, promptTypeUsed: promptType,
      generatedText: cleanText,
      jobAnalysisBlock, linkAnalysisBlock,
      // ...
    });

    // --- Update job with last_prompt_used ---
    if (job) {
      await pool.query('UPDATE jobs SET last_prompt_used = $1 WHERE id = $2', [promptType, job.id]);
    }

    res.json({
      reply: { ...reply, promptTypeUsed: promptType },
      warning: jobDescriptionWarning || undefined,
    });
  } catch (err) {
    next(err);
  }
});
```

### Pattern 3: URL Extraction via Regex (PREFETCH-02)

**What:** Extract all unique http/https URLs from text strings. Simple regex, no library needed.

**Example:**
```javascript
// Source: MDN regex reference + codebase pattern
function extractUrls(...textSources) {
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/g;
  const seen = new Set();
  const urls = [];

  for (const text of textSources) {
    if (!text) continue;
    const matches = text.match(urlRegex) || [];
    for (const url of matches) {
      // Clean trailing punctuation that may have been captured
      const clean = url.replace(/[.,;:!?)]+$/, '');
      if (!seen.has(clean) && clean.length < 500) {
        seen.add(clean);
        urls.push(clean);
      }
    }
  }

  // Limit to first 5 URLs to avoid excessive Railway compute
  return urls.slice(0, 5);
}
```

### Pattern 4: Server-Side URL Analysis with Cheerio + AbortController (PREFETCH-03)

**What:** Fetch a URL server-side, parse HTML, extract tech signals and SEO gaps.

**Why server-side:** Avoids CORS errors entirely. Railway can make outbound HTTP requests.

**Critical:** Use `AbortController` with 5000ms timeout to prevent Railway's native fetch hanging issue.

**Example:**
```javascript
// Source: cheerio.js.org docs + Railway fetch timeout known issue pattern
const cheerio = require('cheerio');  // CJS require works in cheerio 1.x

async function analyzeUrl(url) {
  const result = {
    url,
    status: null,
    title: null,
    description: null,
    h1: null,
    techSignals: [],
    seoGaps: [],
    findings: [],
    bestFindingForReply: null,
    error: null,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LMSReply/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    result.status = response.status;

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      result.findings.push(`Site returned ${response.status} error`);
      return result;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata
    result.title = $('title').text().trim() || null;
    result.description = $('meta[name="description"]').attr('content') || null;
    result.h1 = $('h1').first().text().trim() || null;

    // Tech signals from script/link tags
    const signals = [];
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src.includes('react')) signals.push('React');
      if (src.includes('vue')) signals.push('Vue');
      if (src.includes('angular')) signals.push('Angular');
      if (src.includes('jquery')) signals.push('jQuery');
      if (src.includes('shopify')) signals.push('Shopify');
      if (src.includes('wp-content')) signals.push('WordPress');
    });
    // Check meta generator
    const generator = $('meta[name="generator"]').attr('content') || '';
    if (generator.includes('WordPress')) signals.push('WordPress');
    if (generator.includes('Shopify')) signals.push('Shopify');
    if (generator.includes('Wix')) signals.push('Wix');
    result.techSignals = [...new Set(signals)];

    // SEO gaps (observable without running the page)
    if (!result.description) result.seoGaps.push('Missing meta description');
    if (!result.h1) result.seoGaps.push('No H1 tag found');
    const imgsMissingAlt = $('img:not([alt])').length;
    if (imgsMissingAlt > 0) result.seoGaps.push(`${imgsMissingAlt} image(s) missing alt text`);
    const viewport = $('meta[name="viewport"]').attr('content');
    if (!viewport) result.seoGaps.push('Missing viewport meta — mobile UX concern');

    // Build findings array
    if (result.seoGaps.length > 0) {
      result.findings.push(...result.seoGaps);
    }
    if (result.techSignals.length > 0) {
      result.findings.push(`Tech stack detected: ${result.techSignals.join(', ')}`);
    }

    // Best finding for reply injection (first finding, if any)
    result.bestFindingForReply = result.findings[0] || null;

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      result.error = 'Fetch timed out (5s limit)';
    } else {
      result.error = err.message;
    }
  }

  return result;
}
```

### Pattern 5: Context Injection into Prompt (PREFETCH-04)

**What:** Append structured job analysis and link analysis context to the system prompt before calling Claude. Use XML-style tags per Anthropic best practices.

**Example:**
```javascript
// Source: Anthropic prompting best practices (platform.claude.com) + codebase pattern
function buildPromptWithContext(template, email, job, linkAnalysis, tone) {
  let systemPrompt = template.content; // Full system prompt from DB

  // Inject job analysis context
  if (job?.job_description_raw || job?.job_description) {
    const desc = job.job_description_raw || job.job_description;
    systemPrompt += `\n\n<job_context>
Job Title: ${job.job_heading || 'Unknown'}
Job Description: ${desc.substring(0, 1000)}
Client: ${[job.client_first_name, job.client_last_name].filter(Boolean).join(' ') || 'Unknown'}
${job.country ? `Location: ${[job.city, job.country].filter(Boolean).join(', ')}` : ''}
${job.hourly_budget_min ? `Budget: $${job.hourly_budget_min}–${job.hourly_budget_max}/hr` : ''}
</job_context>`;
  }

  // Inject link analysis (PREFETCH-04)
  if (linkAnalysis && linkAnalysis.length > 0) {
    const bestLink = linkAnalysis.find(l => l.bestFindingForReply) || linkAnalysis[0];
    if (bestLink?.bestFindingForReply) {
      systemPrompt += `\n\n<link_analysis>
URL Analyzed: ${bestLink.url}
Key Finding: ${bestLink.bestFindingForReply}
</link_analysis>

Use the key finding above naturally in your reply when appropriate — don't force it.`;
    }
  }

  return { systemPrompt, userMessage: buildUserMessage(email, job) };
}
```

### Pattern 6: Internal Block Extraction (PREFETCH-05)

**What:** Strip `[JOB ANALYSIS]` and `[LINK ANALYSIS]` blocks from copy-to-clipboard text; store them separately.

**Example:**
```javascript
// Regex-based extraction — simple and reliable
function extractInternalBlocks(rawText) {
  const jobBlockRegex = /\[JOB ANALYSIS\]([\s\S]*?)(?=\[LINK ANALYSIS\]|$)/i;
  const linkBlockRegex = /\[LINK ANALYSIS\]([\s\S]*?)$/i;

  const jobMatch = rawText.match(jobBlockRegex);
  const linkMatch = rawText.match(linkBlockRegex);

  // Clean text = everything before any internal block
  let cleanText = rawText;
  const blockStart = rawText.search(/\[JOB ANALYSIS\]|\[LINK ANALYSIS\]/i);
  if (blockStart > -1) {
    cleanText = rawText.substring(0, blockStart).trim();
  }

  return {
    cleanText,
    jobAnalysisBlock: jobMatch ? jobMatch[1].trim() : null,
    linkAnalysisBlock: linkMatch ? linkMatch[1].trim() : null,
  };
}
```

### Anti-Patterns to Avoid

- **Blocking generation on prefetch failure:** If LeadHack is unreachable or a URL times out, generation MUST still proceed. Return a `warning` field alongside the reply, not an error.
- **Fetching URLs client-side (browser fetch):** CORS will block most client websites. Always fetch server-side.
- **Using Puppeteer/Playwright on Railway:** Adds 300MB+ to the container image and 4-6s per URL. Cheerio + native fetch is sufficient for the use case.
- **Fetching all URLs without a limit:** Set a max of 5 URLs per generation call to avoid Railway timeout (Railway default request timeout is 30s; 5 URLs × 5s max each = 25s).
- **Re-analyzing URLs on every generation:** Cache results in `jobs.link_analysis_json`. Only analyze if the field is null or stale.
- **Including internal analysis blocks in the clipboard copy:** The `[JOB ANALYSIS]` and `[LINK ANALYSIS]` blocks must be stripped before returning `generatedText` to the frontend for copy.
- **Using `claude-haiku-4-20250514` — that model ID does not exist** (caused silent failures in timezone feature). Use `claude-3-5-haiku-20241022` for lightweight tasks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML parsing | Custom regex HTML parser | `cheerio` | HTML has too many edge cases; regex fails on nested tags, encoding, malformed HTML |
| URL regex | Overly complex URI parser | Simple `https?://[^\s"'<>)\]]+` regex + `.replace(/[.,;:!?)]+$/, '')` cleanup | Full RFC-3986 URI parsing is overkill; we just need URLs from human-written text |
| Fetch timeouts | `Promise.race` with setTimeout | `AbortController` + `clearTimeout` | AbortController is the correct Web API standard; properly cancels the connection, not just the promise |
| Prompt template storage | Hardcoded prompt strings in code | `prompt_templates` table (already exists) | Already built in Phase 11 — query by `prompt_type` |
| Thread state detection | Complex ML classifier | Direct DB field reads (`thread_depth`, `thread_client_messages`) | Phase 11 already added these columns — they ARE the state machine |

**Key insight:** The hard infrastructure (columns, enums, templates) was built in Phase 11. Phase 12 is the wiring layer — read existing data, make decisions, call existing APIs, store results.

---

## Common Pitfalls

### Pitfall 1: Railway Native Fetch Hanging
**What goes wrong:** `fetch(url)` hangs for 20-60 seconds on Railway without returning — Railway users reported this as a known Undici bug where native fetch fails silently while `curl` works.
**Why it happens:** Railway's network layer has an incompatibility with Node.js's Undici-based native fetch for some outbound requests.
**How to avoid:** Always wrap EVERY external fetch (URL analysis AND LeadHack calls) with `AbortController` at 5000ms for URL analysis, 10000ms for LeadHack. Never use `fetch()` without a signal.
**Warning signs:** Generation calls timing out after 30+ seconds; no error logged; Railway shows request hanging.

### Pitfall 2: Thread State Reading Wrong Column
**What goes wrong:** `thread_client_messages` is always 0 even for long threads — routing always picks `EMAIL_REPLY_V2`.
**Why it happens:** Phase 11 added the columns but they are not yet populated (that population may be Phase 12's job or may need a separate backfill).
**How to avoid:** During prompt routing, also check `thread_depth` as a fallback. Document which process is responsible for incrementing these counters — likely happens in the email sync route when Gmail threads are processed. If neither field is populated, fall back to counting emails with the same `thread_id` in the emails table.
**Warning signs:** Prompt badge always shows "First Reply" regardless of conversation history.

### Pitfall 3: Internal Block Not Stripped
**What goes wrong:** `[JOB ANALYSIS]` block text appears when user clicks "Copy to Clipboard".
**Why it happens:** Frontend copies raw `generatedText` from API response; block extraction only ran server-side on DB storage but wasn't reflected in the API response `generatedText`.
**How to avoid:** The API response `generatedText` field must ALWAYS be the clean text (blocks stripped). Store raw text + blocks separately on the DB record. Return only clean text to frontend.
**Warning signs:** User reports "AI noise" in copied reply; job analysis metadata visible in Upwork message.

### Pitfall 4: Cheerio CJS vs ESM
**What goes wrong:** `const cheerio = require('cheerio')` throws `Cannot find module 'node:stream'` or similar on some environments.
**Why it happens:** Cheerio 1.x is dual CJS/ESM. In standard Node 18+ CommonJS projects (like this codebase), `require('cheerio')` works correctly. The failure only happens in React Native / non-Node environments.
**How to avoid:** This codebase uses CommonJS throughout — `require('cheerio')` is fine on Node 18+. Don't switch to ESM import syntax.
**Warning signs:** Module import error at startup; check Node version (must be >=18.17).

### Pitfall 5: Prompt Template Not Found for User
**What goes wrong:** `getPromptTemplate()` returns null — generation fails with "Template not found".
**Why it happens:** Prompt templates are seeded per-user (Phase 11 seed uses first owner's ID). VA users or newly signed-up owners won't have templates.
**How to avoid:** Build a fallback: if no user-specific template found for `prompt_type`, use the system default (query without user_id filter, or fall back to hardcoded default strings). The `is_system` flag on prompt_templates is meant for this.
**Warning signs:** "Prompt template not found" errors on first generation after new signup.

### Pitfall 6: URLs in Job Descriptions Are Often Upwork Internal Links
**What goes wrong:** URL extraction pulls `https://www.upwork.com/...` links which return 200 but have no useful analysis content for client insight.
**Why it happens:** LeadHack job descriptions often contain Upwork self-referencing links.
**How to avoid:** Filter out `upwork.com` and common CDN/tracking domains before analysis. Add a domain blocklist: `['upwork.com', 'linkedin.com', 'fonts.googleapis.com', 'ga.js', 'fbcdn.net']`.
**Warning signs:** `bestFindingForReply` is always about Upwork's own site.

### Pitfall 7: Replies Table Missing Required Columns
**What goes wrong:** INSERT to `replies` table fails on `prompt_type_used` column not existing.
**Why it happens:** Migration 006 not applied before Phase 12 routes deployed.
**How to avoid:** Phase 12 MUST include migration 006 that adds columns to the `replies` table: `prompt_type_used`, `job_analysis_block`, `link_analysis_block`. Railway auto-deploys run migrations at startup.
**Warning signs:** PostgreSQL `column "prompt_type_used" of relation "replies" does not exist` error.

---

## Code Examples

### URL Domain Blocklist Pattern
```javascript
// Source: codebase pattern (prefetch.js — new file)
const BLOCKED_DOMAINS = [
  'upwork.com', 'linkedin.com', 'twitter.com', 'facebook.com',
  'googleapis.com', 'fbcdn.net', 'doubleclick.net', 'googletagmanager.com',
];

function isAnalyzableUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return !BLOCKED_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}
```

### Migration 006 — Replies Table Additions
```sql
-- Migration 006: Add prompt routing + analysis columns to replies table
-- Phase 12: Prompt Routing + Pre-Generation Pipeline

ALTER TABLE replies ADD COLUMN IF NOT EXISTS prompt_type_used  prompt_type_enum;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS job_analysis_block TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS link_analysis_block TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS prefetch_warnings  TEXT[];  -- Array of non-fatal warnings

CREATE INDEX IF NOT EXISTS idx_replies_prompt_type ON replies (prompt_type_used) WHERE prompt_type_used IS NOT NULL;
```

### Prompt Type Display Names for Frontend Badge (PROMPT-03)
```javascript
// Source: spec requirement PROMPT-03 + prompt_type_enum values
const PROMPT_TYPE_LABELS = {
  'EMAIL_REPLY_V2':         'First Reply',
  'THREAD_CONTINUATION_V1': 'Thread Continuation',
  'FOLLOW_UP_V2':           'Follow-Up',
  'PROPOSAL_V4':            'Proposal',
  'LOVABLE_MOCKUP_V1':      'Lovable Mockup',
};
```

### Frontend: Override Dropdown Options (PROMPT-04)
```javascript
// React component pattern — dropdown sends promptOverride to generate API call
const PROMPT_OPTIONS = [
  { value: '',                       label: 'Auto-detect' },
  { value: 'EMAIL_REPLY_V2',         label: 'First Reply (V2)' },
  { value: 'THREAD_CONTINUATION_V1', label: 'Thread Continuation (V1)' },
  { value: 'FOLLOW_UP_V2',           label: 'Follow-Up (V2)' },
  { value: 'PROPOSAL_V4',            label: 'Proposal (V4)' },
  { value: 'LOVABLE_MOCKUP_V1',      label: 'Lovable Mockup (V1)' },
];
```

### Frontend: api.js Extension for Phase 12
```javascript
// Extend existing generateReply in client/src/api.js
generateReply: (emailId, options = {}) =>
  request('/api/replies/generate', {
    method: 'POST',
    body: JSON.stringify({
      emailId,
      tone: options.tone || 'professional',
      promptOverride: options.promptOverride || null,  // PROMPT-04
      source: options.source || null,                  // 'proposal' | 'mockup' | null
    }),
  }),
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded tone-based prompt | DB-stored prompt templates by type | Phase 11 | Prompts now editable without deployment |
| Single flat `generateReply` endpoint | Pipeline: route → prefetch → analyze → inject → generate | Phase 12 | Claude always has full context |
| Prompt selected by "tone" dropdown | Prompt auto-selected by conversation signals | Phase 12 | Eliminates wrong-prompt errors |
| No URL analysis | Server-side Cheerio fetch + analysis | Phase 12 | Enables "Your site missing X" insight in reply |
| Internal analysis stored nowhere | Stored in `replies` table as separate columns | Phase 12 | Enables future analytics on what findings drove conversions |

**Deprecated/outdated:**
- The `tone` parameter in `POST /api/replies/generate`: It was the original prompt selector. Phase 12 adds `promptOverride` + `source` for routing, but tone should be preserved as an additional modifer (style, not selection).
- `buildSystemPrompt()` and `buildUserMessage()` in replies.js: These hardcoded helpers will be replaced by the template-based system + context injection.

---

## Open Questions

1. **Thread depth population responsibility**
   - What we know: `thread_depth` and `thread_client_messages` columns exist on `jobs` table (Phase 11 migration).
   - What's unclear: Which process increments them? Email sync? Job match? They currently default to 0.
   - Recommendation: Phase 12 should add a counter-update step in the email sync or generate route. Simple approach: count emails sharing the same `thread_id` in the emails table at generation time if `thread_depth === 0`.

2. **Multiple emails per job (thread tracking)**
   - What we know: A single job can have multiple email exchanges over time (each sync pulls new emails). The `jobs` table has one record per email match.
   - What's unclear: When a follow-up email arrives, does a new `jobs` record get created, or does the existing one get updated?
   - Recommendation: Check the email sync code to understand if `jobs` is one-to-one with emails or one-to-many. This affects how `thread_depth` should be computed.

3. **Prompt template per user vs shared**
   - What we know: Templates are seeded for the first owner account. VAs and new owners won't have them.
   - What's unclear: Should template lookup fall back to any user's `is_system` templates, or should they be cloned per user?
   - Recommendation: Query pattern `WHERE (user_id = $1 OR is_system = true) AND prompt_type = $2 ORDER BY user_id DESC LIMIT 1` — user-specific templates take priority over system defaults.

4. **Storing URL analysis results on jobs vs per-generation**
   - What we know: `jobs.link_analysis_json` exists. `replies.link_analysis_block` will be added.
   - What's unclear: Should analysis be re-run if the cached job analysis is >24 hours old?
   - Recommendation: For Phase 12, no TTL — cache indefinitely on the job record. The job description doesn't change; neither will the client's website analysis significantly. Add a "Re-analyze" button in a future phase if needed.

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `src/routes/replies.js`, `src/routes/jobs.js`, `src/config/migrations/005_v2_prompt_foundation.sql`, `src/config/seeds/seed_v2_foundation.js` — existing patterns to follow
- Codebase direct inspection: `src/config/migrations/002_email_and_jobs.sql` — exact schema of `emails`, `jobs`, `replies` tables
- [Cheerio 1.0 Release Blog](https://cheerio.js.org/blog/cheerio-1.0) — confirms CJS support (`require('cheerio')` works), Node 18.17+ requirement, dual ESM/CJS
- [Cheerio Loading Docs](http://cheerio.js.org/docs/basics/loading/) — confirmed `cheerio.load()`, `cheerio.fromURL()` APIs

### Secondary (MEDIUM confidence)
- [Railway fetch timeout known issue](https://station.railway.com/questions/node-js-native-fetch-not-working-conne-08832b48) — confirmed AbortController is the fix
- [Anthropic Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — XML tags for context injection, longform data before query
- [Timeout fetch request in Node.js](https://medium.com/deno-the-complete-reference/timeout-fetch-request-in-node-js-4231f33a9b95) — AbortController pattern for 5s timeouts

### Tertiary (LOW confidence)
- Tech stack detection analysis (Apify/Wappalyzer) — confirmed that HTML inspection of `<script src>` + meta tags is viable without Puppeteer

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Cheerio CJS support confirmed, AbortController pattern confirmed, existing codebase patterns directly verified
- Architecture: HIGH — Routing logic derived directly from spec requirements + existing DB schema; patterns match existing codebase conventions
- Pitfalls: HIGH for Railway fetch issue (directly documented), HIGH for thread state issue (derived from schema inspection), MEDIUM for others (logic analysis)

**Research date:** 2026-03-05
**Valid until:** 2026-06-05 (90 days — Cheerio stable, Node 18 long-term support, Anthropic API stable)
