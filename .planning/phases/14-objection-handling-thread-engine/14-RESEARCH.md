# Phase 14: Objection Handling + Kill Switch - Research

**Researched:** 2026-03-05
**Domain:** Node.js/Express pipeline extension — regex detection, prompt augmentation, PostgreSQL status migration
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBJECTION-01 | Detect objection type from client email text before generating: Pricing, Agency, Comparison, Technical Q, Already Hired, None | Regex keyword detection in pure function — runs at Step 0.5 in pipeline, updates `jobs.objection_detected` |
| OBJECTION-02 | Reply Generator selects matching counter-move template from `counter_moves` table; generates within `max_words` for that type | DB already has counter_moves seeded; load by `objection_type`, inject template into system prompt, add word-count instruction |
| OBJECTION-03 | Technical Q reply follows Answer → Curiosity Question → CTA pattern; one curiosity question per reply | Prompt instruction only (not post-gen validation); enforced via prompt augmentation block appended to system prompt |
| OBJECTION-04 | Agency-sensitivity detection from job post text; auto-insert disclosure template if detected | Regex scan of `job.job_description` + `job.job_description_raw`; update `jobs.agency_sensitive`; inject disclosure block into system prompt |
| OBJECTION-05 | Detect scope framing (hours/phases/fixed) from email thread; mirror client structure in Proposal Generator and Reply Generator | Regex on email `body_text`; update `jobs.client_scope_framing`; inject framing instruction into system prompt |
| OBJECTION-06 | Kill Switch: after 2 unanswered follow-ups, lead auto-transitions to DORMANT; no 3rd follow-up generated | `jobs.follow_up_count` already tracked; need `DORMANT` value in `emails.status` VARCHAR field; kill switch check at Step 0.5 before Claude call |
</phase_requirements>

---

## Summary

Phase 14 extends the existing 7-step reply pipeline in `src/routes/replies.js` with a pre-generation intelligence layer. The core work is: (1) detect objection type + agency sensitivity + scope framing from text before calling Claude, (2) augment the system prompt with the relevant counter-move template, agency disclosure, and scope framing instruction, and (3) enforce the Kill Switch to block follow-up generation when `follow_up_count >= 2`.

The database schema from Phase 11 (`005_v2_prompt_foundation.sql`) already has every column this phase needs: `jobs.objection_detected` (objection_type_enum), `jobs.agency_sensitive` (boolean), `jobs.client_scope_framing` (scope_framing_enum), `jobs.follow_up_count` (integer), and the `counter_moves` table is seeded with 10 templates including TECHNICAL_Q. The only missing piece is `DORMANT` in the `emails.status` VARCHAR field — that field is currently unconstrained VARCHAR so no migration is needed for the enum itself, just an update to the valid-values list in `emails.js`.

Detection strategy is regex-based (not Haiku). The pattern match targets are short and deterministic (keywords like "too expensive", "no agencies", "phase", "hourly"). Haiku classification would add latency, cost, and a second async call for a task that regex handles reliably. All three detectors (objection, agency-sensitivity, scope-framing) are pure synchronous functions added to `src/utils/detectSignals.js`, following the same pattern as `validateReply.js`.

**Primary recommendation:** Add `src/utils/detectSignals.js` with three pure detection functions; insert Step 0.5 in `replies.js` that runs detection, updates DB columns, and builds an `objectionContext` object passed into `buildPromptWithContext()`; add Kill Switch check at Step 0.5 that returns early when `follow_up_count >= 2` and `promptType === 'FOLLOW_UP_V2'`.

---

## Standard Stack

### Core (no new packages needed)

| Component | Version | Purpose | Status |
|-----------|---------|---------|--------|
| Node.js regex | Built-in | Objection/agency/scope keyword detection | Already used throughout codebase |
| PostgreSQL | Already deployed | `objection_detected`, `agency_sensitive`, `client_scope_framing`, `follow_up_count` columns | Already migrated in 005 |
| `counter_moves` table | Seeded | Stores objection templates with `max_words` per type | 10 rows seeded in Phase 11 |
| Anthropic Haiku | `claude-3-5-haiku-20241022` | NOT used for detection — regex is sufficient | Use only for specificity/angle (already in pipeline) |

**No new npm packages required.** Phase 14 is purely a pipeline extension using existing infrastructure.

---

## Architecture Patterns

### Recommended File Changes

```
src/
├── utils/
│   ├── detectSignals.js        # NEW — pure sync functions: detectObjection, detectAgencySensitivity, detectScopeFraming
│   └── validateReply.js        # UNCHANGED — Phase 13 validation stays separate
├── routes/
│   └── replies.js              # MODIFIED — Step 0.5 inserted, buildPromptWithContext() updated
└── config/
    └── migrations/
        └── 008_kill_switch.sql # NEW — add 'dormant' to valid emails.status + kill_switch_at column on jobs
```

### Pattern 1: Detection at Step 0.5 (Pre-Routing, Post-Auth)

**What:** A new synchronous detection step runs before prompt routing. It reads `email.body_text` and `job.job_description_raw || job.job_description`, runs three regex matchers, updates the job record in DB (fire-and-forget), and produces an `objectionContext` object consumed by the prompt builder.

**When to use:** Every time a reply is generated — detectors are cheap (regex, no network call).

**Placement in pipeline:** After Step 0 (auth) and Step 1 (load email/job), before Step 2 (prompt routing). This ensures:
- Kill Switch check has `job.follow_up_count` available
- `promptType` is not yet determined (so we can still return early)
- Objection detection has fresh email text

```javascript
// Source: derived from existing validateReply.js pattern (pure sync function)

// Step 0.5: Signal detection + Kill Switch check
// ─────────────────────────────────────────────────────────────
const {
  detectObjection,
  detectAgencySensitivity,
  detectScopeFraming,
} = require('../utils/detectSignals');

const emailText = email.body_text || email.snippet || '';
const jobText = job ? (job.job_description_raw || job.job_description || '') : '';

// Kill Switch — must run before promptType is computed
const currentFollowUpCount = job ? (job.follow_up_count || 0) : 0;
// (promptType not yet determined — check happens again after Step 2)

// Run detectors
const objectionType = detectObjection(emailText);
const agencySensitive = detectAgencySensitivity(jobText);
const scopeFraming = detectScopeFraming(emailText);

// Persist signals to DB (fire-and-forget — never blocks response)
if (job) {
  pool.query(
    `UPDATE jobs SET
       objection_detected = $1::objection_type_enum,
       agency_sensitive   = $2,
       client_scope_framing = $3::scope_framing_enum
     WHERE id = $4`,
    [objectionType, agencySensitive, scopeFraming, job.id]
  ).catch((err) => console.error('replies: signal update failed:', err.message));
}

// Load counter-move template for detected objection (if not NONE)
let counterMove = null;
if (objectionType !== 'NONE' && job) {
  const { rows: cmRows } = await pool.query(
    `SELECT counter_move_template, max_words
     FROM counter_moves
     WHERE objection_type = $1::objection_type_enum AND active = true
     ORDER BY id ASC LIMIT 1`,
    [objectionType]
  );
  counterMove = cmRows.length > 0 ? cmRows[0] : null;
}
```

### Pattern 2: Kill Switch Check (After Step 2, Before Step 3)

**What:** After `promptType` is determined, check if this is `FOLLOW_UP_V2` with `follow_up_count >= 2`. If so, return a `killSwitch: true` response without calling Claude.

**Why after Step 2:** `promptType` must be known. The kill switch only blocks `FOLLOW_UP_V2`. It does not block `EMAIL_REPLY_V2` or `THREAD_CONTINUATION_V1`.

```javascript
// After Step 2 (promptType determined):
if (promptType === 'FOLLOW_UP_V2' && currentFollowUpCount >= 2) {
  // Record kill switch trigger (optional audit — fail open)
  if (job) {
    pool.query(
      'UPDATE jobs SET kill_switch_at = NOW() WHERE id = $1 AND kill_switch_at IS NULL',
      [job.id]
    ).catch(() => {});
  }
  return res.json({
    killSwitch: true,
    reason: 'Follow-up limit reached (2). Lead status moved to DORMANT.',
    followUpCount: currentFollowUpCount,
    promptType,
  });
}
```

### Pattern 3: Counter-Move Template Injection in buildPromptWithContext()

**What:** The `objectionContext` object (containing `counterMove`, `agencySensitive`, `scopeFraming`) is passed into `buildPromptWithContext()`. It appends three optional blocks to the system prompt.

**Order of injection:** After job context block, before link analysis block.

```javascript
// In buildPromptWithContext() — new parameter: objectionContext
function buildPromptWithContext(templateContent, email, job, linkAnalysis, tone, promptType, objectionContext) {
  let prompt = templateContent;
  // ... existing tone + job context appended ...

  // OBJECTION-02: Counter-move template injection
  if (objectionContext?.counterMove) {
    const cm = objectionContext.counterMove;
    prompt += `\n\n<counter_move>
Objection type detected: ${objectionContext.objectionType}
Counter-move strategy: ${cm.counter_move_template}
CRITICAL: Keep your reply under ${cm.max_words} words. Follow the counter-move strategy above.
</counter_move>`;
  }

  // OBJECTION-03: Technical Q pattern enforcement
  if (objectionContext?.objectionType === 'TECHNICAL_Q') {
    prompt += `\n\n<technical_q_pattern>
MANDATORY STRUCTURE for technical questions:
1. Answer their question directly in 1-2 sentences
2. Ask exactly ONE curiosity question about their specific use case
3. End with a call-to-action (suggest a call)
DO NOT ask more than one question.
</technical_q_pattern>`;
  }

  // OBJECTION-04: Agency disclosure injection
  if (objectionContext?.agencySensitive) {
    prompt += `\n\n<agency_disclosure>
The client's job post signals agency sensitivity ("individual", "freelancer", "no agencies").
You MUST include this disclosure in the first paragraph:
"To be upfront — we're an agency, but for this project you'd work directly with [Name], a dedicated [role]. Same person from day one, direct Slack access."
Replace [Name] and [role] with appropriate values based on job context.
</agency_disclosure>`;
  }

  // OBJECTION-05: Scope framing mirroring
  if (objectionContext?.scopeFraming && objectionContext.scopeFraming !== 'UNKNOWN') {
    const framingInstructions = {
      HOURS:  'The client thinks in HOURS. Structure your reply with hourly estimates. Never use phases or milestones.',
      PHASES: 'The client thinks in PHASES/MILESTONES. Structure your reply with phase-based breakdown.',
      FIXED:  'The client has a FIXED BUDGET. Structure your reply around a fixed-price outcome.',
    };
    prompt += `\n\n<scope_framing>
${framingInstructions[objectionContext.scopeFraming]}
Mirror the client\'s structure exactly. Never impose a different framing.
</scope_framing>`;
  }

  // ... existing link analysis appended ...
  return prompt;
}
```

### Pattern 4: detectSignals.js — Pure Sync Detection Functions

**What:** Three exported pure functions, no DB, no async, no side effects. Mirrors `validateReply.js` design exactly.

```javascript
// src/utils/detectSignals.js
'use strict';

// OBJECTION-01: Keyword patterns per objection type
const OBJECTION_PATTERNS = {
  PRICING: [
    /\bhow much\b/i,
    /\bwhat(?:'s| is) (?:the )?(?:cost|price|rate|budget)\b/i,
    /\btoo expensive\b/i,
    /\boutside (?:our|my) budget\b/i,
    /\bcan you (?:do|make) it cheaper\b/i,
    /\bwhat(?:'s| is) your (?:rate|pricing)\b/i,
    /\bprice range\b/i,
  ],
  AGENCY: [
    /\bno agencies\b/i,
    /\bindividual(?:s)? only\b/i,
    /\blooking for (?:a )?(?:freelancer|individual|solo)\b/i,
    /\bfreelancer only\b/i,
    /\bsolo developer\b/i,
    /\bnot (?:an )?agenc(?:y|ies)\b/i,
  ],
  COMPARISON: [
    /\bcomparing (?:option|proposal|quote)s?\b/i,
    /\bfound someone cheaper\b/i,
    /\bgot (?:other|another) proposal\b/i,
    /\bother (?:option|bid|quote)s?\b/i,
    /\bsomeone (?:else|other)\b/i,
    /\bshopping around\b/i,
  ],
  TECHNICAL_Q: [
    /\b(?:react|angular|vue|next\.?js|nuxt|svelte)\b/i,
    /\b(?:node|express|django|flask|fastapi|rails|laravel)\b/i,
    /\b(?:postgresql|mysql|mongodb|redis|dynamodb)\b/i,
    /\b(?:aws|gcp|azure|vercel|heroku|railway)\b/i,
    /\b(?:graphql|rest(?:ful)?|websocket|webhook|api)\b/i,
    /\b(?:docker|kubernetes|ci\/cd|devops)\b/i,
    /\b(?:stripe|paypal|twilio|sendgrid)\b/i,
    /\b(?:shopify|wordpress|woocommerce|magento)\b/i,
    /\b(?:machine learning|ml|ai|llm|openai|vector)\b/i,
  ],
  ALREADY_HIRED: [
    /\bfound someone\b/i,
    /\balready (?:hired|resolved|found)\b/i,
    /\bwent with (?:someone|another)\b/i,
    /\bno longer (?:need|looking)\b/i,
    /\bposition (?:is )?filled\b/i,
  ],
};

/**
 * detectObjection(emailText) — OBJECTION-01
 * Returns the first matched objection_type_enum value, or 'NONE'.
 * Priority order: ALREADY_HIRED > AGENCY > PRICING > COMPARISON > TECHNICAL_Q
 */
function detectObjection(emailText) {
  if (!emailText) return 'NONE';
  const text = emailText.toLowerCase();

  // Priority: hard stops first, then sales objections, then questions
  const ORDER = ['ALREADY_HIRED', 'AGENCY', 'PRICING', 'COMPARISON', 'TECHNICAL_Q'];
  for (const type of ORDER) {
    for (const pattern of OBJECTION_PATTERNS[type]) {
      if (pattern.test(text)) return type;
    }
  }
  return 'NONE';
}

/**
 * detectAgencySensitivity(jobText) — OBJECTION-04
 * Returns true if job post signals preference for individual/freelancer.
 */
function detectAgencySensitivity(jobText) {
  if (!jobText) return false;
  const patterns = [
    /\bno agencies\b/i,
    /\bindividual(?:s)? only\b/i,
    /\bfreelancer only\b/i,
    /\bsolo developer\b/i,
    /\bnot (?:an )?agenc(?:y|ies)\b/i,
    /\bprefer(?:ring)? (?:a )?(?:freelancer|individual|solo)\b/i,
    /\bno agenc(?:y|ies)\b/i,
  ];
  return patterns.some((p) => p.test(jobText));
}

/**
 * detectScopeFraming(emailText) — OBJECTION-05
 * Returns scope_framing_enum value: HOURS | PHASES | FIXED | UNKNOWN
 */
function detectScopeFraming(emailText) {
  if (!emailText) return 'UNKNOWN';
  const text = emailText.toLowerCase();

  const PHASE_PATTERNS = [
    /\bphase(?:s)?\b/i,
    /\bmilestone(?:s)?\b/i,
    /\bstage(?:s)?\b/i,
    /\bin (?:multiple )?part(?:s)?\b/i,
  ];
  const HOURLY_PATTERNS = [
    /\b\d+\s*hour(?:s|ly)?\b/i,
    /\bhourly\b/i,
    /\bper hour\b/i,
    /\bhours? (?:per|a) week\b/i,
    /\bhours? of work\b/i,
  ];
  const FIXED_PATTERNS = [
    /\bfixed (?:price|budget|cost|rate)\b/i,
    /\b\$[\d,]+\s*(?:total|flat|fixed)?\b/i,
    /\bone.time (?:fee|cost|payment)\b/i,
    /\btotal budget\b/i,
    /\bbulk (?:price|payment)\b/i,
  ];

  // Priority: PHASES > HOURS > FIXED (phases are most specific)
  if (PHASE_PATTERNS.some((p) => p.test(text))) return 'PHASES';
  if (HOURLY_PATTERNS.some((p) => p.test(text))) return 'HOURS';
  if (FIXED_PATTERNS.some((p) => p.test(text))) return 'FIXED';
  return 'UNKNOWN';
}

module.exports = { detectObjection, detectAgencySensitivity, detectScopeFraming };
```

### Pattern 5: DORMANT Status — emails.status VARCHAR field

**What:** `emails.status` is defined as `VARCHAR(20)` with no enum constraint. `VALID_STATUSES` in `emails.js` is a hardcoded array `["new", "replied", "proposal_sent", "won", "lost", "ignored"]`. The Kill Switch sets email status to `"dormant"` — not `emails.status` directly but `jobs.match_status` or a new `jobs.lead_status` field.

**Critical finding:** `jobs.match_status` is `VARCHAR(20)` not an enum, with values: `matched`, `no_match`, `needs_manual`, `error`. This is where DORMANT belongs — on the **job**, not the email. The email `status` tracks reply-workflow stage; the job tracks lead stage.

**Recommendation:** Add `dormant` as a valid `jobs.match_status` value (no migration needed for VARCHAR, just update app logic). Also add `jobs.kill_switch_at TIMESTAMPTZ` column to track when the switch fired.

Migration 008 should:
1. Add `jobs.kill_switch_at TIMESTAMPTZ` column
2. Add `dormant` to `VALID_STATUSES` in `emails.js` for the frontend filter (so dormant emails can be filtered)
3. Update the Kill Switch logic to set `jobs.match_status = 'dormant'`

### Anti-Patterns to Avoid

- **Haiku for objection detection:** Adds 300-500ms latency and costs tokens for a task that 8 regex patterns handle deterministically. Use Haiku only for open-ended classification with nuance (like specificity scoring) — not binary keyword matching.
- **Detecting objection after Claude call:** Objection detection MUST happen before the Claude call — it changes what template is used. Post-generation detection is too late.
- **Re-running detection on every Step 7 DB write:** Cache in local variable within the request. The DB write of `objection_detected` is fire-and-forget once per request, not per retry.
- **Blocking on DB persist of signals:** Signal persistence is fire-and-forget (`.catch()` logged, not awaited). Failing to persist signals must never block the response.
- **AGENCY detection from email text:** Agency sensitivity should be detected from the **job post** (`job.job_description_raw`), not the client's reply email. The client saying "no agencies" in a reply triggers AGENCY objection (OBJECTION-01). The job post saying "no agencies" triggers agency disclosure (OBJECTION-04). These are two separate checks.
- **Word-count enforcement via post-gen validation:** Max-words for counter-moves is a prompt instruction, not a hard enforcer like the proposal gate. Don't add a word-count truncator — just tell Claude in the prompt. Over-truncation breaks sentence structure.
- **Third curiosity question:** OBJECTION-03 requires exactly ONE curiosity question. The prompt instruction enforces this. Don't add a post-gen counter — it would require sentence parsing and is fragile.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Keyword matching | NLP parser, Haiku classification | Regex patterns in pure function | Keywords are deterministic; NLP adds false negatives on short email text |
| Counter-move routing | Complex decision tree | DB lookup by `objection_type` | counter_moves table already seeded, already has settings UI route |
| Agency disclosure text | Separate template table | Hardcoded string injected into prompt | One template never changes; over-engineering it adds DB calls for nothing |
| DORMANT status enum | New PostgreSQL enum type | Extend VARCHAR `match_status` values + update VALID_STATUSES array | jobs.match_status is already VARCHAR; enum migration adds deployment risk |

---

## Common Pitfalls

### Pitfall 1: Detecting AGENCY objection twice (email vs job post)

**What goes wrong:** Developer conflates OBJECTION-01 (agency objection in the client's reply email) with OBJECTION-04 (agency sensitivity in the job post). They put both in `detectObjection()` and miss that OBJECTION-04 must scan the job description, not the email body.

**Why it happens:** Both involve "no agencies" keywords. The requirements look similar.

**How to avoid:** Keep two separate functions: `detectObjection(emailText)` for email replies, `detectAgencySensitivity(jobText)` for job posts. Different inputs, different outputs, different injection behavior.

**Warning signs:** Agency disclosure appearing in follow-ups when no job post was matched.

### Pitfall 2: Kill Switch firing on THREAD_CONTINUATION_V1

**What goes wrong:** Kill Switch check `follow_up_count >= 2` fires before `promptType` is determined, blocking thread continuation replies.

**Why it happens:** Developer places kill switch check at Step 0.5 before Step 2 (prompt routing).

**How to avoid:** Kill Switch check MUST happen AFTER Step 2 (prompt routing), when `promptType` is known. Only block when `promptType === 'FOLLOW_UP_V2'`.

**Warning signs:** Client mid-thread replies getting `killSwitch: true` response.

### Pitfall 3: follow_up_count not incremented by Phase 14

**What goes wrong:** The Kill Switch checks `follow_up_count` but Phase 14 doesn't increment it. Phase 12/13 stored `followUpSequence` in `reply_generations` but never wrote back to `jobs.follow_up_count`.

**Why it happens:** Phase 13 calculates `followUpSequence = (job.follow_up_count || 0) + 1` but only stores the angle (FU1/FU2 angle columns). The `follow_up_count` column itself is never incremented.

**How to avoid:** At Step 7 (save reply), when `promptType === 'FOLLOW_UP_V2'`, increment `jobs.follow_up_count` by 1. Add this to the existing `UPDATE jobs SET last_prompt_used = $1 WHERE id = $2` query — or use a separate `UPDATE jobs SET follow_up_count = follow_up_count + 1 WHERE id = $1` statement.

**Warning signs:** Kill Switch never fires because `follow_up_count` stays 0 forever.

### Pitfall 4: Counter-move overriding the entire system prompt

**What goes wrong:** Developer replaces `templateContent` with the counter-move template, losing the persona, rules, and banned-phrase list from the prompt template.

**Why it happens:** Misreading OBJECTION-02 as "use counter-move template AS the prompt" instead of "inject it as a directive block."

**How to avoid:** Counter-move template is appended as a `<counter_move>` XML block AFTER the full system prompt template. The base template (EMAIL_REPLY_V2, THREAD_CONTINUATION_V1, etc.) stays intact. The counter-move adds constraints on top of it.

**Warning signs:** Replies that have no persona, no sign-off, no banned-phrase rules applied.

### Pitfall 5: Scope framing scanning only the current email

**What goes wrong:** `detectScopeFraming` only scans the triggering email, missing framing signals from earlier in the thread where the client established their expectations.

**Why it happens:** Only `email.body_text` is available in the request; full thread not loaded.

**How to avoid:** For Phase 14, scanning the current email is acceptable and sufficient. If `client_scope_framing` was already set to non-UNKNOWN on the job record (from a previous generation), don't overwrite it — use the existing value. Check `job.client_scope_framing !== 'UNKNOWN'` before running detectScopeFraming().

**Warning signs:** Scope framing resets to UNKNOWN on every reply generation.

### Pitfall 6: emailAnalysis.js uses wrong model ID

**What goes wrong:** `emailAnalysis.js` line 13 has `ANALYSIS_MODEL = "claude-haiku-4-5-20251001"` — this is an unverified model ID (different from the known-valid `claude-3-5-haiku-20241022` in MEMORY.md).

**Why it matters for Phase 14:** Phase 14 does NOT use `emailAnalysis.js` for detection (uses regex instead), but if future work adds Haiku calls for detection, must use `claude-3-5-haiku-20241022`.

**Note:** This is a pre-existing issue, not a Phase 14 bug to fix.

---

## Code Examples

### detectObjection() — Integration Point

```javascript
// Source: derived from codebase pattern (validateReply.js, emailAnalysis.js)
// In replies.js Step 0.5:

const emailText = email.body_text || email.snippet || '';
const jobText = job ? (job.job_description_raw || job.job_description || '') : '';

const objectionType = detectObjection(emailText);
const agencySensitive = job
  ? (job.agency_sensitive || detectAgencySensitivity(jobText))
  : false;

// Preserve previously detected scope framing — don't overwrite with UNKNOWN
const scopeFraming = (job && job.client_scope_framing && job.client_scope_framing !== 'UNKNOWN')
  ? job.client_scope_framing
  : detectScopeFraming(emailText);
```

### Counter-Move DB Lookup

```javascript
// Source: derived from existing counter_moves settings route (src/routes/settings.js:569)
// counter_moves.objection_type is objection_type_enum — cast required

let counterMove = null;
if (objectionType !== 'NONE') {
  try {
    const { rows: cmRows } = await pool.query(
      `SELECT counter_move_template, max_words, counter_move_name
       FROM counter_moves
       WHERE objection_type = $1::objection_type_enum AND active = true
       ORDER BY id ASC
       LIMIT 1`,
      [objectionType]
    );
    counterMove = cmRows.length > 0 ? cmRows[0] : null;
  } catch (cmErr) {
    console.error('replies: counter-move lookup failed:', cmErr.message);
    // Fail open — proceed without counter-move
  }
}
```

### Migration 008 — Kill Switch Column

```sql
-- Migration 008: Kill Switch + DORMANT support
-- Phase 14: Objection Handling + Kill Switch
-- Requirements: OBJECTION-06

-- Track when kill switch fired per job
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kill_switch_at TIMESTAMPTZ;

-- Index for querying dormant leads
CREATE INDEX IF NOT EXISTS idx_jobs_kill_switch
  ON jobs (kill_switch_at)
  WHERE kill_switch_at IS NOT NULL;

-- Note: jobs.match_status is VARCHAR(20) — 'dormant' needs no schema change.
-- Update VALID_STATUSES in emails.js to include 'dormant' for email filter support.
```

### Step 7 follow_up_count Increment (Missing from Phase 12/13)

```javascript
// Source: analysis of replies.js Step 7 — follow_up_count never incremented
// Must be added to Phase 14 Step 7 update block:

if (job && promptType === 'FOLLOW_UP_V2') {
  try {
    await pool.query(
      'UPDATE jobs SET follow_up_count = follow_up_count + 1 WHERE id = $1',
      [job.id]
    );
  } catch (fcErr) {
    console.error('replies: failed to increment follow_up_count:', fcErr.message);
  }
}
```

### Kill Switch Response Shape

```javascript
// Source: pattern matching existing suppressed response in replies.js line 148-153
// Consistent with existing `suppressed: true` pattern

return res.json({
  killSwitch: true,
  reason: 'Maximum follow-ups reached. Lead moved to DORMANT.',
  followUpCount: currentFollowUpCount,
  promptType,
  // Update jobs.match_status to dormant + record timestamp
});
```

---

## State of the Art

| Old Approach | Current Approach | Phase Changed | Impact |
|--------------|------------------|---------------|--------|
| Objections handled via prompt text only (no detection) | Pre-generation detection updates DB + injects targeted counter-move | Phase 14 | Replies are context-specific to objection type |
| Agency disclosure manually included by user | Auto-inserted based on job post scan | Phase 14 | Zero chance of forgetting disclosure on agency-sensitive jobs |
| Scope framing ignored; Claude guesses structure | Detected from email, mirrored in prompt | Phase 14 | Proposals match client's mental model |
| follow_up_count tracked but never enforced | Kill Switch blocks generation after count ≥ 2 | Phase 14 | No more zombie follow-up chains |
| follow_up_count column exists but never incremented | Incremented in Step 7 on FOLLOW_UP_V2 | Phase 14 (also fixes Phase 12/13 gap) | Kill Switch actually works |

---

## Open Questions

1. **"30 days dormant" — active re-engagement or passive label?**
   - What we know: FOLLOW_UP_V2 prompt says "DORMANT for 30 days minimum"; OBJECTION-06 says "lead status moves to DORMANT"
   - What's unclear: Is there a scheduled job to un-dormant leads after 30 days, or is DORMANT a permanent state until manually changed?
   - Recommendation: Phase 14 scope is just the Kill Switch (status → dormant, block 3rd follow-up). Re-engagement scheduler is a separate concern. Set `match_status = 'dormant'` and let user manually reactivate. No auto-scheduler needed in Phase 14.

2. **Does the Kill Switch UI notice show in the frontend Inbox.jsx?**
   - What we know: OBJECTION-06 says "Kill Switch notice shown instead" — but the frontend (Inbox.jsx) is not in scope for this research
   - What's unclear: Does the frontend need a new UI state, or does it just show `killSwitch: true` from the API response?
   - Recommendation: Return `{ killSwitch: true, reason: '...' }` from API. Frontend should check for `killSwitch` in the generate-reply response and show a notice instead of the reply editor. This is a frontend task for Phase 14's plan.

3. **TECHNICAL_Q detection false-positive rate**
   - What we know: Tech keyword regex is broad — "API", "react", "AWS" appear frequently in non-technical questions
   - What's unclear: Will emails that simply mention a tech stack (not ask a technical question) trigger TECHNICAL_Q?
   - Recommendation: Require tech keywords to appear in a question context — add `/\b(?:how|what|which|can|does|is|are|do|will|should|where).{0,50}\b(react|api|...)\b/i` as an alternative pattern. Phase 14 can start with simple presence detection and refine if false positives appear in testing.

4. **Counter-move for AGENCY objection in email vs. job post agency disclosure**
   - What we know: `counter_moves` has an AGENCY row (agency objection in client reply); OBJECTION-04 adds disclosure when job post is agency-sensitive
   - What's unclear: If client's reply says "no agencies" (OBJECTION-01 triggers AGENCY type), should both the counter-move AND the agency disclosure inject?
   - Recommendation: Yes — when `objectionType === 'AGENCY'` in the email reply, both the counter-move (from counter_moves table) AND the agency disclosure block should inject. They address the same concern from different angles.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/config/migrations/005_v2_prompt_foundation.sql` — confirmed all columns exist: `objection_detected` (objection_type_enum), `agency_sensitive`, `client_scope_framing`, `follow_up_count`, `follow_up_1_angle`, `follow_up_2_angle`
- Direct codebase inspection — `src/config/seeds/seed_v2_foundation.js` — confirmed 10 counter_moves seeded, objection types: PRICING (2), AGENCY (1), COMPARISON (1), ALREADY_HIRED (1), NONE (5), TECHNICAL_Q (1)
- Direct codebase inspection — `src/routes/replies.js` — confirmed 7-step pipeline structure, Step 6b validation, `follow_up_count` read but never incremented, `buildPromptWithContext()` signature and injection pattern
- Direct codebase inspection — `src/utils/validateReply.js` — confirmed pattern for pure sync detection functions
- Direct codebase inspection — `src/routes/emails.js` line 37 — `VALID_STATUSES = ["new", "replied", "proposal_sent", "won", "lost", "ignored"]` — DORMANT not present
- Direct codebase inspection — `src/config/migrations/002_email_and_jobs.sql` — `jobs.match_status VARCHAR(20)`, `emails.status VARCHAR(20)` — both unconstrained VARCHAR, no enum migration needed

### Secondary (MEDIUM confidence)
- Regex pattern design — standard keyword matching approach for intent detection; same pattern used in `detectIntent()` function at line 713 of `replies.js` and `emailAnalysis.js` SYSTEM_PROMPT

### Tertiary (LOW confidence — flagged)
- `emailAnalysis.js` line 13 uses `ANALYSIS_MODEL = "claude-haiku-4-5-20251001"` — this model ID does not match the known-valid `claude-3-5-haiku-20241022` from project MEMORY.md. Pre-existing issue; not a Phase 14 concern but noted.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all infrastructure (columns, tables, seed data) confirmed present in codebase
- Architecture: HIGH — pipeline insertion points confirmed by reading actual pipeline code; injection pattern confirmed by reading `buildPromptWithContext()`
- Pitfalls: HIGH — pitfalls derived from direct codebase gaps (follow_up_count never incremented = code fact, not speculation)
- Detection patterns: MEDIUM — regex keyword lists are reasonable but may need tuning after real-world testing

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable codebase — 30-day window)
