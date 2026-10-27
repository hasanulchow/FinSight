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
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  // The API rejected the token (expired, revoked, or from another Supabase project): back to login.
  if (res.status === 401 && token) await supabase.auth.signOut();
  // 402 + upgrade: a Free plan limit was hit; screens show an upgrade prompt for these
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, upgrade: !!body.upgrade });
  return body;
}

export const api = {
  createBriefing: (ticker) => request("/briefings", { method: "POST", body: JSON.stringify({ ticker }) }),
  listBriefings: () => request("/briefings"),
  getBriefing: (id) => request(`/briefings/${id}`),
  sendFeedback: (id, rating) => request(`/briefings/${id}/feedback`, { method: "POST", body: JSON.stringify({ rating }) }),

  // Filing Q&A
  ask: (id, question) => request(`/briefings/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  chat: (id) => request(`/briefings/${id}/chat`),

  // Technical analysis, earnings & insiders
  technicals: (ticker, { explain = false, days = 252 } = {}) => request(`/stocks/${encodeURIComponent(ticker)}/technicals?days=${days}${explain ? "&explain=1" : ""}`),
  events: (ticker) => request(`/stocks/${encodeURIComponent(ticker)}/events`),

  // Alerts + notifications
  alertTypes: () => request("/alerts/types"),
  alerts: () => request("/alerts"),
  createAlert: (alert) => request("/alerts", { method: "POST", body: JSON.stringify(alert) }),
  updateAlert: (id, fields) => request(`/alerts/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deleteAlert: (id) => request(`/alerts/${id}`, { method: "DELETE" }),
  notifications: () => request("/notifications"),
  markRead: (id = "all") => request(`/notifications/${id}/read`, { method: "POST" }),
  registerPush: (token, platform) => request("/push/register", { method: "POST", body: JSON.stringify({ token, platform }) }),

  // Screener
  screen: (query) => request("/screener", { method: "POST", body: JSON.stringify({ query }) }),

  // Portfolio
  holdings: () => request("/portfolio"),
  importCsv: (csv, mode = "merge") => request("/portfolio/import", { method: "POST", body: JSON.stringify({ csv, mode }) }),
  addHolding: (holding) => request("/portfolio/holdings", { method: "POST", body: JSON.stringify(holding) }),
  deleteHolding: (id) => request(`/portfolio/holdings/${id}`, { method: "DELETE" }),
  xray: ({ analysis = true } = {}) => request(`/portfolio/xray${analysis ? "" : "?analysis=0"}`),

  // Options
  options: (ticker, { expiration, explain = false } = {}) => {
    const qs = [expiration && `expiration=${expiration}`, explain && "explain=1"].filter(Boolean).join("&");
    return request(`/stocks/${encodeURIComponent(ticker)}/options${qs ? `?${qs}` : ""}`);
  },
  optionStrategy: (ticker, { strategy, expiration, explain = false }) =>
    request(`/stocks/${encodeURIComponent(ticker)}/options/strategy`, { method: "POST", body: JSON.stringify({ strategy, expiration, explain }) }),
  optionStrategies: () => request("/options/strategies"),

  // Backtesting
  backtestStrategies: () => request("/backtest/strategies"),
  backtest: (ticker, { strategy, params, cost_bps }) => request(`/stocks/${encodeURIComponent(ticker)}/backtest`, { method: "POST", body: JSON.stringify({ strategy, params, cost_bps }) }),

  // Markets
  market: () => request("/market/overview"),
  compare: (tickers, days = 252) => request(`/market/compare?tickers=${encodeURIComponent(tickers.join(","))}&days=${days}`),

  // Copilot agent
  copilotChat: (message, conversationId) => request("/copilot/chat", { method: "POST", body: JSON.stringify({ message, conversation_id: conversationId }) }),
  copilotConversations: () => request("/copilot/conversations"),
  copilotMessages: (id) => request(`/copilot/conversations/${id}`),
  copilotAction: (id, decision) => request(`/copilot/actions/${id}/${decision}`, { method: "POST" }),

  // Trade journal
  journal: () => request("/journal"),
  addTrade: (trade) => request("/journal/trades", { method: "POST", body: JSON.stringify(trade) }),
  updateTrade: (id, fields) => request(`/journal/trades/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deleteTrade: (id) => request(`/journal/trades/${id}`, { method: "DELETE" }),
  importTrades: (csv) => request("/journal/import", { method: "POST", body: JSON.stringify({ csv }) }),
  journalCoach: () => request("/journal/coach", { method: "POST" }),

  // Risk tools
  positionSize: (input) => request("/risk/position-size", { method: "POST", body: JSON.stringify(input) }),
  benchmark: (days = 252) => request(`/portfolio/benchmark?days=${days}`),
  redFlags: (ticker) => request(`/stocks/${encodeURIComponent(ticker)}/redflags`),

  // Plans and billing
  plans: () => request("/plans"),
  account: () => request("/account"),
  checkout: (returnUrl) => request("/billing/checkout", { method: "POST", body: JSON.stringify({ return_url: returnUrl }) }),
  billingPortal: (returnUrl) => request("/billing/portal", { method: "POST", body: JSON.stringify({ return_url: returnUrl }) }),

  // Account, onboarding, referrals
  settings: () => request("/settings"),
  updateSettings: (fields) => request("/settings", { method: "PATCH", body: JSON.stringify(fields) }),
  onboarding: (data) => request("/onboarding", { method: "POST", body: JSON.stringify(data) }),
  referrals: () => request("/referrals"),
  deleteAccount: () => request("/account", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }),
  track: (event, properties) => request("/events", { method: "POST", body: JSON.stringify({ event, properties }) }).catch(() => {}),

  // Watchlist + thesis tracker, morning brief
  watchlist: () => request("/watchlist"),
  addWatch: (ticker, thesis) => request("/watchlist", { method: "POST", body: JSON.stringify({ ticker, thesis }) }),
  updateWatch: (id, thesis) => request(`/watchlist/${id}`, { method: "PATCH", body: JSON.stringify({ thesis }) }),
  deleteWatch: (id) => request(`/watchlist/${id}`, { method: "DELETE" }),
  checkThesis: (id) => request(`/watchlist/${id}/check`, { method: "POST" }),
  brief: () => request("/brief"),
  generateBrief: () => request("/brief/generate", { method: "POST" }),

  // Automations (scheduled Copilot tasks)
  automations: () => request("/automations"),
  createAutomation: (task) => request("/automations", { method: "POST", body: JSON.stringify(task) }),
  updateAutomation: (id, fields) => request(`/automations/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deleteAutomation: (id) => request(`/automations/${id}`, { method: "DELETE" }),
  runAutomation: (id) => request(`/automations/${id}/run`, { method: "POST" }),

  // Trading rules, option P/L, tax
  rules: () => request("/rules"),
  saveRules: (rules) => request("/rules", { method: "PUT", body: JSON.stringify({ rules }) }),
  precheck: (trade) => request("/journal/precheck", { method: "POST", body: JSON.stringify(trade) }),
  optionPnl: (input) => request("/options/pnl-explain", { method: "POST", body: JSON.stringify(input) }),
  tax: (year) => request(`/tax/summary${year ? `?year=${year}` : ""}`),

  // Broker sync
  broker: () => request("/broker"),
  brokerConnect: (returnUrl) => request("/broker/connect", { method: "POST", body: JSON.stringify({ return_url: returnUrl }) }),
  brokerSync: () => request("/broker/sync", { method: "POST" }),
  brokerDisconnect: () => request("/broker", { method: "DELETE" }),

  // Sharing (the public read needs no session)
  shareBriefing: (id) => request(`/briefings/${id}/share`, { method: "POST" }),
  shareJournal: () => request("/journal/share", { method: "POST" }),
  publicShare: (token) => send(`/share/${encodeURIComponent(token)}`, {}),

  // Admin
  adminMetrics: () => request("/admin/metrics"),
};
