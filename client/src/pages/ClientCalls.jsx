import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

const STATUS_CONFIG = {
  hot_lead:    { label: "Hot Lead",    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",       icon: "🔥" },
  no_show:     { label: "No Show",     color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: "📅" },
  delivery:    { label: "Delivery",    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",     icon: "🏗" },
  prospect:    { label: "Prospect",    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: "📬" },
  lost:        { label: "Lost",        color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",        icon: "❌" },
  re_engaging: { label: "Re-engaging", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: "🔄" },
};

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "hot_lead", label: "🔥 Hot Leads" },
  { key: "no_show", label: "📅 No Show" },
  { key: "delivery", label: "🏗 Delivery" },
  { key: "prospect", label: "📬 Prospects" },
  { key: "lost", label: "❌ Lost" },
];

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDur(min) {
  if (!min) return "-";
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ────────────────────────────────────────────────────────────
// Copy button
// ────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Draft section inside side panel
// ────────────────────────────────────────────────────────────
function DraftSection({ label, draft, onGenerate, loading }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2">
          {draft && <CopyButton text={draft} />}
          <button
            onClick={onGenerate}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Generating..." : draft ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>
      {draft && (
        <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 max-h-48 overflow-y-auto border border-gray-100 dark:border-gray-700">
          {draft}
        </pre>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Side panel
// ────────────────────────────────────────────────────────────
function SidePanel({ call, onClose, onUpdate }) {
  const [drafting, setDrafting] = useState(null);
  const [researching, setResearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [localCall, setLocalCall] = useState(call);
  const [statusChanging, setStatusChanging] = useState(false);

  useEffect(() => { setLocalCall(call); }, [call]);

  const analysis = localCall.analysis || {};
  const research = localCall.research;
  const isNoShow = localCall.status === "no_show";

  const handleStatusChange = async (newStatus) => {
    setStatusChanging(true);
    try {
      await api.updateClientCallStatus(localCall.id, newStatus);
      const updated = { ...localCall, status: newStatus };
      setLocalCall(updated);
      onUpdate(updated);
    } catch (err) {
      console.error(err);
    } finally {
      setStatusChanging(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await api.analyzeClientCall(localCall.id);
      const updated = { ...localCall, analysis: res.analysis, analyzed_at: res.analyzed_at };
      setLocalCall(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleResearch = async () => {
    setResearching(true);
    try {
      const res = await api.researchClientCall(localCall.id);
      const updated = { ...localCall, research: res.research };
      setLocalCall(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setResearching(false);
    }
  };

  const handleDraftReply = async () => {
    setDrafting("reply");
    try {
      const res = await api.draftClientCallReply(localCall.id);
      const updated = { ...localCall, reply_draft: res.draft };
      setLocalCall(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setDrafting(null);
    }
  };

  const handleDraftFU = async (fuNumber) => {
    setDrafting(`fu${fuNumber}`);
    try {
      const res = await api.draftClientCallFollowUp(localCall.id, fuNumber);
      const key = `fu${fuNumber}_draft`;
      const updated = { ...localCall, [key]: res.draft };
      setLocalCall(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setDrafting(null);
    }
  };

  const handleDraftRebook = async (rebookNumber) => {
    setDrafting(`rebook${rebookNumber}`);
    try {
      const res = await api.draftClientCallRebook(localCall.id, rebookNumber);
      const key = rebookNumber === 1 ? "rebook_draft" : "rebook_fu1_draft";
      const updated = { ...localCall, [key]: res.draft };
      setLocalCall(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setDrafting(null);
    }
  };

  const cfg = STATUS_CONFIG[localCall.status] || STATUS_CONFIG.prospect;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 h-full shadow-2xl overflow-y-auto border-l border-gray-200 dark:border-gray-800"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold truncate">
                {analysis.client_name || localCall.meeting_name}
              </h2>
              {analysis.company && (
                <span className="text-sm text-gray-500 dark:text-gray-400">— {analysis.company}</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
                {cfg.icon} {cfg.label}
              </span>
              <span className="text-xs text-gray-400">{fmtDate(localCall.call_date)} · {fmtDur(localCall.duration)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Status changer */}
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(STATUS_CONFIG).map(([key, s]) => (
                <button
                  key={key}
                  onClick={() => handleStatusChange(key)}
                  disabled={statusChanging || localCall.status === key}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    localCall.status === key
                      ? s.color + " border-transparent font-semibold"
                      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Analysis */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Call Analysis</h3>
              {!isNoShow && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {analyzing ? "Analyzing..." : localCall.analyzed_at ? "Re-analyze" : "Analyze"}
                </button>
              )}
            </div>

            {analysis.summary ? (
              <div className="space-y-3">
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{analysis.summary}</p>
                </div>

                {analysis.promise && (
                  <div className="border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10 rounded-lg p-3">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">What you promised</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.promise}</p>
                  </div>
                )}

                {analysis.open_questions?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Open Questions</p>
                    <ul className="space-y-1">
                      {analysis.open_questions.map((q, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <span className="text-amber-500 mt-0.5 flex-shrink-0">?</span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.signals && (
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.signals.budget_discussed && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Budget discussed</span>}
                    {analysis.signals.asked_for_proposal && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Wants proposal</span>}
                    {analysis.signals.asked_for_examples && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Asked for examples</span>}
                    {analysis.signals.urgency && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Urgent</span>}
                    {analysis.signals.timeline_mentioned && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Timeline set</span>}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                {isNoShow ? "No transcript - client did not attend." : "No analysis yet. Click Analyze to run AI analysis."}
              </p>
            )}
          </div>

          {/* Research */}
          {!isNoShow && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Research</h3>
                <button
                  onClick={handleResearch}
                  disabled={researching}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {researching ? "Researching..." : research ? "Re-run" : "Find Examples"}
                </button>
              </div>

              {research?.examples?.length > 0 ? (
                <div className="space-y-2">
                  {research.examples.slice(0, 3).map((ex, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <a href={ex.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline truncate block">
                          {ex.url}
                        </a>
                        {ex.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ex.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                  No examples yet. Find similar projects to reference in your reply.
                </p>
              )}
            </div>
          )}

          {/* Gmail Thread */}
          {localCall.gmail_thread_id && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Email Thread</h3>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{localCall.gmail_thread_subject || "Email thread"}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {localCall.gmail_email_count} emails · Last: {fmtDate(localCall.gmail_last_email_date)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Drafts */}
          <div className="space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Drafts</h3>

            {isNoShow ? (
              <>
                <DraftSection
                  label="Re-book Email"
                  draft={localCall.rebook_draft}
                  onGenerate={() => handleDraftRebook(1)}
                  loading={drafting === "rebook1"}
                />
                <DraftSection
                  label="Re-book Follow-Up"
                  draft={localCall.rebook_fu1_draft}
                  onGenerate={() => handleDraftRebook(2)}
                  loading={drafting === "rebook2"}
                />
              </>
            ) : (
              <>
                <DraftSection
                  label="Post-Call Reply"
                  draft={localCall.reply_draft}
                  onGenerate={handleDraftReply}
                  loading={drafting === "reply"}
                />
                <DraftSection
                  label="Follow-Up 1 (~100 words)"
                  draft={localCall.fu1_draft}
                  onGenerate={() => handleDraftFU(1)}
                  loading={drafting === "fu1"}
                />
                <DraftSection
                  label="Follow-Up 2 (~80 words)"
                  draft={localCall.fu2_draft}
                  onGenerate={() => handleDraftFU(2)}
                  loading={drafting === "fu2"}
                />
                <DraftSection
                  label="Follow-Up 3 (~60 words)"
                  draft={localCall.fu3_draft}
                  onGenerate={() => handleDraftFU(3)}
                  loading={drafting === "fu3"}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Call card
// ────────────────────────────────────────────────────────────
function CallCard({ call, onClick }) {
  const cfg = STATUS_CONFIG[call.status] || STATUS_CONFIG.prospect;
  const analysis = call.analysis || {};
  const clientName = analysis.client_name || null;
  const company = analysis.company || null;
  const isNoShow = call.status === "no_show";

  const draftCount = [call.reply_draft, call.fu1_draft, call.fu2_draft, call.fu3_draft, call.rebook_draft]
    .filter(Boolean).length;

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-brand-200 dark:hover:border-brand-700 transition-all group"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
            {clientName || call.meeting_name}
          </p>
          {company && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{company}</p>}
          {!company && clientName && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{call.meeting_name}</p>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.color}`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      {/* Promise / no-show note */}
      {analysis.promise && (
        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1 mb-2.5 italic">
          Promised: {analysis.promise}
        </p>
      )}
      {isNoShow && !analysis.promise && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-2.5">Client did not show up</p>
      )}

      {/* Meta row */}
      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>{fmtDate(call.call_date)} · {fmtDur(call.duration)}</span>
        <div className="flex items-center gap-2">
          {call.gmail_email_count > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              {call.gmail_email_count}
            </span>
          )}
          {draftCount > 0 && (
            <span className="bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 px-1.5 py-0.5 rounded-full">
              {draftCount} draft{draftCount > 1 ? "s" : ""}
            </span>
          )}
          {call.analysis?.signals?.urgency && <span title="Urgent">⚡</span>}
          {call.analysis?.signals?.asked_for_proposal && <span title="Wants proposal">📄</span>}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────
export default function ClientCalls() {
  const [calls, setCalls] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (search) params.search = search;
      const data = await api.getClientCalls(params);
      setCalls(data.calls || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { loadCalls(); }, [loadCalls]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.syncClientCalls();
      setSyncResult(result);
      await loadCalls();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleCardUpdate = (updatedCall) => {
    setCalls(prev => prev.map(c => c.id === updatedCall.id ? { ...c, ...updatedCall } : c));
    if (selected?.id === updatedCall.id) {
      setSelected(prev => ({ ...prev, ...updatedCall }));
    }
  };

  // Status counts
  const counts = calls.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold">Client Calls</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {total} calls synced from TLDV
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search clients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
              />
              <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {syncing ? "Syncing..." : "Sync TLDV"}
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                statusFilter === tab.key
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
              }`}
            >
              {tab.label}
              {tab.key !== "all" && counts[tab.key] ? (
                <span className="ml-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                  {counts[tab.key]}
                </span>
              ) : null}
              {tab.key === "all" && total > 0 ? (
                <span className="ml-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                  {total}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="flex-shrink-0 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800 px-6 py-2.5 flex items-center justify-between">
          <p className="text-sm text-green-700 dark:text-green-400">
            Sync complete — {syncResult.total_meetings_from_tldv} fetched from TLDV, {syncResult.client_meetings_filtered} passed filters, {syncResult.new_calls} new calls added, {syncResult.no_shows} no-shows, {syncResult.gmail_threads_matched} Gmail threads matched
          </p>
          <button onClick={() => setSyncResult(null)} className="text-green-500 hover:text-green-700 dark:hover:text-green-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex-shrink-0 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-6 py-2.5 flex items-center justify-between">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </div>
            <p className="text-base font-medium text-gray-700 dark:text-gray-300 mb-1">No calls yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {statusFilter !== "all" ? "No calls with this status." : "Add your TLDV API key in Settings, then click Sync TLDV."}
            </p>
            {statusFilter === "all" && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                Sync TLDV Now
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {calls.map(call => (
              <CallCard
                key={call.id}
                call={call}
                onClick={() => setSelected(call)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Side panel */}
      {selected && (
        <SidePanel
          call={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleCardUpdate}
        />
      )}
    </div>
  );
}
