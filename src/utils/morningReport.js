/**
 * Morning Report Generator v2
 *
 * Pulls data from:
 * - PostgreSQL (leads, pipeline, kill switch)
 * - Gmail Scheduled folder (queued follow-ups)
 * - Google Calendar (calls booked today) - tries ALL accounts
 *
 * Categorises overnight emails into positive / negative / new
 * Returns formatted WhatsApp message string
 */

const pool = require('../config/db');
const { decrypt } = require('./encryption');
const { google } = require('googleapis');

// -----------------------------------------
// Gmail OAuth helper
// -----------------------------------------
async function getOAuth2Client(userId) {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const { rows } = await pool.query(
    "SELECT service, encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service IN ('google_client_id','google_client_secret')",
    [userId]
  );
  for (const r of rows) {
    try {
      const val = decrypt(r.encrypted_key, r.iv, r.auth_tag);
      if (r.service === 'google_client_id') clientId = val;
      if (r.service === 'google_client_secret') clientSecret = val;
    } catch (_e) { /* fall back to env vars */ }
  }
  return new google.auth.OAuth2(clientId, clientSecret);
}

async function getAuthedClients(account, userId) {
  const oauth2 = await getOAuth2Client(userId);
  oauth2.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
  });
  try {
    const { credentials } = await oauth2.refreshAccessToken();
    if (credentials?.access_token) oauth2.setCredentials(credentials);
  } catch (e) {
    console.error(`[morningReport] Token refresh failed for ${account.email}:`, e.message);
  }
  return {
    gmail: google.gmail({ version: 'v1', auth: oauth2 }),
    calendar: google.calendar({ version: 'v3', auth: oauth2 }),
  };
}

// -----------------------------------------
// Gmail: get all scheduled send emails
// -----------------------------------------
async function getScheduledEmails(gmail) {
  const scheduled = new Set();
  try {
    let pageToken = null;
    do {
      const res = await gmail.users.messages.list({
        userId: 'me', q: 'in:scheduled', maxResults: 50,
        ...(pageToken && { pageToken }),
      });
      const messages = res.data.messages || [];
      pageToken = res.data.nextPageToken || null;
      for (const msg of messages) {
        const full = await gmail.users.messages.get({
          userId: 'me', id: msg.id, format: 'metadata',
          metadataHeaders: ['To'],
        });
        const to = full.data.payload?.headers?.find(h => h.name === 'To')?.value || '';
        const match = to.match(/[\w.+-]+@[\w-]+\.[a-zA-Z.]+/);
        if (match) scheduled.add(match[0].toLowerCase());
      }
    } while (pageToken);
  } catch (_e) { /* return whatever was collected */ }
  return scheduled;
}

// -----------------------------------------
// Calendar: get today's calls from ALL accounts
// -----------------------------------------
async function getTodaysCalls(calendarClients) {
  const calls = [];
  const seen = new Set(); // dedupe by event id

  // Today boundaries in IST
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const todayIST = istNow.toISOString().split('T')[0];
  const timeMin = `${todayIST}T00:00:00+05:30`;
  const timeMax = `${todayIST}T23:59:59+05:30`;

  for (const { calendar, email } of calendarClients) {
    try {
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin, timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const items = res.data.items || [];
      console.log(`[morningReport] Calendar ${email}: ${items.length} events today`);

      for (const event of items) {
        // Dedupe across accounts
        const eventKey = event.id?.split('_')[0] || event.id;
        if (seen.has(eventKey)) continue;
        seen.add(eventKey);

        const attendees = (event.attendees || []).filter(a => !a.self);
        if (attendees.length > 0 || event.conferenceData) {
          const startTime = event.start?.dateTime;
          const timeIST = startTime
            ? new Date(startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
            : 'All day';
          calls.push({
            time: timeIST,
            summary: event.summary || 'Untitled',
            attendee: attendees[0]?.email || '',
          });
        }
      }
    } catch (e) {
      console.error(`[morningReport] Calendar error (${email}):`, e.message);
    }
  }

  return calls;
}

// -----------------------------------------
// Helpers
// -----------------------------------------
function countryFlag(country) {
  if (!country) return '';
  const flags = {
    'united states': '\u{1F1FA}\u{1F1F8}', 'us': '\u{1F1FA}\u{1F1F8}', 'usa': '\u{1F1FA}\u{1F1F8}',
    'australia': '\u{1F1E6}\u{1F1FA}', 'au': '\u{1F1E6}\u{1F1FA}',
    'canada': '\u{1F1E8}\u{1F1E6}', 'ca': '\u{1F1E8}\u{1F1E6}',
    'united kingdom': '\u{1F1EC}\u{1F1E7}', 'uk': '\u{1F1EC}\u{1F1E7}',
    'india': '\u{1F1EE}\u{1F1F3}', 'in': '\u{1F1EE}\u{1F1F3}',
    'new zealand': '\u{1F1F3}\u{1F1FF}', 'nz': '\u{1F1F3}\u{1F1FF}',
    'netherlands': '\u{1F1F3}\u{1F1F1}',
    'cyprus': '\u{1F1E8}\u{1F1FE}',
    'romania': '\u{1F1F7}\u{1F1F4}',
    'dubai': '\u{1F1E6}\u{1F1EA}', 'uae': '\u{1F1E6}\u{1F1EA}', 'united arab emirates': '\u{1F1E6}\u{1F1EA}',
  };
  return flags[country.toLowerCase()] || '';
}

function signalEmojis(row) {
  const signals = [];
  if (row.has_phone) signals.push('📞');
  if (row.has_urgency) signals.push('⚡');
  if (row.hot_signal_flagged) signals.push('🔥');
  return signals.join('');
}

function snippet(text, maxLen) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}

// Positive intents: client is engaged, interested, asking questions
const POSITIVE_INTENTS = ['interested', 'inquiry', 'question', 'follow_up', 'call_request', 'hiring'];
// Negative intents: client is gone or hostile
const NEGATIVE_INTENTS = ['rejection', 'not_interested', 'complaint', 'spam'];

function isPositive(email) {
  if (POSITIVE_INTENTS.includes(email.intent)) return true;
  if (email.lead_score >= 60) return true;
  if (email.hot_signal_flagged) return true;
  return false;
}

function isNegative(email) {
  if (NEGATIVE_INTENTS.includes(email.intent)) return true;
  if (email.is_ooo) return true;
  // Detect hostile language in body
  const body = (email.body_text || '').toLowerCase();
  if (body.includes('stop bothering') || body.includes('will report') || body.includes('stop contacting')) return true;
  if (body.includes('already hired') || body.includes('not ready to select') || body.includes('decided to go with')) return true;
  return false;
}

// -----------------------------------------
// Main report generator
// -----------------------------------------
async function generateMorningReport(userId) {
  console.log('[morningReport] Generating report for user', userId);

  // Time window: midnight IST today
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIST = istNow.toISOString().split('T')[0];
  const overnightSince = new Date(`${todayIST}T00:00:00+05:30`).toISOString();

  // -- 1. Overnight emails (ALL of them, don't filter intent yet) --
  const overnight = await pool.query(`
    SELECT e.id, e.from_name, e.from_email, e.lead_score, e.has_phone, e.has_urgency,
           e.hot_signal_flagged, e.intent, e.is_ooo, e.body_text, e.subject,
           e.received_at, e.user_id,
           j.country, j.job_heading, j.match_status
    FROM emails e
    LEFT JOIN jobs j ON j.email_id = e.id
    WHERE e.received_at >= $1 AND e.user_id = $2
    ORDER BY e.lead_score DESC NULLS LAST
  `, [overnightSince, userId]);

  console.log(`[morningReport] ${overnight.rows.length} overnight emails found`);

  // Categorise
  const positive = [];
  const negative = [];
  const neutral = [];

  for (const email of overnight.rows) {
    if (isNegative(email)) {
      negative.push(email);
    } else if (isPositive(email)) {
      positive.push(email);
    } else {
      neutral.push(email);
    }
  }

  // -- 2. Active pipeline (broader: include matched + needs_manual) --
  const pipeline = await pool.query(`
    SELECT j.id, j.client_first_name, j.client_email, j.job_heading,
           j.match_status, j.thread_stage, j.follow_up_count,
           j.kill_switch_at, j.country,
           e.lead_score, e.has_phone, e.has_urgency, e.hot_signal_flagged,
           e.intent, e.received_at, e.status as email_status,
           (SELECT MAX(r.created_at) FROM replies r WHERE r.job_id = j.id) as last_reply_at,
           (SELECT COUNT(*) FROM replies r WHERE r.job_id = j.id) as reply_count
    FROM jobs j
    JOIN emails e ON e.id = j.email_id
    WHERE e.user_id = $1
      AND e.status != 'lost'
      AND e.intent NOT IN ('rejection')
      AND e.is_ooo = false
    ORDER BY e.lead_score DESC NULLS LAST
  `, [userId]);

  console.log(`[morningReport] ${pipeline.rows.length} pipeline jobs found`);

  // -- 3. Gmail: scheduled + calendar from ALL accounts --
  const accounts = await pool.query(
    'SELECT id, user_id, email, access_token, refresh_token, token_expiry FROM email_accounts WHERE user_id = $1',
    [userId]
  );

  const allScheduled = new Set();
  const calendarClients = [];

  for (const account of accounts.rows) {
    try {
      const { gmail, calendar } = await getAuthedClients(account, userId);
      const scheduled = await getScheduledEmails(gmail);
      scheduled.forEach(e => allScheduled.add(e));
      calendarClients.push({ calendar, email: account.email });
    } catch (e) {
      console.error(`[morningReport] Auth error for ${account.email}:`, e.message);
    }
  }

  console.log(`[morningReport] ${calendarClients.length} calendar clients, ${allScheduled.size} scheduled emails`);

  // -- 4. Today's calls from ALL calendar accounts --
  const todaysCalls = await getTodaysCalls(calendarClients);
  console.log(`[morningReport] ${todaysCalls.length} calls today`);

  // -- 5. Categorise pipeline --
  const needsAction = [];
  const activeThreads = [];
  const scheduledInGmail = [];

  for (const job of pipeline.rows) {
    const email = job.client_email?.toLowerCase();
    const isScheduled = email && allScheduled.has(email);
    const daysSinceReply = job.last_reply_at
      ? Math.floor((Date.now() - new Date(job.last_reply_at)) / (1000 * 60 * 60 * 24))
      : null;

    if (isScheduled) {
      scheduledInGmail.push(job);
      continue;
    }

    if (job.match_status === 'needs_manual') {
      needsAction.push({ ...job, reason: 'Needs job match' });
      continue;
    }

    if (!job.last_reply_at && job.match_status === 'matched') {
      needsAction.push({ ...job, reason: 'No reply sent' });
      continue;
    }

    if (daysSinceReply !== null && daysSinceReply <= 14) {
      activeThreads.push({ ...job, daysSinceReply });
    }
  }

  // -- 6. Format WhatsApp message --
  const now = new Date();
  const dateIST = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

  let msg = `*LMS Reply - ${dateIST}, 7AM*\n`;

  // POSITIVE signals
  if (positive.length > 0) {
    msg += `\n*🟢 Positive (${positive.length})*\n`;
    for (const e of positive) {
      const name = e.from_name || e.from_email;
      const signals = signalEmojis(e);
      const flag = countryFlag(e.country);
      const body = snippet(e.body_text, 60);
      msg += `• ${name} - ${e.lead_score || '?'}${signals ? ' ' + signals : ''} ${flag}\n`;
      if (body) msg += `  _"${body}"_\n`;
    }
  }

  // NEGATIVE signals
  if (negative.length > 0) {
    msg += `\n*🔴 Negative (${negative.length})*\n`;
    for (const e of negative) {
      const name = e.from_name || e.from_email;
      const reason = e.is_ooo ? 'OOO' : (e.intent || 'lost');
      const body = snippet(e.body_text, 60);
      msg += `• ${name} - ${reason.toUpperCase()}\n`;
      if (body) msg += `  _"${body}"_\n`;
    }
  }

  // NEW (neutral) - only if there are any worth showing
  if (neutral.length > 0) {
    msg += `\n*🆕 New (${neutral.length})*\n`;
    for (const e of neutral) {
      const name = e.from_name || e.from_email;
      const job = e.job_heading?.slice(0, 40) || '';
      msg += `• ${name} - ${e.lead_score || '?'}`;
      if (job) msg += ` | _${job}_`;
      msg += '\n';
    }
  }

  // CALLS TODAY
  if (todaysCalls.length > 0) {
    msg += `\n*📞 Calls Today (${todaysCalls.length})*\n`;
    for (const call of todaysCalls) {
      msg += `• ${call.time} - ${call.summary}\n`;
    }
  } else {
    msg += `\n*📞 Calls Today*\nNone scheduled\n`;
  }

  // NEEDS ACTION
  if (needsAction.length > 0) {
    msg += `\n*⚠️ Needs Action (${needsAction.length})*\n`;
    for (const job of needsAction.slice(0, 5)) {
      const name = job.client_first_name || job.client_email;
      msg += `• ${name} - _${job.reason}_\n`;
    }
    if (needsAction.length > 5) {
      msg += `  _...and ${needsAction.length - 5} more_\n`;
    }
  }

  // SCHEDULED IN GMAIL
  if (scheduledInGmail.length > 0) {
    msg += `\n*📅 Scheduled (${scheduledInGmail.length})*\n`;
    for (const job of scheduledInGmail) {
      const name = job.client_first_name || job.client_email;
      msg += `• ${name}\n`;
    }
  }

  // ACTIVE THREADS
  if (activeThreads.length > 0) {
    msg += `\n*💬 Active Threads (${activeThreads.length})*\n`;
    for (const job of activeThreads.slice(0, 5)) {
      const name = job.client_first_name || job.client_email;
      const stage = job.thread_stage || 'Discovery';
      const flag = countryFlag(job.country);
      msg += `• ${name} (${job.lead_score || '?'}) - ${stage} ${flag}\n`;
    }
    if (activeThreads.length > 5) {
      msg += `  _...and ${activeThreads.length - 5} more_\n`;
    }
  }

  // TOTALS
  msg += `\n*📊 Summary*\n`;
  msg += `${positive.length} positive | ${negative.length} negative | ${todaysCalls.length} calls | ${scheduledInGmail.length} scheduled`;

  return msg;
}

module.exports = { generateMorningReport };
