'use strict';

/**
 * Mockup Decision Matrix — MOCKUP-01, MOCKUP-02
 *
 * Pure sync function that evaluates whether a Lovable mockup is appropriate
 * for a given job/email context.
 *
 * No DB, no Express, no external API calls — just keyword classification.
 *
 * Export: evaluateMockupDecision(job, email)
 */

// ============================================================
// YES keyword categories (visual/buildable project types)
// ============================================================

const YES_CATEGORIES = [
  {
    key: 'web_app',
    label: 'Web app / SaaS',
    regex: /\b(web\s?app|saas|platform|portal|crm|erp)\b/i,
  },
  {
    key: 'landing_page',
    label: 'Landing page / Website',
    regex: /\b(landing\s?page|website|web\s?site|homepage|marketing\s?site)\b/i,
  },
  {
    key: 'ecommerce',
    label: 'E-commerce',
    regex: /\b(e-?commerce|shopify|woo\s?commerce|online\s?store|storefront|product\s?page)\b/i,
  },
  {
    key: 'mobile_app',
    label: 'Mobile app',
    regex: /\b(mobile\s?app|ios\s?app|android\s?app|react\s?native|flutter)\b/i,
  },
  {
    key: 'dashboard',
    label: 'Dashboard / Analytics',
    regex: /\b(dashboard|admin\s?panel|analytics|data\s?viz|chart|reporting\s?tool)\b/i,
  },
  {
    key: 'ai_chatbot',
    label: 'AI chatbot / Chat UI',
    regex: /\b(chatbot|chat\s?interface|conversational\s?ui|ai\s?assistant)\b/i,
  },
  {
    key: 'automation_tool',
    label: 'Automation tool',
    regex: /\b(automation\s?tool|workflow\s?builder|pipeline\s?ui|status\s?dashboard)\b/i,
  },
  {
    key: 'generic_ui',
    label: 'Generic UI / Design',
    regex: /\b(ui|ux|design|redesign|frontend|front-?end|user\s?interface|prototype)\b/i,
  },
];

// ============================================================
// NO keyword categories — split into service vs infrastructure
// ============================================================

// Service-type NO: takes priority even when YES keywords co-occur
// (e.g., "SEO optimization for e-commerce site" -> NO, because the job is service work)
const SERVICE_NO_CATEGORIES = [
  {
    key: 'seo',
    label: 'SEO / Marketing',
    regex: /\b(seo|search\s?engine\s?optim|marketing\s?campaign|ppc|adwords|social\s?media\s?management)\b/i,
    alternativeSuggestion: 'Quick keyword/competitor analysis',
  },
  {
    key: 'content',
    label: 'Content writing',
    regex: /\b(content\s?writ|blog\s?post|copywriting|article|ghostwriting)\b/i,
    alternativeSuggestion: 'Sample content calendar',
  },
  {
    key: 'data_entry',
    label: 'Data entry / Admin',
    regex: /\b(data\s?entry|bookkeeping|virtual\s?assistant|transcription)\b/i,
    alternativeSuggestion: 'Workflow optimization proposal',
  },
];

// Infrastructure-type NO: yields to YES keywords that indicate a visual component
// (e.g., "DevOps pipeline with monitoring dashboard" -> YES, because dashboard IS buildable)
const INFRA_NO_CATEGORIES = [
  {
    key: 'devops',
    label: 'DevOps / Infrastructure',
    regex: /\b(devops|ci\/?cd|docker|kubernetes|infrastructure|server\s?setup|deployment)\b/i,
    alternativeSuggestion: 'Architecture diagram',
  },
  {
    key: 'backend',
    label: 'Backend only',
    regex: /\b(api\s?only|backend\s?only|microservice|cron\s?job|script)\b/i,
    alternativeSuggestion: 'Code audit with 3 findings',
  },
];

// ============================================================
// Internal helpers
// ============================================================

/**
 * Detects the first matching NO category from text.
 * Returns { key, label, alternativeSuggestion, isService } or null.
 */
function detectNoCategory(text) {
  for (const cat of SERVICE_NO_CATEGORIES) {
    if (cat.regex.test(text)) {
      return { ...cat, isService: true };
    }
  }
  for (const cat of INFRA_NO_CATEGORIES) {
    if (cat.regex.test(text)) {
      return { ...cat, isService: false };
    }
  }
  return null;
}

/**
 * Detects the first matching YES category from text.
 * Returns { key, label } or null.
 */
function detectYesCategory(text) {
  for (const cat of YES_CATEGORIES) {
    if (cat.regex.test(text)) {
      return { key: cat.key, label: cat.label };
    }
  }
  return null;
}

/**
 * Infers a short description of what to mockup from the matched category + job heading.
 * @param {string} text - Full assembled text
 * @param {string} categoryKey - e.g., 'web_app', 'dashboard'
 * @param {string} jobHeading - The job heading (or empty string)
 * @returns {string} Short description, e.g., "SaaS dashboard", "E-commerce storefront"
 */
function inferWhatToMockup(text, categoryKey, jobHeading) {
  const categoryLabels = {
    web_app: 'Web application',
    landing_page: 'Landing page',
    ecommerce: 'E-commerce storefront',
    mobile_app: 'Mobile app UI',
    dashboard: 'Dashboard interface',
    ai_chatbot: 'Chat interface',
    automation_tool: 'Automation tool UI',
    generic_ui: 'UI design',
  };

  const baseLabel = categoryLabels[categoryKey] || 'UI mockup';

  // If job heading is short and meaningful, combine with category
  if (jobHeading && jobHeading.length > 3 && jobHeading.length < 80) {
    return `${baseLabel} for "${jobHeading}"`;
  }

  return baseLabel;
}

// ============================================================
// Main decision function
// ============================================================

/**
 * Evaluates whether a Lovable mockup is appropriate for a given job/email.
 *
 * @param {Object|null} job   - Job row (job_heading, job_description_raw, job_description, category, sub_category, amount)
 * @param {Object|null} email - Email row (currently unused, reserved for future extension)
 * @returns {{ shouldBuild: boolean, projectType: string, whatToMockup: string|null, alternativeSuggestion: string|null }}
 */
function evaluateMockupDecision(job, email) {
  // Null safety: treat missing job as empty object
  const safeJob = job || {};

  // 1. Budget gate: block if amount > 0 AND < 1000
  const amount = parseFloat(safeJob.amount);
  if (!isNaN(amount) && amount > 0 && amount < 1000) {
    return {
      shouldBuild: false,
      projectType: 'low_budget',
      whatToMockup: null,
      alternativeSuggestion: 'Relevant case study instead',
    };
  }

  // 2. Assemble searchable text
  const parts = [
    safeJob.job_heading,
    safeJob.job_description_raw || safeJob.job_description,
    safeJob.category,
    safeJob.sub_category,
  ];
  const text = parts.filter(Boolean).join(' ');

  // Edge case: no text to analyze at all
  if (!text.trim()) {
    return {
      shouldBuild: false,
      projectType: 'unknown',
      whatToMockup: null,
      alternativeSuggestion: 'Unclear project type -- focus on insight in the reply',
    };
  }

  // 3. NO keyword check first (more restrictive)
  const noMatch = detectNoCategory(text);

  // 4. YES keyword check
  const yesMatch = detectYesCategory(text);

  // 5. Apply conflict resolution rules
  if (noMatch && yesMatch) {
    if (noMatch.isService) {
      // Service NO + YES = still NO (e.g., "SEO for e-commerce site")
      return {
        shouldBuild: false,
        projectType: noMatch.key,
        whatToMockup: null,
        alternativeSuggestion: noMatch.alternativeSuggestion,
      };
    } else {
      // Infra NO + YES = YES (e.g., "DevOps with monitoring dashboard")
      const jobHeading = (safeJob.job_heading || '').trim();
      return {
        shouldBuild: true,
        projectType: yesMatch.key,
        whatToMockup: inferWhatToMockup(text, yesMatch.key, jobHeading),
        alternativeSuggestion: null,
      };
    }
  }

  if (noMatch && !yesMatch) {
    // Pure NO match
    return {
      shouldBuild: false,
      projectType: noMatch.key,
      whatToMockup: null,
      alternativeSuggestion: noMatch.alternativeSuggestion,
    };
  }

  if (yesMatch) {
    // Pure YES match
    const jobHeading = (safeJob.job_heading || '').trim();
    return {
      shouldBuild: true,
      projectType: yesMatch.key,
      whatToMockup: inferWhatToMockup(text, yesMatch.key, jobHeading),
      alternativeSuggestion: null,
    };
  }

  // 6. Default: no match at all
  return {
    shouldBuild: false,
    projectType: 'unknown',
    whatToMockup: null,
    alternativeSuggestion: 'Unclear project type -- focus on insight in the reply',
  };
}

module.exports = { evaluateMockupDecision };
