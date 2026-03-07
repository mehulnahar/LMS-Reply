'use strict';

/**
 * Test Suite: mockupDecision — Claude-powered Mockup Decision
 * Phase 16: Lovable Mockup Generator
 * Requirements: MOCKUP-01
 *
 * The function is now async with a Claude API call.
 * Budget gate tests are pure (exit before fetch). Claude tests mock global.fetch.
 */

const { evaluateMockupDecision } = require('../utils/mockupDecision');

// Helper to mock fetch returning a Claude JSON response
function mockClaudeResponse(json) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ text: JSON.stringify(json) }] }),
  });
}

function mockClaudeError(status = 500) {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status });
}

afterEach(() => {
  if (global.fetch?.mockRestore) global.fetch.mockRestore();
  delete global.fetch;
});

// ============================================================
// Budget gate (sync, exits before Claude call)
// ============================================================
describe('MOCKUP-01: Budget gate', () => {
  it('blocks budget of $500 (low_budget)', async () => {
    const result = await evaluateMockupDecision({ amount: '500' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('low_budget');
  });

  it('blocks budget of $999 (low_budget)', async () => {
    const result = await evaluateMockupDecision({ amount: '999' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('low_budget');
  });

  it('does NOT block budget of $1000 (passes to Claude)', async () => {
    mockClaudeResponse({ shouldBuild: true, projectType: 'dashboard', whatToMockup: 'Dashboard', alternativeSuggestion: null });
    const result = await evaluateMockupDecision({ amount: '1000', job_heading: 'Build a SaaS dashboard' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(true);
  });

  it('does NOT block $0 amount (passes to Claude)', async () => {
    mockClaudeResponse({ shouldBuild: true, projectType: 'web_app', whatToMockup: 'Web app', alternativeSuggestion: null });
    const result = await evaluateMockupDecision({ amount: '0', job_heading: 'Build a web app' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(true);
  });

  it('does NOT block null amount (passes to Claude)', async () => {
    mockClaudeResponse({ shouldBuild: true, projectType: 'web_app', whatToMockup: 'Web app', alternativeSuggestion: null });
    const result = await evaluateMockupDecision({ amount: null, job_heading: 'Build a web app' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(true);
  });
});

// ============================================================
// Claude YES responses
// ============================================================
describe('MOCKUP-01: Claude YES decisions', () => {
  it('returns shouldBuild true when Claude says YES', async () => {
    mockClaudeResponse({ shouldBuild: true, projectType: 'ecommerce', whatToMockup: 'E-commerce storefront', alternativeSuggestion: null });
    const result = await evaluateMockupDecision({ job_heading: 'Build e-commerce store for cosmetics' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('ecommerce');
    expect(result.whatToMockup).toBe('E-commerce storefront');
  });

  it('passes job heading and description to Claude', async () => {
    mockClaudeResponse({ shouldBuild: true, projectType: 'dashboard', whatToMockup: 'Analytics dashboard', alternativeSuggestion: null });
    await evaluateMockupDecision({ job_heading: 'Analytics Dashboard', job_description: 'Build a real-time analytics dashboard' }, { body_text: 'Hi, interested in your proposal' }, 'fake-key');
    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(callBody.messages[0].content).toContain('Analytics Dashboard');
    expect(callBody.messages[0].content).toContain('real-time analytics dashboard');
    expect(callBody.messages[0].content).toContain('interested in your proposal');
  });
});

// ============================================================
// Claude NO responses
// ============================================================
describe('MOCKUP-01: Claude NO decisions', () => {
  it('returns shouldBuild false when Claude says NO', async () => {
    mockClaudeResponse({ shouldBuild: false, projectType: 'hiring', whatToMockup: null, alternativeSuggestion: 'Relevant case study' });
    const result = await evaluateMockupDecision({ job_heading: 'WordPress developer with e-commerce experience' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('hiring');
    expect(result.alternativeSuggestion).toBe('Relevant case study');
  });

  it('returns NO for SEO service job', async () => {
    mockClaudeResponse({ shouldBuild: false, projectType: 'seo', whatToMockup: null, alternativeSuggestion: 'Keyword analysis' });
    const result = await evaluateMockupDecision({ job_heading: 'SEO optimization for our website' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
  });
});

// ============================================================
// Error handling / fallbacks
// ============================================================
describe('MOCKUP-01: Error handling', () => {
  it('returns fallback when no API key provided', async () => {
    const result = await evaluateMockupDecision({ job_heading: 'Build a dashboard' }, null, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('returns fallback when Claude API returns error', async () => {
    mockClaudeError(500);
    const result = await evaluateMockupDecision({ job_heading: 'Build a dashboard' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('returns fallback when Claude returns invalid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'not valid json at all' }] }),
    });
    const result = await evaluateMockupDecision({ job_heading: 'Build a dashboard' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('returns fallback when Claude returns JSON without shouldBuild boolean', async () => {
    mockClaudeResponse({ projectType: 'web_app' }); // missing shouldBuild
    const result = await evaluateMockupDecision({ job_heading: 'Build a web app' }, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
  });

  it('handles null job without throwing', async () => {
    const result = await evaluateMockupDecision(null, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('handles undefined job without throwing', async () => {
    const result = await evaluateMockupDecision(undefined, null, 'fake-key');
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('handles job with no text fields', async () => {
    const result = await evaluateMockupDecision({ id: 123 }, null, null);
    expect(result.shouldBuild).toBe(false);
  });
});
