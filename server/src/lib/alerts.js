import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { getQuoteLite } from "../tools/quote.js";
import { lookupCompany, getRecentFilings } from "../tools/sec.js";
import { technicalSnapshot } from "./indicators.js";
import { getEventData } from "./events.js";
import { notify } from "./notify.js";
import { runAgent } from "./llm.js";
import { enforceOutput } from "./guardrails.js";
import { obj, str } from "../agents/schema.js";

// Smart alerts: price, indicator and event alerts, checked by the scheduled job (lib/jobs.js).
// When one fires, a short AI note explains why it may matter, then the user gets an in-app + push notification.

export const ALERT_TYPES = {
  price_above: { label: "Price rises above", needs: "price", source: "quote" },
  price_below: { label: "Price falls below", needs: "price", source: "quote" },
  rsi_above: { label: "RSI(14) rises above", needs: "rsi", source: "technicals" },
  rsi_below: { label: "RSI(14) falls below", needs: "rsi", source: "technicals" },
  golden_cross: { label: "Golden cross (50-day crosses above 200-day)", source: "technicals" },
  death_cross: { label: "Death cross (50-day crosses below 200-day)", source: "technicals" },
  macd_bullish_cross: { label: "MACD crosses above signal", source: "technicals" },
  macd_bearish_cross: { label: "MACD crosses below signal", source: "technicals" },
  volume_spike: { label: "Volume spike (x 20-day average)", needs: "multiple", source: "technicals" },
  new_filing: { label: "New SEC filing (10-K, 10-Q, 8-K)", source: "filings" },
  earnings_soon: { label: "Earnings in the next 3 days", source: "events" },
  insider_buy: { label: "Insider open-market buy", source: "events" },
};
const MAX_ALERTS = 50;
const REPEAT_COOLDOWN_HOURS = 24;

// ---------- CRUD ----------
export async function listAlerts(userId) {
  if (config.localMode) return localStore.rows("alerts").filter((a) => a.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { data, error } = await supabase().from("alerts").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function createAlert(userId, { ticker, type, threshold, repeat = false }) {
  const spec = ALERT_TYPES[type];
  if (!spec) throw Object.assign(new Error(`Unknown alert type. Use one of: ${Object.keys(ALERT_TYPES).join(", ")}`), { status: 400 });
  const symbol = String(ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw Object.assign(new Error("Enter a valid ticker"), { status: 400 });
  if (spec.needs) {
    const t = Number(threshold);
    const ok = spec.needs === "rsi" ? t > 0 && t < 100 : spec.needs === "multiple" ? t >= 1 : t > 0;
    if (!Number.isFinite(t) || !ok) throw Object.assign(new Error(spec.needs === "rsi" ? "RSI level must be between 0 and 100" : spec.needs === "multiple" ? "Volume multiple must be at least 1" : "Enter a price above 0"), { status: 400 });
  }
  if (spec.source === "filings" || spec.source === "events") {
    if (!(await lookupCompany(symbol))) throw Object.assign(new Error(`${symbol} isn't an SEC-registered company, so filing and insider alerts aren't available`), { status: 400 });
  }
  if ((await listAlerts(userId)).filter((a) => a.active).length >= MAX_ALERTS) throw Object.assign(new Error(`You can have up to ${MAX_ALERTS} active alerts`), { status: 400 });

  // Event alerts start from "now": remember the latest filing so only newer ones fire
  let state = null;
  if (type === "new_filing") {
    const company = await lookupCompany(symbol);
    state = { last_accession: (await getRecentFilings(company.cik, 1)).filings[0]?.accession ?? null };
  }
  const row = { user_id: userId, ticker: symbol, type, threshold: spec.needs ? Number(threshold) : null, repeat: Boolean(repeat), active: true, state };
  if (config.localMode) return localStore.insert("alerts", row);
  const { data, error } = await supabase().from("alerts").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateAlert(userId, id, fields) {
  const allowed = Object.fromEntries(Object.entries(fields).filter(([k]) => ["active", "repeat", "threshold"].includes(k)));
  if (config.localMode) return localStore.update("alerts", (a) => a.id === id && a.user_id === userId, allowed).length > 0;
  const { data, error } = await supabase().from("alerts").update(allowed).eq("id", id).eq("user_id", userId).select("id");
  if (error) throw new Error(error.message);
  return data.length > 0;
}

export async function deleteAlert(userId, id) {
  if (config.localMode) return localStore.remove("alerts", (a) => a.id === id && a.user_id === userId) > 0;
  const { data, error } = await supabase().from("alerts").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) throw new Error(error.message);
  return data.length > 0;
}

// ---------- Evaluation (scheduled job) ----------

/** Returns { fired: bool, detail, state } for one alert given the ticker's market context. */
export function checkAlert(alert, ctx) {
  const { quote, tech, filings, events } = ctx;
  const state = alert.state ?? {};
  const created = alert.created_at.slice(0, 10);
  const newCross = (date) => date && date >= created && date !== state.last_cross;
  switch (alert.type) {
    case "price_above":
      return { fired: quote && quote.price >= alert.threshold, detail: quote && `${alert.ticker} is at $${quote.price}, above your $${alert.threshold} level` };
    case "price_below":
      return { fired: quote && quote.price <= alert.threshold, detail: quote && `${alert.ticker} is at $${quote.price}, below your $${alert.threshold} level` };
    case "rsi_above":
      return { fired: tech && tech.rsi14 >= alert.threshold, detail: tech && `RSI(14) is ${tech.rsi14}, above ${alert.threshold}` };
    case "rsi_below":
      return { fired: tech && tech.rsi14 <= alert.threshold, detail: tech && `RSI(14) is ${tech.rsi14}, below ${alert.threshold}` };
    case "golden_cross":
    case "death_cross":
    case "macd_bullish_cross":
    case "macd_bearish_cross": {
      const key = { golden_cross: "golden", death_cross: "death", macd_bullish_cross: "macd_bullish", macd_bearish_cross: "macd_bearish" }[alert.type];
      const date = tech?.crosses?.[key];
      return { fired: Boolean(newCross(date)), detail: `${ALERT_TYPES[alert.type].label} on ${date}`, state: { ...state, last_cross: date } };
    }
    case "volume_spike":
      return { fired: tech && tech.volume.ratio >= alert.threshold && tech.asOf !== state.last_asof, detail: tech && `Volume was ${tech.volume.ratio}x its 20-day average on ${tech.asOf}`, state: { ...state, last_asof: tech?.asOf } };
    case "new_filing": {
      const latest = filings?.[0];
      return { fired: latest && latest.accession !== state.last_accession, detail: latest && `New ${latest.form} filed ${latest.filingDate}${latest.items ? ` (items ${latest.items})` : ""}`, state: { ...state, last_accession: latest?.accession }, data: latest && { url: latest.url } };
    }
    case "earnings_soon": {
      const next = events?.next_earnings;
      const soon = next && (Date.parse(next.date) - Date.now()) / 86_400_000 <= 3;
      return { fired: soon && state.notified_for !== next.date, detail: next && `${alert.ticker} reports earnings on ${next.date}${next.hour === "bmo" ? " before the open" : next.hour === "amc" ? " after the close" : ""}`, state: { ...state, notified_for: next?.date } };
    }
    case "insider_buy": {
      const buy = events?.insider_trades?.find((t) => t.code === "P" && t.date >= created);
      return { fired: buy && buy.accession !== state.last_accession, detail: buy && `${buy.insider}${buy.title ? ` (${buy.title})` : ""} bought ${buy.shares.toLocaleString()} shares${buy.price ? ` at $${buy.price}` : ""} on ${buy.date}`, state: { ...state, last_accession: buy?.accession } };
    }
    default:
      return { fired: false };
  }
}

const explainSchema = obj({
  title: str("Notification title, max 60 characters, e.g. 'NVDA: RSI drops below 30'"),
  body: str("2-3 sentences: what happened and why traders and investors often pay attention to it. Educational, no advice"),
});

async function explain(alert, detail, ctx) {
  try {
    const tech = ctx.tech && { price: ctx.tech.price, trend: ctx.tech.trend, rsi14: ctx.tech.rsi14, levels: ctx.tech.levels, rating: ctx.tech.rating };
    const out = await runAgent({
      agent: "alert_explainer",
      effort: "low",
      schema: explainSchema,
      system: "You write short alert notifications for a stock research app. Use only the facts given. Explain why the event may matter; never tell the user to buy or sell, and never predict prices.",
      prompt: `Alert: ${ALERT_TYPES[alert.type].label}${alert.threshold != null ? ` ${alert.threshold}` : ""} for ${alert.ticker}\nWhat happened: ${detail}\nContext (JSON): ${JSON.stringify({ quote: ctx.quote, technicals: tech })}`,
    });
    return enforceOutput(out).value;
  } catch {
    return { title: `${alert.ticker}: ${ALERT_TYPES[alert.type].label}`, body: detail };
  }
}

async function activeAlerts() {
  if (config.localMode) return localStore.rows("alerts").filter((a) => a.active);
  const { data, error } = await supabase().from("alerts").select("*").eq("active", true).limit(2000);
  if (error) throw new Error(error.message);
  return data;
}

async function saveAlertState(alert, fields) {
  if (config.localMode) return localStore.update("alerts", (a) => a.id === alert.id, fields);
  await supabase().from("alerts").update(fields).eq("id", alert.id);
}

/** Checks every active alert. Market data is fetched once per ticker. Returns a run summary. */
export async function runAlertChecks() {
  const alerts = await activeAlerts();
  const byTicker = Map.groupBy ? Map.groupBy(alerts, (a) => a.ticker) : alerts.reduce((m, a) => m.set(a.ticker, [...(m.get(a.ticker) ?? []), a]), new Map());
  let fired = 0, errors = 0;

  for (const [ticker, list] of byTicker) {
    const sources = new Set(list.map((a) => ALERT_TYPES[a.type]?.source));
    const ctx = {};
    try {
      if (sources.has("quote")) ctx.quote = await getQuoteLite(ticker);
      if (sources.has("technicals") && pricesEnabled()) {
        const bars = await getDailyBars(ticker);
        ctx.tech = technicalSnapshot(bars);
      }
      if (sources.has("filings")) {
        const company = await lookupCompany(ticker);
        ctx.filings = company ? (await getRecentFilings(company.cik, 3)).filings : [];
      }
      if (sources.has("events")) ctx.events = await getEventData(ticker);
    } catch (err) {
      console.error(`Alert data for ${ticker}:`, err.message);
      errors++;
    }

    for (const alert of list) {
      const cooling = alert.repeat && alert.last_triggered_at && Date.now() - Date.parse(alert.last_triggered_at) < REPEAT_COOLDOWN_HOURS * 3_600_000;
      const result = checkAlert(alert, ctx);
      if (result.fired && !cooling) {
        const note = await explain(alert, result.detail, ctx);
        await notify(alert.user_id, { kind: "alert", ticker, title: note.title, body: note.body, data: { alertId: alert.id, type: alert.type, detail: result.detail, ...result.data } });
        await saveAlertState(alert, { last_triggered_at: new Date().toISOString(), active: alert.repeat, state: result.state ?? alert.state });
        fired++;
      } else if (result.state && JSON.stringify(result.state) !== JSON.stringify(alert.state)) {
        await saveAlertState(alert, { state: result.state });
      }
    }
  }
  return { checked: alerts.length, tickers: byTicker.size, fired, errors };
}
