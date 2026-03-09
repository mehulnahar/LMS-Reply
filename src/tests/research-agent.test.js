/**
 * Test Suite: Research Agent - Exa + Olostep + Claude Sonnet
 *
 * Pure synchronous functions where possible, mocked fetch for async.
 * Uses Jest "unit" project (no setup.js).
 */

'use strict';

const {
  searchExa,
  scrapeWithOlostep,
  scrapeMultiple,
  analyzeWithSonnet,
  deduplicateResults,
  buildSimilarExamplesBlock,
  researchSimilarExamples,
  WELL_KNOWN_DOMAINS,
} = require('../utils/researchAgent');

// ============================================================
// WELL_KNOWN_DOMAINS - Static check
// ============================================================
describe('WELL_KNOWN_DOMAINS', () => {
  it('excludes major brands', () => {
    expect(WELL_KNOWN_DOMAINS).toContain('amazon.com');
    expect(WELL_KNOWN_DOMAINS).toContain('shopify.com');
    expect(WELL_KNOWN_DOMAINS).toContain('nike.com');
    expect(WELL_KNOWN_DOMAINS).toContain('facebook.com');
  });

  it('has a reasonable number of excluded domains', () => {
    expect(WELL_KNOWN_DOMAINS.length).toBeGreaterThan(20);
  });
});

// ============================================================
// deduplicateResults - Pure sync, no mocking needed
// ============================================================
describe('deduplicateResults', () => {
  it('removes exact URL duplicates', () => {
    const input = [
      { url: 'https://example.com', name: 'Example 1' },
      { url: 'https://example.com', name: 'Example 2' },
    ];
    expect(deduplicateResults(input)).toHaveLength(1);
  });

  it('removes duplicates with different protocols', () => {
    const input = [
      { url: 'https://example.com', name: 'A' },
      { url: 'http://example.com', name: 'B' },
    ];
    expect(deduplicateResults(input)).toHaveLength(1);
  });

  it('removes duplicates with/without www', () => {
    const input = [
      { url: 'https://www.example.com', name: 'A' },
      { url: 'https://example.com', name: 'B' },
    ];
    expect(deduplicateResults(input)).toHaveLength(1);
  });

  it('removes duplicates with/without trailing slash', () => {
    const input = [
      { url: 'https://example.com/', name: 'A' },
      { url: 'https://example.com', name: 'B' },
    ];
    expect(deduplicateResults(input)).toHaveLength(1);
  });

  it('keeps different domains', () => {
    const input = [
      { url: 'https://example.com', name: 'A' },
      { url: 'https://different.com', name: 'B' },
      { url: 'https://another.com', name: 'C' },
    ];
    expect(deduplicateResults(input)).toHaveLength(3);
  });

  it('handles empty array', () => {
    expect(deduplicateResults([])).toHaveLength(0);
  });

  it('handles items with missing url', () => {
    const input = [
      { name: 'No URL 1' },
      { url: '', name: 'Empty URL' },
      { url: 'https://real.com', name: 'Real' },
    ];
    expect(deduplicateResults(input)).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    const input = [
      { url: 'https://Example.COM/Path', name: 'A' },
      { url: 'https://example.com/path', name: 'B' },
    ];
    expect(deduplicateResults(input)).toHaveLength(1);
  });
});

// ============================================================
// buildSimilarExamplesBlock - Pure sync
// ============================================================
describe('buildSimilarExamplesBlock', () => {
  it('returns empty string for no examples', () => {
    expect(buildSimilarExamplesBlock([])).toBe('');
    expect(buildSimilarExamplesBlock(null)).toBe('');
    expect(buildSimilarExamplesBlock(undefined)).toBe('');
  });

  it('builds context block with correct structure', () => {
    const examples = [
      {
        name: 'TestStore',
        url: 'https://teststore.com',
        pitch_angle: 'We built an amazing store',
        key_features: ['filter UX', 'AI sizing'],
        platform_type: 'website',
      },
    ];
    const block = buildSimilarExamplesBlock(examples);
    expect(block).toContain('<similar_examples>');
    expect(block).toContain('</similar_examples>');
    expect(block).toContain('TestStore');
    expect(block).toContain('https://teststore.com');
    expect(block).toContain('we built');
    expect(block).toContain('NEVER say "check out this example"');
  });

  it('includes multiple examples', () => {
    const examples = [
      { name: 'Store A', url: 'https://a.com', pitch_angle: 'Great A', key_features: ['f1'], platform_type: 'website' },
      { name: 'Store B', url: 'https://b.com', pitch_angle: 'Great B', key_features: ['f2'], platform_type: 'web_app' },
    ];
    const block = buildSimilarExamplesBlock(examples);
    expect(block).toContain('Store A');
    expect(block).toContain('Store B');
    expect(block).toContain('1.');
    expect(block).toContain('2.');
  });

  it('handles missing key_features gracefully', () => {
    const examples = [
      { name: 'Store', url: 'https://store.com', pitch_angle: 'Good', platform_type: 'website' },
    ];
    const block = buildSimilarExamplesBlock(examples);
    expect(block).toContain('Store');
    // Should not throw
  });
});

// ============================================================
// searchExa - Mocked fetch
// ============================================================
describe('searchExa', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns mapped results from Exa API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { title: 'Cool Store', url: 'https://coolstore.com', text: 'A cool shop', highlights: ['great UX'] },
          { title: 'Nice Shop', url: 'https://niceshop.com', text: 'Nice', highlights: [] },
        ],
      }),
    });

    const results = await searchExa('fashion stores', 'exa-key');
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Cool Store');
    expect(results[0].url).toBe('https://coolstore.com');
    expect(results[0].text).toBe('A cool shop');
    expect(results[0].highlights).toEqual(['great UX']);
  });

  it('sends correct Exa API headers and body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await searchExa('test query', 'my-exa-key', { numResults: 10 });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(options.headers['x-api-key']).toBe('my-exa-key');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.query).toBe('test query');
    expect(body.type).toBe('neural');
    expect(body.numResults).toBe(10);
    expect(body.excludeDomains).toBeDefined();
  });

  it('excludes well-known domains by default', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await searchExa('test', 'key');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.excludeDomains).toContain('amazon.com');
    expect(body.excludeDomains).toContain('shopify.com');
  });

  it('handles empty results', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const results = await searchExa('obscure query', 'key');
    expect(results).toHaveLength(0);
  });

  it('handles missing results field', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const results = await searchExa('query', 'key');
    expect(results).toHaveLength(0);
  });

  it('throws on Exa API error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
    });

    await expect(searchExa('query', 'key'))
      .rejects.toThrow('Exa API error: 429');
  });
});

// ============================================================
// scrapeWithOlostep - Mocked fetch
// ============================================================
describe('scrapeWithOlostep', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns scraped content from Olostep API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: {
          markdown_content: '# Welcome to TestStore',
          page_metadata: { status_code: 200, title: 'TestStore' },
          links_on_page: ['https://teststore.com/about'],
        },
      }),
    });

    const result = await scrapeWithOlostep('https://teststore.com', 'olostep-key');
    expect(result.markdown).toBe('# Welcome to TestStore');
    expect(result.statusCode).toBe(200);
    expect(result.pageTitle).toBe('TestStore');
  });

  it('sends correct Olostep headers and body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: {} }),
    });

    await scrapeWithOlostep('https://example.com', 'my-olostep-key');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.olostep.com/v1/scrapes');
    expect(options.headers['Authorization']).toBe('Bearer my-olostep-key');
    const body = JSON.parse(options.body);
    expect(body.url_to_scrape).toBe('https://example.com');
    expect(body.formats).toContain('markdown');
  });

  it('throws on Olostep API error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: () => Promise.resolve('payment required'),
    });

    await expect(scrapeWithOlostep('https://test.com', 'key'))
      .rejects.toThrow('Olostep API error: 402');
  });
});

// ============================================================
// scrapeMultiple - Mocked fetch
// ============================================================
describe('scrapeMultiple', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('scrapes multiple URLs in parallel', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: {
          markdown_content: '# Content',
          page_metadata: { status_code: 200, title: 'Site' },
          links_on_page: [],
        },
      }),
    });

    const results = await scrapeMultiple(
      ['https://a.com', 'https://b.com', 'https://c.com'],
      'key',
      3
    );
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('handles individual scrape failures gracefully', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('error'),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          result: {
            markdown_content: '# OK',
            page_metadata: { status_code: 200, title: 'Good' },
            links_on_page: [],
          },
        }),
      });
    });

    const results = await scrapeMultiple(['https://a.com', 'https://b.com', 'https://c.com'], 'key', 3);
    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
  });

  it('limits concurrent scrapes', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: { markdown_content: '#', page_metadata: { status_code: 200 }, links_on_page: [] },
      }),
    });

    const urls = Array.from({ length: 20 }, (_, i) => `https://site${i}.com`);
    await scrapeMultiple(urls, 'key', 5);
    // Should only scrape first 5
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it('marks 4xx status as failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: {
          markdown_content: 'Not Found',
          page_metadata: { status_code: 404, title: '404' },
          links_on_page: [],
        },
      }),
    });

    const results = await scrapeMultiple(['https://dead.com'], 'key', 1);
    expect(results[0].success).toBe(false);
    expect(results[0].reason).toContain('404');
  });
});

// ============================================================
// analyzeWithSonnet - Mocked fetch
// ============================================================
describe('analyzeWithSonnet', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns analyzed examples from Claude Sonnet', async () => {
    const mockExamples = [
      { name: 'IndieStore', url: 'https://indie.com', pitch_angle: 'Great design', key_features: ['filter UX'], platform_type: 'website' },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: JSON.stringify(mockExamples) }],
      }),
    });

    const scraped = [{ url: 'https://indie.com', success: true, markdown: '# Indie Store', pageTitle: 'IndieStore' }];
    const results = await analyzeWithSonnet(scraped, 'fashion store', 'key');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('IndieStore');
  });

  it('returns empty for no successful scrapes', async () => {
    const scraped = [{ url: 'https://dead.com', success: false, reason: 'timeout' }];
    const results = await analyzeWithSonnet(scraped, 'test', 'key');
    expect(results).toHaveLength(0);
  });

  it('uses Sonnet model (not Haiku)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: '[]' }] }),
    });

    const scraped = [{ url: 'https://test.com', success: true, markdown: '# Test', pageTitle: 'Test' }];
    await analyzeWithSonnet(scraped, 'test', 'key');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(2048);
  });

  it('returns empty on invalid Claude response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: 'No good examples found.' }],
      }),
    });

    const scraped = [{ url: 'https://test.com', success: true, markdown: '#', pageTitle: 'Test' }];
    const results = await analyzeWithSonnet(scraped, 'test', 'key');
    expect(results).toHaveLength(0);
  });

  it('prompt mentions attribution check', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: '[]' }] }),
    });

    const scraped = [{ url: 'https://test.com', success: true, markdown: '#', pageTitle: 'Test' }];
    await analyzeWithSonnet(scraped, 'test', 'key');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.system).toContain('NO VISIBLE ATTRIBUTION');
    expect(body.system).toContain('CLAIMABLE');
    expect(body.system).toContain('LESSER-KNOWN');
  });
});

// ============================================================
// researchSimilarExamples - Full flow, mocked fetch
// ============================================================
describe('researchSimilarExamples', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('orchestrates the full Exa + Olostep + Sonnet flow', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      // Exa search
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { title: 'Store A', url: 'https://storea.com', text: 'Fashion', highlights: [] },
              { title: 'Store B', url: 'https://storeb.com', text: 'Clothing', highlights: [] },
            ],
          }),
        });
      }
      // Olostep scrapes
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: {
              markdown_content: '# Great Store',
              page_metadata: { status_code: 200, title: 'Store' },
              links_on_page: [],
            },
          }),
        });
      }
      // Claude Sonnet analysis
      if (url.includes('anthropic')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: [{
              text: JSON.stringify([
                { name: 'Store A', url: 'https://storea.com', pitch_angle: 'Great fashion', key_features: ['filter'], platform_type: 'website' },
              ]),
            }],
          }),
        });
      }
      return Promise.reject(new Error('unexpected URL'));
    });

    const result = await researchSimilarExamples('Shopify fashion store', 'anthro-key', 'exa-key', 'olostep-key');

    expect(result.examples.length).toBeGreaterThanOrEqual(1);
    expect(result.rawResultCount).toBe(2);
    expect(result.scrapedCount).toBe(2);
    expect(result.contextBlock).toContain('<similar_examples>');
  });

  it('returns empty when Exa finds nothing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const result = await researchSimilarExamples('test', 'key', 'exa', 'olostep');
    expect(result.examples).toHaveLength(0);
    expect(result.rawResultCount).toBe(0);
    expect(result.contextBlock).toBe('');
  });

  it('returns empty when all scrapes fail', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{ title: 'Site', url: 'https://dead.com', text: '', highlights: [] }],
          }),
        });
      }
      // All olostep scrapes fail
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('error'),
        });
      }
      return Promise.reject(new Error('unexpected'));
    });

    const result = await researchSimilarExamples('test', 'key', 'exa', 'olostep');
    expect(result.examples).toHaveLength(0);
    expect(result.scrapedCount).toBe(0);
    expect(result.contextBlock).toBe('');
  });

  it('caps examples at 5', async () => {
    const tenExamples = Array.from({ length: 10 }, (_, i) => ({
      name: `Store ${i}`, url: `https://store${i}.com`, pitch_angle: 'Good', key_features: ['f'], platform_type: 'website',
    }));

    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: Array.from({ length: 15 }, (_, i) => ({
              title: `R${i}`, url: `https://r${i}.com`, text: 'd', highlights: [],
            })),
          }),
        });
      }
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: { markdown_content: '#', page_metadata: { status_code: 200 }, links_on_page: [] },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ content: [{ text: JSON.stringify(tenExamples) }] }),
      });
    });

    const result = await researchSimilarExamples('test', 'key', 'exa', 'olostep');
    expect(result.examples.length).toBeLessThanOrEqual(5);
  });
});
