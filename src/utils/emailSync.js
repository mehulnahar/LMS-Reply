/**
 * Email Sync Utility
 *
 * Extracted from POST /api/emails/sync-all so it can be called from:
 * - The route handler (user-triggered sync)
 * - The morning report cron (pre-report sync)
 *
 * syncAllAccounts(userId) -> { results: [{ account, synced, status }] }
 */

const { google } = require('googleapis');
const pool = require('../config/db');
const { decrypt } = require('./encryption');
const { analyzeEmail, getAnthropicKey, intentToStatus } = require('./emailAnalysis');

async function getOAuth2Client(userId) {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const { rows } = await pool.query(
    "SELECT service, encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service IN ('google_client_id', 'google_client_secret')",
    [userId]
  );
  for (const row of rows) {
    try {
      const val = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      if (row.service === 'google_client_id') clientId = val;
      if (row.service === 'google_client_secret') clientSecret = val;
    } catch { /* ignore */ }
  }
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret);
}

async function syncAllAccounts(userId) {
  const { rows: accounts } = await pool.query(
    "SELECT * FROM email_accounts WHERE user_id = $1 AND status != 'disconnected'",
    [userId]
  );

  if (accounts.length === 0) {
    return { results: [{ account: 'none', synced: 0, status: 'no_accounts' }] };
  }

  const anthropicKey = await getAnthropicKey(userId);
  const results = [];

  for (const account of accounts) {
    try {
      const oauth2 = await getOAuth2Client(userId);
      if (!oauth2) {
        results.push({ account: account.email, synced: 0, status: 'error', error: 'Google OAuth not configured' });
        continue;
      }

      oauth2.setCredentials({
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
      });

      // Refresh token if needed
      try {
        const { credentials } = await oauth2.refreshAccessToken();
        if (credentials.access_token !== account.access_token) {
          await pool.query(
            'UPDATE email_accounts SET access_token = $1, token_expiry = $2, updated_at = NOW() WHERE id = $3',
            [credentials.access_token, credentials.expiry_date ? new Date(credentials.expiry_date) : null, account.id]
          );
          oauth2.setCredentials(credentials);
        }
      } catch {
        // Try with existing token
      }

      const gmail = google.gmail({ version: 'v1', auth: oauth2 });

      // Check which emails are still unread in Gmail (Upwork only)
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread subject:Upwork',
        maxResults: 50,
      });

      const gmailUnreadIds = new Set((listRes.data.messages || []).map((m) => m.id));

      // Mark emails as read in our DB if no longer unread in Gmail
      await pool.query(
        `UPDATE emails SET is_unread = false, updated_at = NOW()
         WHERE account_id = $1 AND is_unread = true AND gmail_id != ALL($2::text[])`,
        [account.id, Array.from(gmailUnreadIds)]
      );

      // Pull new unread emails
      let synced = 0;
      for (const msg of (listRes.data.messages || [])) {
        const existing = await pool.query(
          'SELECT id FROM emails WHERE account_id = $1 AND gmail_id = $2',
          [account.id, msg.id]
        );
        if (existing.rows.length > 0) {
          await pool.query(
            'UPDATE emails SET is_unread = true, updated_at = NOW() WHERE account_id = $1 AND gmail_id = $2 AND is_unread = false',
            [account.id, msg.id]
          );
          continue;
        }

        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const headers = full.data.payload?.headers || [];
        const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        const fromRaw = getHeader('From');
        const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
        const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : fromRaw;
        const fromEmail = fromMatch ? fromMatch[2] : fromRaw;

        let bodyText = '';
        let bodyHtml = '';
        const extractParts = (payload) => {
          if (payload.body?.data) {
            const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf8');
            if (payload.mimeType === 'text/plain') bodyText = decoded;
            if (payload.mimeType === 'text/html') bodyHtml = decoded;
          }
          if (payload.parts) {
            for (const part of payload.parts) extractParts(part);
          }
        };
        extractParts(full.data.payload);

        const emailSubject = getHeader('Subject') || '(No subject)';
        const ccRaw = getHeader('Cc') || null;

        await pool.query(
          `INSERT INTO emails (user_id, account_id, gmail_id, thread_id, from_email, from_name, subject, snippet, body_text, body_html, received_at, cc_raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (account_id, gmail_id) DO NOTHING`,
          [
            userId, account.id, msg.id, full.data.threadId,
            fromEmail, fromName, emailSubject,
            full.data.snippet || '', bodyText, bodyHtml,
            new Date(parseInt(full.data.internalDate)),
            ccRaw,
          ]
        );

        // AI-powered signal analysis (non-blocking)
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
          console.error(`[emailSync] Analysis failed for ${msg.id}:`, analysisErr.message);
        }

        synced++;
      }

      await pool.query(
        "UPDATE email_accounts SET last_sync_at = NOW(), status = 'connected', error_message = NULL, updated_at = NOW() WHERE id = $1",
        [account.id]
      );

      results.push({ account: account.email, synced, status: 'ok' });
    } catch (err) {
      await pool.query(
        "UPDATE email_accounts SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
        [err.message, account.id]
      ).catch(() => {});
      results.push({ account: account.email, synced: 0, status: 'error', error: err.message });
    }
  }

  return { results };
}

module.exports = { syncAllAccounts };
