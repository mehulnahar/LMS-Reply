import { useEffect, useState } from "react";
import { api } from "../api";
import Layout from "../components/Layout";

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
    placeholder: "lh-...",
  },
];

export default function Settings() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchKeys = async () => {
    try {
      const data = await api.getKeys();
      setKeys(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchKeys(); }, []);

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

  return (
    <Layout>
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
    </Layout>
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
