import { localMode, supabase } from "./supabase";

// Empty = same origin: the web build is served by the API itself (see server/src/index.js).
// Native builds must set EXPO_PUBLIC_API_URL.
const API_URL = process.env.EXPO_PUBLIC_API_URL || "";

async function request(path, options = {}) {
  // Local mode: no session; the local server skips auth.
  if (localMode) return send(path, options);

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    await supabase.auth.signOut();
    throw new Error("Your session has ended. Please sign in again.");
  }
  return send(path, options, token);
}

async function send(path, options, token) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }), ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  // The API rejected the token (expired, revoked, or from another Supabase project): back to login.
  if (res.status === 401 && token) await supabase.auth.signOut();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  createBriefing: (ticker) => request("/briefings", { method: "POST", body: JSON.stringify({ ticker }) }),
  listBriefings: () => request("/briefings"),
  getBriefing: (id) => request(`/briefings/${id}`),
  sendFeedback: (id, rating) => request(`/briefings/${id}/feedback`, { method: "POST", body: JSON.stringify({ rating }) }),
};
