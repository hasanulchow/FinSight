import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { lookupCompany, getInsiderTransactions, getLatestEarningsRelease } from "../tools/sec.js";
import { getEarningsCalendar, getEarningsSurprises } from "../tools/quote.js";
import { eventsAnalyst } from "../agents/eventsAnalyst.js";
import { enforceOutput } from "./guardrails.js";

// Earnings & smart money: earnings calendar + EPS surprises (Finnhub), latest earnings release (8-K 2.02),
// insider trades (SEC Form 4) and an AI summary. Cached per ticker for 12 hours and shared by all users.
// Note: institutional (13F) holdings need a paid data source and aren't included.

const CACHE_HOURS = 12;
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Aggregates open-market insider trades (P = buy, S = sell) over the last `days`. */
export function insiderStats(transactions, days = 90) {
  const since = day(-days);
  const recent = transactions.filter((t) => t.date && t.date >= since);
  const buys = recent.filter((t) => t.code === "P");
  const sells = recent.filter((t) => t.code === "S");
  const sum = (xs, k) => xs.reduce((s, t) => s + (t[k] ?? 0), 0);
  return {
    window_days: days,
    open_market_buys: buys.length,
    open_market_sells: sells.length,
    shares_bought: sum(buys, "shares"),
    shares_sold: sum(sells, "shares"),
    value_bought: sum(buys, "value"),
    value_sold: sum(sells, "value"),
    other_transactions: recent.length - buys.length - sells.length, // grants, exercises, tax withholding, gifts
    insiders_buying: [...new Set(buys.map((t) => t.insider))],
    insiders_selling: [...new Set(sells.map((t) => t.insider))],
  };
}

async function readCache(ticker) {
  if (config.localMode) return localStore.rows("stock_events_cache").find((r) => r.ticker === ticker) ?? null;
  const { data } = await supabase().from("stock_events_cache").select("data, fetched_at").eq("ticker", ticker).maybeSingle();
  return data;
}

async function writeCache(ticker, data) {
  const row = { ticker, data, fetched_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("stock_events_cache", "ticker", row);
  await supabase().from("stock_events_cache").upsert(row, { onConflict: "ticker" });
}

/** Raw event data without the AI summary (used by alerts, which only need facts). */
export async function getEventData(ticker) {
  const company = await lookupCompany(ticker);
  if (!company) throw Object.assign(new Error(`Unknown ticker "${ticker}"`), { status: 404 });
  const [calendar, surprises, insiders] = await Promise.all([
    getEarningsCalendar({ from: day(-1), to: day(90), ticker: company.ticker }).catch(() => []),
    getEarningsSurprises(company.ticker).catch(() => []),
    getInsiderTransactions(company.cik).catch(() => []),
  ]);
  return {
    company,
    next_earnings: calendar.filter((e) => e.date >= day()).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    surprises,
    insider_stats: insiderStats(insiders),
    insider_trades: insiders.slice(0, 25),
  };
}

/** Full earnings & insider view with AI summary, cached 12h. */
export async function getStockEvents(ticker, { refresh = false } = {}) {
  const symbol = ticker.toUpperCase();
  const cached = await readCache(symbol);
  if (!refresh && cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_HOURS * 3_600_000) return cached.data;

  const data = await getEventData(symbol);
  const release = await getLatestEarningsRelease(data.company.cik).catch(() => null);
  const summary = await eventsAnalyst({ company: data.company, events: { ...data, release } });
  const result = {
    ...data,
    latest_release: release ? { filingDate: release.filingDate, url: release.url } : null,
    summary: enforceOutput(summary).value,
    updated_at: new Date().toISOString(),
  };
  await writeCache(symbol, result);
  return result;
}
