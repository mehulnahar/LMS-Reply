/**
 * Email Routes — INBOX-01
 *
 * GET  /api/emails                 — List emails (filterable by account, status, unread)
 * GET  /api/emails/:id             — Get single email with job match + replies
 * PUT  /api/emails/:id/status      — Update email status (new/replied/proposal_sent/won/lost/ignored)
 * POST /api/emails/sync-all        — Sync all connected accounts
 */

const express = require("express");
const { google } = require("googleapis");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");

const router = express.Router();

async function getOAuth2ClientForUser(userId, redirectUri) {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const { rows } = await pool.query(
    "SELECT service, encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service IN ('google_client_id', 'google_client_secret')",
    [userId]
  );
  for (const row of rows) {
    try {
      const val = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      if (row.service === "google_client_id") clientId = val;
      if (row.service === "google_client_secret") clientSecret = val;
    } catch { /* ignore */ }
  }
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

const VALID_STATUSES = ["new", "replied", "proposal_sent", "won", "lost", "ignored"];

// ============================================================
// GET /api/emails — Unified inbox
// ============================================================
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { account, status, unread, search, limit = 50, offset = 0 } = req.query;

    let where = "WHERE e.user_id = $1";
    const params = [req.user.id];
    let paramIdx = 2;

    if (account) {
      where += ` AND e.account_id = $${paramIdx}`;
      params.push(account);
      paramIdx++;
    }

    if (status) {
      where += ` AND e.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    if (unread === "true") {
      where += " AND e.is_unread = true";
    }

    if (search) {
      where += ` AND (e.subject ILIKE $${paramIdx} OR e.from_name ILIKE $${paramIdx} OR e.from_email ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const query = `
      SELECT
        e.id, e.account_id, e.gmail_id, e.thread_id,
        e.from_email, e.from_name, e.subject, e.snippet,
        e.received_at, e.is_unread, e.status, e.lead_score,
        e.has_phone, e.has_urgency, e.is_ooo, e.is_redirect,
        e.extracted_phone,
        a.email AS account_email, a.color AS account_color,
        j.id AS job_id, j.job_heading, j.match_status
      FROM emails e
      JOIN email_accounts a ON e.account_id = a.id
      LEFT JOIN jobs j ON j.email_id = e.id
      ${where}
      ORDER BY e.received_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(query, params);

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) FROM emails e ${where}`;
    const countParams = params.slice(0, paramIdx - 1); // exclude limit/offset
    const { rows: countRows } = await pool.query(countQuery, countParams);

    res.json({
      emails: rows.map((r) => ({
        id: r.id,
        accountId: r.account_id,
        accountEmail: r.account_email,
        accountColor: r.account_color,
        gmailId: r.gmail_id,
        threadId: r.thread_id,
        fromEmail: r.from_email,
        fromName: r.from_name,
        subject: r.subject,
        snippet: r.snippet,
        receivedAt: r.received_at,
        isUnread: r.is_unread,
        status: r.status,
        leadScore: r.lead_score,
        hasPhone: r.has_phone,
        hasUrgency: r.has_urgency,
        isOoo: r.is_ooo,
        isRedirect: r.is_redirect,
        extractedPhone: r.extracted_phone,
        jobId: r.job_id,
        jobHeading: r.job_heading,
        jobMatchStatus: r.match_status,
      })),
      total: parseInt(countRows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/emails/:id — Full email detail with job + replies
// ============================================================
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    // Get email
    const { rows: emailRows } = await pool.query(
      `SELECT e.*, a.email AS account_email, a.color AS account_color, a.display_name AS account_name
       FROM emails e
       JOIN email_accounts a ON e.account_id = a.id
       WHERE e.id = $1 AND e.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (emailRows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    const email = emailRows[0];

    // Get matched job
    const { rows: jobRows } = await pool.query(
      "SELECT * FROM jobs WHERE email_id = $1",
      [email.id]
    );

    // Get replies
    const { rows: replyRows } = await pool.query(
      "SELECT * FROM replies WHERE email_id = $1 ORDER BY created_at DESC",
      [email.id]
    );

    res.json({
      email: {
        id: email.id,
        accountId: email.account_id,
        accountEmail: email.account_email,
        accountColor: email.account_color,
        accountName: email.account_name,
        fromEmail: email.from_email,
        fromName: email.from_name,
        subject: email.subject,
        snippet: email.snippet,
        bodyText: email.body_text,
        bodyHtml: email.body_html,
        receivedAt: email.received_at,
        isUnread: email.is_unread,
        status: email.status,
        leadScore: email.lead_score,
        hasPhone: email.has_phone,
        hasUrgency: email.has_urgency,
        isOoo: email.is_ooo,
        isRedirect: email.is_redirect,
        extractedPhone: email.extracted_phone,
      },
      job: jobRows.length > 0 ? {
        id: jobRows[0].id,
        leadhackId: jobRows[0].leadhack_id,
        clientFirstName: jobRows[0].client_first_name,
        clientLastName: jobRows[0].client_last_name,
        clientEmail: jobRows[0].client_email,
        emailSubject: jobRows[0].email_subject,
        jobHeading: jobRows[0].job_heading,
        jobDescription: jobRows[0].job_description,
        matchStatus: jobRows[0].match_status,
        matchedAt: jobRows[0].matched_at,
      } : null,
      replies: replyRows.map((r) => ({
        id: r.id,
        tone: r.tone,
        intent: r.intent,
        generatedText: r.generated_text,
        editedText: r.edited_text,
        wasCopied: r.was_copied,
        model: r.model,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PUT /api/emails/:id/status — Update lead status
// ============================================================
router.put("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const result = await pool.query(
      `UPDATE emails SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, status`,
      [status, req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/emails/sync-all — Sync all connected accounts
// ============================================================
router.post("/sync-all", requireAuth, async (req, res, next) => {
  try {
    const { rows: accounts } = await pool.query(
      "SELECT * FROM email_accounts WHERE user_id = $1 AND status != 'disconnected'",
      [req.user.id]
    );

    if (accounts.length === 0) {
      return res.json({ message: "No connected accounts", results: [] });
    }

    const results = [];

    const redirectUri = `${req.protocol}://${req.get("host")}/api/gmail/callback`;

    for (const account of accounts) {
      try {
        const oauth2 = await getOAuth2ClientForUser(req.user.id, redirectUri);
        if (!oauth2) {
          results.push({ account: account.email, synced: 0, status: "error", error: "Google OAuth not configured" });
          continue;
        }

        oauth2.setCredentials({
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
        });

        // Refresh if needed
        try {
          const { credentials } = await oauth2.refreshAccessToken();
          if (credentials.access_token !== account.access_token) {
            await pool.query(
              "UPDATE email_accounts SET access_token = $1, token_expiry = $2, updated_at = NOW() WHERE id = $3",
              [credentials.access_token, credentials.expiry_date ? new Date(credentials.expiry_date) : null, account.id]
            );
            oauth2.setCredentials(credentials);
          }
        } catch {
          // If refresh fails, try with existing token
        }

        const gmail = google.gmail({ version: "v1", auth: oauth2 });

        // Check which emails are still unread in Gmail
        const listRes = await gmail.users.messages.list({
          userId: "me",
          q: "is:unread",
          maxResults: 50,
        });

        const gmailUnreadIds = new Set((listRes.data.messages || []).map((m) => m.id));

        // Mark emails as read in our DB if they're no longer unread in Gmail
        await pool.query(
          `UPDATE emails SET is_unread = false, updated_at = NOW()
           WHERE account_id = $1 AND is_unread = true AND gmail_id != ALL($2::text[])`,
          [account.id, Array.from(gmailUnreadIds)]
        );

        // Pull new unread emails
        let synced = 0;
        for (const msg of (listRes.data.messages || [])) {
          const existing = await pool.query(
            "SELECT id FROM emails WHERE account_id = $1 AND gmail_id = $2",
            [account.id, msg.id]
          );
          if (existing.rows.length > 0) {
            // Make sure it's marked as unread
            await pool.query(
              "UPDATE emails SET is_unread = true, updated_at = NOW() WHERE account_id = $1 AND gmail_id = $2 AND is_unread = false",
              [account.id, msg.id]
            );
            continue;
          }

          const full = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });

          const headers = full.data.payload?.headers || [];
          const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
          const fromRaw = getHeader("From");
          const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
          const fromName = fromMatch ? fromMatch[1].replace(/"/g, "").trim() : fromRaw;
          const fromEmail = fromMatch ? fromMatch[2] : fromRaw;

          let bodyText = "";
          let bodyHtml = "";
          const extractParts = (payload) => {
            if (payload.body?.data) {
              const decoded = Buffer.from(payload.body.data, "base64url").toString("utf8");
              if (payload.mimeType === "text/plain") bodyText = decoded;
              if (payload.mimeType === "text/html") bodyHtml = decoded;
            }
            if (payload.parts) {
              for (const part of payload.parts) extractParts(part);
            }
          };
          extractParts(full.data.payload);

          await pool.query(
            `INSERT INTO emails (user_id, account_id, gmail_id, thread_id, from_email, from_name, subject, snippet, body_text, body_html, received_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (account_id, gmail_id) DO NOTHING`,
            [
              req.user.id, account.id, msg.id, full.data.threadId,
              fromEmail, fromName, getHeader("Subject") || "(No subject)",
              full.data.snippet || "", bodyText, bodyHtml,
              new Date(parseInt(full.data.internalDate)),
            ]
          );
          synced++;
        }

        await pool.query(
          "UPDATE email_accounts SET last_sync_at = NOW(), status = 'connected', error_message = NULL, updated_at = NOW() WHERE id = $1",
          [account.id]
        );

        results.push({ account: account.email, synced, status: "ok" });
      } catch (err) {
        await pool.query(
          "UPDATE email_accounts SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
          [err.message, account.id]
        ).catch(() => {});
        results.push({ account: account.email, synced: 0, status: "error", error: err.message });
      }
    }

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
