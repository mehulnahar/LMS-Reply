/**
 * Timezone Lookup Route — TZ-01
 *
 * GET /api/timezone?city=Auckland&country=New+Zealand
 *
 * Uses Claude Haiku to resolve a city/country to an IANA timezone string.
 * Result is cached in-process so subsequent requests for the same location
 * are instant and don't consume Claude tokens.
 */

const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");

const router = express.Router();

// Simple in-process cache: "city|country" → "America/New_York"
// Survives for the lifetime of the process (no TTL needed — timezones don't change)
const tzCache = new Map();

// ============================================================
// GET /api/timezone?city=Auckland&country=New+Zealand
// ============================================================
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const city    = (req.query.city    || "").trim();
    const country = (req.query.country || "").trim();

    if (!city && !country) {
      return res.status(400).json({ error: "city or country query param is required" });
    }

    const cacheKey = `${city.toLowerCase()}|${country.toLowerCase()}`;

    // Serve from cache if available
    if (tzCache.has(cacheKey)) {
      return res.json({ timezone: tzCache.get(cacheKey), cached: true });
    }

    // Fetch the user's Anthropic API key
    const { rows: keyRows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'anthropic'",
      [req.user.id]
    );

    if (keyRows.length === 0) {
      return res.status(400).json({ error: "Anthropic API key not configured. Add it in Settings." });
    }

    const anthropicKey = decrypt(
      keyRows[0].encrypted_key,
      keyRows[0].iv,
      keyRows[0].auth_tag
    );

    const location = [city, country].filter(Boolean).join(", ");

    // Ask Claude Haiku — lightweight task, no need for Sonnet
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-3-5-haiku-20241022",
        max_tokens: 50,
        messages: [
          {
            role:    "user",
            content: `What is the IANA timezone identifier for ${location}? Reply with ONLY the IANA timezone string, for example: America/New_York or Pacific/Auckland or Asia/Kolkata. No explanation, no punctuation, just the raw timezone identifier.`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}));
      return res.status(502).json({
        error: `Claude API error: ${errData.error?.message || claudeRes.statusText}`,
      });
    }

    const claudeData = await claudeRes.json();
    const timezone   = claudeData.content?.[0]?.text?.trim() || null;

    if (!timezone) {
      return res.status(404).json({ error: "Could not determine timezone for that location" });
    }

    // Validate the string is a real IANA timezone before returning it
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      return res.status(422).json({
        error: "Claude returned an unrecognised timezone string",
        raw:   timezone,
      });
    }

    // Cache it
    tzCache.set(cacheKey, timezone);

    return res.json({ timezone, cached: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
