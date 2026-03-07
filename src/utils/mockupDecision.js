'use strict';

/**
 * Mockup Decision — MOCKUP-01, MOCKUP-02
 *
 * Async function that uses Claude to evaluate whether a Lovable mockup
 * is appropriate for a given job/email context.
 *
 * Budget gate remains sync (no AI needed). Everything else goes through Claude.
 *
 * Export: evaluateMockupDecision(job, email, anthropicKey)
 */

const FALLBACK = {
  shouldBuild: false,
  projectType: 'unknown',
  whatToMockup: null,
  alternativeSuggestion: 'Could not determine project type -- focus on insight in the reply',
};

/**
 * Evaluates whether a Lovable mockup is appropriate for a given job/email.
 *
 * @param {Object|null} job   - Job row (job_heading, job_description_raw, job_description, category, sub_category, amount)
 * @param {Object|null} email - Email row (body_text, snippet)
 * @param {string|null} anthropicKey - Anthropic API key for Claude call
 * @returns {Promise<{ shouldBuild: boolean, projectType: string, whatToMockup: string|null, alternativeSuggestion: string|null }>}
 */
async function evaluateMockupDecision(job, email, anthropicKey) {
  const safeJob = job || {};

  // 1. Budget gate (sync, no AI needed): block if amount > 0 AND < 1000
  const amount = parseFloat(safeJob.amount);
  if (!isNaN(amount) && amount > 0 && amount < 1000) {
    return {
      shouldBuild: false,
      projectType: 'low_budget',
      whatToMockup: null,
      alternativeSuggestion: 'Relevant case study instead',
    };
  }

  // 2. Assemble context text
  const jobHeading = (safeJob.job_heading || '').trim();
  const jobDesc = (safeJob.job_description_raw || safeJob.job_description || '').slice(0, 1500);
  const emailBody = (email?.body_text || email?.snippet || '').slice(0, 500);

  // No text and no API key = can't decide
  if (!jobHeading && !jobDesc && !emailBody) return FALLBACK;
  if (!anthropicKey) return FALLBACK;

  // 3. Ask Claude
  const prompt = `You are evaluating whether a visual UI mockup (built in Lovable) would be a compelling addition to a reply for this Upwork job.

Job Heading: "${jobHeading}"
Job Description: "${jobDesc}"
Client Email: "${emailBody}"

IMPORTANT: Read the ACTUAL job requirements carefully. Understand what the client is ASKING TO BE BUILT or DONE.
- A job saying "WordPress developer with e-commerce experience" is a HIRING job, NOT a request to build an e-commerce store.
- A "DevOps engineer" job is NOT visual even if it mentions "dashboard" in passing.
- Focus on the PRIMARY deliverable the client wants.

BUILD a mockup ONLY when the PRIMARY deliverable involves a visual interface:
- Web apps, SaaS platforms, dashboards, admin panels
- Landing pages, marketing sites, e-commerce storefronts (when the CLIENT wants one BUILT)
- Mobile app screens, chat interfaces
- UI/UX redesigns of existing products

DO NOT build a mockup when:
- The job is hiring/staffing (looking for a developer to join a team)
- The job is primarily services (SEO, marketing, content writing, data entry)
- The job is primarily infrastructure (DevOps, CI/CD, server setup)
- The job is backend-only (APIs, microservices, scripts, integrations)
- The visual component is incidental, not the primary deliverable

Reply with ONLY a JSON object (no markdown, no code fences):
{"shouldBuild": true or false, "projectType": "short label", "whatToMockup": "short description if shouldBuild is true, otherwise null", "alternativeSuggestion": "alternative value-add if shouldBuild is false, otherwise null"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('mockupDecision: Claude API error', res.status);
      return FALLBACK;
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text || '').trim();

    // Parse JSON response
    const parsed = JSON.parse(text);
    if (typeof parsed.shouldBuild !== 'boolean') return FALLBACK;

    return {
      shouldBuild: parsed.shouldBuild,
      projectType: parsed.projectType || 'unknown',
      whatToMockup: parsed.whatToMockup || null,
      alternativeSuggestion: parsed.alternativeSuggestion || null,
    };
  } catch (err) {
    console.error('mockupDecision: error', err.message);
    return FALLBACK;
  }
}

module.exports = { evaluateMockupDecision };
