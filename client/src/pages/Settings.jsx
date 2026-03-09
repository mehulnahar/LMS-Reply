import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

/* ================================================================
   Constants
   ================================================================ */
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
  {
    id: "exa",
    name: "Exa",
    description: "AI-powered search for discovering similar live projects",
    icon: "E",
    placeholder: "0ac44f98-...",
  },
  {
    id: "olostep",
    name: "Olostep",
    description: "Web scraping to verify and extract content from discovered sites",
    icon: "O",
    placeholder: "your-olostep-api-key",
  },
];

const GOOGLE_CREDS = [
  {
    id: "google_client_id",
    label: "Client ID",
    placeholder: "123456789-xxxxx.apps.googleusercontent.com",
  },
  {
    id: "google_client_secret",
    label: "Client Secret",
    placeholder: "GOCSPX-...",
  },
];

/* ================================================================
   Validation helpers
   ================================================================ */
function validateGoogleCredential(serviceId, value) {
  if (!value.trim()) return null;
  if (serviceId === "google_client_id") {
    // Format: {numbers}-{alphanum}.apps.googleusercontent.com
    if (!value.includes(".apps.googleusercontent.com")) {
      return "Doesn't look like a Google Client ID — expected format: 123456789-xxx.apps.googleusercontent.com";
    }
  }
  if (serviceId === "google_client_secret") {
    // Format: GOCSPX-{alphanum}
    if (!value.startsWith("GOCSPX-")) {
      return "Doesn't look like a Google Client Secret — expected format: GOCSPX-...";
    }
  }
  return null;
}

/** Try to extract client_id and client_secret from a pasted JSON blob */
function tryParseGoogleJson(text) {
  try {
    const obj = JSON.parse(text);
    // Google Cloud JSON download shape: { web: { client_id, client_secret } }
    const inner = obj.web || obj.installed || obj;
    if (inner.client_id && inner.client_secret) {
      return { clientId: inner.client_id, clientSecret: inner.client_secret };
    }
  } catch {
    // not JSON
  }
  return null;
}

/* ================================================================
   Main component
   ================================================================ */
export default function Settings() {
  const [searchParams] = useSearchParams();

  // Data
  const [keys, setKeys] = useState([]);
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasLabel, setAliasLabel] = useState('');
  const [aliasAdding, setAliasAdding] = useState(false);
  const [aliasRemoving, setAliasRemoving] = useState(null);
  const [aliasDetecting, setAliasDetecting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editingService, setEditingService] = useState(null);
  const [keyInput, setKeyInput] = useState("");
  const [inputWarning, setInputWarning] = useState("");

  // Action states
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);

  // Confirmation dialog for disconnect
  const [disconnectDialog, setDisconnectDialog] = useState(null); // { id, email, emailCount, replyCount }

  // Confirmation dialog for credential change
  const [credChangeWarning, setCredChangeWarning] = useState(null); // { serviceId, label }

  // JSON paste detection
  const [jsonDetected, setJsonDetected] = useState(null); // { clientId, clientSecret }

  // Notifications
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Timers ref for cleanup
  const timerRef = useRef(null);

  const clearNotifications = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setError("");
    setSuccess("");
  }, []);

  const showSuccess = useCallback((msg, duration = 4000) => {
    setError("");
    setSuccess(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSuccess(""), duration);
  }, []);

  const showError = useCallback((msg, duration = 6000) => {
    setSuccess("");
    setError(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setError(""), duration);
  }, []);

  /* ============================================================
     Data fetching
     ============================================================ */
  const fetchKeys = useCallback(async () => {
    try {
      const data = await api.getKeys();
      setKeys(data);
    } catch {
      // ignore — keys section will just show "Add"
    }
  }, []);

  const fetchGmailAccounts = useCallback(async () => {
    try {
      const data = await api.getGmailAccounts();
      setGmailAccounts(data);
      return data;
    } catch {
      // ignore
      return [];
    }
  }, []);

  const fetchAliases = useCallback(async () => {
    try {
      const data = await api.getEmailAliases();
      setAliases(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchKeys(), fetchGmailAccounts(), fetchAliases()]).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Gmail OAuth callback redirect — auto-sync new account
  useEffect(() => {
    const gmailStatus = searchParams.get("gmail");
    if (gmailStatus === "connected") {
      showSuccess("Gmail account connected! Syncing emails…");
      // Fetch accounts, find the new one (never synced), and auto-sync it
      fetchGmailAccounts().then((accounts) => {
        const newAccount = (accounts || []).find((a) => !a.lastSyncAt && a.status === "connected");
        if (newAccount) {
          handleSyncAccount(newAccount.id, newAccount.email);
        }
      });
    } else if (gmailStatus === "error") {
      showError("Failed to connect Gmail. Check your Google OAuth credentials and try again.");
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ============================================================
     Derived state
     ============================================================ */
  const getKeyForService = (serviceId) => keys.find((k) => k.service === serviceId);
  const hasGoogleCreds = !!(getKeyForService("google_client_id") && getKeyForService("google_client_secret"));
  const connectedAccounts = gmailAccounts.filter((a) => a.status === "connected");
  const errorAccounts = gmailAccounts.filter((a) => a.status === "error");
  const hasAnyAccounts = gmailAccounts.length > 0;

  // Detect decryption errors (masked key shows gibberish or error indicator)
  const hasDecryptionError = (maskedKey) => {
    if (!maskedKey) return true;
    if (maskedKey.includes("[error]") || maskedKey.includes("[decrypt")) return true;
    return false;
  };

  /* Step 2 badge logic:
     - green: all accounts connected, at least 1 account
     - amber: some accounts have errors
     - brand/blue: has creds, ready to connect (0 accounts)
     - gray: no creds yet */
  const step2BadgeColor = gmailAccounts.length > 0
    ? errorAccounts.length > 0
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : hasGoogleCreds
    ? "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
    : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500";

  /* ============================================================
     Handlers
     ============================================================ */

  /** Open edit mode for a credential — with connected-account warning */
  const startEditing = (serviceId, label) => {
    // If changing Google creds while accounts are connected, warn first
    if (
      (serviceId === "google_client_id" || serviceId === "google_client_secret") &&
      getKeyForService(serviceId) &&
      hasAnyAccounts
    ) {
      setCredChangeWarning({ serviceId, label });
      return;
    }
    setEditingService(serviceId);
    setKeyInput("");
    setInputWarning("");
    setJsonDetected(null);
    clearNotifications();
  };

  /** Confirm credential change despite connected accounts */
  const confirmCredChange = () => {
    if (credChangeWarning) {
      setEditingService(credChangeWarning.serviceId);
      setKeyInput("");
      setInputWarning("");
      setJsonDetected(null);
      setCredChangeWarning(null);
      clearNotifications();
    }
  };

  /** Cancel edit mode */
  const cancelEditing = () => {
    setEditingService(null);
    setKeyInput("");
    setInputWarning("");
    setJsonDetected(null);
  };

  /** Handle input change with validation + JSON detection */
  const handleInputChange = (serviceId, value) => {
    setKeyInput(value);

    // Check for JSON paste (only when editing Google creds)
    if (serviceId === "google_client_id" || serviceId === "google_client_secret") {
      const parsed = tryParseGoogleJson(value);
      if (parsed) {
        setJsonDetected(parsed);
        setInputWarning("");
        return;
      }
      setJsonDetected(null);

      // Validate format
      const warning = validateGoogleCredential(serviceId, value);
      setInputWarning(warning || "");
    } else {
      setInputWarning("");
      setJsonDetected(null);
    }
  };

  /** Apply both values from detected JSON */
  const applyJsonCredentials = async () => {
    if (!jsonDetected) return;
    setSaving(true);
    clearNotifications();
    try {
      // Save client ID
      const existingId = getKeyForService("google_client_id");
      if (existingId) {
        await api.updateKey("google_client_id", jsonDetected.clientId);
      } else {
        await api.addKey("google_client_id", jsonDetected.clientId);
      }
      // Save client secret
      const existingSec = getKeyForService("google_client_secret");
      if (existingSec) {
        await api.updateKey("google_client_secret", jsonDetected.clientSecret);
      } else {
        await api.addKey("google_client_secret", jsonDetected.clientSecret);
      }
      showSuccess("Both Google Client ID and Secret saved from JSON");
      cancelEditing();
      await fetchKeys();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /** Save a single credential */
  const handleSave = async (serviceId) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    clearNotifications();
    try {
      const existing = getKeyForService(serviceId);
      if (existing) {
        await api.updateKey(serviceId, keyInput.trim());
      } else {
        await api.addKey(serviceId, keyInput.trim());
      }
      const label = GOOGLE_CREDS.find((c) => c.id === serviceId)?.label
        || API_SERVICES.find((s) => s.id === serviceId)?.name
        || serviceId;
      showSuccess(`${label} saved successfully`);
      cancelEditing();
      await fetchKeys();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (serviceId) => {
    clearNotifications();
    try {
      await api.deleteKey(serviceId);
      const label = API_SERVICES.find((s) => s.id === serviceId)?.name || serviceId;
      showSuccess(`${label} API key removed`);
      await fetchKeys();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleVerify = async (serviceId) => {
    clearNotifications();
    try {
      const result = await api.verifyKey(serviceId);
      if (result.status === "verified") {
        showSuccess(`${serviceId} key verified — encryption intact`);
      } else {
        showError(`${serviceId} key verification failed`);
      }
    } catch (err) {
      showError(err.message);
    }
  };

  const handleConnectGmail = async () => {
    setConnecting(true);
    clearNotifications();
    try {
      const data = await api.getGmailAuthUrl();
      window.location.href = data.url;
    } catch (err) {
      showError(err.message);
      setConnecting(false);
    }
  };

  /** Open disconnect confirmation dialog */
  const openDisconnectDialog = (account) => {
    setDisconnectDialog({
      id: account.id,
      email: account.email,
      emailCount: account.emailCount || 0,
      replyCount: account.replyCount || 0,
    });
  };

  /** Actually disconnect after confirmation */
  const confirmDisconnect = async () => {
    if (!disconnectDialog) return;
    setDisconnecting(disconnectDialog.id);
    clearNotifications();
    try {
      await api.disconnectGmail(disconnectDialog.id);
      showSuccess(`Disconnected ${disconnectDialog.email}`);
      setDisconnectDialog(null);
      await fetchGmailAccounts();
    } catch (err) {
      showError(err.message);
    } finally {
      setDisconnecting(null);
    }
  };

  const handleSyncAccount = async (id, email) => {
    setSyncing(id);
    clearNotifications();
    try {
      const result = await api.syncGmailAccount(id);
      showSuccess(`${email}: ${result.message}`);
      await fetchGmailAccounts();
    } catch (err) {
      showError(`Sync failed for ${email}: ${err.message}`);
    } finally {
      setSyncing(null);
    }
  };

  /* ============================================================
     Alias handlers
     ============================================================ */
  const handleAddAlias = async (e) => {
    e.preventDefault();
    if (!aliasInput.trim()) return;
    setAliasAdding(true);
    try {
      await api.addEmailAlias(aliasInput.trim(), aliasLabel.trim() || null);
      setAliasInput('');
      setAliasLabel('');
      await fetchAliases();
      showSuccess('Alias added');
    } catch (err) {
      showError(err.message || 'Failed to add alias');
    } finally {
      setAliasAdding(false);
    }
  };

  const handleDetectAliases = async () => {
    setAliasDetecting(true);
    try {
      const result = await api.detectAliases();
      setAliases(result.aliases);
      if (result.detected > 0) {
        showSuccess(`Detected ${result.detected} new alias${result.detected === 1 ? '' : 'es'} (${result.total} total)`);
      } else {
        showSuccess(`No new aliases found. ${result.total} already saved.`);
      }
    } catch (err) {
      showError(err.message || 'Alias detection failed');
    } finally {
      setAliasDetecting(false);
    }
  };

  const handleRemoveAlias = async (id) => {
    setAliasRemoving(id);
    try {
      await api.deleteEmailAlias(id);
      await fetchAliases();
    } catch (err) {
      showError(err.message || 'Failed to remove alias');
    } finally {
      setAliasRemoving(null);
    }
  };

  /* ============================================================
     Render
     ============================================================ */
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage your API keys, Gmail connections, and integrations
        </p>
      </div>

      {/* ================================================================ */}
      {/* Global Notifications                                             */}
      {/* ================================================================ */}
      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-6 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2">
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{success}</p>
        </div>
      )}

      <div className="space-y-6">

        {/* ================================================================ */}
        {/* Gmail Integration — Unified 2-step card                         */}
        {/* ================================================================ */}
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
              {/* ──────────────────────────────────────────────── */}
              {/* Step 1: Google OAuth Credentials                 */}
              {/* ──────────────────────────────────────────────── */}
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

                {/* Credential rows */}
                <div className="ml-10 space-y-3">
                  {GOOGLE_CREDS.map((cred) => {
                    const existing = getKeyForService(cred.id);
                    const isEditing = editingService === cred.id;
                    const decryptError = existing && hasDecryptionError(existing.maskedKey);

                    return (
                      <div key={cred.id}>
                        <div className="flex items-center gap-3">
                          <div className="w-28 flex-shrink-0">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{cred.label}</span>
                          </div>

                          {isEditing ? (
                            <div className="flex-1 space-y-2">
                              {/* JSON detection banner */}
                              {jsonDetected && (
                                <div className="p-2.5 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                                  <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">
                                    Google Cloud JSON detected!
                                  </p>
                                  <p className="text-[11px] text-blue-600 dark:text-blue-400/80">
                                    Found both Client ID and Client Secret. Save them together?
                                  </p>
                                  <div className="flex gap-2 mt-2">
                                    <button
                                      onClick={applyJsonCredentials}
                                      disabled={saving}
                                      className="btn-primary text-xs px-3 py-1"
                                    >
                                      {saving ? <Spinner /> : "Save Both"}
                                    </button>
                                    <button
                                      onClick={() => { setJsonDetected(null); setKeyInput(""); }}
                                      className="btn-secondary text-xs px-2.5 py-1"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}

                              {!jsonDetected && (
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={keyInput}
                                    onChange={(e) => handleInputChange(cred.id, e.target.value)}
                                    className={`input-field flex-1 font-mono text-xs ${inputWarning ? "border-amber-400 dark:border-amber-600" : ""}`}
                                    placeholder={cred.placeholder}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !inputWarning) handleSave(cred.id);
                                      if (e.key === "Escape") cancelEditing();
                                    }}
                                  />
                                  <button
                                    onClick={() => handleSave(cred.id)}
                                    disabled={saving || !keyInput.trim()}
                                    className="btn-primary text-xs px-3 py-1.5"
                                  >
                                    {saving ? <Spinner /> : "Save"}
                                  </button>
                                  <button
                                    onClick={cancelEditing}
                                    className="btn-secondary text-xs px-2.5 py-1.5"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}

                              {/* Format warning */}
                              {inputWarning && !jsonDetected && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                  </svg>
                                  {inputWarning}
                                </p>
                              )}
                            </div>
                          ) : existing ? (
                            <div className="flex items-center gap-2 flex-1">
                              {decryptError ? (
                                <>
                                  <span className="text-xs text-red-500 dark:text-red-400 italic">
                                    Decryption error — please re-enter
                                  </span>
                                  <button
                                    onClick={() => startEditing(cred.id, cred.label)}
                                    className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium"
                                  >
                                    Re-enter
                                  </button>
                                </>
                              ) : (
                                <>
                                  <code className="text-xs font-mono text-gray-400 dark:text-gray-500">{existing.maskedKey}</code>
                                  <button
                                    onClick={() => startEditing(cred.id, cred.label)}
                                    className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                                  >
                                    Change
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => startEditing(cred.id, cred.label)}
                              className="btn-primary text-xs px-3 py-1.5"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ──────────────────────────────────────────────── */}
              {/* Step 2: Connected Gmail Accounts                 */}
              {/* ──────────────────────────────────────────────── */}
              <div className="px-6 py-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${step2BadgeColor}`}>
                      2
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        Connected Gmail Accounts
                        {gmailAccounts.length > 0 && (
                          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
                            {connectedAccounts.length} of {gmailAccounts.length} connected
                            {errorAccounts.length > 0 && (
                              <span className="text-amber-500 ml-1">
                                ({errorAccounts.length} with errors)
                              </span>
                            )}
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
                    title={!hasGoogleCreds ? "Add Google OAuth credentials first" : "Connect a new Gmail account"}
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
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Click &quot;Connect Gmail&quot; to authorize your first account</p>
                  </div>
                ) : (
                  <div className="ml-10 space-y-2">
                    {gmailAccounts.map((account) => {
                      const isSyncing = syncing === account.id;
                      const isDisconnecting = disconnecting === account.id;

                      return (
                        <div
                          key={account.id}
                          className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
                            account.status === "error"
                              ? "bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50"
                              : "bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700/50"
                          }`}
                        >
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
                                {account.emailCount > 0 && (
                                  <span className="text-gray-400 dark:text-gray-500 ml-2">
                                    {account.emailCount} email{account.emailCount !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </p>
                              {account.status === "error" && account.errorMessage && (
                                <p className="text-[11px] text-red-500 dark:text-red-400 mt-1 truncate">
                                  {account.errorMessage}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleSyncAccount(account.id, account.email)}
                              disabled={isSyncing || isDisconnecting}
                              className="btn-secondary text-xs px-2.5 py-1"
                              title="Sync now"
                            >
                              {isSyncing ? <Spinner /> : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
                                </svg>
                              )}
                            </button>
                            <button
                              onClick={() => openDisconnectDialog(account)}
                              disabled={isSyncing || isDisconnecting}
                              className="btn-danger text-xs px-2.5 py-1"
                              title="Disconnect"
                            >
                              {isDisconnecting ? <Spinner /> : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ================================================================ */}
        {/* Email Aliases Section                                            */}
        {/* ================================================================ */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              Outreach Email Aliases
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Auto-detected from synced emails. These are your outreach identities — the AI excludes them from CC detection so it never greets you as a third party.
            </p>
          </div>
          <div className="px-6 py-5 space-y-3">
            {/* Detect button */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Scans your last 10 inbox + 10 sent Upwork emails to detect outreach aliases automatically.
              </p>
              <button
                onClick={handleDetectAliases}
                disabled={aliasDetecting}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
              >
                {aliasDetecting ? (
                  <><Spinner /> Detecting…</>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    Detect from Gmail
                  </>
                )}
              </button>
            </div>

            {/* Alias list */}
            {aliases.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic px-1">No aliases detected yet. Click &quot;Detect from Gmail&quot; to scan.</p>
            ) : (
              <ul className="space-y-1.5">
                {aliases.map(alias => (
                  <li key={alias.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50">
                    <div className="min-w-0 flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{alias.alias_email}</p>
                      {alias.label && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0">{alias.label}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveAlias(alias.id)}
                      disabled={aliasRemoving === alias.id}
                      className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40"
                      title="Remove alias"
                    >
                      {aliasRemoving === alias.id ? (
                        <Spinner />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* API Keys Section                                                 */}
        {/* ================================================================ */}
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
                            onClick={() => { setEditingService(service.id); setKeyInput(""); setInputWarning(""); clearNotifications(); }}
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
                              if (e.key === "Escape") cancelEditing();
                            }}
                          />
                          <button
                            onClick={() => handleSave(service.id)}
                            disabled={saving || !keyInput.trim()}
                            className="btn-primary text-xs px-4 py-2"
                          >
                            {saving ? <Spinner /> : "Save"}
                          </button>
                          <button onClick={cancelEditing} className="btn-secondary text-xs px-3 py-2">
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

        {/* ================================================================ */}
        {/* Reply Editor Section                                             */}
        {/* ================================================================ */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Reply Editor
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Configure how AI-generated replies are handled in the editor
            </p>
          </div>
          <div className="px-6 py-5">
            <BannedPhraseModeSettings />
          </div>
        </div>

        {/* ================================================================ */}
        {/* Tools Section                                                    */}
        {/* ================================================================ */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.654-4.654m5.664-1.329c0 .513-.119 1.008-.337 1.45L17.25 21" />
              </svg>
              Tools
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Maintenance actions for your inbox data
            </p>
          </div>
          <div className="px-6 py-5">
            <ReanalyzeButton />
          </div>
        </div>

      {/* ================================================================ */}
      {/* Disconnect Confirmation Dialog (modal overlay)                    */}
      {/* ================================================================ */}
      {disconnectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !disconnecting && setDisconnectDialog(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-md w-full p-6">
            {/* Warning icon */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold">Disconnect {disconnectDialog.email}?</h3>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                This will permanently remove the account and <strong>delete all associated data</strong>:
              </p>
              <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-3 space-y-1.5">
                {disconnectDialog.emailCount > 0 && (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75" />
                    </svg>
                    <strong>{disconnectDialog.emailCount}</strong> synced email{disconnectDialog.emailCount !== 1 ? "s" : ""} will be deleted
                  </p>
                )}
                {disconnectDialog.replyCount > 0 && (
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    <strong>{disconnectDialog.replyCount}</strong> generated repl{disconnectDialog.replyCount !== 1 ? "ies" : "y"} will be deleted
                  </p>
                )}
                {disconnectDialog.emailCount === 0 && disconnectDialog.replyCount === 0 && (
                  <p className="text-sm text-red-700 dark:text-red-400">
                    OAuth tokens and account settings will be removed.
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You can reconnect this Gmail account later, but deleted data cannot be recovered.
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDisconnectDialog(null)}
                disabled={!!disconnecting}
                className="btn-secondary text-sm px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmDisconnect}
                disabled={!!disconnecting}
                className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {disconnecting ? (
                  <span className="flex items-center gap-2"><Spinner /> Disconnecting...</span>
                ) : (
                  "Disconnect"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Credential Change Warning Dialog                                  */}
      {/* ================================================================ */}
      {credChangeWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCredChangeWarning(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold">Change {credChangeWarning.label}?</h3>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                You have <strong>{gmailAccounts.length} Gmail account{gmailAccounts.length !== 1 ? "s" : ""}</strong> connected.
                Changing your Google OAuth credentials may <strong>invalidate existing tokens</strong> and require reconnecting.
              </p>
              <div className="bg-amber-50 dark:bg-amber-900/10 rounded-lg p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Connected accounts may stop syncing until you reconnect them with the new credentials.
                </p>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setCredChangeWarning(null)} className="btn-secondary text-sm px-4 py-2">
                Cancel
              </button>
              <button onClick={confirmCredChange} className="btn-primary text-sm px-4 py-2">
                Change Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================
   Helper components
   ================================================================ */
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

function BannedPhraseModeSettings() {
  const [mode, setMode] = useState(
    () => localStorage.getItem('bannedPhraseMode') || 'auto_rewrite'
  );
  const [bannedPhraseCount, setBannedPhraseCount] = useState(null);

  useEffect(() => {
    api.getBannedPhraseStats()
      .then((data) => setBannedPhraseCount(data.count))
      .catch(() => {});
  }, []);

  const handleChange = (newMode) => {
    setMode(newMode);
    localStorage.setItem('bannedPhraseMode', newMode);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Banned Phrase Mode</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        <strong>Auto-rewrite:</strong> AI rewrites flagged phrases automatically.{' '}
        <strong>Flag:</strong> phrases are highlighted red and must be manually edited before copy.
      </p>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="bannedPhraseMode"
            value="auto_rewrite"
            checked={mode === 'auto_rewrite'}
            onChange={() => handleChange('auto_rewrite')}
            className="text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm">Auto-rewrite</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="bannedPhraseMode"
            value="flag"
            checked={mode === 'flag'}
            onChange={() => handleChange('flag')}
            className="text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm">Flag</span>
        </label>
      </div>
      {bannedPhraseCount !== null && (
        <div className="text-xs text-gray-500 mt-2">
          Banned phrases caught this week: <span className="font-semibold text-gray-700 dark:text-gray-300">{bannedPhraseCount}</span>
        </div>
      )}
    </div>
  );
}

function ReanalyzeButton() {
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [result, setResult] = useState(null);

  const handleRun = async () => {
    setStatus("running");
    setResult(null);
    try {
      const data = await api.reanalyzeEmails();
      setResult(data);
      setStatus("done");
    } catch (err) {
      setResult({ error: err.message });
      setStatus("error");
    }
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold">Re-analyze All Emails</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Run AI analysis on all emails to backfill lead scores, intent, and summary. Required after first setup.
        </p>
        {status === "done" && result && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
            ✓ Done — {result.analyzed ?? result.updated ?? "?"} emails analyzed
          </p>
        )}
        {status === "error" && (
          <p className="text-xs text-red-500 mt-2">{result?.error || "Re-analysis failed"}</p>
        )}
      </div>
      <button
        onClick={handleRun}
        disabled={status === "running"}
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {status === "running" ? <><Spinner /> Running...</> : "Re-analyze All"}
      </button>
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
