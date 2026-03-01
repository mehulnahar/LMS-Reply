/**
 * Authentication Middleware
 * Verifies JWT tokens from Authorization header.
 * Attaches user object to req.user on success.
 * Checks session blacklist for logout support.
 */

const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

/**
 * Require a valid, non-revoked JWT token.
 * Sets req.user = { id, email, role }
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }

  // Check if session was revoked (logout)
  if (payload.jti) {
    try {
      const { rows } = await pool.query(
        "SELECT revoked FROM sessions WHERE token_jti = $1",
        [payload.jti]
      );
      if (rows.length > 0 && rows[0].revoked) {
        return res.status(401).json({ error: "Session has been revoked" });
      }
    } catch {
      // DB error shouldn't block auth — fail open for session check
      // but still validate the JWT signature above
    }
  }

  req.user = {
    id: payload.userId,
    email: payload.email,
    role: payload.role,
  };

  next();
}

/**
 * Require specific role(s). Must be used after requireAuth.
 * Usage: requireRole('owner') or requireRole('owner', 'senior_va')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
