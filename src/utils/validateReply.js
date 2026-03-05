'use strict';

/**
 * validateReply.js — Post-Generation Validation Utility
 * Phase 13: Post-Generation Validation
 * Requirements: VALIDATE-01, VALIDATE-02, VALIDATE-04, QUALITY-03, QUALITY-04
 *
 * Pure CommonJS utility module — no DB calls, no async, no side effects.
 * All functions are synchronous and deterministic.
 *
 * Exports: proposalGate, bannedPhraseScanner, nextStepScanner, metricsScanner, CALL_REDIRECT
 */

/**
 * CALL_REDIRECT — replacement string for stripped pricing language.
 * Used by proposalGate() when pricing patterns are detected and must be removed.
 */
const CALL_REDIRECT = "I'd love to discuss the details on a quick call.";

/**
 * PRICING_PATTERNS — regex patterns matched against reply body for VALIDATE-01 / QUALITY-03.
 * Narrowed to avoid over-aggressive matching (Research Pitfall 3):
 * - Bare dollar amounts only (not context-neutral words like "weeks" or "timeline")
 * - Budget and timeline only when followed by specific context words
 * - Phase N pattern (phase 1, phase 2, etc.) — rarely used outside scope discussions
 * - Deliverables only in list-context phrases
 *
 * IMPORTANT: All patterns must have their lastIndex reset after each test (Pitfall 1).
 */
const PRICING_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/g,                                     // $500, $1,200.00
  /\bUSD\b/gi,                                                   // USD
  /\bpric(?:e[sd]?|ing)\b/gi,                                   // price/prices/priced/pricing
  /\bbudget(?:\s+(?:constraint|of|for|is|was))?\b/gi,           // budget in context
  /\bphase\s+[1-9]\b/gi,                                        // phase 1, phase 2, etc.
  /\btimeline\s+(?:of|for|is|would|will)\b/gi,                  // timeline when followed by specifics
  /\bdeliverable[s]?\s+(?:include|are|will|would)\b/gi,         // deliverables in list context
];

/**
 * removeProofSection(text) — QUALITY-04 helper (not exported)
 *
 * Locates the "proof" paragraph in a proposal body — defined as a paragraph
 * (text between empty lines) containing social proof phrases like "we have",
 * "our work", "we've", "similar clients", "previously", "delivered".
 *
 * If the proof paragraph has no metrics (per metricsScanner), removes it entirely.
 * Returns cleaned text, or original text if no qualifying proof section is found.
 *
 * @param {string} text - Full proposal text
 * @returns {string} - Text with proof section removed (if applicable)
 */
function removeProofSection(text) {
  // Split into paragraphs on blank lines
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length <= 1) return text;

  const proofPhrases = /\b(we have|our work|we've|similar clients|previously|delivered|our team|our experience|we built|we helped)\b/i;

  const filteredParagraphs = paragraphs.filter((para) => {
    const isProofLike = proofPhrases.test(para);
    if (!isProofLike) return true; // not a proof paragraph — keep it
    const { hasMetrics } = metricsScanner(para);
    return hasMetrics; // keep only if it has metrics
  });

  // If nothing was removed, return original (avoid extra blank line joins)
  if (filteredParagraphs.length === paragraphs.length) return text;

  return filteredParagraphs.join('\n\n');
}

/**
 * proposalGate(text, promptType, clientRequestedPricing) — VALIDATE-01 + QUALITY-03
 *
 * Gates pricing language in replies:
 * - PROPOSAL_V4 with clientRequestedPricing=true: allowed through unchanged
 * - PROPOSAL_V4 without clientRequestedPricing: proof section removed if no metrics,
 *   then pricing patterns scanned and replaced with CALL_REDIRECT
 * - All other prompt types: pricing patterns scanned and replaced with CALL_REDIRECT
 *
 * @param {string} text - Reply text to scan
 * @param {string} promptType - One of the prompt_type_enum values
 * @param {boolean} [clientRequestedPricing=false] - True when client explicitly asked for pricing
 * @returns {{ text: string, stripped: boolean }}
 */
function proposalGate(text, promptType, clientRequestedPricing = false) {
  // PROPOSAL_V4 with explicit client request: pass through unchanged
  if (promptType === 'PROPOSAL_V4' && clientRequestedPricing === true) {
    return { text, stripped: false };
  }

  let working = text;

  // PROPOSAL_V4 without client request: remove proof section if it lacks metrics
  if (promptType === 'PROPOSAL_V4') {
    working = removeProofSection(working);
  }

  let stripped = false;

  for (const pattern of PRICING_PATTERNS) {
    // Reset lastIndex to avoid stale state from previous test calls (Pitfall 1)
    pattern.lastIndex = 0;

    if (pattern.test(working)) {
      stripped = true;
      pattern.lastIndex = 0; // reset again before replace (test() advances lastIndex)
      working = working.replace(pattern, CALL_REDIRECT);
    }

    // Final reset — ensure no state leaks to the next iteration
    pattern.lastIndex = 0;
  }

  return { text: working, stripped };
}

/**
 * bannedPhraseScanner(text, bannedPhrases) — VALIDATE-02
 *
 * Scans reply text against a list of banned phrases loaded from the DB.
 * Case-insensitive indexOf matching. Returns all violations found.
 *
 * Auto-rewrite: if a banned phrase has a replacement_suggestion, the phrase is
 * replaced in the rewrittenText output. Violations array is always returned for
 * frontend display (even for auto-rewritten phrases).
 *
 * @param {string} text - Reply text to scan
 * @param {Array<{phrase: string, category: string, replacement_suggestion: string|null, active: boolean}>} bannedPhrases
 * @returns {{ violations: Array<{phrase, index, category, replacement}>, rewrittenText: string }}
 */
function bannedPhraseScanner(text, bannedPhrases) {
  const lower = text.toLowerCase();
  const violations = [];
  let rewrittenText = text;

  for (const bp of bannedPhrases) {
    if (!bp.active) continue;

    const phraseLC = bp.phrase.toLowerCase();
    const idx = lower.indexOf(phraseLC);

    if (idx !== -1) {
      violations.push({
        phrase: bp.phrase,
        index: idx,
        category: bp.category,
        replacement: bp.replacement_suggestion || null,
      });

      // Auto-rewrite when a replacement suggestion exists
      if (bp.replacement_suggestion) {
        // Case-insensitive global replace using escaped phrase
        const escapedPhrase = bp.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rewrittenText = rewrittenText.replace(
          new RegExp(escapedPhrase, 'gi'),
          bp.replacement_suggestion
        );
      }
    }
  }

  return { violations, rewrittenText };
}

/**
 * nextStepScanner(text) — VALIDATE-04
 *
 * Checks the last 2 sentences of reply text for a clear next step:
 * - Direct question (contains `?`), OR
 * - Action verb pattern + timeframe pattern both present in the last-2-sentences block
 *
 * Uses lookbehind regex split (requires Node.js >= 10; project requires >= 18).
 *
 * @param {string} text - Reply text to scan
 * @returns {{ hasNextStep: boolean, lastTwoSentences?: string }}
 */
function nextStepScanner(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const last2 = sentences.slice(-2).join(' ');

  // Direct question — most reliable indicator of a next step
  if (/\?/.test(last2)) {
    return { hasNextStep: true, lastTwoSentences: last2 };
  }

  // Action verb + timeframe combination
  const actionPattern =
    /\b(let me know|reply|respond|confirm|schedule|book|send|share|reach out|get back|available|connect|discuss|talk|call)\b/i;
  const timeframePattern =
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|this week|next week|within \d+|by end|eod|asap|soon)\b/i;

  if (actionPattern.test(last2) && timeframePattern.test(last2)) {
    return { hasNextStep: true, lastTwoSentences: last2 };
  }

  return { hasNextStep: false, lastTwoSentences: last2 };
}

/**
 * metricsScanner(text) — QUALITY-04
 *
 * Scans proposal proof section (or any text) for concrete metric patterns:
 * - Percentages: 40%
 * - Multipliers: 3x
 * - Quantity + timeframe: 5 clients, 12 weeks, 3 months, etc.
 *
 * @param {string} text - Text to scan for metrics
 * @returns {{ hasMetrics: boolean }}
 */
function metricsScanner(text) {
  const metricPattern =
    /\b\d+%|\b\d+x\b|\b\d+\s*(?:days?|weeks?|months?|hours?|clients?|projects?|years?)\b/i;
  return { hasMetrics: metricPattern.test(text) };
}

module.exports = {
  proposalGate,
  bannedPhraseScanner,
  nextStepScanner,
  metricsScanner,
  CALL_REDIRECT,
};
