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
  'amazon.com', 'shopify.com', 'wix.com', 'squarespace.com', 'wordpress.com',
  'nike.com', 'adidas.com', 'zara.com', 'hm.com', 'target.com', 'walmart.com',
  'ebay.com', 'etsy.com', 'alibaba.com', 'aliexpress.com', 'temu.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'linkedin.com', 'reddit.com', 'pinterest.com',
  'medium.com', 'wikipedia.org', 'forbes.com', 'techcrunch.com',
  'apple.com', 'google.com', 'microsoft.com', 'netflix.com', 'spotify.com',
  'uber.com', 'airbnb.com', 'booking.com',
];

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

  // Build context from scraped content (truncate each to keep within limits)
  const siteSummaries = successfulScrapes.map((r, i) => {
    const contentPreview = (r.markdown || '').substring(0, 1500);
    return `--- SITE ${i + 1}: ${r.url} ---
Title: ${r.pageTitle}
Content preview:
${contentPreview}
`;
  }).join('\n');

  const systemPrompt = `You are an expert project evaluator for a software development agency. Given scraped website/app content and a client's project description, select the BEST 3-5 examples that the agency can present as their own work in a sales reply.

SELECTION CRITERIA (ALL must be met):
1. LIVE AND POLISHED - The site/app must appear professional, well-designed, and fully functional
2. RELEVANT - Must be genuinely similar to the client's project type, industry, or features
3. LESSER-KNOWN - Not a household name or major brand. Indie, niche, or regional projects are ideal
4. NO VISIBLE ATTRIBUTION - Skip if the content shows "Built by [Agency]", "Developed by [Company]", or "Powered by [Platform]" prominently in footer/about page
5. CLAIMABLE - Someone could believably say "we built this" without easy contradiction

For each selected example, return:
- name: The project/brand name
- url: The exact URL
- pitch_angle: One sentence describing what makes this project impressive AND relevant to the client's needs. Write this as if you're the agency describing their own work. Example: "We built a fashion e-commerce platform with AI-powered size recommendations and a lookbook-to-cart flow that increased conversions by creating a seamless discovery experience"
- key_features: Array of 2-3 specific features visible on the site that match what the client needs
- platform_type: "website" | "web_app" | "mobile_app" | "saas"

EXCLUDE:
- Blog posts, articles, directories, or listicles
- Template demos or placeholder sites
- Sites that are clearly under construction
- Sites with prominent developer/agency credits
- Major well-known brands or Fortune 500 companies
- Sites that look outdated or poorly maintained

Return ONLY a JSON array. If fewer than 3 qualify, return what you have. If none qualify, return [].`;

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

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const examples = JSON.parse(jsonMatch[0]);
    return Array.isArray(examples) ? examples : [];
  } catch {
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
async function researchSimilarExamples(projectDescription, anthropicKey, exaKey, olostepKey) {
  // Step 1: Discover candidates via Exa neural search
  const exaResults = await searchExa(
    projectDescription,
    exaKey,
    { numResults: 15, excludeDomains: WELL_KNOWN_DOMAINS }
  );

  const uniqueResults = deduplicateResults(exaResults);

  if (uniqueResults.length === 0) {
    return { examples: [], rawResultCount: 0, scrapedCount: 0, contextBlock: '' };
  }

  // Step 2: Scrape top candidates with Olostep (max 8 to balance cost vs coverage)
  const urlsToScrape = uniqueResults.slice(0, 8).map(r => r.url);
  const scrapedResults = await scrapeMultiple(urlsToScrape, olostepKey, 8);

  const successCount = scrapedResults.filter(r => r.success).length;
  if (successCount === 0) {
    return { examples: [], rawResultCount: uniqueResults.length, scrapedCount: 0, contextBlock: '' };
  }

  // Step 3: Claude Sonnet deep analysis on scraped content
  const examples = await analyzeWithSonnet(scrapedResults, projectDescription, anthropicKey);

  // Step 4: Build context block for reply prompt injection
  const contextBlock = buildSimilarExamplesBlock(examples);

  return {
    examples: examples.slice(0, 5),
    rawResultCount: uniqueResults.length,
    scrapedCount: successCount,
    contextBlock,
  };
}

module.exports = {
  searchExa,
  scrapeWithOlostep,
  scrapeMultiple,
  analyzeWithSonnet,
  deduplicateResults,
  buildSimilarExamplesBlock,
  researchSimilarExamples,
  WELL_KNOWN_DOMAINS,
};
