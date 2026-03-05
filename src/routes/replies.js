/**
 * Reply Generation Routes — REPLY-01 + Phase 12 Pipeline
 *
 * POST /api/replies/generate    — Generate AI reply (full 5-step pre-generation pipeline)
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

// ============================================================
// POST /api/replies/generate — Full 5-step pre-generation pipeline
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
    const systemPrompt = buildPromptWithContext(templateContent, email, job, linkAnalysis, tone);
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
    // Step 7: Save reply + update job
    // ──────────────────────────────────────────────────────────
    const { rows: replyRows } = await pool.query(
      `INSERT INTO replies (
        user_id, email_id, job_id, tone, intent,
        generated_text, model, prompt_tokens, completion_tokens,
        prompt_type_used, job_analysis_block, link_analysis_block, prefetch_warnings
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.user.id,
        email.id,
        job?.id || null,
        tone,
        intent,
        cleanText,
        model,
        promptTokens,
        completionTokens,
        promptType,
        jobAnalysisBlock,
        linkAnalysisBlock,
        prefetchWarnings.length > 0 ? prefetchWarnings : null,
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
 * @param {Object} pool
 * @returns {Promise<string>} template content string
 */
async function getPromptTemplate(promptType, userId, pool) {
  try {
    const { rows } = await pool.query(
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
 * @param {string} templateContent - Base prompt from DB (or default)
 * @param {Object} email
 * @param {Object|null} job
 * @param {Array|null} linkAnalysis - Array of analyzeUrl() results
 * @param {string} tone
 * @returns {string}
 */
function buildPromptWithContext(templateContent, email, job, linkAnalysis, tone) {
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

module.exports = router;
