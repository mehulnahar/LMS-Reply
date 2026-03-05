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
// Helper: Strip null bytes from strings (LeadHack data has encoding artifacts)
// PostgreSQL rejects \0 in text columns
// ============================================================
function sanitize(val) {
  if (typeof val !== "string") return val;
  // eslint-disable-next-line no-control-regex
  return val.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

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

        // Call V2 for enriched data (location, budget, client history, etc.)
        let v2 = null;
        if (job.link) {
          try {
            const v2Res = await fetch(`${LEADHACK_BASE}/getJobDetailsV2`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ link: job.link }),
            });
            const v2Data = await v2Res.json();
            if (v2Data.status && v2Data.data && v2Data.data.length > 0) {
              v2 = v2Data.data[0];
            }
          } catch {
            // V2 enrichment is best-effort — don't fail the whole match
          }
        }

        const { rows: inserted } = await pool.query(
          `INSERT INTO jobs (
            user_id, email_id, leadhack_id, client_first_name, client_last_name, client_email,
            email_subject, job_heading, job_description, match_status,
            upwork_link, country, city, company, workload, duration, payment_type,
            amount, hourly_budget_min, hourly_budget_max, hourly_budget_type,
            is_payment_verified, is_enterprise, buyer_history_amount, avg_hourly_rate,
            total_jobs_posted, total_jobs_with_hires, contractor_tier,
            category, sub_category, industry, lead_id, v2_enriched_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,'matched',
            $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
          ) RETURNING *`,
          [
            req.user.id, email.id, job.id?.toString(),
            sanitize(job.first_name), sanitize(job.last_name), sanitize(job.email_id),
            sanitize(job.email_subject), sanitize(job.job_heading), sanitize(job.job_description),
            // V2 fields — use V2 data if available, else fall back to V1 link
            sanitize(v2?.link || job.link || ""),
            sanitize(v2?.country || ""),
            sanitize(v2?.city || ""),
            sanitize(v2?.company || ""),
            sanitize(v2?.workload || ""),
            sanitize(v2?.duration || ""),
            sanitize(v2?.payment_type || ""),
            sanitize(v2?.amount || ""),
            sanitize(v2?.hourly_budget_min || ""),
            sanitize(v2?.hourly_budget_max || ""),
            sanitize(v2?.hourly_budget_type || ""),
            sanitize(v2?.is_payment_verified || ""),
            sanitize(v2?.is_enterprise_client || ""),
            sanitize(v2?.buyer_history_amount || ""),
            sanitize(v2?.avg_hourly_jobs_rate || ""),
            sanitize(v2?.posted_count || ""),
            sanitize(v2?.total_jobs_with_hires || ""),
            sanitize(v2?.contractor_tier || ""),
            sanitize(v2?.category || ""),
            sanitize(v2?.sub_category || ""),
            sanitize(v2?.industry || ""),
            sanitize(v2?.lead_id || ""),
            v2 ? new Date() : null,
          ]
        );

        return res.json({ job: formatJob(inserted[0]), cached: false });
      }

      // Multiple matches — user must resolve manually with a link
      if (!lhData.status && lhData.message && lhData.message.toLowerCase().includes("multiple")) {
        const { rows: multiMatch } = await pool.query(
          `INSERT INTO jobs (user_id, email_id, client_email, email_subject, match_status)
           VALUES ($1, $2, $3, $4, 'needs_manual')
           RETURNING *`,
          [req.user.id, email.id, email.from_email, email.subject]
        );
        return res.json({ job: formatJob(multiMatch[0]), cached: false });
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
// POST /api/jobs/match-by-link/:emailId — Match using Upwork link (V2 only)
// Used when auto-match returns "Multiple Data found" or no_match
// ============================================================
router.post("/match-by-link/:emailId", requireAuth, async (req, res, next) => {
  try {
    const { link } = req.body;
    if (!link || !link.includes("upwork.com")) {
      return res.status(400).json({ error: "A valid Upwork job link is required" });
    }

    const { rows: emailRows } = await pool.query(
      "SELECT * FROM emails WHERE id = $1 AND user_id = $2",
      [req.params.emailId, req.user.id]
    );
    if (emailRows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }
    const email = emailRows[0];

    // Delete any existing job record for this email (needs_manual, no_match, error)
    await pool.query("DELETE FROM jobs WHERE email_id = $1", [email.id]);

    // Call V2 directly — the user has given us the exact link
    const v2Res = await fetch(`${LEADHACK_BASE}/getJobDetailsV2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link }),
    });
    const v2Data = await v2Res.json();

    if (!v2Data.status || !v2Data.data || v2Data.data.length === 0) {
      return res.status(404).json({ error: "No job found for that Upwork link in LeadHack" });
    }

    const v2 = v2Data.data[0];

    const { rows: inserted } = await pool.query(
      `INSERT INTO jobs (
        user_id, email_id, client_email, email_subject, match_status,
        job_heading, job_description,
        client_first_name, client_last_name,
        upwork_link, country, city, company, workload, duration, payment_type,
        amount, hourly_budget_min, hourly_budget_max, hourly_budget_type,
        is_payment_verified, is_enterprise, buyer_history_amount, avg_hourly_rate,
        total_jobs_posted, total_jobs_with_hires, contractor_tier,
        category, sub_category, industry, lead_id, v2_enriched_at
      ) VALUES (
        $1,$2,$3,$4,'matched',$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NOW()
      ) RETURNING *`,
      [
        req.user.id, email.id, email.from_email, email.subject,
        sanitize(v2.job_heading || ""),
        sanitize(v2.job_description || ""),
        sanitize(v2.first_name || ""),
        sanitize(v2.last_name || ""),
        sanitize(link),
        sanitize(v2.country || ""),
        sanitize(v2.city || ""),
        sanitize(v2.company || ""),
        sanitize(v2.workload || ""),
        sanitize(v2.duration || ""),
        sanitize(v2.payment_type || ""),
        sanitize(v2.amount || ""),
        sanitize(v2.hourly_budget_min || ""),
        sanitize(v2.hourly_budget_max || ""),
        sanitize(v2.hourly_budget_type || ""),
        sanitize(v2.is_payment_verified || ""),
        sanitize(v2.is_enterprise_client || ""),
        sanitize(v2.buyer_history_amount || ""),
        sanitize(v2.avg_hourly_jobs_rate || ""),
        sanitize(v2.posted_count || ""),
        sanitize(v2.total_jobs_with_hires || ""),
        sanitize(v2.contractor_tier || ""),
        sanitize(v2.category || ""),
        sanitize(v2.sub_category || ""),
        sanitize(v2.industry || ""),
        sanitize(v2.lead_id || ""),
      ]
    );

    return res.json({ job: formatJob(inserted[0]), cached: false });
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

// ============================================================
// PUT /api/jobs/:id/client-proposal-toggle — THREAD-03
// Persists the client_requested_proposal flag per lead
// ============================================================
router.put('/:id/client-proposal-toggle', requireAuth, async (req, res, next) => {
  try {
    const { clientRequestedProposal } = req.body;
    if (typeof clientRequestedProposal !== 'boolean') {
      return res.status(400).json({ error: 'clientRequestedProposal must be a boolean' });
    }
    const { rows } = await pool.query(
      'UPDATE jobs SET client_requested_proposal = $1 WHERE id = $2 AND user_id = $3 RETURNING id, client_requested_proposal',
      [clientRequestedProposal, req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ id: rows[0].id, clientRequestedProposal: rows[0].client_requested_proposal });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/jobs/:id/next-steps — THREAD-09
// Returns next_steps rows for a job, newest first
// ============================================================
router.get('/:id/next-steps', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, our_action, their_action, followup_approach, followup_date, created_at
       FROM next_steps
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.params.id]
    );
    res.json({ nextSteps: rows });
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
    // V2 enrichment
    upworkLink: row.upwork_link || null,
    country: row.country || null,
    city: row.city || null,
    company: row.company || null,
    workload: row.workload || null,
    duration: row.duration || null,
    paymentType: row.payment_type || null,
    amount: row.amount || null,
    hourlyBudgetMin: row.hourly_budget_min || null,
    hourlyBudgetMax: row.hourly_budget_max || null,
    hourlyBudgetType: row.hourly_budget_type || null,
    isPaymentVerified: row.is_payment_verified || null,
    isEnterprise: row.is_enterprise || null,
    buyerHistoryAmount: row.buyer_history_amount || null,
    avgHourlyRate: row.avg_hourly_rate || null,
    totalJobsPosted: row.total_jobs_posted || null,
    totalJobsWithHires: row.total_jobs_with_hires || null,
    contractorTier: row.contractor_tier || null,
    category: row.category || null,
    subCategory: row.sub_category || null,
    industry: row.industry || null,
    leadId: row.lead_id || null,
    v2EnrichedAt: row.v2_enriched_at || null,
    // Phase 15: Thread continuation fields
    threadStage: row.thread_stage || null,
    clientRequestedProposal: row.client_requested_proposal || false,
  };
}

module.exports = router;
