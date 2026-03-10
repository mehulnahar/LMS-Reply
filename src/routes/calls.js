/**
 * Calls Routes
 *
 * GET /api/calls/events?start=ISO&end=ISO
 *   Fetches Google Calendar events across all connected accounts
 *   and enriches each event with matching client context from the DB.
 */

const express = require("express");
const { google } = require("googleapis");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");

const router = express.Router();

// ─────────────────────────────────────────
// Build OAuth2 client for a user
// ─────────────────────────────────────────
async function getOAuth2ClientForUser(userId) {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const { rows } = await pool.query(
    "SELECT service, encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service IN ('google_client_id', 'google_client_secret')",
    [userId]
  );
  for (const r of rows) {
    try {
      const val = decrypt(r.encrypted_key, r.iv, r.auth_tag);
      if (r.service === "google_client_id") clientId = val;
      if (r.service === "google_client_secret") clientSecret = val;
    } catch {
      // fall back to env vars
    }
  }

  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret);
}

// ─────────────────────────────────────────
// Get authed Calendar client for an account
// ─────────────────────────────────────────
async function getCalendarClient(account, userId) {
  const oauth2 = await getOAuth2ClientForUser(userId);
  if (!oauth2) return null;

  oauth2.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
  });

  try {
    const { credentials } = await oauth2.refreshAccessToken();
    if (credentials?.access_token) oauth2.setCredentials(credentials);
  } catch {
    // continue with existing token
  }

  return google.calendar({ version: "v3", auth: oauth2 });
}

// ─────────────────────────────────────────
// Enrich event with matching client context
// ─────────────────────────────────────────
async function enrichEventWithClient(userId, attendeeEmails) {
  if (!attendeeEmails.length) return null;

  const emails = attendeeEmails.map((e) => e.toLowerCase());

  // Strategy 1: Match attendee email against emails.from_email (direct sender match)
  const { rows } = await pool.query(
    `SELECT
       e.id, e.from_name, e.from_email, e.lead_score, e.has_phone,
       e.has_urgency, e.hot_signal_flagged, e.intent, e.body_text AS email_body,
       e.received_at,
       j.id AS job_id, j.job_heading, j.job_description, j.country,
       j.match_status, j.follow_up_count,
       j.kill_switch_at IS NOT NULL AS kill_switch_active,
       r.reply_text, r.created_at AS reply_date
     FROM emails e
     LEFT JOIN jobs j ON j.email_id = e.id
     LEFT JOIN LATERAL (
       SELECT COALESCE(edited_text, generated_text) AS reply_text, created_at FROM replies
       WHERE job_id = j.id
       ORDER BY created_at DESC LIMIT 1
     ) r ON true
     WHERE LOWER(e.from_email) = ANY($1) AND e.user_id = $2
     ORDER BY e.received_at DESC
     LIMIT 1`,
    [emails, userId]
  );

  if (rows[0]) return rows[0];

  // Strategy 2: Match attendee email against jobs.client_email (LeadHack enrichment data)
  // Upwork clients often use a different email for calendar invites vs Upwork notifications
  const { rows: jobRows } = await pool.query(
    `SELECT
       e.id, e.from_name, e.from_email, e.lead_score, e.has_phone,
       e.has_urgency, e.hot_signal_flagged, e.intent, e.body_text AS email_body,
       e.received_at,
       j.id AS job_id, j.job_heading, j.job_description, j.country,
       j.match_status, j.follow_up_count, j.client_first_name, j.client_email,
       j.kill_switch_at IS NOT NULL AS kill_switch_active,
       r.reply_text, r.created_at AS reply_date
     FROM jobs j
     JOIN emails e ON e.id = j.email_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(edited_text, generated_text) AS reply_text, created_at FROM replies
       WHERE job_id = j.id
       ORDER BY created_at DESC LIMIT 1
     ) r ON true
     WHERE LOWER(j.client_email) = ANY($1) AND e.user_id = $2
     ORDER BY e.received_at DESC
     LIMIT 1`,
    [emails, userId]
  );

  if (jobRows[0]) {
    const row = jobRows[0];
    // Use client_first_name from jobs if from_name is an Upwork notification address
    if (row.client_first_name && (!row.from_name || row.from_name.includes('@'))) {
      row.from_name = row.client_first_name;
    }
    return row;
  }

  // Strategy 3: Fuzzy match - check if attendee name appears in email subject or from_name
  // This catches cases where the email is different but the person is the same
  const nameHints = attendeeEmails.map(e => e.split('@')[0].replace(/[._-]/g, ' ').toLowerCase());
  for (const hint of nameHints) {
    if (hint.length < 3) continue; // skip very short hints like "a" or "hi"
    const { rows: fuzzyRows } = await pool.query(
      `SELECT
         e.id, e.from_name, e.from_email, e.lead_score, e.has_phone,
         e.has_urgency, e.hot_signal_flagged, e.intent, e.body_text AS email_body,
         e.received_at,
         j.id AS job_id, j.job_heading, j.job_description, j.country,
         j.match_status, j.follow_up_count, j.client_first_name,
         j.kill_switch_at IS NOT NULL AS kill_switch_active,
         r.reply_text, r.created_at AS reply_date
       FROM jobs j
       JOIN emails e ON e.id = j.email_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(edited_text, generated_text) AS reply_text, created_at FROM replies
         WHERE job_id = j.id
         ORDER BY created_at DESC LIMIT 1
       ) r ON true
       WHERE e.user_id = $1
         AND (LOWER(j.client_first_name) = $2 OR LOWER(e.from_name) LIKE $3)
       ORDER BY e.received_at DESC
       LIMIT 1`,
      [userId, hint, `%${hint}%`]
    );
    if (fuzzyRows[0]) return fuzzyRows[0];
  }

  return null;
}

// ============================================================
// GET /api/calls/events
// ============================================================
router.get("/events", requireAuth, async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: "start and end query params required" });
  }

  try {
    const { rows: accounts } = await pool.query(
      "SELECT id, email, access_token, refresh_token, token_expiry FROM email_accounts WHERE user_id = $1 AND status = $2",
      [req.user.id, "connected"]
    );

    if (!accounts.length) {
      console.log(`[Calls] No connected accounts for user ${req.user.id}`);
      return res.json({ events: [] });
    }

    console.log(`[Calls] ${accounts.length} account(s) found. timeMin=${start} timeMax=${end}`);

    const seen = new Set();
    const events = [];
    let needsReauth = false;

    for (const account of accounts) {
      try {
        const cal = await getCalendarClient(account, req.user.id);
        if (!cal) {
          console.log(`[Calls] No OAuth client for ${account.email}`);
          continue;
        }

        const response = await cal.events.list({
          calendarId: "primary",
          timeMin: start,
          timeMax: end,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 100,
        });

        console.log(`[Calls] ${account.email}: ${response.data.items?.length || 0} events returned`);

        for (const evt of response.data.items || []) {
          if (seen.has(evt.id)) continue;
          seen.add(evt.id);

          // Attendee emails excluding self
          const attendeeEmails = (evt.attendees || [])
            .map((a) => a.email)
            .filter((e) => e && e.toLowerCase() !== account.email.toLowerCase());

          const client = await enrichEventWithClient(req.user.id, attendeeEmails);

          events.push({
            id: evt.id,
            title: evt.summary || "(No title)",
            start: evt.start?.dateTime || evt.start?.date,
            end: evt.end?.dateTime || evt.end?.date,
            allDay: !evt.start?.dateTime,
            attendees: (evt.attendees || []).map((a) => ({
              email: a.email,
              name: a.displayName || a.email,
              self: !!a.self,
            })),
            location: evt.location || null,
            description: evt.description || null,
            calendarAccount: account.email,
            meetLink:
              evt.hangoutLink ||
              evt.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ||
              null,
            client,
          });
        }
      } catch (accountErr) {
        const msg = accountErr.message || "";
        const status = accountErr.response?.status || accountErr.code;
        const reason = accountErr.response?.data?.error?.errors?.[0]?.reason || "";
        const googleMsg = accountErr.response?.data?.error?.message || "";
        console.error(`[Calls] Calendar fetch error for ${account.email}: status=${status} reason=${reason} msg=${googleMsg || msg}`);

        const isScope =
          reason === "insufficientPermissions" ||
          googleMsg.toLowerCase().includes("insufficient") ||
          msg.toLowerCase().includes("insufficient") ||
          msg.toLowerCase().includes("scope");
        if (isScope) needsReauth = true;
      }
    }

    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({ events, needsReauth });
  } catch (err) {
    console.error("[Calls] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch calendar events" });
  }
});

module.exports = router;
