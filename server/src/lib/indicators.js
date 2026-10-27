// Technical indicators, computed in code from daily OHLCV bars (never by the LLM).
// bars: [{ t (ms), o, h, l, c, v }] oldest first. Series functions return arrays aligned to bars (null until defined).

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const last = (arr) => arr[arr.length - 1];

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** EMA seeded with the SMA of the first n values. Accepts leading nulls. */
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  const start = values.findIndex((v) => v != null);
  if (start < 0 || values.length - start < n) return out;
  let prev = values.slice(start, start + n).reduce((a, b) => a + b, 0) / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI with Wilder smoothing. */
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalN = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const signal = ema(line, signalN);
  const histogram = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, histogram };
}

export function bollinger(closes, n = 20, mult = 2) {
  const mid = sma(closes, n);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const window = closes.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(window.reduce((s, x) => s + (x - mid[i]) ** 2, 0) / n);
    upper.push(mid[i] + mult * sd);
    lower.push(mid[i] - mult * sd);
  }
  return { upper, middle: mid, lower };
}

/** Average True Range, Wilder smoothing. */
export function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  if (bars.length <= n) return out;
  let prev = tr.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  out[n] = prev;
  for (let i = n + 1; i < bars.length; i++) {
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

export function stochastic(bars, n = 14, d = 3) {
  const k = bars.map((b, i) => {
    if (i < n - 1) return null;
    const w = bars.slice(i - n + 1, i + 1);
    const hh = Math.max(...w.map((x) => x.h));
    const ll = Math.min(...w.map((x) => x.l));
    return hh === ll ? 50 : ((b.c - ll) / (hh - ll)) * 100;
  });
  const dLine = k.map((_, i) => (i < n - 1 + d - 1 ? null : k.slice(i - d + 1, i + 1).reduce((a, b) => a + b, 0) / d));
  return { k, d: dLine };
}

export function obv(bars) {
  const out = [0];
  for (let i = 1; i < bars.length; i++) {
    const dir = Math.sign(bars[i].c - bars[i - 1].c);
    out.push(out[i - 1] + dir * bars[i].v);
  }
  return out;
}

/** Swing highs/lows (local extremes over +-w bars), clustered into price levels within `tol`. */
export function supportResistance(bars, price, { lookback = 180, w = 5, tol = 0.015 } = {}) {
  const recent = bars.slice(-lookback);
  const pivots = [];
  for (let i = w; i < recent.length - w; i++) {
    const win = recent.slice(i - w, i + w + 1);
    if (recent[i].h === Math.max(...win.map((b) => b.h))) pivots.push(recent[i].h);
    if (recent[i].l === Math.min(...win.map((b) => b.l))) pivots.push(recent[i].l);
  }
  const clusters = [];
  for (const p of pivots.sort((a, b) => a - b)) {
    const c = clusters.find((x) => Math.abs(x.level - p) / x.level <= tol);
    if (c) {
      c.level = (c.level * c.touches + p) / (c.touches + 1);
      c.touches++;
    } else clusters.push({ level: p, touches: 1 });
  }
  const support = clusters.filter((c) => c.level < price).sort((a, b) => b.level - a.level).slice(0, 3);
  const resistance = clusters.filter((c) => c.level > price).sort((a, b) => a.level - b.level).slice(0, 3);
  const fmt = (c) => ({ level: round(c.level), touches: c.touches, distance_pct: round(((c.level - price) / price) * 100, 1) });
  return { support: support.map(fmt), resistance: resistance.map(fmt) };
}

/** Index of the most recent bar where `a` crossed above (dir=1) or below (dir=-1) `b`, within `within` bars. */
function recentCross(a, b, dir, within) {
  for (let i = a.length - 1; i > 0 && i >= a.length - within; i--) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].some((x) => x == null)) return -1;
    if (dir > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i]) return i;
    if (dir < 0 && a[i - 1] >= b[i - 1] && a[i] < b[i]) return i;
  }
  return -1;
}

const pctChange = (closes, n) => (closes.length > n ? ((last(closes) - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100 : null);

/**
 * Full technical snapshot for the latest bar: indicator values, key levels, trend, crossovers,
 * rule-based signals and an overall rating. All numbers here are what the Technical Analyst may cite.
 */
export function technicalSnapshot(bars) {
  if (!bars?.length || bars.length < 30) return null;
  const closes = bars.map((b) => b.c);
  const price = last(closes);
  const n = bars.length - 1;

  const s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200);
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const bb = bollinger(closes);
  const a = atr(bars);
  const st = stochastic(bars);
  const o = obv(bars);
  const vol20 = sma(bars.map((b) => b.v), 20);
  const yearBars = bars.slice(-252);
  const high52 = Math.max(...yearBars.map((b) => b.h));
  const low52 = Math.min(...yearBars.map((b) => b.l));

  const bandwidth = bb.upper.map((u, i) => (u != null ? (u - bb.lower[i]) / bb.middle[i] : null));
  const recentBw = bandwidth.slice(-126).filter((x) => x != null);
  const squeeze = recentBw.length > 20 && bandwidth[n] <= Math.min(...recentBw) * 1.05;

  const golden = recentCross(s50, s200, 1, 20);
  const death = recentCross(s50, s200, -1, 20);
  // If MACD whipsawed both ways within the window, only the most recent cross counts
  let macdUp = recentCross(m.line, m.signal, 1, 5);
  let macdDown = recentCross(m.line, m.signal, -1, 5);
  if (macdUp >= 0 && macdDown >= 0) macdUp > macdDown ? (macdDown = -1) : (macdUp = -1);
  const sma50Slope = s50[n] != null && s50[n - 20] != null ? ((s50[n] - s50[n - 20]) / s50[n - 20]) * 100 : null;
  const obvSlope = o[n] - o[Math.max(0, n - 20)];
  const volRatio = vol20[n] ? bars[n].v / vol20[n] : null;
  const levels = supportResistance(bars, price);

  let trend = "sideways";
  if (s50[n] != null && s200[n] != null) {
    if (price > s50[n] && s50[n] > s200[n] && sma50Slope > 0) trend = "uptrend";
    else if (price < s50[n] && s50[n] < s200[n] && sma50Slope < 0) trend = "downtrend";
  } else if (s50[n] != null) {
    trend = price > s50[n] && sma50Slope > 0 ? "uptrend" : price < s50[n] && sma50Slope < 0 ? "downtrend" : "sideways";
  }

  // Rule-based signals: each is a fact about the chart, with a bias
  const signals = [];
  const add = (id, label, bias) => signals.push({ id, label, bias });
  if (r[n] >= 70) add("rsi_overbought", `RSI(14) is ${round(r[n], 1)}, above 70 (overbought)`, "bearish");
  else if (r[n] <= 30) add("rsi_oversold", `RSI(14) is ${round(r[n], 1)}, below 30 (oversold)`, "bullish");
  if (s200[n] != null) add(price > s200[n] ? "above_sma200" : "below_sma200", `Price is ${price > s200[n] ? "above" : "below"} the 200-day average (${round(s200[n])})`, price > s200[n] ? "bullish" : "bearish");
  if (s50[n] != null) add(price > s50[n] ? "above_sma50" : "below_sma50", `Price is ${price > s50[n] ? "above" : "below"} the 50-day average (${round(s50[n])})`, price > s50[n] ? "bullish" : "bearish");
  if (golden >= 0) add("golden_cross", `Golden cross: the 50-day crossed above the 200-day ${n - golden} sessions ago`, "bullish");
  if (death >= 0) add("death_cross", `Death cross: the 50-day crossed below the 200-day ${n - death} sessions ago`, "bearish");
  if (macdUp >= 0) add("macd_bullish_cross", `MACD crossed above its signal line ${n - macdUp} sessions ago`, "bullish");
  if (macdDown >= 0) add("macd_bearish_cross", `MACD crossed below its signal line ${n - macdDown} sessions ago`, "bearish");
  if (bb.upper[n] != null && price > bb.upper[n]) add("above_upper_band", "Price closed above the upper Bollinger Band", "bearish");
  if (bb.lower[n] != null && price < bb.lower[n]) add("below_lower_band", "Price closed below the lower Bollinger Band", "bullish");
  if (squeeze) add("bollinger_squeeze", "Bollinger Bands are at their narrowest in 6 months (volatility squeeze)", "neutral");
  if (volRatio >= 2) add("volume_spike", `Volume was ${round(volRatio, 1)}x its 20-day average`, bars[n].c >= bars[n - 1].c ? "bullish" : "bearish");
  if (price >= high52 * 0.98) add("near_52w_high", "Price is within 2% of its 52-week high", "bullish");
  if (price <= low52 * 1.02) add("near_52w_low", "Price is within 2% of its 52-week low", "bearish");

  const score = signals.reduce((s, x) => s + (x.bias === "bullish" ? 1 : x.bias === "bearish" ? -1 : 0), 0);
  const bias = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";

  return {
    asOf: new Date(bars[n].t).toISOString().slice(0, 10),
    bars: bars.length,
    price: round(price),
    change_1d_pct: round(pctChange(closes, 1)),
    performance_pct: { "1w": round(pctChange(closes, 5)), "1m": round(pctChange(closes, 21)), "3m": round(pctChange(closes, 63)), "6m": round(pctChange(closes, 126)), "1y": round(pctChange(closes, 252)) },
    moving_averages: { sma20: round(s20[n]), sma50: round(s50[n]), sma200: round(s200[n]), ema12: round(e12[n]), ema26: round(e26[n]), sma50_slope_20d_pct: round(sma50Slope) },
    rsi14: round(r[n], 1),
    macd: { line: round(m.line[n], 3), signal: round(m.signal[n], 3), histogram: round(m.histogram[n], 3) },
    bollinger: { upper: round(bb.upper[n]), middle: round(bb.middle[n]), lower: round(bb.lower[n]), bandwidth_pct: round(bandwidth[n] * 100), percent_b: bb.upper[n] != null ? round((price - bb.lower[n]) / (bb.upper[n] - bb.lower[n]), 2) : null },
    stochastic: { k: round(st.k[n], 1), d: round(st.d[n], 1) },
    atr14: round(a[n]),
    atr_pct: a[n] != null ? round((a[n] / price) * 100) : null,
    volume: { last: bars[n].v, avg20: Math.round(vol20[n] ?? 0), ratio: round(volRatio) },
    obv_trend_20d: obvSlope > 0 ? "rising" : obvSlope < 0 ? "falling" : "flat",
    high_52w: round(high52),
    low_52w: round(low52),
    levels,
    trend,
    // Dates of recent crossovers (null if none in the window): alerts fire once per cross
    crosses: {
      golden: golden >= 0 ? new Date(bars[golden].t).toISOString().slice(0, 10) : null,
      death: death >= 0 ? new Date(bars[death].t).toISOString().slice(0, 10) : null,
      macd_bullish: macdUp >= 0 ? new Date(bars[macdUp].t).toISOString().slice(0, 10) : null,
      macd_bearish: macdDown >= 0 ? new Date(bars[macdDown].t).toISOString().slice(0, 10) : null,
    },
    signals,
    rating: { bias, score, bullish: signals.filter((s) => s.bias === "bullish").length, bearish: signals.filter((s) => s.bias === "bearish").length },
  };
}

/** Compact series for the app's chart: last `n` bars with overlays and RSI. */
export function chartSeries(bars, n = 180) {
  const closes = bars.map((b) => b.c);
  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const bb = bollinger(closes);
  const r = rsi(closes, 14);
  const start = Math.max(0, bars.length - n);
  return bars.slice(start).map((b, j) => {
    const i = start + j;
    return { t: b.t, o: round(b.o), h: round(b.h), l: round(b.l), c: round(b.c), v: b.v, sma50: round(s50[i]), sma200: round(s200[i]), bbUpper: round(bb.upper[i]), bbLower: round(bb.lower[i]), rsi: round(r[i], 1) };
  });
}
