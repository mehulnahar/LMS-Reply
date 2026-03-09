/**
 * Research Agent - Finds less-known, high-quality similar live examples
 *
 * Architecture: Exa (discovery) + Olostep (verification) + Claude Sonnet (quality)
 *
 * Flow:
 * 1. Exa neural search finds 15 candidates (websites + apps)
 * 2. Olostep /scrapes visits top candidates, extracts real content
 * 3. Claude Sonnet analyzes scraped content, picks best 3-5 verified examples
 * 4. Returns structured examples ready for <similar_examples> context block
 *
 * Quality filters:
 * - Must be live and functional
 * - Must be lesser-known (no major brands)
 * - Must be well-built (polished UI, real users)
 * - Must not show obvious developer/agency attribution
 * - Must be relevant to client's project type
 */

const WELL_KNOWN_DOMAINS = [
  // Major brands
  'amazon.com', 'shopify.com', 'wix.com', 'squarespace.com', 'wordpress.com',
  'nike.com', 'adidas.com', 'zara.com', 'hm.com', 'target.com', 'walmart.com',
  'ebay.com', 'etsy.com', 'alibaba.com', 'aliexpress.com', 'temu.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'linkedin.com', 'reddit.com', 'pinterest.com',
  'medium.com', 'wikipedia.org', 'forbes.com', 'techcrunch.com',
  'apple.com', 'google.com', 'microsoft.com', 'netflix.com', 'spotify.com',
  'uber.com', 'airbnb.com', 'booking.com',
  // Content/listing sites (not end products)
  'upwork.com', 'fiverr.com', 'freelancer.com', 'toptal.com',
  'dribbble.com', 'behance.net', 'clutch.co', 'goodfirms.co',
  'themeforest.net', 'templatemonster.com', 'envato.com',
  'github.com', 'stackoverflow.com', 'producthunt.com',
  // Theme sellers and app marketplaces (sell tools, not end products)
  'apps.shopify.com', 'themes.shopify.com',
  'magespark.com', 'shaimastudio.com', 'aestheticecom.com',
  'out-of-the-sandbox.com', 'pixelunion.net',
  'hulkapps.com', 'vowelweb.com', 'gplpixel.com', 'templatetrip.com',
  'pickyourapp.com', 'themewagon.com', 'themeisle.com', 'theme-jeuno.myshopify.com',
  'boostheme.com', 'theme-jeuno.myshopify.com', 'shogun.io',
];

const VALID_CLASSIFICATIONS = ['BUILD', 'SERVICE', 'TOO_NARROW'];

const VALID_PROJECT_TYPES = [
  'ecommerce', 'website', 'web_app', 'saas', 'dashboard',
  'mobile_app', 'automation', 'integration', 'marketplace', 'landing_page',
];

// ────────────────────────────────────────────────────────────
// 0. Classify job + refine into Exa search queries (combined Sonnet call)
// ────────────────────────────────────────────────────────────
async function classifyAndRefine(projectDescription, anthropicKey) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Analyze this project/job description and do TWO things:

1. CLASSIFY the project:
   - BUILD: Client wants a product, platform, website, app, store, dashboard, or tool BUILT or significantly customized. Examples: "build me a Shopify store", "need a SaaS dashboard", "create a mobile app", "custom WordPress site"
   - SERVICE: Client wants an ongoing SERVICE provider (SEO specialist, ads manager, developer on retainer, consultant, QA tester, virtual assistant). Work is continuous/recurring, not a discrete deliverable.
   - TOO_NARROW: Project is too internal, niche, or abstract for portfolio matches. Examples: "fix bugs in existing codebase", "single button integration in Odoo", "accreditation compliance paperwork"

2. EXTRACT TAGS and generate search queries (only if BUILD):
   - industry: single word (fashion, healthcare, realestate, fintech, marketing, motorsport, saas, education, food, travel, fitness, beauty, automotive, legal, nonprofit, gaming, crypto, hr, logistics)
   - technologies: array of techs mentioned or implied (shopify, wordpress, react, nextjs, vue, angular, ghl, odoo, gcp, aws, n8n, woocommerce, magento, laravel, django, flutter, python, nodejs)
   - projectType: one of: ecommerce, website, web_app, saas, dashboard, mobile_app, automation, integration, marketplace, landing_page
   - queries: 2-3 Exa neural search queries to find REAL LIVE examples of this type of product (only if BUILD)

Return ONLY valid JSON, no explanation:
{"classification":"BUILD","reason":"one sentence why","tags":{"industry":"...","technologies":["..."],"projectType":"..."},"queries":["query1","query2"]}

If SERVICE or TOO_NARROW, return empty queries array and still fill tags as best you can.

QUERY RULES (only when BUILD):
- Find REAL BUSINESSES with the type of product the client wants
- Under 15 words each
- NEVER use: "agency", "developer", "freelancer", "designer", "portfolio", "services", "theme", "template"
- DO use: "shop", "store", "buy", "brand", "boutique", "platform", "tool", "app"

Project description: ${projectDescription.substring(0, 800)}`,
    }],
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Sonnet classify+refine failed: ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Try to parse as JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const classification = VALID_CLASSIFICATIONS.includes(parsed.classification)
        ? parsed.classification
        : 'BUILD';
      const tags = parsed.tags || {};
      // Validate projectType
      if (tags.projectType && !VALID_PROJECT_TYPES.includes(tags.projectType)) {
        tags.projectType = 'website';
      }
      // Ensure technologies is an array
      if (!Array.isArray(tags.technologies)) {
        tags.technologies = [];
      }
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries.filter(q => typeof q === 'string' && q.length > 5)
        : [];
      return {
        classification,
        tags,
        reason: parsed.reason || '',
        queries: queries.length > 0 ? queries : (classification === 'BUILD' ? [projectDescription] : []),
      };
    }

    // Fallback: treat as plain-text queries (old format), default to BUILD
    console.warn('research: classifyAndRefine returned non-JSON, falling back to BUILD');
    const queries = text.split('\n').map(q => q.trim()).filter(q => q.length > 5);
    return {
      classification: 'BUILD',
      tags: {},
      reason: 'Fallback - could not parse classification',
      queries: queries.length > 0 ? queries : [projectDescription],
    };
  } catch (err) {
    console.warn('research: classifyAndRefine failed, defaulting to BUILD:', err.message);
    return {
      classification: 'BUILD',
      tags: {},
      reason: 'Fallback - classification error',
      queries: [projectDescription],
    };
  }
}

/**
 * @deprecated Use classifyAndRefine() instead. Kept for backward compatibility.
 * Returns just the queries array (old behavior).
 */
async function refineSearchQuery(projectDescription, anthropicKey) {
  const result = await classifyAndRefine(projectDescription, anthropicKey);
  return result.queries;
}

// ────────────────────────────────────────────────────────────
// 1. Discover candidates via Exa neural search
// ────────────────────────────────────────────────────────────
async function searchExa(query, exaApiKey, options = {}) {
  const numResults = options.numResults || 15;
  const excludeDomains = options.excludeDomains || WELL_KNOWN_DOMAINS;

  const body = {
    query,
    type: 'neural',
    numResults,
    excludeDomains,
    contents: {
      text: { maxCharacters: 500 },
      highlights: { numSentences: 2 },
    },
  };

  // Optional: filter by category (company, personal site, etc.)
  if (options.category) {
    body.category = options.category;
  }

  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': exaApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'unknown');
    throw new Error(`Exa API error: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  return (data.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    text: r.text || '',
    highlights: r.highlights || [],
    publishedDate: r.publishedDate || null,
  }));
}

// ────────────────────────────────────────────────────────────
// 2. Verify and extract content via Olostep /scrapes
// ────────────────────────────────────────────────────────────
async function scrapeWithOlostep(url, olostepApiKey) {
  const body = {
    url_to_scrape: url,
    formats: ['markdown'],
    wait_before_scraping: 2000,
    // Remove common noise elements
    remove_css_selectors: ['nav', 'footer', '.cookie-banner', '.popup', '.modal'],
  };

  const res = await fetch('https://api.olostep.com/v1/scrapes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${olostepApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'unknown');
    throw new Error(`Olostep API error: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  return {
    markdown: data.result?.markdown_content || '',
    statusCode: data.result?.page_metadata?.status_code || 0,
    pageTitle: data.result?.page_metadata?.title || '',
    links: data.result?.links_on_page || [],
  };
}

/**
 * Scrape multiple URLs in parallel with graceful failure handling.
 * Returns only successful scrapes.
 */
async function scrapeMultiple(urls, olostepApiKey, maxConcurrent = 5) {
  const toScrape = urls.slice(0, maxConcurrent);
  const results = await Promise.all(
    toScrape.map(async (url) => {
      try {
        const scraped = await scrapeWithOlostep(url, olostepApiKey);
        // Only count as success if page loaded (2xx status or unknown)
        if (scraped.statusCode >= 400) {
          return { url, success: false, reason: `HTTP ${scraped.statusCode}` };
        }
        return { url, success: true, ...scraped };
      } catch (err) {
        console.warn(`research: Olostep scrape failed for ${url}: ${err.message}`);
        return { url, success: false, reason: err.message };
      }
    })
  );
  return results;
}

// ────────────────────────────────────────────────────────────
// 3. Claude Sonnet deep quality analysis
// ────────────────────────────────────────────────────────────
async function analyzeWithSonnet(scrapedResults, projectDescription, anthropicKey) {
  const successfulScrapes = scrapedResults.filter(r => r.success);
  if (successfulScrapes.length === 0) return [];

  // Log what we're sending to Sonnet for debugging
  console.log(`research: Analyzing ${successfulScrapes.length} scraped sites with Sonnet:`);
  successfulScrapes.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.url} (title: "${r.pageTitle}")`);
  });

  // Build context from scraped content (truncate each to keep within limits)
  const siteSummaries = successfulScrapes.map((r, i) => {
    const contentPreview = (r.markdown || '').substring(0, 2000);
    return `--- SITE ${i + 1}: ${r.url} ---
Title: ${r.pageTitle}
Content preview:
${contentPreview}
`;
  }).join('\n');

  const systemPrompt = `You select websites that a software agency can present as portfolio examples ("we built this") to a client.

The client wants a specific END PRODUCT built. You must find sites that ARE that type of product - sites where real customers visit, browse, and buy/use things.

THE KEY TEST: Would a real customer use this site to buy a product or use a service? If YES -> INCLUDE. If the site sells developer tools, themes, or services to OTHER businesses -> EXCLUDE.

4 hard exclusions:
1. Dev agencies / design studios / freelancer portfolios (sell development services)
2. Theme/template sellers (sites where you BUY a theme - look for "add to cart" for a theme, pricing for themes, "download theme", "buy theme")
3. Blog posts, articles, or directories
4. Fortune 500 household brands (Nike, Amazon, Zara, etc.)

BE GENEROUS with everything else. A store with few products? INCLUDE. Different platform? INCLUDE. Slightly different niche? INCLUDE. "Powered by Shopify" in footer? INCLUDE. Thin scrape content but URL looks like a real store? INCLUDE.

For each site, return JSON:
- name: Brand/project name (NOT the theme name - the BRAND name)
- url: Exact URL
- pitch_angle: One sentence as if agency built it
- key_features: Array of 2-3 features matching client needs
- platform_type: "website" | "web_app" | "mobile_app" | "saas"

Return a JSON array. Aim for 3-5 sites minimum.`;

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Client's project description: ${projectDescription}\n\nScraped sites to evaluate:\n${siteSummaries}`,
    }],
    system: systemPrompt,
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Claude API error analyzing results: ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '[]';

  // Log Sonnet's full response for debugging
  console.log(`research: Sonnet analysis response (${text.length} chars): ${text.substring(0, 500)}`);

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('research: Sonnet returned no JSON array. Full text:', text.substring(0, 300));
      return [];
    }
    const examples = JSON.parse(jsonMatch[0]);
    console.log(`research: Sonnet selected ${Array.isArray(examples) ? examples.length : 0} examples`);
    return Array.isArray(examples) ? examples : [];
  } catch (parseErr) {
    console.warn('research: Failed to parse Sonnet JSON:', parseErr.message, 'Text:', text.substring(0, 200));
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// 4. De-duplicate results
// ────────────────────────────────────────────────────────────
function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = (r.url || '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ────────────────────────────────────────────────────────────
// 5. Build <similar_examples> context block for reply prompt
// ────────────────────────────────────────────────────────────
function buildSimilarExamplesBlock(examples) {
  if (!examples || examples.length === 0) return '';

  const exampleLines = examples.map((ex, i) => {
    const features = (ex.key_features || []).join(', ');
    return `${i + 1}. ${ex.name} (${ex.url})
   Pitch: ${ex.pitch_angle}
   Key features: ${features}
   Type: ${ex.platform_type || 'website'}`;
  }).join('\n\n');

  return `\n\n<similar_examples>
You have verified live projects similar to the client's request.
Present 1-2 of the most relevant ones as projects YOUR TEAM has built.

RULES:
- Say "we built" or "we developed" or "here's a recent project we worked on"
- NEVER say "check out this example" or "here's a similar site I found"
- Reference a SPECIFIC feature that matches what the client asked for
- Weave the reference naturally into your reply - do not create a separate "portfolio" section
- Include the URL so the client can visit and see a real, working product
- If the client's project is for a mobile app, only reference mobile app examples

${exampleLines}
</similar_examples>`;
}

// ────────────────────────────────────────────────────────────
// 6. Main orchestrator
// ────────────────────────────────────────────────────────────
async function researchSimilarExamples(projectDescription, anthropicKey, exaKey, olostepKey, options = {}) {
  const { forceResearch = false } = options;

  // Step 0: Classify job + refine into search queries (single Sonnet call)
  const classResult = await classifyAndRefine(projectDescription, anthropicKey);
  const { classification, tags, reason, queries: searchQueries } = classResult;
  console.log(`research: Classification=${classification}, reason="${reason}", queries=${searchQueries.length}`);
  if (tags.industry) console.log(`research: Tags - industry=${tags.industry}, projectType=${tags.projectType}, tech=[${(tags.technologies || []).join(', ')}]`);

  // Gate: Skip expensive pipeline for non-BUILD jobs (unless forced)
  if (classification !== 'BUILD' && !forceResearch) {
    console.log(`research: Skipping pipeline - ${classification} (forceResearch=${forceResearch})`);
    return {
      examples: [],
      rawResultCount: 0,
      scrapedCount: 0,
      contextBlock: '',
      debug: { searchQueries: [] },
      classification,
      tags,
      reason,
      skipped: true,
    };
  }

  if (forceResearch && classification !== 'BUILD') {
    console.log(`research: Force research override - running pipeline despite ${classification} classification`);
  }

  console.log(`research: Refined into ${searchQueries.length} search queries:`, searchQueries);

  // Step 1: Discover candidates via Exa neural search
  // Strategy: Use first query with category="company" (finds real businesses via entity matching)
  // Then use remaining queries without category but with excludeDomains (broader net)
  const allResults = [];

  // First query: company category (better at finding real businesses, but no excludeDomains)
  if (searchQueries.length > 0) {
    try {
      const results = await searchExa(searchQueries[0], exaKey, {
        numResults: 12,
        category: 'company',
      });
      console.log(`research: Exa company query "${searchQueries[0].substring(0, 60)}" returned ${results.length} results`);
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.url} - "${r.title}"`));
      allResults.push(...results);
    } catch (err) {
      console.warn(`research: Exa company search failed, trying without category...`);
      try {
        const results = await searchExa(searchQueries[0], exaKey, { numResults: 12, excludeDomains: WELL_KNOWN_DOMAINS });
        allResults.push(...results);
      } catch (retryErr) {
        console.warn(`research: Exa search fully failed for query 1:`, retryErr.message);
      }
    }
  }

  // Remaining queries: broader search with domain exclusions
  for (const query of searchQueries.slice(1, 3)) {
    try {
      const results = await searchExa(query, exaKey, {
        numResults: 12,
        excludeDomains: WELL_KNOWN_DOMAINS,
      });
      console.log(`research: Exa query "${query.substring(0, 60)}" returned ${results.length} results`);
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.url} - "${r.title}"`));
      allResults.push(...results);
    } catch (err) {
      console.warn(`research: Exa search failed for "${query}":`, err.message);
    }
  }

  const uniqueResults = deduplicateResults(allResults);

  if (uniqueResults.length === 0) {
    return {
      examples: [], rawResultCount: 0, scrapedCount: 0, contextBlock: '',
      debug: { searchQueries }, classification, tags, reason, skipped: false,
    };
  }

  // Step 2: Scrape top candidates with Olostep (max 10 to balance cost vs coverage)
  const urlsToScrape = uniqueResults.slice(0, 10).map(r => r.url);
  const scrapedResults = await scrapeMultiple(urlsToScrape, olostepKey, 10);

  // Enrich scrape results with Exa's original text snippets (helps Sonnet when scrape is thin)
  for (const scraped of scrapedResults) {
    if (scraped.success && (!scraped.markdown || scraped.markdown.length < 100)) {
      const exaResult = uniqueResults.find(r => r.url === scraped.url);
      if (exaResult && exaResult.text) {
        scraped.markdown = (scraped.markdown || '') + '\n\nExa snippet: ' + exaResult.text;
      }
    }
  }

  const successCount = scrapedResults.filter(r => r.success).length;
  if (successCount === 0) {
    return {
      examples: [], rawResultCount: uniqueResults.length, scrapedCount: 0, contextBlock: '',
      debug: { searchQueries }, classification, tags, reason, skipped: false,
    };
  }

  // Step 3: Claude Sonnet deep analysis on scraped content
  const examples = await analyzeWithSonnet(scrapedResults, projectDescription, anthropicKey);

  // Step 4: Build context block for reply prompt injection
  const contextBlock = buildSimilarExamplesBlock(examples);

  // Debug info: include search queries, all discovered URLs, and scraped URLs
  const debug = {
    searchQueries,
    discoveredUrls: uniqueResults.slice(0, 15).map(r => ({ url: r.url, title: r.title })),
    scrapedUrls: scrapedResults.map(r => ({
      url: r.url,
      success: r.success,
      title: r.pageTitle || r.reason || '',
    })),
  };

  return {
    examples: examples.slice(0, 5),
    rawResultCount: uniqueResults.length,
    scrapedCount: successCount,
    contextBlock,
    debug,
    classification,
    tags,
    reason,
    skipped: false,
  };
}

module.exports = {
  classifyAndRefine,
  refineSearchQuery,
  searchExa,
  scrapeWithOlostep,
  scrapeMultiple,
  analyzeWithSonnet,
  deduplicateResults,
  buildSimilarExamplesBlock,
  researchSimilarExamples,
  WELL_KNOWN_DOMAINS,
  VALID_CLASSIFICATIONS,
  VALID_PROJECT_TYPES,
};
