/**
 * Jest Global Setup
 * Sets env vars, runs migrations, seeds test users.
 */

// Load .env first (for DATABASE_URL), then override test-specific vars
require("dotenv").config();
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-do-not-use-in-production";
process.env.ENCRYPTION_KEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2";

const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { runMigrations } = require("../config/migrate");

const TEST_PASSWORD = "SecureP@ss123";
const SEED_USERS = [
  { email: "existing@example.com", role: "owner" },
  { email: "testowner@example.com", role: "owner" },
  { email: "va@example.com", role: "va" },
];

beforeAll(async () => {
  // Run migrations
  try {
    await runMigrations();
  } catch {
    // Tables might already exist
  }

  // Seed test users — always reset hash to ensure correct password
  const hash = await bcrypt.hash(TEST_PASSWORD, 4);
  for (const user of SEED_USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, active = true`,
      [user.email, hash, user.role]
    );
  }
});

afterEach(async () => {
  // Clean per-test data, keep seed users
  try {
    await pool.query("DELETE FROM api_keys");
    await pool.query("DELETE FROM sessions");
    await pool.query(
      `DELETE FROM users WHERE email NOT IN (${SEED_USERS.map(
        (_, i) => `$${i + 1}`
      ).join(", ")})`,
      SEED_USERS.map((u) => u.email)
    );
  } catch {
    // Tables might not exist for non-Phase-1 test runs
  }
});

afterAll(async () => {
  // Only clean test data, keep seed users — other test files may still be running
  try {
    await pool.query("DELETE FROM api_keys");
    await pool.query("DELETE FROM sessions");
    await pool.query(
      `DELETE FROM users WHERE email NOT IN (${SEED_USERS.map(
        (_, i) => `$${i + 1}`
      ).join(", ")})`,
      SEED_USERS.map((u) => u.email)
    );
  } catch {
    // Ignore
  }
  await pool.end();
});
