import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { technicalSnapshot } from "./indicators.js";
import { listHoldings } from "./portfolio.js";
import { cached } from "./cache.js";

// Risk tools: position sizing from account risk, and portfolio vs benchmark (SPY) performance.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

/**
 * Position size so that hitting the stop loses `riskPct` of the account.
 * Optional ATR-based stop (entry - atrMultiple * ATR) when no stop is given.
 */
export function positionSize({ account, riskPct, entry, stop, side = "long", maxPositionPct = 100, atr = null, atrMultiple = 2 }) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!(account > 0)) throw bad("Account size must be greater than 0");
  if (!(riskPct > 0 && riskPct <= 10)) throw bad("Risk per trade must be between 0 and 10%");
  if (!(entry > 0)) throw bad("Entry price must be greater than 0");
  let stopPrice = stop;
  let stopSource = "manual";
  if (!(stopPrice > 0) && atr > 0) {
    stopPrice = side === "short" ? entry + atrMultiple * atr : entry - atrMultiple * atr;
    stopSource = `${atrMultiple}× ATR`;
  }
  if (!(stopPrice > 0)) throw bad("Enter a stop price (or provide ATR for an automatic stop)");
  const perShare = side === "short" ? stopPrice - entry : entry - stopPrice;
  if (!(perShare > 0)) throw bad(side === "short" ? "For a short, the stop must be above entry" : "For a long, the stop must be below entry");

  const riskDollars = account * (riskPct / 100);
  let shares = Math.floor(riskDollars / perShare);
  const maxShares = Math.floor((account * (maxPositionPct / 100)) / entry);
  const cappedByPosition = shares > maxShares;
  shares = Math.min(shares, maxShares);
  const position = shares * entry;
  const dir = side === "short" ? -1 : 1;
  const target = (r) => round(entry + dir * r * perShare);
  return {
    shares,
    position_value: round(position),
    position_pct_of_account: round((position / account) * 100, 1),
    risk_dollars: round(shares * perShare),
    risk_pct_of_account: round(((shares * perShare) / account) * 100, 2),
    stop_price: round(stopPrice),
    stop_source: stopSource,
    stop_distance_pct: round((perShare / entry) * 100, 2),
    capped_by_max_position: cappedByPosition,
    targets: { "1R": target(1), "2R": target(2), "3R": target(3) },
    reward_at_2r: round(shares * perShare * 2),
  };
}

/** Suggested stops for a ticker from its chart: ATR-based and nearest support (long) / resistance (short). */
export async function stopSuggestions(ticker) {
  if (!pricesEnabled()) return null;
  const t = technicalSnapshot(await getDailyBars(ticker));
  if (!t) return null;
  const atr = t.atr14;
  return {
    price: t.price,
    atr14: atr,
    atr_pct: t.atr_pct,
    long: { atr_2x: round(t.price - 2 * atr), below_support: t.levels.support[0] ? round(t.levels.support[0].level * 0.99) : null },
    short: { atr_2x: round(t.price + 2 * atr), above_resistance: t.levels.resistance[0] ? round(t.levels.resistance[0].level * 1.01) : null },
  };
}

function seriesStats(values) {
  const rets = values.slice(1).map((v, i) => v / values[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  let peak = values[0], dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, v / peak - 1);
  }
  return { rets, total: values[values.length - 1] / values[0] - 1, vol: sd * Math.sqrt(252), dd, sharpe: sd ? (mean / sd) * Math.sqrt(252) : null };
}

/**
 * How the current holdings would have performed vs SPY over `days` sessions
 * (current share counts held constant; not a record of past trades).
 */
export async function benchmarkPortfolio(userId, { days = 252, benchmark = "SPY" } = {}) {
  const holdings = await listHoldings(userId);
  if (!holdings.length) return { empty: true };
  const tickers = [...new Set(holdings.map((h) => h.ticker))];
  const load = (t) => cached(`bars-close:${t}`, 360, async () => (await getDailyBars(t)).map((b) => [new Date(b.t).toISOString().slice(0, 10), b.c])).catch(() => []);
  const [bench, ...series] = await Promise.all([load(benchmark), ...tickers.map(load)]);
  const maps = series.map((s) => new Map(s));
  const benchMap = new Map(bench);
  const priced = tickers.filter((_, i) => maps[i].size);
  if (!priced.length || !benchMap.size) throw Object.assign(new Error("Not enough price history to compare yet"), { status: 503 });
  const dates = [...benchMap.keys()].filter((d) => priced.every((t) => maps[tickers.indexOf(t)].has(d))).slice(-days);
  const shares = Object.fromEntries(holdings.map((h) => [h.ticker, Number(h.shares)]));
  const value = dates.map((d) => priced.reduce((s, t) => s + shares[t] * maps[tickers.indexOf(t)].get(d), 0));
  const benchVals = dates.map((d) => benchMap.get(d));
  const p = seriesStats(value), b = seriesStats(benchVals);

  // Beta and correlation of daily returns vs the benchmark
  const n = Math.min(p.rets.length, b.rets.length);
  const mp = p.rets.slice(0, n).reduce((a, x) => a + x, 0) / n, mb = b.rets.slice(0, n).reduce((a, x) => a + x, 0) / n;
  let cov = 0, vb = 0, vp = 0;
  for (let i = 0; i < n; i++) {
    cov += (p.rets[i] - mp) * (b.rets[i] - mb);
    vb += (b.rets[i] - mb) ** 2;
    vp += (p.rets[i] - mp) ** 2;
  }
  const step = Math.max(1, Math.floor(dates.length / 250));
  return {
    benchmark,
    from: dates[0],
    to: dates[dates.length - 1],
    tickers_included: priced,
    tickers_missing: tickers.filter((t) => !priced.includes(t)),
    portfolio: { total_return_pct: round(p.total * 100), volatility_pct: round(p.vol * 100), max_drawdown_pct: round(p.dd * 100), sharpe: round(p.sharpe) },
    benchmark_stats: { total_return_pct: round(b.total * 100), volatility_pct: round(b.vol * 100), max_drawdown_pct: round(b.dd * 100), sharpe: round(b.sharpe) },
    excess_return_pct: round((p.total - b.total) * 100),
    beta: vb ? round(cov / vb) : null,
    correlation: vb && vp ? round(cov / Math.sqrt(vb * vp)) : null,
    points: dates.map((d, i) => ({ date: d, portfolio: round((value[i] / value[0] - 1) * 100), benchmark: round((benchVals[i] / benchVals[0] - 1) * 100) })).filter((_, i, arr) => i % step === 0 || i === arr.length - 1),
    note: "Uses your current holdings and share counts over the whole period, not your actual trade history.",
  };
}
