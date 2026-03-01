/**
 * Reply Generation Routes — REPLY-01
 *
 * POST /api/replies/generate    — Generate AI reply for an email
 * PUT  /api/replies/:id/copied  — Mark reply as copied
 */

const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { decrypt } = require("../utils/encryption");

const router = express.Router();

const TONES = {
  professional: "You write in a professional, business-appropriate tone. Be courteous but direct.",
  friendly: "You write in a warm, friendly tone while remaining professional. Use a conversational style.",
  concise: "You write extremely concise replies. Get to the point in as few words as possible. No fluff.",
  detailed: "You write thorough, detailed replies that address every point raised. Be comprehensive.",
};

// ============================================================
// POST /api/replies/generate — Generate AI reply
// ============================================================
router.post("/generate", requireAuth, async (req, res, next) => {
  try {
    const { emailId, tone = "professional" } = req.body;

    if (!emailId) {
      return res.status(400).json({ error: "emailId is required" });
    }

    if (!TONES[tone]) {
      return res.status(400).json({ error: `Invalid tone. Valid: ${Object.keys(TONES).join(", ")}` });
    }

    // Get Anthropic API key
    const { rows: keyRows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'anthropic'",
      [req.user.id]
    );

    if (keyRows.length === 0) {
      return res.status(400).json({ error: "Anthropic API key not configured. Add it in Settings." });
    }

    const anthropicKey = decrypt(keyRows[0].encrypted_key, keyRows[0].iv, keyRows[0].auth_tag);

    // Get email + job context
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

    // Build prompt
    const systemPrompt = buildSystemPrompt(tone, email, job);
    const userMessage = buildUserMessage(email, job);

    // Call Claude API
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      return res.status(502).json({
        error: `Claude API error: ${err.error?.message || claudeRes.statusText}`,
      });
    }

    const claudeData = await claudeRes.json();
    const generatedText = claudeData.content?.[0]?.text || "";
    const model = claudeData.model || "claude-sonnet-4-20250514";
    const promptTokens = claudeData.usage?.input_tokens || 0;
    const completionTokens = claudeData.usage?.output_tokens || 0;

    // Detect intent from the email
    const intent = detectIntent(email.body_text || email.snippet);

    // Save reply
    const { rows: replyRows } = await pool.query(
      `INSERT INTO replies (user_id, email_id, job_id, tone, intent, generated_text, model, prompt_tokens, completion_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.id, email.id, job?.id, tone, intent, generatedText, model, promptTokens, completionTokens]
    );

    const reply = replyRows[0];
    res.json({
      reply: {
        id: reply.id,
        tone: reply.tone,
        intent: reply.intent,
        generatedText: reply.generated_text,
        model: reply.model,
        promptTokens: reply.prompt_tokens,
        completionTokens: reply.completion_tokens,
        createdAt: reply.created_at,
      },
    });
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

function buildSystemPrompt(tone, email, job) {
  let prompt = `You are a professional freelancer responding to a client inquiry on Upwork.
${TONES[tone]}

RULES:
- Write ONLY the reply text. No subject lines, no "Dear", just the direct response.
- Be specific to what the client asked about.
- Keep replies under 200 words unless the "detailed" tone is selected.
- Never use placeholder text like [Your Name] — leave the sign-off simple.
- If the client mentioned a specific technology or requirement, address it directly.
- Sound human, not AI-generated. Avoid corporate jargon.`;

  if (job) {
    prompt += `\n\nJOB CONTEXT:
- Job Title: ${job.job_heading || "Unknown"}
- Job Description: ${job.job_description || "Not available"}
- Client: ${[job.client_first_name, job.client_last_name].filter(Boolean).join(" ") || "Unknown"}`;
  }

  return prompt;
}

function buildUserMessage(email, _job) {
  let msg = `CLIENT EMAIL:
From: ${email.from_name || email.from_email}
Subject: ${email.subject}

${email.body_text || email.snippet || "(No body text)"}`;

  if (email.extracted_phone) {
    msg += `\n\n[Note: Client included phone number: ${email.extracted_phone}]`;
  }

  msg += "\n\nWrite a reply to this client email.";
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
