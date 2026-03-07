'use strict';

/**
 * Prompt Router — PROMPT-02
 *
 * Rule-based prompt type selector. Pure function — no DB calls, no Express coupling.
 * Used by the Phase 12 pipeline orchestrator to determine which template to use
 * before calling Claude for reply generation.
 */

const VALID_PROMPT_TYPES = [
  'EMAIL_REPLY_V2',
  'THREAD_CONTINUATION_V1',
  'FOLLOW_UP_V2',
  'PROPOSAL_V4',
  'LOVABLE_MOCKUP_V1',
];

const PROMPT_TYPE_LABELS = {
  'EMAIL_REPLY_V2':         'First Reply',
  'THREAD_CONTINUATION_V1': 'Thread Continuation',
  'FOLLOW_UP_V2':           'Follow-Up',
  'PROPOSAL_V4':            'Proposal',
  'LOVABLE_MOCKUP_V1':      'Lovable Mockup',
};

/**
 * Determines which prompt template to use for generation.
 * Returns a prompt_type_enum string, or null for STOP suppression.
 *
 * Decision tree (strict priority order):
 * 1. options.promptOverride — manual override (PROMPT-04)
 * 2. options.source === 'proposal' → PROPOSAL_V4
 * 3. options.source === 'mockup'   → LOVABLE_MOCKUP_V1
 * 4. email.is_ooo / email.intent === 'ooo' → null (STOP — no AI call)
 * 5. thread_client_messages >= 2 OR thread_depth >= 2 (prior exchange exists):
 *    5a. client silent >= 3 days → FOLLOW_UP_V2
 *    5b. otherwise → THREAD_CONTINUATION_V1
 * 6. Default → EMAIL_REPLY_V2 (first reply — single-message thread)
 *
 * @param {Object} email   - email row from DB (received_at, intent, is_ooo)
 * @param {Object} job     - job row from DB (thread_depth, thread_client_messages)
 * @param {Object} options - { promptOverride?: string, source?: 'proposal'|'mockup'|null }
 * @returns {string|null}  prompt_type_enum value, or null for STOP suppression
 */
function determinePromptType(email, job, options) {
  if (email === null || email === undefined) email = {};
  if (job === null || job === undefined) job = {};
  if (options === null || options === undefined) options = {};

  // 1. Manual override (PROMPT-04) — must be a valid enum value
  if (options.promptOverride && VALID_PROMPT_TYPES.includes(options.promptOverride)) {
    return options.promptOverride;
  }

  // 2. Explicit button source: proposal
  if (options.source === 'proposal') return 'PROPOSAL_V4';

  // 3. Explicit button source: mockup
  if (options.source === 'mockup') return 'LOVABLE_MOCKUP_V1';

  // 4. STOP — suppress generation (OOO / stop intent)
  if (email.is_ooo === true || email.intent === 'ooo') return null;

  // 5. Ongoing thread (2+ client messages OR 2+ depth = prior exchange exists)
  const threadClientMsgs = (job.thread_client_messages) ? job.thread_client_messages : 0;
  const threadDepth = (job.thread_depth) ? job.thread_depth : 0;
  if (threadClientMsgs >= 2 || threadDepth >= 2) {
    // Sub-check: if client went silent for 3+ days, use follow-up tone
    if (email.received_at) {
      const daysSince = (Date.now() - new Date(email.received_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= 3) return 'FOLLOW_UP_V2';
    }
    return 'THREAD_CONTINUATION_V1';
  }

  // 6. Default: first reply (single-message thread or no prior exchange)
  return 'EMAIL_REPLY_V2';
}

module.exports = { determinePromptType, PROMPT_TYPE_LABELS, VALID_PROMPT_TYPES };
