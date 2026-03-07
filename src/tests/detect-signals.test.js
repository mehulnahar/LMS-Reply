/**
 * Test Suite: detectSignals — Objection & Scope Signal Detection
 * Phase 14: Objection Handling + Thread Engine
 * Requirements: OBJECTION-01 (detectObjection), OBJECTION-04 (detectAgencySensitivity),
 *               OBJECTION-05 (detectScopeFraming)
 *
 * Pure synchronous functions — no DB, no async, no mocking needed.
 * Uses Jest "unit" project (no setup.js).
 */

'use strict';

const {
  detectObjection,
  detectAgencySensitivity,
  detectScopeFraming,
  detectProfileRequest,
  detectCallDeferral,
  detectRepeatedRequest,
} = require('../utils/detectSignals');

// ============================================================
// detectObjection — OBJECTION-01
// ============================================================
describe('detectObjection', () => {
  describe('PRICING', () => {
    it('detects "how much does this cost" as PRICING', () => {
      expect(detectObjection('how much does this cost')).toBe('PRICING');
    });

    it('detects "what is your rate?" as PRICING', () => {
      expect(detectObjection('what is your rate?')).toBe('PRICING');
    });

    it('detects "too expensive for us" as PRICING', () => {
      expect(detectObjection('too expensive for us')).toBe('PRICING');
    });
  });

  describe('ALREADY_HIRED', () => {
    it('detects "we found someone else already" as ALREADY_HIRED', () => {
      expect(detectObjection('we found someone else already')).toBe('ALREADY_HIRED');
    });

    it('detects "we already hired someone" as ALREADY_HIRED', () => {
      expect(detectObjection('we already hired someone')).toBe('ALREADY_HIRED');
    });
  });

  describe('AGENCY', () => {
    it('detects "no agencies please, individuals only" as AGENCY', () => {
      expect(detectObjection('no agencies please, individuals only')).toBe('AGENCY');
    });
  });

  describe('COMPARISON', () => {
    it('detects "comparing proposals from a few freelancers" as COMPARISON', () => {
      expect(detectObjection('comparing proposals from a few freelancers')).toBe('COMPARISON');
    });

    it('detects "found someone cheaper, sorry" as COMPARISON', () => {
      expect(detectObjection('found someone cheaper, sorry')).toBe('COMPARISON');
    });
  });

  describe('TECHNICAL_Q', () => {
    it('detects "do you use React or Vue for the frontend?" as TECHNICAL_Q', () => {
      expect(detectObjection('do you use React or Vue for the frontend?')).toBe('TECHNICAL_Q');
    });

    it('detects "we use AWS and need PostgreSQL" as TECHNICAL_Q', () => {
      expect(detectObjection('we use AWS and need PostgreSQL')).toBe('TECHNICAL_Q');
    });
  });

  describe('NONE', () => {
    it('returns NONE for neutral positive reply', () => {
      expect(detectObjection('sounds great, let us proceed')).toBe('NONE');
    });
  });

  describe('priority ordering', () => {
    it('ALREADY_HIRED beats PRICING when both keywords present', () => {
      // "already hired" + "how much" → ALREADY_HIRED wins (higher priority)
      expect(detectObjection('we already hired but how much anyway')).toBe('ALREADY_HIRED');
    });

    it('ALREADY_HIRED beats AGENCY when both keywords present', () => {
      // "found someone" (ALREADY_HIRED) + "no agencies" (AGENCY) → ALREADY_HIRED wins
      expect(detectObjection('no agencies, we found someone anyway')).toBe('ALREADY_HIRED');
    });
  });

  describe('edge cases', () => {
    it('returns NONE for empty string', () => {
      expect(detectObjection('')).toBe('NONE');
    });

    it('returns NONE for null', () => {
      expect(detectObjection(null)).toBe('NONE');
    });

    it('returns NONE for undefined', () => {
      expect(detectObjection(undefined)).toBe('NONE');
    });
  });
});

// ============================================================
// detectAgencySensitivity — OBJECTION-04
// ============================================================
describe('detectAgencySensitivity', () => {
  describe('positive matches (returns true)', () => {
    it('detects "Looking for a freelancer only, no agencies" → true', () => {
      expect(detectAgencySensitivity('Looking for a freelancer only, no agencies')).toBe(true);
    });

    it('detects "Prefer solo developer" → true', () => {
      expect(detectAgencySensitivity('Prefer solo developer')).toBe(true);
    });

    it('detects "Not an agency, individual only" → true', () => {
      expect(detectAgencySensitivity('Not an agency, individual only')).toBe(true);
    });
  });

  describe('negative matches (returns false)', () => {
    it('returns false for generic developer wanted posting', () => {
      expect(detectAgencySensitivity('Experienced developer wanted')).toBe(false);
    });

    it('returns false for agency mentioned positively (no restriction keywords)', () => {
      // "Agency experience preferred" — mentions agency but no restriction keywords like
      // "no agencies", "freelancer only", "solo developer", etc.
      expect(detectAgencySensitivity('Agency experience preferred')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty string', () => {
      expect(detectAgencySensitivity('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(detectAgencySensitivity(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(detectAgencySensitivity(undefined)).toBe(false);
    });
  });
});

// ============================================================
// detectScopeFraming — OBJECTION-05
// ============================================================
describe('detectScopeFraming', () => {
  describe('PHASES', () => {
    it('detects "split into 3 phases with milestones" → PHASES', () => {
      expect(detectScopeFraming('split into 3 phases with milestones')).toBe('PHASES');
    });
  });

  describe('HOURS', () => {
    it('detects "need about 20 hours per week" → HOURS', () => {
      expect(detectScopeFraming('need about 20 hours per week')).toBe('HOURS');
    });
  });

  describe('FIXED', () => {
    it('detects "fixed price of $2000 total" → FIXED', () => {
      expect(detectScopeFraming('fixed price of $2000 total')).toBe('FIXED');
    });
  });

  describe('UNKNOWN', () => {
    it('returns UNKNOWN for vague scope description', () => {
      expect(detectScopeFraming('hello I need a website')).toBe('UNKNOWN');
    });
  });

  describe('priority ordering', () => {
    it('PHASES beats HOURS when both keywords present', () => {
      // "phases" (PHASES) + "40 hours" (HOURS) → PHASES wins (higher priority)
      expect(detectScopeFraming('split into phases, roughly 40 hours')).toBe('PHASES');
    });
  });

  describe('edge cases', () => {
    it('returns UNKNOWN for empty string', () => {
      expect(detectScopeFraming('')).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for null', () => {
      expect(detectScopeFraming(null)).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for undefined', () => {
      expect(detectScopeFraming(undefined)).toBe('UNKNOWN');
    });
  });
});

// ============================================================
// detectProfileRequest — PROFILE_REQUEST detection
// ============================================================
describe('detectProfileRequest', () => {
  describe('positive matches (returns true)', () => {
    it('detects "Can you share your Upwork profile?"', () => {
      expect(detectProfileRequest('Can you share your Upwork profile?')).toBe(true);
    });

    it('detects "Send me your portfolio"', () => {
      expect(detectProfileRequest('Send me your portfolio')).toBe(true);
    });

    it('detects "Could you provide your Upwork profile link?"', () => {
      expect(detectProfileRequest('Could you provide your Upwork profile link?')).toBe(true);
    });

    it('detects "I would like to see your profile link"', () => {
      expect(detectProfileRequest('I would like to see your profile link')).toBe(true);
    });

    it('detects "Can you send me your upwork page?"', () => {
      expect(detectProfileRequest('Can you send me your upwork page?')).toBe(true);
    });

    it('detects "provide your upwork so we can check"', () => {
      expect(detectProfileRequest('provide your upwork so we can check')).toBe(true);
    });

    it('detects "share your teams upwork profile with us"', () => {
      expect(detectProfileRequest("share your teams upwork profile with us")).toBe(true);
    });

    it('detects "link to your work samples"', () => {
      expect(detectProfileRequest('Can you share a link to your work?')).toBe(true);
    });
  });

  describe('negative matches (returns false)', () => {
    it('returns false for generic question about experience', () => {
      expect(detectProfileRequest('What is your experience with React?')).toBe(false);
    });

    it('returns false for "how much do you charge"', () => {
      expect(detectProfileRequest('how much do you charge')).toBe(false);
    });

    it('returns false for "sounds great, let us proceed"', () => {
      expect(detectProfileRequest('sounds great, let us proceed')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty string', () => {
      expect(detectProfileRequest('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(detectProfileRequest(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(detectProfileRequest(undefined)).toBe(false);
    });
  });
});

// ============================================================
// detectCallDeferral — CALL_DEFERRAL detection
// ============================================================
describe('detectCallDeferral', () => {
  describe('positive matches (returns true)', () => {
    it('detects "I\'ll get back to you on the meeting"', () => {
      expect(detectCallDeferral("I'll get back to you on the meeting")).toBe(true);
    });

    it('detects "I\'ll let you know about the call"', () => {
      expect(detectCallDeferral("I'll let you know about the call")).toBe(true);
    });

    it('detects "will confirm the meeting time later"', () => {
      expect(detectCallDeferral('will confirm the meeting time later')).toBe(true);
    });

    it('detects "not ready for a call right now"', () => {
      expect(detectCallDeferral('not ready for a call right now')).toBe(true);
    });

    it('detects "will revert on the meeting"', () => {
      expect(detectCallDeferral('will revert on the meeting')).toBe(true);
    });

    it('detects "I will get back to you on that"', () => {
      expect(detectCallDeferral('I will get back to you on that')).toBe(true);
    });

    it('detects "Ill let you know when we can schedule"', () => {
      expect(detectCallDeferral("Ill let you know when we can schedule")).toBe(true);
    });

    it('detects "let me check my calendar and get back about the call"', () => {
      expect(detectCallDeferral('let me check my calendar and get back about the call')).toBe(true);
    });
  });

  describe('negative matches (returns false)', () => {
    it('returns false for "yes, Monday works for a call"', () => {
      expect(detectCallDeferral('yes, Monday works for a call')).toBe(false);
    });

    it('returns false for "let\'s schedule the call for Tuesday"', () => {
      expect(detectCallDeferral("let's schedule the call for Tuesday")).toBe(false);
    });

    it('returns false for "thanks, sounds good"', () => {
      expect(detectCallDeferral('thanks, sounds good')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty string', () => {
      expect(detectCallDeferral('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(detectCallDeferral(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(detectCallDeferral(undefined)).toBe(false);
    });
  });
});

// ============================================================
// detectRepeatedRequest — REPEATED_REQUEST detection
// ============================================================
describe('detectRepeatedRequest', () => {
  describe('firmness markers (prong 1 — no thread needed)', () => {
    it('detects "as I mentioned earlier" as repeated request', () => {
      expect(detectRepeatedRequest('as I mentioned earlier, what is your rate?')).toBe(true);
    });

    it('detects "I asked earlier" as repeated request', () => {
      expect(detectRepeatedRequest('I asked earlier about the timeline')).toBe(true);
    });

    it('detects "still waiting for your response"', () => {
      expect(detectRepeatedRequest('still waiting for your response on the quote')).toBe(true);
    });

    it('detects "could you please provide your profile"', () => {
      expect(detectRepeatedRequest('could you please provide your Upwork profile?')).toBe(true);
    });

    it('detects "you didn\'t answer my question"', () => {
      expect(detectRepeatedRequest("you didn't answer my question about pricing")).toBe(true);
    });

    it('detects "once again, what is your availability?"', () => {
      expect(detectRepeatedRequest('once again, what is your availability?')).toBe(true);
    });

    it('detects "I\'ve asked this before"', () => {
      expect(detectRepeatedRequest("I've asked this before — can you provide references?")).toBe(true);
    });
  });

  describe('content overlap (prong 2 — needs thread history)', () => {
    it('detects repeated question across thread messages', () => {
      const currentEmail = 'Can you provide your Upwork profile link?';
      const threadEmails = [
        { body_text: 'Thanks for reaching out. Can you provide your Upwork profile link?' },
      ];
      expect(detectRepeatedRequest(currentEmail, threadEmails)).toBe(true);
    });

    it('detects paraphrased repeat via snippet fallback', () => {
      const currentEmail = 'What is your Upwork profile?';
      const threadEmails = [
        { snippet: 'What is your Upwork profile?' },
      ];
      expect(detectRepeatedRequest(currentEmail, threadEmails)).toBe(true);
    });

    it('returns false when questions are different', () => {
      const currentEmail = 'What is your hourly rate?';
      const threadEmails = [
        { body_text: 'Can you provide your Upwork profile link?' },
      ];
      expect(detectRepeatedRequest(currentEmail, threadEmails)).toBe(false);
    });

    it('returns false when no prior thread emails exist', () => {
      expect(detectRepeatedRequest('What is your rate?', [])).toBe(false);
    });
  });

  describe('negative matches (returns false)', () => {
    it('returns false for first-time question with no markers', () => {
      expect(detectRepeatedRequest('What stack do you use?')).toBe(false);
    });

    it('returns false for "sounds great, let us proceed"', () => {
      expect(detectRepeatedRequest('sounds great, let us proceed')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty string', () => {
      expect(detectRepeatedRequest('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(detectRepeatedRequest(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(detectRepeatedRequest(undefined)).toBe(false);
    });
  });
});
