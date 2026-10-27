import { sma, ema, rsi, macd } from "./indicators.js";

// Strategy backtester on daily bars. Long-only, fully invested when in a position.
// Signals are computed on a bar's close and executed at the NEXT bar's open (no look-ahead).
// Optional cost per trade in basis points. Results are compared with buy-and-hold.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

export const BACKTEST_STRATEGIES = {
  sma_cross: { label: "Moving-average crossover", params: { fast: 50, slow: 200 }, describe: (p) => `Buy when the ${p.fast}-day average crosses above the ${p.slow}-day; sell when it crosses below.` },
  rsi_reversion: { label: "RSI mean reversion", params: { period: 14, buy_below: 30, sell_above: 55 }, describe: (p) => `Buy when RSI(${p.period}) drops below ${p.buy_below}; sell when it rises above ${p.sell_above}.` },
  macd_cross: { label: "MACD crossover", params: { fast: 12, slow: 26, signal: 9 }, describe: () => "Buy when MACD crosses above its signal line; sell when it crosses below." },
  breakout: { label: "Breakout (Donchian)", params: { entry: 55, exit: 20 }, describe: (p) => `Buy on a close above the prior ${p.entry}-day high; sell on a close below the prior ${p.exit}-day low.` },
  trend_filter: { label: "Above the 200-day", params: { period: 200 }, describe: (p) => `Hold while the close is above the ${p.period}-day average; stay in cash below it.` },
};

/** Returns an array of desired positions (1 = long, 0 = cash) evaluated at each bar's close. */
function positions(name, bars, p) {
  const c = bars.map((b) => b.c);
  const n = bars.length;
  const pos = new Array(n).fill(0);
  let inPos = 0;
  if (name === "sma_cross") {
    const f = sma(c, p.fast), s = sma(c, p.slow);
    for (let i = 0; i < n; i++) {
      if (f[i] != null && s[i] != null) inPos = f[i] > s[i] ? 1 : 0;
      pos[i] = inPos;
    }
  } else if (name === "rsi_reversion") {
    const r = rsi(c, p.period);
    for (let i = 0; i < n; i++) {
      if (r[i] != null) {
        if (!inPos && r[i] < p.buy_below) inPos = 1;
        else if (inPos && r[i] > p.sell_above) inPos = 0;
      }
      pos[i] = inPos;
    }
  } else if (name === "macd_cross") {
    const m = macd(c, p.fast, p.slow, p.signal);
    for (let i = 0; i < n; i++) {
      if (m.line[i] != null && m.signal[i] != null) inPos = m.line[i] > m.signal[i] ? 1 : 0;
      pos[i] = inPos;
    }
  } else if (name === "breakout") {
    for (let i = 0; i < n; i++) {
      if (i >= p.entry) {
        const hi = Math.max(...bars.slice(i - p.entry, i).map((b) => b.h));
        const lo = Math.min(...bars.slice(i - p.exit, i).map((b) => b.l));
        if (!inPos && c[i] > hi) inPos = 1;
        else if (inPos && c[i] < lo) inPos = 0;
      }
      pos[i] = inPos;
    }
  } else if (name === "trend_filter") {
    const s = sma(c, p.period);
    for (let i = 0; i < n; i++) pos[i] = s[i] != null && c[i] > s[i] ? 1 : 0;
  } else {
    throw Object.assign(new Error(`Unknown strategy. Use one of: ${Object.keys(BACKTEST_STRATEGIES).join(", ")}`), { status: 400 });
  }
  return pos;
}

function stats(equity, dates, trades, exposure) {
  const start = equity[0], end = equity[equity.length - 1];
  const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 86_400_000);
  const rets = equity.slice(1).map((v, i) => v / equity[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  let peak = equity[0], maxDd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    maxDd = Math.min(maxDd, v / peak - 1);
  }
  const closed = trades.filter((t) => t.exit_date);
  const wins = closed.filter((t) => t.return_pct > 0);
  return {
    total_return_pct: round((end / start - 1) * 100),
    cagr_pct: years > 0 ? round(((end / start) ** (1 / years) - 1) * 100) : null,
    max_drawdown_pct: round(maxDd * 100),
    sharpe: sd ? round((mean / sd) * Math.sqrt(252)) : null,
    volatility_pct: round(sd * Math.sqrt(252) * 100),
    trades: closed.length + (trades.length > closed.length ? 1 : 0),
    win_rate_pct: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    avg_trade_pct: closed.length ? round(closed.reduce((s, t) => s + t.return_pct, 0) / closed.length) : null,
    exposure_pct: exposure == null ? 100 : round(exposure * 100, 1),
  };
}

/** Runs one strategy over the bars. Returns stats, equity/drawdown curves (vs buy-and-hold) and the trade list. */
export function runBacktest(bars, { strategy, params = {}, costBps = 5, capital = 10_000 }) {
  const spec = BACKTEST_STRATEGIES[strategy];
  if (!spec) throw Object.assign(new Error(`Unknown strategy. Use one of: ${Object.keys(BACKTEST_STRATEGIES).join(", ")}`), { status: 400 });
  const p = { ...spec.params, ...Object.fromEntries(Object.entries(params).filter(([k, v]) => k in spec.params && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) };
  if (bars.length < 60) throw Object.assign(new Error("Not enough price history to backtest"), { status: 400 });

  const want = positions(strategy, bars, p);
  const dates = bars.map((b) => new Date(b.t).toISOString().slice(0, 10));
  const cost = costBps / 10_000;
  let cash = capital, shares = 0, held = 0;
  const equity = [], trades = [];
  for (let i = 0; i < bars.length; i++) {
    // Execute yesterday's signal at today's open
    const target = i > 0 ? want[i - 1] : 0;
    if (target === 1 && shares === 0) {
      shares = (cash * (1 - cost)) / bars[i].o;
      trades.push({ entry_date: dates[i], entry_price: round(bars[i].o) });
      cash = 0;
    } else if (target === 0 && shares > 0) {
      cash = shares * bars[i].o * (1 - cost);
      const t = trades[trades.length - 1];
      Object.assign(t, { exit_date: dates[i], exit_price: round(bars[i].o), return_pct: round((bars[i].o / t.entry_price - 1) * 100 - costBps / 50) });
      shares = 0;
    }
    if (shares > 0) held++;
    equity.push(cash + shares * bars[i].c);
  }
  const hold = bars.map((b) => (capital / bars[0].o) * b.c);
  const open = trades.find((t) => !t.exit_date);
  if (open) Object.assign(open, { return_pct: round((bars[bars.length - 1].c / open.entry_price - 1) * 100), open: true });

  // Downsample curves for the chart (max ~250 points)
  const step = Math.max(1, Math.floor(bars.length / 250));
  const idx = bars.map((_, i) => i).filter((i) => i % step === 0 || i === bars.length - 1);
  const ddCurve = (series) => {
    let peak = series[0];
    return series.map((v) => ((peak = Math.max(peak, v)), (v / peak - 1) * 100));
  };
  const dd = ddCurve(equity), ddHold = ddCurve(hold);

  return {
    strategy,
    label: spec.label,
    rules: spec.describe(p),
    params: p,
    cost_bps: costBps,
    period: { from: dates[0], to: dates[dates.length - 1], bars: bars.length },
    stats: stats(equity, dates, trades, held / bars.length),
    buy_and_hold: stats(hold, dates, [{ entry_date: dates[0] }], null),
    curve: idx.map((i) => ({ t: bars[i].t, strategy: round(equity[i]), hold: round(hold[i]), dd: round(dd[i]), dd_hold: round(ddHold[i]), in_position: want[i] })),
    trades: trades.slice(-50),
  };
}
