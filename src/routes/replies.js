/**
 * Reply Generation Routes  - REPLY-01 + Phase 12 Pipeline
 *
 * POST /api/replies/generate      - Generate AI reply (full pipeline with Step 6b validation)
 * PUT  /api/replies/:id/copied    - Mark reply as copied
 * PUT  /api/replies/:id/variant   - Record variant selection (A/B)
 */

const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");
const { determinePromptType, PROMPT_TYPE_LABELS } = require("../utils/promptRouter");
const {
  ensureJobDescription,
  extractUrls,
  analyzeAllUrls,
} = require("../utils/prefetch");
const { proposalGate, bannedPhraseScanner, nextStepScanner } = require("../utils/validateReply");
const { detectObjection, detectAgencySensitivity, detectScopeFraming, detectDueDiligence, detectProofOfWorkRequest, detectProfileRequest, detectCallDeferral, detectRepeatedRequest } = require("../utils/detectSignals");
const {
  classifyThreadStage,
  measureClientMessageLength,
  detectStallType,
  parseCcContacts,
  parseNextStepBlock,
} = require('../utils/detectThreadContext');
const { evaluateMockupDecision } = require('../utils/mockupDecision');
const { findJobForEmail } = require('../utils/threadJobLookup');
const {
  detectPricingLanguage,
  appendSignatureBlock,
  formatTimezoneCTA,
  getNextCallDay,
} = require('../utils/promptEnhancements');
const { researchSimilarExamples } = require('../utils/researchAgent');

const router = express.Router();

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────
async function getApiKey(userId, service) {
  const { rows } = await pool.query(
    'SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = $2',
    [userId, service]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);
}

async function callClaudeHelper(systemPrompt, userMessage, apiKey, model = 'claude-sonnet-4-6', maxTokens = 1024, opts = {}) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: userMessage }] };
  if (systemPrompt) body.system = systemPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  if (opts.returnMeta) {
    return { text, stopReason: data.stop_reason, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens };
  }
  return text;
}

function getNextBusinessDay(daysAhead) {
  const date = new Date();
  let added = 0;
  while (added < daysAhead) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date.toISOString().split('T')[0];
}

function buildFollowUpPrompt(clientName, projectType, snippet, jobDescription, tone, callDayCTA) {
  const callAsk = callDayCTA
    ? `Include a call ask: "Would ${callDayCTA} at 11 AM your time work for a quick chat?" (adapt phrasing naturally to the tone -- softer for final touch).`
    : 'Include a call ask suggesting a specific weekday (Monday-Friday) at 11 AM their time. NEVER suggest Saturday or Sunday.';

  return `Write a concise follow-up email (80-100 words) to ${clientName} about their project: "${projectType}". One new insight + soft call ask. Keep it light.

Tone: ${tone}

## Job Description (READ THIS for domain/technical context):
${jobDescription || 'Not available'}

## Context from their previous email:
"${snippet}"

## Rules (MANDATORY):
1. VALUE FIRST: Read the job description above. Lead with ONE specific, non-obvious observation about their project - a risk they may not have considered, a technical insight, a quick win, or a relevant trend in their industry. This is NOT optional. Every follow-up must teach them something or give them a reason to reply.
2. CALL ASK: ${callAsk}
3. NO ASSUMPTIONS: Only reference what the client explicitly stated. Don't assume scope, timeline, or tech choices.
4. CLIENT-FIRST: Frame from their perspective - their problem, their goals. Not "we can do X" but "your [project] could benefit from..."
5. HUMAN & POLITE: Write like a real person. Warm, courteous, professional. No corporate jargon, no sales language.
6. No buzzwords, no "I hope this finds you", no "Just checking in", no subject line.
7. Each follow-up must be unique - different angle, different insight. Never repeat what was said before.
8. CONCISE BUT SUBSTANTIAL: Short does not mean empty. Every sentence must carry weight. If a sentence doesn't add value, cut it.

Sign off as:
Best,
Ashish
HipHype Tech`;
}

const TONES = {
  professional: "You write in a professional, business-appropriate tone. Be courteous but direct.",
  friendly: "You write in a warm, friendly tone while remaining professional. Use a conversational style.",
  concise: "You write clear, well-structured replies. Every sentence delivers value  - no filler phrases, but never sacrifice substance for brevity.",
  detailed: "You write thorough, detailed replies that address every point raised. Be comprehensive.",
};

// Default fallback system prompt when no template is found in DB
const DEFAULT_SYSTEM_PROMPT =
  "You are a professional freelancer responding to a client inquiry on Upwork. " +
  "Write a thorough, value-packed, and professional reply that demonstrates deep understanding of the client's project. Use plain text only  - no markdown formatting.";

// Banned phrases cache  - loaded once at startup, refreshed every 5 minutes
// to pick up any changes from Settings UI without requiring server restart
let _bannedPhrasesCache = null;
let _bannedPhrasesCacheTime = 0;
const BANNED_PHRASES_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getBannedPhrases(dbPool) {
  const now = Date.now();
  if (_bannedPhrasesCache && (now - _bannedPhrasesCacheTime) < BANNED_PHRASES_TTL_MS) {
    return _bannedPhrasesCache;
  }
  try {
    const { rows } = await dbPool.query(
      "SELECT phrase, category, replacement_suggestion, active FROM banned_phrases ORDER BY category, phrase"
    );
    _bannedPhrasesCache = rows;
    _bannedPhrasesCacheTime = now;
    return rows;
  } catch (err) {
    console.error("replies: failed to load banned phrases:", err.message);
    return _bannedPhrasesCache || []; // Fall back to stale cache or empty
  }
}

// ============================================================
// POST /api/replies/generate  - Full pipeline with Step 6b validation
// ============================================================
router.post("/generate", requireAuth, async (req, res, next) => {
  try {
    const { emailId, tone = "professional", promptOverride, source, generateAll = false } = req.body;

    // ──────────────────────────────────────────────────────────
    // Step 0: Validate + load auth data
    // ──────────────────────────────────────────────────────────
    if (!emailId) {
      return res.status(400).json({ error: "emailId is required" });
    }

    if (!TONES[tone]) {
      return res.status(400).json({ error: `Invalid tone. Valid: ${Object.keys(TONES).join(", ")}` });
    }

    // Fetch Anthropic API key
    const { rows: keyRows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'anthropic'",
      [req.user.id]
    );

    if (keyRows.length === 0) {
      return res.status(400).json({ error: "Anthropic API key not configured. Add it in Settings." });
    }

    const anthropicKey = decrypt(keyRows[0].encrypted_key, keyRows[0].iv, keyRows[0].auth_tag);

    // Fetch LeadHack credentials (optional  - gracefully skip if missing)
    let leadhackCredentials = null;
    const { rows: lhKeyRows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'leadhack'",
      [req.user.id]
    );
    if (lhKeyRows.length > 0) {
      try {
        const raw = decrypt(lhKeyRows[0].encrypted_key, lhKeyRows[0].iv, lhKeyRows[0].auth_tag);
        // Stored as JSON: { email, password }
        leadhackCredentials = JSON.parse(raw);
      } catch {
        // Corrupt / malformed credentials  - skip prefetch silently
        leadhackCredentials = null;
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 1: Load email + job
    // ──────────────────────────────────────────────────────────
    const { rows: emailRows } = await pool.query(
      `SELECT e.*, a.email AS account_email, a.display_name AS account_name
       FROM emails e
       JOIN email_accounts a ON e.account_id = a.id
       WHERE e.id = $1 AND e.user_id = $2`,
      [emailId, req.user.id]
    );

    if (emailRows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    const email = emailRows[0];

    // Get job context if available (direct match first, then thread-wide fallback)
    const job = await findJobForEmail(pool, email, req.user.id);

    // Compute thread depth if job exists and thread_depth is 0
    if (job && (job.thread_depth === 0 || job.thread_depth === null)) {
      const { rows: threadRows } = await pool.query(
        "SELECT COUNT(*) FROM emails WHERE thread_id = $1 AND user_id = $2",
        [email.thread_id, req.user.id]
      );
      const count = parseInt(threadRows[0].count, 10);
      if (count > (job.thread_depth || 0)) {
        job.thread_depth = count;
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 0.5: Signal detection + DB persist (fire-and-forget)
    // ──────────────────────────────────────────────────────────
    const emailText = email.body_text || email.snippet || '';
    const jobText = job ? (job.job_description_raw || job.job_description || '') : '';

    const objectionType = detectObjection(emailText);

    // Use stored agency_sensitive if already flagged  - avoid overwriting with false negative
    const agencySensitive =
      (job && job.agency_sensitive === true)
        ? true
        : detectAgencySensitivity(jobText);

    // Use stored scope framing if already detected  - avoid overwriting a known value
    const scopeFraming =
      (job && job.client_scope_framing && job.client_scope_framing !== 'UNKNOWN')
        ? job.client_scope_framing
        : detectScopeFraming(emailText);

    const currentFollowUpCount = job ? (job.follow_up_count || 0) : 0;

    // DUE_DILIGENCE detection  - runs on email text (client's message)
    const isDueDiligence = detectDueDiligence(emailText);
    const hasProofOfWorkRequest = isDueDiligence ? detectProofOfWorkRequest(emailText) : false;

    // PROFILE_REQUEST, CALL_DEFERRAL detection  - runs on email text
    const hasProfileRequest = detectProfileRequest(emailText);
    const hasCallDeferral = detectCallDeferral(emailText);

    // REPEATED_REQUEST detection  - needs thread history for content overlap
    let threadEmailsForRepeat = [];
    if (email.thread_id) {
      try {
        const { rows: prevRows } = await pool.query(
          `SELECT body_text, snippet FROM emails
           WHERE thread_id = $1 AND user_id = $2 AND id != $3
           ORDER BY received_at ASC`,
          [email.thread_id, req.user.id, email.id]
        );
        threadEmailsForRepeat = prevRows;
      } catch (err) {
        console.error('replies: thread emails fetch for repeat detection failed:', err.message);
      }
    }
    const hasRepeatedRequest = detectRepeatedRequest(emailText, threadEmailsForRepeat);

    // Fire-and-forget DB update  - never blocks response
    if (job) {
      pool.query(
        `UPDATE jobs SET
           objection_detected = $1::objection_type_enum,
           agency_sensitive   = $2,
           client_scope_framing = $3::scope_framing_enum
         WHERE id = $4`,
        [objectionType, agencySensitive, scopeFraming, job.id]
      ).catch((err) => console.error('replies: signal update failed:', err.message));
    }

    // Load counter-move template (awaited  - needed for prompt building)
    let counterMove = null;
    if (objectionType !== 'NONE' && job) {
      try {
        const { rows: cmRows } = await pool.query(
          `SELECT counter_move_template, max_words, counter_move_name
           FROM counter_moves
           WHERE objection_type = $1::objection_type_enum AND active = true
           ORDER BY id ASC LIMIT 1`,
          [objectionType]
        );
        counterMove = cmRows.length > 0 ? cmRows[0] : null;
      } catch (cmErr) {
        console.error('replies: counter-move lookup failed:', cmErr.message);
        // Fail open  - proceed without counter-move
      }
    }

    const objectionContext = { objectionType, agencySensitive, scopeFraming, counterMove, isDueDiligence, hasProofOfWorkRequest, hasProfileRequest, hasCallDeferral, hasRepeatedRequest };

    // ──────────────────────────────────────────────────────────
    // Step 2: Prompt routing
    // ──────────────────────────────────────────────────────────
    const promptType = determinePromptType(email, job, { promptOverride, source });

    if (promptType === null) {
      return res.json({
        suppressed: true,
        reason: "OOO or suppressed intent  - no reply generated",
        promptType: null,
      });
    }

    // ──────────────────────────────────────────────────────────
    // Step 2.5a: Thread context detection (THREAD-01/04/05/08)
    // Must run after promptType is known (needed for THREAD_CONTINUATION_V1 gate)
    // ──────────────────────────────────────────────────────────

    // ── THREAD-01: Stage classification (THREAD_CONTINUATION_V1 only; fail open = DISCOVERY)
    let threadStage = (job && job.thread_stage) || 'DISCOVERY';
    if (promptType === 'THREAD_CONTINUATION_V1' && job) {
      const classifiedStage = await classifyThreadStage(
        emailText,
        job.job_description_raw || job.job_description || '',
        anthropicKey
      );
      // Non-regressing: only upgrade stage, never downgrade (hierarchy: DISCOVERY < CALL_BOOKING < POST_CALL < NEGOTIATION < CLOSING; STALLED can always be set)
      const STAGE_RANK = { DISCOVERY: 0, CALL_BOOKING: 1, POST_CALL: 2, NEGOTIATION: 3, CLOSING: 4, STALLED: -1 };
      const existingRank = STAGE_RANK[threadStage] ?? 0;
      const classifiedRank = STAGE_RANK[classifiedStage] ?? 0;
      if (classifiedStage === 'STALLED' || classifiedRank > existingRank) {
        threadStage = classifiedStage;
      }
    }

    // ── THREAD-08: Client energy measurement (all prompt types)
    const clientMessageLength = measureClientMessageLength(emailText);

    // ── THREAD-05: Stall type detection (STALLED stage only)
    const stallType = (job && threadStage === 'STALLED') ? detectStallType(emailText, job) : 'UNKNOWN';

    // ── THREAD-04: CC contacts parsing (from cc_raw stored during sync)
    const ccContacts = parseCcContacts(email.cc_raw || null);

    // ── Build the full set of emails the user owns:
    //    - All detected outreach aliases (e.g. ashish@elevatehub.link, janet@hypeit.ink)
    //    - All connected Gmail accounts (e.g. hiphype60@gmail.com, ashish@mycodeworks.tech)
    //    - Monitoring addresses (e.g. hiphype679@gmail.com  - auto-detected from sent CC)
    //    This prevents the AI treating any of the user's own addresses as a CC'd third party.
    const [{ rows: aliasRows }, { rows: accountRows }] = await Promise.all([
      pool.query('SELECT alias_email FROM user_email_aliases WHERE user_id = $1', [req.user.id]),
      pool.query('SELECT email FROM email_accounts WHERE user_id = $1', [req.user.id]),
    ]);
    const userOwnedEmails = new Set([
      ...aliasRows.map(r => r.alias_email.toLowerCase()),
      ...accountRows.map(r => r.email.toLowerCase()),
    ]);

    // Extract local-part (before @) for matching client's own alternate emails.
    // e.g. joe@digitaljunkies.com.au CC'ing joebrown@digitaljunkies.com.au
    //      lori@ac.com CC'ing lori.james@ac.com or lori@ff.com
    const fromLocalPart = (email.from_email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

    const filteredCcContacts = ccContacts.filter((c) => {
      const addr = (c.email || '').toLowerCase();
      // 1. Remove user's own addresses
      if (userOwnedEmails.has(addr)) return false;
      // 2. Remove client's own alternate emails:
      //    If the CC local-part starts with the sender's local-part (or vice versa),
      //    it's almost certainly the same person's secondary address.
      //    e.g. "joe" vs "joebrown", "lori" vs "lorijames"
      const ccLocalPart = addr.split('@')[0].replace(/[^a-z0-9]/g, '');
      if (
        fromLocalPart.length >= 3 &&
        (ccLocalPart.startsWith(fromLocalPart) || fromLocalPart.startsWith(ccLocalPart))
      ) return false;
      return true;
    });

    // ── Fire-and-forget: persist thread context to jobs table (non-blocking)
    if (job && promptType === 'THREAD_CONTINUATION_V1') {
      pool.query(
        `UPDATE jobs SET
           thread_stage           = $1::thread_stage_enum,
           client_message_length  = $2::message_length_enum,
           stall_type             = $3::stall_type_enum,
           cc_contacts            = $4::jsonb
         WHERE id = $5`,
        [
          threadStage,
          clientMessageLength,
          stallType,
          ccContacts.length > 0 ? JSON.stringify(ccContacts) : null,
          job.id,
        ]
      ).catch((err) => console.error('replies: thread context update failed:', err.message));
    }

    // Update in-memory job object for use in buildPromptWithContext
    if (job) {
      job.thread_stage = threadStage;
      job.client_message_length = clientMessageLength;
      job.stall_type = stallType;
      job.cc_contacts = ccContacts.length > 0 ? ccContacts : job.cc_contacts;
    }

    // ──────────────────────────────────────────────────────────
    // Step 2.5b: Mockup Decision Gate (MOCKUP-01, MOCKUP-05)
    // Always compute  - used by both LOVABLE_MOCKUP_V1 gating and generateAll [link] hint
    // ──────────────────────────────────────────────────────────
    const mockupDecisionGlobal = await evaluateMockupDecision(job, email, anthropicKey);

    if (promptType === 'LOVABLE_MOCKUP_V1') {
      // MOCKUP-05: Follow-Up Day 7 gate  - block mockup generation after 2 follow-ups
      if (job && job.follow_up_count >= 2) {
        return res.json({
          mockupDeclined: true,
          reason: 'Mockup window closed -- Day 7+ leads should use a different value angle',
          alternativeSuggestion: 'Use a technical insight or case study instead',
        });
      }

      if (!mockupDecisionGlobal.shouldBuild) {
        return res.json({
          mockupDeclined: true,
          reason: `Not a visual project type (${mockupDecisionGlobal.projectType})`,
          alternativeSuggestion: mockupDecisionGlobal.alternativeSuggestion,
        });
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 2.5: Kill Switch  - soft warning, never blocks generation (OBJECTION-06)
    // Records dormant status + re-engagement strategy but always falls through
    // so the user can regenerate anytime.
    // ──────────────────────────────────────────────────────────
    let killSwitchWarning = null;
    if (promptType === 'FOLLOW_UP_V2' && currentFollowUpCount >= 2) {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const killSwitchAt = job && job.kill_switch_at ? new Date(job.kill_switch_at) : null;
      const isReEngageable = killSwitchAt && (Date.now() - killSwitchAt.getTime()) > THIRTY_DAYS_MS;

      if (isReEngageable) {
        // Clear kill switch  - lead is re-entering the follow-up sequence
        pool.query(
          'UPDATE jobs SET kill_switch_at = NULL, match_status = $1, follow_up_count = 0 WHERE id = $2',
          ['matched', job.id]
        ).catch(() => {});
      } else {
        // Record dormant status (only if not already set)
        if (job) {
          pool.query(
            'UPDATE jobs SET kill_switch_at = NOW(), match_status = $1 WHERE id = $2 AND kill_switch_at IS NULL',
            ['dormant', job.id]
          ).catch(() => {});
        }
        // Generate re_engagement_strategy via Sonnet (fire-and-forget)
        if (job && job.id) {
          (async () => {
            try {
              const reEngagePrompt = `In ONE sentence (max 15 words), what specific value could reignite ${job.client_first_name || "this client"}'s interest in their ${job.job_heading || "project"}? Be concrete, not generic.`;
              const reEngageRes = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': anthropicKey,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-6',
                  max_tokens: 50,
                  messages: [{ role: 'user', content: reEngagePrompt }],
                }),
              });
              if (reEngageRes.ok) {
                const reEngageData = await reEngageRes.json();
                const strategy = (reEngageData.content?.[0]?.text || '').trim();
                if (strategy) {
                  await pool.query(
                    'UPDATE jobs SET re_engagement_strategy = $1 WHERE id = $2',
                    [strategy, job.id]
                  );
                }
              }
            } catch (e) {
              console.error('replies: re_engagement_strategy generation failed:', e.message);
            }
          })();
        }
        // Soft warning  - included in response but does NOT block generation
        killSwitchWarning = 'Follow-up limit reached (2). Lead marked DORMANT  - but you can still generate.';
      }
      // Always fall through to normal generation
    }

    // ──────────────────────────────────────────────────────────
    // Step 2.6: Timezone CTA resolution (CTA-01)
    // ──────────────────────────────────────────────────────────
    let timezoneCTA = '11 AM your time'; // Fallback (CTA-01 edge case)
    if (job && (job.city || job.country)) {
      try {
        const location = [job.city, job.country].filter(Boolean).join(', ');
        // Reuse the same Sonnet timezone lookup logic as timezone.js (inline, not HTTP call)
        const tzRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 50,
            messages: [{
              role: 'user',
              content: `What is the IANA timezone identifier for ${location}? Reply with ONLY the IANA timezone string, for example: America/New_York or Pacific/Auckland. No explanation.`,
            }],
          }),
        });
        if (tzRes.ok) {
          const tzData = await tzRes.json();
          const ianaTimezone = (tzData.content?.[0]?.text || '').trim();
          if (ianaTimezone) {
            // Validate it's a real IANA timezone before using
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: ianaTimezone }).format(new Date());
              timezoneCTA = formatTimezoneCTA(ianaTimezone);
            } catch {
              // Invalid timezone string from Sonnet - use fallback
            }
          }
        }
      } catch (tzErr) {
        // Fail open  - use default "11 AM your time" fallback
        console.error('replies: timezone resolution failed:', tzErr.message);
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 2.7: Pricing language detection in client email (CTA-05)
    // ──────────────────────────────────────────────────────────
    const emailTextForPricing = email.body_text || email.snippet || '';
    const pricingDetection = detectPricingLanguage(emailTextForPricing);

    // ──────────────────────────────────────────────────────────
    // Step 3: Load prompt template from DB
    // ──────────────────────────────────────────────────────────
    const templateContent = await getPromptTemplate(promptType, req.user.id, pool);

    // ──────────────────────────────────────────────────────────
    // Step 4: Pre-generation pipeline (graceful degradation)
    // ──────────────────────────────────────────────────────────
    const prefetchWarnings = [];

    // 4a. Ensure job description (PREFETCH-01)
    if (job && !job.job_description_raw) {
      try {
        await ensureJobDescription(job, email, anthropicKey, leadhackCredentials, pool);
      } catch (err) {
        prefetchWarnings.push(
          `Job context unavailable  - using email content only: ${err.message}`
        );
      }
    }

    // 4b. Extract + analyze URLs (PREFETCH-02 / PREFETCH-03)
    let linkAnalysis = null;
    if (job && job.link_analysis_json) {
      try {
        linkAnalysis = JSON.parse(job.link_analysis_json);
      } catch {
        linkAnalysis = null;
      }
    }

    if (!linkAnalysis && job) {
      const urls = extractUrls(
        job.job_description_raw || job.job_description || "",
        email.body_text || ""
      );
      if (urls.length > 0) {
        linkAnalysis = await analyzeAllUrls(urls);
        try {
          await pool.query(
            "UPDATE jobs SET link_analysis_json = $1 WHERE id = $2",
            [JSON.stringify(linkAnalysis), job.id]
          );
        } catch (dbErr) {
          // Non-fatal  - continue without persisting
          console.error("replies: failed to persist link_analysis_json:", dbErr.message);
        }
      } else {
        linkAnalysis = [];
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 4c: Research similar examples (first contact + portfolio/proof signals, non-blocking)
    // ──────────────────────────────────────────────────────────
    let researchContextBlock = '';
    const isFirstContact = promptType === 'EMAIL_REPLY_V2' || promptType === 'PROPOSAL_V4';
    const needsPortfolioProof = objectionContext.hasProfileRequest || objectionContext.hasProofOfWorkRequest || objectionContext.isDueDiligence;
    let shouldResearch = (isFirstContact || needsPortfolioProof) && job;

    // Gate: Skip auto-research if job is already classified as non-BUILD
    if (shouldResearch && job.research_classification && job.research_classification !== 'BUILD') {
      console.log(`research: Skipping auto-research - pre-classified as ${job.research_classification}`);
      shouldResearch = false;
    }
    if (shouldResearch) {
      try {
        const [exaKey, olostepKey] = await Promise.all([
          getApiKey(req.user.id, 'exa'),
          getApiKey(req.user.id, 'olostep'),
        ]);
        if (exaKey && olostepKey) {
          const projectDesc = job.job_heading || job.job_description?.substring(0, 200) || email.subject || '';
          if (projectDesc.length >= 5) {
            const triggerReason = needsPortfolioProof ? 'portfolio/proof signal' : 'first contact';
            console.log(`research: Auto-research triggered for ${triggerReason}`);
            const research = await researchSimilarExamples(projectDesc, anthropicKey, exaKey, olostepKey);
            researchContextBlock = research.contextBlock || '';
            if (research.examples.length > 0) {
              console.log(`research: Injecting ${research.examples.length} verified examples into reply context`);
            }
          }
        }
      } catch (err) {
        // Research is an enhancement, never block reply generation
        console.warn('research: Auto-research failed (non-fatal):', err.message);
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 5: Build context + call Claude (PREFETCH-04)
    // ──────────────────────────────────────────────────────────
    // ── Detect Janet persona: outreach was sent as "Janet" but reply is from Ashish
    const outreachAlias = email.to_email || null;
    const isJanetPersona = outreachAlias && /\bjanet\b/i.test(outreachAlias.split('@')[0]);

    const threadContext = { threadStage, clientMessageLength, stallType, ccContacts: filteredCcContacts, isJanetPersona, outreachAlias };
    let systemPrompt = buildPromptWithContext(templateContent, email, job, linkAnalysis, tone, promptType, objectionContext, threadContext, timezoneCTA, pricingDetection);

    // Inject research examples into prompt (after buildPromptWithContext)
    if (researchContextBlock) {
      systemPrompt += researchContextBlock;
    }
    // generateAll: if mockup is appropriate for this project, add [link] placeholder hint to reply
    if (generateAll && mockupDecisionGlobal.shouldBuild && !(job && job.follow_up_count >= 2)) {
      systemPrompt += '\n\n**Mockup Note (generateAll mode):** A visual concept is appropriate for this project. Naturally include ONE short sentence in your reply referencing a quick visual concept you prepared, using exactly `[link]` as the placeholder URL. Keep it casual and human. Example: "I also put together a quick visual  - [link]  - let me know what you think."';
    }
    const userMessage = buildUserMessage(email, job);

    const claudeController = new AbortController();
    // Lovable prompts need more output tokens for detailed mockup specs
    const mainMaxTokens = promptType === 'LOVABLE_MOCKUP_V1' ? 8192 : 2048;
    const claudeTimeout = setTimeout(() => claudeController.abort(), promptType === 'LOVABLE_MOCKUP_V1' ? 60000 : 30000);

    let claudeData;
    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: mainMaxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
        signal: claudeController.signal,
      });

      clearTimeout(claudeTimeout);

      if (!claudeRes.ok) {
        const err = await claudeRes.json().catch(() => ({}));
        return res.status(502).json({
          error: `Claude API error: ${err.error?.message || claudeRes.statusText}`,
        });
      }

      claudeData = await claudeRes.json();
    } catch (err) {
      clearTimeout(claudeTimeout);
      if (err.name === "AbortError") {
        return res.status(504).json({ error: "Generation timed out (30s limit)" });
      }
      throw err;
    }

    const rawText = claudeData.content?.[0]?.text || "";
    const model = claudeData.model || "claude-sonnet-4-6";
    const promptTokens = claudeData.usage?.input_tokens || 0;
    const completionTokens = claudeData.usage?.output_tokens || 0;
    const stopReason = claudeData.stop_reason || 'end_turn';

    // Detect truncation for lovable prompts
    if (promptType === 'LOVABLE_MOCKUP_V1' && stopReason === 'max_tokens') {
      console.warn(`replies: LOVABLE_MOCKUP_V1 main generation TRUNCATED (${completionTokens} output tokens used). Prompt may be incomplete.`);
    }

    // ──────────────────────────────────────────────────────────
    // Step 6: Extract internal blocks + get clean text (PREFETCH-05)
    // ──────────────────────────────────────────────────────────
    let { cleanText, jobAnalysisBlock, linkAnalysisBlock, nextStepRawBlock } = extractInternalBlocks(rawText);

    // MOCKUP-02: Parse mockup-specific output blocks
    let mockupData = null;
    if (promptType === 'LOVABLE_MOCKUP_V1') {
      mockupData = parseMockupOutput(rawText);

      // For mockup: the "reply text" shown to user is the send message
      // The lovable prompt is a separate copyable field
      if (mockupData.sendMessage) {
        cleanText = mockupData.sendMessage;
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 6a: Parse dual variants for V2 prompt types (UIUP-05)
    // ──────────────────────────────────────────────────────────
    let variantA = null;
    let variantB = null;

    if (promptType === 'EMAIL_REPLY_V2' || promptType === 'FOLLOW_UP_V2') {
      const variantDelimiter = /---\s*VARIANT\s*B\s*---/i;
      const parts = cleanText.split(variantDelimiter);

      if (parts.length >= 2) {
        // Strip VARIANT A marker from the first part
        variantA = parts[0].replace(/---\s*VARIANT\s*A\s*---/i, '').trim();
        variantB = parts[1].trim();

        // Validation runs on Variant A (the primary text)
        cleanText = variantA;
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 6.0a: Append signature block (CTA-06)
    // Runs after variant split so both variants get the signature.
    // ──────────────────────────────────────────────────────────
    if (promptType !== 'LOVABLE_MOCKUP_V1') {
      cleanText = appendSignatureBlock(cleanText);
      if (variantA) {
        variantA = appendSignatureBlock(variantA);
      }
      if (variantB) {
        variantB = appendSignatureBlock(variantB);
      }
    }

    // Step 6a.1: Sanitize formatting  - strip em dashes, en dashes → regular dashes
    const sanitize = (t) => t ? t.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-') : t;
    cleanText = sanitize(cleanText);
    if (variantA) variantA = sanitize(variantA);
    if (variantB) variantB = sanitize(variantB);

    // Detect intent from email
    const intent = detectIntent(email.body_text || email.snippet);

    // ──────────────────────────────────────────────────────────
    // Step 6b: Post-generation validation pipeline
    // ──────────────────────────────────────────────────────────
    let validatedText = cleanText;
    let violations = [];
    let hasNextStep = false;
    let proposalGateFired = false;
    let specificityAttempts = 0;
    let specificityFlag = false;
    let followUpSequence = null;
    const validationWarnings = [];

    // Load banned phrases (cached; falls back to [] on DB error  - fail open)
    const bannedPhrases = await getBannedPhrases(pool);

    // 6b-1: Proposal Gate (VALIDATE-01 + QUALITY-03 + QUALITY-04)
    // CTA-05: allow pricing when client explicitly asked about it
    const clientRequestedPricing = pricingDetection.hasPricing;
    const gateResult = proposalGate(validatedText, promptType, clientRequestedPricing);
    validatedText = gateResult.text;
    proposalGateFired = gateResult.stripped;
    if (proposalGateFired) {
      validationWarnings.push("Pricing language stripped by Proposal Gate");
    }

    // 6b-2: Banned Phrase Scanner (VALIDATE-02)
    // Phase 13 scope: auto-rewrite only (replacement_suggestion → replace; null → keep flagged).
    // Flag-mode UI (highlighting without rewriting) is deferred to Phase 14.
    const { violations: bannedViolations, rewrittenText } = bannedPhraseScanner(validatedText, bannedPhrases);
    violations = bannedViolations;
    if (violations.length > 0) {
      // Auto-rewrite where replacement_suggestion exists; flag the rest
      validatedText = rewrittenText;
      if (violations.some((v) => !v.replacement)) {
        validationWarnings.push(
          `${violations.filter((v) => !v.replacement).length} banned phrase(s) need manual review`
        );
      }
    }

    // 6b-3: Next-Step Scanner (VALIDATE-04)
    const nextStepResult = nextStepScanner(validatedText);
    hasNextStep = nextStepResult.hasNextStep;
    if (!hasNextStep) {
      validationWarnings.push("No next step detected in reply");
    }

    // 6b-4: QUALITY-01 Follow-Up Specificity Retry (FOLLOW_UP_V2 only)
    if (promptType === "FOLLOW_UP_V2" && job && job.id) {
      const clientName =
        [job.client_first_name, job.client_last_name].filter(Boolean).join(" ") || "the client";
      const projectType = job.job_heading || "project";

      while (specificityAttempts < 2) {
        const isSpecific = await checkFollowUpSpecificity(
          validatedText,
          clientName,
          projectType,
          anthropicKey
        );
        if (isSpecific) break;

        specificityAttempts++;
        // Regenerate with stronger specificity instruction
        const strongerMessage =
          buildUserMessage(email, job) +
          `\n\nIMPORTANT: The previous draft was too generic. Your reply MUST include at least one specific detail about ${clientName}'s ${projectType}. Reference something concrete from the job description or email.`;

        try {
          const regenRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 2048,
              system: systemPrompt,
              messages: [{ role: "user", content: strongerMessage }],
            }),
          });
          if (regenRes.ok) {
            const regenData = await regenRes.json();
            const regenRaw = regenData.content?.[0]?.text || validatedText;
            const { cleanText: regenCleanRaw } = extractInternalBlocks(regenRaw);
            const regenClean = sanitize(regenCleanRaw);
            // Re-run proposal gate and banned phrase scan on regenerated text
            const regenGated = proposalGate(regenClean, promptType, clientRequestedPricing);
            const { rewrittenText: regenRewritten } = bannedPhraseScanner(
              regenGated.text,
              bannedPhrases
            );
            validatedText = regenRewritten;
          }
        } catch (regenErr) {
          console.error("replies: specificity regen failed:", regenErr.message);
          break; // Fail open  - use current validatedText
        }
      }

      if (specificityAttempts >= 2) {
        specificityFlag = true;
        validationWarnings.push("Specificity check: flagged for manual writing after 2 attempts");
      }

      // 6b-5: QUALITY-02 Angle Extraction + Differentiation (FOLLOW_UP_V2 only)
      followUpSequence = (job.follow_up_count || 0) + 1; // 1 = FU1, 2 = FU2
      const angleUsed = await extractFollowUpAngle(validatedText, anthropicKey);
      if (angleUsed && job.id) {
        try {
          if (followUpSequence === 1) {
            await pool.query(
              "UPDATE jobs SET follow_up_1_angle = $1 WHERE id = $2",
              [angleUsed, job.id]
            );
          } else {
            await pool.query(
              "UPDATE jobs SET follow_up_2_angle = $1 WHERE id = $2",
              [angleUsed, job.id]
            );
          }
        } catch (angleErr) {
          console.error("replies: failed to store follow_up angle:", angleErr.message);
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 7: Save reply + update job
    // ──────────────────────────────────────────────────────────
    const { rows: replyRows } = await pool.query(
      `INSERT INTO replies (
        user_id, email_id, job_id, tone, intent,
        generated_text, model, prompt_tokens, completion_tokens,
        prompt_type_used, job_analysis_block, link_analysis_block, prefetch_warnings,
        banned_phrases_caught, has_next_step, proposal_gate_fired,
        specificity_attempts, specificity_flag, validation_warnings
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        req.user.id,
        email.id,
        job?.id || null,
        tone,
        intent,
        validatedText,
        model,
        promptTokens,
        completionTokens,
        promptType,
        jobAnalysisBlock,
        linkAnalysisBlock,
        prefetchWarnings.length > 0 ? prefetchWarnings : null,
        violations.length,
        hasNextStep,
        proposalGateFired,
        specificityAttempts,
        specificityFlag,
        validationWarnings.length > 0 ? validationWarnings : null,
      ]
    );

    // Update jobs.last_prompt_used if job exists
    if (job) {
      try {
        await pool.query(
          "UPDATE jobs SET last_prompt_used = $1 WHERE id = $2",
          [promptType, job.id]
        );
      } catch (dbErr) {
        console.error("replies: failed to update last_prompt_used:", dbErr.message);
      }
    }

    // MOCKUP-02 + MOCKUP-05: Persist mockup data to jobs table (only if not truncated)
    if (promptType === 'LOVABLE_MOCKUP_V1' && job && job.id && mockupData) {
      if (mockupData.lovablePrompt && stopReason !== 'max_tokens') {
        pool.query(
          'UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2',
          [mockupData.lovablePrompt, job.id]
        ).catch((err) => console.error('replies: mockup prompt persist failed:', err.message));
      } else if (stopReason === 'max_tokens') {
        console.warn('replies: Skipping mockup cache  - output was truncated');
      }
    }

    // Increment follow_up_count when FOLLOW_UP_V2 is generated (OBJECTION-06)
    // Note: This was missing from Phase 12/13  - kill switch requires accurate count
    if (job && promptType === 'FOLLOW_UP_V2') {
      try {
        await pool.query(
          'UPDATE jobs SET follow_up_count = follow_up_count + 1 WHERE id = $1',
          [job.id]
        );
      } catch (fcErr) {
        console.error('replies: failed to increment follow_up_count:', fcErr.message);
      }
    }

    // Write generation audit record to reply_generations (fail-open  - never blocks response)
    // Note: lead_id is NOT NULL in reply_generations  - only write when job exists
    if (job && job.id) {
      try {
        await pool.query(
          `INSERT INTO reply_generations (
            lead_id, prompt_used, banned_phrases_caught, word_count,
            had_next_step, thread_depth_at_gen
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            job.id,                                                                       // lead_id
            promptType,                                                                   // prompt_used
            violations.length,                                                            // banned_phrases_caught
            validatedText ? validatedText.split(/\s+/).filter(Boolean).length : 0,        // word_count
            hasNextStep,                                                                  // had_next_step
            followUpSequence || 0,                                                        // thread_depth_at_gen
          ]
        );
      } catch (genAuditErr) {
        // Fail open  - log but never block the reply response
        console.error("replies: failed to write reply_generations audit row:", genAuditErr.message);
      }
    }

    // THREAD-09: next_steps INSERT for THREAD_CONTINUATION_V1 (fire-and-forget)
    if (job && job.id && promptType === 'THREAD_CONTINUATION_V1' && nextStepRawBlock) {
      const nextStepData = parseNextStepBlock(nextStepRawBlock);
      // Guard: our_action is NOT NULL in DB  - skip INSERT if missing (BLOCKER-02 fix)
      if (nextStepData && nextStepData.our_action) {
        pool.query(
          `INSERT INTO next_steps (lead_id, reply_generation_id, our_action, their_action, followup_approach, followup_date)
           VALUES ($1, $2, $3, $4, $5, $6::DATE)`,
          [
            job.id,
            null, // reply_generation_id is INTEGER FK to reply_generations table (not replies UUID)  - pass null (BLOCKER-01 fix)
            nextStepData.our_action,
            nextStepData.their_action || null,
            nextStepData.followup_approach || null,
            nextStepData.followup_date || null,
          ]
        ).catch((err) => console.error('replies: next_steps insert failed:', err.message));
      }
    }

    // THREAD-01: Persist final thread_stage to jobs (fire-and-forget)
    if (job && job.id && promptType === 'THREAD_CONTINUATION_V1') {
      pool.query(
        'UPDATE jobs SET thread_stage = $1::thread_stage_enum WHERE id = $2',
        [threadStage, job.id]
      ).catch((err) => console.error('replies: thread_stage persist failed:', err.message));
    }

    const reply = replyRows[0];
    const responseBody = {
      reply: {
        id: reply.id,
        generatedText: reply.generated_text,
        promptTypeUsed: reply.prompt_type_used,
        promptLabel: PROMPT_TYPE_LABELS[reply.prompt_type_used] || null,
        tone: reply.tone,
        intent: reply.intent,
        model: reply.model,
        promptTokens: reply.prompt_tokens,
        completionTokens: reply.completion_tokens,
        createdAt: reply.created_at,
        // Phase 13 validation fields:
        bannedPhraseViolations: violations,
        hasNextStep: hasNextStep,
        specificityFlag: specificityFlag,
        followUpSequence: followUpSequence,
        validationWarnings: validationWarnings,
        // UIUP-01: Analysis blocks for collapsible panel
        jobAnalysisBlock: jobAnalysisBlock || null,
        linkAnalysisBlock: linkAnalysisBlock || null,
      },
    };

    // UIUP-05: Add variant fields when dual variants were parsed
    if (variantA && variantB) {
      responseBody.reply.variantA = variantA;
      responseBody.reply.variantB = variantB;
    }

    // Add mockup-specific data if this was a mockup generation
    if (promptType === 'LOVABLE_MOCKUP_V1' && mockupData) {
      responseBody.reply.mockupData = {
        lovablePrompt: mockupData.lovablePrompt,
        sendMessage: mockupData.sendMessage,
        mockupAnalysis: mockupData.mockupAnalysis,
        truncated: stopReason === 'max_tokens',
      };
    }

    // Only include warning field if there were prefetch failures
    if (prefetchWarnings.length > 0) {
      responseBody.warning = prefetchWarnings.join("; ");
    }

    // ──────────────────────────────────────────────────────────
    // generateAll: run lovable + follow-up in parallel
    // ──────────────────────────────────────────────────────────
    if (generateAll) {
      const mockupApplicable = mockupDecisionGlobal.shouldBuild && !(job && job.follow_up_count >= 2);
      const cachedPrompt = job && job.mockup_lovable_prompt;
      // Detect if cached prompt looks truncated (ends mid-sentence, mid-parenthesis, or is suspiciously short)
      const cachedLooksTruncated = cachedPrompt && (
        cachedPrompt.endsWith('(') || cachedPrompt.endsWith(',') || cachedPrompt.endsWith(' -') ||
        /[a-z]$/.test(cachedPrompt.trim()) || // ends with lowercase letter mid-word
        cachedPrompt.length < 200 // suspiciously short for a full mockup spec
      );
      const mockupAlreadySent = !!(cachedPrompt && !cachedLooksTruncated);

      if (cachedLooksTruncated) {
        console.log('replies: Cached lovable prompt looks truncated, will regenerate fresh.');
      }

      const [lovableResult, followUpResult] = await Promise.allSettled([
        // ── Lovable block ────────────────────────────────────
        (async () => {
          if (!mockupApplicable) {
            return { applicable: false, reason: mockupDecisionGlobal.alternativeSuggestion };
          }
          if (mockupAlreadySent) {
            return { applicable: true, alreadySent: true, prompt: cachedPrompt };
          }
          const lovableTemplate = await getPromptTemplate('LOVABLE_MOCKUP_V1', req.user.id, pool);
          const lovableSystem = buildPromptWithContext(lovableTemplate, email, job, linkAnalysis, 'professional', 'LOVABLE_MOCKUP_V1', objectionContext, threadContext, timezoneCTA, pricingDetection);
          const lovableResult = await callClaudeHelper(lovableSystem, buildUserMessage(email, job), anthropicKey, 'claude-sonnet-4-6', 8192, { returnMeta: true });
          if (lovableResult.stopReason === 'max_tokens') {
            console.warn(`replies: Lovable prompt TRUNCATED (used ${lovableResult.outputTokens} tokens). Output may be incomplete.`);
          }
          const parsed = parseMockupOutput(lovableResult.text);
          // Only cache if not truncated - truncated prompts should be regenerated
          if (job && job.id && parsed.lovablePrompt && lovableResult.stopReason !== 'max_tokens') {
            pool.query('UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2', [parsed.lovablePrompt, job.id]).catch(() => {});
          }
          return { applicable: true, alreadySent: false, prompt: parsed.lovablePrompt, analysis: parsed.mockupAnalysis, truncated: lovableResult.stopReason === 'max_tokens' };
        })(),

        // ── Follow-up block (3 follow-ups) ──────────────────
        (async () => {
          const clientName = job
            ? ([job.client_first_name, job.client_last_name].filter(Boolean).join(' ') || 'them')
            : 'them';
          const projectType = job?.job_heading || 'their project';
          const snippet = (email.body_text || email.snippet || '').slice(0, 300);
          const jobDescription = (job?.job_description_raw || job?.job_description || '').slice(0, 800);
          const schedules = [
            { days: 3, tone: 'gentle check-in' },
            { days: 5, tone: 'value-add nudge  - mention a relevant idea or insight' },
            { days: 7, tone: 'final touch  - polite last ping before closing the loop' },
          ];
          const results = await Promise.allSettled(schedules.map(async (s) => {
            const date = getNextBusinessDay(s.days);
            const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            const callDay = getNextCallDay(date);
            const msg = buildFollowUpPrompt(clientName, projectType, snippet, jobDescription, s.tone, callDay);
            const text = await callClaudeHelper(null, msg, anthropicKey, 'claude-sonnet-4-6', 1024);
            return { text: text.trim(), suggestedDate: date, label: `Send ${label}` };
          }));
          return results.map((r) => r.status === 'fulfilled' ? r.value : { text: '', error: r.reason?.message });
        })(),
      ]);

      responseBody.lovable = lovableResult.status === 'fulfilled'
        ? lovableResult.value
        : { applicable: false, error: lovableResult.reason?.message };
      responseBody.followUps = followUpResult.status === 'fulfilled'
        ? followUpResult.value
        : [{ text: '', error: followUpResult.reason?.message }];

    }

    // Include soft kill switch warning if applicable (never blocks generation)
    if (killSwitchWarning) {
      responseBody.killSwitchWarning = killSwitchWarning;
    }

    res.json(responseBody);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/replies/regenerate-lovable  - regen lovable block only
// POST /api/replies/regenerate-followup  - regen follow-up block only
// ============================================================
async function loadEmailAndJob(emailId, userId, dbPool) {
  const { rows: emailRows } = await dbPool.query(
    `SELECT e.*, a.email AS account_email FROM emails e
     JOIN email_accounts a ON e.account_id = a.id
     WHERE e.id = $1 AND e.user_id = $2`,
    [emailId, userId]
  );
  if (emailRows.length === 0) return { email: null, job: null };
  const email = emailRows[0];
  const { rows: jobRows } = await dbPool.query(
    "SELECT * FROM jobs WHERE email_id = $1 AND match_status = 'matched'",
    [email.id]
  );
  return { email, job: jobRows[0] || null };
}

router.post('/regenerate-lovable', requireAuth, async (req, res, next) => {
  try {
    const { emailId } = req.body;
    if (!emailId) return res.status(400).json({ error: 'emailId required' });
    const { rows: keyRows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'anthropic'",
      [req.user.id]
    );
    if (keyRows.length === 0) return res.status(400).json({ error: 'Anthropic API key not configured' });
    const anthropicKey = decrypt(keyRows[0].encrypted_key, keyRows[0].iv, keyRows[0].auth_tag);
    const { email, job } = await loadEmailAndJob(emailId, req.user.id, pool);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const decision = await evaluateMockupDecision(job, email, anthropicKey);
    if (!decision.shouldBuild) {
      return res.json({ applicable: false, reason: decision.alternativeSuggestion });
    }
    const lovableTemplate = await getPromptTemplate('LOVABLE_MOCKUP_V1', req.user.id, pool);
    const lovableSystem = buildPromptWithContext(lovableTemplate, email, job, null, 'professional', 'LOVABLE_MOCKUP_V1', {}, {}, '11 AM your time', null);
    const lovableResult = await callClaudeHelper(lovableSystem, buildUserMessage(email, job), anthropicKey, 'claude-sonnet-4-6', 8192, { returnMeta: true });
    if (lovableResult.stopReason === 'max_tokens') {
      console.warn(`replies: regenerate-lovable TRUNCATED (used ${lovableResult.outputTokens} tokens). Output may be incomplete.`);
    }
    const parsed = parseMockupOutput(lovableResult.text);
    // Only cache if not truncated
    if (job && job.id && parsed.lovablePrompt && lovableResult.stopReason !== 'max_tokens') {
      pool.query('UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2', [parsed.lovablePrompt, job.id]).catch(() => {});
    }
    res.json({ applicable: true, alreadySent: false, prompt: parsed.lovablePrompt, analysis: parsed.mockupAnalysis, truncated: lovableResult.stopReason === 'max_tokens' });
  } catch (err) { next(err); }
});

router.post('/regenerate-followup', requireAuth, async (req, res, next) => {
  try {
    const { emailId } = req.body;
    if (!emailId) return res.status(400).json({ error: 'emailId required' });
    const { rows: keyRows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'anthropic'",
      [req.user.id]
    );
    if (keyRows.length === 0) return res.status(400).json({ error: 'Anthropic API key not configured' });
    const anthropicKey = decrypt(keyRows[0].encrypted_key, keyRows[0].iv, keyRows[0].auth_tag);
    const { email, job } = await loadEmailAndJob(emailId, req.user.id, pool);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const clientName = job
      ? ([job.client_first_name, job.client_last_name].filter(Boolean).join(' ') || 'them')
      : 'them';
    const projectType = job?.job_heading || 'their project';
    const snippet = (email.body_text || email.snippet || '').slice(0, 300);
    const jobDescription = (job?.job_description_raw || job?.job_description || '').slice(0, 800);
    const schedules = [
      { days: 3, tone: 'gentle check-in' },
      { days: 5, tone: 'value-add nudge  - mention a relevant idea or insight' },
      { days: 7, tone: 'final touch  - polite last ping before closing the loop' },
    ];
    const results = await Promise.allSettled(schedules.map(async (s) => {
      const date = getNextBusinessDay(s.days);
      const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      const callDay = getNextCallDay(date);
      const msg = buildFollowUpPrompt(clientName, projectType, snippet, jobDescription, s.tone, callDay);
      const text = await callClaudeHelper(null, msg, anthropicKey, 'claude-sonnet-4-6', 256);
      return { text: text.trim(), suggestedDate: date, label: `Send ${label}` };
    }));
    res.json(results.map((r) => r.status === 'fulfilled' ? r.value : { text: '', error: r.reason?.message }));
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/replies/stats/banned-phrases  - count banned phrases caught this week
// ============================================================
router.get('/stats/banned-phrases', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(banned_phrases_caught), 0) AS count
       FROM replies WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('Error fetching banned phrase stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ============================================================
// PUT /api/replies/:id/copied  - Mark as copied
// ============================================================
router.put("/:id/copied", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE replies SET was_copied = true WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Reply not found" });
    }

    res.json({ message: "Marked as copied" });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PUT /api/replies/:id/variant  - Record variant selection (UIUP-05)
// ============================================================
router.put("/:id/variant", requireAuth, async (req, res, next) => {
  try {
    const { variant } = req.body;

    if (!variant || !['A', 'B'].includes(variant)) {
      return res.status(400).json({ error: "variant must be 'A' or 'B'" });
    }

    // Find the reply and its associated job
    const replyResult = await pool.query(
      "SELECT job_id FROM replies WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );

    if (replyResult.rowCount === 0) {
      return res.status(404).json({ error: "Reply not found" });
    }

    const jobId = replyResult.rows[0].job_id;

    // Update the most recent reply_generations record for this job
    const updateResult = await pool.query(
      `UPDATE reply_generations SET variant_selected = $1
       WHERE id = (
         SELECT id FROM reply_generations WHERE lead_id = $2
         ORDER BY created_at DESC LIMIT 1
       )
       RETURNING id`,
      [variant, jobId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: "No generation record found for this reply" });
    }

    res.json({ message: "Variant recorded" });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Helpers
// ============================================================

/**
 * Loads the prompt template from DB for a given promptType + userId.
 * Prefers user-specific template over system template.
 * Falls back to DEFAULT_SYSTEM_PROMPT if nothing found.
 *
 * @param {string} promptType
 * @param {string} userId
 * @param {Object} dbPool
 * @returns {Promise<string>} template content string
 */
async function getPromptTemplate(promptType, userId, dbPool) {
  try {
    const { rows } = await dbPool.query(
      `SELECT content, name FROM prompt_templates
       WHERE prompt_type = $1 AND (user_id = $2 OR is_system = true)
       ORDER BY (CASE WHEN user_id = $2 THEN 0 ELSE 1 END) ASC
       LIMIT 1`,
      [promptType, userId]
    );

    if (rows.length > 0) {
      return rows[0].content;
    }

    console.warn(`replies: no template found for prompt_type=${promptType}, using hardcoded default`);
    return DEFAULT_SYSTEM_PROMPT;
  } catch (err) {
    console.error("replies: error loading prompt template:", err.message);
    return DEFAULT_SYSTEM_PROMPT;
  }
}

/**
 * Builds the final system prompt by injecting job context + link analysis
 * into the base template content.
 *
 * For FOLLOW_UP_V2 when FU1 angle is already stored (job.follow_up_1_angle exists
 * and job.follow_up_count >= 1), appends a differentiation directive so FU2
 * avoids repeating FU1's angle (QUALITY-02).
 *
 * @param {string} templateContent - Base prompt from DB (or default)
 * @param {Object} email
 * @param {Object|null} job
 * @param {Array|null} linkAnalysis - Array of analyzeUrl() results
 * @param {string} tone
 * @param {string} promptType - Current prompt type (for FOLLOW_UP_V2 angle injection)
 * @returns {string}
 */
/**
 * getWordLimitOverride  - returns the word limit ceiling for a given generation context.
 *
 * Overrides baked-in template limits to allow richer, more impactful replies.
 * Strategy-driven stages (CALL_BOOKING, CLOSING, STALLED, FU2) stay short by design.
 * DUE_DILIGENCE and LOVABLE_MOCKUP_V1 handle their own limits  - do not call for those.
 *
 * @param {string} promptType
 * @param {string} threadStage
 * @param {string} objectionType
 * @param {Object|null} job
 * @returns {number|null} word limit, or null if no override needed
 */
function getWordLimitOverride(promptType, threadStage, objectionType, job) {
  if (promptType === 'EMAIL_REPLY_V2') {
    // All first replies  - 200-250 word range
    return 250;
  }

  if (promptType === 'THREAD_CONTINUATION_V1') {
    const stage = threadStage || 'DISCOVERY';
    const limits = {
      DISCOVERY:    250, // answering questions, building rapport
      POST_CALL:    225, // recap with action items
      NEGOTIATION:  225, // price/scope discussion
      CALL_BOOKING:  30, // just confirm the time
      CLOSING:       50, // close fast
      STALLED:       60, // light touch
    };
    return limits[stage] || 250;
  }

  if (promptType === 'FOLLOW_UP_V2') {
    const followUpCount = (job && job.follow_up_count) || 0;
    // FU1 (Day 3): 80-100 words - one insight + soft call ask
    // FU2 (Day 5): 60-80 words - value nudge, lighter
    // FU3 (Day 7): 40-60 words - graceful close, no pressure
    if (followUpCount === 0) return 100;
    if (followUpCount === 1) return 80;
    return 60;
  }

  return null; // No override for other types
}

function buildPromptWithContext(templateContent, email, job, linkAnalysis, tone, promptType, objectionContext = {}, threadContext = {}, timezoneCTA = '11 AM your time', pricingDetection = null) {
  let prompt = templateContent;

  // Append tone modifier
  if (TONES[tone]) {
    prompt += `\n\nTONE: ${TONES[tone]}`;
  }

  // Append job context block if job has description
  if (job) {
    const jobDescription = job.job_description_raw || job.job_description;
    if (jobDescription) {
      const clientName =
        [job.client_first_name, job.client_last_name].filter(Boolean).join(" ") || "Unknown";

      // Determine if email sender is different from job poster
      const senderEmail = email.from_email?.toLowerCase();
      const jobClientEmail = job.client_email?.toLowerCase();
      const isDifferentPerson =
        senderEmail && jobClientEmail && senderEmail !== jobClientEmail;

      let jobBlock = `\n\n<job_context>
Job Title: ${job.job_heading || "Unknown"}
Job Description: ${jobDescription.substring(0, 1000)}
Client: ${clientName}`;

      if (isDifferentPerson) {
        jobBlock += `\nNote: Email sender (${email.from_name || senderEmail}) is a team member  - Upwork account holder is ${clientName} (${jobClientEmail})`;
      }

      if (job.city || job.country) {
        jobBlock += `\nClient Location: ${[job.city, job.country].filter(Boolean).join(", ")}`;
      }

      if (job.hourly_budget_min || job.hourly_budget_max) {
        jobBlock += `\nBudget: $${job.hourly_budget_min}–$${job.hourly_budget_max}/hr`;
      } else if (job.amount) {
        jobBlock += `\nBudget: $${job.amount} fixed`;
      }

      jobBlock += "\n</job_context>";
      prompt += jobBlock;
    }

    // QUALITY-02: For FOLLOW_UP_V2, inject FU1 angle to differentiate FU2
    // Only applies when FU1 has already been sent (follow_up_count >= 1) and angle was captured
    if (promptType === "FOLLOW_UP_V2" && job.follow_up_1_angle && job.follow_up_count >= 1) {
      prompt += `\n\nIMPORTANT: Follow-Up 1 used the angle: "${job.follow_up_1_angle}". Use a DIFFERENT angle for this reply.`;
    }
  }

  // DUE_DILIGENCE: Structured vetting  - overrides TECHNICAL_Q counter-move when active
  if (objectionContext.isDueDiligence) {
    const proofRedirect = objectionContext.hasProofOfWorkRequest
      ? `
PROOF-OF-WORK REQUEST DETECTED: The client asked for screenshots, videos, or evidence of past builds.
Do NOT try to provide real portfolio evidence. Instead, redirect to the mockup:
"Rather than a screenshot from a different client's project, I put together a quick concept for YOUR setup specifically  - [link]. Easier to react to than past screenshots."
This redirect counts as your answer to the proof-of-work question.`
      : '';

    prompt += `\n\n<due_diligence>
The client is doing STRUCTURED VENDOR VETTING  - they sent 3+ qualification questions.
This is NOT a casual technical question. They are evaluating multiple vendors seriously.

WORD LIMIT: 250–300 words total. Do not exceed 300 words.

MANDATORY STRUCTURE (follow in order):
1. Answer the first technical question directly with real substance  - 2-3 sentences, specific detail, no vagueness.
2. ${proofRedirect || 'Answer the next most important question with real technical specificity (tools, approach, concrete detail).'}
3. Answer one more question briefly (1-2 sentences) OR use remaining questions as the natural bridge to a call.
4. ONE call-to-action at the end ONLY  - tied to "walk through the remaining questions live" or "go through the full architecture together."

CRITICAL RULES:
- Do NOT ignore any question. Acknowledge all questions exist even if some are deferred to the call.
- Do NOT repeat the call ask mid-reply. ONE CTA, at the very end.
- Do NOT deflect ALL questions to the call  - that looks evasive. Answer at least 2 with substance.
- Do NOT ask a curiosity question back  - this is not a single-question reply. Save questions for the call.
- Give real technical specifics. Generic answers will lose this client.
</due_diligence>`;
  } else {
    // OBJECTION-02: Counter-move template injection (soft instruction  - Claude follows as guidance)
    if (objectionContext.counterMove) {
      const cm = objectionContext.counterMove;
      prompt += `\n\n<counter_move>
Objection type detected: ${objectionContext.objectionType}
Counter-move strategy: ${cm.counter_move_template}
Incorporate this strategy naturally within your full reply. The counter-move is ONE element of a value-packed response, not the entire reply. Still deliver project-specific insights and a clear CTA.
</counter_move>`;
    }

    // OBJECTION-03: Technical Q structure enforcement
    if (objectionContext.objectionType === 'TECHNICAL_Q') {
      prompt += `\n\n<technical_q_pattern>
MANDATORY STRUCTURE for this technical question reply:
1. Answer their question directly in 1-2 sentences
2. Ask exactly ONE curiosity question about their specific use case (not a generic question)
3. End with a call-to-action (suggest a call)
DO NOT ask more than one question. One question only.
</technical_q_pattern>`;
    }
  }

  // OBJECTION-04: Agency disclosure injection
  if (objectionContext.agencySensitive) {
    prompt += `\n\n<agency_disclosure>
The client's job post signals agency sensitivity. You MUST include this disclosure in the first paragraph:
"To be upfront  - we're an agency, but for this project you'd work directly with [Name], a dedicated [role]. Same person from day one, direct Slack access."
Replace [Name] and [role] with appropriate values from the job context. Do not omit this disclosure.
</agency_disclosure>`;
  }

  // OBJECTION-05: Scope framing mirroring
  if (objectionContext.scopeFraming && objectionContext.scopeFraming !== 'UNKNOWN') {
    const framingInstructions = {
      HOURS:  'The client thinks in HOURS. Structure your reply with hourly estimates. Never use phases or milestones.',
      PHASES: 'The client thinks in PHASES/MILESTONES. Structure your reply with phase-based breakdown.',
      FIXED:  'The client has a FIXED BUDGET mindset. Structure your reply around a fixed-price outcome.',
    };
    prompt += `\n\n<scope_framing>
${framingInstructions[objectionContext.scopeFraming]}
Mirror the client's structure exactly. Never impose a different framing.
</scope_framing>`;
  }

  // PROFILE REQUEST: Client asking for Upwork profile / portfolio link
  if (objectionContext.hasProfileRequest) {
    prompt += `\n\n<profile_redirect>
The client has asked for your Upwork profile or portfolio link.
You did NOT come through Upwork's proposal system  - you found their project through independent research.
Do NOT use a placeholder like "[Insert Upwork Profile Link]" or "[Your Upwork Profile]".

HANDLE THE PROFILE REQUEST (2-3 sentences max):
1. Acknowledge briefly: "We found your project through our own research rather than Upwork's proposal system, so there isn't a formal proposal link to share."
2. Redirect to the company website: "Here's our site with recent work and the team: https://hiphype.tech"
3. Frame proactive outreach as a STRENGTH, not a limitation. Be confident, not apologetic.

CRITICAL: The profile redirect is NOT the whole reply. After handling the redirect, you MUST still:
- Deliver value relevant to their project (insights, approach, relevant experience)
- Include a clear next-step CTA (call, questions, or whatever fits the context)
- The redirect should be 20-30% of the reply, NOT 100% of it
</profile_redirect>`;
  }

  // CALL DEFERRAL: Client said they'll get back to us about the call
  if (objectionContext.hasCallDeferral) {
    prompt += `\n\n<call_deferral>
The client has DEFERRED the call  - they said they'll get back to you about scheduling.
THIS OVERRIDES the "Call Ask Rules" section above. IGNORE any instruction to suggest a specific call time.
RULES:
1. Do NOT suggest a call time. Do NOT propose a specific day, time, or "Would X work?". ZERO call scheduling.
2. Do NOT push for a call. Do NOT write "Would 11 AM work?" or anything similar. Respect their pace completely.
3. Focus your reply on ANSWERING THEIR QUESTIONS and DELIVERING VALUE specific to their project.
4. Since they're not ready for a call yet, your reply IS your pitch  - make it count with concrete insights, relevant experience, or a quick strategic observation about their project.
5. End with a VALUE-FIRST soft close. Examples:
   - "Happy to put together a quick audit of [specific thing] if that would help  - and whenever you're ready for a call, I'm around."
   - "Let me know if you'd like me to sketch out an approach for [specific thing]. Also happy to jump on a call whenever works for you."
   Do NOT just say "whenever you're ready"  - offer something concrete PLUS the soft availability.
</call_deferral>`;
  }

  // REPEATED REQUEST: Client asked the same thing before  - they're frustrated
  if (objectionContext.hasRepeatedRequest) {
    prompt += `\n\n<repeated_request>
The client is REPEATING a question they asked before. They are likely frustrated that it wasn't answered.
MANDATORY RULES:
1. Answer the repeated question DIRECTLY in your FIRST sentence. No preamble, no "great question", no value pitch before the answer.
2. If the question has a simple answer (like a link or a yes/no), give it immediately.
3. Do NOT apologize excessively  - one brief acknowledgment at most ("Good point  - here's that info:").
4. After answering the repeated question, STILL deliver value  - relevant experience, a project-specific insight, or a strategic observation. The answer comes first, but value follows.
5. Include a clear CTA after the value.
</repeated_request>`;
  }

  // Append link analysis block if a finding exists
  if (Array.isArray(linkAnalysis) && linkAnalysis.length > 0) {
    const best = linkAnalysis.find((r) => r.bestFindingForReply);
    if (best) {
      prompt += `\n\n<link_analysis>
URL Analyzed: ${best.url}
Key Finding: ${best.bestFindingForReply}
</link_analysis>
Use the key finding above naturally in your reply when appropriate  - don't force it.`;
    }
  }

  // THREAD-02 + THREAD-03 + THREAD-08: Thread depth, tone, energy, post-call gate
  if (promptType === 'THREAD_CONTINUATION_V1' && job) {
    const depth = job.thread_depth || 0;
    const stage = threadContext.threadStage || job.thread_stage || 'DISCOVERY';
    const clientName = job.client_first_name || 'the client';
    const energy = threadContext.clientMessageLength || 'MEDIUM';

    let toneInstruction;
    if (stage === 'POST_CALL') {
      toneInstruction = 'Match the tone of the call. Reference specifics from the call. Lead with a recap.';
    } else if (depth <= 3) {
      toneInstruction = 'Slightly formal. Lead with a project-specific insight. Do not use first name yet.';
    } else if (depth <= 6) {
      toneInstruction = `Use first name (${clientName}). Shorter sentences. More direct. Less preamble.`;
    } else {
      toneInstruction = 'Ultra-casual. Drop all sales tone. Write like you already know this person well.';
    }

    const energyInstruction = energy === 'SHORT'
      ? 'Client sent a SHORT message (< 30 words). Be respectful of their time but still deliver value. Aim for the lower end of your word limit range.'
      : energy === 'MEDIUM'
      ? 'Client sent a MEDIUM message. Match their engagement with a thorough, value-packed reply within your word limit range.'
      : 'Client sent a LONG message. Match their level of detail with a comprehensive reply.';

    // THREAD-03: Post-call recap gate
    let postCallInstruction = '';
    if (stage === 'POST_CALL') {
      const clientRequestedProposal = job.client_requested_proposal === true;
      if (!clientRequestedProposal) {
        postCallInstruction = '\nPOST-CALL FORMAT: Write a thorough RECAP reply (200-250 words)  - summarise key discussion points, confirm specific action items for both sides, outline clear next steps. Do NOT write a full proposal unless the <thread_context> says proposal requested.';
      } else {
        postCallInstruction = '\nPOST-CALL FORMAT: Client requested a full proposal. Write a complete proposal (normal length, structured).';
      }
    }

    prompt += `\n\n<thread_context>
Current Stage: ${stage}
Thread Depth: ${depth} exchanges
Tone Instruction: ${toneInstruction}
Energy: ${energyInstruction}${postCallInstruction}
</thread_context>`;
  }

  // THREAD-05: Stall recovery strategy injection (STALLED stage only)
  if (promptType === 'THREAD_CONTINUATION_V1' && (threadContext.threadStage === 'STALLED' || (job && job.thread_stage === 'STALLED'))) {
    const stall = threadContext.stallType || (job && job.stall_type) || 'UNKNOWN';
    const stallInstructions = {
      THINKING:        'Wait approach. Add ONE project-specific insight that adds new value. NO call CTA in this message. Day 3 follow-up carries CTA.',
      PRICING_SILENCE: 'Day 3: Offer a Phase 1 scoped option only (smaller scope, lower price). Day 7: Graceful close. Never defend price directly.',
      CALL_SILENCE:    'Day 2: Recap the call highlights in 3 bullets. Day 5: Add a value insight. Day 10: Graceful close if still no response.',
      NO_COMMITMENT:   'Offer a tangible attachment  - a mockup, an audit finding, or a relevant case study. No pressure close. Make it easy to say yes.',
      UNKNOWN:         'Add project-specific value. No CTA pressure.',
    };

    prompt += `\n\n<stall_recovery>
Stall Type: ${stall}
Recovery Strategy: ${stallInstructions[stall] || stallInstructions['UNKNOWN']}
CRITICAL: Do not push. Do not guilt. Add value only.
</stall_recovery>`;
  }

  // PERSONA-01: Janet persona handoff
  // The outreach was sent as "Janet"  - Ashish is now stepping in from his primary inbox.
  // Claude must introduce Ashish and explain the handoff naturally in the first sentence.
  if (threadContext.isJanetPersona) {
    prompt += `\n\n<persona_intro>
The initial outreach email to this client was sent by "Janet"  - a persona used for cold outreach.
You are now writing as Ashish, stepping in from the primary account.
In your OPENING LINE only, briefly introduce the handoff in a natural, confident way.
Example: "Janet from our team had reached out earlier  - I'm Ashish, picking this up from here."
Or: "Hi [client name], I'm Ashish  - Janet looped me in to follow up on this."
Keep it one sentence. Do not repeat it. Do not over-explain. After the intro, proceed normally.
</persona_intro>`;
  }

  // THREAD-04: CC contact injection (when CC contacts exist)
  if (promptType === 'THREAD_CONTINUATION_V1') {
    const contacts = threadContext.ccContacts || [];
    if (Array.isArray(contacts) && contacts.length > 0) {
      const newPerson = contacts[0];
      const displayName = newPerson.name || newPerson.email;
      prompt += `\n\n<cc_handling>
A new person (${displayName}) has been CC'd on this thread.
In your FIRST sentence, address them by name and provide brief context:
"Hi ${newPerson.name || 'there'}, quick context  - [your name] and I have been discussing [project summary] and the next step is [next action]."
Do not assume they have read the previous emails.
</cc_handling>`;
    }
  }

  // MOCKUP-02 + MOCKUP-03: Mockup-specific context injection
  if (promptType === 'LOVABLE_MOCKUP_V1') {
    // Determine conversation stage for send message variant
    let mockupStage = 'with_proposal'; // default: cold
    if (job) {
      const depth = job.thread_depth || 0;
      const stage = threadContext.threadStage || job.thread_stage || 'DISCOVERY';
      if (stage === 'POST_CALL') {
        mockupStage = 'after_call';
      } else if (depth >= 1 || job.follow_up_count >= 1) {
        mockupStage = 'follow_up_day_3';
      }
    }

    prompt += `\n\n<mockup_context>
Conversation Stage for Send Message: ${mockupStage}
Generate the SEND MESSAGE using the "${mockupStage}" template from the prompt.
</mockup_context>`;

    prompt += `\n\n<favicon_requirement>
MANDATORY: Your Lovable prompt MUST include a FAVICON section with:
1. A custom SVG favicon design that matches the brand/project identity
2. Use the primary brand color as the dominant favicon color
3. Design a simple, recognizable icon (stylized letter from brand name, or relevant product icon)
4. Include the exact implementation: <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>...</svg>" />
5. NEVER leave the default Lovable/Vite favicon. Every mockup MUST have a unique, branded favicon.
If you skip the favicon or use a generic one, the mockup is INCOMPLETE.
</favicon_requirement>`;

    // Inject brand colors from link analysis if available (MOCKUP-02)
    if (Array.isArray(linkAnalysis) && linkAnalysis.length > 0) {
      const siteWithColors = linkAnalysis.find((r) => r.colors && r.colors.length > 0);
      if (siteWithColors) {
        prompt += `\n\n<brand_colors>
Colors extracted from client's site (${siteWithColors.url}):
${siteWithColors.colors.join(', ')}
Use these as the primary color palette in the DESIGN section of the Lovable prompt.
</brand_colors>`;
      }
    }
  }

  // VALUE DELIVERY  - mandatory reply structure for substantive replies (skip short tactical stages)
  const shortStages = ['CALL_BOOKING', 'CLOSING', 'STALLED'];
  const currentStage = threadContext.threadStage || (job && job.thread_stage);
  if (!objectionContext.isDueDiligence && promptType !== 'LOVABLE_MOCKUP_V1' && !shortStages.includes(currentStage)) {
    prompt += `\n\n<value_delivery>
Your reply MUST include ALL of these elements (adapt order and phrasing naturally):
1. DIRECT ANSWER  - If they asked a question, answer it in the first 1-2 sentences. No preamble.
2. PROJECT-SPECIFIC INSIGHT  - A non-obvious observation about their project drawn from the job description. Show you actually read and understood what they need.
3. RELEVANT EXPERIENCE  - Briefly mention a similar project or domain knowledge that's directly relevant (1-2 sentences with a specific outcome if possible).
4. STRATEGIC OBSERVATION  - One thing they may not have considered  - a risk, an opportunity, or an approach that adds real value.
5. CLEAR CTA  - A specific next step (call, questions, deliverable offer).
Each element is mandatory. A reply missing any of these is too thin. Do NOT write a generic 3-sentence reply.
</value_delivery>`;
  }

  // WORD LIMIT OVERRIDE  - supersedes baked-in template limits for richer replies
  // DUE_DILIGENCE handles its own limit inline (250–300). Skip for mockups + call-booking/closing/stalled.
  if (!objectionContext.isDueDiligence && promptType !== 'LOVABLE_MOCKUP_V1') {
    const wordLimit = getWordLimitOverride(promptType, threadContext.threadStage, objectionContext.objectionType, job);
    if (wordLimit) {
      const wordFloor = Math.max(Math.round(wordLimit * 0.85), 20);
      prompt += `\n\n<word_limit_override>
WORD COUNT TARGET: ${wordFloor}–${wordLimit} words. This OVERRIDES and SUPERSEDES any other word limit anywhere in these instructions (including template limits, counter-move limits, and energy matching).
Your reply MUST be at least ${wordFloor} words. Aim for ${Math.round((wordFloor + wordLimit) / 2)} words.
If your draft is under ${wordFloor} words, you have NOT included enough substance  - go back and add more project-specific value.
</word_limit_override>`;
    }
  }

  // CTA-01: Timezone-resolved call-to-action injection (with smart day-of-week)
  if (objectionContext.hasCallDeferral) {
    prompt += `\n\n<timezone_cta>
CALL DEFERRED  - THIS OVERRIDES all "Call Ask Rules" in the template above.
Do NOT suggest a specific meeting time. Do NOT write "Would [day] at [time] work?" or any variation.
Instead, end with a soft availability statement woven into a value offer (see <call_deferral> rules above).
NEVER propose a day, time, or timezone. Let them come back to you.
</timezone_cta>`;
  } else {
    prompt += `\n\n<timezone_cta>
When suggesting a meeting time, use this exact format: "Would ${timezoneCTA} work for a quick call?"
NEVER suggest Saturday or Sunday. The day above has been pre-computed as the next business day.
Do NOT use raw timezone abbreviations like "EST" or "PST" without "your time". Always include "your time" in the CTA.
</timezone_cta>`;
  }

  // CTA-05: Cost suggestion injection (only when client mentions pricing)
  if (pricingDetection && pricingDetection.hasPricing) {
    const jobBudget = job
      ? (job.hourly_budget_min && job.hourly_budget_max
        ? `Client budget: $${job.hourly_budget_min}-$${job.hourly_budget_max}/hr`
        : job.amount
        ? `Client budget: $${job.amount} fixed`
        : 'No budget data available')
      : 'No job context available';

    prompt += `\n\n<cost_context>
The client has asked about pricing (keywords detected: ${pricingDetection.keywords.join(', ')}).
${jobBudget}
Include a scope-based cost estimate range in your reply. Format: "Based on the scope you've described, this would typically fall in the $X-$Y range  - happy to refine that on a quick call."
Calibrate the estimate to the job scope and budget signals. Do not use a generic number.
End with a call CTA to discuss pricing details further.
IMPORTANT: This cost estimate is intentionally included  - do NOT strip it or deflect to a call without giving a range.
</cost_context>`;
  }

  // CTA-03 + CTA-04: Greeting reminder (reinforcement  - templates already have greeting rules)
  if (promptType !== 'LOVABLE_MOCKUP_V1') {
    const clientFirstName = (job && job.client_first_name) || '';
    prompt += `\n\n<greeting_reminder>
Your reply MUST begin with a greeting/salutation line. ${clientFirstName ? `Use the client's name: ${clientFirstName}` : 'Use a generic greeting like "Hi there,"'}
Do NOT skip the greeting and jump straight into content. Do NOT use banned FILLER phrases as greetings.
</greeting_reminder>`;
  }

  return prompt;
}

/**
 * Extracts [JOB ANALYSIS] and [LINK ANALYSIS] internal blocks from Claude's raw output.
 * Returns clean reply text (everything before the first block marker) and the block contents.
 *
 * @param {string} rawText - Raw text from Claude API
 * @returns {{ cleanText: string, jobAnalysisBlock: string|null, linkAnalysisBlock: string|null }}
 */
function extractInternalBlocks(rawText) {
  if (!rawText) {
    return { cleanText: "", jobAnalysisBlock: null, linkAnalysisBlock: null, nextStepRawBlock: null };
  }

  // Strip NEXT STEP SUMMARY block before extracting clean text
  // Handles multiple formats: "--- NEXT STEP SUMMARY ---", "---\nNEXT STEP SUMMARY (Internal)",
  // or just "NEXT STEP SUMMARY" on its own line. Captures everything after it to the end.
  let processedText = rawText;
  let nextStepRawBlock = null;
  const nextStepBlockMatch = rawText.match(/(?:^|\n)-{2,}\s*\n?\s*NEXT STEP SUMMARY[\s\S]*$/im)
    || rawText.match(/(?:^|\n)NEXT STEP SUMMARY[^\n]*\n[\s\S]*$/im);
  if (nextStepBlockMatch) {
    nextStepRawBlock = nextStepBlockMatch[0];
    processedText = rawText.slice(0, nextStepBlockMatch.index).trim();
  }

  // Find the first occurrence of either block marker
  const blockStart = processedText.search(/\[JOB ANALYSIS\]|\[LINK ANALYSIS\]/i);

  if (blockStart === -1) {
    // No blocks present  - entire text is the clean reply
    return {
      cleanText: processedText.trim(),
      jobAnalysisBlock: null,
      linkAnalysisBlock: null,
      nextStepRawBlock,
    };
  }

  const cleanText = processedText.substring(0, blockStart).trim();
  const blocksSection = processedText.substring(blockStart);

  // Extract [JOB ANALYSIS] block content
  let jobAnalysisBlock = null;
  const jobMatch = blocksSection.match(
    /\[JOB ANALYSIS\]([\s\S]*?)(?=\[LINK ANALYSIS\]|$)/i
  );
  if (jobMatch) {
    jobAnalysisBlock = jobMatch[1].trim() || null;
  }

  // Extract [LINK ANALYSIS] block content
  let linkAnalysisBlock = null;
  const linkMatch = blocksSection.match(/\[LINK ANALYSIS\]([\s\S]*?)$/i);
  if (linkMatch) {
    linkAnalysisBlock = linkMatch[1].trim() || null;
  }

  return { cleanText, jobAnalysisBlock, linkAnalysisBlock, nextStepRawBlock };
}

function buildUserMessage(email, _job) {
  // Get email body  - prefer bodyText, fall back to stripping HTML from bodyHtml
  let body = email.body_text;
  if (!body && email.body_html) {
    body = email.body_html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  let msg = `CLIENT EMAIL:
From: ${email.from_name || email.from_email}
Subject: ${email.subject}

${body || email.snippet || "(No body text)"}`;

  if (email.extracted_phone) {
    msg += `\n\n[Note: Client included phone number: ${email.extracted_phone}]`;
  }

  msg += "\n\nWrite a reply to this client email. Remember: PLAIN TEXT only, no markdown.";
  return msg;
}

function detectIntent(text) {
  if (!text) return "general";
  const lower = text.toLowerCase();

  if (/\b(price|pricing|rate|cost|budget|quote|how much)\b/.test(lower)) return "pricing_inquiry";
  if (/\b(requirement|need|looking for|scope|specification)\b/.test(lower)) return "requirements";
  if (/\b(call|meeting|schedule|zoom|teams|available)\b/.test(lower)) return "schedule_call";
  if (/\b(portfolio|sample|example|previous work|case study)\b/.test(lower)) return "portfolio_request";
  if (/\b(urgent|asap|immediately|deadline|rush)\b/.test(lower)) return "urgent";
  if (/\b(thank|thanks|great|awesome|perfect)\b/.test(lower)) return "positive_feedback";
  if (/\b(sorry|unfortunately|not able|cannot|decline)\b/.test(lower)) return "rejection";
  if (/\b(proposal|bid|submit|apply)\b/.test(lower)) return "proposal_request";
  if (/\b(update|status|progress|how is it going)\b/.test(lower)) return "status_update";
  if (/\b(bug|fix|broken|error|issue|not working)\b/.test(lower)) return "bug_report";
  if (/\b(redesign|rebuild|revamp|improve|change)\b/.test(lower)) return "change_request";
  if (/\b(out of office|ooo|vacation|away|auto.?reply)\b/.test(lower)) return "ooo";
  if (/\b(forward|fyi|fwd)\b/.test(lower)) return "forwarded";

  return "general";
}

/**
 * checkFollowUpSpecificity  - QUALITY-01
 * Secondary Sonnet call to classify whether follow-up contains client-specific detail.
 * Returns true (is specific) on Sonnet error - fail open.
 *
 * @param {string} text - Reply text to evaluate
 * @param {string} clientName - Client's name for context
 * @param {string} projectType - Project type/heading for context
 * @param {string} anthropicKey - Decrypted Anthropic API key
 * @returns {Promise<boolean>}
 */
async function checkFollowUpSpecificity(text, clientName, projectType, anthropicKey) {
  const prompt = `Does this follow-up email contain at least one detail specific to ${clientName}'s ${projectType}? Reply YES or NO only.\n\nFollow-up:\n${text.substring(0, 500)}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 10,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return true; // Fail open
    const data = await res.json();
    const answer = (data.content?.[0]?.text || "YES").trim().toUpperCase();
    return answer.startsWith("YES");
  } catch {
    return true; // Fail open on network errors
  }
}

/**
 * extractFollowUpAngle  - QUALITY-02
 * Extracts 5-10 word angle description using Sonnet.
 * Returns null on failure  - caller skips DB write gracefully.
 *
 * @param {string} text - Follow-up reply text
 * @param {string} anthropicKey - Decrypted Anthropic API key
 * @returns {Promise<string|null>}
 */
async function extractFollowUpAngle(text, anthropicKey) {
  const prompt = `In 5-10 words, describe the persuasion angle or hook used in this follow-up message. Reply with ONLY the angle description, no punctuation.\n\nFollow-up:\n${text.substring(0, 400)}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 30,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content?.[0]?.text || "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Parses Claude's LOVABLE_MOCKUP_V1 structured output into separate blocks.
 * Handles missing markers gracefully (Pitfall 3 from research).
 *
 * @param {string} rawText - Full Claude output
 * @returns {{ mockupAnalysis: string|null, lovablePrompt: string|null, sendMessage: string|null }}
 */
function parseMockupOutput(rawText) {
  const result = {
    mockupAnalysis: null,
    lovablePrompt: null,
    sendMessage: null,
  };

  if (!rawText) return result;

  // Extract [MOCKUP ANALYSIS] block
  const analysisMatch = rawText.match(
    /\[MOCKUP ANALYSIS\]([\s\S]*?)(?=\[LOVABLE PROMPT\]|$)/i
  );
  if (analysisMatch) {
    result.mockupAnalysis = analysisMatch[1].trim();
  }

  // Extract [LOVABLE PROMPT] block
  const promptMatch = rawText.match(
    /\[LOVABLE PROMPT\]([\s\S]*?)(?=\[SEND MESSAGE\]|$)/i
  );
  if (promptMatch) {
    result.lovablePrompt = promptMatch[1].trim();
  }

  // Extract [SEND MESSAGE] block
  const messageMatch = rawText.match(
    /\[SEND MESSAGE\]([\s\S]*?)(?=\[DEPLOYMENT NOTE\]|$)/i
  );
  if (messageMatch) {
    result.sendMessage = messageMatch[1].trim();
  }

  // Fallback: if no markers found at all, treat entire text as lovable prompt
  if (!result.lovablePrompt && !result.sendMessage && !result.mockupAnalysis) {
    result.lovablePrompt = rawText.trim();
  }

  // Fallback: if lovable prompt exists but no send message, generate a default
  if (result.lovablePrompt && !result.sendMessage) {
    result.sendMessage = 'I put together a quick concept to show how this could look. Let me know your thoughts.';
  }

  return result;
}

module.exports = router;
