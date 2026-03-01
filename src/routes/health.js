const express = require("express");
const pool = require("../config/db");
const router = express.Router();

router.get("/", async (_req, res) => {
  let dbStatus = "disconnected";
  let userCount = 0;
  let dbHost = "unknown";

  try {
    await pool.query("SELECT 1");
    dbStatus = "connected";

    // Debug: count users to track DB wipes
    const { rows } = await pool.query("SELECT COUNT(*) AS cnt FROM users");
    userCount = parseInt(rows[0].cnt);

    // Debug: show DB host (redacted) to detect connection issues
    const dbUrl = process.env.DATABASE_URL || "";
    const match = dbUrl.match(/@([^:/]+)/);
    dbHost = match ? match[1] : "env-not-set";
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  res.json({
    status: "healthy",
    database: dbStatus,
    userCount,
    dbHost,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
