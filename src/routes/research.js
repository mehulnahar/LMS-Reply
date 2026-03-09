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

    if (!projectDescription || typeof projectDescription !== 'string' || projectDescription.trim().length < 5) {
      return res.status(400).json({ error: 'projectDescription is required (min 5 characters)' });
    }

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

    // If emailId provided, enrich projectDescription with job context
    let enrichedDescription = projectDescription.trim();
    if (emailId) {
      try {
        const { rows } = await pool.query(
          `SELECT j.job_heading, j.job_description
           FROM emails e
           JOIN jobs j ON j.id = e.job_id
           WHERE e.id = $1 AND e.user_id = $2`,
          [emailId, req.user.id]
        );
        if (rows.length && rows[0].job_heading) {
          enrichedDescription += ` | Job: ${rows[0].job_heading}`;
          if (rows[0].job_description) {
            enrichedDescription += ` | ${rows[0].job_description.substring(0, 200)}`;
          }
        }
      } catch (err) {
        console.warn('research: Could not enrich with job context:', err.message);
      }
    }

    console.log(`research: Starting research for "${enrichedDescription.substring(0, 80)}..."`);

    const result = await researchSimilarExamples(enrichedDescription, anthropicKey, exaKey, olostepKey);

    console.log(`research: Found ${result.examples.length} verified examples from ${result.rawResultCount} discovered, ${result.scrapedCount} scraped`);

    res.json({
      projectDescription: projectDescription.trim(),
      examples: result.examples,
      rawResultCount: result.rawResultCount,
      scrapedCount: result.scrapedCount,
      exampleCount: result.examples.length,
      contextBlock: result.contextBlock,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
