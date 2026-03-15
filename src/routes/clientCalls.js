/**
 * Client Calls Routes - TLDV Integration
 *
 * GET  /api/client-calls                    - List all calls (filtered)
 * POST /api/client-calls/sync               - Sync from TLDV + match Gmail threads
 * GET  /api/client-calls/:id                - Single call detail
 * PUT  /api/client-calls/:id/status         - Manual status override
 * POST /api/client-calls/:id/analyze        - Run Claude analysis on transcript
 * POST /api/client-calls/:id/research       - Run Exa+Olostep research
 * POST /api/client-calls/:id/draft-reply    - Generate post-call reply draft
 * POST /api/client-calls/:id/draft-followup - Generate FU1/2/3 draft
 * POST /api/client-calls/:id/draft-rebook   - Generate no-show re-book email
 */

const express = require('express');
const { google } = require('googleapis');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');
const { appendSignatureBlock } = require('../utils/promptEnhancements');
const { researchSimilarExamples } = require('../utils/researchAgent');

const router = express.Router();

const TLDV_BASE = 'https://pasta.tldv.io';

// Internal meeting filters
const INTERNAL_TITLE_KEYWORDS = [
  'sync up', 'sync-up', 'standup', 'stand-up', 'daily', 'internal',
  'multimodal', 'cloudflare', 'team meeting', 'hype', 'mindcrew',
  'check-in', 'check in', 'debrief', 'retrospective', 'retro',
];
const INTERNAL_EMAIL_DOMAINS = [
  'hiphype.co', 'mindcrewtech.com', 'hypeops.art',
  'srijanamindcrew', 'madhuri.mindcrew', 'yashdeepmindcrew', 'sanjana.mouryamindcrew',
];

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function getApiKey(userId, service) {
  const { rows } = await pool.query(
    'SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = $2',
    [userId, service]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);
}

async function callClaudeHelper(systemPrompt, userMessage, apiKey, maxTokens = 1024) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }],
  };
  if (systemPrompt) body.system = systemPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function isInternalMeeting(name, invitees = []) {
  const lowerName = (name || '').toLowerCase();
  if (INTERNAL_TITLE_KEYWORDS.some(kw => lowerName.includes(kw))) return true;
  // Only flag as internal-by-domain if we actually have invitees AND all are internal
  if (invitees.length > 0 && invitees.every(email =>
    INTERNAL_EMAIL_DOMAINS.some(domain => email.toLowerCase().includes(domain))
  )) return true;
  return false;
}

async function fetchTldvMeetings(apiKey) {
  const meetings = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${TLDV_BASE}/v1alpha1/meetings?page=${page}&pageSize=50`;
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) throw new Error(`TLDV API error: ${res.status}`);
    const data = await res.json();
    // TLDV returns { page, pageSize, pages, total, results: [...] }
    if (Array.isArray(data.results)) meetings.push(...data.results);
    totalPages = Math.min(data.pages || 1, 10); // cap at 10 pages (500 meetings) for performance
    page++;
  } while (page <= totalPages);

  return meetings;
}

async function fetchTldvTranscript(meetingId, apiKey) {
  try {
    const res = await fetch(`${TLDV_BASE}/v1alpha1/meetings/${meetingId}/transcript`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // TLDV returns { id, meetingId, data: [{startTime, endTime, speaker, text}] }
    const segments = data.data || data.transcript?.segments || data.transcript;
    if (Array.isArray(segments) && segments.length > 0) {
      return segments.map(s => `${s.speaker || 'Speaker'}: ${s.text || s.content || ''}`).join('\n');
    }
    return typeof data.transcript === 'string' ? data.transcript : null;
  } catch {
    return null;
  }
}

async function getGmailClientForUser(userId) {
  // Get Google OAuth credentials
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const { rows: keyRows } = await pool.query(
    "SELECT service, encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service IN ('google_client_id', 'google_client_secret')",
    [userId]
  );
  for (const row of keyRows) {
    try {
      const val = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      if (row.service === 'google_client_id') clientId = val;
      if (row.service === 'google_client_secret') clientSecret = val;
    } catch { /* ignore */ }
  }

  if (!clientId || !clientSecret) return null;

  // Get first connected Gmail account tokens
  const { rows: accounts } = await pool.query(
    'SELECT access_token, refresh_token, token_expiry FROM email_accounts WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (!accounts.length) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({
    access_token: accounts[0].access_token,
    refresh_token: accounts[0].refresh_token,
    expiry_date: accounts[0].token_expiry ? new Date(accounts[0].token_expiry).getTime() : null,
  });

  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function findGmailThreadForEmail(gmail, inviteeEmail) {
  try {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: `from:${inviteeEmail} OR to:${inviteeEmail}`,
      maxResults: 1,
    });
    const threads = res.data.threads || [];
    if (!threads.length) return null;

    const threadId = threads[0].id;
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId });
    const messages = thread.data.messages || [];
    const subject = messages[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '';
    const lastMsg = messages[messages.length - 1];
    const lastDate = lastMsg?.payload?.headers?.find(h => h.name === 'Date')?.value;

    return {
      thread_id: threadId,
      subject,
      email_count: messages.length,
      last_date: lastDate ? new Date(lastDate).toISOString().split('T')[0] : null,
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// GET /api/client-calls
// ────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;
    let where = 'WHERE user_id = $1';
    const params = [req.user.id];

    if (status && status !== 'all') {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (meeting_name ILIKE $${params.length} OR analysis->>'client_name' ILIKE $${params.length} OR analysis->>'company' ILIKE $${params.length})`;
    }

    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(
      `SELECT id, meeting_name, duration, call_date, invitee_emails, status,
              analysis, gmail_thread_id, gmail_thread_subject, gmail_email_count,
              gmail_last_email_date, reply_draft, fu1_draft, fu2_draft, fu3_draft,
              rebook_draft, rebook_fu1_draft, analyzed_at,
              reply_sent_at, fu1_sent_at, fu2_sent_at, fu3_sent_at
       FROM client_calls
       ${where}
       ORDER BY call_date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM client_calls WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({ calls: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('GET /client-calls error:', err);
    res.status(500).json({ error: 'Failed to fetch client calls' });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/client-calls/ping-tldv
// Quick connectivity + key validity check (no sync, no DB writes)
// ────────────────────────────────────────────────────────────
router.get('/ping-tldv', requireAuth, async (req, res) => {
  try {
    const tldvKey = await getApiKey(req.user.id, 'tldv');
    if (!tldvKey) {
      return res.status(400).json({ ok: false, error: 'TLDV API key not configured' });
    }

    const url = `${TLDV_BASE}/v1alpha1/meetings?page=1&pageSize=1`;
    let status, body, networkError;

    try {
      const r = await fetch(url, { headers: { 'x-api-key': tldvKey }, signal: AbortSignal.timeout(10000) });
      status = r.status;
      body = await r.json().catch(() => null);
    } catch (fetchErr) {
      networkError = fetchErr.cause?.message || fetchErr.cause?.code || fetchErr.message;
    }

    if (networkError) {
      return res.json({ ok: false, error: `Network error: ${networkError}` });
    }
    if (status === 401) {
      return res.json({ ok: false, error: 'TLDV API key is invalid or expired (401)' });
    }
    if (status === 403) {
      return res.json({ ok: false, error: 'TLDV API key forbidden (403)' });
    }
    if (status !== 200) {
      return res.json({ ok: false, error: `TLDV returned HTTP ${status}`, body });
    }

    return res.json({ ok: true, message: 'TLDV connection healthy', total: body?.total ?? null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/client-calls/sync
// ────────────────────────────────────────────────────────────
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const tldvKey = await getApiKey(req.user.id, 'tldv');
    if (!tldvKey) {
      return res.status(400).json({ error: 'TLDV API key not configured. Add it in Settings.' });
    }

    const anthropicKey = await getApiKey(req.user.id, 'anthropic');
    const gmail = await getGmailClientForUser(req.user.id);

    // Fetch all meetings from TLDV
    const allMeetings = await fetchTldvMeetings(tldvKey);

    // Log first meeting shape for debugging
    if (allMeetings.length > 0) {
      console.log('[TLDV sync] Sample meeting keys:', Object.keys(allMeetings[0]));
      console.log('[TLDV sync] Sample meeting:', JSON.stringify(allMeetings[0], null, 2).slice(0, 500));
    } else {
      console.log('[TLDV sync] No meetings returned from TLDV API');
    }

    // Filter to client meetings only
    const clientMeetings = allMeetings.filter(m => {
      // Duration: TLDV may return seconds, minutes, or ms - handle all cases
      const rawDur = m.duration || m.durationMs || m.durationSeconds || 0;
      // If > 1000, assume milliseconds; if > 60, assume seconds; else assume minutes
      let dur;
      if (rawDur > 3600) dur = rawDur / 60000; // ms -> minutes
      else if (rawDur > 60) dur = rawDur / 60;  // seconds -> minutes
      else dur = rawDur;                          // already minutes

      if (dur < 4) {
        console.log(`[TLDV filter] Skipping "${m.name || m.title}" - duration ${dur.toFixed(1)} min < 4`);
        return false;
      }
      const invitees = (m.invitees || m.attendees || m.participants || [])
        .map(i => i.email || i).filter(Boolean);
      if (isInternalMeeting(m.name || m.title, invitees)) {
        console.log(`[TLDV filter] Skipping "${m.name || m.title}" - internal meeting`);
        return false;
      }
      return true;
    });

    let synced = 0;
    let newCalls = 0;
    let noShows = 0;
    let matchedThreads = 0;

    for (const mtg of clientMeetings) {
      const meetingId = mtg.id;
      const meetingName = mtg.name || mtg.title || 'Untitled Meeting';
      const rawDur = mtg.duration || mtg.durationMs || mtg.durationSeconds || 0;
      let durationMin;
      if (rawDur > 3600) durationMin = rawDur / 60000;
      else if (rawDur > 60) durationMin = rawDur / 60;
      else durationMin = rawDur;
      const callDate = (mtg.happenedAt || mtg.startedAt || mtg.date || mtg.createdAt)
        ? new Date(mtg.happenedAt || mtg.startedAt || mtg.date || mtg.createdAt).toISOString().split('T')[0] : null;
      const invitees = (mtg.invitees || mtg.attendees || mtg.participants || [])
        .map(i => i.email || i).filter(Boolean);

      // Check if already synced
      const { rows: existing } = await pool.query(
        'SELECT id, status FROM client_calls WHERE id = $1',
        [meetingId]
      );

      if (existing.length) {
        synced++;
        continue;
      }

      // Fetch transcript
      let transcript = await fetchTldvTranscript(meetingId, tldvKey);

      // No-show = no transcript (client didn't attend/speak).
      // If TLDV captured any transcript content, it was a real call regardless of duration.
      const isNoShow = !transcript || transcript.trim().length === 0;
      const status = isNoShow ? 'no_show' : 'prospect';
      if (isNoShow) noShows++;

      // Gmail thread matching
      let gmailThreadId = null;
      let gmailSubject = null;
      let gmailEmailCount = 0;
      let gmailLastDate = null;

      if (gmail && invitees.length) {
        for (const email of invitees) {
          const thread = await findGmailThreadForEmail(gmail, email);
          if (thread) {
            gmailThreadId = thread.thread_id;
            gmailSubject = thread.subject;
            gmailEmailCount = thread.email_count;
            gmailLastDate = thread.last_date;
            matchedThreads++;
            break;
          }
        }
      }

      // Insert into DB — ON CONFLICT DO NOTHING prevents duplicate key errors
      // if sync is triggered twice concurrently
      const { rowCount } = await pool.query(
        `INSERT INTO client_calls
           (id, user_id, meeting_name, duration, call_date, invitee_emails,
            transcript, status, gmail_thread_id, gmail_thread_subject,
            gmail_email_count, gmail_last_email_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [meetingId, req.user.id, meetingName, durationMin, callDate,
         invitees, transcript, status, gmailThreadId, gmailSubject,
         gmailEmailCount, gmailLastDate]
      );

      if (rowCount === 0) { synced++; continue; }
      newCalls++;

      // Auto-analyze if we have transcript + anthropic key (non-blocking, best-effort)
      if (!isNoShow && transcript && anthropicKey) {
        analyzeCallInBackground(meetingId, meetingName, durationMin, transcript, anthropicKey);
      }
    }

    // Back-fill transcripts for existing no_show records that have null transcript.
    // Process up to 50 per sync to avoid timeout. Each sync gradually self-heals.
    const { rows: needsTranscript } = await pool.query(
      `SELECT id FROM client_calls
       WHERE user_id = $1 AND status = 'no_show' AND transcript IS NULL
       LIMIT 50`,
      [req.user.id]
    );

    let repaired = 0;
    for (const row of needsTranscript) {
      const t = await fetchTldvTranscript(row.id, tldvKey);
      if (t && t.trim().length > 0) {
        // Fetch the meeting name for analysis
        const { rows: callRows } = await pool.query(
          'SELECT meeting_name, duration FROM client_calls WHERE id = $1',
          [row.id]
        );
        await pool.query(
          `UPDATE client_calls SET transcript = $1, status = 'prospect', updated_at = NOW() WHERE id = $2`,
          [t, row.id]
        );
        repaired++;
        // Kick off analysis for this newly-recovered record
        if (anthropicKey && callRows.length) {
          analyzeCallInBackground(row.id, callRows[0].meeting_name, callRows[0].duration, t, anthropicKey);
        }
      } else if (t !== null) {
        // API responded but empty — mark transcript as empty string so we don't retry
        await pool.query(
          `UPDATE client_calls SET transcript = '', updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
      }
    }

    // Auto-analyze up to 5 unanalyzed prospects per sync (catches backlog from before analysis worked)
    let autoAnalyzed = 0;
    if (anthropicKey) {
      const { rows: needsAnalysis } = await pool.query(
        `SELECT id, meeting_name, duration, transcript FROM client_calls
         WHERE user_id = $1 AND status != 'no_show' AND transcript IS NOT NULL
           AND transcript != '' AND analysis IS NULL
         LIMIT 5`,
        [req.user.id]
      );
      for (const row of needsAnalysis) {
        analyzeCallInBackground(row.id, row.meeting_name, row.duration, row.transcript, anthropicKey);
        autoAnalyzed++;
      }
    }

    // Count remaining records that still need repair or analysis
    const { rows: remaining } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'no_show' AND transcript IS NULL) AS needs_repair,
         COUNT(*) FILTER (WHERE status != 'no_show' AND transcript IS NOT NULL AND transcript != '' AND analysis IS NULL) AS needs_analysis
       FROM client_calls WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      message: 'Sync complete',
      total_meetings_from_tldv: allMeetings.length,
      client_meetings_filtered: clientMeetings.length,
      already_synced: synced,
      new_calls: newCalls,
      no_shows: noShows,
      repaired_status: repaired,
      auto_analyzed: autoAnalyzed,
      gmail_threads_matched: matchedThreads,
      still_needs_repair: parseInt(remaining[0].needs_repair),
      still_needs_analysis: parseInt(remaining[0].needs_analysis),
    });
  } catch (err) {
    console.error('POST /client-calls/sync error:', err);
    // Include err.cause for network-level errors (e.g. "fetch failed" hides ECONNREFUSED/ETIMEDOUT)
    const detail = err.cause?.message || err.cause?.code || err.message || 'Sync failed';
    res.status(500).json({ error: detail });
  }
});

// Fire-and-forget background analysis
function analyzeCallInBackground(meetingId, meetingName, duration, transcript, anthropicKey) {
  runCallAnalysis(meetingId, meetingName, duration, transcript, anthropicKey).catch(err => {
    console.error(`Background analysis failed for ${meetingId}:`, err.message);
  });
}

async function runCallAnalysis(meetingId, meetingName, duration, transcript, anthropicKey) {
  const systemPrompt = `You are analyzing a sales call transcript for a software development agency (HipHype Tech / MyCodeWorks). Extract key information as valid JSON only. No markdown, no explanation, just the JSON object.`;

  const userMessage = `Meeting: "${meetingName}"
Duration: ${Math.round(duration)} minutes
Transcript:
${transcript.slice(0, 8000)}

Extract this JSON:
{
  "client_name": "client first name only",
  "company": "company name or null",
  "meeting_type": "discovery|demo|strategy|delivery|no_show",
  "summary": "2-3 sentence summary of what was discussed",
  "promise": "what Ashish committed to deliver/send after this call (be specific)",
  "open_questions": ["unanswered question 1", "unanswered question 2"],
  "signals": {
    "budget_discussed": true,
    "timeline_mentioned": false,
    "urgency": false,
    "asked_for_examples": false,
    "asked_for_proposal": false
  }
}`;

  const raw = await callClaudeHelper(systemPrompt, userMessage, anthropicKey, 1024);

  // Extract JSON from response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return;

  const analysis = JSON.parse(jsonMatch[0]);

  await pool.query(
    'UPDATE client_calls SET analysis = $1, analyzed_at = NOW(), updated_at = NOW() WHERE id = $2',
    [JSON.stringify(analysis), meetingId]
  );
}

// ────────────────────────────────────────────────────────────
// GET /api/client-calls/:id
// ────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch call' });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/client-calls/:id/context
// Returns job post + full email conversation for this call
// ────────────────────────────────────────────────────────────
router.get('/:id/context', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, gmail_thread_id, invitee_emails FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    let job = null;
    let conversation = [];

    // ── Job: match by client_email against invitee_emails ──
    if (call.invitee_emails?.length) {
      const { rows: jobs } = await pool.query(
        `SELECT id, job_heading, job_description, client_first_name, client_last_name,
                client_email, upwork_link, country, city, company, workload, duration,
                payment_type, amount, hourly_budget_min, hourly_budget_max,
                is_payment_verified, total_jobs_posted, total_jobs_with_hires,
                avg_hourly_rate, buyer_history_amount, category, matched_at
         FROM jobs
         WHERE user_id = $1 AND client_email = ANY($2)
         ORDER BY matched_at DESC LIMIT 1`,
        [req.user.id, call.invitee_emails]
      );
      if (jobs.length) job = jobs[0];
    }

    // ── Conversation: fetch thread directly from Gmail API ──
    if (call.gmail_thread_id) {
      const gmail = await getGmailClientForUser(req.user.id);
      if (gmail) {
        try {
          const thread = await gmail.users.threads.get({
            userId: 'me',
            id: call.gmail_thread_id,
            format: 'full',
          });
          const messages = thread.data.messages || [];
          conversation = messages.map(msg => {
            const headers = msg.payload?.headers || [];
            const get = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

            // Extract plain text body
            let body = '';
            const extractText = (parts) => {
              if (!parts) return;
              for (const part of parts) {
                if (part.mimeType === 'text/plain' && part.body?.data) {
                  body = Buffer.from(part.body.data, 'base64').toString('utf8');
                  return;
                }
                if (part.parts) extractText(part.parts);
              }
            };
            if (msg.payload?.body?.data) {
              body = Buffer.from(msg.payload.body.data, 'base64').toString('utf8');
            } else {
              extractText(msg.payload?.parts);
            }

            return {
              id: msg.id,
              from: get('From'),
              to: get('To'),
              subject: get('Subject'),
              date: get('Date'),
              body: body.trim().slice(0, 3000), // cap at 3000 chars per email
            };
          });
        } catch (gmailErr) {
          console.error('Gmail thread fetch error:', gmailErr.message);
        }
      }
    }

    res.json({ job, conversation });
  } catch (err) {
    console.error('GET /client-calls/:id/context error:', err);
    res.status(500).json({ error: 'Failed to fetch context' });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /api/client-calls/:id/transcript
// Manually save (or replace) a transcript, then auto-analyze
// ────────────────────────────────────────────────────────────
router.put('/:id/transcript', requireAuth, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'Transcript text is required' });
  }

  try {
    // Save transcript + upgrade from no_show → prospect + clear stale analysis
    const { rows } = await pool.query(
      `UPDATE client_calls
       SET transcript = $1,
           status = CASE WHEN status = 'no_show' THEN 'prospect' ELSE status END,
           analysis = NULL,
           analyzed_at = NULL,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, meeting_name, duration, status, transcript`,
      [transcript.trim(), req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });

    const call = rows[0];

    // Kick off analysis immediately (fire-and-forget)
    const anthropicKey = await getApiKey(req.user.id, 'anthropic');
    if (anthropicKey) {
      analyzeCallInBackground(call.id, call.meeting_name, call.duration, call.transcript, anthropicKey);
    }

    res.json({ success: true, status: call.status });
  } catch (err) {
    console.error('PUT /transcript error:', err);
    res.status(500).json({ error: 'Failed to save transcript' });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /api/client-calls/:id/status
// ────────────────────────────────────────────────────────────
router.put('/:id/status', requireAuth, async (req, res) => {
  const VALID_STATUSES = ['hot_lead', 'no_show', 'delivery', 'prospect', 'lost', 're_engaging'];
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE client_calls SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id, status',
      [status, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/client-calls/:id/analyze
// ────────────────────────────────────────────────────────────
router.post('/:id/analyze', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    if (!call.transcript) {
      return res.status(400).json({ error: 'No transcript available for this call' });
    }

    const anthropicKey = await getApiKey(req.user.id, 'anthropic');
    if (!anthropicKey) return res.status(400).json({ error: 'Anthropic API key not configured' });

    await runCallAnalysis(call.id, call.meeting_name, call.duration, call.transcript, anthropicKey);

    const { rows: updated } = await pool.query(
      'SELECT analysis, analyzed_at FROM client_calls WHERE id = $1',
      [req.params.id]
    );
    res.json({ analysis: updated[0].analysis, analyzed_at: updated[0].analyzed_at });
  } catch (err) {
    console.error('POST /analyze error:', err);
    res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/client-calls/:id/research
// ────────────────────────────────────────────────────────────
router.post('/:id/research', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    const analysis = call.analysis || {};
    const projectDescription = analysis.summary || call.meeting_name;

    const exaKey = await getApiKey(req.user.id, 'exa');
    const olostepKey = await getApiKey(req.user.id, 'olostep');
    const anthropicKey = await getApiKey(req.user.id, 'anthropic');

    if (!exaKey || !olostepKey) {
      return res.status(400).json({ error: 'Exa and Olostep API keys required for research' });
    }

    const result = await researchSimilarExamples(projectDescription, {
      exaApiKey: exaKey,
      olostepApiKey: olostepKey,
      anthropicApiKey: anthropicKey,
    });

    await pool.query(
      'UPDATE client_calls SET research = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(result), req.params.id]
    );

    res.json({ research: result });
  } catch (err) {
    console.error('POST /research error:', err);
    res.status(500).json({ error: 'Research failed: ' + err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/client-calls/:id/draft-reply
// ────────────────────────────────────────────────────────────
router.post('/:id/draft-reply', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    const anthropicKey = await getApiKey(req.user.id, 'anthropic');
    if (!anthropicKey) return res.status(400).json({ error: 'Anthropic API key not configured' });

    const analysis = call.analysis || {};
    const research = call.research;

    const researchBlock = research?.examples?.length
      ? `\n\nSimilar projects we have built:\n${research.examples.map(e => `- ${e.url}: ${e.description || e.title}`).join('\n')}`
      : '';

    const systemPrompt = `You are Ashish Pawar, Business Development Manager at HipHype Tech, writing a post-call follow-up email to a client. Write in first person, conversational, value-focused. Under 200 words. No em dashes.`;

    const userMessage = `Write a post-call follow-up email.

Client: ${analysis.client_name || 'the client'}${analysis.company ? ` from ${analysis.company}` : ''}
Call summary: ${analysis.summary || call.meeting_name}
What I promised: ${analysis.promise || 'to follow up with next steps'}
Open questions to address: ${(analysis.open_questions || []).join(', ') || 'none'}${researchBlock}

Write a warm, professional follow-up that references the call, delivers on the promise, and ends with a clear next step.`;

    const draft = await callClaudeHelper(systemPrompt, userMessage, anthropicKey, 1024);
    const withSignature = appendSignatureBlock(draft);

    await pool.query(
      'UPDATE client_calls SET reply_draft = $1, updated_at = NOW() WHERE id = $2',
      [withSignature, req.params.id]
    );

    res.json({ draft: withSignature });
  } catch (err) {
    console.error('POST /draft-reply error:', err);
    res.status(500).json({ error: 'Draft generation failed: ' + err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/client-calls/:id/draft-followup
// ────────────────────────────────────────────────────────────
router.post('/:id/draft-followup', requireAuth, async (req, res) => {
  const { fuNumber } = req.body;
  if (![1, 2, 3].includes(fuNumber)) {
    return res.status(400).json({ error: 'fuNumber must be 1, 2, or 3' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    const anthropicKey = await getApiKey(req.user.id, 'anthropic');
    if (!anthropicKey) return res.status(400).json({ error: 'Anthropic API key not configured' });

    const analysis = call.analysis || {};
    const wordLimits = { 1: 100, 2: 80, 3: 60 };
    const tones = {
      1: 'warm and direct - reference the call and your promise',
      2: 'lighter nudge - brief, friendly, one clear question',
      3: 'final check-in - leave door open, no pressure',
    };

    const systemPrompt = `You are Ashish Pawar from HipHype Tech writing a follow-up email. Be human, not salesy. Under ${wordLimits[fuNumber]} words. No em dashes.`;

    const userMessage = `Write follow-up #${fuNumber} after our call.

Client: ${analysis.client_name || 'the client'}${analysis.company ? ` from ${analysis.company}` : ''}
We discussed: ${analysis.summary || call.meeting_name}
What I promised: ${analysis.promise || 'to send next steps'}
Tone: ${tones[fuNumber]}
Word limit: ${wordLimits[fuNumber]} words max`;

    const draft = await callClaudeHelper(systemPrompt, userMessage, anthropicKey, 512);
    const withSignature = appendSignatureBlock(draft);

    const column = `fu${fuNumber}_draft`;
    await pool.query(
      `UPDATE client_calls SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
      [withSignature, req.params.id]
    );

    res.json({ draft: withSignature, fuNumber });
  } catch (err) {
    console.error('POST /draft-followup error:', err);
    res.status(500).json({ error: 'Follow-up draft failed: ' + err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/client-calls/:id/draft-rebook
// ────────────────────────────────────────────────────────────
router.post('/:id/draft-rebook', requireAuth, async (req, res) => {
  const { rebookNumber = 1 } = req.body;
  if (![1, 2].includes(rebookNumber)) {
    return res.status(400).json({ error: 'rebookNumber must be 1 or 2' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_calls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    const anthropicKey = await getApiKey(req.user.id, 'anthropic');
    if (!anthropicKey) return res.status(400).json({ error: 'Anthropic API key not configured' });

    const tones = {
      1: 'warm, understanding, no blame - they missed the call, offer to reschedule easily',
      2: 'very brief, light touch - just checking if still interested, no pressure',
    };

    const systemPrompt = `You are Ashish Pawar from HipHype Tech. The client missed a scheduled call. Write a re-booking email. Under 80 words. Warm, no guilt-tripping. No em dashes.`;

    const userMessage = `Write re-booking email #${rebookNumber} for a no-show.

Meeting that was scheduled: ${call.meeting_name}
Date: ${call.call_date}
Tone: ${tones[rebookNumber]}

Reference what the meeting was about (from the title), offer to reschedule at their convenience.`;

    const draft = await callClaudeHelper(systemPrompt, userMessage, anthropicKey, 512);
    const withSignature = appendSignatureBlock(draft);

    const column = rebookNumber === 1 ? 'rebook_draft' : 'rebook_fu1_draft';
    await pool.query(
      `UPDATE client_calls SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
      [withSignature, req.params.id]
    );

    res.json({ draft: withSignature, rebookNumber });
  } catch (err) {
    console.error('POST /draft-rebook error:', err);
    res.status(500).json({ error: 'Re-book draft failed: ' + err.message });
  }
});

module.exports = router;
