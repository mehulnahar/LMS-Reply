/**
 * AI-Powered Email Analysis — SIGNAL-01
 *
 * Uses Claude Haiku to analyze Upwork client emails and extract
 * structured signals: lead score, phone, urgency, OOO, redirect, intent.
 *
 * Model: claude-haiku-4-20250514 (fast, cheap, perfect for classification)
 */

const pool = require("../config/db");
const { decrypt } = require("./encryption");

const ANALYSIS_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are an email analyst for an Upwork freelancer. Your job is to analyze client emails and extract structured signals.

Analyze the email and return ONLY a valid JSON object with these fields:

{
  "lead_score": <number 0-100>,
  "has_phone": <boolean>,
  "extracted_phone": <string or null>,
  "has_urgency": <boolean>,
  "is_ooo": <boolean>,
  "is_redirect": <boolean>,
  "intent": <string>,
  "summary": <string 1-2 sentences>
}

LEAD SCORE GUIDELINES (0-100):
- 80-100: High-intent client — direct reply with project details, mentions budget/timeline, asks specific questions, provides contact info, wants to schedule a call
- 60-79: Good prospect — shows genuine interest, asks about availability/experience, describes project needs
- 40-59: Medium — generic inquiry, short messages, initial Upwork notification about a job posting, or automated Upwork messages with some relevant content
- 20-39: Low — very short/vague messages, bulk notifications, no clear project need
- 0-19: Not a lead — out-of-office replies, unsubscribe requests, spam, auto-replies, no-reply addresses, marketing emails

INTENT CATEGORIES (pick the most fitting one):
- "pricing_inquiry" — asking about rates, budget, cost
- "requirements" — describing project needs, scope, specifications
- "schedule_call" — wants to meet, call, discuss further
- "portfolio_request" — asking for samples, previous work, case studies
- "urgent" — needs something done ASAP, tight deadline
- "positive_feedback" — thanking, praising, expressing satisfaction
- "rejection" — declining, not interested, chose someone else
- "proposal_request" — asking for a proposal or bid
- "status_update" — checking on progress, asking for updates
- "change_request" — requesting changes, revisions, modifications
- "ooo" — out of office, vacation, auto-reply
- "forwarded" — forwarded email, FYI
- "general" — doesn't fit other categories

PHONE EXTRACTION:
- Look for phone numbers in any format (US, international, with/without country code)
- Include the full number as found if present
- Set has_phone to true only if an actual phone number is found

Return ONLY the JSON object. No markdown, no explanation, no extra text.`;

/**
 * Get the Anthropic API key for a user.
 * Returns the decrypted key string, or null if not configured.
 */
async function getAnthropicKey(userId) {
  try {
    const { rows } = await pool.query(
      "SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE user_id = $1 AND service = 'anthropic'",
      [userId]
    );
    if (rows.length === 0) return null;
    return decrypt(rows[0].encrypted_key, rows[0].iv, rows[0].auth_tag);
  } catch {
    return null;
  }
}

/**
 * Analyze an email using Claude Haiku.
 * Returns structured signals object, or null on failure.
 *
 * @param {string} bodyText - Plain text body of the email
 * @param {string} bodyHtml - HTML body of the email
 * @param {string} subject - Email subject line
 * @param {string} anthropicKey - Decrypted Anthropic API key
 * @returns {Object|null} Signals object or null
 */
async function analyzeEmail(bodyText, bodyHtml, subject, anthropicKey, { throwOnError = false } = {}) {
  if (!anthropicKey) {
    if (throwOnError) throw new Error("No Anthropic key");
    return null;
  }

  // Use bodyText if available, otherwise strip HTML tags from bodyHtml
  let content = bodyText;
  if (!content && bodyHtml) {
    content = bodyHtml
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

  if (!content || content.length < 5) {
    // Too short to analyze meaningfully
    return {
      lead_score: 10,
      has_phone: false,
      extracted_phone: null,
      has_urgency: false,
      is_ooo: false,
      is_redirect: false,
      intent: "general",
      summary: "Email has minimal content.",
    };
  }

  // Truncate very long emails to save tokens (Haiku handles ~4K well)
  const truncated = content.length > 3000 ? content.slice(0, 3000) + "\n[... truncated]" : content;

  const userMessage = `EMAIL SUBJECT: ${subject || "(No subject)"}\n\nEMAIL BODY:\n${truncated}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = `API ${response.status}: ${errBody.error?.message || response.statusText}`;
      console.error("Email analysis API error:", errMsg);
      if (throwOnError) throw new Error(errMsg);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Parse JSON from response (handle potential markdown code blocks)
    const jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const signals = JSON.parse(jsonStr);

    // Validate and clamp values
    return {
      lead_score: Math.max(0, Math.min(100, parseInt(signals.lead_score) || 0)),
      has_phone: Boolean(signals.has_phone),
      extracted_phone: signals.extracted_phone || null,
      has_urgency: Boolean(signals.has_urgency),
      is_ooo: Boolean(signals.is_ooo),
      is_redirect: Boolean(signals.is_redirect),
      intent: signals.intent || "general",
      summary: signals.summary || null,
    };
  } catch (err) {
    console.error("Email analysis failed:", err.message);
    if (throwOnError) throw err;
    return null;
  }
}

/**
 * Map AI-detected intent to an auto-status for the email.
 * Returns null if no auto-status change is warranted.
 */
function intentToStatus(intent, isOoo) {
  if (isOoo) return "ignored";
  switch (intent) {
    case "rejection": return "lost";
    default: return null;
  }
}

module.exports = { analyzeEmail, getAnthropicKey, intentToStatus, ANALYSIS_MODEL };
