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
