/**
 * Gmail OAuth Routes — CONF-02
 *
 * GET    /api/gmail/auth-url         — Get OAuth consent URL
 * GET    /api/gmail/callback         — Handle OAuth callback
 * GET    /api/gmail/accounts         — List connected accounts
 * DELETE /api/gmail/accounts/:id     — Disconnect account
 * POST   /api/gmail/accounts/:id/sync — Trigger manual sync
 */

const express = require("express");
const { google } = require("googleapis");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");
const { analyzeEmail, getAnthropicKey, intentToStatus } = require("../utils/emailAnalysis");

const router = express.Router();

// Account color palette for multi-account differentiation
const ACCOUNT_COLORS = ["#4F46E5", "#059669", "#D97706", "#DC2626", "#7C3AED"];

/**
 * Build OAuth2 client from user's stored credentials.
 * Falls back to env vars if DB creds not found.
 */
async function getOAuth2ClientForUser(userId, redirectUri) {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Try reading from user's encrypted api_keys first
  const { rows } = await pool.query(
    "SELECT service, encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service IN ('google_client_id', 'google_client_secret')",
    [userId]
  );

  for (const row of rows) {
    try {
      const val = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      if (row.service === "google_client_id") clientId = val;
      if (row.service === "google_client_secret") clientSecret = val;
    } catch {
      // ignore decrypt errors, fall back to env
    }
  }

  if (!clientId || !clientSecret) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ============================================================
// GET /api/gmail/auth-url — Generate OAuth consent URL
// ============================================================
router.get("/auth-url", requireAuth, async (req, res) => {
  const redirectUri = `${req.protocol}://${req.get("host")}/api/gmail/callback`;
  const oauth2 = await getOAuth2ClientForUser(req.user.id, redirectUri);

  if (!oauth2) {
    return res.status(400).json({
      error: "Google OAuth not configured. Add your Google Client ID and Client Secret in Settings.",
    });
  }

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    state: req.user.id,
  });

  res.json({ url });
});

// ============================================================
// GET /api/gmail/callback — Handle OAuth callback from Google
// ============================================================
router.get("/callback", async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.redirect("/settings?gmail=error");
  }

  try {
    const redirectUri = `${req.protocol}://${req.get("host")}/api/gmail/callback`;
    const oauth2 = await getOAuth2ClientForUser(userId, redirectUri);

    if (!oauth2) {
      return res.redirect("/settings?gmail=error");
    }

    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    // Get user email from Google
    const people = google.people({ version: "v1", auth: oauth2 });
    const profile = await people.people.get({
      resourceName: "people/me",
      personFields: "emailAddresses,names",
    });

    const emailObj = profile.data.emailAddresses?.find((e) => e.metadata?.primary) || profile.data.emailAddresses?.[0];
    const nameObj = profile.data.names?.find((n) => n.metadata?.primary) || profile.data.names?.[0];
    const email = emailObj?.value;
    const displayName = nameObj?.displayName || email;

    if (!email) {
      return res.redirect("/settings?gmail=error");
    }

    // Pick a color for this account
    const { rows: existingAccounts } = await pool.query(
      "SELECT color FROM email_accounts WHERE user_id = $1",
      [userId]
    );
    const usedColors = existingAccounts.map((a) => a.color);
    const color = ACCOUNT_COLORS.find((c) => !usedColors.includes(c)) || ACCOUNT_COLORS[0];

    // Upsert: insert or update if re-connecting
    await pool.query(
      `INSERT INTO email_accounts (user_id, email, display_name, access_token, refresh_token, token_expiry, status, color)
       VALUES ($1, $2, $3, $4, $5, $6, 'connected', $7)
       ON CONFLICT (user_id, email) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, email_accounts.refresh_token),
         token_expiry = EXCLUDED.token_expiry,
         display_name = EXCLUDED.display_name,
         status = 'connected',
         error_message = NULL,
         updated_at = NOW()`,
      [
        userId,
        email,
        displayName,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        color,
      ]
    );

    res.redirect("/settings?gmail=connected");
  } catch (err) {
    console.error("Gmail OAuth callback error:", err.message);
    res.redirect("/settings?gmail=error");
  }
});

// ============================================================
// GET /api/gmail/accounts — List connected Gmail accounts
// ============================================================
router.get("/accounts", requireAuth, async (req, res, next) => {
  try {
    // Fetch accounts with email + reply counts for disconnect confirmation
    const { rows } = await pool.query(
      `SELECT ea.id, ea.email, ea.display_name, ea.sync_frequency,
              ea.last_sync_at, ea.status, ea.error_message, ea.color, ea.created_at,
              COALESCE(ec.email_count, 0)::int AS email_count,
              COALESCE(rc.reply_count, 0)::int AS reply_count
       FROM email_accounts ea
       LEFT JOIN (
         SELECT account_id, COUNT(*) AS email_count FROM emails GROUP BY account_id
       ) ec ON ec.account_id = ea.id
       LEFT JOIN (
         SELECT e.account_id, COUNT(*) AS reply_count
         FROM replies r JOIN emails e ON r.email_id = e.id
         GROUP BY e.account_id
       ) rc ON rc.account_id = ea.id
       WHERE ea.user_id = $1
       ORDER BY ea.created_at`,
      [req.user.id]
    );

    res.json(rows.map((a) => ({
      id: a.id,
      email: a.email,
      displayName: a.display_name,
      syncFrequency: a.sync_frequency,
      lastSyncAt: a.last_sync_at,
      status: a.status,
      errorMessage: a.error_message,
      color: a.color,
      createdAt: a.created_at,
      emailCount: a.email_count,
      replyCount: a.reply_count,
    })));
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DELETE /api/gmail/accounts/:id — Disconnect a Gmail account
// ============================================================
router.delete("/accounts/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM email_accounts WHERE id = $1 AND user_id = $2 RETURNING email",
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    res.json({ message: `Disconnected ${result.rows[0].email}` });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/gmail/accounts/:id/sync — Trigger manual sync
// ============================================================
router.post("/accounts/:id/sync", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    const account = rows[0];
    const redirectUri = `${req.protocol}://${req.get("host")}/api/gmail/callback`;
    const oauth2 = await getOAuth2ClientForUser(req.user.id, redirectUri);

    if (!oauth2) {
      return res.status(400).json({ error: "Google OAuth credentials not found in Settings." });
    }

    oauth2.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
    });

    // Auto-refresh if expired
    const { credentials } = await oauth2.refreshAccessToken().catch(() => ({ credentials: null }));
    if (credentials && credentials.access_token !== account.access_token) {
      await pool.query(
        `UPDATE email_accounts SET access_token = $1, token_expiry = $2, updated_at = NOW()
         WHERE id = $3`,
        [credentials.access_token, credentials.expiry_date ? new Date(credentials.expiry_date) : null, account.id]
      );
      oauth2.setCredentials(credentials);
    }

    // Get Anthropic key for AI analysis (once, not per-email)
    const anthropicKey = await getAnthropicKey(req.user.id);

    // Pull UNREAD emails from Gmail
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread subject:Upwork",
      maxResults: 50,
    });

    const messages = listRes.data.messages || [];
    let synced = 0;

    for (const msg of messages) {
      const existing = await pool.query(
        "SELECT id FROM emails WHERE account_id = $1 AND gmail_id = $2",
        [account.id, msg.id]
      );
      if (existing.rows.length > 0) continue;

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

      const emailSubject = getHeader("Subject") || "(No subject)";
      const ccRaw = getHeader("Cc") || null;
      const toRaw = getHeader("To") || "";
      const primaryEmail = (account.email || "").toLowerCase();

      // Parse To: header — capture the first address as the canonical to_email
      const parseFirstEmail = (raw) => {
        if (!raw) return null;
        const part = raw.split(",")[0].trim();
        const m = part.match(/<([^>]+)>/);
        return (m ? m[1] : part).trim().toLowerCase() || null;
      };
      const toEmail = parseFirstEmail(toRaw);

      // ── Alias auto-detection ──────────────────────────────────────────────
      // 1. From To: header of INCOMING emails — the alias clients reply to
      const toEmails = toRaw.split(",").map((part) => {
        const m = part.match(/<([^>]+)>/);
        return (m ? m[1] : part).trim().toLowerCase();
      }).filter(Boolean);
      for (const toAddr of toEmails) {
        if (toAddr && toAddr !== primaryEmail) {
          pool.query(
            `INSERT INTO user_email_aliases (user_id, alias_email, label)
             VALUES ($1, $2, 'auto-detected')
             ON CONFLICT (user_id, alias_email) DO NOTHING`,
            [req.user.id, toAddr]
          ).catch((e) => console.error("alias auto-detect (To) failed:", e.message));
        }
      }
      // 2. From CC: header of SENT emails — monitoring addresses like hiphype679@gmail.com
      //    that Ashish CC's on his own outbound emails so he can monitor replies
      if (fromEmail.toLowerCase() === primaryEmail && ccRaw) {
        const ccEmails = ccRaw.split(",").map((part) => {
          const m = part.match(/<([^>]+)>/);
          return (m ? m[1] : part).trim().toLowerCase();
        }).filter(Boolean);
        for (const ccAddr of ccEmails) {
          if (ccAddr && ccAddr !== primaryEmail) {
            pool.query(
              `INSERT INTO user_email_aliases (user_id, alias_email, label)
               VALUES ($1, $2, 'monitoring')
               ON CONFLICT (user_id, alias_email) DO NOTHING`,
              [req.user.id, ccAddr]
            ).catch((e) => console.error("alias auto-detect (sent CC) failed:", e.message));
          }
        }
      }

      await pool.query(
        `INSERT INTO emails (user_id, account_id, gmail_id, thread_id, from_email, from_name, subject, snippet, body_text, body_html, received_at, cc_raw, to_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (account_id, gmail_id) DO NOTHING`,
        [
          req.user.id, account.id, msg.id, full.data.threadId,
          fromEmail, fromName, emailSubject,
          full.data.snippet || "", bodyText, bodyHtml,
          new Date(parseInt(full.data.internalDate)),
          ccRaw, toEmail,
        ]
      );

      // AI-powered signal analysis (non-blocking — email syncs even if analysis fails)
      try {
        const signals = await analyzeEmail(bodyText, bodyHtml, emailSubject, anthropicKey);
        if (signals) {
          const autoStatus = intentToStatus(signals.intent, signals.is_ooo);
          await pool.query(
            `UPDATE emails SET lead_score = $1, has_phone = $2, extracted_phone = $3,
             has_urgency = $4, is_ooo = $5, is_redirect = $6,
             intent = $7, summary = $8, status = COALESCE($9, status),
             updated_at = NOW()
             WHERE account_id = $10 AND gmail_id = $11`,
            [signals.lead_score, signals.has_phone, signals.extracted_phone,
             signals.has_urgency, signals.is_ooo, signals.is_redirect,
             signals.intent, signals.summary, autoStatus,
             account.id, msg.id]
          );
        }
      } catch (analysisErr) {
        console.error(`Analysis failed for ${msg.id}:`, analysisErr.message);
      }

      synced++;
    }

    await pool.query(
      "UPDATE email_accounts SET last_sync_at = NOW(), status = 'connected', error_message = NULL, updated_at = NOW() WHERE id = $1",
      [account.id]
    );

    res.json({
      synced,
      total: messages.length,
      message: `Synced ${synced} new emails from ${account.email}`,
    });
  } catch (err) {
    await pool.query(
      "UPDATE email_accounts SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
      [err.message, req.params.id]
    ).catch(() => {});

    next(err);
  }
});

module.exports = router;
