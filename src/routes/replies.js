/**
 * Reply Generation Routes — REPLY-01 + Phase 12 Pipeline
 *
 * POST /api/replies/generate    — Generate AI reply (full pipeline with Step 6b validation)
 * PUT  /api/replies/:id/copied  — Mark reply as copied
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

const router = express.Router();

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
    const { emailId, tone = "professional", promptOverride, source } = req.body;

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
        return res.json({
          killSwitch: true,
          reason: 'Maximum follow-ups reached (2). Lead moved to DORMANT. Re-engage after 30 days.',
          followUpCount: currentFollowUpCount,
          promptType,
        });
      }
    }

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
    const systemPrompt = buildPromptWithContext(templateContent, email, job, linkAnalysis, tone, promptType, objectionContext);
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
    const { cleanText, jobAnalysisBlock, linkAnalysisBlock } = extractInternalBlocks(rawText);

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
    // clientRequestedPricing: true only for PROPOSAL_V4 — future toggle; default false for now
    const clientRequestedPricing = false; // Phase 14+ will add toggle support
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
      },
    };

    // Only include warning field if there were prefetch failures
    if (prefetchWarnings.length > 0) {
      responseBody.warning = prefetchWarnings.join("; ");
    }

    res.json(responseBody);
  } catch (err) {
    next(err);
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
function buildPromptWithContext(templateContent, email, job, linkAnalysis, tone, promptType, objectionContext = {}) {
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
    return { cleanText: "", jobAnalysisBlock: null, linkAnalysisBlock: null };
  }

  // Find the first occurrence of either block marker
  const blockStart = rawText.search(/\[JOB ANALYSIS\]|\[LINK ANALYSIS\]/i);

  if (blockStart === -1) {
    // No blocks present — entire text is the clean reply
    return {
      cleanText: rawText.trim(),
      jobAnalysisBlock: null,
      linkAnalysisBlock: null,
    };
  }

  const cleanText = rawText.substring(0, blockStart).trim();
  const blocksSection = rawText.substring(blockStart);

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

  return { cleanText, jobAnalysisBlock, linkAnalysisBlock };
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

module.exports = router;
