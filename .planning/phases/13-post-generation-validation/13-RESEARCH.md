# Phase 13: Post-Generation Validation — Research

**Researched:** 2026-03-05
**Domain:** Post-generation text validation, regex scanning, React UI feedback, Claude Haiku secondary calls
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALIDATE-01 | Proposal Gate — scanner detects pricing patterns in reply emails and strips them, replacing with call-redirect language; exception for PROPOSAL_V4 with explicit client request | Backend scanner in `validateReply()` utility using regex pricing patterns; `prompt_type_used` on replies row allows exemption detection |
| VALIDATE-02 | Banned Phrase Scanner — checks output against 40+ banned phrases (banned_phrases table); auto-rewrites or highlights in red before showing to user; tracks violation count | `banned_phrases` table exists (empty, needs seeding). `reply_generations.banned_phrases_caught` column exists for tracking. Frontend highlight via textarea+overlay pattern. |
| VALIDATE-03 | Live word count in reply editor with color indicator (green/yellow/red); limits vary by prompt_type_used (Positive=80, Neutral=120, Follow-Up 1=80, Follow-Up 2=70, Proposal cold=200) | Pure frontend React: `replyText.split(/\s+/).filter(Boolean).length`; `promptTypeUsed` already returned in API response from Phase 12 |
| VALIDATE-04 | Next-Step Enforcement — checks last 2 sentences for specific action + timeframe or question; warns user before copy | Regex-based sentence splitter + action/timeframe/question pattern matching in a backend utility; warn state in React before `handleCopy` allows proceed |
| QUALITY-01 | Follow-Up Specificity Test — secondary Haiku call checks if draft contains client-specific detail; max 2 regen attempts | Loop in `/api/replies/generate` pipeline post-generation step: call Haiku with yes/no classification prompt, retry with stronger instruction if NO; max 2 tries |
| QUALITY-02 | Angle Differentiation — FU1 and FU2 must use different angles; angle stored on job record; FU2 receives FU1's angle as context | `jobs.follow_up_1_angle` and `jobs.follow_up_2_angle` columns exist; store angle from Haiku extraction; inject FU1 angle into FU2 prompt context |
| QUALITY-03 | Pricing Intelligence in Proposals — PROPOSAL_V4 post-scanned for $ amounts in proposal body; strip and replace with call-redirect | Same `validateReply()` scanner as VALIDATE-01; gated to PROPOSAL_V4 only since reply emails should never have pricing at all |
| QUALITY-04 | Proof Quality Gate — after Proposal generation, proof section scanned for metrics (%, numbers, timeframes); if none found, proof section removed entirely | Regex scan of proposal body for metric patterns; section removal logic strips the proof block when no metrics detected |
</phase_requirements>

---

## Summary

Phase 13 adds validation and quality gates that run after the main Claude Sonnet reply generation. The work splits across two areas: backend pipeline additions to `src/routes/replies.js` and a new `src/utils/validateReply.js` utility, plus frontend UI additions to `Inbox.jsx` for live word count and warning states.

The key architectural decision is **where validation runs**. For proposal gate (VALIDATE-01), banned-phrase scanning (VALIDATE-02), and quality gates (QUALITY-03, QUALITY-04), the scanner runs on the **backend** — it can then modify `cleanText` before storing it to the `replies` table, and return `validationWarnings` alongside the reply. The frontend then renders a highlight overlay only for **non-auto-fixed** violations (banned phrases that need manual review). For word count (VALIDATE-03) and next-step enforcement (VALIDATE-04), the feedback runs entirely in **frontend state** — no additional API calls needed.

For QUALITY-01 (specificity test), the secondary Haiku call runs **inside the generation pipeline** on the backend, executing after the main Sonnet call and before the INSERT into `replies`. This adds latency (typically 1–2 seconds for Haiku) but keeps the frontend experience clean — the user receives a final, already-validated reply. A loop of maximum 2 regeneration attempts is enforced inline.

**Primary recommendation:** Implement all post-generation scanning in a new `src/utils/validateReply.js` pure utility module; slot it into `replies.js` as "Step 6b" between text extraction and DB insert; add `validation_result` JSON to the replies table for auditability; update the frontend to render word count, warning badges, and next-step warnings using `promptTypeUsed` already in the API response.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in regex | N/A | Pricing pattern, banned phrase, next-step, metric scanning | No dependency; regex sufficient for deterministic rule matching |
| React useState/useEffect | 19.x (existing) | Live word count, warning state, flag display | Already in use across Inbox.jsx |
| Anthropic API (Haiku) | claude-3-5-haiku-20241022 (existing) | QUALITY-01 specificity check, QUALITY-02 angle extraction | Already used for timezone; cheap and fast (~1–2s) |
| PostgreSQL (existing) | pg 8.13.1 | banned_phrases seed, validation columns on replies | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS (existing) | 3.4.x | Color-coded word count badge (green/yellow/red classes) | Already used everywhere in Inbox.jsx |
| Jest (existing) | 29.7.0 | Unit tests for validateReply.js utility | For testing all scanner functions in isolation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom regex scanner | `react-highlight-within-textarea` v3.2.2 | Library requires Draft.js (largely abandoned 2025); custom overlay is 15 lines and has no dependency |
| Backend Haiku for next-step | Regex-only next-step detection | Regex covers 90% of cases cheaply; Haiku would add latency to every generation for marginal gain |
| Inline pipeline retry | Queued async retry | Queued approach adds complexity; max-2-attempt inline retry adds ~2–4s worst case, acceptable |

**No new dependencies required for this phase.**

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── utils/
│   └── validateReply.js     # NEW: All post-generation scanners (pure functions)
├── routes/
│   └── replies.js           # MODIFIED: Add Step 6b validation pipeline
├── config/
│   └── migrations/
│       └── 007_validation_columns.sql  # NEW: Add validation columns to replies
client/src/
├── pages/
│   └── Inbox.jsx            # MODIFIED: word count badge, next-step warning, banned phrase flag list
```

### Pattern 1: Backend Validation Pipeline (Step 6b in replies.js)

**What:** After `extractInternalBlocks()` (Step 6), run a synchronous validation pass on `cleanText` before the DB INSERT. Returns a `validationResult` object containing warnings and auto-fixed text.

**When to use:** Every generation, regardless of prompt type. The validator checks `promptType` internally to gate proposal-specific rules.

**Example:**
```javascript
// src/utils/validateReply.js (CommonJS)
'use strict';

/**
 * PRICING_PATTERNS — matched against reply body for VALIDATE-01 / QUALITY-03
 * These patterns must NEVER appear in reply emails (they belong in proposals only
 * when the client explicitly requested pricing).
 */
const PRICING_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/g,            // $500, $1,200.00
  /\bUSD\b/gi,
  /\bprice[sd]?\b/gi,
  /\bcost[s]?\b/gi,
  /\bbudget\b/gi,
  /\bphase\s+[1-9]\b/gi,             // phase 1, phase 2
  /\btimeline\b/gi,
  /\bweeks?\b/gi,
  /\bdeliverable[s]?\b/gi,
];

const CALL_REDIRECT = "I'd love to discuss the details on a quick call.";

/**
 * proposalGate — VALIDATE-01
 * Strips pricing language from reply emails (not from PROPOSAL_V4 with explicit client request).
 */
function proposalGate(text, promptType, clientRequestedPricing = false) {
  // PROPOSAL_V4 with explicit client request: allowed
  if (promptType === 'PROPOSAL_V4' && clientRequestedPricing) {
    return { text, stripped: false };
  }
  // Reply emails: strip all pricing language
  let cleaned = text;
  let stripped = false;
  for (const pattern of PRICING_PATTERNS) {
    if (pattern.test(cleaned)) {
      stripped = true;
      cleaned = cleaned.replace(pattern, CALL_REDIRECT);
    }
    pattern.lastIndex = 0; // reset /g flags
  }
  return { text: cleaned, stripped };
}

/**
 * bannedPhraseScanner — VALIDATE-02
 * Checks text against banned_phrases loaded from DB.
 * Returns array of matched phrases with their replacement suggestions.
 */
function bannedPhraseScanner(text, bannedPhrases) {
  const lower = text.toLowerCase();
  const violations = [];
  for (const bp of bannedPhrases) {
    if (!bp.active) continue;
    const idx = lower.indexOf(bp.phrase.toLowerCase());
    if (idx !== -1) {
      violations.push({
        phrase: bp.phrase,
        index: idx,
        category: bp.category,
        replacement: bp.replacement_suggestion || null,
      });
    }
  }
  return violations;
}

/**
 * nextStepScanner — VALIDATE-04
 * Checks last 2 sentences for: action verb + timeframe OR direct question.
 * Returns { hasNextStep: boolean, lastTwoSentences: string }
 */
function nextStepScanner(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const last2 = sentences.slice(-2).join(' ');

  // Direct question
  if (/\?/.test(last2)) return { hasNextStep: true, lastTwoSentences: last2 };

  // Action verb + timeframe pattern
  const actionPattern = /\b(let me know|reply|respond|confirm|schedule|book|send|share|reach out|get back|available|connect|discuss|talk|call)\b/i;
  const timeframePattern = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|this week|next week|within \d+|by end|eod|asap|soon)\b/i;

  if (actionPattern.test(last2) && timeframePattern.test(last2)) {
    return { hasNextStep: true, lastTwoSentences: last2 };
  }

  return { hasNextStep: false, lastTwoSentences: last2 };
}

/**
 * metricsScanner — QUALITY-04
 * Scans proposal proof section for metric patterns (%, numbers, timeframes).
 * Returns { hasMetrics: boolean }
 */
function metricsScanner(text) {
  const metricPattern = /\b\d+%|\b\d+x\b|\b\d+\s*(days?|weeks?|months?|hours?|clients?|projects?|years?)\b/i;
  return { hasMetrics: metricPattern.test(text) };
}

module.exports = {
  proposalGate,
  bannedPhraseScanner,
  nextStepScanner,
  metricsScanner,
  CALL_REDIRECT,
};
```

### Pattern 2: Word Count Component (Frontend)

**What:** Inline word count display below the reply textarea. Uses `promptTypeUsed` (already in API response) to determine the limit. Color classes from Tailwind.

**When to use:** Any time `replyText` is non-empty in Inbox.jsx.

**Example:**
```javascript
// Inside Inbox.jsx — pure computation, no new hooks needed

const WORD_LIMITS = {
  EMAIL_REPLY_V2:         120,  // Neutral
  THREAD_CONTINUATION_V1: 120,  // Neutral
  FOLLOW_UP_V2:           80,   // Follow-Up 1 (default; FU2 uses 70)
  PROPOSAL_V4:            200,  // Proposal cold
  LOVABLE_MOCKUP_V1:      200,  // Generous for mockup context
};

// Derive word count — computed inline, not state
const wordCount = replyText
  ? replyText.split(/\s+/).filter(Boolean).length
  : 0;
const wordLimit = WORD_LIMITS[activePromptType] || 120;
const ratio = wordCount / wordLimit;

// Color class
const wordCountColor =
  ratio < 0.9 ? 'text-emerald-600 dark:text-emerald-400'
  : ratio <= 1.0 ? 'text-amber-500 dark:text-amber-400'
  : 'text-red-500 dark:text-red-400';

// Render below textarea:
// <span className={wordCountColor}>{wordCount} / {wordLimit} words</span>
```

Note: The spec distinguishes "Positive=80" vs "Neutral=120". The `intent` field on the reply (already stored) can be used: if `intent === 'positive_feedback'` → 80 words, else use the type-based limit.

### Pattern 3: Banned Phrase Highlighting Overlay

**What:** A `<div>` mirroring the textarea content, positioned behind a semi-transparent textarea, with `<mark>` spans over banned phrases. Used only in "flag mode" (show to user, not auto-rewrite).

**When to use:** When backend returns `bannedPhraseViolations` in the API response.

**Key constraint:** The textarea and overlay div MUST share identical CSS: same `font-size`, `line-height`, `padding`, `font-family`, `word-break`. Any mismatch causes text to misalign between the two layers.

**Example:**
```jsx
// BannedPhraseEditor component (simplified)
function BannedPhraseEditor({ value, onChange, violations }) {
  // Build highlighted HTML from violations
  const highlightedHtml = useMemo(() => {
    if (!violations?.length) return escapeHtml(value);
    let result = escapeHtml(value);
    // Sort violations by index descending to avoid offset drift
    const sorted = [...violations].sort((a, b) => b.index - a.index);
    for (const v of sorted) {
      const escaped = escapeHtml(v.phrase);
      result = result.replace(
        new RegExp(escaped, 'gi'),
        `<mark class="bg-red-200 dark:bg-red-900/50 rounded px-0.5">${escaped}</mark>`
      );
    }
    return result;
  }, [value, violations]);

  return (
    <div className="relative">
      {/* Background highlight layer */}
      <div
        aria-hidden="true"
        className="absolute inset-0 px-4 py-3 text-sm whitespace-pre-wrap break-words pointer-events-none"
        style={{ font: 'inherit', color: 'transparent' }}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
      {/* Editable textarea (transparent text so highlight shows through) */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        className="relative w-full px-4 py-3 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y caret-gray-900 dark:caret-gray-100"
        style={{ color: 'transparent', WebkitTextFillColor: 'transparent' }}
      />
    </div>
  );
}
```

**Important:** When no violations, render the plain `<textarea>` (current behavior) — no overlay needed. The component switches between plain and overlay modes.

### Pattern 4: QUALITY-01 Specificity Retry Loop

**What:** After main Sonnet generation, a secondary Haiku call classifies whether the reply is client-specific. If NO, append a stronger instruction and regenerate with Sonnet. Max 2 attempts.

**When to use:** Only when `promptType === 'FOLLOW_UP_V2'`.

**Example:**
```javascript
// Inside replies.js — after extractInternalBlocks() and before INSERT

async function checkFollowUpSpecificity(text, clientName, projectType, anthropicKey) {
  const prompt = `Does this follow-up contain at least one detail specific to ${clientName}'s ${projectType || 'project'}? Reply YES or NO only.\n\nFollow-up:\n${text.substring(0, 500)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return true; // Fail open — don't block on Haiku errors
  const data = await res.json();
  const answer = data.content?.[0]?.text?.trim().toUpperCase() || 'YES';
  return answer.startsWith('YES');
}

// In the pipeline (FOLLOW_UP_V2 only, max 2 regen attempts):
let { cleanText, jobAnalysisBlock, linkAnalysisBlock } = extractInternalBlocks(rawText);
let specificityAttempts = 0;

if (promptType === 'FOLLOW_UP_V2' && job) {
  const clientName = [job.client_first_name, job.client_last_name].filter(Boolean).join(' ');
  const projectType = job.job_heading || job.category || 'project';

  while (specificityAttempts < 2) {
    const isSpecific = await checkFollowUpSpecificity(cleanText, clientName, projectType, anthropicKey);
    if (isSpecific) break;

    specificityAttempts++;
    // Regenerate with stronger instruction injected into userMessage
    const strongerMessage = buildUserMessage(email, job) +
      `\n\nIMPORTANT: The previous draft was too generic. Your reply MUST contain at least one specific detail about ${clientName}'s ${projectType}. Reference something concrete from the job description or email.`;

    const regenRes = await fetch('https://api.anthropic.com/v1/messages', { /* same params, new message */ });
    const regenData = await regenRes.json();
    const regenRaw = regenData.content?.[0]?.text || cleanText;
    ({ cleanText } = extractInternalBlocks(regenRaw));
  }
}
```

### Pattern 5: QUALITY-02 Angle Differentiation

**What:** Extract the angle/hook from each follow-up after generation, store it on `jobs` table. Follow-Up 2 receives Follow-Up 1's angle as "avoid this" context.

**When to use:** When `promptType === 'FOLLOW_UP_V2'`.

**Example:**
```javascript
// After generating a FOLLOW_UP_V2, extract the angle using Haiku:
async function extractFollowUpAngle(text, anthropicKey) {
  const prompt = `In 5-10 words, describe the persuasion angle or hook used in this follow-up message:\n\n${text.substring(0, 400)}\n\nReply with ONLY the angle description, no punctuation.`;
  // ... Haiku call, return text
}

// Store angle on jobs table:
// follow_up_count === 0 → store in follow_up_1_angle
// follow_up_count === 1 → store in follow_up_2_angle
// Pass follow_up_1_angle into FU2 system prompt as:
// "IMPORTANT: Follow-Up 1 used the angle: [angle]. Use a DIFFERENT angle for this reply."
```

### Pattern 6: Migration 007 (New Columns for Validation)

**What:** Add validation result columns to `replies` table to store scanner outputs for auditability.

```sql
-- Migration 007: Post-Generation Validation columns
-- Phase 13: Post-Generation Validation

ALTER TABLE replies ADD COLUMN IF NOT EXISTS banned_phrases_caught  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS has_next_step          BOOLEAN;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS proposal_gate_fired    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS specificity_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS validation_warnings    TEXT[];

CREATE INDEX IF NOT EXISTS idx_replies_banned_phrases
  ON replies (banned_phrases_caught)
  WHERE banned_phrases_caught > 0;
```

Note: `reply_generations.banned_phrases_caught` already exists (migration 005). The new column on `replies` is for the per-reply record. Both should be populated.

### Anti-Patterns to Avoid

- **Running Haiku specificity check for ALL prompt types:** QUALITY-01 applies only to `FOLLOW_UP_V2`. Checking every generation wastes tokens and adds latency to simple reply emails.
- **Using `contenteditable` or Draft.js for banned phrase highlighting:** Draft.js is largely abandoned in 2025. The textarea+overlay CSS trick requires zero new dependencies and works reliably.
- **Blocking the user when validation fails:** VALIDATE-04 (next-step) should WARN, not block. The user must be able to proceed anyway. Only show a confirmation dialog.
- **Storing highlights in DB:** Only store the count and flags — never store the raw highlight positions, as the text may be edited post-generation.
- **Running regex on the DB at query time:** Load banned_phrases at application startup or cache them per-request from the DB — never run SQL LIKE queries for each phrase on generation.
- **Infinite specificity retry:** Hard cap at 2 attempts. If Haiku is unavailable, fail open (accept the reply as-is).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Word count display | Complex character/word counter library | Inline `text.split(/\s+/).filter(Boolean).length` | 1 line of JS; no dependency needed |
| Textarea phrase highlighting | Draft.js, Tiptap, Slate, ProseMirror | CSS overlay div behind a transparent textarea | Full rich-text editors are overkill; overlay trick is 20 lines, no deps |
| Sentence splitting | NLP library (compromise.js, natural) | Regex `/(?<=[.!?])\s+/` split | NLP adds 50-300kB; regex sufficient for last-2-sentences check |
| Pricing pattern replacement | LLM rewrite | Regex replace with fixed `CALL_REDIRECT` string | LLM adds latency; pricing patterns are deterministic |
| Anthropic API direct fetch | Custom HTTP client | Existing `fetch()` pattern from replies.js | Already established; consistent with codebase |

**Key insight:** All scanning in this phase is deterministic rule-matching that regex handles cleanly. Only QUALITY-01 (specificity classification) genuinely requires LLM judgment and warrants a Haiku call.

---

## Common Pitfalls

### Pitfall 1: Regex Global Flag State Pollution
**What goes wrong:** Using `/pattern/g` regex literals defined at module scope causes `lastIndex` to persist between calls. After the first match on some text, the next call starts from where the last left off and misses matches.
**Why it happens:** JavaScript's `/g` regexes are stateful — `lastIndex` advances after each `exec()` or `test()` call. When the regex object is shared, subsequent calls on different strings start from a non-zero index.
**How to avoid:** Reset `lastIndex = 0` after each test, or create new regex instances inside the function: `new RegExp(pattern, 'gi')`. In `validateReply.js`, use array-defined patterns and reset `lastIndex` in the loop.
**Warning signs:** Scanner catches violations on some texts but misses them on others with no obvious pattern.

### Pitfall 2: Textarea/Overlay CSS Misalignment
**What goes wrong:** Highlighted phrases visually drift — the red mark appears over the wrong word.
**Why it happens:** The overlay `<div>` and the `<textarea>` use different `font-size`, `line-height`, `padding`, or `word-break` values. Even 0.5px difference accumulates over multiple lines.
**How to avoid:** Apply `style={{ font: 'inherit' }}` to the overlay div so it inherits identical font metrics from the textarea. Use identical Tailwind padding classes for both. Test at multiple zoom levels.
**Warning signs:** Highlights look correct at 100% zoom but drift at 125% or 150%.

### Pitfall 3: Proposal Gate Stripping Too Aggressively
**What goes wrong:** Words like "timeline" or "weeks" in legitimate reply context get stripped. Example: "I can start within a few weeks of your confirmation" becomes mangled.
**Why it happens:** Pricing patterns are broad (`/\bweeks?\b/gi`). They catch context-neutral uses.
**How to avoid:** Narrow regex patterns — use `\btimeline of the project\b` not `\btimeline\b`; use `\bbudget constraint\b` not `\bbudget\b`; use `\$\d+` not `\$`. Test patterns against the seed of 55 banned phrases. Consider only scanning the LAST 60% of the reply (where pricing details typically appear) for proposal gate.
**Warning signs:** Generation test shows non-pricing language being replaced.

### Pitfall 4: Specificity Check Blocking on Haiku Failure
**What goes wrong:** If Haiku returns a non-200, the whole generation fails.
**Why it happens:** No `try/catch` around the secondary Haiku call.
**How to avoid:** Wrap `checkFollowUpSpecificity()` in try/catch, return `true` (is specific) on any error. Add a warning to `prefetchWarnings` noting the specificity check was skipped.
**Warning signs:** Follow-up generation fails in environments where Haiku is slow or returning 529.

### Pitfall 5: Angle Extraction on Empty Jobs
**What goes wrong:** Angle extraction fails or produces garbage when `job` is null (no matched job).
**Why it happens:** `job.client_first_name`, `job.job_heading` are null.
**How to avoid:** Guard: `if (promptType === 'FOLLOW_UP_V2' && job?.id)` before any angle-related logic. If no job, skip angle storage silently.

### Pitfall 6: Word Count Limit Not Tied to Intent
**What goes wrong:** "Positive" emails use the Neutral 120-word limit instead of 80.
**Why it happens:** VALIDATE-03 spec says `Positive=80`. The `intent` field exists on replies but the frontend currently only uses `activePromptType`.
**How to avoid:** Include `intent` in the API response (it's already stored on the reply row). Pass it back in `responseBody.reply.intent`. In the frontend, apply: if `intent === 'positive_feedback'` and `promptTypeUsed === 'EMAIL_REPLY_V2'`, use limit 80 instead of 120.

### Pitfall 7: Banned Phrase DB Load on Every Generation
**What goes wrong:** Every call to `/api/replies/generate` fires a SELECT for all banned phrases, even when there are only 55 rows.
**Why it happens:** No caching of the banned phrases list.
**How to avoid:** Load banned phrases once at server startup into a module-level variable. Refresh on a TTL (e.g., 1 hour) if they can be changed by the user. Since banned phrases are currently global (not per-user), a simple module-level array is appropriate. If the Settings UI lets users modify them, use a 5-minute cache.

---

## Code Examples

Verified patterns from this codebase:

### Haiku Call Pattern (from timezone.js)
```javascript
// Source: src/routes/timezone.js (established pattern)
const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': anthropicKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 10,  // Yes/No answer only needs 10 tokens
    messages: [{ role: 'user', content: prompt }],
  }),
});
if (!claudeRes.ok) return true; // fail open
const data = await claudeRes.json();
const answer = data.content?.[0]?.text?.trim() || 'YES';
```

### Step 6b Validation Slot in replies.js Pipeline
```javascript
// Source: replies.js Step 6 → Step 6b pattern (new addition)
// After: const { cleanText, ... } = extractInternalBlocks(rawText);
// Before: INSERT INTO replies

// Load banned phrases (cached at module scope)
const bannedPhrases = await getBannedPhrasesCache(pool);

// Run validation pipeline
const { text: validatedText, warnings: validationWarnings, bannedCount, proposalGateFired } =
  await runValidationPipeline(cleanText, promptType, bannedPhrases, email, job, anthropicKey);

// Use validatedText (not cleanText) in the INSERT
```

### Reply API Response Shape (Extended)
```javascript
// Extended responseBody to include validation data for frontend
const responseBody = {
  reply: {
    id: reply.id,
    generatedText: reply.generated_text,
    promptTypeUsed: reply.prompt_type_used,
    promptLabel: PROMPT_TYPE_LABELS[reply.prompt_type_used] || null,
    tone: reply.tone,
    intent: reply.intent,           // NEEDED for VALIDATE-03 word limit
    model: reply.model,
    promptTokens: reply.prompt_tokens,
    completionTokens: reply.completion_tokens,
    createdAt: reply.created_at,
    // NEW validation fields:
    bannedPhraseViolations: violations,      // Array of { phrase, category, replacement }
    hasNextStep: nextStepResult.hasNextStep, // boolean
    validationWarnings: validationWarnings,  // string[]
  },
};
```

### Word Count Badge (Tailwind, no new deps)
```jsx
// Source: pattern derived from existing Inbox.jsx badge pattern
{replyText && activePromptType && (
  <span className={`text-xs font-mono tabular-nums ${wordCountColor}`}>
    {wordCount} / {wordLimit} words
  </span>
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Draft.js for text editing/highlighting | CSS textarea overlay trick OR Tiptap/Lexical | 2023-2025 (Draft.js abandoned) | No heavy editor dependency needed for simple phrase flagging |
| NLP library for sentence detection | Regex lookbehind split | Regex lookbehind widely supported since Node 10 | No NLP library needed for basic last-sentence extraction |
| Blocking validation (copy disabled until fixed) | Warning-first UX (copy allowed with confirmation) | 2022+ (progressive disclosure UX) | Better user experience; validation serves as guidance not gatekeeper |

**Note on lookbehind regex:** `/(?<=[.!?])\s+/` requires Node.js >= 10 (lookbehind assertions). The project requires `node >= 18.0.0` per package.json `engines` field, so this is safe.

---

## Open Questions

1. **Banned phrase auto-rewrite vs flag mode — which is default?**
   - What we know: VALIDATE-02 says "auto-rewrites OR highlights in red." Both modes are described.
   - What's unclear: Whether the default is auto-rewrite (text silently fixed) or flag mode (user sees highlighted violations), or if there's a settings toggle.
   - Recommendation: Default to **auto-rewrite** using `replacement_suggestion` from the DB where available. When `replacement_suggestion` is null, fall back to flag mode (highlight red). This avoids a Settings UI requirement and gives deterministic behavior.

2. **Follow-Up 2 word limit is 70 (per spec) — how does the system distinguish FU1 vs FU2?**
   - What we know: `FOLLOW_UP_V2` is the prompt type for both. `jobs.follow_up_count` tracks how many follow-ups have been sent.
   - What's unclear: `follow_up_count` is on `jobs` (matched job), but the frontend only has `activePromptType` from the reply.
   - Recommendation: Add `followUpSequence` (1 or 2) to the API response, derived from `job.follow_up_count` at generation time. Frontend uses this to select 80 vs 70 limit.

3. **Seed data for banned_phrases — is it expected in Phase 13 or already done?**
   - What we know: The table exists (migration 005) but has 0 rows in the production DB.
   - What's unclear: Phase 11 may have intended to seed them but didn't complete it.
   - Recommendation: Phase 13 MUST include a seed SQL script with the 55 phrases across 8 categories. The planner should include this as a dedicated task.

4. **QUALITY-03 vs VALIDATE-01 — same scanner, different gates?**
   - What we know: VALIDATE-01 covers reply emails; QUALITY-03 covers PROPOSAL_V4. Both strip pricing patterns.
   - What's clear: They use the same regex patterns but different conditions: VALIDATE-01 strips from replies (all prompt types except PROPOSAL_V4), QUALITY-03 strips from PROPOSAL_V4 body specifically.
   - Recommendation: One `proposalGate()` function with a `promptType` parameter handles both — no duplication.

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `src/routes/replies.js` (Steps 0-7 pipeline structure)
- Codebase direct inspection: `src/routes/timezone.js` (Haiku call pattern)
- Codebase direct inspection: `src/config/migrations/005_v2_prompt_foundation.sql` (banned_phrases schema, reply_generations schema)
- Codebase direct inspection: `client/src/pages/Inbox.jsx` (existing reply editor, state management patterns)
- PostgreSQL live schema query: `replies`, `banned_phrases`, `reply_generations`, `jobs` tables

### Secondary (MEDIUM confidence)
- [CSS-Tricks: Creating Editable Textarea with Syntax Highlighting](https://css-tricks.com/creating-an-editable-textarea-that-supports-syntax-highlighted-code/) — Updated January 2025; textarea+overlay pattern
- [Building Highlighted Input Field in React](https://akashhamirwasia.com/blog/building-highlighted-input-field-in-react/) — Verified overlay technique
- `react-highlight-within-textarea` v3.2.2 npm — requires Draft.js (abandoned); avoid

### Tertiary (LOW confidence)
- WebSearch: Draft.js abandonment status confirmed by community sources; no official Meta/Facebook deprecation announcement found

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all findings from direct codebase inspection; no new dependencies needed
- Architecture: HIGH — patterns derived directly from existing replies.js and timezone.js structures
- Pitfalls: HIGH for regex/overlay pitfalls (well-documented); MEDIUM for specificity retry edge cases

**Research date:** 2026-03-05
**Valid until:** 2026-06-05 (stable — no fast-moving dependencies; Haiku model ID confirmed working in codebase)
