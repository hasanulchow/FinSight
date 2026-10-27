import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { getQuoteLite, getEarningsCalendar } from "../tools/quote.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { technicalSnapshot } from "./indicators.js";
import { runAgent } from "./llm.js";
import { enforceOutput } from "./guardrails.js";
import { notify } from "./notify.js";
import { obj, str, arr, oneOf } from "../agents/schema.js";

// Portfolio X-ray: holdings (CSV import or manual), live valuation, concentration and sector risk,
// per-holding technical health, upcoming earnings, and an AI read. Numbers are computed in code.

const MAX_HOLDINGS = 100;
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

// ---------- CSV import ----------
/**
 * Parses broker CSV exports or simple "TICKER,SHARES[,COST]" lines.
 * Recognizes header names like Symbol/Ticker, Quantity/Shares/Qty, Average Cost/Cost Basis/Price Paid.
 */
export function parseHoldingsCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { holdings: [], skipped: [] };
  // Delimiter: whichever of tab, semicolon or comma appears most in the first lines; plain "AAPL 10" lines split on spaces
  const sample = lines.slice(0, 5).join("\n");
  const delim = ["\t", ";", ","].map((d) => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const split = (line) => {
    if (!line.includes(delim)) return line.split(/\s+/);
    const cells = [];
    let cell = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') (cell += '"'), i++;
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) cells.push(cell.trim()), (cell = "");
      else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  };
  const num = (s) => (s == null || s === "" ? null : Number(String(s).replace(/[$,\s]/g, "")));

  let header = split(lines[0]).map((h) => h.toLowerCase());
  let idx = {
    ticker: header.findIndex((h) => /^(symbol|ticker|instrument|security)$/.test(h)),
    shares: header.findIndex((h) => /^(quantity|qty|shares|position|units)$/.test(h)),
    cost: header.findIndex((h) => /(avg|average).*(cost|price)|cost basis.*share|price paid|unit cost/.test(h)),
    totalCost: header.findIndex((h) => /^(cost basis|total cost|cost)$/.test(h)),
  };
  let start = 1;
  if (idx.ticker < 0 || idx.shares < 0) {
    // No recognizable header: assume ticker, shares, cost
    idx = { ticker: 0, shares: 1, cost: 2, totalCost: -1 };
    start = /^[A-Za-z]/.test(split(lines[0])[1] ?? "") ? 1 : 0; // skip an unrecognized header row
  }

  const merged = new Map();
  const skipped = [];
  for (const line of lines.slice(start)) {
    const cells = split(line);
    const ticker = (cells[idx.ticker] ?? "").toUpperCase().replace(/\s+/g, "");
    const shares = num(cells[idx.shares]);
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) || !(shares > 0)) {
      skipped.push(line);
      continue;
    }
    let cost = idx.cost >= 0 ? num(cells[idx.cost]) : null;
    if (cost == null && idx.totalCost >= 0 && num(cells[idx.totalCost]) != null) cost = num(cells[idx.totalCost]) / shares;
    const prev = merged.get(ticker);
    if (prev) {
      // Same ticker twice (e.g. two lots): combine with a weighted average cost
      const totalShares = prev.shares + shares;
      prev.cost_basis = prev.cost_basis != null && cost != null ? (prev.cost_basis * prev.shares + cost * shares) / totalShares : prev.cost_basis ?? cost;
      prev.shares = totalShares;
    } else merged.set(ticker, { ticker, shares, cost_basis: cost != null && cost > 0 ? cost : null });
  }
  return { holdings: [...merged.values()].map((h) => ({ ...h, cost_basis: round(h.cost_basis, 4) })), skipped };
}

// ---------- Holdings CRUD ----------
export async function listHoldings(userId) {
  if (config.localMode) return localStore.rows("holdings").filter((h) => h.user_id === userId).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const { data, error } = await supabase().from("holdings").select("id, ticker, shares, cost_basis, created_at").eq("user_id", userId).order("ticker");
  if (error) throw new Error(error.message);
  return data;
}

/** Inserts or replaces holdings. mode "replace" clears existing holdings first (full CSV import). */
export async function upsertHoldings(userId, holdings, { mode = "merge" } = {}) {
  if (holdings.length > MAX_HOLDINGS) throw Object.assign(new Error(`Up to ${MAX_HOLDINGS} holdings`), { status: 400 });
  if (config.localMode) {
    if (mode === "replace") localStore.remove("holdings", (h) => h.user_id === userId);
    for (const h of holdings) {
      const existing = localStore.rows("holdings").find((x) => x.user_id === userId && x.ticker === h.ticker);
      if (existing) Object.assign(existing, h);
      else localStore.insert("holdings", { user_id: userId, ...h });
    }
    return listHoldings(userId);
  }
  if (mode === "replace") await supabase().from("holdings").delete().eq("user_id", userId);
  const { error } = await supabase().from("holdings").upsert(holdings.map((h) => ({ user_id: userId, ...h })), { onConflict: "user_id,ticker" });
  if (error) throw new Error(error.message);
  return listHoldings(userId);
}

export async function deleteHolding(userId, id) {
  if (config.localMode) return localStore.remove("holdings", (h) => h.id === id && h.user_id === userId) > 0;
  const { data, error } = await supabase().from("holdings").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) throw new Error(error.message);
  return data.length > 0;
}

// ---------- X-ray metrics (pure) ----------
export function portfolioMetrics(positions) {
  const total = positions.reduce((s, p) => s + p.value, 0);
  const withWeights = positions.map((p) => ({ ...p, weight: total ? round((p.value / total) * 100, 1) : 0 })).sort((a, b) => b.value - a.value);
  const sectors = {};
  for (const p of withWeights) sectors[p.sector] = round((sectors[p.sector] ?? 0) + p.weight, 1);
  const hhi = withWeights.reduce((s, p) => s + (p.weight / 100) ** 2, 0); // 1 = everything in one stock
  const costed = withWeights.filter((p) => p.cost_basis != null);
  const costTotal = costed.reduce((s, p) => s + p.cost_basis * p.shares, 0);
  const costedValue = costed.reduce((s, p) => s + p.value, 0);
  const dayChange = withWeights.reduce((s, p) => s + (p.change ?? 0) * p.shares, 0);
  return {
    total_value: round(total),
    day_change: round(dayChange),
    day_change_pct: total ? round((dayChange / (total - dayChange)) * 100) : null,
    unrealized_pl: costed.length ? round(costedValue - costTotal) : null,
    unrealized_pl_pct: costTotal ? round(((costedValue - costTotal) / costTotal) * 100) : null,
    positions: withWeights,
    sectors: Object.entries(sectors).sort((a, b) => b[1] - a[1]).map(([sector, weight]) => ({ sector, weight })),
    concentration: {
      top_holding_pct: withWeights[0]?.weight ?? 0,
      top3_pct: round(withWeights.slice(0, 3).reduce((s, p) => s + p.weight, 0), 1),
      largest_sector_pct: Math.max(0, ...Object.values(sectors)),
      effective_holdings: hhi ? round(1 / hhi, 1) : 0, // diversification: "acts like N equal-weight stocks"
      diversification: hhi > 0.25 ? "concentrated" : hhi > 0.1 ? "moderate" : "diversified",
    },
  };
}

async function cachedTechnicals(ticker) {
  // Only cached bars: fetching 5/min for every holding would make the X-ray slow. The scheduled job warms the cache.
  if (!pricesEnabled()) return null;
  try {
    const bars = await getDailyBars(ticker, { maxAgeHours: 48 });
    const t = technicalSnapshot(bars);
    return t && { trend: t.trend, rsi14: t.rsi14, rating: t.rating.bias, above_sma200: t.moving_averages.sma200 ? t.price > t.moving_averages.sma200 : null, change_1m: t.performance_pct["1m"] };
  } catch {
    return null;
  }
}

async function mapLimit(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

/** Valued positions + metrics + upcoming earnings, without AI. */
export async function computeXray(userId, { technicals = true } = {}) {
  const holdings = await listHoldings(userId);
  if (!holdings.length) return null;
  const positions = (
    await mapLimit(holdings, 5, async (h) => {
      try {
        const q = await getQuoteLite(h.ticker);
        const tech = technicals ? await cachedTechnicals(h.ticker) : null;
        return {
          id: h.id, ticker: h.ticker, name: q.name, sector: q.sector, shares: Number(h.shares), cost_basis: h.cost_basis != null ? Number(h.cost_basis) : null,
          price: q.price, change: q.change, change_pct: round(q.changePercent), value: round(q.price * h.shares),
          pl_pct: h.cost_basis ? round(((q.price - h.cost_basis) / h.cost_basis) * 100) : null,
          technicals: tech,
        };
      } catch (err) {
        return { id: h.id, ticker: h.ticker, error: err.message, shares: Number(h.shares), value: 0, sector: "Unknown" };
      }
    })
  ).filter(Boolean);

  const metrics = portfolioMetrics(positions.filter((p) => !p.error));
  const tickers = new Set(holdings.map((h) => h.ticker));
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const earnings = (await getEarningsCalendar({ from: today, to: in30 }).catch(() => [])).filter((e) => tickers.has(e.ticker)).sort((a, b) => a.date.localeCompare(b.date));
  return { ...metrics, unpriced: positions.filter((p) => p.error).map((p) => p.ticker), upcoming_earnings: earnings };
}

const xraySchema = obj({
  headline: str("One sentence summing up the portfolio today"),
  summary: str("3-4 sentences: size, day's move, biggest contributors, overall shape"),
  concentration: str("2-3 sentences on concentration and diversification using the computed metrics"),
  sector_exposure: str("1-2 sentences on sector weights"),
  technical_health: str("1-2 sentences on how many holdings are in uptrends/downtrends or overbought/oversold, if technicals are present"),
  upcoming: str("1-2 sentences on upcoming earnings among holdings, or 'No earnings in the next 30 days'"),
  things_to_watch: arr(str("A specific, factual item to keep an eye on"), "2-4 items"),
  risk_level: oneOf(["low", "moderate", "elevated", "high"], "Concentration-based risk level from the metrics"),
});

export async function portfolioAnalyst(xray) {
  const out = await runAgent({
    agent: "portfolio_analyst",
    effort: "low",
    schema: xraySchema,
    system: `You analyze a retail investor's portfolio for an educational stock app. Use only the computed data; every number you cite must appear in it.
Describe concentration, diversification, sector exposure, technical health and upcoming events. Never tell the user to buy, sell, rebalance or trade specific positions, and never predict returns.
You may note general facts like "concentrated portfolios tend to swing more with single stocks".`,
    prompt: `Portfolio X-ray (JSON):\n${JSON.stringify({ ...xray, positions: xray.positions.map(({ id, ...p }) => p) }, null, 2)}`,
  });
  return enforceOutput(out).value;
}

/** Daily digest: one notification per user with holdings, after the US close. */
export async function sendDailyDigests() {
  const today = new Date().toISOString().slice(0, 10);
  let users;
  if (config.localMode) users = [...new Set(localStore.rows("holdings").map((h) => h.user_id))];
  else {
    const { data } = await supabase().from("holdings").select("user_id").limit(10000);
    users = [...new Set((data ?? []).map((h) => h.user_id))];
  }
  let sent = 0;
  for (const userId of users) {
    const already = config.localMode
      ? localStore.rows("notifications").some((n) => n.user_id === userId && n.kind === "digest" && n.created_at.startsWith(today))
      : ((await supabase().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "digest").gte("created_at", today)).count ?? 0) > 0;
    if (already) continue;
    try {
      const xray = await computeXray(userId, { technicals: false });
      if (!xray) continue;
      const movers = [...xray.positions].sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 3);
      const sign = (x) => (x > 0 ? "+" : "");
      const dollars = `${xray.day_change >= 0 ? "+" : "-"}$${Math.abs(xray.day_change).toLocaleString()}`;
      const body = `Your portfolio ${xray.day_change >= 0 ? "rose" : "fell"} ${Math.abs(xray.day_change_pct)}% today (${dollars}). Biggest moves: ${movers.map((m) => `${m.ticker} ${sign(m.change_pct)}${m.change_pct}%`).join(", ")}.${xray.upcoming_earnings[0] ? ` Next earnings: ${xray.upcoming_earnings[0].ticker} on ${xray.upcoming_earnings[0].date}.` : ""}`;
      await notify(userId, { kind: "digest", title: "Your daily portfolio digest", body });
      sent++;
    } catch (err) {
      console.error(`Digest for ${userId}:`, err.message);
    }
  }
  return { users: users.length, sent };
}
