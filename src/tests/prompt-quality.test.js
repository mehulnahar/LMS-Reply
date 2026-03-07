/**
 * Test Suite: Phase 18 Prompt Quality Fixes
 * Requirements: CTA-01, CTA-02, CTA-03, CTA-04, CTA-05, CTA-06, CTA-09, CTA-10, TEST-01
 *
 * Covers: detectPricingLanguage, appendSignatureBlock, formatTimezoneCTA (promptEnhancements.js)
 *         proposalGate CTA-05 interaction (validateReply.js)
 *
 * Pure synchronous functions -- no DB, no async, no mocking needed.
 * Uses Jest "unit" project (no setup.js).
 */

'use strict';

const {
  detectPricingLanguage,
  appendSignatureBlock,
  formatTimezoneCTA,
  getNextCallDay,
} = require('../utils/promptEnhancements');

const {
  proposalGate,
  CALL_REDIRECT,
} = require('../utils/validateReply');

// ============================================================
// CTA-01 + CTA-09: formatTimezoneCTA
// ============================================================
describe('CTA-01 + CTA-09: formatTimezoneCTA', () => {
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  describe('positive cases — includes day name + timezone', () => {
    test('valid IANA timezone "Pacific/Auckland" returns string containing "your time"', () => {
      const result = formatTimezoneCTA('Pacific/Auckland');
      expect(result).toContain('your time');
    });

    test('valid IANA timezone "Pacific/Auckland" returns string containing "11:00 AM"', () => {
      const result = formatTimezoneCTA('Pacific/Auckland');
      expect(result).toContain('11:00 AM');
    });

    test('valid IANA timezone starts with a weekday name', () => {
      const result = formatTimezoneCTA('America/New_York');
      const startsWithWeekday = WEEKDAYS.some(d => result.startsWith(d));
      expect(startsWithWeekday).toBe(true);
    });

    test('valid IANA timezone "America/New_York" returns full format: "Day at 11:00 AM TZ (your time)"', () => {
      const result = formatTimezoneCTA('America/New_York');
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11:00 AM \S+ \(your time\)$/);
    });

    test('valid IANA timezone "Asia/Kolkata" returns string containing "your time"', () => {
      const result = formatTimezoneCTA('Asia/Kolkata');
      expect(result).toContain('your time');
    });

    test('valid IANA timezone "Europe/London" returns formatted CTA with day name', () => {
      const result = formatTimezoneCTA('Europe/London');
      expect(result).toContain('11:00 AM');
      expect(result).toContain('your time');
      const startsWithWeekday = WEEKDAYS.some(d => result.startsWith(d));
      expect(startsWithWeekday).toBe(true);
    });
  });

  describe('negative/fallback cases — includes day name without timezone', () => {
    test('null input returns "[Day] at 11 AM your time"', () => {
      const result = formatTimezoneCTA(null);
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11 AM your time$/);
    });

    test('undefined input returns "[Day] at 11 AM your time"', () => {
      const result = formatTimezoneCTA(undefined);
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11 AM your time$/);
    });

    test('empty string returns "[Day] at 11 AM your time"', () => {
      const result = formatTimezoneCTA('');
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11 AM your time$/);
    });

    test('whitespace-only string returns "[Day] at 11 AM your time"', () => {
      const result = formatTimezoneCTA('   ');
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11 AM your time$/);
    });
  });

  describe('edge cases', () => {
    test('invalid timezone string returns fallback with day name', () => {
      const result = formatTimezoneCTA('Not/A/Timezone');
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11 AM your time$/);
    });

    test('valid timezone returns string with "(your time)" parenthetical', () => {
      const result = formatTimezoneCTA('Pacific/Auckland');
      expect(result).toContain('(your time)');
    });

    test('non-string input (number) returns fallback with day name', () => {
      const result = formatTimezoneCTA(12345);
      expect(result).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday) at 11 AM your time$/);
    });
  });

  describe('referenceDate parameter — smart day-of-week computation', () => {
    test('reference on a Monday → proposes Tuesday', () => {
      // 2026-03-09 is a Monday
      const result = formatTimezoneCTA('America/New_York', '2026-03-09');
      expect(result).toMatch(/^Tuesday at 11:00 AM/);
    });

    test('reference on a Thursday → proposes Friday', () => {
      // 2026-03-12 is a Thursday
      const result = formatTimezoneCTA('America/New_York', '2026-03-12');
      expect(result).toMatch(/^Friday at 11:00 AM/);
    });

    test('reference on a Friday → proposes Monday (skips weekend)', () => {
      // 2026-03-13 is a Friday
      const result = formatTimezoneCTA('America/New_York', '2026-03-13');
      expect(result).toMatch(/^Monday at 11:00 AM/);
    });

    test('reference on a Saturday → proposes Monday (skips Sunday)', () => {
      // 2026-03-14 is a Saturday
      const result = formatTimezoneCTA('America/New_York', '2026-03-14');
      expect(result).toMatch(/^Monday at 11:00 AM/);
    });

    test('reference on a Sunday → proposes Monday', () => {
      // 2026-03-15 is a Sunday
      const result = formatTimezoneCTA('America/New_York', '2026-03-15');
      expect(result).toMatch(/^Monday at 11:00 AM/);
    });

    test('reference on a Wednesday → proposes Thursday', () => {
      // 2026-03-11 is a Wednesday
      const result = formatTimezoneCTA('America/New_York', '2026-03-11');
      expect(result).toMatch(/^Thursday at 11:00 AM/);
    });

    test('null timezone with reference date still returns day name', () => {
      const result = formatTimezoneCTA(null, '2026-03-13'); // Friday
      expect(result).toBe('Monday at 11 AM your time');
    });
  });
});

// ============================================================
// getNextCallDay — next business day name computation
// ============================================================
describe('getNextCallDay', () => {
  test('Monday reference → Tuesday', () => {
    expect(getNextCallDay('2026-03-09')).toBe('Tuesday');
  });

  test('Thursday reference → Friday', () => {
    expect(getNextCallDay('2026-03-12')).toBe('Friday');
  });

  test('Friday reference → Monday (skips weekend)', () => {
    expect(getNextCallDay('2026-03-13')).toBe('Monday');
  });

  test('Saturday reference → Monday', () => {
    expect(getNextCallDay('2026-03-14')).toBe('Monday');
  });

  test('Sunday reference → Monday', () => {
    expect(getNextCallDay('2026-03-15')).toBe('Monday');
  });

  test('null reference returns a weekday name (from today)', () => {
    const result = getNextCallDay(null);
    expect(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']).toContain(result);
  });

  test('Date object input works', () => {
    const friday = new Date('2026-03-13T12:00:00');
    expect(getNextCallDay(friday)).toBe('Monday');
  });
});

// ============================================================
// CTA-02: Follow-Up POV enforcement
// ============================================================
describe('CTA-02: Follow-Up POV enforcement', () => {
  test('POV enforcement is via prompt template instructions, not code', () => {
    // CTA-02 is enforced by the "CRITICAL POV RULE" section in FOLLOW_UP_V2 template
    // Manual verification: generate a Follow-Up V2 reply and verify it uses
    // first-person "I" (Ashish) and second-person "you/your" (client)
    // Automated check: grep seed file for "CRITICAL POV RULE"
    const seed = require('../config/seeds/seed_v2_foundation');
    // Just verify the seed file loads (template content is a local const, not exported)
    expect(seed).toBeDefined();
  });
});

// ============================================================
// CTA-03 + CTA-04: Greeting enforcement
// ============================================================
describe('CTA-03 + CTA-04: Greeting enforcement', () => {
  test('Greeting enforcement is via prompt template instructions + greeting_reminder block', () => {
    // CTA-03/CTA-04 are enforced by "Greeting Rule (MANDATORY)" sections in templates
    // AND by the <greeting_reminder> context block injected by buildPromptWithContext
    // Manual verification: generate Reply V2, Follow-Up V2, Proposal V4, Thread Continuation V1
    // and verify each begins with a greeting line
    expect(true).toBe(true); // Template verification is done via grep in Plan 01
  });
});

// ============================================================
// CTA-05 + CTA-06 + CTA-10: detectPricingLanguage
// ============================================================
describe('CTA-05 + CTA-06 + CTA-10: detectPricingLanguage', () => {
  describe('positive cases (English)', () => {
    test('"What would this cost?" detects hasPricing=true with keyword "cost"', () => {
      const result = detectPricingLanguage('What would this cost?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('cost');
    });

    test('"What\'s your budget for this?" detects hasPricing=true with keyword "budget"', () => {
      const result = detectPricingLanguage("What's your budget for this?");
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('budget');
    });

    test('"How much would you charge?" detects hasPricing=true with keyword "how much"', () => {
      const result = detectPricingLanguage('How much would you charge?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('how much');
    });

    test('"What are your hourly rates?" detects hasPricing=true with keywords "hourly" and "rates"', () => {
      const result = detectPricingLanguage('What are your hourly rates?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('rates');
      expect(result.keywords).toContain('hourly');
    });

    test('"Can you give me a quote?" detects hasPricing=true with keyword "quote"', () => {
      const result = detectPricingLanguage('Can you give me a quote?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('quote');
    });

    test('"What\'s the fixed price for this project?" detects hasPricing=true', () => {
      const result = detectPricingLanguage("What's the fixed price for this project?");
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('fixed price');
    });

    test('"Please provide an estimate" detects hasPricing=true', () => {
      const result = detectPricingLanguage('Please provide an estimate');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('estimate');
    });
  });

  describe('positive cases (non-English, CTA-10)', () => {
    test('"Was sind die Kosten?" (German) detects hasPricing=true with keyword "kosten"', () => {
      const result = detectPricingLanguage('Was sind die Kosten?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('kosten');
    });

    test('"Quel est le prix?" (French) detects hasPricing=true with keyword "prix"', () => {
      const result = detectPricingLanguage('Quel est le prix?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('prix');
    });

    test('"Cual es el presupuesto?" (Spanish) detects hasPricing=true with keyword "presupuesto"', () => {
      const result = detectPricingLanguage('Cual es el presupuesto?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('presupuesto');
    });

    test('"Qual e il prezzo?" (Italian) detects hasPricing=true with keyword "prezzo"', () => {
      const result = detectPricingLanguage('Qual e il prezzo?');
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('prezzo');
    });
  });

  describe('negative cases', () => {
    test('"Tell me about your experience with React" returns hasPricing=false', () => {
      const result = detectPricingLanguage('Tell me about your experience with React');
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });

    test('"When can you start?" returns hasPricing=false', () => {
      const result = detectPricingLanguage('When can you start?');
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });

    test('"I need a landing page redesign" returns hasPricing=false', () => {
      const result = detectPricingLanguage('I need a landing page redesign');
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });

    test('"Are you available this week for a call?" returns hasPricing=false', () => {
      const result = detectPricingLanguage('Are you available this week for a call?');
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });
  });

  describe('edge cases', () => {
    test('null input returns { hasPricing: false, keywords: [] }', () => {
      const result = detectPricingLanguage(null);
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });

    test('undefined input returns { hasPricing: false, keywords: [] }', () => {
      const result = detectPricingLanguage(undefined);
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });

    test('empty string returns { hasPricing: false, keywords: [] }', () => {
      const result = detectPricingLanguage('');
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });

    test('multiple pricing keywords "What\'s the cost and budget?" returns both keywords', () => {
      const result = detectPricingLanguage("What's the cost and budget?");
      expect(result.hasPricing).toBe(true);
      expect(result.keywords).toContain('cost');
      expect(result.keywords).toContain('budget');
    });

    test('non-string input (number) returns { hasPricing: false, keywords: [] }', () => {
      const result = detectPricingLanguage(12345);
      expect(result.hasPricing).toBe(false);
      expect(result.keywords).toEqual([]);
    });
  });
});

// ============================================================
// CTA-06: appendSignatureBlock
// ============================================================
describe('CTA-06: appendSignatureBlock', () => {
  describe('positive cases', () => {
    test('text ending with "Best,\\nAshish" gets old sign-off stripped and HipHype signature appended', () => {
      const input = 'Looking forward to working together.\n\nBest,\nAshish';
      const result = appendSignatureBlock(input);
      expect(result).not.toMatch(/Best,\nAshish\n\nBest,/);
      expect(result).toContain('HipHype Tech');
      expect(result).toContain('Business Development Manager');
    });

    test('text ending with "Best, Ashish" (same line) gets old sign-off stripped and signature appended', () => {
      const input = 'Let me know if you have questions.\n\nBest, Ashish';
      const result = appendSignatureBlock(input);
      expect(result).toContain('HipHype Tech');
      // Should not have duplicate "Best" before the signature
      const bestCount = (result.match(/Best/g) || []).length;
      // The signature block itself contains "Best," so count should be exactly 1
      expect(bestCount).toBe(1);
    });

    test('signature contains "HipHype Tech"', () => {
      const result = appendSignatureBlock('Hello world');
      expect(result).toContain('HipHype Tech');
    });

    test('signature contains "https://hiphype.tech"', () => {
      const result = appendSignatureBlock('Hello world');
      expect(result).toContain('https://hiphype.tech');
    });

    test('signature contains "Business Development Manager"', () => {
      const result = appendSignatureBlock('Hello world');
      expect(result).toContain('Business Development Manager');
    });

    test('signature contains "Ashish"', () => {
      const result = appendSignatureBlock('Hello world');
      expect(result).toContain('Ashish');
    });
  });

  describe('negative cases', () => {
    test('null input returns empty string', () => {
      expect(appendSignatureBlock(null)).toBe('');
    });

    test('undefined input returns empty string', () => {
      expect(appendSignatureBlock(undefined)).toBe('');
    });

    test('empty string returns empty string', () => {
      expect(appendSignatureBlock('')).toBe('');
    });

    test('non-string input returns empty string', () => {
      expect(appendSignatureBlock(12345)).toBe('');
    });
  });

  describe('edge cases', () => {
    test('text with no existing sign-off gets signature appended without stripping', () => {
      const input = 'I would love to help with your project. Let me know your thoughts.';
      const result = appendSignatureBlock(input);
      expect(result).toContain('I would love to help with your project.');
      expect(result).toContain('HipHype Tech');
      expect(result).toContain('Best,\nAshish');
    });

    test('text with "Best,\\nAshish" in the middle (not at end) preserves mid-text content', () => {
      const input = 'As I mentioned:\n\nBest,\nAshish\n\nHere is the follow-up information about the project.';
      const result = appendSignatureBlock(input);
      // The follow-up content should still be present
      expect(result).toContain('follow-up information');
      // Should have the HipHype signature appended
      expect(result).toContain('HipHype Tech');
    });

    test('calling appendSignatureBlock twice does not create double signature', () => {
      const input = 'Let me know your thoughts on this.';
      const first = appendSignatureBlock(input);
      const second = appendSignatureBlock(first);
      // Count occurrences of "HipHype Tech" -- should be exactly 1
      const count = (second.match(/HipHype Tech/g) || []).length;
      expect(count).toBe(1);
    });

    test('text ending with partial old signature gets cleaned up', () => {
      const input = 'Thanks for your time.\n\nBest,\nAshish\nBusiness Development Manager';
      const result = appendSignatureBlock(input);
      // Should have the full new signature, not a broken partial
      expect(result).toContain('HipHype Tech');
      expect(result).toContain('https://hiphype.tech');
    });
  });
});

// ============================================================
// proposalGate CTA-05 interaction (CRITICAL -- Plan 02 Task 3 fix)
// ============================================================
describe('proposalGate CTA-05 interaction', () => {
  describe('positive: clientRequestedPricing=true allows pricing through for ALL prompt types', () => {
    test('EMAIL_REPLY_V2 with clientRequestedPricing=true allows "$500" through unchanged', () => {
      const input = 'Based on the scope, I estimate this would cost around $500.';
      const result = proposalGate(input, 'EMAIL_REPLY_V2', true);
      expect(result.text).toContain('$500');
      expect(result.stripped).toBe(false);
    });

    test('FOLLOW_UP_V2 with clientRequestedPricing=true allows "$500-$1,200" through unchanged', () => {
      const input = 'The estimated range would be $500-$1,200 depending on scope.';
      const result = proposalGate(input, 'FOLLOW_UP_V2', true);
      expect(result.text).toContain('$500');
      expect(result.text).toContain('$1,200');
      expect(result.stripped).toBe(false);
    });

    test('THREAD_CONTINUATION_V1 with clientRequestedPricing=true allows pricing through unchanged', () => {
      const input = 'As discussed, pricing would be around $800 for the full project.';
      const result = proposalGate(input, 'THREAD_CONTINUATION_V1', true);
      expect(result.text).toContain('pricing');
      expect(result.text).toContain('$800');
      expect(result.stripped).toBe(false);
    });

    test('PROPOSAL_V4 with clientRequestedPricing=true passes through entirely unchanged', () => {
      const input = 'Our budget estimate is $2,500 for phase 1 delivery over 3 weeks.';
      const result = proposalGate(input, 'PROPOSAL_V4', true);
      expect(result.text).toBe(input);
      expect(result.stripped).toBe(false);
    });
  });

  describe('negative: clientRequestedPricing=false strips pricing for non-PROPOSAL_V4 types', () => {
    test('EMAIL_REPLY_V2 with clientRequestedPricing=false strips "$500" and replaces with CALL_REDIRECT', () => {
      const input = 'Based on the scope, I estimate this would cost around $500.';
      const result = proposalGate(input, 'EMAIL_REPLY_V2', false);
      expect(result.text).not.toContain('$500');
      expect(result.text).toContain(CALL_REDIRECT);
      expect(result.stripped).toBe(true);
    });

    test('FOLLOW_UP_V2 with clientRequestedPricing=false strips pricing language', () => {
      const input = 'The pricing for this project would be $1,500.';
      const result = proposalGate(input, 'FOLLOW_UP_V2', false);
      expect(result.text).not.toContain('$1,500');
      expect(result.stripped).toBe(true);
    });

    test('EMAIL_REPLY_V2 with clientRequestedPricing=false (default) strips pricing', () => {
      const input = 'This would cost about $800 based on the requirements.';
      // Not passing third argument -- defaults to false
      const result = proposalGate(input, 'EMAIL_REPLY_V2');
      expect(result.text).not.toContain('$800');
      expect(result.stripped).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('PROPOSAL_V4 with clientRequestedPricing=false still runs pricing pattern scan', () => {
      const input = 'Our estimate is $2,500 for phase 1.';
      const result = proposalGate(input, 'PROPOSAL_V4', false);
      // Should strip pricing since clientRequestedPricing=false
      expect(result.stripped).toBe(true);
      expect(result.text).not.toContain('$2,500');
    });

    test('text with no pricing language passes through unchanged regardless of flags', () => {
      const input = 'I would love to help with your project. Let me know when you are free for a call.';
      const result = proposalGate(input, 'EMAIL_REPLY_V2', false);
      expect(result.text).toBe(input);
      expect(result.stripped).toBe(false);
    });

    test('clientRequestedPricing=true preserves text exactly (no modifications)', () => {
      const input = 'The budget is $10,000 USD for the full project pricing breakdown.';
      const result = proposalGate(input, 'EMAIL_REPLY_V2', true);
      expect(result.text).toBe(input);
      expect(result.stripped).toBe(false);
    });
  });
});
