import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

const SERVICES = [
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
      setTimeout(() => setSuccess(""), 3000);
    } else if (gmailStatus === "error") {
      setError("Failed to connect Gmail account. Please try again.");
      setTimeout(() => setError(""), 5000);
    }
  }, [searchParams]);

  const getKeyForService = (serviceId) => keys.find((k) => k.service === serviceId);

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
      setSuccess(`${serviceId} API key saved successfully`);
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

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage your API keys and integrations
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
        {/* Gmail Accounts Section */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Gmail Accounts</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Connect Gmail accounts to pull unread Upwork emails
              </p>
            </div>
            <button
              onClick={handleConnectGmail}
              disabled={connecting}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {connecting ? <Spinner /> : (
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                  </svg>
                  Connect Gmail
                </span>
              )}
            </button>
          </div>

          {loading ? (
            <div className="p-12 flex justify-center"><Spinner /></div>
          ) : gmailAccounts.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No Gmail accounts connected</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Click "Connect Gmail" to link your account via Google OAuth</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {gmailAccounts.map((account) => (
                <div key={account.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: account.color }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{account.email}</p>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                          ${account.status === "connected"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : account.status === "error"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            account.status === "connected" ? "bg-emerald-500" :
                            account.status === "error" ? "bg-red-500" : "bg-gray-400"
                          }`} />
                          {account.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {account.lastSyncAt
                          ? `Last sync: ${new Date(account.lastSyncAt).toLocaleString()}`
                          : "Never synced"
                        }
                        {account.errorMessage && (
                          <span className="text-red-500 ml-2">{account.errorMessage}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDisconnectGmail(account.id, account.email)}
                    className="btn-danger text-xs px-3 py-1.5"
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* API Keys Section */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold">API Keys</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              All keys are encrypted with AES-256-GCM at rest
            </p>
          </div>

          {loading ? (
            <div className="p-12 flex justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {SERVICES.map((service) => {
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

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
