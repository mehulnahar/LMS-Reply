'use strict';

/**
 * Pre-Generation Prefetch Utilities — PREFETCH-01, PREFETCH-02, PREFETCH-03
 *
 * Provides:
 *   ensureJobDescription() — Fetches job description from LeadHack if not cached on job record
 *   extractUrls()          — Extracts, deduplicates, and filters URLs from text sources
 *   analyzeUrl()           — Fetches a URL and extracts SEO/tech signals using Cheerio
 *   analyzeAllUrls()       — Runs analyzeUrl() sequentially on a list of URLs
 *
 * All functions follow CommonJS (require/module.exports).
 * No Express coupling — these are pure async helpers.
 */

const cheerio = require('cheerio');

const LEADHACK_BASE = 'https://app.leadhack.info:3000/api/admin';

// Domains that are irrelevant for client site analysis
const BLOCKED_DOMAINS = [
  'upwork.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'googleapis.com',
  'fbcdn.net',
  'doubleclick.net',
  'googletagmanager.com',
  'gstatic.com',
  'amazonaws.com',
];

// ============================================================
// ensureJobDescription
// ============================================================

/**
 * Ensures job.job_description_raw is populated.
 *
 * If already present: returns immediately (cache hit).
 * Otherwise: fetches from LeadHack API using email context.
 *
 * On success: updates job object in memory AND persists to DB.
 * On failure: throws Error with 'LeadHack prefetch failed:' prefix.
 *
 * @param {Object} job                  - job row from DB (mutated in place on success)
 * @param {Object} email                - email row (from_email, subject)
 * @param {string} anthropicKey         - (unused here, kept for API consistency)
 * @param {Object} leadhackCredentials  - { email: string, password: string }
 * @param {Object} pool                 - pg pool instance for DB persistence
 */
async function ensureJobDescription(job, email, anthropicKey, leadhackCredentials, pool) {
  // Cache hit — already have description in either field
  if (job.job_description_raw || job.job_description) {
    // Normalize: ensure job_description_raw is set for downstream consumers
    if (!job.job_description_raw && job.job_description) {
      job.job_description_raw = job.job_description;
    }
    return;
  }

  let token = null;

  // Authenticate with LeadHack if credentials provided
  if (leadhackCredentials && leadhackCredentials.email && leadhackCredentials.password) {
    try {
      const authController = new AbortController();
      const authTimeout = setTimeout(() => authController.abort(), 10000);

      const authRes = await fetch(`${LEADHACK_BASE}/getAuthToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: leadhackCredentials.email,
          password: leadhackCredentials.password,
        }),
        signal: authController.signal,
      });

      clearTimeout(authTimeout);

      if (authRes.ok) {
        const authData = await authRes.json();
        if (authData.token) {
          token = authData.token;
        }
      }
    } catch {
      // Auth failed — continue without token (API may work without it)
    }
  }

  // Fetch job details from LeadHack
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let lhData;
  try {
    const lhRes = await fetch(`${LEADHACK_BASE}/getJobDetails`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email_id: email.from_email,
        email_subject: email.subject,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!lhRes.ok) {
      throw new Error(`HTTP ${lhRes.status}`);
    }

    lhData = await lhRes.json();
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`LeadHack prefetch failed: ${err.message}`);
  }

  if (!lhData || !lhData.status || !lhData.data || lhData.data.length === 0) {
    throw new Error('LeadHack prefetch failed: No job data returned');
  }

  const jobData = lhData.data[0];
  const rawDescription = jobData.job_description || '';

  // Update in memory
  job.job_description_raw = rawDescription;

  // Persist to DB
  if (pool && job.id) {
    try {
      await pool.query(
        'UPDATE jobs SET job_description_raw = $1 WHERE id = $2',
        [rawDescription, job.id]
      );
    } catch (dbErr) {
      // Log but don't fail — in-memory update already happened
      console.error('prefetch: DB persist failed for job_description_raw:', dbErr.message);
    }
  }
}

// ============================================================
// extractUrls
// ============================================================

/**
 * Extracts, deduplicates, cleans, and filters URLs from one or more text sources.
 *
 * - Accepts variadic text strings
 * - Removes trailing punctuation from URLs
 * - Deduplicates via Set
 * - Filters blocked domains (upwork.com, linkedin.com, etc.)
 * - Skips URLs longer than 500 chars
 * - Caps output at 5 URLs
 * - Always returns an array (never null/undefined)
 *
 * @param {...string} textSources - Any number of plain-text strings
 * @returns {string[]} Array of up to 5 clean, valid, unblocked URLs
 */
function extractUrls(...textSources) {
  const URL_REGEX = /https?:\/\/[^\s"'<>)\]]+/g;
  const seen = new Set();
  const results = [];

  for (const text of textSources) {
    if (!text || typeof text !== 'string') continue;

    const matches = text.match(URL_REGEX) || [];

    for (let url of matches) {
      // Skip overly long URLs (likely tracking garbage)
      if (url.length > 500) continue;

      // Clean trailing punctuation
      url = url.replace(/[.,;:!?)\]]+$/, '');

      // Deduplicate
      if (seen.has(url)) continue;
      seen.add(url);

      // Parse hostname for domain check
      let hostname;
      try {
        hostname = new URL(url).hostname.replace('www.', '');
      } catch {
        // Malformed URL — skip
        continue;
      }

      // Filter blocked domains
      const isBlocked = BLOCKED_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith('.' + domain)
      );
      if (isBlocked) continue;

      results.push(url);

      // Cap at 5
      if (results.length >= 5) break;
    }

    if (results.length >= 5) break;
  }

  return results;
}

// ============================================================
// extractColorsFromHtml (internal helper — not exported)
// ============================================================

// Common non-brand colors to filter out (lowercase, normalized)
const NON_BRAND_COLORS = new Set([
  '#000', '#000000',
  '#fff', '#ffffff',
  '#333', '#333333',
  '#666', '#666666',
  '#999', '#999999',
  '#ccc', '#cccccc',
]);

const HEX_REGEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
const RGB_REGEX = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)/g;

/**
 * Extracts brand-relevant colors from HTML via Cheerio instance.
 *
 * Scans:
 *   1. All elements with style="" attributes
 *   2. All <style> tag contents
 *   3. <meta name="theme-color"> content
 *
 * Filters out common non-brand colors (black, white, grays).
 * Returns up to 10 unique colors. Returns [] if none found.
 *
 * @param {CheerioAPI} $ - Cheerio instance loaded with HTML
 * @returns {string[]} Array of color strings (hex and rgb/rgba)
 */
function extractColorsFromHtml($) {
  const seen = new Set();
  const colors = [];

  /**
   * Adds colors from a text string, deduplicating and filtering.
   */
  function collectFromText(text) {
    if (!text) return;

    // Extract hex colors
    const hexMatches = text.match(HEX_REGEX) || [];
    for (const hex of hexMatches) {
      const normalized = hex.toLowerCase();
      if (NON_BRAND_COLORS.has(normalized)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      colors.push(hex);
      if (colors.length >= 10) return;
    }

    if (colors.length >= 10) return;

    // Extract rgb/rgba colors
    const rgbMatches = text.match(RGB_REGEX) || [];
    for (const rgb of rgbMatches) {
      const normalized = rgb.replace(/\s+/g, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      colors.push(rgb);
      if (colors.length >= 10) return;
    }
  }

  // 1. Scan elements with style attributes
  $('[style]').each(function () {
    if (colors.length >= 10) return false;
    const styleVal = $(this).attr('style') || '';
    collectFromText(styleVal);
  });

  // 2. Scan <style> tag contents
  if (colors.length < 10) {
    $('style').each(function () {
      if (colors.length >= 10) return false;
      const cssText = $(this).html() || '';
      collectFromText(cssText);
    });
  }

  // 3. Check <meta name="theme-color">
  if (colors.length < 10) {
    const themeColor = $('meta[name="theme-color"]').attr('content');
    if (themeColor) {
      collectFromText(themeColor);
    }
  }

  return colors;
}

// ============================================================
// analyzeUrl
// ============================================================

/**
 * Fetches a URL and extracts SEO + tech signals using Cheerio.
 *
 * - AbortController with 5000ms timeout (MANDATORY — never omits)
 * - Returns structured result object — never throws
 * - Errors go in result.error field
 *
 * @param {string} url - The URL to analyze
 * @returns {Promise<Object>} Result object with url, status, title, description, h1, techStack, findings, bestFindingForReply, error?
 */
async function analyzeUrl(url) {
  const result = {
    url,
    status: null,
    title: null,
    description: null,
    h1: null,
    techStack: [],
    colors: [],
    findings: [],
    bestFindingForReply: null,
    error: null,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LMSReply/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    clearTimeout(timeout);
    result.status = res.status;

    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      result.findings.push(`Site returned ${res.status} error`);
      result.bestFindingForReply = result.findings[0] || null;
      return result;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Extract basic metadata
    result.title = $('title').text().trim() || null;
    result.description = $('meta[name="description"]').attr('content') || null;
    result.h1 = $('h1').first().text().trim() || null;

    // Detect tech stack from script srcs
    const techFromScripts = [];
    const techPatterns = [
      { pattern: /react/i, name: 'React' },
      { pattern: /vue/i, name: 'Vue' },
      { pattern: /angular/i, name: 'Angular' },
      { pattern: /jquery/i, name: 'jQuery' },
      { pattern: /shopify/i, name: 'Shopify' },
      { pattern: /wp-content/i, name: 'WordPress' },
    ];

    $('script[src]').each(function () {
      const src = $(this).attr('src') || '';
      for (const { pattern, name } of techPatterns) {
        if (pattern.test(src) && !techFromScripts.includes(name)) {
          techFromScripts.push(name);
        }
      }
    });

    // Detect tech from meta generator
    const generator = $('meta[name="generator"]').attr('content') || '';
    const generatorPatterns = ['WordPress', 'Shopify', 'Wix', 'Squarespace'];
    for (const gen of generatorPatterns) {
      if (generator.includes(gen) && !techFromScripts.includes(gen)) {
        techFromScripts.push(gen);
      }
    }

    result.techStack = techFromScripts;

    // Extract brand colors from HTML
    result.colors = extractColorsFromHtml($);

    // Build findings: tech signals
    for (const tech of result.techStack) {
      result.findings.push(`Built with ${tech}`);
    }

    // Build findings: SEO gaps
    if (!result.description) {
      result.findings.push('Missing meta description');
    }

    if (!result.h1) {
      result.findings.push('No H1 heading found');
    }

    const imgsWithoutAlt = $('img:not([alt])').length;
    if (imgsWithoutAlt > 0) {
      result.findings.push(`${imgsWithoutAlt} image(s) missing alt text`);
    }

    const hasViewport = $('meta[name="viewport"]').length > 0;
    if (!hasViewport) {
      result.findings.push('Missing viewport meta tag (not mobile-friendly)');
    }

    result.bestFindingForReply = result.findings[0] || null;
  } catch (err) {
    clearTimeout(timeout);

    if (err.name === 'AbortError') {
      result.error = 'Fetch timed out (5s limit)';
    } else {
      result.error = err.message;
    }

    result.bestFindingForReply = result.findings[0] || null;
  }

  return result;
}

// ============================================================
// analyzeAllUrls
// ============================================================

/**
 * Analyzes multiple URLs sequentially (not in parallel — avoids Railway timeouts).
 *
 * @param {string[]} urls - Array of URLs to analyze
 * @returns {Promise<Object[]>} Array of analyzeUrl() result objects
 */
async function analyzeAllUrls(urls) {
  if (!urls || urls.length === 0) return [];

  const results = [];
  for (const url of urls) {
    const result = await analyzeUrl(url);
    results.push(result);
  }
  return results;
}

module.exports = { ensureJobDescription, extractUrls, analyzeUrl, analyzeAllUrls };
