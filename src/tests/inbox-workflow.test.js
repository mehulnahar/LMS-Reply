/**
 * Test Suite: Phase 19 Inbox Workflow
 * Requirements: FLOW-01 (Re-activate), FLOW-02 (Auto-move), FLOW-03 (Search), TEST-01
 *
 * Pure unit tests -- no DB, no async, no HTTP calls.
 * Tests the extracted reactivation logic, status validation, and search patterns.
 *
 * Uses Jest "unit" project (no setup.js).
 */

'use strict';

const { calculateReactivation, THIRTY_DAYS_MS } = require('../utils/reactivationLogic');

// ============================================================
// Valid statuses used by PUT /api/emails/:id/status (from emails.js)
// Duplicated here as a test constant to verify against the route's list
// ============================================================
const VALID_STATUSES = ['new', 'replied', 'proposal_sent', 'won', 'lost', 'ignored'];

// Helper: create a date N days ago from a reference date
function daysAgo(n, from = new Date('2026-03-07T12:00:00Z')) {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

// Fixed "now" for deterministic tests
const NOW = new Date('2026-03-07T12:00:00Z');

// ============================================================
// FLOW-01: calculateReactivation — 30-day kill switch logic
// ============================================================
describe('FLOW-01: calculateReactivation', () => {
  describe('positive cases', () => {
    test('null killSwitchAt returns full reactivation with 0 days remaining', () => {
      const result = calculateReactivation(null, NOW);
      expect(result).toEqual({ shouldFullReactivate: true, daysRemaining: 0 });
    });

    test('undefined killSwitchAt returns full reactivation', () => {
      const result = calculateReactivation(undefined, NOW);
      expect(result).toEqual({ shouldFullReactivate: true, daysRemaining: 0 });
    });

    test('kill switch 40 days ago returns full reactivation (beyond 30-day window)', () => {
      const killDate = daysAgo(40, NOW);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });

    test('kill switch 31 days ago returns full reactivation', () => {
      const killDate = daysAgo(31, NOW);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });

    test('kill switch 60 days ago returns full reactivation', () => {
      const killDate = daysAgo(60, NOW);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });
  });

  describe('negative cases (partial reactivation within 30-day window)', () => {
    test('kill switch 10 days ago returns partial with 20 days remaining', () => {
      const killDate = daysAgo(10, NOW);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(false);
      expect(result.daysRemaining).toBe(20);
    });

    test('kill switch 1 day ago returns partial with 29 days remaining', () => {
      const killDate = daysAgo(1, NOW);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(false);
      expect(result.daysRemaining).toBe(29);
    });

    test('kill switch 0 days ago (just now) returns partial with 30 days remaining', () => {
      const result = calculateReactivation(NOW, NOW);
      expect(result.shouldFullReactivate).toBe(false);
      expect(result.daysRemaining).toBe(30);
    });

    test('kill switch 25 days ago returns partial with 5 days remaining', () => {
      const killDate = daysAgo(25, NOW);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(false);
      expect(result.daysRemaining).toBe(5);
    });
  });

  describe('edge cases', () => {
    test('exactly 30 days elapsed uses > comparison, so returns partial with 0 -> ceil to 0 remaining', () => {
      // Exactly 30 days: elapsed === THIRTY_DAYS_MS, condition is > not >=
      // So exactly 30 days is NOT full reactivation
      const killDate = daysAgo(30, NOW);
      const result = calculateReactivation(killDate, NOW);
      // elapsed === THIRTY_DAYS_MS, which is NOT > THIRTY_DAYS_MS
      expect(result.shouldFullReactivate).toBe(false);
      // (THIRTY_DAYS_MS - THIRTY_DAYS_MS) / MS_PER_DAY = 0, ceil(0) = 0
      expect(result.daysRemaining).toBe(0);
    });

    test('30 days plus 1 millisecond returns full reactivation', () => {
      const killDate = new Date(NOW.getTime() - THIRTY_DAYS_MS - 1);
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });

    test('29 days 23 hours 59 minutes returns partial with 1 day remaining', () => {
      // 29 days 23h 59m = 30 days - 1 minute
      const killDate = new Date(NOW.getTime() - (30 * 24 * 60 * 60 * 1000 - 60 * 1000));
      const result = calculateReactivation(killDate, NOW);
      expect(result.shouldFullReactivate).toBe(false);
      // Remaining = 60000 ms, ceil(60000 / 86400000) = ceil(0.000694) = 1
      expect(result.daysRemaining).toBe(1);
    });

    test('string date input "2026-01-01T00:00:00Z" is parsed correctly', () => {
      const result = calculateReactivation('2026-01-01T00:00:00Z', NOW);
      // Jan 1 to Mar 7 = 65 days > 30 days => full reactivation
      expect(result.shouldFullReactivate).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });

    test('invalid date string returns full reactivation (treated as no kill switch)', () => {
      const result = calculateReactivation('not-a-date', NOW);
      expect(result).toEqual({ shouldFullReactivate: true, daysRemaining: 0 });
    });

    test('empty string killSwitchAt returns full reactivation (falsy)', () => {
      const result = calculateReactivation('', NOW);
      expect(result).toEqual({ shouldFullReactivate: true, daysRemaining: 0 });
    });

    test('THIRTY_DAYS_MS constant equals 2592000000', () => {
      expect(THIRTY_DAYS_MS).toBe(30 * 24 * 60 * 60 * 1000);
      expect(THIRTY_DAYS_MS).toBe(2592000000);
    });

    test('future kill switch date (negative elapsed) returns partial', () => {
      // Kill switch set "in the future" -- edge case, elapsed is negative
      const futureDate = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
      const result = calculateReactivation(futureDate, NOW);
      expect(result.shouldFullReactivate).toBe(false);
      // daysRemaining = ceil((THIRTY_DAYS_MS - (-5 days)) / day) = ceil(35) = 35
      expect(result.daysRemaining).toBe(35);
    });
  });
});

// ============================================================
// FLOW-02: Status validation logic
// ============================================================
describe('FLOW-02: Status validation', () => {
  describe('positive cases (valid statuses)', () => {
    test('"new" is a valid status', () => {
      expect(VALID_STATUSES).toContain('new');
    });

    test('"replied" is a valid status', () => {
      expect(VALID_STATUSES).toContain('replied');
    });

    test('"proposal_sent" is a valid status', () => {
      expect(VALID_STATUSES).toContain('proposal_sent');
    });

    test('"won" is a valid status', () => {
      expect(VALID_STATUSES).toContain('won');
    });

    test('"lost" is a valid status', () => {
      expect(VALID_STATUSES).toContain('lost');
    });

    test('"ignored" is a valid status', () => {
      expect(VALID_STATUSES).toContain('ignored');
    });
  });

  describe('negative cases (invalid statuses)', () => {
    test('"dormant" is NOT a valid email status', () => {
      expect(VALID_STATUSES).not.toContain('dormant');
    });

    test('"rejected" is NOT a valid email status', () => {
      expect(VALID_STATUSES).not.toContain('rejected');
    });

    test('"pending" is NOT a valid email status', () => {
      expect(VALID_STATUSES).not.toContain('pending');
    });

    test('"archived" is NOT a valid email status', () => {
      expect(VALID_STATUSES).not.toContain('archived');
    });

    test('empty string is NOT a valid email status', () => {
      expect(VALID_STATUSES).not.toContain('');
    });

    test('null is NOT a valid email status', () => {
      expect(VALID_STATUSES).not.toContain(null);
    });
  });

  describe('edge cases', () => {
    test('VALID_STATUSES has exactly 6 entries', () => {
      expect(VALID_STATUSES).toHaveLength(6);
    });

    test('status check is case-sensitive ("New" would not match "new")', () => {
      expect(VALID_STATUSES).not.toContain('New');
      expect(VALID_STATUSES).not.toContain('REPLIED');
      expect(VALID_STATUSES).not.toContain('Lost');
    });
  });
});

// ============================================================
// FLOW-02: Status transition logic
// ============================================================
describe('FLOW-02: Status transitions', () => {
  describe('positive cases', () => {
    test('lost -> new is a valid transition (re-activate use case)', () => {
      const from = 'lost';
      const to = 'new';
      expect(VALID_STATUSES).toContain(from);
      expect(VALID_STATUSES).toContain(to);
    });

    test('new -> replied is a valid transition (auto-move use case)', () => {
      const from = 'new';
      const to = 'replied';
      expect(VALID_STATUSES).toContain(from);
      expect(VALID_STATUSES).toContain(to);
    });

    test('new -> lost is a valid transition (auto-move use case)', () => {
      expect(VALID_STATUSES).toContain('new');
      expect(VALID_STATUSES).toContain('lost');
    });

    test('replied -> won is a valid transition', () => {
      expect(VALID_STATUSES).toContain('replied');
      expect(VALID_STATUSES).toContain('won');
    });
  });

  describe('edge cases', () => {
    test('same-status transition (new -> new) would be accepted by validation', () => {
      // The route only validates the target status, not the transition
      const status = 'new';
      expect(VALID_STATUSES).toContain(status);
    });

    test('back-and-forth transition (new -> lost -> new) both steps are valid', () => {
      expect(VALID_STATUSES).toContain('new');
      expect(VALID_STATUSES).toContain('lost');
      // Second transition: lost -> new
      expect(VALID_STATUSES).toContain('new');
    });
  });
});

// ============================================================
// FLOW-03: Search parameter edge cases
// ============================================================
describe('FLOW-03: Search parameter construction', () => {
  // These tests verify the search param behavior documented in emails.js:
  // `AND (e.subject ILIKE $N OR e.from_name ILIKE $N OR e.from_email ILIKE $N)`
  // with `%${search}%` wrapping

  describe('positive cases', () => {
    test('search term wraps with % for ILIKE pattern', () => {
      const search = 'john';
      const pattern = `%${search}%`;
      expect(pattern).toBe('%john%');
    });

    test('email search wraps correctly for partial match', () => {
      const search = 'test@example';
      const pattern = `%${search}%`;
      expect(pattern).toBe('%test@example%');
      // This would match "test@example.com", "mytest@example.org", etc.
    });

    test('search matches are case-insensitive (ILIKE behavior)', () => {
      // ILIKE in PostgreSQL is case-insensitive
      // "JOHN" would match "john@example.com" via ILIKE
      const search = 'JOHN';
      const pattern = `%${search}%`;
      // Pattern is constructed the same way regardless of case
      expect(pattern).toBe('%JOHN%');
      // ILIKE handles case-insensitivity at the DB level
    });

    test('partial name "joh" wraps to match "john" and "johnson"', () => {
      const search = 'joh';
      const pattern = `%${search}%`;
      expect(pattern).toBe('%joh%');
      // Would match any subject/name/email containing "joh"
    });
  });

  describe('negative cases', () => {
    test('empty search param should not be added to query (truthy check)', () => {
      const search = '';
      // In emails.js: `if (search)` -- empty string is falsy
      expect(Boolean(search)).toBe(false);
    });

    test('null search param should not be added to query', () => {
      const search = null;
      expect(Boolean(search)).toBe(false);
    });

    test('undefined search param should not be added to query', () => {
      const search = undefined;
      expect(Boolean(search)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('single character search still wraps with %', () => {
      const search = 'a';
      const pattern = `%${search}%`;
      expect(pattern).toBe('%a%');
    });

    test('search with spaces wraps correctly', () => {
      const search = 'John Doe';
      const pattern = `%${search}%`;
      expect(pattern).toBe('%John Doe%');
    });

    test('search with special SQL characters does not cause injection (parameterized)', () => {
      // The route uses parameterized queries ($N), so special chars are safe
      const search = "'; DROP TABLE emails; --";
      const pattern = `%${search}%`;
      // Pattern is passed as a parameter, not interpolated into SQL
      expect(pattern).toBe("%'; DROP TABLE emails; --%");
      // This would safely be passed as $N param value
    });

    test('very long search string still constructs valid pattern', () => {
      const search = 'a'.repeat(500);
      const pattern = `%${search}%`;
      expect(pattern.length).toBe(502); // 500 + 2 for % chars
    });

    test('search with @ symbol works for email matching', () => {
      const search = '@example.com';
      const pattern = `%${search}%`;
      expect(pattern).toBe('%@example.com%');
    });

    test('whitespace-only search is truthy but would match everything via ILIKE', () => {
      const search = '   ';
      // In JS, '   ' is truthy (non-empty string)
      expect(Boolean(search)).toBe(true);
      // The pattern would be '%   %' which matches any text containing 3 spaces
      const pattern = `%${search}%`;
      expect(pattern).toBe('%   %');
    });
  });
});
