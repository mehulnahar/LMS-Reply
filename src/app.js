const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const settingsRoutes = require("./routes/settings");

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Disable morgan in test to keep output clean
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined"));
}

// ---------------------------------------------------------------------------
// Rate Limiting (disabled in test environment)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again later" },
  });
  app.use("/api/auth/signup", authLimiter);
  app.use("/api/auth/login", authLimiter);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);

app.get("/", (_req, res) => {
  res.json({
    name: "LMS Reply",
    version: "1.0.0",
    status: "running",
  });
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
