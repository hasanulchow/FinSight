import { sma } from "./indicators.js";

// Chart pattern detection on daily bars ({ t, o, h, l, c, v }, oldest first). Pure functions, unit tested.
//
// Bull flag = a sharp rally (the pole) followed by a short, orderly pullback or sideways drift on
// lighter volume (the flag). The classic entry is a break above the flag's high; the stop goes under
// the flag's low and the textbook target adds the pole's height to the breakout (the measured move).

export const BULL_FLAG_DEFAULTS = {
  min_pole_pct: 8, // pole must gain at least this %
  min_pole_bars: 3,
  max_pole_bars: 12,
  min_flag_bars: 3,
  max_flag_bars: 15,
  max_retrace_pct: 50, // flag may give back at most this % of the pole
  max_flag_slope_pct: 0.3, // flag drift per bar (% of price): flat or down, not rising like a new leg
  volume_mult: 1.5, // breakout bar volume vs 20-day average (close-confirmed breakouts)
};

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const day = (t) => new Date(t).toISOString().slice(0, 10);

/** Least-squares slope of closes in [from, to], as % of the average price per bar. */
function slopePct(bars, from, to) {
  const n = to - from + 1;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    const y = bars[from + i].c;
    sx += i; sy += y; sxy += i * y; sxx += i * i;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return (slope / (sy / n)) * 100;
}

const avgVol = (bars, from, to) => {
  let s = 0;
  for (let i = from; i <= to; i++) s += bars[i].v ?? 0;
  return s / (to - from + 1);
};

/** The best valid flag that ends exactly at bar `end`, or null. */
export function flagEndingAt(bars, end, opts = {}) {
  const o = { ...BULL_FLAG_DEFAULTS, ...opts };
  let best = null;
  for (let L = o.min_flag_bars; L <= o.max_flag_bars; L++) {
    const fs = end - L + 1;
    const poleEnd = fs - 1;
    if (poleEnd - o.min_pole_bars < 0) break;
    const poleTop = bars[poleEnd].h;

    // Flag: stays under the pole top and holds most of the gain
    let flagHigh = -Infinity, flagLow = Infinity;
    for (let i = fs; i <= end; i++) {
      flagHigh = Math.max(flagHigh, bars[i].h);
      flagLow = Math.min(flagLow, bars[i].l);
    }
    if (flagHigh > poleTop * 1.01) continue;

    // Pole: the lowest low in the lookback window before the peak
    let poleStart = -1, poleBottom = Infinity;
    for (let i = Math.max(0, poleEnd - o.max_pole_bars); i <= poleEnd - o.min_pole_bars; i++) {
      if (bars[i].l < poleBottom) {
        poleBottom = bars[i].l;
        poleStart = i;
      }
    }
    if (poleStart < 0) continue;
    const poleGain = ((poleTop - poleBottom) / poleBottom) * 100;
    if (poleGain < o.min_pole_pct) continue;
    // The peak must be the high of the move (no higher high between the pole start and its end)
    let peakOk = true;
    for (let i = poleStart; i < poleEnd; i++) if (bars[i].h > poleTop) peakOk = false;
    if (!peakOk) continue;

    const retrace = ((poleTop - flagLow) / (poleTop - poleBottom)) * 100;
    if (retrace > o.max_retrace_pct) continue;
    const slope = slopePct(bars, fs, end);
    if (slope > o.max_flag_slope_pct) continue;

    const volRatio = avgVol(bars, fs, end) / (avgVol(bars, poleStart, poleEnd) || 1);
    // Prefer tight flags on fading volume
    const score = poleGain / 10 + (50 - retrace) / 25 + (volRatio < 1 ? 1 : 0) + Math.min(L, 8) / 8;
    if (!best || score > best.score) {
      best = {
        score,
        poleStart, poleEnd, flagStart: fs, flagEnd: end,
        poleBottom, poleTop, flagHigh, flagLow,
        poleGain, retrace, slope, volRatio,
      };
    }
  }
  return best;
}

function describe(bars, f, extra) {
  const height = f.poleTop - f.poleBottom;
  return {
    pattern: "bull_flag",
    pole: { start: day(bars[f.poleStart].t), end: day(bars[f.poleEnd].t), low: round(f.poleBottom), high: round(f.poleTop), gain_pct: round(f.poleGain, 1) },
    flag: { start: day(bars[f.flagStart].t), end: day(bars[f.flagEnd].t), bars: f.flagEnd - f.flagStart + 1, high: round(f.flagHigh), low: round(f.flagLow), retrace_pct: round(f.retrace, 1), volume_vs_pole: round(f.volRatio, 2) },
    breakout_level: round(f.flagHigh),
    stop_level: round(f.flagLow),
    target_measured_move: round(f.flagHigh + height),
    quality: f.volRatio < 1 && f.retrace <= 38.2 ? "high" : f.retrace <= 50 ? "medium" : "low",
    ...extra,
  };
}

/**
 * Bull flag status at bar `end` (default: the last bar):
 *  - "breakout": bar `end` closed above the high of a flag that ended the bar before, on strong volume
 *  - "forming":  a valid flag ends at `end`; watch for a break above `breakout_level`
 * Returns null when there's no setup.
 */
export function detectBullFlag(bars, { end = bars.length - 1, ...opts } = {}) {
  const o = { ...BULL_FLAG_DEFAULTS, ...opts };
  if (end < 30) return null;
  const prev = flagEndingAt(bars, end - 1, o);
  if (prev && bars[end].c > prev.flagHigh) {
    const vol20 = avgVol(bars, Math.max(0, end - 20), end - 1);
    const volMult = (bars[end].v ?? 0) / (vol20 || 1);
    return describe(bars, prev, { status: "breakout", breakout_date: day(bars[end].t), breakout_close: round(bars[end].c), breakout_volume_mult: round(volMult, 2), volume_confirmed: volMult >= o.volume_mult });
  }
  const now = flagEndingAt(bars, end, o);
  if (now) return describe(bars, now, { status: "forming", last_close: round(bars[end].c), distance_to_breakout_pct: round(((now.flagHigh - bars[end].c) / bars[end].c) * 100, 2) });
  return null;
}

// ---------- Bear flag ----------
// The mirror image: a sharp drop (the pole) and a short, weak bounce (the flag). The entry is a break
// below the flag's low, the stop goes above the flag's high, and the target subtracts the pole's height.
// Detected by running the bull flag logic on inverted prices (1/p): a drop becomes a rally of about the
// same size, and highs and lows swap.

export const BEAR_FLAG_DEFAULTS = { ...BULL_FLAG_DEFAULTS, min_drop_pct: 8 };
const inverted = new WeakMap();
function invert(bars) {
  let r = inverted.get(bars);
  if (r?.length !== bars.length || r[r.length - 1]?.t !== bars[bars.length - 1]?.t) {
    r = bars.map((b) => ({ t: b.t, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c, v: b.v }));
    inverted.set(bars, r);
  }
  return r;
}

/** The best valid bear flag that ends exactly at bar `end`, in real prices, or null. */
export function bearFlagEndingAt(bars, end, opts = {}) {
  const { min_drop_pct = BEAR_FLAG_DEFAULTS.min_drop_pct, ...rest } = opts;
  const f = flagEndingAt(invert(bars), end, { ...rest, min_pole_pct: (1 / (1 - min_drop_pct / 100) - 1) * 100 });
  if (!f) return null;
  const poleHigh = 1 / f.poleBottom, poleLow = 1 / f.poleTop;
  return { ...f, poleHigh, poleLow, flagHigh: 1 / f.flagLow, flagLow: 1 / f.flagHigh, poleDrop: ((poleHigh - poleLow) / poleHigh) * 100 };
}

function describeBear(bars, f, extra) {
  return {
    pattern: "bear_flag",
    pole: { start: day(bars[f.poleStart].t), end: day(bars[f.poleEnd].t), high: round(f.poleHigh), low: round(f.poleLow), drop_pct: round(f.poleDrop, 1) },
    flag: { start: day(bars[f.flagStart].t), end: day(bars[f.flagEnd].t), bars: f.flagEnd - f.flagStart + 1, high: round(f.flagHigh), low: round(f.flagLow), retrace_pct: round(f.retrace, 1), volume_vs_pole: round(f.volRatio, 2) },
    breakdown_level: round(f.flagLow),
    stop_level: round(f.flagHigh),
    target_measured_move: round(f.flagLow - (f.poleHigh - f.poleLow)),
    quality: f.volRatio < 1 && f.retrace <= 38.2 ? "high" : f.retrace <= 50 ? "medium" : "low",
    ...extra,
  };
}

/** Bear flag status at bar `end`: "breakdown" (closed below the flag low) or "forming". Null when there's no setup. */
export function detectBearFlag(bars, { end = bars.length - 1, ...opts } = {}) {
  const o = { ...BEAR_FLAG_DEFAULTS, ...opts };
  if (end < 30) return null;
  const prev = bearFlagEndingAt(bars, end - 1, o);
  if (prev && bars[end].c < prev.flagLow) {
    const vol20 = avgVol(bars, Math.max(0, end - 20), end - 1);
    const volMult = (bars[end].v ?? 0) / (vol20 || 1);
    return describeBear(bars, prev, { status: "breakdown", breakdown_date: day(bars[end].t), breakdown_close: round(bars[end].c), breakdown_volume_mult: round(volMult, 2), volume_confirmed: volMult >= o.volume_mult });
  }
  const now = bearFlagEndingAt(bars, end, o);
  if (now) return describeBear(bars, now, { status: "forming", last_close: round(bars[end].c), distance_to_breakdown_pct: round(((bars[end].c - now.flagLow) / bars[end].c) * 100, 2) });
  return null;
}

/**
 * Market regime from SPY bars at index `end`:
 * "bull" = above a rising 50-day that is above the 200-day; "bear" = below the 200-day; else "neutral".
 * Pass precomputed { sma50, sma200 } arrays when calling in a loop.
 */
export function marketRegime(spyBars, { end = spyBars.length - 1, sma50, sma200 } = {}) {
  const closes = spyBars.map((b) => b.c);
  const s50 = sma50 ?? sma(closes, 50);
  const s200 = sma200 ?? sma(closes, 200);
  const c = closes[end], a = s50[end], b = s200[end], a20 = s50[end - 20];
  if (a == null || b == null) return { state: "unknown", reasons: ["Not enough SPY history"] };
  const reasons = [`SPY ${c > a ? "above" : "below"} its 50-day (${round(a)})`, `50-day ${a > b ? "above" : "below"} the 200-day (${round(b)})`];
  const state = c > a && a > b && (a20 == null || a >= a20) ? "bull" : c < b ? "bear" : "neutral";
  return { state, close: round(c), sma50: round(a), sma200: round(b), reasons };
}

/** Market filters: long strategies use "bull" or "not_bear", short strategies "bear" or "not_bull". */
export const regimePasses = (filter, state) => {
  if (filter === "bull") return state === "bull";
  if (filter === "not_bear") return state !== "bear";
  if (filter === "bear") return state === "bear";
  if (filter === "not_bull") return state !== "bull";
  return true;
};
