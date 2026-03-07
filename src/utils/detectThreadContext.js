'use strict';

/**
 * detectThreadContext.js — Thread Stage & Context Detection Utility
 * Phase 15: Thread Continuation Engine
 *
 * Requirements:
 *   THREAD-01: classifyThreadStage  — Haiku-powered stage classification
 *   THREAD-04: parseCcContacts      — Parse Cc header into structured contacts
 *   THREAD-05: detectStallType      — Classify why a thread has stalled
 *   THREAD-08: measureClientMessageLength — Short/Medium/Long word-count bucketing
 *   THREAD-09: parseNextStepBlock   — Extract NEXT STEP SUMMARY internal block from reply text
 *
 * Pure CommonJS utility module. Only classifyThreadStage is async (Haiku call).
 * All other functions are synchronous and deterministic.
 *
 * INPUT DISTINCTION (critical — prevents future confusion):
 *   classifyThreadStage()        → reads EMAIL TEXT + job context (async, calls Haiku)
 *   measureClientMessageLength() → reads EMAIL BODY TEXT (sync)
 *   detectStallType()            → reads EMAIL TEXT + jobs row (sync)
 *   parseCcContacts()            → reads Cc header raw string (sync)
 *   parseNextStepBlock()         → reads AI-generated reply text (sync)
 *
 * Exports: classifyThreadStage, measureClientMessageLength, detectStallType,
 *          parseCcContacts, parseNextStepBlock
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid thread stage values (THREAD-01) */
const VALID_STAGES = ['DISCOVERY', 'CALL_BOOKING', 'POST_CALL', 'NEGOTIATION', 'CLOSING', 'STALLED'];

/** Default/fail-open stage */
const DEFAULT_STAGE = 'DISCOVERY';

/** Anthropic API endpoint */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/** Haiku model for lightweight classification */
const HAIKU_MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// classifyThreadStage(emailText, jobContext, anthropicKey) — THREAD-01
// ---------------------------------------------------------------------------

/**
 * classifyThreadStage — THREAD-01
 *
 * Async. Calls Claude Haiku to classify an email into one of 6 thread stages.
 * Returns DEFAULT_STAGE ('DISCOVERY') on any error or invalid Haiku response.
 * Also returns DEFAULT_STAGE immediately if emailText is falsy.
 *
 * @param {string} emailText      - The client's email body text
 * @param {string|null} jobContext - Job heading/description for additional context (optional)
 * @param {string} anthropicKey   - Decrypted Anthropic API key
 * @returns {Promise<'DISCOVERY'|'CALL_BOOKING'|'POST_CALL'|'NEGOTIATION'|'CLOSING'|'STALLED'>}
 */
async function classifyThreadStage(emailText, jobContext, anthropicKey) {
  if (!emailText) return DEFAULT_STAGE;

  const prompt = `Classify this client email in an ongoing Upwork conversation into ONE of these stages:
DISCOVERY - initial questions, exploring needs
CALL_BOOKING - scheduling or confirming a call
POST_CALL - following up after a call/meeting
NEGOTIATION - discussing price, scope, or terms
CLOSING - contract/hire is imminent
STALLED - client has gone quiet or non-committal

Client email: "${emailText.substring(0, 600)}"
Job context: "${jobContext ? jobContext.substring(0, 300) : 'none'}"

Reply with ONLY one word from the list above.`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return DEFAULT_STAGE;

    const data = await res.json();
    const raw = data?.content?.[0]?.text?.trim().toUpperCase() || '';
    return VALID_STAGES.includes(raw) ? raw : DEFAULT_STAGE;
  } catch {
    return DEFAULT_STAGE;
  }
}

// ---------------------------------------------------------------------------
// measureClientMessageLength(bodyText) — THREAD-08
// ---------------------------------------------------------------------------

/**
 * measureClientMessageLength — THREAD-08
 *
 * Pure sync. Buckets the client's message by word count.
 * Returns 'MEDIUM' if bodyText is null/empty (safe default for unknown content).
 *
 * Thresholds:
 *   SHORT  — < 30 words
 *   MEDIUM — 30–100 words (inclusive)
 *   LONG   — 101+ words
 *
 * @param {string|null} bodyText - The client's email body text
 * @returns {'SHORT'|'MEDIUM'|'LONG'}
 */
function measureClientMessageLength(bodyText) {
  if (!bodyText) return 'MEDIUM';

  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;

  if (wordCount < 30) return 'SHORT';
  if (wordCount <= 100) return 'MEDIUM';
  return 'LONG';
}

// ---------------------------------------------------------------------------
// detectStallType(emailText, job) — THREAD-05
// ---------------------------------------------------------------------------

/**
 * STALL_THINKING_PATTERNS — regex patterns for "let me think" phrasing.
 * Checked first because explicit thinking language is the most reliable signal.
 */
const STALL_THINKING_PATTERNS = /let me think|need (more )?time|think (about|it)|consider(ing)?|not sure yet/i;

/**
 * detectStallType — THREAD-05
 *
 * Pure sync. Classifies why a thread appears stalled, using email text and
 * job row fields (thread_stage, objection_detected, thread_client_messages).
 * Returns 'UNKNOWN' when no classification signal is present.
 *
 * Detection order (first match wins):
 *   1. THINKING       — email text has explicit "let me think" phrasing
 *   2. CALL_SILENCE   — thread was POST_CALL and no pricing objection detected
 *   3. PRICING_SILENCE — objection was PRICING
 *   4. NO_COMMITMENT  — client has sent 3+ messages with no objection detected
 *   5. UNKNOWN        — none of the above
 *
 * @param {string|null} emailText - The client's email body text
 * @param {Object|null} job       - The jobs DB row (or null if no match)
 * @returns {'THINKING'|'PRICING_SILENCE'|'CALL_SILENCE'|'NO_COMMITMENT'|'UNKNOWN'}
 */
function detectStallType(emailText, job) {
  // 1. Explicit thinking language
  if (emailText && STALL_THINKING_PATTERNS.test(emailText)) {
    return 'THINKING';
  }

  // 2. Call silence — post-call but no pricing objection
  if (job && job.thread_stage === 'POST_CALL' && job.objection_detected !== 'PRICING') {
    return 'CALL_SILENCE';
  }

  // 3. Pricing silence — pricing objection was previously detected
  if (job && job.objection_detected === 'PRICING') {
    return 'PRICING_SILENCE';
  }

  // 4. No commitment — 3+ messages exchanged with no specific objection
  if (job && job.thread_client_messages >= 3) {
    return 'NO_COMMITMENT';
  }

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// parseCcContacts(ccRaw) — THREAD-04
// ---------------------------------------------------------------------------

/**
 * parseCcContacts — THREAD-04
 *
 * Pure sync. Parses a raw Cc header string into an array of structured contacts.
 * Returns [] if ccRaw is falsy.
 *
 * Supported formats:
 *   "John Smith <john@example.com>, jane@example.com"
 *   → [{name: 'John Smith', email: 'john@example.com'}, {name: null, email: 'jane@example.com'}]
 *
 * @param {string|null} ccRaw - Raw Cc header value (comma-separated)
 * @returns {Array<{name: string|null, email: string}>}
 */
function parseCcContacts(ccRaw) {
  if (!ccRaw) return [];

  return ccRaw
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      const nameEmailMatch = trimmed.match(/^(.+?)\s*<(.+?)>$/);
      if (nameEmailMatch) {
        return {
          name: nameEmailMatch[1].replace(/"/g, '').trim(),
          email: nameEmailMatch[2].trim(),
        };
      }
      // No angle-bracket format — treat entire entry as email
      return { name: null, email: trimmed };
    })
    .filter((contact) => Boolean(contact.email));
}

// ---------------------------------------------------------------------------
// parseNextStepBlock(rawText) — THREAD-09
// ---------------------------------------------------------------------------

/**
 * parseNextStepBlock — THREAD-09
 *
 * Pure sync. Extracts the internal NEXT STEP SUMMARY block appended by the
 * THREAD_CONTINUATION_V1 prompt template to AI-generated reply text.
 *
 * Block format (generated by prompt):
 *   --- NEXT STEP SUMMARY (Internal) ---
 *   - What we promised: [text]
 *   - What we expect from them: [text]
 *   - Follow-up if no response by: [date text]
 *   - Recommended follow-up approach: [text]
 *
 * Returns null if no block is found.
 * Returns the object even if some fields are null (partial blocks are valid).
 *
 * @param {string|null} rawText - Full AI reply text (may or may not contain block)
 * @returns {{our_action: string|null, their_action: string|null, followup_date: string|null, followup_approach: string|null}|null}
 */
function parseNextStepBlock(rawText) {
  if (!rawText) return null;

  const blockMatch = rawText.match(/---\s*NEXT STEP SUMMARY[^-]*---\s*([\s\S]*?)(?:---|$)/i);
  if (!blockMatch) return null;

  const block = blockMatch[1];

  const extract = (label) => {
    const m = block.match(new RegExp(`${label}:\\s*(.+?)(?=\\n-|\\n---|$)`, 'i'));
    return m ? m[1].trim() : null;
  };

  return {
    our_action: extract('What we promised'),
    their_action: extract('What we expect from them'),
    followup_date: extract('Follow-up if no response by'),
    followup_approach: extract('Recommended follow-up approach'),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  classifyThreadStage,
  measureClientMessageLength,
  detectStallType,
  parseCcContacts,
  parseNextStepBlock,
};
