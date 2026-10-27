import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { getMetrics, getQuoteLite } from "../tools/quote.js";
import { technicalSnapshot } from "./indicators.js";
import { runAgent } from "./llm.js";
import { enforceOutput } from "./guardrails.js";
import { obj, str, arr, oneOf } from "../agents/schema.js";

// Natural-language screener over a universe of large US stocks.
// 1. A scheduled job keeps a snapshot per ticker (fundamentals + technicals) in `screener_snapshots`.
// 2. Claude turns the user's request into structured filters (it never sees or invents data here).
// 3. Code applies the filters; Claude then writes one-line notes on the matches, citing their data.

// ~100 large caps (roughly the S&P 100). Extend with SCREENER_UNIVERSE="T1,T2,..." (paid data plans make bigger universes practical).
const DEFAULT_UNIVERSE = (
  "AAPL MSFT NVDA AMZN GOOGL META BRK.B AVGO TSLA LLY JPM V UNH XOM MA JNJ PG HD COST MRK ABBV CVX " +
  "ADBE CRM KO PEP BAC WMT NFLX AMD TMO MCD CSCO ACN LIN ABT ORCL INTC DIS WFC VZ CMCSA DHR TXN PM " +
  "QCOM NEE AMGN IBM UNP HON CAT LOW INTU SPGI GS RTX BA AMAT UPS ISRG MS BLK PFE T DE ELV SBUX GE " +
  "MDT PLD BKNG GILD LMT ADP SYK TJX MMC C AXP CVS MDLZ ADI VRTX REGN CI MO SCHW PYPL BMY NOW UBER " +
  "SO DUK MU COP PANW GM F"
).split(" ");
export const universe = () => (process.env.SCREENER_UNIVERSE ? process.env.SCREENER_UNIVERSE.split(",").map((t) => t.trim().toUpperCase()) : DEFAULT_UNIVERSE);

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

// ---------- Snapshots ----------
async function allSnapshots() {
  if (config.localMode) return localStore.rows("screener_snapshots");
  const { data, error } = await supabase().from("screener_snapshots").select("ticker, name, sector, data, refreshed_at");
  if (error) throw new Error(error.message);
  return data;
}

async function saveSnapshot(row) {
  if (config.localMode) return localStore.upsertBy("screener_snapshots", "ticker", row);
  const { error } = await supabase().from("screener_snapshots").upsert(row, { onConflict: "ticker" });
  if (error) throw new Error(error.message);
}

/** Builds the flat screening record for one ticker. */
export async function buildSnapshot(ticker) {
  const [lite, m, bars] = await Promise.all([getQuoteLite(ticker), getMetrics(ticker), pricesEnabled() ? getDailyBars(ticker, { maxAgeHours: 20 }) : null]);
  const t = bars?.length ? technicalSnapshot(bars) : null;
  const price = lite.price;
  return {
    ticker,
    name: lite.name,
    sector: lite.sector,
    data: {
      price,
      change_1d: round(lite.changePercent),
      market_cap_b: lite.marketCapMillions ? round(lite.marketCapMillions / 1000, 1) : null,
      pe: round(m.pe, 1),
      dividend_yield: round(m.dividendYield),
      beta: round(m.beta),
      revenue_growth: round(m.revenueGrowth, 1),
      eps_growth: round(m.epsGrowth, 1),
      net_margin: round(m.netMargin, 1),
      pct_from_52w_high: m.week52High ? round(((price - m.week52High) / m.week52High) * 100, 1) : null,
      rsi14: t?.rsi14 ?? null,
      change_1w: t?.performance_pct["1w"] ?? null,
      change_1m: t?.performance_pct["1m"] ?? null,
      change_3m: t?.performance_pct["3m"] ?? null,
      change_1y: t?.performance_pct["1y"] ?? null,
      above_sma50: t?.moving_averages.sma50 != null ? price > t.moving_averages.sma50 : null,
      above_sma200: t?.moving_averages.sma200 != null ? price > t.moving_averages.sma200 : null,
      pct_above_sma200: t?.moving_averages.sma200 ? round(((price - t.moving_averages.sma200) / t.moving_averages.sma200) * 100, 1) : null,
      volume_ratio: t?.volume.ratio ?? null,
      atr_pct: t?.atr_pct ?? null,
      trend: t?.trend ?? null,
      rating: t?.rating.bias ?? null,
      signals: t?.signals.map((s) => s.id) ?? [],
    },
    refreshed_at: new Date().toISOString(),
  };
}

/** Refreshes the `batch` stalest tickers (missing ones first). Called by the scheduled job. */
export async function refreshScreener(batch = Number(process.env.SCREENER_BATCH || 10)) {
  const existing = new Map((await allSnapshots()).map((s) => [s.ticker, s.refreshed_at]));
  const queue = universe().sort((a, b) => (existing.get(a) ?? "").localeCompare(existing.get(b) ?? "")).slice(0, batch);
  let ok = 0, failed = 0;
  for (const ticker of queue) {
    try {
      await saveSnapshot(await buildSnapshot(ticker));
      ok++;
    } catch (err) {
      console.error(`Screener snapshot ${ticker}:`, err.message);
      failed++;
    }
  }
  return { refreshed: ok, failed, coverage: `${existing.size + queue.filter((t) => !existing.has(t)).length - failed}/${universe().length}` };
}

// ---------- Natural language -> filters ----------
export const NUMERIC_FIELDS = {
  price: "Share price ($)",
  change_1d: "1-day change (%)",
  change_1w: "1-week change (%)",
  change_1m: "1-month change (%)",
  change_3m: "3-month change (%)",
  change_1y: "1-year change (%)",
  market_cap_b: "Market cap ($ billions)",
  pe: "P/E ratio (TTM)",
  dividend_yield: "Dividend yield (%)",
  beta: "Beta",
  revenue_growth: "Revenue growth, TTM YoY (%)",
  eps_growth: "EPS growth, TTM YoY (%)",
  net_margin: "Net margin, TTM (%)",
  pct_from_52w_high: "% from 52-week high (negative = below)",
  rsi14: "RSI(14)",
  pct_above_sma200: "% above the 200-day average (negative = below)",
  volume_ratio: "Latest volume / 20-day average",
  atr_pct: "ATR(14) as % of price (volatility)",
};

const filterSchema = obj({
  interpretation: str("One sentence restating what the user is looking for"),
  numeric_filters: arr(
    obj({ field: oneOf(Object.keys(NUMERIC_FIELDS), "Field to filter"), op: oneOf(["gt", "lt"], "gt = greater than, lt = less than"), value: { type: "number", description: "Threshold in the field's units" } }),
    "Numeric conditions; empty if none"
  ),
  sectors: arr(str("Sector/industry keyword, e.g. 'Technology', 'Banking', 'Pharmaceuticals'"), "Empty = any sector"),
  trend: oneOf(["any", "uptrend", "downtrend", "sideways"], "Price trend from moving averages"),
  technical_rating: oneOf(["any", "bullish", "neutral", "bearish"], "Rule-based technical rating"),
  above_sma200: oneOf(["any", "yes", "no"], "Price above its 200-day average"),
  sort_by: oneOf(Object.keys(NUMERIC_FIELDS), "Field to sort by"),
  sort_direction: oneOf(["desc", "asc"], "Sort direction"),
  limit: { type: "integer", description: "How many results to return, 5-25 (default 15)" },
});

export async function parseQuery(query) {
  return runAgent({
    agent: "screener_parser",
    effort: "low",
    schema: filterSchema,
    system: `You convert a stock screening request into structured filters. Fields and units:\n${Object.entries(NUMERIC_FIELDS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
Interpret common phrases: "oversold" = rsi14 < 30, "overbought" = rsi14 > 70, "cheap"/"value" = pe < 15 (and pe > 0), "high dividend" = dividend_yield > 3,
"large cap" = market_cap_b > 100, "growth" = revenue_growth > 15, "profitable" = net_margin > 0, "near highs" = pct_from_52w_high > -5, "beaten down" = pct_from_52w_high < -25.
Only use fields from the list. Don't add conditions the user didn't ask for.`,
    prompt: query,
  });
}

/** Applies parsed filters to snapshots (pure). */
export function applyFilters(rows, f) {
  const sectorRe = f.sectors?.length ? new RegExp(f.sectors.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;
  const matches = rows.filter((r) => {
    const d = r.data;
    for (const c of f.numeric_filters ?? []) {
      const v = d[c.field];
      if (v == null) return false;
      if (c.op === "gt" ? !(v > c.value) : !(v < c.value)) return false;
    }
    if (sectorRe && !sectorRe.test(r.sector ?? "")) return false;
    if (f.trend && f.trend !== "any" && d.trend !== f.trend) return false;
    if (f.technical_rating && f.technical_rating !== "any" && d.rating !== f.technical_rating) return false;
    if (f.above_sma200 === "yes" && d.above_sma200 !== true) return false;
    if (f.above_sma200 === "no" && d.above_sma200 !== false) return false;
    return true;
  });
  const dir = f.sort_direction === "asc" ? 1 : -1;
  const key = f.sort_by ?? "market_cap_b";
  matches.sort((a, b) => ((a.data[key] ?? -Infinity) - (b.data[key] ?? -Infinity)) * dir);
  return matches.slice(0, Math.min(25, Math.max(5, f.limit || 15)));
}

const notesSchema = obj({
  summary: str("1-2 sentences describing what the matches have in common"),
  notes: arr(obj({ ticker: str("Ticker"), note: str("One sentence on why it matched, citing its numbers. No advice") }), "One per result"),
});

/** Full natural-language screen: parse -> filter -> AI notes. */
export async function runScreen(query) {
  const filters = await parseQuery(query);
  const rows = await allSnapshots();
  if (!rows.length) {
    return { query, filters, results: [], summary: "The screener's data is still being collected. Try again in a few minutes.", coverage: `0/${universe().length}` };
  }
  const results = applyFilters(rows, filters);
  let notes = { summary: results.length ? "" : "No stocks matched. Try loosening a condition.", notes: [] };
  if (results.length) {
    notes = await runAgent({
      agent: "screener_notes",
      effort: "low",
      schema: notesSchema,
      system: "You annotate stock screener results for retail investors. Use only the data given; cite numbers exactly. Educational, never recommend buying or selling.",
      prompt: `Request: ${query}\nInterpreted as: ${filters.interpretation}\n\nMatches (JSON):\n${JSON.stringify(results.map((r) => ({ ticker: r.ticker, name: r.name, sector: r.sector, ...r.data })), null, 2)}`,
    });
    notes = enforceOutput(notes).value;
  }
  const noteBy = new Map(notes.notes.map((n) => [n.ticker, n.note]));
  return {
    query,
    filters,
    summary: notes.summary,
    results: results.map((r) => ({ ticker: r.ticker, name: r.name, sector: r.sector, ...r.data, note: noteBy.get(r.ticker) ?? null })),
    coverage: `${rows.length}/${universe().length}`,
    data_as_of: rows.reduce((min, r) => (r.refreshed_at < min ? r.refreshed_at : min), rows[0].refreshed_at),
  };
}
