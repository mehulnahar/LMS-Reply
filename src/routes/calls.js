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
// Automated / no-reply email exclusion
// These senders produce junk matches in fuzzy strategies
// ─────────────────────────────────────────
const AUTOMATED_SENDER_PATTERNS = [
  /^no-?reply@/i,
  /^noreply@/i,
  /^notifications?@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^do-?not-?reply@/i,
  /^support@/i,
  /^info@upwork\.com$/i,
  /^donotreply@/i,
  /@tldv\.io$/i,
  /@calendly\.com$/i,
  /@zoom\.us$/i,
  /@meetingbird\.com$/i,
];

function isAutomatedSender(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  return AUTOMATED_SENDER_PATTERNS.some(p => p.test(lower));
}

// Minimum lead_score for fuzzy strategies (3, 4, 5)
// Prevents low-quality automated emails from being returned as client matches
const FUZZY_MIN_LEAD_SCORE = 15;

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
async function enrichEventWithClient(userId, attendeeEmails, eventTitle) {
  if (!attendeeEmails.length && !eventTitle) return null;

  const emails = attendeeEmails.map((e) => e.toLowerCase());
  console.log(`[Calls:enrich] Trying to match: emails=${emails.join(',')} title="${eventTitle || ''}" userId=${userId}`);

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

  if (rows[0]) {
    console.log(`[Calls:enrich] Strategy 1 HIT: from_email match -> ${rows[0].from_email}`);
    return rows[0];
  }
  console.log(`[Calls:enrich] Strategy 1 miss: no from_email match`);

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
    console.log(`[Calls:enrich] Strategy 2 HIT: client_email match -> ${jobRows[0].client_email}`);
    const row = jobRows[0];
    if (row.client_first_name && (!row.from_name || row.from_name.includes('@'))) {
      row.from_name = row.client_first_name;
    }
    return row;
  }
  console.log(`[Calls:enrich] Strategy 2 miss: no client_email match`);

  // Strategy 3: Fuzzy match - check if attendee name appears in email subject or from_name
  // This catches cases where the email is different but the person is the same
  // Filters out automated senders and requires minimum lead_score
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
         AND COALESCE(e.lead_score, 0) >= $4
       ORDER BY e.lead_score DESC NULLS LAST, e.received_at DESC
       LIMIT 1`,
      [userId, hint, `%${hint}%`, FUZZY_MIN_LEAD_SCORE]
    );
    if (fuzzyRows[0] && !isAutomatedSender(fuzzyRows[0].from_email)) {
      console.log(`[Calls:enrich] Strategy 3 HIT: fuzzy name "${hint}" -> ${fuzzyRows[0].from_name} (score: ${fuzzyRows[0].lead_score})`);
      return fuzzyRows[0];
    }
  }
  console.log(`[Calls:enrich] Strategy 3 miss: no fuzzy name match (hints: ${nameHints.join(', ')})`);

  // Strategy 4: Match event title against job_heading
  // Calendar events often follow pattern "[Topic] Discussion" which maps to job headings
  // Filters out automated senders
  if (eventTitle) {
    const cleanTitle = eventTitle
      .replace(/\s*(Discussion|Call|Meeting|Chat|Sync|Intro)\s*$/i, '')
      .trim();
    if (cleanTitle.length >= 5) {
      console.log(`[Calls:enrich] Strategy 4: searching job_heading for "${cleanTitle}"`);
      const { rows: titleRows } = await pool.query(
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
           AND LOWER(j.job_heading) LIKE $2
         ORDER BY e.lead_score DESC NULLS LAST, e.received_at DESC
         LIMIT 1`,
        [userId, `%${cleanTitle.toLowerCase()}%`]
      );
      if (titleRows[0] && !isAutomatedSender(titleRows[0].from_email)) {
        console.log(`[Calls:enrich] Strategy 4 HIT: title match -> "${titleRows[0].job_heading}" (score: ${titleRows[0].lead_score})`);
        return titleRows[0];
      }
      console.log(`[Calls:enrich] Strategy 4 miss: no job_heading match for "${cleanTitle}"`);
    }
  }

  // Strategy 5: Match event title keywords against email subject
  // Upwork email subjects often contain the job topic
  // Filters out automated senders and requires minimum lead_score
  if (eventTitle) {
    const keywords = eventTitle
      .replace(/\s*(Discussion|Call|Meeting|Chat|Sync|Intro|Demo|Updates?\s*Call|Process)\s*$/i, '')
      .replace(/^\s*/, '')
      .replace(/\s*-\s*$/, '')
      .trim()
      .split(/\s+/)
      .filter(w => w.length >= 3 && !['the', 'and', 'for', 'with', 'sync', 'project', 'proposal', 'saas', 'lead', 'team', 'sales'].includes(w.toLowerCase()));
    if (keywords.length >= 1) {
      // Try full multi-word pattern first (most specific) - only when 2+ keywords
      if (keywords.length >= 2) {
        const fullPattern = keywords.map(k => k.toLowerCase()).join('%');
        console.log(`[Calls:enrich] Strategy 5a: full subject pattern "%${fullPattern}%"`);
        const { rows: subjectRows } = await pool.query(
          `SELECT
             e.id, e.from_name, e.from_email, e.lead_score, e.has_phone,
             e.has_urgency, e.hot_signal_flagged, e.intent, e.body_text AS email_body,
             e.received_at, e.subject,
             j.id AS job_id, j.job_heading, j.job_description, j.country,
             j.match_status, j.follow_up_count, j.client_first_name,
             j.kill_switch_at IS NOT NULL AS kill_switch_active,
             r.reply_text, r.created_at AS reply_date
           FROM emails e
           LEFT JOIN jobs j ON j.email_id = e.id
           LEFT JOIN LATERAL (
             SELECT COALESCE(edited_text, generated_text) AS reply_text, created_at FROM replies
             WHERE job_id = j.id
             ORDER BY created_at DESC LIMIT 1
           ) r ON true
           WHERE e.user_id = $1
             AND LOWER(e.subject) LIKE $2
             AND COALESCE(e.lead_score, 0) >= $3
           ORDER BY e.lead_score DESC NULLS LAST, e.received_at DESC
           LIMIT 1`,
          [userId, `%${fullPattern}%`, FUZZY_MIN_LEAD_SCORE]
        );
        if (subjectRows[0] && !isAutomatedSender(subjectRows[0].from_email)) {
          console.log(`[Calls:enrich] Strategy 5a HIT: subject match -> "${subjectRows[0].subject}" (score: ${subjectRows[0].lead_score})`);
          return subjectRows[0];
        }
      }

      // Try matching from_name against event title words (subject match only, not body)
      // Only match against from_name, NOT against subject (too loose - catches automated emails)
      console.log(`[Calls:enrich] Strategy 5b: searching from_name for title keywords`);
      for (const kw of keywords) {
        if (kw.length < 5) continue; // require longer keywords for single-word fuzzy match
        const { rows: nameRows } = await pool.query(
          `SELECT
             e.id, e.from_name, e.from_email, e.lead_score, e.has_phone,
             e.has_urgency, e.hot_signal_flagged, e.intent, e.body_text AS email_body,
             e.received_at, e.subject,
             j.id AS job_id, j.job_heading, j.job_description, j.country,
             j.match_status, j.follow_up_count, j.client_first_name,
             j.kill_switch_at IS NOT NULL AS kill_switch_active,
             r.reply_text, r.created_at AS reply_date
           FROM emails e
           LEFT JOIN jobs j ON j.email_id = e.id
           LEFT JOIN LATERAL (
             SELECT COALESCE(edited_text, generated_text) AS reply_text, created_at FROM replies
             WHERE job_id = j.id
             ORDER BY created_at DESC LIMIT 1
           ) r ON true
           WHERE e.user_id = $1
             AND LOWER(e.from_name) LIKE $2
             AND COALESCE(e.lead_score, 0) >= $3
           ORDER BY e.lead_score DESC NULLS LAST, e.received_at DESC
           LIMIT 1`,
          [userId, `%${kw.toLowerCase()}%`, FUZZY_MIN_LEAD_SCORE]
        );
        if (nameRows[0] && !isAutomatedSender(nameRows[0].from_email)) {
          console.log(`[Calls:enrich] Strategy 5b HIT: keyword "${kw}" -> from_name="${nameRows[0].from_name}" (score: ${nameRows[0].lead_score})`);
          return nameRows[0];
        }
      }
      console.log(`[Calls:enrich] Strategy 5 miss: no subject or name match`);
    }
  }

  console.log(`[Calls:enrich] ALL strategies failed for: ${emails.join(',')} / "${eventTitle || ''}"`);
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

          const client = await enrichEventWithClient(req.user.id, attendeeEmails, evt.summary);

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
