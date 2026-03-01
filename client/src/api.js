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

  // Health
  health: () => request("/api/health"),
};
