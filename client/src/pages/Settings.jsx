import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

const API_SERVICES = [
  {
    id: "anthropic",
    name: "Anthropic (Claude AI)",
    description: "Powers AI reply generation using Claude Sonnet & Haiku",
    icon: "A",
    placeholder: "sk-ant-api03-...",
  },
  {
    id: "leadhack",
    name: "LeadHack",
    description: "Job data enrichment and matching via leadhack.info API",
    icon: "L",
    placeholder: "email:password or auth token",
  },
];

export default function Settings() {
  const [searchParams] = useSearchParams();
  const [keys, setKeys] = useState([]);
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchKeys = async () => {
    try {
      const data = await api.getKeys();
      setKeys(data);
    } catch {
      // ignore
    }
  };

  const fetchGmailAccounts = async () => {
    try {
      const data = await api.getGmailAccounts();
      setGmailAccounts(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    Promise.all([fetchKeys(), fetchGmailAccounts()]).finally(() => setLoading(false));
  }, []);

  // Handle Gmail OAuth callback redirect
  useEffect(() => {
    const gmailStatus = searchParams.get("gmail");
    if (gmailStatus === "connected") {
      setSuccess("Gmail account connected successfully!");
      fetchGmailAccounts();
      setTimeout(() => setSuccess(""), 4000);
    } else if (gmailStatus === "error") {
      setError("Failed to connect Gmail account. Check your Google OAuth credentials and try again.");
      setTimeout(() => setError(""), 6000);
    }
  }, [searchParams]);

  const getKeyForService = (serviceId) => keys.find((k) => k.service === serviceId);
  const hasGoogleCreds = getKeyForService("google_client_id") && getKeyForService("google_client_secret");

  const handleSave = async (serviceId) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const existing = getKeyForService(serviceId);
      if (existing) {
        await api.updateKey(serviceId, keyInput.trim());
      } else {
        await api.addKey(serviceId, keyInput.trim());
      }
      const label = serviceId === "google_client_id" ? "Google Client ID"
        : serviceId === "google_client_secret" ? "Google Client Secret"
        : serviceId;
      setSuccess(`${label} saved successfully`);
      setEditingService(null);
      setKeyInput("");
      await fetchKeys();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (serviceId) => {
    setError("");
    setSuccess("");
    try {
      await api.deleteKey(serviceId);
      setSuccess(`${serviceId} API key removed`);
      await fetchKeys();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleVerify = async (serviceId) => {
    setError("");
    setSuccess("");
    try {
      const result = await api.verifyKey(serviceId);
      if (result.status === "verified") {
        setSuccess(`${serviceId} key verified — encryption intact`);
      } else {
        setError(`${serviceId} key verification failed`);
      }
      setTimeout(() => { setSuccess(""); setError(""); }, 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConnectGmail = async () => {
    setConnecting(true);
    setError("");
    try {
      const data = await api.getGmailAuthUrl();
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  };

  const handleDisconnectGmail = async (id, email) => {
    setError("");
    setSuccess("");
    try {
      await api.disconnectGmail(id);
      setSuccess(`Disconnected ${email}`);
      await fetchGmailAccounts();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSyncAccount = async (id, email) => {
    setSyncing(id);
    setError("");
    setSuccess("");
    try {
      const result = await api.syncGmailAccount(id);
      setSuccess(`${email}: ${result.message}`);
      await fetchGmailAccounts();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      setError(`Sync failed for ${email}: ${err.message}`);
    } finally {
      setSyncing(null);
    }
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage your API keys, Gmail connections, and integrations
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-6 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{success}</p>
        </div>
      )}

      <div className="space-y-6">

        {/* ============================================================ */}
        {/* Gmail Integration — Unified 2-step card                      */}
        {/* ============================================================ */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Gmail Integration
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Connect multiple Gmail accounts to pull unread Upwork emails into your inbox
            </p>
          </div>

          {loading ? (
            <div className="p-12 flex justify-center"><Spinner /></div>
          ) : (
            <>
              {/* Step 1: Google OAuth Credentials */}
              <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800/50">
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    hasGoogleCreds
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                  }`}>1</div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      Google OAuth Credentials
                      {hasGoogleCreds && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <span className="w-1 h-1 rounded-full bg-emerald-500" /> Configured
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      One Google Cloud project handles <strong>all</strong> your Gmail accounts.
                      Create OAuth 2.0 credentials at{" "}
                      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">
                        Google Cloud Console
                      </a>
                    </p>
                    <div className="mt-2 p-2.5 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        <strong>Redirect URI</strong> (add this in Google Cloud Console):
                      </p>
                      <code className="text-[11px] text-brand-600 dark:text-brand-400 font-mono break-all">
                        {window.location.origin}/api/gmail/callback
                      </code>
                    </div>
                  </div>
                </div>

                {/* Google Client ID */}
                <div className="ml-10 space-y-3">
                  {[
                    { id: "google_client_id", label: "Client ID", placeholder: "123456789-xxxxx.apps.googleusercontent.com" },
                    { id: "google_client_secret", label: "Client Secret", placeholder: "GOCSPX-..." },
                  ].map((cred) => {
                    const existing = getKeyForService(cred.id);
                    const isEditing = editingService === cred.id;
                    return (
                      <div key={cred.id} className="flex items-center gap-3">
                        <div className="w-28 flex-shrink-0">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{cred.label}</span>
                        </div>
                        {isEditing ? (
                          <div className="flex gap-2 flex-1">
                            <input
                              type="text" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                              className="input-field flex-1 font-mono text-xs" placeholder={cred.placeholder} autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSave(cred.id);
                                if (e.key === "Escape") { setEditingService(null); setKeyInput(""); }
                              }}
                            />
                            <button onClick={() => handleSave(cred.id)} disabled={saving || !keyInput.trim()}
                              className="btn-primary text-xs px-3 py-1.5">{saving ? <Spinner /> : "Save"}</button>
                            <button onClick={() => { setEditingService(null); setKeyInput(""); }}
                              className="btn-secondary text-xs px-2.5 py-1.5">Cancel</button>
                          </div>
                        ) : existing ? (
                          <div className="flex items-center gap-2 flex-1">
                            <code className="text-xs font-mono text-gray-400 dark:text-gray-500">{existing.maskedKey}</code>
                            <button onClick={() => { setEditingService(cred.id); setKeyInput(""); setError(""); }}
                              className="text-xs text-brand-600 dark:text-brand-400 hover:underline">Change</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingService(cred.id); setKeyInput(""); setError(""); }}
                            className="btn-primary text-xs px-3 py-1.5">Add</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Connected Gmail Accounts */}
              <div className="px-6 py-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      gmailAccounts.length > 0
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : hasGoogleCreds
                        ? "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                        : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                    }`}>2</div>
                    <div>
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        Connected Gmail Accounts
                        {gmailAccounts.length > 0 && (
                          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
                            {gmailAccounts.length} account{gmailAccounts.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Each Gmail is authorized via the same Google OAuth credentials above.
                        Connect as many accounts as you need.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleConnectGmail}
                    disabled={connecting || !hasGoogleCreds}
                    className="btn-primary text-xs px-3 py-1.5 flex-shrink-0"
                    title={!hasGoogleCreds ? "Add Google OAuth credentials first" : ""}
                  >
                    {connecting ? <Spinner /> : (
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                        </svg>
                        Connect Gmail
                      </span>
                    )}
                  </button>
                </div>

                {!hasGoogleCreds ? (
                  <div className="ml-10 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Complete Step 1 first — add your Google Client ID and Client Secret above to enable Gmail connections.
                    </p>
                  </div>
                ) : gmailAccounts.length === 0 ? (
                  <div className="ml-10 p-6 rounded-lg bg-gray-50 dark:bg-gray-800/30 border border-dashed border-gray-300 dark:border-gray-700 text-center">
                    <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No Gmail accounts connected yet</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Click "Connect Gmail" to authorize your first account</p>
                  </div>
                ) : (
                  <div className="ml-10 space-y-2">
                    {gmailAccounts.map((account) => (
                      <div key={account.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700/50">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-900"
                            style={{ backgroundColor: account.color }}
                            title={`Color: ${account.color}`}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{account.email}</p>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0
                                ${account.status === "connected"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : account.status === "error"
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                                }`}
                              >
                                <span className={`w-1 h-1 rounded-full ${
                                  account.status === "connected" ? "bg-emerald-500" :
                                  account.status === "error" ? "bg-red-500" : "bg-gray-400"
                                }`} />
                                {account.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                              {account.lastSyncAt
                                ? `Synced ${timeAgo(new Date(account.lastSyncAt))}`
                                : "Never synced"}
                              {account.errorMessage && (
                                <span className="text-red-500 ml-2">{account.errorMessage}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => handleSyncAccount(account.id, account.email)}
                            disabled={syncing === account.id}
                            className="btn-secondary text-xs px-2.5 py-1"
                            title="Sync now"
                          >
                            {syncing === account.id ? <Spinner /> : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => handleDisconnectGmail(account.id, account.email)}
                            className="btn-danger text-xs px-2.5 py-1"
                            title="Disconnect"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ============================================================ */}
        {/* API Keys Section                                             */}
        {/* ============================================================ */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
              API Keys
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              All keys are encrypted with AES-256-GCM at rest
            </p>
          </div>

          {loading ? (
            <div className="p-12 flex justify-center"><Spinner /></div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {API_SERVICES.map((service) => {
                const existing = getKeyForService(service.id);
                const isEditing = editingService === service.id;

                return (
                  <div key={service.id} className="px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0
                          ${existing
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {service.icon}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold">{service.name}</h3>
                            {existing && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Connected
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {service.description}
                          </p>
                          {existing && !isEditing && (
                            <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-2">
                              {existing.maskedKey}
                            </p>
                          )}
                        </div>
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {existing && (
                            <>
                              <button onClick={() => handleVerify(service.id)} className="btn-secondary text-xs px-3 py-1.5">
                                Verify
                              </button>
                              <button onClick={() => handleDelete(service.id)} className="btn-danger text-xs px-3 py-1.5">
                                Remove
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => { setEditingService(service.id); setKeyInput(""); setError(""); }}
                            className="btn-primary text-xs px-3 py-1.5"
                          >
                            {existing ? "Update" : "Add Key"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Inline Edit */}
                    {isEditing && (
                      <div className="mt-4 ml-14">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            className="input-field flex-1 font-mono text-xs"
                            placeholder={service.placeholder}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSave(service.id);
                              if (e.key === "Escape") { setEditingService(null); setKeyInput(""); }
                            }}
                          />
                          <button
                            onClick={() => handleSave(service.id)}
                            disabled={saving || !keyInput.trim()}
                            className="btn-primary text-xs px-4 py-2"
                          >
                            {saving ? <Spinner /> : "Save"}
                          </button>
                          <button
                            onClick={() => { setEditingService(null); setKeyInput(""); }}
                            className="btn-secondary text-xs px-3 py-2"
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                          Press Enter to save, Escape to cancel
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
