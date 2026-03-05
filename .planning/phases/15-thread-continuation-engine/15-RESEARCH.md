# Phase 15: Thread Continuation Engine — Research

**Researched:** 2026-03-05
**Domain:** Thread classification, tone adaption, CC detection, stall recovery, next-step persistence
**Confidence:** HIGH — all findings derived from direct codebase inspection

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| THREAD-01 | Detect thread stage (DISCOVERY, CALL_BOOKING, POST_CALL, NEGOTIATION, CLOSING, STALLED) for threads with 2+ exchanges; store on lead; show in detail | `thread_stage_enum` and `jobs.thread_stage` column already exist in migration 005. Stage detection is pure logic — use Haiku classification on email body text. |
| THREAD-02 | Tone shifts with thread depth — messages 2-3: slightly formal; 4-6: first name + shorter; 7+: ultra-casual; post-call: match call tone | `jobs.thread_depth` already tracked. The THREAD_CONTINUATION_V1 seed prompt already documents tone rules. Implementation = add depth context block to `buildPromptWithContext()`. |
| THREAD-03 | Post-Call defaults to Recap (<100 words, bullet); full proposal only if "Client requested proposal" toggle; toggle persisted per lead | `jobs.post_call_recap_sent` column exists. Need new column: `jobs.client_requested_proposal` (BOOLEAN). Toggle stored on jobs record; drives proposalGate behaviour in replies.js. |
| THREAD-04 | CC'd contacts detected from email headers/body; addressed by name in first sentence with context; cc_contacts stored as JSONB on lead | `jobs.cc_contacts JSONB` exists. CC header is NOT currently extracted during Gmail sync — needs to be added to `getHeader("Cc")` calls in both gmail.js and emails.js sync. |
| THREAD-05 | Stall recovery strategies vary by stall type — "let me think" → Day 3 value-add no CTA; pricing silence → Day 3 Phase 1, Day 7 graceful close; call silence → Day 2 recap, Day 5 value, Day 10 graceful close; multiple replies no commitment → tangible attachment | Stall type is a classification step. Introduce `stall_type` field or derive from objection + thread stage. Stall rules live in prompt context injected into THREAD_CONTINUATION_V1. |
| THREAD-06 | Kill Switch fires → generate `re_engagement_strategy` field with AI one-sentence value pitch; Dead Lead Rescue Queue uses it | `jobs.re_engagement_strategy TEXT` column exists. Current Kill Switch in replies.js sets `match_status = 'dormant'` but does NOT generate the re_engagement_strategy — this is the gap to fill. |
| THREAD-07 | Hot Signal Detection — if open_count >= 10 → flag "Sharing Internally", suggest simpler/phased option | No email open tracking exists in the codebase. `open_count` column does not exist on the emails table. This feature requires adding open tracking infrastructure (new column + tracking mechanism) or accepting manual input. |
| THREAD-08 | Client Energy Matching — measure client's last email word count; pass to generator as SHORT/MEDIUM/LONG; SHORT (<30 words) → reply under 60 words | `jobs.client_message_length message_length_enum` (SHORT/MEDIUM/LONG) exists. Word count measurement is pure JS on `email.body_text`. Set on jobs record before generation; inject energy label into prompt. |
| THREAD-09 | Internal Next-Step Summary after every Thread Continuation reply — stored in `next_steps` table: our_action, our_deadline, their_action, followup_date, followup_approach | `next_steps` table fully defined in migration 005. Current pipeline never writes to it. Implementation = parse Claude's "NEXT STEP SUMMARY" block from THREAD_CONTINUATION_V1 output and INSERT into next_steps. |
</phase_requirements>

---

## Summary

Phase 15 builds the intelligence layer on top of the existing reply pipeline. The schema foundation (migration 005) provides all necessary columns: `thread_stage`, `thread_depth`, `thread_client_messages`, `cc_contacts`, `client_message_length`, `re_engagement_strategy`, `post_call_recap_sent`, and the entire `next_steps` table. The prompt template (`THREAD_CONTINUATION_V1`) was seeded in Phase 11 and already documents tone rules, stage signals, and the NEXT STEP SUMMARY block format. The bulk of this phase is wiring existing schema to new logic in the pipeline.

The six key implementation areas are: (1) stage classification via Haiku, (2) tone depth injection into `buildPromptWithContext()`, (3) CC header extraction in the Gmail sync path, (4) stall type detection and recovery strategy injection, (5) re_engagement_strategy generation on Kill Switch firing, and (6) next_steps INSERT after every THREAD_CONTINUATION_V1 generation. THREAD-07 is the outlier — email open tracking does not exist and requires an infrastructure decision before implementation.

**Primary recommendation:** Implement THREAD-01 through THREAD-06 and THREAD-08 through THREAD-09 as extensions to the existing `replies.js` pipeline + a new `detectThreadSignals.js` utility. Treat THREAD-07 separately — add an `open_count INTEGER DEFAULT 0` column to `emails` and provide a manual-input path in the UI; defer automated pixel tracking.

---

## Standard Stack

### Core (all already in use — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js + Express | 18+ / current | Pipeline orchestration | Already the backend |
| `pg` (node-postgres) | current | PostgreSQL queries | Already the DB driver |
| `node-fetch` / built-in `fetch` | Node 18 built-in | Claude Haiku classification calls | Already used in replies.js |
| Anthropic Claude Haiku (`claude-3-5-haiku-20241022`) | current valid model | Lightweight classification (stage, energy, next-step parse) | Already used in checkFollowUpSpecificity, extractFollowUpAngle |

### No New Dependencies
Everything required already exists in the codebase. This phase adds new utility functions, new migration columns, and new logic hooks — not new packages.

---

## Architecture Patterns

### Where Phase 15 Logic Slots Into the Existing Pipeline

```
POST /api/replies/generate
  └── Step 0:   Auth + API key load        (unchanged)
  └── Step 1:   Load email + job           (unchanged)
  └── Step 0.5: Signal detection           ← THREAD-08 word count here; THREAD-01 stage detection here
  └── Step 2:   Prompt routing             (unchanged — THREAD_CONTINUATION_V1 already triggered)
  └── Step 2.5: Kill Switch                ← THREAD-06 re_engagement_strategy generation here
  └── Step 3:   Load prompt template       (unchanged)
  └── Step 4:   Pre-generation pipeline    (unchanged)
  └── Step 5:   buildPromptWithContext()   ← THREAD-02 tone depth, THREAD-03 post-call, THREAD-04 CC, THREAD-05 stall injection
  └── Step 6:   Extract blocks             ← THREAD-09 next-step block parsing here
  └── Step 6b:  Validation pipeline        (unchanged)
  └── Step 7:   Save reply + update job    ← THREAD-09 next_steps INSERT here; THREAD-01 stage store here
```

### New Utilities

```
src/
  utils/
    detectSignals.js         # Existing — add detectClientMessageLength(), detectStallType()
    detectThreadSignals.js   # NEW — classifyThreadStage(), detectCcContacts(), parseNextStepBlock()
  config/
    migrations/
      009_thread_continuation.sql  # NEW — adds client_requested_proposal, open_count, stall_type columns
```

### Pattern 1: Haiku Stage Classification (THREAD-01)

**What:** Call Claude Haiku with the most recent client email body + thread context to classify stage. Fall open (default to DISCOVERY) on Haiku failure.

**When to use:** Inside `detectThreadSignals.js`, called from Step 0.5 only when `promptType === 'THREAD_CONTINUATION_V1'`.

**Pattern (follows existing Haiku call pattern from replies.js lines 890-946):**
```javascript
// Source: Pattern modelled on checkFollowUpSpecificity() in replies.js
async function classifyThreadStage(emailText, jobContext, anthropicKey) {
  const prompt = `Classify this client email in an ongoing conversation into ONE stage:
DISCOVERY, CALL_BOOKING, POST_CALL, NEGOTIATION, CLOSING, STALLED

Client email: "${emailText.substring(0, 600)}"
Job context: "${jobContext.substring(0, 300)}"

Reply with ONLY one of: DISCOVERY, CALL_BOOKING, POST_CALL, NEGOTIATION, CLOSING, STALLED`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return 'DISCOVERY'; // fail open
    const data = await res.json();
    const raw = (data.content?.[0]?.text || '').trim().toUpperCase();
    const VALID = ['DISCOVERY', 'CALL_BOOKING', 'POST_CALL', 'NEGOTIATION', 'CLOSING', 'STALLED'];
    return VALID.includes(raw) ? raw : 'DISCOVERY';
  } catch {
    return 'DISCOVERY'; // fail open
  }
}
```

### Pattern 2: CC Contact Detection (THREAD-04)

**What:** The Gmail sync path (`gmail.js` and `emails.js`) currently extracts only `From` and `Subject` headers. CC header is available via `getHeader("Cc")` but is not stored. The `emails` table does NOT have a `cc` column — CC data must be parsed at reply generation time from the raw email body or added as a column to emails during sync.

**Critical finding:** The emails table schema (migration 002) has no `cc` column. Two options:
- Option A: Add `cc_raw TEXT` to emails table and extract during sync (cleanest, stores raw)
- Option B: Parse CC from `body_text` during reply generation (fragile, email bodies don't reliably contain CC info)

**Use Option A.** Add `cc_raw TEXT` to the emails table in migration 009, extract `getHeader("Cc")` in both sync paths, and parse it at reply generation time into the `jobs.cc_contacts JSONB` field.

```javascript
// Source: Pattern from gmail.js getHeader() helper
const ccRaw = getHeader("Cc"); // e.g. "John Smith <john@example.com>, Jane <jane@example.com>"

// Parse CC raw string into structured contacts
function parseCcContacts(ccRaw) {
  if (!ccRaw) return [];
  return ccRaw.split(',').map(entry => {
    entry = entry.trim();
    const match = entry.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
    }
    return { name: null, email: entry };
  }).filter(c => c.email);
}
```

### Pattern 3: Next-Step Block Parsing (THREAD-09)

**What:** The THREAD_CONTINUATION_V1 prompt template already instructs Claude to output a "NEXT STEP SUMMARY" block. This is analogous to `[JOB ANALYSIS]` / `[LINK ANALYSIS]` blocks already extracted in `extractInternalBlocks()`. Parse the block and INSERT to `next_steps` table.

**Existing block format (from seed_v2_foundation.js lines 263-267):**
```
--- NEXT STEP SUMMARY (Internal) ---
- What we promised: [our action items]
- What we expect from them: [their action]
- Follow-up if no response by: [date]
- Recommended follow-up approach: [value-add / mockup / soft close / none]
```

```javascript
// Source: Pattern modelled on extractInternalBlocks() in replies.js
function parseNextStepBlock(rawText) {
  const blockMatch = rawText.match(
    /---\s*NEXT STEP SUMMARY[^-]*---\s*([\s\S]*?)(?:---|$)/i
  );
  if (!blockMatch) return null;

  const block = blockMatch[1];
  const extract = (label) => {
    const m = block.match(new RegExp(`${label}:\\s*(.+?)(?=\\n-|$)`, 'i'));
    return m ? m[1].trim() : null;
  };

  return {
    our_action:        extract('What we promised'),
    their_action:      extract('What we expect from them'),
    followup_approach: extract('Recommended follow-up approach'),
    followup_date:     extract('Follow-up if no response by'),  // parse to DATE
  };
}
```

### Pattern 4: Client Message Length Measurement (THREAD-08)

**What:** Pure synchronous word count. No AI needed. Run on `email.body_text` before Step 5.

```javascript
// Source: Pure JS — no external dependency
function measureClientMessageLength(bodyText) {
  if (!bodyText) return 'MEDIUM';
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 30) return 'SHORT';
  if (wordCount <= 100) return 'MEDIUM';
  return 'LONG';
}
```

The result is stored on `jobs.client_message_length` (column exists, enum exists) and injected into the prompt as a context block.

### Pattern 5: Re-Engagement Strategy Generation (THREAD-06)

**What:** When the Kill Switch fires (Step 2.5 in replies.js), generate a one-sentence AI value pitch and store it on `jobs.re_engagement_strategy`. This is a fire-and-forget Haiku call added INSIDE the kill switch branch after setting `match_status = 'dormant'`.

**Current gap:** replies.js lines 229-233 set `match_status = 'dormant'` but return immediately without generating `re_engagement_strategy`. The generation needs to be inserted before the return.

```javascript
// Inside the kill switch branch in replies.js (after match_status update)
// Fire-and-forget — never blocks the kill switch response
if (job && job.id) {
  (async () => {
    try {
      const prompt = `In ONE sentence (max 15 words), what unique value could we offer ${job.client_first_name || 'this client'} when re-engaging about their ${job.job_heading || 'project'}? Be specific, not generic.`;
      const res = await fetch('https://api.anthropic.com/v1/messages', { /* Haiku call */ });
      if (res.ok) {
        const data = await res.json();
        const strategy = data.content?.[0]?.text?.trim() || null;
        if (strategy) {
          await pool.query('UPDATE jobs SET re_engagement_strategy = $1 WHERE id = $2', [strategy, job.id]);
        }
      }
    } catch { /* fail open */ }
  })();
}
```

### Anti-Patterns to Avoid

- **Using regex-only for thread stage classification:** Stage signals overlap (e.g., "what would this cost" appears in NEGOTIATION, CLOSING, and DISCOVERY). Use Haiku for stage; use regex only for mechanical signals (word count, CC header presence).
- **Blocking on next_steps INSERT:** The next_steps write must be fire-and-forget (same pattern as reply_generations audit write in replies.js lines 544-563). Never let DB write block the reply response.
- **Overwriting existing thread_stage with a lower-confidence value:** Once `jobs.thread_stage` is set to POST_CALL or CLOSING, a subsequent email should not regress it to DISCOVERY. Use `COALESCE` or conditional updates that only upgrade stage.
- **Stripping the NEXT STEP SUMMARY block from cleanText poorly:** The existing `extractInternalBlocks()` function finds blocks by their marker pattern. The NEXT STEP SUMMARY uses `---` as delimiter (not `[...]`). Extend the function or add a separate parser — do NOT conflate the two formats.
- **Parsing CC from email body text:** Email body forwarding artifacts may include CC lines but these are unreliable. Always parse from the `Cc` header at sync time.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thread stage enum validation | Custom string checker | PostgreSQL `thread_stage_enum` (already exists) | DB rejects invalid values at INSERT time |
| CC email parsing | Custom regex from scratch | `parseCcContacts()` modelled on existing `fromMatch` pattern in gmail.js | The From header parser already handles `"Name" <email>` format reliably |
| Haiku API call boilerplate | New HTTP client wrapper | Identical `fetch()` pattern already in replies.js (checkFollowUpSpecificity, extractFollowUpAngle) | Copy-adapt the exact same pattern; consistent auth header, model ID, error handling |
| Next-step date parsing | Custom date library | Native `new Date()` + `toISOString().split('T')[0]` for PostgreSQL DATE columns | No date arithmetic needed — just store ISO date string |
| Message length classification | ML model | Three-threshold word count (< 30 SHORT, 31-100 MEDIUM, 101+ LONG) | Enum already defined in DB; simple word split is deterministic and fast |

---

## Common Pitfalls

### Pitfall 1: CC Header Not Stored — Invisible Gap
**What goes wrong:** Both Gmail sync paths (`gmail.js` POST accounts/:id/sync and `emails.js` POST sync-all) extract `From` and `Subject` headers but never extract `Cc`. The `emails` table has no `cc_raw` column. If Phase 15 assumes CC data is available at reply generation time without adding sync-time extraction, the feature silently never works.

**Why it happens:** The sync code was written before CC detection was a requirement. The `getHeader()` helper is already there — it just needs to be called for Cc.

**How to avoid:** Migration 009 must add `cc_raw TEXT` to `emails`. Both sync paths must call `getHeader("Cc")` and persist it. Reply generation then reads `email.cc_raw` and parses it.

**Warning signs:** `jobs.cc_contacts` always stays `null` despite CC'd emails arriving.

### Pitfall 2: NEXT STEP SUMMARY Block Is In cleanText
**What goes wrong:** `extractInternalBlocks()` in replies.js strips `[JOB ANALYSIS]` and `[LINK ANALYSIS]` blocks using bracket markers. The NEXT STEP SUMMARY block uses `---` delimiters (not brackets). If not handled, the entire NEXT STEP SUMMARY block ends up in `cleanText` (the reply visible to the user), showing internal planning notes to clients.

**Why it happens:** Different marker formats were designed for different purposes but both go through the same extraction function which only knows about bracket-style markers.

**How to avoid:** Either (a) extend `extractInternalBlocks()` to also detect and strip `--- NEXT STEP SUMMARY` blocks, or (b) run a second stripping pass. The cleanText saved to DB and shown in UI must NOT contain the NEXT STEP SUMMARY content.

**Warning signs:** Generated replies in the UI end with "--- NEXT STEP SUMMARY (Internal) ---" visible text.

### Pitfall 3: Thread Stage Regressing
**What goes wrong:** Each call to `/api/replies/generate` re-classifies the thread stage from scratch. If a lead was POST_CALL and the client sent a vague follow-up, Haiku may classify it as DISCOVERY, regressing the stage stored on the job record.

**Why it happens:** Stateless classification without considering the previously stored stage.

**How to avoid:** Read `job.thread_stage` before classification. If already set to POST_CALL, NEGOTIATION, CLOSING — trust that value unless the new signal is a clear stage upgrade. Use a priority/hierarchy: STALLED < DISCOVERY < CALL_BOOKING < POST_CALL < NEGOTIATION < CLOSING.

**Warning signs:** A lead bounces between DISCOVERY and NEGOTIATION on alternating generations.

### Pitfall 4: THREAD-07 Hot Signal Without Tracking Infrastructure
**What goes wrong:** THREAD-07 requires `open_count >= 10` to flag "Sharing Internally." No open tracking infrastructure exists. Gmail API does not expose read receipts or open pixel data. Without a tracking pixel or Mailsuite integration, this count is always zero.

**Why it happens:** Hot signal detection is common in email marketing tools but requires server-side tracking (pixel embed in sent emails). The current system only reads received emails, not sent ones.

**How to avoid:** Add `open_count INTEGER NOT NULL DEFAULT 0` to the emails table in migration 009. Provide a manual-increment API endpoint (`PUT /api/emails/:id/open-count`) so users can manually trigger this flag. Do NOT promise automated tracking without a tracking infrastructure. Document this as manual-only in Phase 15.

**Warning signs:** Feature is implemented against a column that never gets data, making the 10-open threshold permanently unreachable.

### Pitfall 5: next_steps INSERT Blocks Response
**What goes wrong:** The `next_steps` INSERT is awaited synchronously in the reply generation flow, causing response latency if the DB is slow.

**Why it happens:** Treating next_steps as a required step rather than an analytics/audit write.

**How to avoid:** Use the exact same fire-and-forget pattern as `reply_generations` audit (replies.js lines 544-563): wrap in try/catch, never await the result in the main flow, log errors only.

---

## Code Examples

### Example 1: Tone Depth Injection (THREAD-02)

Inject into `buildPromptWithContext()` after the existing job context block:

```javascript
// Source: Extend buildPromptWithContext() in src/routes/replies.js
if (promptType === 'THREAD_CONTINUATION_V1' && job) {
  const depth = job.thread_depth || 0;
  const stage = job.thread_stage || 'DISCOVERY';
  const clientName = job.client_first_name || 'the client';
  const messageLength = job.client_message_length || 'MEDIUM';

  let toneInstruction;
  if (depth <= 3) {
    toneInstruction = 'Slightly formal. Lead with insight. Do not use first name yet.';
  } else if (depth <= 6) {
    toneInstruction = `Use first name (${clientName}). Shorter sentences. More direct.`;
  } else {
    toneInstruction = 'Ultra-casual. Drop all sales tone. Write like you know this person.';
  }

  if (stage === 'POST_CALL') {
    toneInstruction = 'Match the tone of the call. Reference specifics from the call. Recap first.';
  }

  prompt += `\n\n<thread_context>
Current Stage: ${stage}
Thread Depth: ${depth} exchanges
Tone Instruction: ${toneInstruction}
Client Energy: ${messageLength} (${messageLength === 'SHORT' ? 'keep reply under 60 words' : messageLength === 'MEDIUM' ? 'keep reply under 100 words' : 'match client detail level'})
</thread_context>`;
}
```

### Example 2: Stall Recovery Injection (THREAD-05)

```javascript
// Source: New context block for THREAD_CONTINUATION_V1 when stage = STALLED
if (promptType === 'THREAD_CONTINUATION_V1' && stage === 'STALLED') {
  const stallType = job.stall_type || 'UNKNOWN'; // new column from migration 009

  const stallInstructions = {
    'THINKING': 'Wait Day 3. Add NEW value — project-specific insight. NO call CTA. Day 3 follow-up carries CTA.',
    'PRICING_SILENCE': 'Day 3: Suggest Phase 1 option only. Day 7: Graceful close. Never defend price.',
    'CALL_SILENCE': 'Day 2: Recap the call. Day 5: Value-add. Day 10: Graceful close.',
    'NO_COMMITMENT': 'Offer a tangible attachment — mockup, audit finding, or case study. No pressure.',
    'UNKNOWN': 'Add project-specific value. No call CTA. Keep under 60 words.',
  };

  prompt += `\n\n<stall_recovery>
Stall Type: ${stallType}
Recovery Strategy: ${stallInstructions[stallType] || stallInstructions['UNKNOWN']}
CRITICAL: Do not push. Do not guilt. Add value only.
</stall_recovery>`;
}
```

### Example 3: CC Contact Injection (THREAD-04)

```javascript
// Source: New context block — cc_contacts parsed from jobs record
if (promptType === 'THREAD_CONTINUATION_V1' && job && job.cc_contacts) {
  let contacts;
  try {
    contacts = typeof job.cc_contacts === 'string'
      ? JSON.parse(job.cc_contacts)
      : job.cc_contacts;
  } catch { contacts = []; }

  if (Array.isArray(contacts) && contacts.length > 0) {
    const newPerson = contacts[0]; // Address the first/newest CC
    prompt += `\n\n<cc_handling>
A new person (${newPerson.name || newPerson.email}) has been CC'd on this thread.
In your FIRST sentence, address them by name and give context:
"Hi ${newPerson.name || 'there'}, quick context: [our name] and I have been discussing [project] — we've covered [X] and next step is [Y]."
Do not assume they have read previous emails.
</cc_handling>`;
  }
}
```

### Example 4: next_steps INSERT After THREAD_CONTINUATION_V1

```javascript
// Source: Modelled on reply_generations fire-and-forget write (replies.js lines 544-563)
// Place in Step 7, after reply is saved to DB
if (job && job.id && promptType === 'THREAD_CONTINUATION_V1') {
  const nextStepData = parseNextStepBlock(rawText); // rawText before clean extraction
  if (nextStepData) {
    pool.query(
      `INSERT INTO next_steps (lead_id, reply_generation_id, our_action, their_action, followup_approach, followup_date)
       VALUES ($1, $2, $3, $4, $5, $6::DATE)`,
      [
        job.id,
        replyGenerationId || null,
        nextStepData.our_action,
        nextStepData.their_action || null,
        nextStepData.followup_approach || null,
        nextStepData.followup_date || null,
      ]
    ).catch((err) => console.error('replies: next_steps insert failed:', err.message));
  }
}
```

### Example 5: Migration 009 Required Columns

```sql
-- Migration 009: Thread Continuation Engine Schema
-- Phase 15: THREAD-01 through THREAD-09

-- THREAD-03: Client requested proposal toggle (per-lead, persisted)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_requested_proposal BOOLEAN NOT NULL DEFAULT false;

-- THREAD-04: CC raw header stored at sync time
ALTER TABLE emails ADD COLUMN IF NOT EXISTS cc_raw TEXT;

-- THREAD-05: Stall type classification
DO $$ BEGIN
  CREATE TYPE stall_type_enum AS ENUM (
    'THINKING', 'PRICING_SILENCE', 'CALL_SILENCE', 'NO_COMMITMENT', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stall_type stall_type_enum;

-- THREAD-07: Email open tracking (manual-only path for now)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS hot_signal_flagged BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_emails_hot_signal
  ON emails (hot_signal_flagged) WHERE hot_signal_flagged = true;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No thread stage tracking | `thread_stage_enum` in DB schema | Phase 11 migration 005 | Column exists but is never written to — Phase 15 is the first to populate it |
| No CC tracking | `jobs.cc_contacts JSONB` in DB schema | Phase 11 migration 005 | Column exists but Gmail sync never extracts the CC header — Phase 15 adds the extraction |
| No next-step persistence | `next_steps` table fully defined | Phase 11 migration 005 | Table exists but nothing inserts into it — Phase 15 is the first writer |
| No re-engagement content | `jobs.re_engagement_strategy TEXT` in DB schema | Phase 11 migration 005 | Column exists; kill switch sets `match_status = 'dormant'` but never generates the strategy |
| Kill switch fires and returns | Kill switch + re-engagement generation | Phase 15 | THREAD-06 adds Haiku generation before the return |

**What the seed prompt already handles:** The `THREAD_CONTINUATION_V1` seed template (seed_v2_foundation.js lines 227-281) already documents all tone rules, stage signals, post-call behaviour, stall recovery strategies, and the NEXT STEP SUMMARY block format. Phase 15 does NOT need to rewrite the prompt — it needs to inject the right context variables (depth, stage, CC, energy) so Claude can follow the rules that already exist in the template.

---

## Open Questions

1. **THREAD-07: Hot Signal tracking mechanism**
   - What we know: No email open tracking exists. `open_count` column does not exist.
   - What's unclear: Should this be a tracking pixel in sent emails, a Mailsuite integration, or purely manual?
   - Recommendation: Add `open_count INTEGER DEFAULT 0` and `hot_signal_flagged BOOLEAN DEFAULT false` to emails table. Provide `PUT /api/emails/:id/open-count` to increment manually. Document as manual-only for Phase 15. Automated pixel tracking is a separate infrastructure phase.

2. **Stall type detection approach for THREAD-05**
   - What we know: Stall types are: "let me think", "pricing silence", "call silence", "multiple replies no commitment". These map to detectable patterns.
   - What's unclear: Is regex sufficient, or does it need Haiku classification?
   - Recommendation: Use regex for the obvious ones ("let me think" → THINKING, pricing silence in STALLED context → PRICING_SILENCE). If `thread_stage = STALLED` and `objection_detected = 'PRICING'` → PRICING_SILENCE. If `post_call_recap_sent = true` and stage = STALLED → CALL_SILENCE. Avoid adding another Haiku call if avoidable.

3. **Where does `thread_client_messages` get incremented?**
   - What we know: `jobs.thread_client_messages INTEGER DEFAULT 0` exists. The prompt router uses it to detect THREAD_CONTINUATION_V1 (`thread_client_messages >= 2`). It is never incremented in the current codebase.
   - What's unclear: Should it be incremented at sync time (when a new email arrives from the client's email address) or at reply generation time?
   - Recommendation: Increment at sync time in the Gmail sync path — when a new email is inserted and its `from_email` matches the job's `client_email`, increment `thread_client_messages`. This ensures accurate routing without reply generation as a dependency.

4. **THREAD-09: Which generation types trigger next_steps INSERT?**
   - What we know: The requirement says "after every Thread Continuation reply." The existing pipeline writes `reply_generations` for all prompt types.
   - What's unclear: Should next_steps also fire for FOLLOW_UP_V2 or PROPOSAL_V4?
   - Recommendation: Scope to `THREAD_CONTINUATION_V1` only for Phase 15. The NEXT STEP SUMMARY block is only instructed in that template. Other prompt types don't produce the block.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/config/migrations/002_email_and_jobs.sql` — emails and jobs schema
- Direct codebase inspection: `src/config/migrations/005_v2_prompt_foundation.sql` — all Phase 11 columns, next_steps table, all enums
- Direct codebase inspection: `src/config/migrations/008_kill_switch.sql` — kill switch column, current dormant logic
- Direct codebase inspection: `src/routes/replies.js` — 7-step pipeline, all existing hooks, kill switch implementation
- Direct codebase inspection: `src/utils/promptRouter.js` — thread detection routing rules
- Direct codebase inspection: `src/utils/detectSignals.js` — existing signal detection patterns
- Direct codebase inspection: `src/utils/validateReply.js` — validation pipeline
- Direct codebase inspection: `src/routes/gmail.js` — Gmail sync path, CC header gap confirmed
- Direct codebase inspection: `src/routes/emails.js` — sync-all path, CC header gap confirmed
- Direct codebase inspection: `src/config/seeds/seed_v2_foundation.js` — THREAD_CONTINUATION_V1 prompt template content, NEXT STEP SUMMARY format

### Secondary (MEDIUM confidence)
- Gmail API documentation (established knowledge): `Cc` is a standard header available in `full` format message payloads via `headers[]` array — already accessed via `getHeader()` helper

### Tertiary (LOW confidence)
- None — all findings are from direct code inspection

---

## Metadata

**Confidence breakdown:**
- Schema/DB: HIGH — all columns inspected directly from migration SQL files
- Pipeline integration points: HIGH — replies.js read in full, exact line numbers noted
- CC extraction gap: HIGH — both sync paths read in full, `getHeader("Cc")` confirmed absent
- THREAD-07 (open tracking): HIGH — confirmed by searching entire src/ for open_count, mailsuite, tracking; none found
- Stall type detection: MEDIUM — approach recommended but not validated against real email patterns

**Research date:** 2026-03-05
**Valid until:** 2026-06-05 (stable codebase — no fast-moving external dependencies)
