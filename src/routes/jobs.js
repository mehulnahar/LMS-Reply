/**
 * Job Matching Routes — JOB-01
 *
 * POST /api/jobs/match/:emailId — Match an email to a LeadHack job
 * GET  /api/jobs/:id            — Get job details
 */

const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");

const router = express.Router();

const LEADHACK_BASE = "https://app.leadhack.info:3000/api/admin";

// ============================================================
// Helper: Get LeadHack auth token (optional — API works without auth)
// ============================================================
async function getLeadHackToken(userId) {
  try {
    const { rows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'leadhack'",
      [userId]
    );

    if (rows.length === 0) return null; // No key stored — that's fine, API works without auth

    const apiKey = decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);

    // LeadHack uses email+password auth
    if (apiKey.includes(":")) {
      const [email, password] = apiKey.split(":");
      const res = await fetch(`${LEADHACK_BASE}/getAuthToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!data.token) return null;
      return data.token;
    }

    return apiKey; // Assume it's a direct token
  } catch {
    return null; // Auth failed — continue without it
  }
}

// ============================================================
// POST /api/jobs/match/:emailId — Auto-match email to job
// ============================================================
router.post("/match/:emailId", requireAuth, async (req, res, next) => {
  try {
    // Get the email
    const { rows: emailRows } = await pool.query(
      "SELECT * FROM emails WHERE id = $1 AND user_id = $2",
      [req.params.emailId, req.user.id]
    );

    if (emailRows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    const email = emailRows[0];

    // Check if already matched (skip cache if previous attempt was an error)
    const { rows: existingJobs } = await pool.query(
      "SELECT * FROM jobs WHERE email_id = $1",
      [email.id]
    );

    if (existingJobs.length > 0 && existingJobs[0].match_status !== "error") {
      return res.json({
        job: formatJob(existingJobs[0]),
        cached: true,
      });
    }

    // Delete old error records before retrying
    if (existingJobs.length > 0 && existingJobs[0].match_status === "error") {
      await pool.query("DELETE FROM jobs WHERE email_id = $1", [email.id]);
    }

    // Query LeadHack API
    try {
      const token = await getLeadHackToken(req.user.id);

      // Strip "Re: " and "Fwd: " prefixes from subject for better matching
      const cleanSubject = email.subject.replace(/^(Re|Fwd|Fw):\s*/i, "").trim();

      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const lhRes = await fetch(`${LEADHACK_BASE}/getJobDetails`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email_id: email.from_email,
          email_subject: cleanSubject,
        }),
      });

      const lhData = await lhRes.json();

      if (lhData.status && lhData.data && lhData.data.length > 0) {
        const job = lhData.data[0];

        const { rows: inserted } = await pool.query(
          `INSERT INTO jobs (user_id, email_id, leadhack_id, client_first_name, client_last_name, client_email, email_subject, job_heading, job_description, match_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'matched')
           RETURNING *`,
          [
            req.user.id, email.id, job.id?.toString(),
            job.first_name, job.last_name, job.email_id,
            job.email_subject, job.job_heading, job.job_description,
          ]
        );

        return res.json({ job: formatJob(inserted[0]), cached: false });
      }

      // No match found
      const { rows: noMatch } = await pool.query(
        `INSERT INTO jobs (user_id, email_id, client_email, email_subject, match_status)
         VALUES ($1, $2, $3, $4, 'no_match')
         RETURNING *`,
        [req.user.id, email.id, email.from_email, email.subject]
      );

      return res.json({ job: formatJob(noMatch[0]), cached: false });
    } catch (err) {
      // API error — still create a record
      const { rows: errJob } = await pool.query(
        `INSERT INTO jobs (user_id, email_id, client_email, email_subject, match_status)
         VALUES ($1, $2, $3, $4, 'error')
         RETURNING *`,
        [req.user.id, email.id, email.from_email, email.subject]
      );

      return res.json({
        job: formatJob(errJob[0]),
        cached: false,
        warning: `LeadHack lookup failed: ${err.message}`,
      });
    }
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/jobs/:id — Get job details
// ============================================================
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM jobs WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({ job: formatJob(rows[0]) });
  } catch (err) {
    next(err);
  }
});

function formatJob(row) {
  return {
    id: row.id,
    leadhackId: row.leadhack_id,
    clientFirstName: row.client_first_name,
    clientLastName: row.client_last_name,
    clientEmail: row.client_email,
    emailSubject: row.email_subject,
    jobHeading: row.job_heading,
    jobDescription: row.job_description,
    matchStatus: row.match_status,
    matchedAt: row.matched_at,
  };
}

module.exports = router;
