import { sma, ema, rsi, atr, bollinger } from "./indicators.js";
import { BULL_FLAG_DEFAULTS, BEAR_FLAG_DEFAULTS, flagEndingAt, bearFlagEndingAt } from "./patterns.js";

// Bot strategies on daily bars ({ t, o, h, l, c, v }, oldest first). Pure functions, unit tested.
//
// Each strategy's setup(bars, end, params, ind) looks at the close of bar `end` and returns null or
//   { anchor, level, stop, target, exit_rule?, summary, info }
//  - entry "stop":  the setup is a price level to break on a later bar (a breakout or breakdown). The bot
//                   enters the moment price trades through it (intraday) or after a close beyond it.
//  - entry "close": the signal is the close of bar `end` itself; the bot enters at the next open.
//  - anchor: a stable date that identifies one setup across days (for example the flag's first bar),
//            so the bot acts on each setup once.
//  - target: the strategy's own target price, or null when it exits by rule (exit_rule) or by R multiple.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const day = (t) => new Date(t).toISOString().slice(0, 10);
const maxOf = (bars, from, to, k) => {
  let best = -Infinity, at = from;
  for (let i = from; i <= to; i++) if (bars[i][k] > best) (best = bars[i][k]), (at = i);
  return { value: best, at };
};
const minOf = (bars, from, to, k) => {
  let best = Infinity, at = from;
  for (let i = from; i <= to; i++) if (bars[i][k] < best) (best = bars[i][k]), (at = i);
  return { value: best, at };
};
const usd = (x) => `$${round(x)}`;

/** Indicator series for a bars array, computed once and cached (recomputed if bars were appended). */
const cache = new WeakMap();
const stamp = (bars) => `${bars.length}:${bars[bars.length - 1]?.t}`;
export function indicators(bars) {
  let ind = cache.get(bars);
  if (ind?.stamp === stamp(bars)) return ind;
  const closes = bars.map((b) => b.c);
  const bb = bollinger(closes, 20, 2);
  ind = {
    sma5: sma(closes, 5),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema20: ema(closes, 20),
    rsi2: rsi(closes, 2),
    atr14: atr(bars, 14),
    bandwidth: bb.middle.map((m, i) => (m ? (bb.upper[i] - bb.lower[i]) / m : null)),
    vol20: sma(bars.map((b) => b.v ?? 0), 20),
    stamp: stamp(bars),
  };
  cache.set(bars, ind);
  return ind;
}

const uptrend = (ind, i) => ind.sma50[i] != null && ind.sma200[i] != null && ind.sma50[i] > ind.sma200[i];
const LONG_FILTERS = [["not_bear", "SPY above 200-day"], ["bull", "Strong uptrend"], ["off", "Any market"]];
const SHORT_FILTERS = [["bear", "SPY below 200-day"], ["not_bull", "Not a strong uptrend"], ["off", "Any market"]];
const BASE_SIZING = { risk_pct: 1, max_position_pct: 20, max_positions: 3 };

export const STRATEGIES = {
  bull_flag_breakout: {
    name: "Bull flag breakout",
    direction: "long",
    entry: "stop",
    description: "Finds a sharp rally followed by a tight pullback (the flag) and buys the break above the flag. Stop under the flag, target the measured move.",
    level_name: "the flag high",
    stop_label: "Stop under the flag",
    targets: [["pattern", "Measured move"], ["r2", "2R"], ["r3", "3R"]],
    filters: LONG_FILTERS,
    params: [
      { key: "min_pole_pct", label: "Pole at least", options: [6, 8, 12], suffix: "%", min: 4, max: 50 },
      { key: "max_retrace_pct", label: "Flag gives back at most", options: [38, 50, 62], suffix: "%", min: 20, max: 62 },
      { key: "max_flag_bars", label: "Flag at most", options: [10, 15, 20], suffix: " days", min: 3, max: 25 },
    ],
    config: { market_filter: "not_bear", pattern_params: { min_pole_pct: 8, max_retrace_pct: 50, max_flag_bars: 15 }, exit: { stop: "pattern", target: "pattern", time_stop_days: 15 } },
    setup(bars, end, p) {
      const f = flagEndingAt(bars, end, { ...BULL_FLAG_DEFAULTS, ...p });
      if (!f) return null;
      return {
        anchor: day(bars[f.flagStart].t),
        level: f.flagHigh,
        stop: f.flagLow,
        target: f.flagHigh + (f.poleTop - f.poleBottom),
        summary: `${f.flagEnd - f.flagStart + 1}-day flag after a +${round(f.poleGain, 1)}% pole`,
        info: { pole_pct: round(f.poleGain, 1), flag_bars: f.flagEnd - f.flagStart + 1, retrace_pct: round(f.retrace, 1) },
      };
    },
  },

  bear_flag_breakdown: {
    name: "Bear flag breakdown",
    direction: "short",
    entry: "stop",
    description: "Finds a sharp drop followed by a weak bounce (the flag) and sells short when price breaks below the flag. Stop above the flag, target 2R. Practice account only.",
    level_name: "the flag low",
    stop_label: "Stop above the flag",
    targets: [["pattern", "Measured move"], ["r2", "2R"], ["r3", "3R"]],
    filters: SHORT_FILTERS,
    params: [
      { key: "min_drop_pct", label: "Drop at least", options: [6, 8, 12], suffix: "%", min: 4, max: 50 },
      { key: "max_retrace_pct", label: "Bounce gives back at most", options: [38, 50, 62], suffix: "%", min: 20, max: 62 },
      { key: "max_flag_bars", label: "Flag at most", options: [10, 15, 20], suffix: " days", min: 3, max: 25 },
    ],
    // Backtest: SPY was below its 200-day too rarely to trade in 2 years, so the default only avoids strong uptrends
    config: { market_filter: "not_bull", pattern_params: { min_drop_pct: 8, max_retrace_pct: 50, max_flag_bars: 15 }, exit: { stop: "pattern", target: "r2", time_stop_days: 10 } },
    setup(bars, end, p) {
      const f = bearFlagEndingAt(bars, end, { ...BEAR_FLAG_DEFAULTS, ...p });
      if (!f) return null;
      return {
        anchor: day(bars[f.flagStart].t),
        level: f.flagLow,
        stop: f.flagHigh,
        target: f.flagLow - (f.poleHigh - f.poleLow),
        summary: `${f.flagEnd - f.flagStart + 1}-day bounce after a −${round(f.poleDrop, 1)}% drop`,
        info: { drop_pct: round(f.poleDrop, 1), flag_bars: f.flagEnd - f.flagStart + 1, retrace_pct: round(f.retrace, 1) },
      };
    },
  },

  high_breakout: {
    name: "New high breakout",
    direction: "long",
    entry: "stop",
    description: "Momentum: buys stocks in an uptrend as they break above their 20-day high (a Donchian or turtle-style breakout). Stop 2× ATR, target 3R or the time stop.",
    level_name: "the 20-day high",
    stop_label: "Stop under the 10-day low",
    targets: [["r2", "2R"], ["r3", "3R"]],
    filters: LONG_FILTERS,
    params: [
      { key: "lookback", label: "Break the high of the last", options: [20, 55], suffix: " days", min: 10, max: 100 },
      { key: "max_distance_pct", label: "Watch when within", options: [2, 3, 5], suffix: "%", min: 1, max: 10 },
    ],
    config: { market_filter: "not_bear", pattern_params: { lookback: 20, max_distance_pct: 3 }, exit: { stop: "atr", atr_mult: 2, target: "r3", time_stop_days: 20 } },
    setup(bars, end, p, ind) {
      const n = p.lookback ?? 20;
      if (end < Math.max(200, n) || !uptrend(ind, end) || bars[end].c < ind.sma50[end]) return null;
      const hi = maxOf(bars, end - n + 1, end, "h");
      if ((hi.value - bars[end].c) / bars[end].c > (p.max_distance_pct ?? 3) / 100) return null;
      const lo = minOf(bars, end - 9, end, "l");
      return { anchor: day(bars[hi.at].t), level: hi.value, stop: lo.value, target: null, summary: `${n}-day high ${usd(hi.value)} in an uptrend`, info: { lookback: n } };
    },
  },

  trend_pullback: {
    name: "Pullback in an uptrend",
    direction: "long",
    entry: "stop",
    description: "Buys the dip in a strong stock: price pulls back to its 20-day average while the 50-day is above the 200-day, then buys when it takes out the prior day's high. Stop 2× ATR, target 2R.",
    level_name: "the prior day's high",
    stop_label: "Stop under the 3-day low",
    targets: [["pattern", "Recent high"], ["r2", "2R"], ["r3", "3R"]],
    filters: LONG_FILTERS,
    params: [{ key: "min_pullback_pct", label: "Pullback at least", options: [3, 5, 8], suffix: "%", min: 2, max: 20 }],
    // Backtest: the 3-day-low stop was too tight (−0.13R a trade); 2× ATR with a 2R target was +0.10R
    config: { market_filter: "not_bear", pattern_params: { min_pullback_pct: 3 }, exit: { stop: "atr", atr_mult: 2, target: "r2", time_stop_days: 10 } },
    setup(bars, end, p, ind) {
      if (end < 210 || !uptrend(ind, end) || !(ind.sma50[end] > ind.sma50[end - 10]) || ind.ema20[end] == null) return null;
      const b = bars[end];
      const hi = maxOf(bars, end - 10, end, "h");
      const depth = ((hi.value - b.c) / hi.value) * 100;
      if (depth < (p.min_pullback_pct ?? 3) || b.l > ind.ema20[end] * 1.01 || b.c < ind.sma50[end] * 0.99) return null;
      const lo = minOf(bars, end - 2, end, "l");
      return { anchor: day(bars[hi.at].t), level: b.h, stop: lo.value, target: hi.value > b.h * 1.01 ? hi.value : null, summary: `Pulled back ${round(depth, 1)}% to the 20-day average`, info: { pullback_pct: round(depth, 1) } };
    },
  },

  rsi2_reversion: {
    name: "Oversold bounce",
    direction: "long",
    entry: "close",
    description: "Mean reversion: buys a stock above its 200-day after a sharp short-term drop (2-day RSI under 10) and sells when it closes back above its 5-day average.",
    level_name: "the close",
    stop_label: "Stop 2.5× ATR",
    targets: [["pattern", "Close above 5-day average"], ["r2", "2R"]],
    filters: LONG_FILTERS,
    params: [{ key: "rsi_below", label: "2-day RSI under", options: [5, 10, 15], suffix: "", min: 1, max: 30 }],
    config: { market_filter: "not_bear", pattern_params: { rsi_below: 10 }, exit: { stop: "pattern", target: "pattern", time_stop_days: 10 } },
    setup(bars, end, p, ind) {
      const r = ind.rsi2[end], a = ind.atr14[end];
      if (end < 200 || ind.sma200[end] == null || bars[end].c < ind.sma200[end] || r == null || r >= (p.rsi_below ?? 10) || !a) return null;
      return { anchor: day(bars[end].t), level: bars[end].c, stop: bars[end].c - 2.5 * a, target: null, exit_rule: "sma5", summary: `2-day RSI ${round(r, 1)} above the 200-day`, info: { rsi2: round(r, 1) } };
    },
  },

  squeeze_breakout: {
    name: "Volatility squeeze breakout",
    direction: "long",
    entry: "stop",
    description: "Finds stocks coiling in their tightest range in 6 months (narrowest Bollinger Bands) above the 50-day, and buys the break above the range. Target 2× the range.",
    level_name: "the top of the range",
    stop_label: "Stop under the range",
    targets: [["pattern", "2× the range"], ["r2", "2R"], ["r3", "3R"]],
    filters: LONG_FILTERS,
    params: [
      { key: "squeeze_days", label: "Tightest bands in", options: [60, 120], suffix: " days", min: 40, max: 250 },
      { key: "range_days", label: "Range of the last", options: [10, 15], suffix: " days", min: 5, max: 30 },
    ],
    config: { market_filter: "not_bear", pattern_params: { squeeze_days: 120, range_days: 10 }, exit: { stop: "pattern", target: "pattern", time_stop_days: 15 } },
    setup(bars, end, p, ind) {
      const look = p.squeeze_days ?? 120, rd = p.range_days ?? 10;
      if (end < Math.max(look, 60) || ind.sma50[end] == null || bars[end].c < ind.sma50[end]) return null;
      let minAll = Infinity, minAt = -1;
      for (let i = end - look + 1; i <= end; i++) if (ind.bandwidth[i] != null && ind.bandwidth[i] < minAll) (minAll = ind.bandwidth[i]), (minAt = i);
      if (minAt < end - 4) return null; // the squeeze must be happening now
      const hi = maxOf(bars, end - rd + 1, end, "h"), lo = minOf(bars, end - rd + 1, end, "l");
      if ((hi.value - lo.value) / hi.value > 0.12) return null; // a tight range, not a wide swing
      return { anchor: day(bars[minAt].t), level: hi.value, stop: lo.value, target: hi.value + 2 * (hi.value - lo.value), summary: `${rd}-day range ${round(((hi.value - lo.value) / hi.value) * 100, 1)}% wide, tightest bands in ${look} days`, info: { range_pct: round(((hi.value - lo.value) / hi.value) * 100, 1) } };
    },
  },
};

export const strategyFor = (key) => STRATEGIES[key] ?? STRATEGIES.bull_flag_breakout;
const dirOf = (st) => (st.direction === "short" ? -1 : 1);

/** Whether price `p` is through `level` in the strategy's direction (with an optional buffer, in %). */
export function through(st, p, level, bufferPct = 0) {
  return st.direction === "short" ? p <= level * (1 - bufferPct / 100) : p >= level * (1 + bufferPct / 100);
}

/**
 * The strategy's setup at the latest bar, for live scanning:
 *  - "triggered": a stop-entry setup from the bar before was broken on the latest close, or a close-entry
 *    signal fired on the latest close
 *  - "forming":   a stop-entry level to watch today
 */
export function currentSetup(st, bars, params, { volume_mult = 1.5 } = {}) {
  const ind = indicators(bars);
  const last = bars.length - 1;
  if (last < 30) return null;
  if (st.entry === "close") {
    const s = st.setup(bars, last, params, ind);
    return s && { ...s, status: "triggered", trigger_close: bars[last].c, volume_confirmed: true };
  }
  const prev = st.setup(bars, last - 1, params, ind);
  if (prev && through(st, bars[last].c, prev.level)) {
    const vm = (bars[last].v ?? 0) / (ind.vol20[last - 1] || 1);
    return { ...prev, status: "triggered", trigger_close: bars[last].c, volume_mult: round(vm, 2), volume_confirmed: vm >= volume_mult };
  }
  const now = st.setup(bars, last, params, ind);
  return now && { ...now, status: "forming", distance_pct: round((Math.abs(now.level - bars[last].c) / bars[last].c) * 100, 2) };
}

/** Stop price: the strategy's own (with a small buffer) or an ATR multiple from the entry level. */
export function stopPrice(st, setup, exit, atrValue) {
  const d = dirOf(st);
  if (exit.stop === "atr" && atrValue) return round(setup.level - d * (exit.atr_mult ?? 2) * atrValue);
  return round(setup.stop * (1 - d * 0.002));
}

/** Target price: the strategy's own, or a multiple of the risk. Null when the strategy exits by rule. */
export function targetPrice(st, setup, entry, stop, exit) {
  const risk = Math.abs(entry - stop);
  const d = dirOf(st);
  if (exit.target === "r2") return round(entry + d * 2 * risk);
  if (exit.target === "r3") return round(entry + d * 3 * risk);
  if (setup.target != null) return round(setup.target);
  return setup.exit_rule ? null : round(entry + d * 2 * risk);
}

/** R multiple of a trade (works for shorts too: there the stop is above the entry). */
export const rMultiple = (entry, stop, exit) => (exit - entry) / (entry - stop || 1);

/**
 * Replays one strategy on one ticker's bars. One trade at a time; fills at the level or the open on
 * gaps; stop is checked before target within a bar (conservative). Returns trades with R multiples.
 */
export function simulate(st, bars, cfg, { regimeAt = () => true, start = 60 } = {}) {
  const ind = indicators(bars);
  const params = cfg.pattern_params ?? {};
  const d = dirOf(st);
  const trades = [];
  let skippedRegime = 0;
  let i = start;
  while (i < bars.length - 1) {
    let setup = null, entryIdx = null, entry = null;
    if (st.entry === "close") {
      setup = st.setup(bars, i, params, ind);
      if (setup) (entryIdx = i + 1), (entry = bars[i + 1].o);
    } else {
      const s = st.setup(bars, i - 1, params, ind);
      if (s && cfg.entry.trigger === "intraday") {
        const lvl = s.level * (1 + d * (cfg.entry.buffer_pct ?? 0) / 100);
        if (d > 0 ? bars[i].h >= lvl : bars[i].l <= lvl) (setup = s), (entryIdx = i), (entry = d > 0 ? Math.max(bars[i].o, lvl) : Math.min(bars[i].o, lvl));
      } else if (s && through(st, bars[i].c, s.level)) {
        const volOk = !cfg.entry.require_volume || (bars[i].v ?? 0) >= (cfg.entry.volume_mult ?? 1.5) * (ind.vol20[i - 1] || Infinity);
        if (volOk) (setup = s), (entryIdx = i + 1), (entry = bars[i + 1].o);
      }
    }
    if (!setup) {
      i++;
      continue;
    }
    if (!regimeAt(bars[i].t)) {
      skippedRegime++;
      i++;
      continue;
    }
    const stop = stopPrice(st, setup, cfg.exit, ind.atr14[i]);
    if (!(d * (entry - stop) > 0)) {
      i++;
      continue;
    }
    const target = targetPrice(st, setup, entry, stop, cfg.exit);
    let exitIdx = null, exit = null, reason = null;
    for (let j = entryIdx; j < bars.length; j++) {
      const b = bars[j];
      const first = j === entryIdx;
      if (d > 0 ? b.l <= stop : b.h >= stop) {
        exit = first ? stop : d > 0 ? Math.min(b.o, stop) : Math.max(b.o, stop); // gaps through the stop fill at the open
        reason = "stop";
      } else if (target != null && (d > 0 ? b.h >= target : b.l <= target)) {
        exit = first ? target : d > 0 ? Math.max(b.o, target) : Math.min(b.o, target);
        reason = "target";
      } else if (setup.exit_rule === "sma5" && cfg.exit.target === "pattern" && ind.sma5[j] != null && b.c > ind.sma5[j] && !first) {
        exit = b.c;
        reason = "rule";
      } else if (cfg.exit.time_stop_days > 0 && j - entryIdx >= cfg.exit.time_stop_days) {
        exit = b.c;
        reason = "time";
      }
      if (exit != null) {
        exitIdx = j;
        break;
      }
    }
    if (exit == null) {
      exitIdx = bars.length - 1;
      exit = bars[exitIdx].c;
      reason = "open";
    }
    trades.push({ entry_date: day(bars[entryIdx].t), exit_date: day(bars[exitIdx].t), side: st.direction, entry: round(entry), stop: round(stop), target: round(target), exit: round(exit), r: round(rMultiple(entry, stop, exit), 2), reason, days: exitIdx - entryIdx });
    i = exitIdx + 1;
  }
  return { trades, skippedRegime };
}
