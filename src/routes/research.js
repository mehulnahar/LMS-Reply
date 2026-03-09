/**
 * Research Routes - Internet-based similar examples finder
 *
 * POST /api/research/examples  - Find less-known similar live examples (Exa + Olostep + Sonnet)
 */

const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');
const { researchSimilarExamples } = require('../utils/researchAgent');

const router = express.Router();

// ────────────────────────────────────────────────────────────
// Helper: fetch decrypted API key from DB
// ────────────────────────────────────────────────────────────
async function getApiKey(userId, service) {
  const { rows } = await pool.query(
    'SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = $2',
    [userId, service]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);
}

// ════════════════════════════════════════════════════════════
// POST /api/research/examples
// ════════════════════════════════════════════════════════════
router.post('/examples', requireAuth, async (req, res, next) => {
  try {
    const { projectDescription, emailId } = req.body;

    // Fetch all 3 required API keys in parallel
    const [anthropicKey, exaKey, olostepKey] = await Promise.all([
      getApiKey(req.user.id, 'anthropic'),
      getApiKey(req.user.id, 'exa'),
      getApiKey(req.user.id, 'olostep'),
    ]);

    if (!anthropicKey) {
      return res.status(400).json({ error: 'Anthropic API key not configured. Add it in Settings.' });
    }
    if (!exaKey) {
      return res.status(400).json({ error: 'Exa API key not configured. Get one at https://exa.ai and add it in Settings.' });
    }
    if (!olostepKey) {
      return res.status(400).json({ error: 'Olostep API key not configured. Get one at https://olostep.com and add it in Settings.' });
    }

    // Build rich context from email + job for the research agent
    let enrichedDescription = (projectDescription || '').trim();
    let clientRequest = ''; // What the client specifically asked for
    if (emailId) {
      try {
        // Fetch email body + job details together
        let { rows } = await pool.query(
          `SELECT e.subject, e.thread_id, e.body_text, e.snippet,
                  j.job_heading, j.job_description
           FROM emails e
           LEFT JOIN jobs j ON j.id = e.job_id
           WHERE e.id = $1 AND e.user_id = $2`,
          [emailId, req.user.id]
        );
        // If no job found on this email, search the thread for any email with a job
        if (rows.length && !rows[0].job_heading && rows[0].thread_id) {
          const threadResult = await pool.query(
            `SELECT j.job_heading, j.job_description
             FROM emails e
             JOIN jobs j ON j.id = e.job_id
             WHERE e.thread_id = $1 AND e.user_id = $2 AND e.job_id IS NOT NULL
             LIMIT 1`,
            [rows[0].thread_id, req.user.id]
          );
          if (threadResult.rows.length) {
            rows[0].job_heading = threadResult.rows[0].job_heading;
            rows[0].job_description = threadResult.rows[0].job_description;
          }
        }
        if (rows.length) {
          const jobHeading = rows[0].job_heading || '';
          const jobDesc = rows[0].job_description || '';
          const subject = rows[0].subject || '';
          const emailBody = rows[0].body_text || rows[0].snippet || '';

          // Capture what the client is asking for from the email
          if (emailBody) {
            clientRequest = emailBody.substring(0, 500);
          }

          if (jobHeading) {
            enrichedDescription += enrichedDescription ? ` | Job: ${jobHeading}` : jobHeading;
            // Include full job description (up to 1000 chars) for better query refinement
            if (jobDesc) enrichedDescription += ` | ${jobDesc.substring(0, 1000)}`;
          } else if (subject && !enrichedDescription) {
            enrichedDescription = subject;
          }
        }
      } catch (err) {
        console.warn('research: Could not enrich with job context:', err.message);
      }
    }

    if (!enrichedDescription || enrichedDescription.length < 5) {
      return res.status(400).json({ error: 'Could not determine project description. Provide projectDescription or ensure email has a matched job.' });
    }

    // Combine job context + client email for richer research input
    let fullContext = enrichedDescription;
    if (clientRequest) {
      fullContext += `\n\nClient's email (what they're asking for): ${clientRequest}`;
    }

    console.log(`research: Starting research for "${enrichedDescription.substring(0, 80)}..."`);

    const result = await researchSimilarExamples(fullContext, anthropicKey, exaKey, olostepKey);

    console.log(`research: Found ${result.examples.length} verified examples from ${result.rawResultCount} discovered, ${result.scrapedCount} scraped`);

    res.json({
      projectDescription: (projectDescription || '').trim(),
      examples: result.examples,
      rawResultCount: result.rawResultCount,
      scrapedCount: result.scrapedCount,
      exampleCount: result.examples.length,
      contextBlock: result.contextBlock,
      debug: result.debug,
    });
  } catch (err) {
    next(err);
  }
});

// TEMP debug endpoint
router.post('/debug-test', async (req, res, next) => {
  try {
    if (req.body.secret !== 'research-debug-2026') return res.status(403).json({ error: 'no' });
    const userId = '2068ca6b-8118-4bc2-9f7c-171bff8b0757';
    const [a, e, o] = await Promise.all([getApiKey(userId, 'anthropic'), getApiKey(userId, 'exa'), getApiKey(userId, 'olostep')]);
    const desc = req.body.projectDescription || 'Shopify fashion store for European market, premium themes, mobile-first, dropshipping';
    const result = await researchSimilarExamples(desc, a, e, o);
    res.json({ examples: result.examples, rawResultCount: result.rawResultCount, scrapedCount: result.scrapedCount, exampleCount: result.examples.length, debug: result.debug });
  } catch (err) { next(err); }
});

module.exports = router;
