'use strict';

/**
 * promptEnhancements.js -- Prompt Quality Enhancement Utilities
 * Phase 18: Prompt Quality Fixes
 * Requirements: CTA-01, CTA-02, CTA-03, CTA-04, CTA-05, CTA-06
 *
 * Pure CommonJS utility module -- no DB calls, no API calls, no async, no side effects.
 * All functions are synchronous, deterministic, and never throw.
 *
 * Exports: detectPricingLanguage, appendSignatureBlock, formatTimezoneCTA
 */

// ============================================================
// PRICING KEYWORDS -- English + common non-English terms (CTA-05)
// ============================================================
const PRICING_KEYWORDS = [
  // English
  'cost', 'budget', 'pricing', 'price', 'rates', 'rate',
  'how much', 'hourly', 'fixed price', 'quote', 'estimate',
  'fee', 'fees', 'affordable', 'expensive', 'cheap',
  // German
  'kosten',
  // French
  'prix',
  // Spanish
  'presupuesto',
  // Italian
  'prezzo',
  // Portuguese
  'preco',
];

/**
 * detectPricingLanguage(emailText) -- CTA-05
 *
 * Scans the CLIENT'S email body for pricing-related keywords.
 * Used to determine whether to inject cost context into the prompt
 * (NOT for stripping pricing from generated output -- that's validateReply.js).
 *
 * @param {string} emailText - The client's email body text
 * @returns {{ hasPricing: boolean, keywords: string[] }}
 */
function detectPricingLanguage(emailText) {
  if (!emailText || typeof emailText !== 'string' || emailText.trim() === '') {
    return { hasPricing: false, keywords: [] };
  }

  const lower = emailText.toLowerCase();
  const matched = [];

  for (const keyword of PRICING_KEYWORDS) {
    // Multi-word keywords use simple indexOf (word boundary is tricky for phrases)
    if (keyword.includes(' ')) {
      if (lower.includes(keyword)) {
        matched.push(keyword);
      }
    } else {
      // Single-word keywords use word-boundary regex
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(lower)) {
        matched.push(keyword);
      }
    }
  }

  return { hasPricing: matched.length > 0, keywords: matched };
}

// ============================================================
// SIGNATURE BLOCK -- HipHype Tech company signature (CTA-03, CTA-04)
// ============================================================
const SIGNATURE_BLOCK = `Best,
Ashish
Business Development Manager
HipHype Tech
https://hiphype.tech`;

/**
 * appendSignatureBlock(replyText) -- CTA-03, CTA-04
 *
 * Strips any existing trailing "Best,\nAshish" or "Best, Ashish" sign-off
 * (case-insensitive, flexible whitespace) and appends the full HipHype Tech
 * signature block.
 *
 * Operates on clean reply text only -- caller handles block ordering
 * (signature goes after reply body, before any internal analysis blocks).
 *
 * @param {string} replyText - The clean reply text after Claude generates it
 * @returns {string} - Reply text with full signature block appended
 */
function appendSignatureBlock(replyText) {
  if (!replyText || typeof replyText !== 'string') {
    return '';
  }

  let cleaned = replyText;

  // Strip existing trailing sign-off variations:
  // "Best,\nAshish", "Best, Ashish", "Best,\n Ashish", etc.
  // Also handles "Best,\nAshish\nBusiness Development Manager..." (partial old sig)
  cleaned = cleaned.replace(
    /\n*\s*Best[,.]?\s*\n?\s*Ashish(?:\s*\n\s*Business Development Manager[^\n]*)?(?:\s*\n\s*HipHype Tech[^\n]*)?(?:\s*\n\s*https?:\/\/hiphype\.tech)?\s*$/i,
    ''
  );

  // Also strip inline "Best, Ashish" at end (no newline before Ashish)
  cleaned = cleaned.replace(/\n*\s*Best[,.]?\s+Ashish\s*$/i, '');

  // Strip standalone "Ashish" at end (Claude sometimes writes just the name)
  cleaned = cleaned.replace(/\n+\s*Ashish\s*$/i, '');

  // Trim trailing whitespace/newlines
  cleaned = cleaned.trimEnd();

  // Append signature block with proper spacing
  return cleaned + '\n\n' + SIGNATURE_BLOCK;
}

// ============================================================
// TIMEZONE CTA FORMATTING -- (CTA-01, CTA-02)
// ============================================================

/**
 * getNextCallDay(referenceDate) -- Compute the next business day name
 *
 * Given a reference date (when the email will be sent), returns the
 * weekday name of the next business day (Mon-Fri) after that date.
 * This is the day we propose for a call — never Saturday or Sunday.
 *
 * @param {Date|string|null} referenceDate - When the email will be sent (default: today)
 * @returns {string} - Weekday name, e.g., "Monday", "Tuesday"
 */
function getNextCallDay(referenceDate = null) {
  let ref;
  if (referenceDate instanceof Date) {
    ref = new Date(referenceDate);
  } else if (typeof referenceDate === 'string' && referenceDate.trim()) {
    // Handle "YYYY-MM-DD" strings from getNextBusinessDay
    ref = new Date(referenceDate.includes('T') ? referenceDate : referenceDate + 'T12:00:00');
  } else {
    ref = new Date();
  }

  // Move to the next day, then skip weekends
  const callDate = new Date(ref);
  callDate.setDate(callDate.getDate() + 1);
  while (callDate.getDay() === 0 || callDate.getDay() === 6) {
    callDate.setDate(callDate.getDate() + 1);
  }

  return callDate.toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * formatTimezoneCTA(ianaTimezone, referenceDate) -- CTA-01, CTA-02
 *
 * Formats a call-to-action time string using the client's timezone,
 * with intelligent day-of-week awareness.
 *
 * Computes the next business day (Mon-Fri) after the reference date
 * (when the email will be sent) and includes the day name in the CTA.
 *
 * If timezone is valid: returns "Monday at 11:00 AM NZDT (your time)"
 * If timezone is null/undefined/invalid: returns "Monday at 11 AM your time"
 *
 * @param {string|null|undefined} ianaTimezone - IANA timezone string (e.g., "Pacific/Auckland")
 * @param {Date|string|null} referenceDate - When the email will be sent (default: today)
 * @returns {string} - Formatted day + time string for CTA
 */
function formatTimezoneCTA(ianaTimezone, referenceDate = null) {
  const dayName = getNextCallDay(referenceDate);
  const FALLBACK = `${dayName} at 11 AM your time`;

  if (!ianaTimezone || typeof ianaTimezone !== 'string' || ianaTimezone.trim() === '') {
    return FALLBACK;
  }

  try {
    // We just need the timezone abbreviation — the time is always "11:00 AM"
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: ianaTimezone.trim(),
      timeZoneName: 'short',
    });

    const parts = timeFormatter.formatToParts(now);
    const tzAbbr = parts.find(p => p.type === 'timeZoneName');

    if (tzAbbr && tzAbbr.value) {
      return `${dayName} at 11:00 AM ${tzAbbr.value} (your time)`;
    }

    return FALLBACK;
  } catch {
    // Invalid timezone string or any Intl error -- degrade gracefully
    return FALLBACK;
  }
}

module.exports = {
  detectPricingLanguage,
  appendSignatureBlock,
  formatTimezoneCTA,
  getNextCallDay,
};
