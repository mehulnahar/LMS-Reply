/**
 * Backfill V2 enrichment data for existing matched jobs
 * Handles jobs with and without upwork_link (re-queries V1 if needed)
 */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const LEADHACK_BASE = "https://app.leadhack.info:3000/api/admin";

function sanitize(val) {
  if (typeof val !== "string") return val;
  // eslint-disable-next-line no-control-regex
  return val.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

async function getUpworkLink(clientEmail, emailSubject) {
  const cleanSubject = emailSubject.replace(/^(Re|Fwd|Fw):\s*/i, "").trim();
  const res = await fetch(`${LEADHACK_BASE}/getJobDetails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email_id: clientEmail, email_subject: cleanSubject }),
  });
  const data = await res.json();
  if (data.status && data.data && data.data.length > 0) {
    return data.data[0].link || null;
  }
  return null;
}

async function enrichWithV2(link) {
  const res = await fetch(`${LEADHACK_BASE}/getJobDetailsV2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ link }),
  });
  const data = await res.json();
  if (data.status && data.data && data.data.length > 0) {
    return data.data[0];
  }
  return null;
}

async function run() {
  const { rows: jobs } = await pool.query(
    "SELECT id, upwork_link, client_email, email_subject, job_heading FROM jobs WHERE match_status = 'matched' AND v2_enriched_at IS NULL"
  );
  console.log(`Jobs needing V2 enrichment: ${jobs.length}`);

  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      let link = job.upwork_link;

      // Re-fetch from V1 if we don't have the link stored
      if (!link && job.client_email && job.email_subject) {
        console.log(`  → No link stored, re-querying V1 for: ${job.job_heading?.substring(0, 45)}`);
        link = await getUpworkLink(job.client_email, job.email_subject);
        if (link) {
          // Save the link while we're here
          await pool.query("UPDATE jobs SET upwork_link = $1 WHERE id = $2", [link, job.id]);
          console.log(`    Got link: ${link}`);
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!link) {
        console.log(`  ✗ skip (no link): ${job.job_heading?.substring(0, 50)}`);
        skipped++;
        continue;
      }

      const v2 = await enrichWithV2(link);

      if (v2) {
        await pool.query(
          `UPDATE jobs SET
            country = $1, city = $2, company = $3, workload = $4, duration = $5,
            payment_type = $6, amount = $7, hourly_budget_min = $8, hourly_budget_max = $9,
            hourly_budget_type = $10, is_payment_verified = $11, is_enterprise = $12,
            buyer_history_amount = $13, avg_hourly_rate = $14, total_jobs_posted = $15,
            total_jobs_with_hires = $16, contractor_tier = $17, category = $18,
            sub_category = $19, industry = $20, lead_id = $21, v2_enriched_at = NOW()
          WHERE id = $22`,
          [
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
            job.id,
          ]
        );

        console.log(
          `  ✓ ${(job.job_heading || "").substring(0, 45).padEnd(45)} → ${v2.country || "?"}, ${v2.city || "?"}`
        );
        enriched++;
      } else {
        console.log(`  ✗ no V2 data: ${job.job_heading?.substring(0, 50)}`);
        skipped++;
      }

      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(`  ✗ error for job ${job.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone — enriched: ${enriched}  skipped: ${skipped}  failed: ${failed}`);
  await pool.end();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
