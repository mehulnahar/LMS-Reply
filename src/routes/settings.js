/**
 * Settings Routes — CONF-01
 *
 * POST   /api/settings/api-keys             — Store new API key
 * GET    /api/settings/api-keys             — List all (masked)
 * PUT    /api/settings/api-keys/:service    — Update API key
 * DELETE /api/settings/api-keys/:service    — Remove API key
 * POST   /api/settings/api-keys/:service/verify — Verify key works
 */

const express = require("express");
const Joi = require("joi");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { validateBody, validateParams } = require("../middleware/validate");
const { encrypt, decrypt, maskApiKey } = require("../utils/encryption");

const router = express.Router();

const VALID_SERVICES = ["anthropic", "leadhack", "google_client_id", "google_client_secret"];

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
// ============================================================
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

      // Verify decryption works (proves key is intact)
      try {
        decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);
        res.json({
          service,
          status: "verified",
          message: "API key decryption verified successfully",
        });
      } catch {
        res.json({
          service,
          status: "error",
          message: "API key decryption failed — key may be corrupted",
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
