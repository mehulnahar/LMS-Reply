/**
 * Job Matcher Utility
 *
 * Extracted from POST /api/jobs/match/:emailId so it can be called from:
 * - The route handler (single email match from Inbox UI)
 * - Bulk match endpoint (POST /api/jobs/match-all)
 * - Email sync flow (auto-match after syncing new emails)
 *
 * matchSingleEmail(userId, emailRow) -> { job, cached, status, warning? }
 * matchAllUnmatched(userId) -> { matched, skipped, failed, errors }
 */

const pool = require('../config/db');
const { decrypt } = require('./encryption');

const LEADHACK_BASE = "https://app.leadhack.info:3000/api/admin";

// ============================================================
// Helper: Strip null bytes from strings
// ============================================================
function sanitize(val) {
  if (typeof val !== "string") return val;
  // eslint-disable-next-line no-control-regex
  return val.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// ============================================================
// Helper: Get LeadHack auth token
// ============================================================
async function getLeadHackToken(userId) {
  try {
    const { rows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'leadhack'",
      [userId]
    );
    if (rows.length === 0) return null;

    const apiKey = decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);

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

    return apiKey;
  } catch {
    return null;
  }
}

// ============================================================
// Match a single email to LeadHack job data
// Options:
//   force: true  - re-try even if previous status was no_match/error/needs_manual
//   force: false - only try if no existing non-error job record (default)
// Returns: { job, cached, status, warning? }
// ============================================================
async function matchSingleEmail(userId, email, token, { force = false } = {}) {
  // Check if already matched
  const { rows: existingJobs } = await pool.query(
    "SELECT * FROM jobs WHERE email_id = $1",
    [email.id]
  );

  if (existingJobs.length > 0) {
    const existing = existingJobs[0];
    // If already successfully matched with real data, always skip
    if (existing.match_status === 'matched' && existing.job_heading) {
      return { job: existing, cached: true, status: existing.match_status };
    }
    // If not forcing, skip non-error records
    if (!force && existing.match_status !== 'error') {
      return { job: existing, cached: true, status: existing.match_status };
    }
    // Delete old records before retrying (error, no_match, needs_manual without data)
    await pool.query("DELETE FROM jobs WHERE email_id = $1", [email.id]);
  }

  // Strip Re:/Fwd: prefixes from subject
  const cleanSubject = (email.subject || "").replace(/^(Re|Fwd|Fw):\s*/i, "").trim();

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

    // Call V2 for enriched data
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
        // V2 enrichment is best-effort
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
        userId, email.id, job.id?.toString(),
        sanitize(job.first_name), sanitize(job.last_name), sanitize(job.email_id),
        sanitize(job.email_subject), sanitize(job.job_heading), sanitize(job.job_description),
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

    return { job: inserted[0], cached: false, status: 'matched' };
  }

  // Multiple matches - needs manual resolution
  if (!lhData.status && lhData.message && lhData.message.toLowerCase().includes("multiple")) {
    const { rows: multiMatch } = await pool.query(
      `INSERT INTO jobs (user_id, email_id, client_email, email_subject, match_status)
       VALUES ($1, $2, $3, $4, 'needs_manual')
       RETURNING *`,
      [userId, email.id, email.from_email, email.subject]
    );
    return { job: multiMatch[0], cached: false, status: 'needs_manual' };
  }

  // No match found
  const { rows: noMatch } = await pool.query(
    `INSERT INTO jobs (user_id, email_id, client_email, email_subject, match_status)
     VALUES ($1, $2, $3, $4, 'no_match')
     RETURNING *`,
    [userId, email.id, email.from_email, email.subject]
  );

  return { job: noMatch[0], cached: false, status: 'no_match' };
}

// ============================================================
// Bulk-match all unmatched emails for a user
// Finds emails with no job record, or with no_match/error/needs_manual status
// (i.e. emails that never got real job data from LeadHack)
// Returns: { matched, skipped, failed, noMatch, needsManual, total, errors }
// ============================================================
async function matchAllUnmatched(userId) {
  console.log(`[JobMatcher] Starting bulk match for user ${userId}`);

  // Get LeadHack token once for all requests
  const token = await getLeadHackToken(userId);

  // Find emails that either:
  // 1. Have no job record at all, OR
  // 2. Have a job record with no real data (no_match, error, needs_manual without job_heading)
  const { rows: emails } = await pool.query(
    `SELECT e.* FROM emails e
     LEFT JOIN jobs j ON j.email_id = e.id
     WHERE e.user_id = $1
       AND (
         j.id IS NULL
         OR (j.match_status IN ('no_match', 'error', 'needs_manual') AND j.job_heading IS NULL)
       )
     ORDER BY e.received_at DESC`,
    [userId]
  );

  console.log(`[JobMatcher] Found ${emails.length} unmatched emails`);

  let matched = 0;
  let skipped = 0;
  let failed = 0;
  let noMatch = 0;
  let needsManual = 0;
  const errors = [];

  for (const email of emails) {
    try {
      const result = await matchSingleEmail(userId, email, token, { force: true });

      if (result.cached) {
        skipped++;
      } else if (result.status === 'matched') {
        matched++;
        console.log(`[JobMatcher] Matched: "${email.subject}" -> "${result.job.job_heading}"`);
      } else if (result.status === 'no_match') {
        noMatch++;
      } else if (result.status === 'needs_manual') {
        needsManual++;
      }
    } catch (err) {
      failed++;
      errors.push({ emailId: email.id, subject: email.subject, error: err.message });
      console.error(`[JobMatcher] Failed for email ${email.id} ("${email.subject}"): ${err.message}`);

      // Still create an error record so we don't retry endlessly
      try {
        await pool.query(
          `INSERT INTO jobs (user_id, email_id, client_email, email_subject, match_status)
           VALUES ($1, $2, $3, $4, 'error')
           ON CONFLICT DO NOTHING`,
          [userId, email.id, email.from_email, email.subject]
        );
      } catch { /* ignore */ }
    }

    // Small delay to avoid hammering LeadHack API
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[JobMatcher] Bulk match complete: matched=${matched} noMatch=${noMatch} needsManual=${needsManual} skipped=${skipped} failed=${failed}`);

  return { matched, skipped, failed, noMatch, needsManual, total: emails.length, errors };
}

module.exports = { matchSingleEmail, matchAllUnmatched, getLeadHackToken, sanitize };
