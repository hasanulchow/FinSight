import { config } from "../config.js";
import { supabase } from "../lib/supabase.js";
import { localStore } from "../lib/localStore.js";

// Daily OHLCV bars from Massive (formerly Polygon.io). Bars are cached per ticker in `price_bars`
// (shared by every user) because the free tier allows only ~5 calls per minute.

const CACHE_HOURS = 6;
const HISTORY_DAYS = 730; // 2 years: enough for the 200-day average and 52-week range

export const pricesEnabled = () => Boolean(config.pricesKey);

// Simple per-process rate limiter: spaces calls to stay under PRICES_RPM
let nextSlot = 0;
async function throttle() {
  const gap = 60_000 / config.pricesRpm;
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Math.max(Date.now(), nextSlot) + gap;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/**
 * GET a Massive endpoint (path with query string), rate-limited and shared by stocks, options and market data.
 * Errors carry .status: 403 = not included in the plan, 429 = rate limit.
 */
export async function massiveGet(path) {
  if (!pricesEnabled()) throw Object.assign(new Error("Market data needs MASSIVE_API_KEY (or POLYGON_API_KEY) on the server."), { status: 503 });
  await throttle();
  const res = await fetch(`${config.pricesBaseUrl}${path}${path.includes("?") ? "&" : "?"}apiKey=${config.pricesKey}`);
  if (res.status === 429) throw Object.assign(new Error("Market data rate limit reached. Try again in a minute."), { status: 429 });
  if (res.status === 403) throw Object.assign(new Error("This data isn't included in the current Massive plan."), { status: 403 });
  if (!res.ok) throw Object.assign(new Error(`Market data request failed (${res.status})`), { status: 502 });
  return res.json();
}

async function fetchBars(ticker) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const body = await massiveGet(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50000`);
  return (body.results ?? []).map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
}

async function readCache(ticker) {
  if (config.localMode) return localStore.rows("price_bars").find((r) => r.ticker === ticker) ?? null;
  const { data } = await supabase().from("price_bars").select("bars, fetched_at").eq("ticker", ticker).maybeSingle();
  return data;
}

async function writeCache(ticker, bars) {
  const row = { ticker, bars, fetched_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("price_bars", "ticker", row);
  const { error } = await supabase().from("price_bars").upsert(row, { onConflict: "ticker" });
  if (error) console.error("price_bars upsert failed:", error.message);
}

/** Daily bars for the last ~2 years, oldest first. Served from cache when fresh. */
export async function getDailyBars(ticker, { maxAgeHours = CACHE_HOURS } = {}) {
  const symbol = ticker.toUpperCase();
  const cached = await readCache(symbol);
  if (cached?.bars?.length && Date.now() - Date.parse(cached.fetched_at) < maxAgeHours * 3_600_000) return cached.bars;
  try {
    const bars = await fetchBars(symbol);
    if (bars.length) await writeCache(symbol, bars);
    return bars;
  } catch (err) {
    if (cached?.bars?.length) return cached.bars; // stale beats nothing when rate-limited
    throw err;
  }
}
