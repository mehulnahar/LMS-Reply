const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 20,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres error:", err);
});

module.exports = pool;
