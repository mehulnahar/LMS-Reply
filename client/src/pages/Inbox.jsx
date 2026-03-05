import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../api";

const INTENT_LABELS = {
  pricing_inquiry:   { label: "Pricing",    color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  requirements:      { label: "Requirements", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  schedule_call:     { label: "Schedule Call", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  portfolio_request: { label: "Portfolio",   color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  urgent:            { label: "Urgent",      color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  positive_feedback: { label: "Positive",   color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  rejection:         { label: "Rejection",  color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
  proposal_request:  { label: "Proposal Req", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  status_update:     { label: "Status",     color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  change_request:    { label: "Change Req", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  ooo:               { label: "OOO",        color: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
  forwarded:         { label: "Forwarded",  color: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
  general:           { label: "General",    color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

const STATUS_LABELS = {
  new: { label: "New", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  replied: { label: "Replied", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  proposal_sent: { label: "Proposal", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  won: { label: "Won", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  lost: { label: "Lost", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
  ignored: { label: "Ignored", color: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
};

const TONES = [
  { id: "professional", label: "Professional" },
  { id: "friendly", label: "Friendly" },
  { id: "concise", label: "Concise" },
  { id: "detailed", label: "Detailed" },
];

const PROMPT_TYPE_LABELS = {
  'EMAIL_REPLY_V2':         'First Reply',
  'THREAD_CONTINUATION_V1': 'Thread Continuation',
  'FOLLOW_UP_V2':           'Follow-Up',
  'PROPOSAL_V4':            'Proposal',
  'LOVABLE_MOCKUP_V1':      'Lovable Mockup',
};

const PROMPT_OPTIONS = [
  { value: '',                       label: 'Auto-detect' },
  { value: 'EMAIL_REPLY_V2',         label: 'First Reply (V2)' },
  { value: 'THREAD_CONTINUATION_V1', label: 'Thread Continuation (V1)' },
  { value: 'FOLLOW_UP_V2',           label: 'Follow-Up (V2)' },
  { value: 'PROPOSAL_V4',            label: 'Proposal (V4)' },
  { value: 'LOVABLE_MOCKUP_V1',      label: 'Lovable Mockup (V1)' },
];

// ── ClientLocalTime component ─────────────────────────────────────────────────
// Uses the /api/timezone endpoint (Claude Haiku) to resolve city+country to an
// IANA timezone, then displays the client's current local time + abbreviation
// (EST, PST, IST, NZDT, etc.) updated every 60 seconds.
function ClientLocalTime({ city, country }) {
  const [timezone, setTimezone] = useState(null);
  const [timeStr,  setTimeStr]  = useState("");
  const [tzAbbr,   setTzAbbr]   = useState("");
  const [loading,  setLoading]  = useState(true);

  // Step 1 — ask Claude Haiku for the IANA timezone
  useEffect(() => {
    if (!city && !country) return;
    let cancelled = false;
    setLoading(true);
    setTimezone(null);
    setTimeStr("");
    setTzAbbr("");
    api.getTimezone(city, country)
      .then((data) => {
        if (!cancelled) setTimezone(data.timezone);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [city, country]);

  // Step 2 — run the clock once we have a valid timezone
  useEffect(() => {
    if (!timezone) return;
    const update = () => {
      try {
        const t = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          weekday:  "short",
          hour:     "numeric",
          minute:   "2-digit",
          hour12:   true,
        }).format(new Date());
        setTimeStr(t);

        // "short" gives the common abbreviation: EST, PST, IST, NZDT, AEST…
        const abbr = new Intl.DateTimeFormat("en-US", {
          timeZone:     timezone,
          timeZoneName: "short",
        }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || "";
        setTzAbbr(abbr);
      } catch {
        setTimeStr("");
        setTzAbbr("");
      }
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [timezone]);

  // Show a subtle loading dot while Claude resolves the timezone
  if (loading) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-600 flex items-center gap-1 mt-0.5">
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="animate-pulse">Loading time…</span>
      </p>
    );
  }

  if (!timezone || !timeStr) return null;

  return (
    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{timeStr}</span>
      {tzAbbr && (
        <span className="font-medium text-gray-500 dark:text-gray-400 ml-0.5">{tzAbbr}</span>
      )}
    </p>
  );
}

/**
 * Sanitize HTML to remove dangerous tags and attributes.
 * Keeps formatting tags (p, br, div, span, a, ul, ol, li, h1-h6, strong, em, etc.)
 */
function sanitizeHtml(html) {
  if (!html) return "";
  let clean = html;
  // Remove dangerous tags entirely (including content)
  clean = clean.replace(/<script[\s\S]*?<\/script>/gi, "");
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, "");
  clean = clean.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  clean = clean.replace(/<object[\s\S]*?<\/object>/gi, "");
  clean = clean.replace(/<embed[\s\S]*?(<\/embed>)?/gi, "");
  clean = clean.replace(/<form[\s\S]*?<\/form>/gi, "");
  clean = clean.replace(/<input[^>]*>/gi, "");
  clean = clean.replace(/<textarea[\s\S]*?<\/textarea>/gi, "");
  clean = clean.replace(/<button[\s\S]*?<\/button>/gi, "");
  // Remove all on* event handlers (onclick, onload, onerror, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Remove javascript: URLs
  clean = clean.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"');
  clean = clean.replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'src=""');
  return clean;
}

export default function Inbox() {
  const [emails, setEmails] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState({ status: "", account: "" });
  const [tone, setTone] = useState("professional");
  const [generating, setGenerating] = useState(false);
  const [matching, setMatching] = useState(false);
  const [manualLink, setManualLink] = useState("");
  const [matchingByLink, setMatchingByLink] = useState(false);
  const [manualLinkError, setManualLinkError] = useState("");
  const [copied, setCopied] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [activeReplyId, setActiveReplyId] = useState(null);
  const [promptOverride, setPromptOverride] = useState('');
  const [activePromptType, setActivePromptType] = useState(null);
  const [generationWarning, setGenerationWarning] = useState('');
  const [suppressed, setSuppressed] = useState(false);
  const [suppressedReason, setSuppressedReason] = useState('');

  const fetchEmails = useCallback(async () => {
    try {
      const params = {};
      if (filter.status) params.status = filter.status;
      if (filter.account) params.account = filter.account;
      const data = await api.getEmails(params);
      setEmails(data.emails || []);
      setTotal(data.total || 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchEmails();
    api.getGmailAccounts().then(setAccounts).catch(() => {});
  }, [fetchEmails]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncAllEmails();
      await fetchEmails();
    } catch {
      // silent
    } finally {
      setSyncing(false);
    }
  };

  const selectEmail = async (id) => {
    setSelectedId(id);
    setDetailLoading(true);
    setReplyText("");
    setActiveReplyId(null);
    setCopied(false);
    setManualLink("");
    setManualLinkError("");
    setActivePromptType(null);
    setGenerationWarning('');
    setSuppressed(false);
    setSuppressedReason('');
    try {
      const data = await api.getEmail(id);
      setDetail(data);
      if (data.replies?.length > 0) {
        const latest = data.replies[0];
        setReplyText(latest.editedText || latest.generatedText);
        setActiveReplyId(latest.id);
      }
      // Mark as read in the sidebar list
      setEmails((prev) =>
        prev.map((e) => (e.id === id ? { ...e, isUnread: false } : e))
      );
      // Persist to backend (fire-and-forget)
      api.markEmailRead(id).catch(() => {});
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleMatchJob = async () => {
    if (!detail?.email?.id) return;
    setMatching(true);
    try {
      const data = await api.matchJob(detail.email.id);
      setDetail((prev) => ({ ...prev, job: data.job }));
    } catch {
      // silent
    } finally {
      setMatching(false);
    }
  };

  const handleMatchByLink = async () => {
    if (!detail?.email?.id || !manualLink.trim()) return;
    if (!manualLink.includes("upwork.com")) {
      setManualLinkError("Please paste a valid Upwork job link");
      return;
    }
    setManualLinkError("");
    setMatchingByLink(true);
    try {
      const data = await api.matchJobByLink(detail.email.id, manualLink.trim());
      setDetail((prev) => ({ ...prev, job: data.job }));
      setManualLink("");
    } catch (err) {
      setManualLinkError(err.message || "Failed to match job by link");
    } finally {
      setMatchingByLink(false);
    }
  };

  const handleGenerate = async (source = null) => {
    if (!detail?.email?.id) return;
    setGenerating(true);
    setCopied(false);
    setSuppressed(false);
    setSuppressedReason('');
    setGenerationWarning('');
    try {
      // Auto-match job first if not matched
      if (!detail.job || detail.job.matchStatus === 'error') {
        try {
          const jobData = await api.matchJob(detail.email.id);
          setDetail((prev) => ({ ...prev, job: jobData.job }));
        } catch {
          // continue without job context
        }
      }

      const data = await api.generateReply(detail.email.id, {
        tone,
        promptOverride: promptOverride || null,
        source,
      });

      // Handle STOP suppression
      if (data.suppressed) {
        setSuppressed(true);
        setSuppressedReason(data.reason || 'Generation suppressed — OOO or STOP classification');
        setReplyText('');
        setActiveReplyId(null);
        return;
      }

      setReplyText(data.reply.generatedText);
      setActiveReplyId(data.reply.id);
      setActivePromptType(data.reply.promptTypeUsed || null);
      if (data.warning) setGenerationWarning(data.warning);

      setDetail((prev) => ({
        ...prev,
        replies: [data.reply, ...(prev.replies || [])],
      }));
    } catch {
      // silent
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(replyText);
      setCopied(true);
      if (activeReplyId) {
        api.markReplyCopied(activeReplyId).catch(() => {});
      }
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = replyText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStatusChange = async (status) => {
    if (!detail?.email?.id) return;
    try {
      await api.updateEmailStatus(detail.email.id, status);
      setDetail((prev) => ({
        ...prev,
        email: { ...prev.email, status },
      }));
      setEmails((prev) =>
        prev.map((e) => (e.id === detail.email.id ? { ...e, status } : e))
      );
    } catch {
      // silent
    }
  };

  const timeAgo = (date) => {
    const now = new Date();
    const d = new Date(date);
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const scoreColor = (score) => {
    if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
    if (score >= 40) return "text-amber-600 dark:text-amber-400";
    return "text-red-500 dark:text-red-400";
  };

  const noEmails = !loading && emails.length === 0;
  const noAccounts = accounts.length === 0;

  return (
    <div className="h-[calc(100vh-64px)] flex">
      {/* ─── Left: Email List ─── */}
      <div className="w-[380px] flex-shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-white dark:bg-gray-950">
        {/* Toolbar */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Inbox{" "}
              <span className="text-xs font-normal text-gray-400">({total})</span>
            </h2>
            <button
              onClick={handleSync}
              disabled={syncing || noAccounts}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400 dark:hover:bg-brand-900/30 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              {syncing ? "Syncing..." : "Sync"}
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filter.account}
              onChange={(e) => setFilter((f) => ({ ...f, account: e.target.value }))}
              className="flex-1 text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
            <select
              value={filter.status}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
              className="text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            >
              <option value="">All status</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Email rows */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <Spinner />
            </div>
          )}

          {noAccounts && !loading && (
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No Gmail accounts connected</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Go to Settings to connect your Gmail</p>
            </div>
          )}

          {noEmails && !noAccounts && !loading && (
            <div className="p-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">No emails yet</p>
              <p className="text-xs text-gray-400 mt-1">Click Sync to pull unread emails</p>
            </div>
          )}

          {emails.map((email) => (
            <button
              key={email.id}
              onClick={() => selectEmail(email.id)}
              className={`w-full text-left px-4 py-3.5 border-b border-gray-100 dark:border-gray-800/50 transition-colors
                ${selectedId === email.id
                  ? "bg-brand-50 dark:bg-brand-900/10 border-l-2 border-l-brand-500"
                  : "hover:bg-gray-50 dark:hover:bg-gray-900 border-l-2 border-l-transparent"
                }`}
            >
              <div className="flex items-start gap-3">
                {/* Account color dot */}
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ backgroundColor: email.accountColor || "#4F46E5" }}
                  title={email.accountEmail}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${email.isUnread ? "font-semibold" : "font-medium text-gray-600 dark:text-gray-400"}`}>
                      {email.fromName || email.fromEmail}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {timeAgo(email.receivedAt)}
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 truncate ${email.isUnread ? "text-gray-700 dark:text-gray-300" : "text-gray-500 dark:text-gray-500"}`}>
                    {email.subject}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {email.leadScore != null && (
                      <span className={`text-[10px] font-bold ${scoreColor(email.leadScore)}`}>
                        {email.leadScore}
                      </span>
                    )}
                    {/* Hide "New" badge once the email has been read; show all other statuses always */}
                    {(email.status !== "new" || email.isUnread) && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_LABELS[email.status]?.color || ""}`}>
                        {STATUS_LABELS[email.status]?.label || email.status}
                      </span>
                    )}
                    {email.intent && email.intent !== "general" && INTENT_LABELS[email.intent] && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${INTENT_LABELS[email.intent].color}`}>
                        {INTENT_LABELS[email.intent].label}
                      </span>
                    )}
                    {email.hasUrgency && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-medium">
                        Urgent
                      </span>
                    )}
                    {email.hasPhone && (
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Right: Detail Panel ─── */}
      <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
        {!selectedId && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <p className="text-sm text-gray-400 dark:text-gray-500">Select an email to view</p>
            </div>
          </div>
        )}

        {selectedId && detailLoading && (
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        )}

        {selectedId && detail && !detailLoading && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Email Header */}
            <div className="px-6 py-4 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold truncate">{detail.email.subject}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: detail.email.accountColor || "#4F46E5" }}
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {detail.email.fromName || detail.email.fromEmail}
                      <span className="mx-1 text-gray-300 dark:text-gray-600">→</span>
                      {detail.email.accountEmail}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(detail.email.receivedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                {/* Status dropdown */}
                <select
                  value={detail.email.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  className="text-xs px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              {detail.email.extractedPhone && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-brand-600 dark:text-brand-400">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  {detail.email.extractedPhone}
                </div>
              )}
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                {/* Signals Panel */}
                {(detail.email.leadScore != null || detail.email.intent || detail.email.hasPhone || detail.email.hasUrgency || detail.email.isOoo || detail.email.isRedirect) && (
                  <div className="card px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {detail.email.leadScore != null && (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          detail.email.leadScore >= 70
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : detail.email.leadScore >= 40
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                        }`}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                          </svg>
                          Lead: {detail.email.leadScore}
                        </span>
                      )}
                      {detail.email.intent && INTENT_LABELS[detail.email.intent] && (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${INTENT_LABELS[detail.email.intent].color}`}>
                          {INTENT_LABELS[detail.email.intent].label}
                        </span>
                      )}
                      {detail.email.summary && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                          {detail.email.summary}
                        </span>
                      )}
                      {detail.email.hasUrgency && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          Urgent
                        </span>
                      )}
                      {detail.email.hasPhone && detail.email.extractedPhone && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                          </svg>
                          {detail.email.extractedPhone}
                        </span>
                      )}
                      {detail.email.isOoo && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Out of Office
                        </span>
                      )}
                      {detail.email.isRedirect && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                          </svg>
                          Redirected
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Email body */}
                <div className="card p-5">
                  {detail.email.bodyHtml ? (
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed
                        [&_a]:text-brand-600 [&_a]:dark:text-brand-400 [&_a]:underline
                        [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded
                        [&_table]:border-collapse [&_td]:p-1 [&_th]:p-1
                        [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:italic"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(detail.email.bodyHtml) }}
                    />
                  ) : detail.email.bodyText ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                      {detail.email.bodyText}
                    </div>
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap text-gray-400">
                      {detail.email.snippet || "(No content)"}
                    </div>
                  )}
                </div>

                {/* Job Context Panel */}
                <div className="card">
                  <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Job Context
                    </span>
                    {(!detail.job || ["error", "no_match"].includes(detail.job.matchStatus)) && (
                      <button
                        onClick={handleMatchJob}
                        disabled={matching}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
                      >
                        {matching ? "Matching..." : detail.job?.matchStatus === "no_match" ? "Re-match" : "Find Match"}
                      </button>
                    )}
                  </div>
                  <div className="p-5">
                    {!detail.job && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        No job matched yet. Click "Find Match" or generate a reply to auto-match.
                      </p>
                    )}
                    {detail.job?.matchStatus === "matched" && (
                      <div className="space-y-4">

                        {/* Job Title + Upwork Link */}
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-sm font-semibold leading-snug">{detail.job.jobHeading}</h4>
                            {detail.job.upworkLink && (
                              <a
                                href={detail.job.upworkLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-shrink-0 text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                </svg>
                                Upwork
                              </a>
                            )}
                          </div>
                          {(detail.job.category || detail.job.subCategory) && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {[detail.job.category, detail.job.subCategory].filter(Boolean).join(" › ")}
                            </p>
                          )}
                        </div>

                        {/* Client Info */}
                        <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 space-y-3">

                          {/* Replying To — shown only when email sender ≠ Upwork account holder */}
                          {detail.email?.fromEmail &&
                           detail.job.clientEmail &&
                           detail.email.fromEmail.toLowerCase() !== detail.job.clientEmail.toLowerCase() && (
                            <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Replying To</p>
                              <p className="text-sm font-medium">{detail.email.fromName || detail.email.fromEmail}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{detail.email.fromEmail}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">Team member — communicating on behalf of the client</p>
                            </div>
                          )}

                          {/* Upwork Account / Job Poster */}
                          <div>
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                              {detail.email?.fromEmail &&
                               detail.job.clientEmail &&
                               detail.email.fromEmail.toLowerCase() !== detail.job.clientEmail.toLowerCase()
                                ? "Upwork Account"
                                : "Client"}
                            </p>
                            <div className="space-y-1">
                              {(detail.job.clientFirstName || detail.job.clientLastName || detail.job.company) && (
                                <p className="text-sm font-medium">
                                  {detail.job.company && detail.job.company !== detail.job.clientFirstName
                                    ? detail.job.company
                                    : [detail.job.clientFirstName, detail.job.clientLastName].filter(Boolean).join(" ")}
                                </p>
                              )}
                              {detail.job.clientEmail && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{detail.job.clientEmail}</p>
                              )}
                              {(detail.job.city || detail.job.country) && (
                                <>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                                    </svg>
                                    {[detail.job.city, detail.job.country].filter(Boolean).join(", ")}
                                  </p>
                                  <ClientLocalTime city={detail.job.city} country={detail.job.country} />
                                </>
                              )}
                              {detail.job.industry && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">{detail.job.industry}</p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Budget */}
                        {(detail.job.hourlyBudgetMin || detail.job.hourlyBudgetMax || detail.job.amount || detail.job.paymentType || detail.job.workload || detail.job.duration) && (
                          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Budget & Scope</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {(detail.job.hourlyBudgetMin || detail.job.hourlyBudgetMax) && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Hourly Rate</p>
                                  <p className="text-sm font-medium">
                                    {detail.job.hourlyBudgetMin && detail.job.hourlyBudgetMax
                                      ? `$${detail.job.hourlyBudgetMin}–$${detail.job.hourlyBudgetMax}`
                                      : `$${detail.job.hourlyBudgetMin || detail.job.hourlyBudgetMax}`}
                                  </p>
                                </div>
                              )}
                              {detail.job.amount && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Fixed Budget</p>
                                  <p className="text-sm font-medium">${detail.job.amount}</p>
                                </div>
                              )}
                              {detail.job.paymentType && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Type</p>
                                  <p className="text-sm font-medium capitalize">{detail.job.paymentType}</p>
                                </div>
                              )}
                              {detail.job.workload && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Workload</p>
                                  <p className="text-sm font-medium">{detail.job.workload}</p>
                                </div>
                              )}
                              {detail.job.duration && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Duration</p>
                                  <p className="text-sm font-medium">{detail.job.duration}</p>
                                </div>
                              )}
                              {detail.job.contractorTier && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Level</p>
                                  <p className="text-sm font-medium">{detail.job.contractorTier}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Client History / Trust Signals */}
                        {(detail.job.isPaymentVerified || detail.job.buyerHistoryAmount || detail.job.totalJobsPosted || detail.job.totalJobsWithHires || detail.job.avgHourlyRate || detail.job.isEnterprise) && (
                          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Client History</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {detail.job.isPaymentVerified && (
                                <div className="col-span-2 flex items-center gap-1.5">
                                  {detail.job.isPaymentVerified === "1" || detail.job.isPaymentVerified === "true" ? (
                                    <>
                                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Payment Verified</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <span className="text-xs text-gray-400 dark:text-gray-500">Payment Not Verified</span>
                                    </>
                                  )}
                                </div>
                              )}
                              {detail.job.isEnterprise && (detail.job.isEnterprise === "1" || detail.job.isEnterprise === "true") && (
                                <div className="col-span-2">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                    Enterprise Client
                                  </span>
                                </div>
                              )}
                              {detail.job.buyerHistoryAmount && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Total Spent</p>
                                  <p className="text-sm font-medium">${detail.job.buyerHistoryAmount}</p>
                                </div>
                              )}
                              {detail.job.avgHourlyRate && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Avg Rate Paid</p>
                                  <p className="text-sm font-medium">${detail.job.avgHourlyRate}/hr</p>
                                </div>
                              )}
                              {detail.job.totalJobsPosted && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Jobs Posted</p>
                                  <p className="text-sm font-medium">{detail.job.totalJobsPosted}</p>
                                </div>
                              )}
                              {detail.job.totalJobsWithHires && (
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Jobs Hired</p>
                                  <p className="text-sm font-medium">{detail.job.totalJobsWithHires}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Job Description */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Job Description</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
                            {detail.job.jobDescription}
                          </p>
                        </div>

                      </div>
                    )}
                    {detail.job?.matchStatus === "no_match" && (
                      <div className="space-y-3">
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          No matching job found in LeadHack. Paste the Upwork link to match manually.
                        </p>
                        <ManualLinkInput
                          value={manualLink}
                          onChange={setManualLink}
                          onSubmit={handleMatchByLink}
                          loading={matchingByLink}
                          error={manualLinkError}
                        />
                      </div>
                    )}
                    {detail.job?.matchStatus === "needs_manual" && (
                      <div className="space-y-3">
                        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                          <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Multiple jobs matched this email. Paste the exact Upwork link to resolve.
                          </p>
                        </div>
                        <ManualLinkInput
                          value={manualLink}
                          onChange={setManualLink}
                          onSubmit={handleMatchByLink}
                          loading={matchingByLink}
                          error={manualLinkError}
                        />
                      </div>
                    )}
                    {detail.job?.matchStatus === "error" && (
                      <p className="text-xs text-amber-500">
                        Job matching failed. Check your LeadHack API key in Settings.
                      </p>
                    )}
                  </div>
                </div>

                {/* Reply Generator */}
                <div className="card">
                  <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Reply
                      </span>
                      {/* Prompt badge — shown after first generation */}
                      {activePromptType && !suppressed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                          Using: {PROMPT_TYPE_LABELS[activePromptType] || activePromptType}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={promptOverride}
                        onChange={(e) => setPromptOverride(e.target.value)}
                        title="Override auto-detected prompt"
                        className="text-xs px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                      >
                        {PROMPT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                        className="text-xs px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                      >
                        {TONES.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleGenerate(null)}
                        disabled={generating}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                      >
                        {generating ? (
                          <>
                            <Spinner /> Generating...
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                            </svg>
                            Generate Reply
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="p-5">
                    {suppressed ? (
                      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Generation Suppressed</p>
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{suppressedReason}</p>
                        </div>
                      </div>
                    ) : replyText ? (
                      <div className="space-y-3">
                        {generationWarning && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                            <svg className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                            <p className="text-xs text-yellow-700 dark:text-yellow-400">{generationWarning}</p>
                          </div>
                        )}
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          rows={8}
                          className="w-full px-4 py-3 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleCopy}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-all ${
                              copied
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
                            }`}
                          >
                            {copied ? (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                                Copied!
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                                </svg>
                                Copy to Clipboard
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleGenerate(null)}
                            disabled={generating}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Regenerate
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Click "Generate Reply" to create an AI-powered response using Claude.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualLinkInput({ value, onChange, onSubmit, loading, error }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="https://www.upwork.com/jobs/~0220..."
          className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
        <button
          onClick={onSubmit}
          disabled={loading || !value.trim()}
          className="flex-shrink-0 px-3 py-2 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {loading ? <Spinner /> : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          )}
          {loading ? "Matching..." : "Match"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
