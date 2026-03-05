'use strict';

/**
 * Test Suite: mockupDecision — Decision Matrix for Lovable Mockup Generation
 * Phase 16: Lovable Mockup Generator
 * Requirements: MOCKUP-01
 *
 * Pure synchronous function — no DB, no Express, no HTTP, no mocking needed.
 * Uses Jest "unit" project (no setup.js).
 */

const { evaluateMockupDecision } = require('../utils/mockupDecision');

// ============================================================
// MOCKUP-01: Decision Matrix — YES classifications
// ============================================================
describe('MOCKUP-01: Decision Matrix — YES classifications', () => {
  it('classifies SaaS dashboard as YES', () => {
    const result = evaluateMockupDecision({ job_heading: 'Build a SaaS dashboard' }, null);
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toMatch(/dashboard|web_app/);
    expect(result.whatToMockup).toBeTruthy();
    expect(result.alternativeSuggestion).toBeNull();
  });

  it('classifies landing page as YES', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Create a landing page for our startup' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('landing_page');
  });

  it('classifies e-commerce store as YES', () => {
    const result = evaluateMockupDecision(
      { job_heading: 'E-commerce store for cosmetics' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('ecommerce');
  });

  it('classifies mobile app as YES', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Build a mobile app for iOS and Android' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('mobile_app');
  });

  it('classifies web app for project management as YES', () => {
    const result = evaluateMockupDecision(
      { job_heading: 'Web app for project management' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('web_app');
  });

  it('classifies AI chatbot interface as YES', () => {
    const result = evaluateMockupDecision(
      { job_description: 'AI chatbot interface for customer support' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('ai_chatbot');
  });

  it('classifies automation tool with workflow builder as YES', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Automation tool with workflow builder UI' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('automation_tool');
  });

  it('classifies UI/UX redesign as YES', () => {
    const result = evaluateMockupDecision(
      { job_heading: 'UI/UX redesign of existing product' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('generic_ui');
  });
});

// ============================================================
// MOCKUP-01: Decision Matrix — NO classifications
// ============================================================
describe('MOCKUP-01: Decision Matrix — NO classifications', () => {
  it('classifies SEO optimization as NO (service-type wins over e-commerce keyword)', () => {
    const result = evaluateMockupDecision(
      { job_heading: 'SEO optimization for e-commerce site' },
      null
    );
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('seo');
    expect(result.alternativeSuggestion).toMatch(/keyword|competitor/i);
  });

  it('classifies DevOps pipeline as NO with architecture diagram suggestion', () => {
    const result = evaluateMockupDecision(
      { job_description: 'DevOps pipeline setup with Docker' },
      null
    );
    expect(result.shouldBuild).toBe(false);
    expect(result.alternativeSuggestion).toMatch(/Architecture diagram/i);
  });

  it('classifies copywriting as NO', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Copywriting for tech blog posts' },
      null
    );
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('content');
    expect(result.alternativeSuggestion).toMatch(/content calendar/i);
  });

  it('classifies data entry as NO', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Data entry for spreadsheets' },
      null
    );
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('data_entry');
    expect(result.alternativeSuggestion).toMatch(/workflow/i);
  });

  it('classifies backend API microservice as NO', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Backend API microservice' },
      null
    );
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('backend');
    expect(result.alternativeSuggestion).toMatch(/code audit/i);
  });
});

// ============================================================
// MOCKUP-01: Decision Matrix — Budget gate
// ============================================================
describe('MOCKUP-01: Decision Matrix — Budget gate', () => {
  it('blocks budget of $500 (low_budget)', () => {
    const result = evaluateMockupDecision({ amount: '500' }, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('low_budget');
  });

  it('blocks budget of $999 (low_budget)', () => {
    const result = evaluateMockupDecision({ amount: '999' }, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('low_budget');
  });

  it('does NOT block budget of $1000 (passes through)', () => {
    const result = evaluateMockupDecision(
      { amount: '1000', job_heading: 'Build a SaaS dashboard' },
      null
    );
    expect(result.shouldBuild).toBe(true);
  });

  it('does NOT block budget of $0 (treated as no budget info)', () => {
    const result = evaluateMockupDecision(
      { amount: '0', job_heading: 'Build a SaaS dashboard' },
      null
    );
    expect(result.shouldBuild).toBe(true);
  });

  it('does NOT block null amount (treated as no budget info)', () => {
    const result = evaluateMockupDecision(
      { amount: null, job_heading: 'Build a SaaS dashboard' },
      null
    );
    expect(result.shouldBuild).toBe(true);
  });
});

// ============================================================
// MOCKUP-01: Decision Matrix — Mixed projects
// ============================================================
describe('MOCKUP-01: Decision Matrix — Mixed projects', () => {
  it('classifies REST API + React dashboard as YES (visual component overrides infra)', () => {
    const result = evaluateMockupDecision(
      { job_description: 'Build REST API and React dashboard' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('dashboard');
  });

  it('classifies DevOps pipeline with monitoring dashboard as YES (visual overrides infra)', () => {
    const result = evaluateMockupDecision(
      { job_description: 'DevOps pipeline with monitoring dashboard' },
      null
    );
    expect(result.shouldBuild).toBe(true);
    expect(result.projectType).toBe('dashboard');
  });
});

// ============================================================
// MOCKUP-01: Decision Matrix — Edge cases
// ============================================================
describe('MOCKUP-01: Decision Matrix — Edge cases', () => {
  it('handles null job without throwing', () => {
    const result = evaluateMockupDecision(null, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('handles undefined job without throwing', () => {
    const result = evaluateMockupDecision(undefined, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('handles empty string job_heading as no signal', () => {
    const result = evaluateMockupDecision({ job_heading: '' }, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
  });

  it('handles job with no relevant fields as unknown', () => {
    const result = evaluateMockupDecision({ id: 123, some_other_field: 'value' }, null);
    expect(result.shouldBuild).toBe(false);
    expect(result.projectType).toBe('unknown');
    expect(result.alternativeSuggestion).toMatch(/unclear/i);
  });
});
