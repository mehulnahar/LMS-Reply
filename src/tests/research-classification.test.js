/**
 * Test Suite: Research Classification Gate
 *
 * Tests the pre-flight classification (classifyAndRefine) that determines
 * whether to run the expensive research pipeline.
 *
 * Uses Jest "unit" project (no setup.js, mocked fetch).
 */

'use strict';

const {
  classifyAndRefine,
  researchSimilarExamples,
  VALID_CLASSIFICATIONS,
  VALID_PROJECT_TYPES,
} = require('../utils/researchAgent');

// ============================================================
// Constants
// ============================================================
describe('VALID_CLASSIFICATIONS', () => {
  it('contains BUILD, SERVICE, TOO_NARROW', () => {
    expect(VALID_CLASSIFICATIONS).toContain('BUILD');
    expect(VALID_CLASSIFICATIONS).toContain('SERVICE');
    expect(VALID_CLASSIFICATIONS).toContain('TOO_NARROW');
    expect(VALID_CLASSIFICATIONS).toHaveLength(3);
  });
});

describe('VALID_PROJECT_TYPES', () => {
  it('contains expected project types', () => {
    expect(VALID_PROJECT_TYPES).toContain('ecommerce');
    expect(VALID_PROJECT_TYPES).toContain('website');
    expect(VALID_PROJECT_TYPES).toContain('web_app');
    expect(VALID_PROJECT_TYPES).toContain('saas');
    expect(VALID_PROJECT_TYPES).toContain('mobile_app');
    expect(VALID_PROJECT_TYPES).toContain('automation');
    expect(VALID_PROJECT_TYPES).toContain('landing_page');
    expect(VALID_PROJECT_TYPES).toHaveLength(10);
  });
});

// ============================================================
// classifyAndRefine - Mocked fetch
// ============================================================
describe('classifyAndRefine', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockSonnetResponse(jsonBody) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: JSON.stringify(jsonBody) }],
      }),
    });
  }

  it('classifies a BUILD job correctly', async () => {
    mockSonnetResponse({
      classification: 'BUILD',
      reason: 'Client wants a Shopify fashion store built',
      tags: { industry: 'fashion', technologies: ['shopify', 'react'], projectType: 'ecommerce' },
      queries: ['indie fashion boutique online store', 'small brand clothing shop e-commerce'],
    });

    const result = await classifyAndRefine('Build me a Shopify fashion store', 'test-key');
    expect(result.classification).toBe('BUILD');
    expect(result.tags.industry).toBe('fashion');
    expect(result.tags.technologies).toContain('shopify');
    expect(result.tags.projectType).toBe('ecommerce');
    expect(result.queries.length).toBeGreaterThanOrEqual(1);
    expect(result.reason).toBeTruthy();
  });

  it('classifies a SERVICE job with case study queries', async () => {
    mockSonnetResponse({
      classification: 'SERVICE',
      reason: 'Client wants an ongoing SEO specialist',
      tags: { industry: 'marketing', technologies: [], projectType: 'website' },
      queries: ['SEO management case study results growth'],
    });

    const result = await classifyAndRefine('Looking for an SEO specialist to manage our campaigns', 'test-key');
    expect(result.classification).toBe('SERVICE');
    expect(result.queries.length).toBeGreaterThanOrEqual(1);
    expect(result.reason).toContain('SEO');
  });

  it('classifies a TOO_NARROW job with case study queries', async () => {
    mockSonnetResponse({
      classification: 'TOO_NARROW',
      reason: 'Internal bug fixing task',
      tags: { industry: 'saas', technologies: ['python'], projectType: 'web_app' },
      queries: ['Django admin optimization case study results'],
    });

    const result = await classifyAndRefine('Fix bugs in our internal Django admin panel', 'test-key');
    expect(result.classification).toBe('TOO_NARROW');
    expect(result.queries.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to BUILD on invalid classification value', async () => {
    mockSonnetResponse({
      classification: 'UNKNOWN',
      reason: 'test',
      tags: {},
      queries: ['query1'],
    });

    const result = await classifyAndRefine('some project', 'test-key');
    expect(result.classification).toBe('BUILD');
  });

  it('falls back to BUILD on non-JSON response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: 'Here are some search queries:\n1. fashion boutique shop\n2. indie clothing store' }],
      }),
    });

    const result = await classifyAndRefine('Build a fashion store', 'test-key');
    expect(result.classification).toBe('BUILD');
    expect(result.reason).toContain('Fallback');
    expect(result.queries.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to BUILD on fetch error (fail-open)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    const result = await classifyAndRefine('Build a store', 'test-key');
    expect(result.classification).toBe('BUILD');
    expect(result.reason).toContain('Fallback');
    expect(result.queries).toEqual(['Build a store']);
  });

  it('falls back to BUILD on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await classifyAndRefine('Build a store', 'test-key');
    expect(result.classification).toBe('BUILD');
    expect(result.queries).toEqual(['Build a store']);
  });

  it('validates projectType against VALID_PROJECT_TYPES', async () => {
    mockSonnetResponse({
      classification: 'BUILD',
      reason: 'test',
      tags: { industry: 'tech', technologies: [], projectType: 'invalid_type' },
      queries: ['query1'],
    });

    const result = await classifyAndRefine('Build something', 'test-key');
    expect(result.tags.projectType).toBe('website'); // fallback
  });

  it('ensures technologies is always an array', async () => {
    mockSonnetResponse({
      classification: 'BUILD',
      reason: 'test',
      tags: { industry: 'tech', technologies: 'react', projectType: 'web_app' },
      queries: ['query1'],
    });

    const result = await classifyAndRefine('Build a React app', 'test-key');
    expect(Array.isArray(result.tags.technologies)).toBe(true);
  });

  it('filters out short/invalid queries', async () => {
    mockSonnetResponse({
      classification: 'BUILD',
      reason: 'test',
      tags: {},
      queries: ['good long query here', 'ab', '', 'another good query'],
    });

    const result = await classifyAndRefine('Build something', 'test-key');
    expect(result.queries).toHaveLength(2);
    expect(result.queries).toContain('good long query here');
    expect(result.queries).toContain('another good query');
  });

  it('uses projectDescription as fallback query for BUILD with empty queries', async () => {
    mockSonnetResponse({
      classification: 'BUILD',
      reason: 'test',
      tags: {},
      queries: [],
    });

    const result = await classifyAndRefine('Build a fashion store', 'test-key');
    expect(result.queries).toEqual(['Build a fashion store']);
  });

  it('uses projectDescription as fallback query for SERVICE with empty queries', async () => {
    mockSonnetResponse({
      classification: 'SERVICE',
      reason: 'ongoing service',
      tags: {},
      queries: [],
    });

    const result = await classifyAndRefine('Need a VA', 'test-key');
    expect(result.queries).toEqual(['Need a VA']);
  });

  it('return shape always has classification, tags, reason, queries', async () => {
    mockSonnetResponse({
      classification: 'BUILD',
      reason: 'test reason',
      tags: { industry: 'fashion' },
      queries: ['query1'],
    });

    const result = await classifyAndRefine('Build a store', 'test-key');
    expect(result).toHaveProperty('classification');
    expect(result).toHaveProperty('tags');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('queries');
  });
});

// ============================================================
// Orchestrator gate - SERVICE/TOO_NARROW skip pipeline
// ============================================================
describe('researchSimilarExamples - classification gate', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('runs case_study pipeline for SERVICE classification', async () => {
    let fetchCount = 0;
    global.fetch = jest.fn().mockImplementation((url) => {
      fetchCount++;
      if (url.includes('anthropic')) {
        if (fetchCount === 1) {
          // classifyAndRefine returns SERVICE with case study queries
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              content: [{ text: JSON.stringify({
                classification: 'SERVICE',
                reason: 'Ongoing SEO work',
                tags: { industry: 'marketing', technologies: [], projectType: 'website' },
                queries: ['SEO management case study results growth'],
              }) }],
            }),
          });
        }
        // analyzeServiceCaseStudies
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: [{ text: JSON.stringify([
              { client_site_url: 'https://test-client.com', client_description: 'Marketing agency client', metrics: ['Traffic +50%'], services_provided: ['SEO'], industry: 'marketing' },
            ]) }],
          }),
        });
      }
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{ title: 'SEO Case Study', url: 'https://agency-blog.com/case-study', text: 'Great results', highlights: [] }],
          }),
        });
      }
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: { markdown_content: '# SEO Case Study', page_metadata: { status_code: 200, title: 'Case Study' }, links_on_page: [] },
          }),
        });
      }
      return Promise.reject(new Error('unexpected URL'));
    });

    const result = await researchSimilarExamples('SEO specialist needed', 'key', 'exa', 'olostep');
    expect(result.skipped).toBe(false);
    expect(result.mode).toBe('case_study');
    expect(result.classification).toBe('SERVICE');
    expect(result.examples.length).toBeGreaterThanOrEqual(1);
    expect(result.examples[0]).toHaveProperty('client_site_url');
    expect(result.examples[0]).toHaveProperty('metrics');
    // Should have called Exa + Olostep + Sonnet analyze (not just classify)
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('runs case_study pipeline for TOO_NARROW classification', async () => {
    let fetchCount = 0;
    global.fetch = jest.fn().mockImplementation((url) => {
      fetchCount++;
      if (url.includes('anthropic')) {
        if (fetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              content: [{ text: JSON.stringify({
                classification: 'TOO_NARROW',
                reason: 'Internal bug fixes',
                tags: { industry: 'saas', technologies: ['python'], projectType: 'web_app' },
                queries: ['Django admin optimization case study'],
              }) }],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: [{ text: JSON.stringify([
              { client_site_url: 'https://django-client.com', client_description: 'SaaS platform', metrics: ['Performance +40%'], services_provided: ['Django optimization'], industry: 'saas' },
            ]) }],
          }),
        });
      }
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{ title: 'Django Case Study', url: 'https://blog.com/django', text: 'Results', highlights: [] }],
          }),
        });
      }
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: { markdown_content: '# Django', page_metadata: { status_code: 200, title: 'T' }, links_on_page: [] },
          }),
        });
      }
      return Promise.reject(new Error('unexpected'));
    });

    const result = await researchSimilarExamples('Fix bugs in Django admin', 'key', 'exa', 'olostep');
    expect(result.skipped).toBe(false);
    expect(result.mode).toBe('case_study');
    expect(result.classification).toBe('TOO_NARROW');
    expect(result.tags.technologies).toContain('python');
    expect(result.examples.length).toBeGreaterThanOrEqual(1);
  });

  it('runs full pipeline for BUILD classification', async () => {
    let fetchCount = 0;
    global.fetch = jest.fn().mockImplementation((url) => {
      fetchCount++;
      if (url.includes('anthropic')) {
        // First call = classifyAndRefine, second = analyzeWithSonnet
        if (fetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              content: [{ text: JSON.stringify({
                classification: 'BUILD',
                reason: 'Client wants an ecommerce store',
                tags: { industry: 'fashion', technologies: ['shopify'], projectType: 'ecommerce' },
                queries: ['indie fashion boutique store'],
              }) }],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: [{ text: JSON.stringify([
              { name: 'TestStore', url: 'https://test.com', pitch_angle: 'Great', key_features: ['f1'], platform_type: 'website' },
            ]) }],
          }),
        });
      }
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{ title: 'Store', url: 'https://test.com', text: 'Fashion', highlights: [] }],
          }),
        });
      }
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: { markdown_content: '# Store', page_metadata: { status_code: 200, title: 'Store' }, links_on_page: [] },
          }),
        });
      }
      return Promise.reject(new Error('unexpected URL'));
    });

    const result = await researchSimilarExamples('Build a Shopify store', 'key', 'exa', 'olostep');
    expect(result.skipped).toBe(false);
    expect(result.mode).toBe('build');
    expect(result.classification).toBe('BUILD');
    expect(result.examples.length).toBeGreaterThanOrEqual(1);
    // Should have called Exa and Olostep (not just Anthropic)
    expect(global.fetch).toHaveBeenCalledTimes(4); // classify + exa + olostep + analyze
  });

  it('forceResearch overrides SERVICE classification', async () => {
    let callUrls = [];
    global.fetch = jest.fn().mockImplementation((url) => {
      callUrls.push(url);
      if (url.includes('anthropic')) {
        // classifyAndRefine returns SERVICE, but forceResearch should override
        if (callUrls.filter(u => u.includes('anthropic')).length === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              content: [{ text: JSON.stringify({
                classification: 'SERVICE',
                reason: 'Ongoing work',
                tags: { industry: 'marketing', technologies: [], projectType: 'website' },
                queries: ['SEO specialist needed'],
              }) }],
            }),
          });
        }
        // analyzeWithSonnet
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: '[]' }] }),
        });
      }
      if (url.includes('exa.ai')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{ title: 'R', url: 'https://r.com', text: 't', highlights: [] }],
          }),
        });
      }
      if (url.includes('olostep.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: { markdown_content: '#', page_metadata: { status_code: 200, title: 'T' }, links_on_page: [] },
          }),
        });
      }
      return Promise.reject(new Error('unexpected'));
    });

    const result = await researchSimilarExamples('SEO work', 'key', 'exa', 'olostep', { forceResearch: true });
    expect(result.skipped).toBe(false);
    expect(result.classification).toBe('SERVICE');
    // Should have called Exa (pipeline was not skipped)
    expect(callUrls.some(u => u.includes('exa.ai'))).toBe(true);
  });

  it('return shape always includes classification fields', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: JSON.stringify({
          classification: 'BUILD',
          reason: 'test',
          tags: { industry: 'tech' },
          queries: ['q1'],
        }) }],
      }),
    });

    // Will fail at Exa (since mock returns classifyAndRefine response for all URLs)
    // but should still return classification fields
    const result = await researchSimilarExamples('test', 'key', 'exa', 'olostep');
    expect(result).toHaveProperty('classification');
    expect(result).toHaveProperty('tags');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('skipped');
  });
});
