/**
 * Database Migration Runner
 * Reads SQL files from migrations/ and applies them in order.
 * Tracks applied migrations to avoid re-running.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./db");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const { rows } = await pool.query(
    "SELECT name FROM migrations ORDER BY id"
  );
  return new Set(rows.map((r) => r.name));
}

async function runMigrations() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  Applied: ${file}`);
      count++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  FAILED: ${file} — ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (count === 0) {
    console.log("  All migrations already applied.");
  }
  return count;
}

// Run directly if called from CLI
if (require.main === module) {
  console.log("Running database migrations...");
  runMigrations()
    .then((count) => {
      console.log(`Done. ${count} migration(s) applied.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
