/**
 * Analytics Routes
 *
 * GET /api/analytics/emails?range=7d|30d|90d|all
 *   Consolidated email analytics - funnel, signals, velocity, volume,
 *   lead scores, intents, and per-account breakdown.
 */

const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ─────────────────────────────────────────
// Date range helper
// ─────────────────────────────────────────
function getDateFilter(range) {
  const days = { "7d": 7, "30d": 30, "90d": 90 };
  if (days[range]) {
    return {
      clause: "AND e.received_at >= NOW() - $2::interval",
      param: `${days[range]} days`,
    };
  }
  // "all" - no date filter
  return { clause: "", param: null };
}

// ─────────────────────────────────────────
// GET /api/analytics/emails
// ─────────────────────────────────────────
router.get("/emails", requireAuth, async (req, res) => {
  const range = req.query.range || "30d";
  const userId = req.user.id;
  const { clause: dateClause, param: dateParam } = getDateFilter(range);

  // Build param array: $1 is always userId, $2 is optional interval
  const params = dateParam ? [userId, dateParam] : [userId];

  try {
    const [
      funnelResult,
      signalResult,
      velocityResult,
      volumeResult,
      leadScoreResult,
      intentResult,
      accountResult,
    ] = await Promise.all([
      // 1. Pipeline funnel - count by status
      pool.query(
        `SELECT status, COUNT(*)::int as count
         FROM emails e
         WHERE e.user_id = $1 ${dateClause}
         GROUP BY status`,
        params
      ),

      // 2. Hot signals
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE has_phone = true)::int as with_phone,
           COUNT(*) FILTER (WHERE has_urgency = true)::int as urgent,
           COUNT(*) FILTER (WHERE hot_signal_flagged = true)::int as hot_signal,
           COUNT(*) FILTER (WHERE is_unread = true)::int as unread
         FROM emails e
         WHERE e.user_id = $1 ${dateClause}`,
        params
      ),

      // 3. Response velocity - avg hours from email received to first reply
      pool.query(
        `SELECT
           ROUND(AVG(hours)::numeric, 1) as avg_hours,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours)::numeric, 1) as median_hours,
           COUNT(*)::int as total_replied
         FROM (
           SELECT DISTINCT ON (e.id)
             EXTRACT(EPOCH FROM (r.created_at - e.received_at)) / 3600.0 as hours
           FROM emails e
           JOIN replies r ON r.email_id = e.id
           WHERE e.user_id = $1 ${dateClause}
           ORDER BY e.id, r.created_at ASC
         ) sub
         WHERE hours >= 0`,
        params
      ),

      // 4. Email volume over time (daily)
      pool.query(
        `SELECT DATE(e.received_at) as day, COUNT(*)::int as count
         FROM emails e
         WHERE e.user_id = $1 ${dateClause}
         GROUP BY day
         ORDER BY day`,
        params
      ),

      // 5. Lead score distribution with win rate
      pool.query(
        `SELECT
           CASE
             WHEN lead_score >= 80 THEN 'High (80-100)'
             WHEN lead_score >= 60 THEN 'Good (60-79)'
             WHEN lead_score >= 40 THEN 'Medium (40-59)'
             WHEN lead_score >= 20 THEN 'Low (20-39)'
             ELSE 'Not a Lead (0-19)'
           END as band,
           CASE
             WHEN lead_score >= 80 THEN 1
             WHEN lead_score >= 60 THEN 2
             WHEN lead_score >= 40 THEN 3
             WHEN lead_score >= 20 THEN 4
             ELSE 5
           END as sort_order,
           COUNT(*)::int as count,
           COUNT(*) FILTER (WHERE status = 'won')::int as won
         FROM emails e
         WHERE e.user_id = $1 AND lead_score IS NOT NULL ${dateClause}
         GROUP BY band, sort_order
         ORDER BY sort_order`,
        params
      ),

      // 6. Intent breakdown
      pool.query(
        `SELECT intent, COUNT(*)::int as count
         FROM emails e
         WHERE e.user_id = $1 AND intent IS NOT NULL ${dateClause}
         GROUP BY intent
         ORDER BY count DESC`,
        params
      ),

      // 7. Per-account breakdown
      pool.query(
        `SELECT
           ea.email,
           ea.color,
           COUNT(e.id)::int as total,
           COUNT(e.id) FILTER (WHERE e.lead_score >= 60)::int as high_quality
         FROM email_accounts ea
         LEFT JOIN emails e ON e.account_id = ea.id
           AND e.user_id = $1 ${dateClause.replace(/e\./g, "e.")}
         WHERE ea.user_id = $1
         GROUP BY ea.id, ea.email, ea.color
         ORDER BY total DESC`,
        params
      ),
    ]);

    // Build funnel object
    const funnel = { new: 0, replied: 0, proposal_sent: 0, won: 0, lost: 0, ignored: 0 };
    for (const row of funnelResult.rows) {
      if (Object.prototype.hasOwnProperty.call(funnel, row.status)) {
        funnel[row.status] = row.count;
      }
    }

    // Signals
    const signals = signalResult.rows[0] || {
      with_phone: 0, urgent: 0, hot_signal: 0, unread: 0,
    };

    // Velocity
    const vel = velocityResult.rows[0] || {};
    const velocity = {
      avgHours: vel.avg_hours ? parseFloat(vel.avg_hours) : null,
      medianHours: vel.median_hours ? parseFloat(vel.median_hours) : null,
      totalReplied: vel.total_replied || 0,
    };

    // Volume - format days as strings
    const volume = volumeResult.rows.map((r) => ({
      day: r.day.toISOString().split("T")[0],
      count: r.count,
    }));

    // Lead scores
    const leadScores = leadScoreResult.rows.map((r) => ({
      band: r.band,
      count: r.count,
      won: r.won,
    }));

    // Intents - format names nicely
    const intents = intentResult.rows.map((r) => ({
      intent: r.intent,
      label: r.intent
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      count: r.count,
    }));

    // Accounts
    const accounts = accountResult.rows.map((r) => ({
      email: r.email,
      color: r.color || "#4F46E5",
      total: r.total,
      highQuality: r.high_quality,
    }));

    res.json({
      funnel,
      signals,
      velocity,
      volume,
      leadScores,
      intents,
      accounts,
    });
  } catch (err) {
    console.error("[Analytics] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

module.exports = router;
