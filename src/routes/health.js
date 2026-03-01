const express = require("express");
const pool = require("../config/db");
const router = express.Router();

router.get("/", async (_req, res) => {
  let dbStatus = "disconnected";

  try {
    await pool.query("SELECT 1");
    dbStatus = "connected";
  } catch {
    dbStatus = "disconnected";
  }

  res.json({
    status: "healthy",
    database: dbStatus,
    encryptionKey: process.env.ENCRYPTION_KEY ? "set" : "MISSING",
    jwtSecret: process.env.JWT_SECRET ? "set" : "MISSING",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
