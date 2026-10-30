import WebSocket, { WebSocketServer } from "ws";
import { config, LOCAL_USER } from "../config.js";
import { supabase } from "./supabase.js";
import { getQuoteLite } from "../tools/quote.js";

// Live prices. One upstream WebSocket to Finnhub's real-time US trade feed, shared by every user;
// the app connects to /stream on this server and subscribes to the symbols on screen. Prices are
// batched and pushed twice a second. The practice engine and bots read the latest price from here too.
//
// Finnhub's free tier streams a limited number of symbols per connection (STREAM_MAX_SYMBOLS, 50).
// Serverless hosts (Vercel) can't hold WebSockets; there the app falls back to polling.

const MAX_SYMBOLS = Number(process.env.STREAM_MAX_SYMBOLS || 50);
const MAX_PER_CLIENT = 40;
const FLUSH_MS = 500;
const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const prices = new Map(); // symbol -> { p, t, v }
const clientRefs = new Map(); // symbol -> number of app connections watching it
const internalUntil = new Map(); // symbol -> expiry ms (bots and the practice engine keep these warm)
const upstreamSubs = new Set();
const dirty = new Set();
const clients = new Set();
let upstream = null, upstreamOpen = false, retryMs = 2000, started = false;

const finnhubKey = () => process.env.FINNHUB_API_KEY || null;
export const streamEnabled = () => Boolean(finnhubKey()) && !process.env.VERCEL;

// ---------- Upstream (Finnhub) ----------
function connectUpstream() {
  if (!streamEnabled() || upstream) return;
  upstream = new WebSocket(`wss://ws.finnhub.io?token=${finnhubKey()}`);
  upstream.on("open", () => {
    upstreamOpen = true;
    retryMs = 2000;
    upstreamSubs.clear();
    syncSubscriptions();
  });
  upstream.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== "trade" || !Array.isArray(msg.data)) return;
    for (const tr of msg.data) {
      const prev = prices.get(tr.s);
      if (!prev || tr.t >= prev.t) {
        prices.set(tr.s, { p: tr.p, t: tr.t, v: (prev?.v ?? 0) + (tr.v ?? 0) });
        dirty.add(tr.s);
      }
    }
  });
  const reconnect = () => {
    upstream = null;
    upstreamOpen = false;
    setTimeout(connectUpstream, retryMs).unref();
    retryMs = Math.min(retryMs * 2, 60_000);
  };
  upstream.on("close", reconnect);
  upstream.on("error", (err) => {
    console.error("Price stream:", err.message);
    upstream?.terminate();
  });
}

const wanted = () => {
  const now = Date.now();
  const set = new Set([...clientRefs.entries()].filter(([, n]) => n > 0).map(([s]) => s));
  for (const [s, until] of internalUntil) if (until > now) set.add(s);
  return [...set].slice(0, MAX_SYMBOLS);
};

function syncSubscriptions() {
  if (!upstreamOpen) return;
  const want = new Set(wanted());
  for (const s of want) if (!upstreamSubs.has(s)) {
    upstream.send(JSON.stringify({ type: "subscribe", symbol: s }));
    upstreamSubs.add(s);
  }
  for (const s of [...upstreamSubs]) if (!want.has(s)) {
    upstream.send(JSON.stringify({ type: "unsubscribe", symbol: s }));
    upstreamSubs.delete(s);
  }
}

// ---------- Server-side reads ----------
/** Latest streamed price if it is at most `maxAgeMs` old, else null. */
export function livePrice(symbol, maxAgeMs = 15_000) {
  const x = prices.get(String(symbol).toUpperCase());
  return x && Date.now() - x.t <= maxAgeMs ? x.p : null;
}

/** Keeps symbols streaming for a while even with no app watching (bots watching a flag, open orders). */
export function keepWarm(symbols, ms = 15 * 60_000) {
  if (!streamEnabled()) return;
  const until = Date.now() + ms;
  for (const s of symbols) if (SYM.test(s)) internalUntil.set(s, Math.max(internalUntil.get(s) ?? 0, until));
  connectUpstream();
  syncSubscriptions();
}

/** REST quote with the price replaced by the live trade price when one is fresh. */
export async function withLivePrice(ticker) {
  const q = await getQuoteLite(ticker);
  const p = livePrice(ticker);
  return p != null ? { ...q, price: p, change: q.previousClose ? p - q.previousClose : q.change, changePercent: q.previousClose ? ((p - q.previousClose) / q.previousClose) * 100 : q.changePercent, live: true } : q;
}

export function streamStatus() {
  return { enabled: streamEnabled(), upstream_connected: upstreamOpen, symbols: upstreamSubs.size, max_symbols: MAX_SYMBOLS, clients: clients.size };
}

// ---------- App connections ----------
async function authenticate(req) {
  if (config.localMode) return LOCAL_USER;
  const token = new URL(req.url, "http://x").searchParams.get("token");
  if (!token) return null;
  const { data } = await supabase().auth.getUser(token).catch(() => ({ data: null }));
  return data?.user ?? null;
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Seeds symbols that haven't traded yet (or the market is closed) with a REST quote. */
async function seed(ws, symbols) {
  const out = {};
  await Promise.all(symbols.map(async (s) => {
    const live = prices.get(s);
    if (live) out[s] = { p: live.p, t: live.t, live: true };
    else {
      const q = await getQuoteLite(s).catch(() => null);
      if (q?.price) out[s] = { p: q.price, t: Date.now(), live: false, pc: q.previousClose };
    }
  }));
  if (Object.keys(out).length) send(ws, { type: "prices", data: out });
}

/** Attaches the /stream WebSocket endpoint to the HTTP server (long-running hosts only). */
export function attachStream(server) {
  if (started || process.env.VERCEL) return;
  started = true;
  const wss = new WebSocketServer({ server, path: "/stream", maxPayload: 16 * 1024 });

  wss.on("connection", async (ws, req) => {
    const user = await authenticate(req);
    if (!user) return ws.close(4401, "Sign in again");
    ws.user = user;
    ws.symbols = new Set();
    ws.alive = true;
    clients.add(ws);
    send(ws, { type: "hello", enabled: streamEnabled(), max_symbols: MAX_PER_CLIENT });
    if (streamEnabled()) connectUpstream();

    ws.on("pong", () => (ws.alive = true));
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const list = (Array.isArray(msg.symbols) ? msg.symbols : []).map((x) => String(x).toUpperCase()).filter((x) => SYM.test(x));
      if (msg.type === "subscribe") {
        const added = [];
        for (const s of list) {
          if (ws.symbols.has(s) || ws.symbols.size >= MAX_PER_CLIENT) continue;
          ws.symbols.add(s);
          clientRefs.set(s, (clientRefs.get(s) ?? 0) + 1);
          added.push(s);
        }
        syncSubscriptions();
        seed(ws, added);
      } else if (msg.type === "unsubscribe") {
        for (const s of list) if (ws.symbols.delete(s)) clientRefs.set(s, Math.max(0, (clientRefs.get(s) ?? 1) - 1));
        syncSubscriptions();
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
      for (const s of ws.symbols) clientRefs.set(s, Math.max(0, (clientRefs.get(s) ?? 1) - 1));
      syncSubscriptions();
    });
  });

  // Push batched updates; drop dead connections; let idle internal subscriptions expire
  setInterval(() => {
    if (!dirty.size) return;
    const changed = [...dirty];
    dirty.clear();
    for (const ws of clients) {
      const data = {};
      for (const s of changed) if (ws.symbols.has(s)) data[s] = { ...prices.get(s), live: true };
      if (Object.keys(data).length) send(ws, { type: "prices", data });
    }
  }, FLUSH_MS).unref();
  setInterval(() => {
    for (const ws of clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [s, until] of internalUntil) if (until < now) internalUntil.delete(s);
    syncSubscriptions();
  }, 30_000).unref();
}
