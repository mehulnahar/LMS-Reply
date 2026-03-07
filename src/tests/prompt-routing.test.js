/**
 * Test Suite: Prompt Routing + URL Extraction
 * Phase 12: Prompt Routing + Pre-Generation Pipeline
 * Requirements: PROMPT-02, PREFETCH-02, PREFETCH-03
 */

'use strict';

const { determinePromptType, PROMPT_TYPE_LABELS } = require('../utils/promptRouter');
const { extractUrls, analyzeUrl } = require('../utils/prefetch');

// ============================================================
// PROMPT-02: Prompt routing — determinePromptType()
// ============================================================
describe('PROMPT-02: determinePromptType — routing logic', () => {
  // Helper: date N days ago
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  describe('STOP suppression', () => {
    it('returns null for OOO intent', () => {
      expect(determinePromptType({ intent: 'ooo' }, {}, {})).toBeNull();
    });
    it('returns null for is_ooo flag', () => {
      expect(determinePromptType({ is_ooo: true }, {}, {})).toBeNull();
    });
  });

  describe('Explicit source routing', () => {
    it('returns PROPOSAL_V4 when source=proposal', () => {
      expect(determinePromptType({}, {}, { source: 'proposal' })).toBe('PROPOSAL_V4');
    });
    it('returns LOVABLE_MOCKUP_V1 when source=mockup', () => {
      expect(determinePromptType({}, {}, { source: 'mockup' })).toBe('LOVABLE_MOCKUP_V1');
    });
  });

  describe('Manual override', () => {
    it('respects promptOverride when valid', () => {
      expect(determinePromptType({}, {}, { promptOverride: 'PROPOSAL_V4' })).toBe('PROPOSAL_V4');
    });
    it('ignores promptOverride when invalid value', () => {
      // Invalid override falls through to routing logic
      const result = determinePromptType({}, {}, { promptOverride: 'INVALID_TYPE' });
      expect(result).toBe('EMAIL_REPLY_V2');
    });
    it('override wins even over source', () => {
      // Override has highest priority
      expect(determinePromptType({}, {}, { promptOverride: 'FOLLOW_UP_V2', source: 'proposal' })).toBe('FOLLOW_UP_V2');
    });
  });

  describe('Thread continuation', () => {
    it('returns THREAD_CONTINUATION_V1 when thread_client_messages >= 2', () => {
      expect(determinePromptType({}, { thread_client_messages: 2 }, {})).toBe('THREAD_CONTINUATION_V1');
    });
    it('returns THREAD_CONTINUATION_V1 when thread_depth >= 2', () => {
      expect(determinePromptType({}, { thread_depth: 3 }, {})).toBe('THREAD_CONTINUATION_V1');
    });
    it('does NOT select thread continuation for thread_depth=1', () => {
      // depth=1 with recent email → EMAIL_REPLY_V2 (not old enough for follow-up)
      expect(determinePromptType({ received_at: daysAgo(1) }, { thread_depth: 1 }, {})).toBe('EMAIL_REPLY_V2');
    });
  });

  describe('Follow-up routing', () => {
    it('returns FOLLOW_UP_V2 when thread_depth >= 2 and client silent 3+ days', () => {
      expect(determinePromptType(
        { received_at: daysAgo(4) },
        { thread_depth: 2 },
        {}
      )).toBe('FOLLOW_UP_V2');
    });
    it('returns THREAD_CONTINUATION when thread_depth >= 2 but email recent (< 3 days)', () => {
      expect(determinePromptType(
        { received_at: daysAgo(1) },
        { thread_depth: 2 },
        {}
      )).toBe('THREAD_CONTINUATION_V1');
    });
    it('does NOT return follow-up when thread_depth is 0 (no prior messages)', () => {
      expect(determinePromptType(
        { received_at: daysAgo(5) },
        { thread_depth: 0 },
        {}
      )).toBe('EMAIL_REPLY_V2');
    });
    it('does NOT return follow-up when thread_depth is 1 (single email, no prior exchange)', () => {
      // This was the root cause bug — thread_depth=1 + old email was incorrectly routing to FOLLOW_UP
      expect(determinePromptType(
        { received_at: daysAgo(10) },
        { thread_depth: 1 },
        {}
      )).toBe('EMAIL_REPLY_V2');
    });
    it('returns FOLLOW_UP_V2 when thread_client_messages >= 2 and client silent 5+ days', () => {
      expect(determinePromptType(
        { received_at: daysAgo(5) },
        { thread_client_messages: 2 },
        {}
      )).toBe('FOLLOW_UP_V2');
    });
  });

  describe('Default routing', () => {
    it('returns EMAIL_REPLY_V2 as default', () => {
      expect(determinePromptType({}, {}, {})).toBe('EMAIL_REPLY_V2');
    });
    it('returns EMAIL_REPLY_V2 when job is null', () => {
      expect(determinePromptType({}, null, {})).toBe('EMAIL_REPLY_V2');
    });
  });

  describe('PROMPT_TYPE_LABELS display names', () => {
    it('has a label for each valid prompt type', () => {
      const types = ['EMAIL_REPLY_V2', 'THREAD_CONTINUATION_V1', 'FOLLOW_UP_V2', 'PROPOSAL_V4', 'LOVABLE_MOCKUP_V1'];
      types.forEach(t => {
        expect(PROMPT_TYPE_LABELS[t]).toBeDefined();
        expect(typeof PROMPT_TYPE_LABELS[t]).toBe('string');
      });
    });
  });
});

// ============================================================
// PREFETCH-02: URL extraction — extractUrls()
// ============================================================
describe('PREFETCH-02: extractUrls — URL extraction and filtering', () => {
  it('extracts URLs from text', () => {
    const urls = extractUrls('Check https://example.com and https://client-site.io');
    expect(urls).toContain('https://example.com');
    expect(urls).toContain('https://client-site.io');
  });

  it('filters upwork.com from results', () => {
    const urls = extractUrls('https://upwork.com/jobs/123 https://example.com');
    expect(urls).not.toContain('https://upwork.com/jobs/123');
    expect(urls).toContain('https://example.com');
  });

  it('deduplicates repeated URLs', () => {
    const urls = extractUrls('https://example.com https://example.com https://example.com');
    const unique = urls.filter(u => u === 'https://example.com');
    expect(unique.length).toBe(1);
  });

  it('strips trailing punctuation from URLs', () => {
    const urls = extractUrls('Visit https://example.com. Also https://site.io, and https://other.com!');
    expect(urls).toContain('https://example.com');
    expect(urls).toContain('https://site.io');
    expect(urls).toContain('https://other.com');
  });

  it('returns empty array for null/undefined inputs', () => {
    expect(extractUrls(null, undefined, '')).toEqual([]);
    expect(extractUrls()).toEqual([]);
  });

  it('caps results at 5 URLs maximum', () => {
    const input = Array.from({ length: 8 }, (_, i) => `https://site${i}.com`).join(' ');
    const urls = extractUrls(input);
    expect(urls.length).toBeLessThanOrEqual(5);
  });

  it('extracts URLs across multiple text sources', () => {
    const urls = extractUrls('https://job-site.com', 'https://client-site.io');
    expect(urls.length).toBe(2);
  });
});

// ============================================================
// PREFETCH-03: URL analysis — analyzeUrl()
// ============================================================
describe('PREFETCH-03: analyzeUrl — page content analysis', () => {
  // Real network calls — extend timeout
  jest.setTimeout(15000);

  it('returns structured result object for a reachable URL', async () => {
    const result = await analyzeUrl('https://example.com');
    expect(result).toHaveProperty('url', 'https://example.com');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('findings');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result).toHaveProperty('bestFindingForReply');
  });

  it('returns result with error (not throw) for unreachable URL', async () => {
    const result = await analyzeUrl('https://this-domain-does-not-exist-xyz123abc.com');
    // Must not throw — error goes into result.error
    expect(result).toHaveProperty('url');
    expect(result.error).not.toBeNull();
  });

  it('bestFindingForReply is null or a string (never undefined)', async () => {
    const result = await analyzeUrl('https://example.com');
    expect(result.bestFindingForReply === null || typeof result.bestFindingForReply === 'string').toBe(true);
  });

  it('findings is always an array (even on error)', async () => {
    const result = await analyzeUrl('https://this-domain-does-not-exist-xyz123abc.com');
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
