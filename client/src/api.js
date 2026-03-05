const API_BASE = import.meta.env.VITE_API_URL || "";

async function request(path, options = {}) {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  // Auth
  signup: (email, password) =>
    request("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  me: () => request("/api/auth/me"),

  // API Keys
  getKeys: () => request("/api/settings/api-keys"),
  addKey: (service, apiKey) =>
    request("/api/settings/api-keys", { method: "POST", body: JSON.stringify({ service, apiKey }) }),
  updateKey: (service, apiKey) =>
    request(`/api/settings/api-keys/${service}`, { method: "PUT", body: JSON.stringify({ apiKey }) }),
  deleteKey: (service) =>
    request(`/api/settings/api-keys/${service}`, { method: "DELETE" }),
  verifyKey: (service) =>
    request(`/api/settings/api-keys/${service}/verify`, { method: "POST" }),

  // Gmail Accounts
  getGmailAuthUrl: () => request("/api/gmail/auth-url"),
  getGmailAccounts: () => request("/api/gmail/accounts"),
  disconnectGmail: (id) => request(`/api/gmail/accounts/${id}`, { method: "DELETE" }),
  syncGmailAccount: (id) => request(`/api/gmail/accounts/${id}/sync`, { method: "POST" }),

  // Emails
  getEmails: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/emails${qs ? `?${qs}` : ""}`);
  },
  getEmail: (id) => request(`/api/emails/${id}`),
  updateEmailStatus: (id, status) =>
    request(`/api/emails/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  markEmailRead: (id) =>
    request(`/api/emails/${id}/read`, { method: "PUT" }),
  syncAllEmails: () => request("/api/emails/sync-all", { method: "POST" }),
  reanalyzeEmails: () => request("/api/emails/reanalyze", { method: "POST" }),

  // Jobs
  matchJob: (emailId) => request(`/api/jobs/match/${emailId}`, { method: "POST" }),
  matchJobByLink: (emailId, link) =>
    request(`/api/jobs/match-by-link/${emailId}`, { method: "POST", body: JSON.stringify({ link }) }),

  // Replies
  generateReply: (emailId, options = {}) =>
    request('/api/replies/generate', {
      method: 'POST',
      body: JSON.stringify({
        emailId,
        tone: options.tone || 'professional',
        promptOverride: options.promptOverride || null,
        source: options.source || null,
      }),
    }),
  markReplyCopied: (id) => request(`/api/replies/${id}/copied`, { method: "PUT" }),
  recordVariantSelected: (replyId, variant) =>
    request(`/api/replies/${replyId}/variant`, { method: "PUT", body: JSON.stringify({ variant }) }),

  // MOCKUP-05: Mark mockup as sent (set mockup_sent=true on job)
  markMockupSent: (jobId) =>
    request(`/api/jobs/${jobId}/mockup-sent`, { method: "PUT" }),

  // Timezone (Claude Haiku powered)
  getTimezone: (city, country) => {
    const qs = new URLSearchParams({ city: city || "", country: country || "" }).toString();
    return request(`/api/timezone?${qs}`);
  },

  // THREAD-07: Increment email open count (manual hot signal tracking)
  incrementOpenCount: (emailId) =>
    request(`/api/emails/${emailId}/open-count`, { method: "POST" }),

  // THREAD-03: Toggle client_requested_proposal flag on job (post-call recap mode)
  togglePostCallRecap: (jobId, clientRequestedProposal) =>
    request(`/api/jobs/${jobId}/client-proposal-toggle`, {
      method: "PUT",
      body: JSON.stringify({ clientRequestedProposal }),
    }),

  // THREAD-09: Fetch next steps for a job
  getNextSteps: (jobId) =>
    request(`/api/jobs/${jobId}/next-steps`),

  // Health
  health: () => request("/api/health"),
};
