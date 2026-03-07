'use strict';

/**
 * detectSignals.js — Objection & Scope Signal Detection Utility
 * Phase 14: Objection Handling + Thread Engine
 * Requirements: OBJECTION-01 (detectObjection), OBJECTION-04 (detectAgencySensitivity),
 *               OBJECTION-05 (detectScopeFraming)
 *
 * Pure CommonJS utility module — no DB calls, no async, no side effects.
 * All functions are synchronous and deterministic.
 *
 * INPUT DISTINCTION (critical — prevents future confusion):
 *   detectObjection()       → reads EMAIL TEXT (what the client wrote to us)
 *   detectAgencySensitivity() → reads JOB POST TEXT (the Upwork listing text)
 *   detectScopeFraming()    → reads EMAIL TEXT (what the client wrote to us)
 *
 * Exports: detectObjection, detectAgencySensitivity, detectScopeFraming
 */

// ---------------------------------------------------------------------------
// detectObjection(emailText) — OBJECTION-01
// ---------------------------------------------------------------------------

/**
 * OBJECTION_PATTERNS — regex arrays keyed by objection type.
 *
 * Priority order (first match wins):
 *   ALREADY_HIRED > AGENCY > PRICING > COMPARISON > TECHNICAL_Q
 *
 * Rationale: ALREADY_HIRED must fire first (no point counter-moving a closed deal).
 * AGENCY before PRICING because "no agencies" overrides any price discussion.
 * TECHNICAL_Q is lowest priority — many tech terms appear in non-technical contexts.
 */
const OBJECTION_PATTERNS = [
  {
    type: 'ALREADY_HIRED',
    patterns: [
      /\bfound someone(?!\s+cheaper)\b/i,
      /\balready (?:hired|resolved|found)\b/i,
      /\bwent with (?:someone|another)\b/i,
      /\bno longer (?:need|looking)\b/i,
      /\bposition (?:is )?filled\b/i,
    ],
  },
  {
    type: 'AGENCY',
    patterns: [
      /\bno agencies\b/i,
      /\bindividual(?:s)? only\b/i,
      /\blooking for (?:a )?(?:freelancer|individual|solo)\b/i,
      /\bfreelancer only\b/i,
      /\bsolo developer\b/i,
      /\bnot (?:an )?agenc(?:y|ies)\b/i,
    ],
  },
  {
    type: 'PRICING',
    patterns: [
      /\bhow much\b/i,
      /\bwhat(?:'s| is) (?:the )?(?:cost|price|rate|budget)\b/i,
      /\btoo expensive\b/i,
      /\boutside (?:our|my) budget\b/i,
      /\bcan you (?:do|make) it cheaper\b/i,
      /\bwhat(?:'s| is) your (?:rate|pricing)\b/i,
      /\bprice range\b/i,
    ],
  },
  {
    type: 'COMPARISON',
    patterns: [
      /\bcomparing (?:option|proposal|quote)s?\b/i,
      /\bfound someone cheaper\b/i,
      /\bgot (?:other|another) proposal\b/i,
      /\bother (?:option|bid|quote)s?\b/i,
      /\bsomeone (?:else|other)\b/i,
      /\bshopping around\b/i,
    ],
  },
  {
    type: 'TECHNICAL_Q',
    patterns: [
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
  },
];

/**
 * detectObjection(emailText) — OBJECTION-01
 *
 * Scans EMAIL TEXT (what client wrote) for objection signals.
 * Returns the highest-priority matching objection type, or 'NONE' if no match.
 *
 * Priority order: ALREADY_HIRED > AGENCY > PRICING > COMPARISON > TECHNICAL_Q
 * First match wins — stops scanning after the first type with a matching pattern.
 *
 * @param {string} emailText - The client's email body text
 * @returns {'PRICING'|'AGENCY'|'COMPARISON'|'TECHNICAL_Q'|'ALREADY_HIRED'|'NONE'}
 */
function detectObjection(emailText) {
  if (!emailText) return 'NONE';

  for (const { type, patterns } of OBJECTION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(emailText)) {
        return type;
      }
    }
  }

  return 'NONE';
}

// ---------------------------------------------------------------------------
// detectAgencySensitivity(jobText) — OBJECTION-04
// ---------------------------------------------------------------------------

/**
 * AGENCY_SENSITIVITY_PATTERNS — regex patterns for agency restrictions.
 *
 * These are scanned against JOB POST TEXT (the Upwork listing), NOT the email body.
 * Overlaps with AGENCY objection patterns intentionally — the job post signals
 * agency sensitivity BEFORE any client email arrives, allowing proactive framing.
 */
const AGENCY_SENSITIVITY_PATTERNS = [
  /\bno agencies\b/i,
  /\bindividual(?:s)? only\b/i,
  /\bfreelancer only\b/i,
  /\bsolo developer\b/i,
  /\bnot (?:an )?agenc(?:y|ies)\b/i,
  /\bprefer(?:ring)? (?:a )?(?:freelancer|individual|solo)\b/i,
  /\bno agenc(?:y|ies)\b/i,
];

/**
 * detectAgencySensitivity(jobText) — OBJECTION-04
 *
 * Scans JOB POST TEXT (the Upwork listing) for agency-restriction signals.
 * Returns true if the client has indicated they do NOT want to work with agencies.
 *
 * NOTE: Input is job post text, not email text.
 *       Call this with the job description/heading from leadhack.info, not the email body.
 *
 * @param {string} jobText - The Upwork job listing text (job_description or job_heading)
 * @returns {boolean} - true if job post restricts agencies
 */
function detectAgencySensitivity(jobText) {
  if (!jobText) return false;

  for (const pattern of AGENCY_SENSITIVITY_PATTERNS) {
    if (pattern.test(jobText)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// detectScopeFraming(emailText) — OBJECTION-05
// ---------------------------------------------------------------------------

/**
 * SCOPE_FRAMING_PATTERNS — regex arrays keyed by scope framing type.
 *
 * Priority order: PHASES > HOURS > FIXED
 * Rationale: PHASES is most specific (milestone-based). HOURS is time-based.
 * FIXED covers lump-sum pricing. First match wins.
 */
const SCOPE_FRAMING_PATTERNS = [
  {
    type: 'PHASES',
    patterns: [
      /\bphase(?:s)?\b/i,
      /\bmilestone(?:s)?\b/i,
      /\bstage(?:s)?\b/i,
      /\bin (?:multiple )?part(?:s)?\b/i,
    ],
  },
  {
    type: 'HOURS',
    patterns: [
      /\b\d+\s*hour(?:s|ly)?\b/i,
      /\bhourly\b/i,
      /\bper hour\b/i,
      /\bhours? (?:per|a) week\b/i,
      /\bhours? of work\b/i,
    ],
  },
  {
    type: 'FIXED',
    patterns: [
      /\bfixed (?:price|budget|cost|rate)\b/i,
      /\b\$[\d,]+\s*(?:total|flat|fixed)?\b/i,
      /\bone.time (?:fee|cost|payment)\b/i,
      /\btotal budget\b/i,
      /\bbulk (?:price|payment)\b/i,
    ],
  },
];

/**
 * detectScopeFraming(emailText) — OBJECTION-05
 *
 * Scans EMAIL TEXT (what client wrote) for how they mentally frame project scope.
 * Returns the detected framing type, or 'UNKNOWN' if no pattern matches.
 *
 * Priority order: PHASES > HOURS > FIXED (more specific wins)
 * First match wins — stops scanning after the first type with a matching pattern.
 *
 * Use this to mirror the client's framing in the reply:
 *   PHASES  → structure reply around milestones
 *   HOURS   → quote in hours/weekly commitment
 *   FIXED   → provide a lump-sum framing
 *   UNKNOWN → use neutral framing, let Claude decide
 *
 * @param {string} emailText - The client's email body text
 * @returns {'PHASES'|'HOURS'|'FIXED'|'UNKNOWN'}
 */
function detectScopeFraming(emailText) {
  if (!emailText) return 'UNKNOWN';

  for (const { type, patterns } of SCOPE_FRAMING_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(emailText)) {
        return type;
      }
    }
  }

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// detectDueDiligence(emailText) — DUE_DILIGENCE detection
// ---------------------------------------------------------------------------

/**
 * PROOF_OF_WORK_PATTERNS — client is asking to see past portfolio evidence.
 *
 * Scanned against EMAIL TEXT (what the client wrote).
 * When matched, the reply should redirect to the mockup instead of real portfolio.
 */
const PROOF_OF_WORK_PATTERNS = [
  /\bscreenshot\b/i,
  /\bvideo walkthrough\b/i,
  /\bpersonally built\b/i,
  /\bactually (?:wired|built|created|implemented)\b/i,
  /\bspecific role\b/i,
  /\bpast (?:work|project|example|build)\b/i,
  /\bshow me\b/i,
  /\bsend me (?:a|an)\b.*(?:screenshot|video|example|sample)\b/i,
  /\byou (?:personally|yourself)\b/i,
  /\bnot (?:designed|designed,)\s*but\b/i,
];

/**
 * detectProofOfWorkRequest(emailText) — boolean
 *
 * Returns true when the client is asking for portfolio evidence, screenshots,
 * video walkthroughs, or proof that you personally built something.
 *
 * @param {string} emailText - The client's email body text
 * @returns {boolean}
 */
function detectProofOfWorkRequest(emailText) {
  if (!emailText) return false;
  return PROOF_OF_WORK_PATTERNS.some((p) => p.test(emailText));
}

/**
 * countNumberedQuestions(text) — counts lines starting with "1.", "2.", "3." etc.
 *
 * @param {string} text
 * @returns {number}
 */
function countNumberedQuestions(text) {
  const matches = text.match(/^\s*\d+\.\s/gm) || [];
  return matches.length;
}

/**
 * detectDueDiligence(emailText) — boolean
 *
 * Returns true when the client is doing structured vendor vetting:
 * - 3+ numbered/structured questions, OR
 * - Any proof-of-work request (screenshot, video, past build, etc.)
 *
 * When true, the reply pipeline should switch to DUE_DILIGENCE mode:
 * answer 2 questions with real substance, redirect proof-of-work to mockup,
 * bridge the rest to a call.
 *
 * @param {string} emailText - The client's email body text
 * @returns {boolean}
 */
function detectDueDiligence(emailText) {
  if (!emailText) return false;

  // 3+ numbered questions = structured vetting
  if (countNumberedQuestions(emailText) >= 3) return true;

  // Proof-of-work request = credibility challenge
  if (detectProofOfWorkRequest(emailText)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  detectObjection,
  detectAgencySensitivity,
  detectScopeFraming,
  detectDueDiligence,
  detectProofOfWorkRequest,
};
