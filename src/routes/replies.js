/**
 * Reply Generation Routes — REPLY-01 + Phase 12 Pipeline
 *
 * POST /api/replies/generate     — Generate AI reply (full pipeline with Step 6b validation)
 * PUT  /api/replies/:id/copied   — Mark reply as copied
 * PUT  /api/replies/:id/variant  — Record variant selection (A/B)
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
const { detectObjection, detectAgencySensitivity, detectScopeFraming } = require("../utils/detectSignals");
const {
  classifyThreadStage,
  measureClientMessageLength,
  detectStallType,
  parseCcContacts,
  parseNextStepBlock,
} = require('../utils/detectThreadContext');
const { evaluateMockupDecision } = require('../utils/mockupDecision');
const {
  detectPricingLanguage,
  appendSignatureBlock,
  formatTimezoneCTA,
} = require('../utils/promptEnhancements');

const router = express.Router();

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────
async function callClaudeHelper(systemPrompt, userMessage, apiKey, model = 'claude-sonnet-4-6', maxTokens = 1024) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: userMessage }] };
  if (systemPrompt) body.system = systemPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
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

const TONES = {
  professional: "You write in a professional, business-appropriate tone. Be courteous but direct.",
  friendly: "You write in a warm, friendly tone while remaining professional. Use a conversational style.",
  concise: "You write extremely concise replies. Get to the point in as few words as possible. No fluff.",
  detailed: "You write thorough, detailed replies that address every point raised. Be comprehensive.",
};

// Default fallback system prompt when no template is found in DB
const DEFAULT_SYSTEM_PROMPT =
  "You are a professional freelancer responding to a client inquiry on Upwork. " +
  "Write a concise, helpful, and professional reply. Use plain text only — no markdown formatting.";

// Banned phrases cache — loaded once at startup, refreshed every 5 minutes
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
// POST /api/replies/generate — Full pipeline with Step 6b validation
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

    // Fetch LeadHack credentials (optional — gracefully skip if missing)
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
        // Corrupt / malformed credentials — skip prefetch silently
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

    // Get job context if available
    const { rows: jobRows } = await pool.query(
      "SELECT * FROM jobs WHERE email_id = $1 AND match_status = 'matched'",
      [email.id]
    );

    const job = jobRows.length > 0 ? jobRows[0] : null;

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

    // Use stored agency_sensitive if already flagged — avoid overwriting with false negative
    const agencySensitive =
      (job && job.agency_sensitive === true)
        ? true
        : detectAgencySensitivity(jobText);

    // Use stored scope framing if already detected — avoid overwriting a known value
    const scopeFraming =
      (job && job.client_scope_framing && job.client_scope_framing !== 'UNKNOWN')
        ? job.client_scope_framing
        : detectScopeFraming(emailText);

    const currentFollowUpCount = job ? (job.follow_up_count || 0) : 0;

    // Fire-and-forget DB update — never blocks response
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

    // Load counter-move template (awaited — needed for prompt building)
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
        // Fail open — proceed without counter-move
      }
    }

    const objectionContext = { objectionType, agencySensitive, scopeFraming, counterMove };

    // ──────────────────────────────────────────────────────────
    // Step 2: Prompt routing
    // ──────────────────────────────────────────────────────────
    const promptType = determinePromptType(email, job, { promptOverride, source });

    if (promptType === null) {
      return res.json({
        suppressed: true,
        reason: "OOO or suppressed intent — no reply generated",
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
    //    - Monitoring addresses (e.g. hiphype679@gmail.com — auto-detected from sent CC)
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
    // Always compute — used by both LOVABLE_MOCKUP_V1 gating and generateAll [link] hint
    // ──────────────────────────────────────────────────────────
    const mockupDecisionGlobal = evaluateMockupDecision(job, email);

    if (promptType === 'LOVABLE_MOCKUP_V1') {
      // MOCKUP-05: Follow-Up Day 7 gate — block mockup generation after 2 follow-ups
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
    // Step 2.5: Kill Switch with 30-day re-engagement gate (OBJECTION-06)
    // ──────────────────────────────────────────────────────────
    if (promptType === 'FOLLOW_UP_V2' && currentFollowUpCount >= 2) {
      // 30-day re-engagement gate: if kill_switch_at is set but more than 30 days old,
      // allow generation and clear the kill switch to start a fresh sequence.
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const killSwitchAt = job && job.kill_switch_at ? new Date(job.kill_switch_at) : null;
      const isReEngageable = killSwitchAt && (Date.now() - killSwitchAt.getTime()) > THIRTY_DAYS_MS;

      if (isReEngageable) {
        // Clear kill switch — lead is re-entering the follow-up sequence
        pool.query(
          'UPDATE jobs SET kill_switch_at = NULL, match_status = $1, follow_up_count = 0 WHERE id = $2',
          ['matched', job.id]
        ).catch(() => {});
        // Fall through to normal generation (do NOT return here)
      } else {
        // Kill switch fires: record timestamp (only if not already set)
        if (job) {
          pool.query(
            'UPDATE jobs SET kill_switch_at = NOW(), match_status = $1 WHERE id = $2 AND kill_switch_at IS NULL',
            ['dormant', job.id]
          ).catch(() => {});
        }
        // THREAD-06: Generate re_engagement_strategy via Haiku (fire-and-forget — never blocks kill switch response)
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
                  model: 'claude-3-5-haiku-20241022',
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
        return res.json({
          killSwitch: true,
          reason: 'Maximum follow-ups reached (2). Lead moved to DORMANT. Re-engage after 30 days.',
          followUpCount: currentFollowUpCount,
          promptType,
        });
      }
    }

    // ──────────────────────────────────────────────────────────
    // Step 2.6: Timezone CTA resolution (CTA-01)
    // ──────────────────────────────────────────────────────────
    let timezoneCTA = '11 AM your time'; // Fallback (CTA-01 edge case)
    if (job && (job.city || job.country)) {
      try {
        const location = [job.city, job.country].filter(Boolean).join(', ');
        // Reuse the same Haiku timezone lookup logic as timezone.js (inline, not HTTP call)
        const tzRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
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
              // Invalid timezone string from Haiku — use fallback
            }
          }
        }
      } catch (tzErr) {
        // Fail open — use default "11 AM your time" fallback
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
          `Job context unavailable — using email content only: ${err.message}`
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
          // Non-fatal — continue without persisting
          console.error("replies: failed to persist link_analysis_json:", dbErr.message);
        }
      } else {
        linkAnalysis = [];
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
    // generateAll: if mockup is appropriate for this project, add [link] placeholder hint to reply
    if (generateAll && mockupDecisionGlobal.shouldBuild && !(job && job.follow_up_count >= 2)) {
      systemPrompt += '\n\n**Mockup Note (generateAll mode):** A visual concept is appropriate for this project. Naturally include ONE short sentence in your reply referencing a quick visual concept you prepared, using exactly `[link]` as the placeholder URL. Keep it casual and human. Example: "I also put together a quick visual — [link] — let me know what you think."';
    }
    const userMessage = buildUserMessage(email, job);

    const claudeController = new AbortController();
    const claudeTimeout = setTimeout(() => claudeController.abort(), 30000);

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
          max_tokens: 1024,
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

    // Load banned phrases (cached; falls back to [] on DB error — fail open)
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
              max_tokens: 1024,
              system: systemPrompt,
              messages: [{ role: "user", content: strongerMessage }],
            }),
          });
          if (regenRes.ok) {
            const regenData = await regenRes.json();
            const regenRaw = regenData.content?.[0]?.text || validatedText;
            const { cleanText: regenClean } = extractInternalBlocks(regenRaw);
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
          break; // Fail open — use current validatedText
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

    // MOCKUP-02 + MOCKUP-05: Persist mockup data to jobs table
    if (promptType === 'LOVABLE_MOCKUP_V1' && job && job.id && mockupData) {
      if (mockupData.lovablePrompt) {
        pool.query(
          'UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2',
          [mockupData.lovablePrompt, job.id]
        ).catch((err) => console.error('replies: mockup prompt persist failed:', err.message));
      }
    }

    // Increment follow_up_count when FOLLOW_UP_V2 is generated (OBJECTION-06)
    // Note: This was missing from Phase 12/13 — kill switch requires accurate count
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

    // Write generation audit record to reply_generations (fail-open — never blocks response)
    // Note: lead_id is NOT NULL in reply_generations — only write when job exists
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
        // Fail open — log but never block the reply response
        console.error("replies: failed to write reply_generations audit row:", genAuditErr.message);
      }
    }

    // THREAD-09: next_steps INSERT for THREAD_CONTINUATION_V1 (fire-and-forget)
    if (job && job.id && promptType === 'THREAD_CONTINUATION_V1' && nextStepRawBlock) {
      const nextStepData = parseNextStepBlock(nextStepRawBlock);
      // Guard: our_action is NOT NULL in DB — skip INSERT if missing (BLOCKER-02 fix)
      if (nextStepData && nextStepData.our_action) {
        pool.query(
          `INSERT INTO next_steps (lead_id, reply_generation_id, our_action, their_action, followup_approach, followup_date)
           VALUES ($1, $2, $3, $4, $5, $6::DATE)`,
          [
            job.id,
            null, // reply_generation_id is INTEGER FK to reply_generations table (not replies UUID) — pass null (BLOCKER-01 fix)
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
      const mockupAlreadySent = !!(job && job.mockup_lovable_prompt);

      const [lovableResult, followUpResult] = await Promise.allSettled([
        // ── Lovable block ────────────────────────────────────
        (async () => {
          if (!mockupApplicable) {
            return { applicable: false, reason: mockupDecisionGlobal.alternativeSuggestion };
          }
          if (mockupAlreadySent) {
            return { applicable: true, alreadySent: true, prompt: job.mockup_lovable_prompt };
          }
          const lovableTemplate = await getPromptTemplate('LOVABLE_MOCKUP_V1', req.user.id, pool);
          const lovableSystem = buildPromptWithContext(lovableTemplate, email, job, linkAnalysis, 'professional', 'LOVABLE_MOCKUP_V1', objectionContext, threadContext, timezoneCTA, pricingDetection);
          const lovableRaw = await callClaudeHelper(lovableSystem, buildUserMessage(email, job), anthropicKey, 'claude-sonnet-4-6', 2048);
          const parsed = parseMockupOutput(lovableRaw);
          if (job && job.id && parsed.lovablePrompt) {
            pool.query('UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2', [parsed.lovablePrompt, job.id]).catch(() => {});
          }
          return { applicable: true, alreadySent: false, prompt: parsed.lovablePrompt, analysis: parsed.mockupAnalysis };
        })(),

        // ── Follow-up block ──────────────────────────────────
        (async () => {
          const clientName = job
            ? ([job.client_first_name, job.client_last_name].filter(Boolean).join(' ') || 'them')
            : 'them';
          const projectType = job?.job_heading || 'their project';
          const suggestedDate = getNextBusinessDay(3);
          const dateLabel = new Date(suggestedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const snippet = (email.body_text || email.snippet || '').slice(0, 300);
          const fuMsg = `Write a short follow-up email (max 60 words) to ${clientName} about their project: "${projectType}". Context from their email: "${snippet}". Rules: natural, human, no buzzwords, no "I hope this finds you", no subject line. Sign off as:\nBest,\nAshish\nHipHype Tech`;
          const fuText = await callClaudeHelper(null, fuMsg, anthropicKey, 'claude-3-5-haiku-20241022', 256);
          return { text: fuText.trim(), suggestedDate, label: `Send ${dateLabel}` };
        })(),
      ]);

      responseBody.lovable = lovableResult.status === 'fulfilled'
        ? lovableResult.value
        : { applicable: false, error: lovableResult.reason?.message };
      responseBody.followUp = followUpResult.status === 'fulfilled'
        ? followUpResult.value
        : { text: '', error: followUpResult.reason?.message };
    }

    res.json(responseBody);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/replies/regenerate-lovable — regen lovable block only
// POST /api/replies/regenerate-followup — regen follow-up block only
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

    const decision = evaluateMockupDecision(job, email);
    if (!decision.shouldBuild) {
      return res.json({ applicable: false, reason: decision.alternativeSuggestion });
    }
    const lovableTemplate = await getPromptTemplate('LOVABLE_MOCKUP_V1', req.user.id, pool);
    const lovableSystem = buildPromptWithContext(lovableTemplate, email, job, null, 'professional', 'LOVABLE_MOCKUP_V1', {}, {}, '11 AM your time', null);
    const lovableRaw = await callClaudeHelper(lovableSystem, buildUserMessage(email, job), anthropicKey, 'claude-sonnet-4-6', 2048);
    const parsed = parseMockupOutput(lovableRaw);
    if (job && job.id && parsed.lovablePrompt) {
      pool.query('UPDATE jobs SET mockup_lovable_prompt = $1 WHERE id = $2', [parsed.lovablePrompt, job.id]).catch(() => {});
    }
    res.json({ applicable: true, alreadySent: false, prompt: parsed.lovablePrompt, analysis: parsed.mockupAnalysis });
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
    const suggestedDate = getNextBusinessDay(3);
    const dateLabel = new Date(suggestedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const snippet = (email.body_text || email.snippet || '').slice(0, 300);
    const fuMsg = `Write a short follow-up email (max 60 words) to ${clientName} about their project: "${projectType}". Context from their email: "${snippet}". Rules: natural, human, no buzzwords, no "I hope this finds you", no subject line. Sign off as:\nBest,\nAshish\nHipHype Tech`;
    const fuText = await callClaudeHelper(null, fuMsg, anthropicKey, 'claude-3-5-haiku-20241022', 256);
    res.json({ text: fuText.trim(), suggestedDate, label: `Send ${dateLabel}` });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/replies/stats/banned-phrases — count banned phrases caught this week
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
// PUT /api/replies/:id/copied — Mark as copied
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
// PUT /api/replies/:id/variant — Record variant selection (UIUP-05)
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
        jobBlock += `\nNote: Email sender (${email.from_name || senderEmail}) is a team member — Upwork account holder is ${clientName} (${jobClientEmail})`;
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

  // OBJECTION-02: Counter-move template injection (soft instruction — Claude follows as guidance)
  if (objectionContext.counterMove) {
    const cm = objectionContext.counterMove;
    prompt += `\n\n<counter_move>
Objection type detected: ${objectionContext.objectionType}
Counter-move strategy: ${cm.counter_move_template}
CRITICAL: Keep your reply under ${cm.max_words} words. Follow the counter-move strategy above.
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

  // OBJECTION-04: Agency disclosure injection
  if (objectionContext.agencySensitive) {
    prompt += `\n\n<agency_disclosure>
The client's job post signals agency sensitivity. You MUST include this disclosure in the first paragraph:
"To be upfront — we're an agency, but for this project you'd work directly with [Name], a dedicated [role]. Same person from day one, direct Slack access."
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

  // Append link analysis block if a finding exists
  if (Array.isArray(linkAnalysis) && linkAnalysis.length > 0) {
    const best = linkAnalysis.find((r) => r.bestFindingForReply);
    if (best) {
      prompt += `\n\n<link_analysis>
URL Analyzed: ${best.url}
Key Finding: ${best.bestFindingForReply}
</link_analysis>
Use the key finding above naturally in your reply when appropriate — don't force it.`;
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
      ? 'Client sent a SHORT message (< 30 words). Your reply MUST be under 60 words. Match their brevity.'
      : energy === 'MEDIUM'
      ? 'Client sent a MEDIUM message. Keep reply under 100 words.'
      : 'Client sent a LONG message. Match their level of detail.';

    // THREAD-03: Post-call recap gate
    let postCallInstruction = '';
    if (stage === 'POST_CALL') {
      const clientRequestedProposal = job.client_requested_proposal === true;
      if (!clientRequestedProposal) {
        postCallInstruction = '\nPOST-CALL FORMAT: Write a RECAP reply only (under 100 words, 3-4 bullet points summarising what was discussed, next step). Do NOT write a full proposal unless the <thread_context> says proposal requested.';
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
      NO_COMMITMENT:   'Offer a tangible attachment — a mockup, an audit finding, or a relevant case study. No pressure close. Make it easy to say yes.',
      UNKNOWN:         'Add project-specific value. No CTA pressure. Keep under 60 words.',
    };

    prompt += `\n\n<stall_recovery>
Stall Type: ${stall}
Recovery Strategy: ${stallInstructions[stall] || stallInstructions['UNKNOWN']}
CRITICAL: Do not push. Do not guilt. Add value only.
</stall_recovery>`;
  }

  // PERSONA-01: Janet persona handoff
  // The outreach was sent as "Janet" — Ashish is now stepping in from his primary inbox.
  // Claude must introduce Ashish and explain the handoff naturally in the first sentence.
  if (threadContext.isJanetPersona) {
    prompt += `\n\n<persona_intro>
The initial outreach email to this client was sent by "Janet" — a persona used for cold outreach.
You are now writing as Ashish, stepping in from the primary account.
In your OPENING LINE only, briefly introduce the handoff in a natural, confident way.
Example: "Janet from our team had reached out earlier — I'm Ashish, picking this up from here."
Or: "Hi [client name], I'm Ashish — Janet looped me in to follow up on this."
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
"Hi ${newPerson.name || 'there'}, quick context — [your name] and I have been discussing [project summary] and the next step is [next action]."
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

  // CTA-01: Timezone-resolved call-to-action injection
  prompt += `\n\n<timezone_cta>
When suggesting a meeting time, use this exact format: "Would tomorrow at ${timezoneCTA} work for a quick call?"
Do NOT use raw timezone abbreviations like "EST" or "PST" without "your time". Always include "your time" in the CTA.
</timezone_cta>`;

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
Include a scope-based cost estimate range in your reply. Format: "Based on the scope you've described, this would typically fall in the $X-$Y range — happy to refine that on a quick call."
Calibrate the estimate to the job scope and budget signals. Do not use a generic number.
End with a call CTA to discuss pricing details further.
IMPORTANT: This cost estimate is intentionally included — do NOT strip it or deflect to a call without giving a range.
</cost_context>`;
  }

  // CTA-03 + CTA-04: Greeting reminder (reinforcement — templates already have greeting rules)
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

  // Strip --- NEXT STEP SUMMARY (Internal) --- block before extracting clean text
  // This block uses dash delimiters (not bracket markers) — must be handled separately
  let processedText = rawText;
  let nextStepRawBlock = null;
  const nextStepBlockMatch = rawText.match(/---\s*NEXT STEP SUMMARY[^-]*---[\s\S]*?(?=---|$)/i);
  if (nextStepBlockMatch) {
    nextStepRawBlock = nextStepBlockMatch[0];
    processedText = rawText.slice(0, nextStepBlockMatch.index).trim();
  }

  // Find the first occurrence of either block marker
  const blockStart = processedText.search(/\[JOB ANALYSIS\]|\[LINK ANALYSIS\]/i);

  if (blockStart === -1) {
    // No blocks present — entire text is the clean reply
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
  // Get email body — prefer bodyText, fall back to stripping HTML from bodyHtml
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
 * checkFollowUpSpecificity — QUALITY-01
 * Secondary Haiku call to classify whether follow-up contains client-specific detail.
 * Returns true (is specific) on Haiku error — fail open.
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
        model: "claude-3-5-haiku-20241022",
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
 * extractFollowUpAngle — QUALITY-02
 * Extracts 5-10 word angle description using Haiku.
 * Returns null on failure — caller skips DB write gracefully.
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
        model: "claude-3-5-haiku-20241022",
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
