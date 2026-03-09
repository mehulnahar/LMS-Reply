const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const settingsRoutes = require("./routes/settings");
const gmailRoutes = require("./routes/gmail");
const emailRoutes = require("./routes/emails");
const jobRoutes = require("./routes/jobs");
const replyRoutes = require("./routes/replies");
const timezoneRoutes = require("./routes/timezone");
const researchRoutes = require("./routes/research");

const app = express();

// Trust Railway's reverse proxy so req.protocol returns "https" (not "http")
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
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
app.use("/api/gmail", gmailRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/replies", replyRoutes);
app.use("/api/timezone", timezoneRoutes);
app.use("/api/research", researchRoutes);

// ---------------------------------------------------------------------------
// API root (keep for health probes)
// ---------------------------------------------------------------------------
app.get("/api", (_req, res) => {
  res.json({ name: "LMS Reply", version: "1.0.0", status: "running" });
});

// ---------------------------------------------------------------------------
// Static frontend (production build)
// ---------------------------------------------------------------------------
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// SPA fallback — serve index.html for non-API routes
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Route not found" });
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

// ---------------------------------------------------------------------------
// API 404 handler
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

  // Return useful error detail (safe: never leak stack traces)
  const status = err.status || 500;
  const message =
    err.message && !err.message.includes("secret")
      ? err.message
      : "Internal server error";

  res.status(status).json({ error: message });
});

module.exports = app;
