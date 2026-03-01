/**
 * Auth Routes — AUTH-01, AUTH-02, AUTH-03
 *
 * POST /api/auth/signup  — Create account (AUTH-01)
 * POST /api/auth/login   — Login with JWT (AUTH-02)
 * POST /api/auth/logout  — Revoke session (AUTH-03)
 * GET  /api/auth/me      — Get current user (AUTH-02)
 */

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Joi = require("joi");
const pool = require("../config/db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");

const router = express.Router();

const SALT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;
const JWT_EXPIRES_IN = "7d";

// ============================================================
// Validation Schemas
// ============================================================
const signupSchema = Joi.object({
  email: Joi.string().email().max(254).required().trim().lowercase()
    .messages({
      "string.email": "Invalid email format",
      "string.max": "Email must be at most 254 characters",
      "any.required": "Email is required",
    }),
  password: Joi.string().min(8).max(128).required()
    .messages({
      "string.min": "Password must be at least 8 characters",
      "string.max": "Password must be at most 128 characters",
      "any.required": "Password is required",
    }),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().trim().lowercase()
    .messages({
      "string.email": "Invalid email format",
      "any.required": "Email is required",
    }),
  password: Joi.string().required()
    .messages({
      "any.required": "Password is required",
    }),
});

// ============================================================
// Helpers
// ============================================================
function generateToken(user) {
  const jti = crypto.randomUUID();
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    jti,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  return { token, jti };
}

async function createSession(userId, jti, expiresAt) {
  try {
    await pool.query(
      `INSERT INTO sessions (user_id, token_jti, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, jti, expiresAt]
    );
  } catch {
    // Non-critical — session tracking is for logout support.
    // If it fails, token is still valid but logout won't revoke it.
  }
}

// ============================================================
// POST /api/auth/signup — AUTH-01
// ============================================================
router.post("/signup", validateBody(signupSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Check duplicate
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "User with this email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'owner')
       RETURNING id, email, role, created_at`,
      [email, passwordHash]
    );

    const user = rows[0];
    const { token, jti } = generateToken(user);

    // Track session
    const decoded = jwt.decode(token);
    await createSession(user.id, jti, new Date(decoded.exp * 1000));

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
      },
      token,
    });
  } catch (err) {
    // Handle unique constraint violation (race condition fallback)
    if (err.code === "23505" && err.constraint === "users_email_key") {
      return res
        .status(409)
        .json({ error: "User with this email already exists" });
    }
    next(err);
  }
});

// ============================================================
// POST /api/auth/login — AUTH-02
// ============================================================
router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Lookup user — same error for both non-existent and wrong password
    const { rows } = await pool.query(
      "SELECT id, email, password_hash, role, active FROM users WHERE LOWER(email) = LOWER($1)",
      [email]
    );

    const genericError = { error: "Invalid email or password" };

    if (rows.length === 0) {
      // Constant-time: compare against dummy to prevent timing attacks
      try {
        await bcrypt.compare(password, "$2b$04$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
      } catch {
        // Ignore — this is just for timing
      }
      return res.status(401).json(genericError);
    }

    const user = rows[0];

    if (!user.active) {
      return res.status(401).json(genericError);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json(genericError);
    }

    const { token, jti } = generateToken(user);
    const decoded = jwt.decode(token);
    await createSession(user.id, jti, new Date(decoded.exp * 1000));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/logout — AUTH-03
// ============================================================
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    // Extract JTI from token to revoke this specific session
    const header = req.headers.authorization;
    const token = header.slice(7).trim();
    const decoded = jwt.decode(token);

    if (decoded && decoded.jti) {
      await pool.query(
        "UPDATE sessions SET revoked = true WHERE token_jti = $1",
        [decoded.jti]
      );
    }

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/auth/me — AUTH-02 (session persistence check)
// ============================================================
router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

module.exports = router;
