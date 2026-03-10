/**
 * Settings Routes — CONF-01, CONF-05, PROMPT-01, DB-02, DB-03
 *
 * API Keys (CONF-01):
 * POST   /api/settings/api-keys                    — Store new API key
 * GET    /api/settings/api-keys                    — List all (masked)
 * PUT    /api/settings/api-keys/:service           — Update API key
 * DELETE /api/settings/api-keys/:service           — Remove API key
 * POST   /api/settings/api-keys/:service/verify    — Verify key works
 *
 * Prompt Templates (CONF-05 + PROMPT-01):
 * GET    /api/settings/prompt-templates            — List all templates
 * POST   /api/settings/prompt-templates            — Create template
 * GET    /api/settings/prompt-templates/:id        — Get single template
 * PUT    /api/settings/prompt-templates/:id        — Update template
 * DELETE /api/settings/prompt-templates/:id        — Delete template
 *
 * v2.0 Reference Data (DB-02, DB-03):
 * GET    /api/settings/banned-phrases              — List active banned phrases
 * GET    /api/settings/counter-moves               — List active counter moves
 */

const express = require("express");
const Joi = require("joi");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { validateBody, validateParams } = require("../middleware/validate");
const { encrypt, decrypt, maskApiKey } = require("../utils/encryption");

const router = express.Router();

const VALID_SERVICES = ["anthropic", "leadhack", "google_client_id", "google_client_secret", "exa", "olostep", "tldv"];

// ============================================================
// Validation Schemas
// ============================================================
const addKeySchema = Joi.object({
  service: Joi.string()
    .valid(...VALID_SERVICES)
    .required()
    .messages({
      "any.only": `Invalid service. Supported: ${VALID_SERVICES.join(", ")}`,
      "any.required": "Service name is required",
    }),
  apiKey: Joi.string().trim().min(1).max(2000).required()
    .messages({
      "string.empty": "API key cannot be empty",
      "string.min": "API key cannot be empty",
      "any.required": "API key is required",
    }),
});

const updateKeySchema = Joi.object({
  apiKey: Joi.string().trim().min(1).max(2000).required()
    .messages({
      "string.empty": "API key cannot be empty",
      "string.min": "API key cannot be empty",
      "any.required": "API key is required",
    }),
});

const serviceParamSchema = Joi.object({
  service: Joi.string().required(),
});

// ============================================================
// POST /api/settings/api-keys — Store new API key
// ============================================================
router.post(
  "/api-keys",
  requireAuth,
  validateBody(addKeySchema),
  async (req, res, next) => {
    try {
      const { service, apiKey } = req.body;
      const userId = req.user.id;

      // Check if already exists
      const existing = await pool.query(
        "SELECT id FROM api_keys WHERE user_id = $1 AND service = $2",
        [userId, service]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: `API key for ${service} already exists. Use PUT to update.`,
        });
      }

      // Encrypt
      const { encrypted, iv, authTag } = encrypt(apiKey);

      await pool.query(
        `INSERT INTO api_keys (user_id, service, encrypted_key, iv, auth_tag)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, service, encrypted, iv, authTag]
      );

      res.status(201).json({
        service,
        status: "connected",
        maskedKey: maskApiKey(apiKey),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// GET /api/settings/api-keys — List all API keys (masked)
// ============================================================
router.get("/api-keys", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT service, encrypted_key, iv, auth_tag, created_at, updated_at
       FROM api_keys WHERE user_id = $1
       ORDER BY created_at`,
      [req.user.id]
    );

    const keys = rows.map((row) => {
      let maskedKey = "***";
      try {
        const decrypted = decrypt(row.encrypted_key, row.iv, row.auth_tag);
        maskedKey = maskApiKey(decrypted);
      } catch {
        maskedKey = "***decryption-error***";
      }

      return {
        service: row.service,
        maskedKey,
        status: "connected",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    res.json(keys);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PUT /api/settings/api-keys/:service — Update API key
// ============================================================
router.put(
  "/api-keys/:service",
  requireAuth,
  validateParams(serviceParamSchema),
  validateBody(updateKeySchema),
  async (req, res, next) => {
    try {
      const { service } = req.params;
      const { apiKey } = req.body;
      const userId = req.user.id;

      // Check exists
      const existing = await pool.query(
        "SELECT id FROM api_keys WHERE user_id = $1 AND service = $2",
        [userId, service]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({
          error: `No API key found for service: ${service}`,
        });
      }

      // Re-encrypt with new key
      const { encrypted, iv, authTag } = encrypt(apiKey);

      await pool.query(
        `UPDATE api_keys
         SET encrypted_key = $1, iv = $2, auth_tag = $3, updated_at = NOW()
         WHERE user_id = $4 AND service = $5`,
        [encrypted, iv, authTag, userId, service]
      );

      res.json({
        service,
        status: "connected",
        maskedKey: maskApiKey(apiKey),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// DELETE /api/settings/api-keys/:service — Remove API key
// ============================================================
router.delete(
  "/api-keys/:service",
  requireAuth,
  validateParams(serviceParamSchema),
  async (req, res, next) => {
    try {
      const { service } = req.params;
      const userId = req.user.id;

      const result = await pool.query(
        "DELETE FROM api_keys WHERE user_id = $1 AND service = $2",
        [userId, service]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: `No API key found for service: ${service}`,
        });
      }

      res.json({
        service,
        status: "disconnected",
        message: `API key for ${service} removed`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// POST /api/settings/api-keys/:service/verify — Verify key
// Makes a real API call to confirm the key is valid
// ============================================================

/**
 * Lightweight verification calls for each service.
 * Each returns { valid: boolean, message: string }
 */
async function verifyAnthropicKey(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  if (res.ok) return { valid: true, message: "Anthropic API key is valid" };
  if (res.status === 401) return { valid: false, message: "Invalid API key - authentication failed" };
  if (res.status === 403) return { valid: false, message: "API key lacks required permissions" };
  return { valid: false, message: `Anthropic API returned ${res.status}` };
}

async function verifyExaKey(apiKey) {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: "test",
      type: "neural",
      numResults: 1,
      contents: { text: { maxCharacters: 10 } },
    }),
  });
  if (res.ok) return { valid: true, message: "Exa API key is valid" };
  if (res.status === 401 || res.status === 403) return { valid: false, message: "Invalid API key - authentication failed" };
  return { valid: false, message: `Exa API returned ${res.status}` };
}

async function verifyOlostepKey(apiKey) {
  // Use a lightweight scrape of a fast-loading page
  const res = await fetch("https://api.olostep.com/v1/scrapes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url_to_scrape: "https://example.com",
      formats: ["markdown"],
    }),
  });
  if (res.ok) return { valid: true, message: "Olostep API key is valid" };
  if (res.status === 401 || res.status === 403) return { valid: false, message: "Invalid API key - authentication failed" };
  return { valid: false, message: `Olostep API returned ${res.status}` };
}

async function verifyLeadhackKey(apiKey) {
  // LeadHack key format is email:password
  const parts = apiKey.split(":");
  if (parts.length < 2) return { valid: false, message: "LeadHack key must be in email:password format" };
  const [email, password] = [parts[0], parts.slice(1).join(":")];
  const res = await fetch("https://app.leadhack.info:3000/api/admin/getAuthToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    const data = await res.json().catch(() => null);
    if (data && data.token) return { valid: true, message: "LeadHack credentials verified" };
  }
  if (res.status === 401) return { valid: false, message: "Invalid LeadHack credentials" };
  return { valid: false, message: `LeadHack API returned ${res.status}` };
}

const SERVICE_VERIFIERS = {
  anthropic: verifyAnthropicKey,
  exa: verifyExaKey,
  olostep: verifyOlostepKey,
  leadhack: verifyLeadhackKey,
};

router.post(
  "/api-keys/:service/verify",
  requireAuth,
  validateParams(serviceParamSchema),
  async (req, res, next) => {
    try {
      const { service } = req.params;
      const userId = req.user.id;

      const { rows } = await pool.query(
        "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = $2",
        [userId, service]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `No API key found for service: ${service}`,
        });
      }

      // Step 1: Decrypt
      let apiKey;
      try {
        apiKey = decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);
      } catch {
        return res.json({
          service,
          status: "error",
          message: "API key decryption failed - key may be corrupted",
        });
      }

      // Step 2: Real API verification (if verifier exists for this service)
      const verifier = SERVICE_VERIFIERS[service];
      if (!verifier) {
        // For Google creds, just confirm decryption works
        return res.json({
          service,
          status: "verified",
          message: "API key decryption verified (no live check for this service)",
        });
      }

      const result = await verifier(apiKey);
      res.json({
        service,
        status: result.valid ? "verified" : "error",
        message: result.message,
      });
    } catch (err) {
      // Network errors etc. - don't crash, return graceful error
      console.warn(`verify: ${req.params.service} verification failed:`, err.message);
      res.json({
        service: req.params.service,
        status: "error",
        message: `Verification failed: ${err.message}`,
      });
    }
  }
);

// ============================================================
// PROMPT TEMPLATES (CONF-05 + PROMPT-01)
// ============================================================

const VALID_CATEGORIES = ["reply", "proposal", "scoring"];

const createTemplateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required()
    .messages({
      "string.empty": "Template name is required",
      "any.required": "Template name is required",
    }),
  content: Joi.string().trim().min(1).required()
    .messages({
      "string.empty": "Template content cannot be empty",
      "any.required": "Template content is required",
    }),
  category: Joi.string()
    .valid(...VALID_CATEGORIES)
    .required()
    .messages({
      "any.only": `Invalid category. Supported: ${VALID_CATEGORIES.join(", ")}`,
      "any.required": "Category is required",
    }),
  prompt_type: Joi.string()
    .valid(
      "EMAIL_REPLY_V2",
      "THREAD_CONTINUATION_V1",
      "FOLLOW_UP_V2",
      "PROPOSAL_V4",
      "LOVABLE_MOCKUP_V1"
    )
    .optional(),
});

const updateTemplateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  content: Joi.string().trim().min(1).optional(),
  category: Joi.string().valid(...VALID_CATEGORIES).optional(),
}).min(1);

const templateIdSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

// GET /api/settings/prompt-templates
router.get("/prompt-templates", requireAuth, async (req, res, next) => {
  try {
    const { category } = req.query;
    let query = `
      SELECT id, name, content, category, prompt_type, version, is_system, active, created_at, updated_at
      FROM prompt_templates
      WHERE user_id = $1 AND active = true
    `;
    const params = [req.user.id];

    if (category && VALID_CATEGORIES.includes(category)) {
      query += ` AND category = $2`;
      params.push(category);
    }

    query += ` ORDER BY is_system DESC, created_at ASC`;
    const { rows } = await pool.query(query, params);

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        content: r.content,
        category: r.category,
        promptType: r.prompt_type,
        version: r.version,
        isSystem: r.is_system,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/prompt-templates
router.post(
  "/prompt-templates",
  requireAuth,
  validateBody(createTemplateSchema),
  async (req, res, next) => {
    try {
      const { name, content, category, prompt_type } = req.body;
      const userId = req.user.id;

      // Strip any HTML tags from name (XSS protection)
      const sanitizedName = name.replace(/<[^>]*>/g, "");

      const { rows } = await pool.query(
        `INSERT INTO prompt_templates (user_id, name, content, category, prompt_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, content, category, prompt_type, version, is_system, created_at, updated_at`,
        [userId, sanitizedName, content, category, prompt_type || null]
      );

      res.status(201).json({
        id: rows[0].id,
        name: rows[0].name,
        content: rows[0].content,
        category: rows[0].category,
        promptType: rows[0].prompt_type,
        version: rows[0].version,
        isSystem: rows[0].is_system,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: "A template with this name already exists.",
        });
      }
      next(err);
    }
  }
);

// GET /api/settings/prompt-templates/:id
router.get(
  "/prompt-templates/:id",
  requireAuth,
  validateParams(templateIdSchema),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, content, category, prompt_type, version, is_system, active, created_at, updated_at
         FROM prompt_templates
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Prompt template not found" });
      }

      const r = rows[0];
      res.json({
        id: r.id,
        name: r.name,
        content: r.content,
        category: r.category,
        promptType: r.prompt_type,
        version: r.version,
        isSystem: r.is_system,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/settings/prompt-templates/:id
router.put(
  "/prompt-templates/:id",
  requireAuth,
  validateParams(templateIdSchema),
  validateBody(updateTemplateSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check exists and belongs to user
      const existing = await pool.query(
        "SELECT id, is_system FROM prompt_templates WHERE id = $1 AND user_id = $2",
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Prompt template not found" });
      }

      const updates = [];
      const params = [];
      let paramIdx = 1;

      if (req.body.name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        params.push(req.body.name.replace(/<[^>]*>/g, ""));
      }
      if (req.body.content !== undefined) {
        updates.push(`content = $${paramIdx++}`);
        params.push(req.body.content);
      }
      if (req.body.category !== undefined) {
        updates.push(`category = $${paramIdx++}`);
        params.push(req.body.category);
      }

      updates.push(`updated_at = NOW()`);
      // Bump version on content change
      if (req.body.content !== undefined) {
        updates.push(`version = version + 1`);
      }

      params.push(id, userId);

      const { rows } = await pool.query(
        `UPDATE prompt_templates
         SET ${updates.join(", ")}
         WHERE id = $${paramIdx++} AND user_id = $${paramIdx++}
         RETURNING id, name, content, category, prompt_type, version, is_system, created_at, updated_at`,
        params
      );

      const r = rows[0];
      res.json({
        id: r.id,
        name: r.name,
        content: r.content,
        category: r.category,
        promptType: r.prompt_type,
        version: r.version,
        isSystem: r.is_system,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: "A template with this name already exists.",
        });
      }
      next(err);
    }
  }
);

// DELETE /api/settings/prompt-templates/:id
router.delete(
  "/prompt-templates/:id",
  requireAuth,
  validateParams(templateIdSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const result = await pool.query(
        "DELETE FROM prompt_templates WHERE id = $1 AND user_id = $2",
        [id, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Prompt template not found" });
      }

      res.json({ message: "Prompt template deleted" });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// v2.0 REFERENCE DATA — Banned Phrases (DB-02) + Counter Moves (DB-03)
// ============================================================

// GET /api/settings/banned-phrases
router.get("/banned-phrases", requireAuth, async (req, res, next) => {
  try {
    const { category } = req.query;
    let query = `
      SELECT id, phrase, category, replacement_suggestion, active
      FROM banned_phrases
      WHERE active = true
    `;
    const params = [];

    if (category) {
      query += ` AND category = $1::banned_phrase_category_enum`;
      params.push(category.toUpperCase());
    }

    query += ` ORDER BY category, phrase`;
    const { rows } = await pool.query(query, params);

    res.json(
      rows.map((r) => ({
        id: r.id,
        phrase: r.phrase,
        category: r.category,
        replacementSuggestion: r.replacement_suggestion,
        active: r.active,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/counter-moves
router.get("/counter-moves", requireAuth, async (req, res, next) => {
  try {
    const { objection_type } = req.query;
    let query = `
      SELECT id, objection_type, objection_pattern, counter_move_name, counter_move_template, max_words, active
      FROM counter_moves
      WHERE active = true
    `;
    const params = [];

    if (objection_type) {
      query += ` AND objection_type = $1::objection_type_enum`;
      params.push(objection_type.toUpperCase());
    }

    query += ` ORDER BY objection_type, id`;
    const { rows } = await pool.query(query, params);

    res.json(
      rows.map((r) => ({
        id: r.id,
        objectionType: r.objection_type,
        objectionPattern: r.objection_pattern,
        counterMoveName: r.counter_move_name,
        counterMoveTemplate: r.counter_move_template,
        maxWords: r.max_words,
        active: r.active,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ============================================================
// EMAIL ALIASES — outreach email IDs owned by this user
// Stored addresses are stripped from CC contacts during Thread Continuation
// so the AI doesn't address them as third-party recipients.
//
// GET    /api/settings/email-aliases        — list aliases
// POST   /api/settings/email-aliases        — add alias
// DELETE /api/settings/email-aliases/:id    — remove alias
// ============================================================

const addAliasSchema = Joi.object({
  aliasEmail: Joi.string().email({ tlds: { allow: false } }).required().messages({
    'string.email': 'Invalid email address',
    'any.required': 'Email address is required',
  }),
  label: Joi.string().trim().max(100).optional().allow('', null),
});

const aliasIdSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

router.get('/email-aliases', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, alias_email, label, created_at FROM user_email_aliases WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/email-aliases', requireAuth, validateBody(addAliasSchema), async (req, res, next) => {
  try {
    const { aliasEmail, label } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO user_email_aliases (user_id, alias_email, label)
       VALUES ($1, $2, $3)
       RETURNING id, alias_email, label, created_at`,
      [req.user.id, aliasEmail.toLowerCase(), label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This email alias already exists.' });
    }
    next(err);
  }
});

router.delete('/email-aliases/:id', requireAuth, validateParams(aliasIdSchema), async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM user_email_aliases WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Alias not found' });
    }
    res.json({ message: 'Alias removed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
