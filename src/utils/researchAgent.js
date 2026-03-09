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
// 0. Refine project description into Exa search query via Haiku
// ────────────────────────────────────────────────────────────
async function refineSearchQuery(projectDescription, anthropicKey) {
  const body = {
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Convert this project/job description into 1-2 short Exa neural search queries to find LIVE websites or apps similar to what the client needs. Return ONLY the search queries, one per line, no numbering or bullets.

Project description: ${projectDescription.substring(0, 500)}

Rules:
- Search for LIVE EXAMPLES of the end product, NOT job listings or articles
- Be specific about the industry/niche (e.g. "fashion dropshipping Shopify store" not "Shopify store")
- Include platform if relevant (e.g. "Shopify", "WordPress", "React")
- Keep each query under 15 words`,
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

    if (!res.ok) throw new Error(`Haiku query refine failed: ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const queries = text.split('\n').map(q => q.trim()).filter(q => q.length > 5);
    return queries.length > 0 ? queries : [projectDescription];
  } catch (err) {
    console.warn('research: Query refinement failed, using raw description:', err.message);
    return [projectDescription];
  }
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
    const contentPreview = (r.markdown || '').substring(0, 1500);
    return `--- SITE ${i + 1}: ${r.url} ---
Title: ${r.pageTitle}
Content preview:
${contentPreview}
`;
  }).join('\n');

  const systemPrompt = `You are a research assistant for a software agency. Given scraped website content and a project description, find sites the agency could reference as portfolio examples in a sales email.

BE GENEROUS WITH SELECTIONS. Your job is to find usable examples, not to be a strict gatekeeper. If a site is a real, functioning website that's even somewhat relevant to the project, INCLUDE IT.

INCLUDE a site if:
- It is a REAL, live website (not a blog post, article, or directory)
- It has SOME relevance to the client's project (same industry, similar features, or similar platform)
- It is not a major household brand (Nike, Zara, Amazon, etc.)
- "Powered by Shopify", "Built with WordPress", etc. in footer is FINE - do NOT exclude for this

ONLY EXCLUDE if:
- It is a blog post, article, listicle, or directory (NOT an actual website/store/app)
- It prominently credits a specific agency ("Built by DevAgency LLC")
- It is a Fortune 500 / household brand everyone would recognize
- The page clearly failed to load or is a parking page

For each selected site, return:
- name: The brand/project name
- url: The exact URL
- pitch_angle: One sentence pitch as if the agency built it, highlighting relevance to the client
- key_features: Array of 2-3 visible features that match what the client needs
- platform_type: "website" | "web_app" | "mobile_app" | "saas"

Return a JSON array with ALL qualifying sites (aim for 3-5). Be generous - it's better to include a borderline site than to return nothing.`;

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
async function researchSimilarExamples(projectDescription, anthropicKey, exaKey, olostepKey) {
  // Step 0: Refine project description into targeted search queries
  const searchQueries = await refineSearchQuery(projectDescription, anthropicKey);
  console.log(`research: Refined into ${searchQueries.length} search queries:`, searchQueries);

  // Step 1: Discover candidates via Exa neural search (run all queries)
  const allResults = [];
  for (const query of searchQueries.slice(0, 2)) {
    try {
      const results = await searchExa(query, exaKey, {
        numResults: 12,
        excludeDomains: WELL_KNOWN_DOMAINS,
        category: 'company',
      });
      console.log(`research: Exa query "${query.substring(0, 60)}" returned ${results.length} results`);
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.url} - "${r.title}"`));
      allResults.push(...results);
    } catch (err) {
      // Retry without category filter if it fails (Exa may not support it for all queries)
      console.warn(`research: Exa with category failed for "${query}", retrying without category...`);
      try {
        const results = await searchExa(query, exaKey, { numResults: 12, excludeDomains: WELL_KNOWN_DOMAINS });
        console.log(`research: Exa retry returned ${results.length} results`);
        allResults.push(...results);
      } catch (retryErr) {
        console.warn(`research: Exa search fully failed for "${query}":`, retryErr.message);
      }
    }
  }

  const uniqueResults = deduplicateResults(allResults);

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
  refineSearchQuery,
  searchExa,
  scrapeWithOlostep,
  scrapeMultiple,
  analyzeWithSonnet,
  deduplicateResults,
  buildSimilarExamplesBlock,
  researchSimilarExamples,
  WELL_KNOWN_DOMAINS,
};
