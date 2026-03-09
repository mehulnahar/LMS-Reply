/**
 * Morning Report Generator
 *
 * Pulls data from:
 * - PostgreSQL (leads, pipeline, kill switch)
 * - Gmail Sent folder (confirmed follow-ups)
 * - Gmail Scheduled folder (queued follow-ups)
 * - Google Calendar (calls booked today)
 *
 * Returns formatted WhatsApp message string
 */

const pool = require('../config/db');
const { decrypt } = require('./encryption');
const { google } = require('googleapis');

// ─────────────────────────────────────────
// Gmail OAuth helper
// ─────────────────────────────────────────
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

async function getAuthedGmail(account, userId) {
  const oauth2 = await getOAuth2Client(userId);
  oauth2.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
  });
  try {
    const { credentials } = await oauth2.refreshAccessToken();
    if (credentials?.access_token) oauth2.setCredentials(credentials);
  } catch (_e) { /* continue with existing token */ }
  return { gmail: google.gmail({ version: 'v1', auth: oauth2 }), calendar: google.calendar({ version: 'v3', auth: oauth2 }) };
}

// ─────────────────────────────────────────
// Gmail: get all scheduled send emails
// ─────────────────────────────────────────
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
        // Extract email address
        const match = to.match(/[\w.+-]+@[\w-]+\.[a-zA-Z.]+/);
        if (match) scheduled.add(match[0].toLowerCase());
      }
    } while (pageToken);
  } catch (_e) { /* return whatever was collected */ }
  return scheduled;
}


// ─────────────────────────────────────────
// Calendar: get today's calls
// ─────────────────────────────────────────
async function getTodaysCalls(calendar) {
  const calls = [];
  try {
    // Today in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const todayIST = istNow.toISOString().split('T')[0];
    const timeMin = `${todayIST}T00:00:00+05:30`;
    const timeMax = `${todayIST}T23:59:59+05:30`;

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin, timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    for (const event of (res.data.items || [])) {
      // Only include events with external attendees (real calls, not internal)
      const attendees = (event.attendees || []).filter(a => !a.self);
      if (attendees.length > 0 || (event.conferenceData)) {
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
  } catch (_e) { /* calendar unavailable - return empty */ }
  return calls;
}

// ─────────────────────────────────────────
// Flag emojis
// ─────────────────────────────────────────
function countryFlag(country) {
  if (!country) return '';
  const flags = {
    'united states': '🇺🇸', 'us': '🇺🇸', 'usa': '🇺🇸',
    'australia': '🇦🇺', 'au': '🇦🇺',
    'canada': '🇨🇦', 'ca': '🇨🇦',
    'united kingdom': '🇬🇧', 'uk': '🇬🇧',
    'india': '🇮🇳', 'in': '🇮🇳',
    'new zealand': '🇳🇿', 'nz': '🇳🇿',
    'netherlands': '🇳🇱',
    'cyprus': '🇨🇾',
    'romania': '🇷🇴',
    'dubai': '🇦🇪', 'uae': '🇦🇪', 'united arab emirates': '🇦🇪',
  };
  return flags[country.toLowerCase()] || '';
}

function signalEmojis(job) {
  const signals = [];
  if (job.has_phone) signals.push('📞');
  if (job.has_urgency) signals.push('⚡');
  if (job.hot_signal_flagged) signals.push('🔥');
  return signals.join('');
}

// ─────────────────────────────────────────
// Main report generator
// ─────────────────────────────────────────
async function generateMorningReport(userId) {
  // Time window: last 12 hours (overnight)
  const overnightSince = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  // ── 1. New overnight leads ──
  const newLeads = await pool.query(`
    SELECT e.from_name, e.from_email, e.lead_score, e.has_phone, e.has_urgency,
           e.hot_signal_flagged, e.intent, j.country, j.job_heading, j.match_status,
           e.received_at
    FROM emails e
    LEFT JOIN jobs j ON j.email_id = e.id
    WHERE e.received_at >= $1
      AND e.intent NOT IN ('rejection', 'ooo')
      AND e.is_ooo = false
    ORDER BY e.lead_score DESC NULLS LAST
  `, [overnightSince]);

  // ── 2. Full pipeline ──
  const pipeline = await pool.query(`
    SELECT j.id, j.client_first_name, j.client_email, j.job_heading,
           j.match_status, j.thread_stage, j.follow_up_count,
           j.kill_switch_at, j.stall_type, j.next_step_followup_date,
           j.research_classification, j.country,
           e.lead_score, e.has_phone, e.has_urgency, e.hot_signal_flagged,
           e.intent, e.received_at, e.status as email_status,
           (SELECT MAX(r.created_at) FROM replies r WHERE r.job_id = j.id) as last_reply_at,
           (SELECT COUNT(*) FROM replies r WHERE r.job_id = j.id) as reply_count
    FROM jobs j
    JOIN emails e ON e.id = j.email_id
    WHERE j.match_status NOT IN ('no_match', 'error')
      AND e.intent NOT IN ('rejection')
      AND e.status != 'lost'
    ORDER BY e.lead_score DESC NULLS LAST
  `);

  // ── 3. Gmail: scheduled + sent check ──
  const accounts = await pool.query(
    'SELECT id, user_id, email, access_token, refresh_token, token_expiry FROM email_accounts WHERE user_id = $1',
    [userId]
  );

  // Collect all scheduled recipient emails across all accounts
  const allScheduled = new Set();
  const gmailClients = [];
  let calendarClient = null;

  for (const account of accounts.rows) {
    try {
      const { gmail, calendar } = await getAuthedGmail(account, userId);
      gmailClients.push(gmail);
      if (!calendarClient) calendarClient = calendar;
      const scheduled = await getScheduledEmails(gmail);
      scheduled.forEach(e => allScheduled.add(e));
    } catch (e) {
      console.error('[morningReport] Gmail auth error:', e.message);
    }
  }

  // ── 4. Today's calls ──
  const todaysCalls = calendarClient ? await getTodaysCalls(calendarClient) : [];

  // ── 5. Categorise pipeline ──
  const needsAction = [];    // no reply ever sent
  const killSwitchExpired = [];
  const activeThreads = [];
  const scheduledInGmail = [];

  for (const job of pipeline.rows) {
    const email = job.client_email?.toLowerCase();
    const isScheduled = email && allScheduled.has(email);
    const daysSinceReply = job.last_reply_at
      ? Math.floor((Date.now() - new Date(job.last_reply_at)) / (1000 * 60 * 60 * 24))
      : null;

    // Kill switch expired
    if (job.kill_switch_at && new Date(job.kill_switch_at) < new Date()) {
      killSwitchExpired.push(job);
      continue;
    }

    // Needs manual match
    if (job.match_status === 'needs_manual') {
      needsAction.push({ ...job, reason: 'Needs job match' });
      continue;
    }

    // No reply ever sent
    if (!job.last_reply_at) {
      needsAction.push({ ...job, reason: 'No reply sent yet' });
      continue;
    }

    // Scheduled in Gmail
    if (isScheduled) {
      scheduledInGmail.push(job);
      continue;
    }

    // Active thread
    if (daysSinceReply !== null && daysSinceReply <= 7) {
      activeThreads.push({ ...job, daysSinceReply });
    }
  }

  // ── 6. Format WhatsApp message ──
  const now = new Date();
  const dateIST = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

  let msg = `*🌅 LMS Reply — ${dateIST}, 7AM*\n`;

  // New leads
  if (newLeads.rows.length > 0) {
    msg += `\n*🔥 New Leads (${newLeads.rows.length})*\n`;
    for (const lead of newLeads.rows) {
      const signals = signalEmojis(lead);
      const flag = countryFlag(lead.country);
      const name = lead.from_name || lead.from_email;
      const job = lead.job_heading?.slice(0, 40) || 'Unknown job';
      msg += `• ${name} — ${lead.lead_score || '?'}${signals ? ' ' + signals : ''} ${flag}\n`;
      msg += `  _${job}_\n`;
    }
  }

  // Needs action
  if (needsAction.length > 0) {
    msg += `\n*❌ Needs Action (${needsAction.length})*\n`;
    for (const job of needsAction) {
      const signals = signalEmojis(job);
      const name = job.client_first_name || job.client_email;
      const daysOld = Math.floor((Date.now() - new Date(job.received_at)) / (1000 * 60 * 60 * 24));
      msg += `• ${name} — ${job.lead_score || '?'}${signals ? ' ' + signals : ''} | ${daysOld}d old\n`;
      msg += `  _${job.reason}_\n`;
    }
  }

  // Calls today
  if (todaysCalls.length > 0) {
    msg += `\n*📞 Calls Today (${todaysCalls.length})*\n`;
    for (const call of todaysCalls) {
      msg += `• ${call.time} — ${call.summary}\n`;
      if (call.attendee) msg += `  _${call.attendee}_\n`;
    }
  } else {
    msg += `\n*📞 Calls Today*\nNone scheduled\n`;
  }

  // Scheduled in Gmail
  if (scheduledInGmail.length > 0) {
    msg += `\n*📅 Scheduled in Gmail (${scheduledInGmail.length})*\n`;
    for (const job of scheduledInGmail) {
      const name = job.client_first_name || job.client_email;
      msg += `• ${name} (${job.lead_score || '?'})\n`;
    }
  }

  // Kill switch expired
  if (killSwitchExpired.length > 0) {
    msg += `\n*☠️ Kill Switch Expired (${killSwitchExpired.length})*\n`;
    for (const job of killSwitchExpired) {
      const name = job.client_first_name || job.client_email;
      const daysExpired = Math.floor((Date.now() - new Date(job.kill_switch_at)) / (1000 * 60 * 60 * 24));
      msg += `• ${name} — ${daysExpired}d ago\n`;
    }
  }

  // Active threads
  if (activeThreads.length > 0) {
    msg += `\n*🟢 Active Threads (${activeThreads.length})*\n`;
    for (const job of activeThreads.slice(0, 5)) {
      const name = job.client_first_name || job.client_email;
      const stage = job.thread_stage || 'Discovery';
      const flag = countryFlag(job.country);
      msg += `• ${name} (${job.lead_score || '?'}) — ${stage} ${flag}\n`;
    }
    if (activeThreads.length > 5) {
      msg += `  _...and ${activeThreads.length - 5} more_\n`;
    }
  }

  // Totals
  const totalActive = pipeline.rows.filter(j => j.email_status !== 'lost').length;
  msg += `\n*📊 Pipeline*\n`;
  msg += `${totalActive} active | ${todaysCalls.length} calls today | ${scheduledInGmail.length} scheduled`;

  return msg;
}

module.exports = { generateMorningReport };
