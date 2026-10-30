import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { localMode, supabase } from "./supabase";

// Live prices from the server's /stream WebSocket: one shared connection, reference-counted symbols.
// Screens call useLivePrices([...]) and get { prices, status }. When streaming isn't available
// (e.g. a serverless host), status is "off" and screens keep their normal polling.

const API_URL = process.env.EXPO_PUBLIC_API_URL || "";
const listeners = new Set(); // (prices, status) => void
const refs = new Map(); // symbol -> count
const prices = {}; // symbol -> { p, t, live, pc }
let ws = null, status = "idle", failures = 0, retryTimer = null;

function streamUrl(token) {
  const base = API_URL || (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return null;
  return `${base.replace(/^http/, "ws")}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

const emit = () => listeners.forEach((fn) => fn(prices, status));
const setStatus = (s) => {
  status = s;
  emit();
};

async function connect() {
  if (ws || status === "off") return;
  let token = null;
  if (!localMode) token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
  const url = streamUrl(token);
  if (!url || (!localMode && !token)) return setStatus("off");
  setStatus("connecting");
  try {
    ws = new WebSocket(url);
  } catch {
    ws = null;
    return setStatus("off");
  }
  ws.onopen = () => {
    failures = 0;
    const symbols = [...refs.keys()];
    if (symbols.length) ws.send(JSON.stringify({ type: "subscribe", symbols }));
  };
  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "hello") return setStatus(msg.enabled ? "live" : "quotes");
    if (msg.type === "prices") {
      // Merge per symbol so the previous close from the first quote survives live trade updates
      for (const [s, v] of Object.entries(msg.data)) prices[s] = { ...prices[s], ...v };
      emit();
    }
  };
  ws.onclose = (e) => {
    ws = null;
    failures++;
    // Auth failures and hosts without streaming: stop after a few tries; otherwise reconnect with backoff
    if (e?.code === 4401 || failures >= 4) return setStatus("off");
    setStatus("connecting");
    clearTimeout(retryTimer);
    if (refs.size) retryTimer = setTimeout(connect, Math.min(30_000, 1500 * 2 ** failures));
  };
}

function subscribe(symbols) {
  const added = [];
  for (const s of symbols) {
    refs.set(s, (refs.get(s) ?? 0) + 1);
    if (refs.get(s) === 1) added.push(s);
  }
  if (!ws) connect();
  else if (added.length && ws.readyState === 1) ws.send(JSON.stringify({ type: "subscribe", symbols: added }));
  return () => {
    const removed = [];
    for (const s of symbols) {
      const n = (refs.get(s) ?? 1) - 1;
      if (n <= 0) {
        refs.delete(s);
        removed.push(s);
      } else refs.set(s, n);
    }
    if (removed.length && ws?.readyState === 1) ws.send(JSON.stringify({ type: "unsubscribe", symbols: removed }));
  };
}

/** Live prices for `symbols`: { prices: { AAPL: { p, t, live, pc } }, status: "connecting" | "live" | "quotes" | "off" }. */
export function useLivePrices(symbols) {
  const key = [...new Set((symbols ?? []).filter(Boolean).map((s) => String(s).toUpperCase()))].sort().join(",");
  const [state, setState] = useState({ prices: {}, status });
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!key) return undefined;
    const list = key.split(",");
    const pick = (all, st) => setState({ prices: Object.fromEntries(list.filter((s) => all[s]).map((s) => [s, all[s]])), status: st });
    const fn = (all, st) => pick(all, st);
    listeners.add(fn);
    pick(prices, status);
    const unsubscribe = subscribe(list);
    return () => {
      listeners.delete(fn);
      unsubscribe();
    };
  }, [key]);
  return state;
}

/** Live price for one symbol, falling back to `fallback` (e.g. the last REST quote). */
export const priceOf = (live, symbol, fallback) => live.prices[symbol]?.p ?? fallback;
