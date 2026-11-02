import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { db } from "./db.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { withLivePrice } from "./stream.js";
import { getOptionsOverview } from "./options.js";
import { historicalVol, probAbove } from "./optionsMath.js";
import { notify } from "./notify.js";
import { track } from "./analytics.js";

// Forecasts: a play-money prediction game on where stocks close.
//  - Questions are binary: "Will NVDA close above $210 on Fri Nov 7?" Shared by everyone. The weekly set is
//    created automatically for popular tickers; users can add their own (capped per day).
//  - Market odds: the options market's risk-neutral probability of closing above the strike (Black-Scholes
//    N(d2) at the implied volatility for that expiration), or the same model at recent historical
//    volatility when no option prices are available. Recomputed from the live price on every read.
//  - Users give a probability (1 to 99%). Forecasts lock at the open on the resolution day.
//  - Scoring: Brier score (p − outcome)², points = 100 − 400 × Brier, so 50% scores 0, a confident right
//    call up to +100 and a confident wrong one down to −300. Each forecast also stores the market odds at the
//    time, so users can see whether they beat the market.
// No real money, no prizes: points only.

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
export const AUTO_TICKERS = (process.env.FORECAST_TICKERS || "SPY,QQQ,AAPL,NVDA,TSLA,MSFT,AMZN,META,GOOGL,AMD").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const USER_QUESTIONS_PER_DAY = 5;
const MIN_RANKED = 5; // resolved forecasts needed to appear on the leaderboard

// ---------- Dates (US Eastern, holidays not modeled) ----------
/** Today's date and minutes since midnight in New York. */
export function etNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The Friday questions created today resolve on: this Friday if at least two sessions remain, else next Friday. */
export function targetFriday(today = etNow().date) {
  const d = weekday(today);
  const toFri = (5 - d + 7) % 7;
  return toFri >= 2 ? addDays(today, toFri) : addDays(today, toFri + 7);
}

/** Forecasts lock at the 9:30 open on the resolution day. */
export function isLocked(q, now = etNow()) {
  return q.status !== "open" || now.date > q.resolve_date || (now.date === q.resolve_date && now.minutes >= 570);
}

/** Years until the 4pm close on the resolution day. */
export function yearsUntil(resolveDate, now = new Date()) {
  const close = Date.parse(`${resolveDate}T20:00:00Z`); // 4pm ET within an hour (DST), fine for odds
  return Math.max((close - now.getTime()) / (365 * 86_400_000), 1 / (365 * 24));
}

/** A round strike near a price: $1 steps under $50, $5 under $200, $10 under $1,000, else $50. */
export function niceStep(price) {
  return price < 50 ? 1 : price < 200 ? 5 : price < 1000 ? 10 : 50;
}

/**
 * Three strikes for a weekly question set: near the price and about 0.6 expected moves either side, so
 * the market odds land near 50%, 25% and 75% (interesting questions, not sure things). Strikes are
 * rounded to the largest of $1/2/5/10/20/50 that fits the move.
 */
export function weeklyStrikes(price, sigma, T) {
  const move = price * sigma * Math.sqrt(T);
  const step = [50, 20, 10, 5, 2, 1, 0.5].find((s) => s <= Math.max(move * 0.4, 0.5)) ?? 0.5;
  const at = (x) => Number((Math.round(x / step) * step).toFixed(2));
  return [...new Set([at(price), at(price + 0.6 * move), at(price - 0.6 * move)])];
}

// ---------- Scoring (pure) ----------
export const brier = (prob, outcome) => (prob - (outcome ? 1 : 0)) ** 2;
export const points = (prob, outcome) => Math.round(100 - 400 * brier(prob, outcome));

/** Calibration buckets: for each 10% band of forecasts, the average forecast vs how often it happened. */
export function calibration(rows) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, n: 0, sum: 0, yes: 0 }));
  for (const r of rows) {
    const b = buckets[Math.min(9, Math.floor(r.prob * 10))];
    b.n++;
    b.sum += r.prob;
    if (r.outcome) b.yes++;
  }
  return buckets.map((b) => ({ from: b.from, to: b.to, n: b.n, avg_forecast: b.n ? round((b.sum / b.n) * 100, 1) : null, happened: b.n ? round((b.yes / b.n) * 100, 1) : null }));
}

/** Summary of resolved forecasts: points, Brier, accuracy and how often the user beat the market odds. */
export function summarize(rows) {
  const n = rows.length;
  if (!n) return { resolved: 0, points: 0, brier: null, market_brier: null, accuracy: null, beat_market_pct: null };
  const withMarket = rows.filter((r) => r.market_prob != null);
  return {
    resolved: n,
    points: rows.reduce((s, r) => s + points(r.prob, r.outcome), 0),
    brier: round(rows.reduce((s, r) => s + brier(r.prob, r.outcome), 0) / n, 3),
    market_brier: withMarket.length ? round(withMarket.reduce((s, r) => s + brier(r.market_prob, r.outcome), 0) / withMarket.length, 3) : null,
    accuracy: round((rows.filter((r) => r.prob !== 0.5 && r.prob > 0.5 === !!r.outcome).length / n) * 100, 1),
    beat_market_pct: withMarket.length ? round((withMarket.filter((r) => brier(r.prob, r.outcome) < brier(r.market_prob, r.outcome)).length / withMarket.length) * 100, 1) : null,
  };
}

// ---------- Questions storage (shared rows, not per user) ----------
async function listQuestions({ status, ticker, since } = {}) {
  if (config.localMode) {
    return localStore.rows("forecast_questions").filter((q) => (!status || q.status === status) && (!ticker || q.ticker === ticker) && (!since || q.resolve_date >= since));
  }
  let q = supabase().from("forecast_questions").select("*");
  if (status) q = q.eq("status", status);
  if (ticker) q = q.eq("ticker", ticker);
  if (since) q = q.gte("resolve_date", since);
  const { data, error } = await q.order("resolve_date", { ascending: status !== "resolved" }).limit(300);
  if (error) throw new Error(error.message);
  return data;
}
async function getQuestion(id) {
  if (config.localMode) return localStore.rows("forecast_questions").find((q) => q.id === id) ?? null;
  const { data } = await supabase().from("forecast_questions").select("*").eq("id", id).maybeSingle();
  return data;
}
async function insertQuestion(row) {
  if (config.localMode) return localStore.insert("forecast_questions", row);
  const { data, error } = await supabase().from("forecast_questions").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}
async function updateQuestion(id, fields) {
  if (config.localMode) return localStore.update("forecast_questions", (q) => q.id === id, fields)[0];
  const { data, error } = await supabase().from("forecast_questions").update(fields).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}
/** Every user's forecasts on these questions (server-side only; the app sees aggregates). */
async function forecastsFor(questionIds) {
  if (!questionIds.length) return [];
  if (config.localMode) return localStore.rows("forecasts").filter((x) => questionIds.includes(x.question_id));
  const out = [];
  for (let i = 0; i < questionIds.length; i += 100) {
    const { data, error } = await supabase().from("forecasts").select("*").in("question_id", questionIds.slice(i, i + 100)).limit(10000);
    if (error) throw new Error(error.message);
    out.push(...data);
  }
  return out;
}

// ---------- Market odds ----------
/**
 * Volatility for a ticker and resolution date: the options-implied volatility for that expiration when the
 * ticker lists options expiring then (weekly Fridays usually do), else 60-day historical volatility.
 */
export async function volatilityFor(ticker, resolveDate) {
  try {
    const ov = await getOptionsOverview(ticker, { expiration: resolveDate });
    if (ov?.iv && ov.expiration === resolveDate && !String(ov.iv_source).startsWith("historical")) return { sigma: ov.iv / 100, source: "options" };
  } catch {
    // no options or rate limited: fall back to history
  }
  const bars = await getDailyBars(ticker, { maxAgeHours: 20 });
  const hv = historicalVol(bars, 60) ?? historicalVol(bars, 20);
  if (!hv) throw bad(`Not enough price history for ${ticker}`);
  return { sigma: hv, source: "volatility" };
}

/** Probability (0 to 1) the stock closes above the strike, from the current price and stored volatility. */
export function marketOdds(q, price, now = new Date()) {
  if (!(price > 0) || !(q.sigma > 0)) return null;
  return Math.min(0.99, Math.max(0.01, probAbove({ S: price, level: Number(q.strike), T: yearsUntil(q.resolve_date, now), sigma: Number(q.sigma) })));
}

async function livePrice(ticker) {
  return (await withLivePrice(ticker).catch(() => null))?.price ?? null;
}

// ---------- Creating questions ----------
async function createQuestion({ ticker, strike, resolve_date, source, created_by = null, price, vol }) {
  const existing = (await listQuestions({ ticker })).find((q) => Number(q.strike) === strike && q.resolve_date === resolve_date);
  if (existing) return existing;
  vol ??= await volatilityFor(ticker, resolve_date);
  const row = await insertQuestion({ ticker, strike, resolve_date, status: "open", ref_price: round(price), sigma: round(vol.sigma, 4), sigma_source: vol.source, sigma_updated_at: new Date().toISOString(), source, created_by });
  return row;
}

/** Weekly auto questions: for each popular ticker, close above a strike near the price and one expected-move-ish either side. */
export async function ensureWeeklyQuestions({ tickers = AUTO_TICKERS } = {}) {
  if (!pricesEnabled()) return { skipped: "no price data" };
  const date = targetFriday();
  let created = 0;
  for (const ticker of tickers) {
    try {
      const have = (await listQuestions({ ticker })).filter((q) => q.resolve_date === date && q.source === "auto");
      if (have.length >= 3) continue;
      const price = (await livePrice(ticker)) ?? (await getDailyBars(ticker, { maxAgeHours: 20 })).at(-1)?.c;
      if (!price) continue;
      const vol = await volatilityFor(ticker, date);
      for (const strike of weeklyStrikes(price, vol.sigma, yearsUntil(date))) {
        const before = have.find((q) => Number(q.strike) === strike);
        if (!before) {
          await createQuestion({ ticker, strike, resolve_date: date, source: "auto", price, vol });
          created++;
        }
      }
    } catch (err) {
      console.error(`Forecast questions ${ticker}:`, err.message);
    }
  }
  return { date, created };
}

/** A question a user asks: ticker, strike within ±50% of the price, a weekday 1 to 90 days out. */
export async function askQuestion(userId, { ticker, strike, resolve_date }) {
  const t = String(ticker ?? "").trim().toUpperCase();
  if (!SYM.test(t)) throw bad("Enter a valid ticker");
  const today = etNow().date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(resolve_date)) || resolve_date <= today || resolve_date > addDays(today, 90)) throw bad("Pick a date between tomorrow and 90 days out");
  if ([0, 6].includes(weekday(resolve_date))) throw bad("Pick a weekday: questions resolve on the closing price");
  const asked = (await listQuestions({})).filter((q) => q.created_by === userId && String(q.created_at ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  if (asked >= USER_QUESTIONS_PER_DAY) throw bad(`You can add ${USER_QUESTIONS_PER_DAY} questions a day`, 429);
  const price = await livePrice(t);
  if (!price) throw bad(`Couldn't get a price for ${t}`);
  const k = Number(strike);
  if (!(k > 0) || Math.abs(k - price) / price > 0.5) throw bad(`Pick a price within 50% of ${t}'s current $${round(price)}`);
  const q = await createQuestion({ ticker: t, strike: round(k), resolve_date, source: "user", created_by: userId, price });
  track(userId, "forecast_question_asked", { ticker: t });
  return q;
}

// ---------- Forecasting ----------
export async function submitForecast(userId, { question_id, prob }) {
  const q = await getQuestion(question_id);
  if (!q) throw bad("Question not found", 404);
  if (isLocked(q)) throw bad("Forecasts for this question are closed", 409);
  const p = Math.round(Number(prob));
  if (!(p >= 1 && p <= 99)) throw bad("Pick a probability from 1% to 99%");
  const price = await livePrice(q.ticker);
  const market = marketOdds(q, price);
  const fields = { prob: p / 100, market_prob: market != null ? round(market, 4) : null, price_at: round(price), updated_at: new Date().toISOString() };
  const mine = (await db.list("forecasts", { user_id: userId, question_id }, { limit: 1 }))[0];
  const row = mine ? await db.update("forecasts", mine.id, userId, fields) : await db.insert("forecasts", { user_id: userId, question_id, ...fields });
  if (!mine) track(userId, "forecast_made", { ticker: q.ticker });
  return row;
}

/** Questions with live price, market odds, your forecast and (once you've forecast, or it resolved) the crowd. */
export async function listForUser(userId, { status = "open", ticker } = {}) {
  const t = ticker ? String(ticker).toUpperCase() : undefined;
  let qs = await listQuestions({ status: status === "resolved" ? "resolved" : "open", ticker: t, since: status === "resolved" ? addDays(etNow().date, -60) : undefined });
  qs = qs.sort((a, b) => (status === "resolved" ? b.resolve_date.localeCompare(a.resolve_date) : a.resolve_date.localeCompare(b.resolve_date) || a.ticker.localeCompare(b.ticker) || a.strike - b.strike)).slice(0, 120);
  const all = await forecastsFor(qs.map((q) => q.id));
  const prices = new Map();
  for (const tk of [...new Set(qs.map((q) => q.ticker))]) prices.set(tk, status === "open" ? await livePrice(tk) : null);
  const now = etNow();
  return qs.map((q) => {
    const fs = all.filter((f) => f.question_id === q.id);
    const mine = fs.find((f) => f.user_id === userId) ?? null;
    const price = prices.get(q.ticker);
    const showCrowd = !!mine || q.status !== "open";
    const crowd = fs.length ? fs.reduce((s, f) => s + Number(f.prob), 0) / fs.length : null;
    return {
      id: q.id,
      ticker: q.ticker,
      strike: Number(q.strike),
      resolve_date: q.resolve_date,
      status: q.status,
      source: q.source,
      locked: isLocked(q, now),
      price: round(price),
      distance_pct: price ? round(((Number(q.strike) - price) / price) * 100, 2) : null,
      market_prob: q.status === "open" ? round(marketOdds(q, price), 4) : q.final_market_prob != null ? Number(q.final_market_prob) : null,
      odds_source: q.sigma_source,
      forecasters: fs.length,
      crowd_prob: showCrowd && crowd != null ? round(crowd, 4) : null,
      mine: mine && { prob: Number(mine.prob), market_prob: mine.market_prob != null ? Number(mine.market_prob) : null, points: mine.points, updated_at: mine.updated_at },
      outcome: q.outcome ?? null,
      close_price: q.close_price != null ? Number(q.close_price) : null,
    };
  });
}

// ---------- Resolving ----------
/**
 * Resolves open questions whose day has closed: outcome = the close of the last session on or before the
 * resolution date is above the strike. Waits until the daily bars include that date (or a later one).
 */
export async function resolveDue() {
  if (!pricesEnabled()) return { skipped: "no price data" };
  const now = etNow();
  const due = (await listQuestions({ status: "open" })).filter((q) => q.resolve_date < now.date || (q.resolve_date === now.date && now.minutes >= 16 * 60 + 15));
  let resolved = 0;
  const byTicker = new Map();
  for (const q of due) {
    try {
      if (!byTicker.has(q.ticker)) byTicker.set(q.ticker, await getDailyBars(q.ticker, { maxAgeHours: 3 }));
      const bars = byTicker.get(q.ticker);
      const day = (b) => new Date(b.t).toISOString().slice(0, 10);
      if (!bars.length || day(bars.at(-1)) < q.resolve_date) continue; // data hasn't caught up yet
      const idx = bars.findLastIndex((b) => day(b) <= q.resolve_date);
      if (idx < 1) continue;
      await settle(q, bars[idx].c, bars[idx - 1].c);
      resolved++;
    } catch (err) {
      console.error(`Resolve ${q.ticker} ${q.strike}:`, err.message);
    }
  }
  return { due: due.length, resolved };
}

async function settle(q, close, prevClose) {
  const outcome = close > Number(q.strike);
  // The market's odds going into the last session (from the prior close), for the resolved card
  const final = marketOdds(q, prevClose, new Date(`${q.resolve_date}T13:30:00Z`));
  await updateQuestion(q.id, { status: "resolved", outcome, close_price: round(close), resolved_at: new Date().toISOString(), final_market_prob: final != null ? round(final, 4) : null });
  for (const f of await forecastsFor([q.id])) {
    const pts = points(Number(f.prob), outcome);
    await db.update("forecasts", f.id, f.user_id, { points: pts, outcome, resolved_at: new Date().toISOString() });
    const date = new Date(`${q.resolve_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    await notify(f.user_id, { kind: "forecast", ticker: q.ticker, title: `${q.ticker} closed at $${close.toFixed(2)}: ${outcome ? "Yes" : "No"}`, body: `"Close above $${Number(q.strike)} on ${date}?" You said ${Math.round(f.prob * 100)}%: ${pts >= 0 ? "+" : ""}${pts} points.` }).catch(() => {});
  }
}

/** Daily: refresh volatility on open questions (options-implied when available). */
export async function refreshOdds() {
  if (!pricesEnabled()) return { skipped: "no price data" };
  const open = (await listQuestions({ status: "open" })).filter((q) => Date.now() - Date.parse(q.sigma_updated_at ?? 0) > 20 * 3_600_000);
  const seen = new Map();
  let updated = 0;
  for (const q of open) {
    const key = `${q.ticker}:${q.resolve_date}`;
    try {
      if (!seen.has(key)) seen.set(key, await volatilityFor(q.ticker, q.resolve_date));
      const vol = seen.get(key);
      await updateQuestion(q.id, { sigma: round(vol.sigma, 4), sigma_source: vol.source, sigma_updated_at: new Date().toISOString() });
      updated++;
    } catch {
      // keep the old volatility
    }
  }
  return { updated };
}

/** Scheduled job: create this week's questions, refresh odds, resolve closed ones. */
export async function runForecastJobs() {
  const resolved = await resolveDue().catch((e) => ({ error: e.message }));
  const created = await ensureWeeklyQuestions().catch((e) => ({ error: e.message }));
  const odds = await refreshOdds().catch((e) => ({ error: e.message }));
  return { resolved, created, odds };
}

// ---------- Stats and leaderboard ----------
async function resolvedRows({ userId, since } = {}) {
  const rows = userId ? await db.list("forecasts", { user_id: userId }, { limit: 5000 }) : await db.all("forecasts", {});
  return rows.filter((f) => f.outcome != null && (!since || String(f.resolved_at) >= since)).map((f) => ({ user_id: f.user_id, prob: Number(f.prob), outcome: f.outcome, market_prob: f.market_prob != null ? Number(f.market_prob) : null }));
}

const nameFor = (userId, profiles) => profiles.get(userId) ?? `Forecaster ${String(userId).replace(/-/g, "").slice(-4).toUpperCase()}`;
async function profiles() {
  const rows = await db.all("forecast_profiles", {});
  return new Map(rows.map((p) => [p.user_id, p.nickname]));
}

export async function leaderboard(userId, { period = "30d" } = {}) {
  const since = period === "all" ? null : new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = await resolvedRows({ since });
  const by = new Map();
  for (const r of rows) by.set(r.user_id, [...(by.get(r.user_id) ?? []), r]);
  const names = await profiles();
  const ranked = [...by.entries()]
    .map(([uid, rs]) => ({ user_id: uid, ...summarize(rs) }))
    .filter((r) => r.resolved >= MIN_RANKED)
    .sort((a, b) => b.points - a.points || a.brier - b.brier)
    .map((r, i) => ({ rank: i + 1, name: nameFor(r.user_id, names), you: r.user_id === userId, points: r.points, resolved: r.resolved, brier: r.brier, beat_market_pct: r.beat_market_pct }));
  return { period, min_forecasts: MIN_RANKED, rows: ranked.slice(0, 50), you: ranked.find((r) => r.you) ?? null };
}

export async function myStats(userId) {
  const all = await resolvedRows({ userId });
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = (await db.list("forecasts", { user_id: userId }, { limit: 5000 })).filter((f) => f.outcome != null && String(f.resolved_at) >= since);
  const open = (await db.list("forecasts", { user_id: userId }, { limit: 5000 })).filter((f) => f.outcome == null).length;
  const names = await profiles();
  return {
    name: nameFor(userId, names),
    nickname: names.get(userId) ?? null,
    open,
    all_time: summarize(all),
    last_30d: summarize(recent.map((f) => ({ prob: Number(f.prob), outcome: f.outcome, market_prob: f.market_prob != null ? Number(f.market_prob) : null }))),
    calibration: calibration(all),
    crowd_note: "The crowd's odds appear after you forecast, so your call is your own.",
  };
}

export async function setNickname(userId, nickname) {
  const n = String(nickname ?? "").trim();
  if (!/^[A-Za-z0-9_ .-]{3,20}$/.test(n)) throw bad("Use 3 to 20 letters, numbers, spaces, dots, dashes or underscores");
  const taken = (await db.all("forecast_profiles", {})).find((p) => p.nickname.toLowerCase() === n.toLowerCase() && p.user_id !== userId);
  if (taken) throw bad("That name is taken", 409);
  const mine = (await db.list("forecast_profiles", { user_id: userId }, { limit: 1 }))[0];
  return mine ? db.update("forecast_profiles", mine.id, userId, { nickname: n }) : db.insert("forecast_profiles", { user_id: userId, nickname: n });
}
