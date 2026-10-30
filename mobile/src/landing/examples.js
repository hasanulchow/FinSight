// Illustrative data for the landing page. Deterministic, generated on the client, and always labeled
// as an example in the UI: the landing page never shows made-up numbers as real market data.

export function exampleCandles() {
  let p = 182;
  const out = [];
  for (let i = 0; i < 260; i++) {
    const drift = 0.0011 + 0.012 * Math.sin(i / 17) * 0.4 + 0.006 * Math.sin(i / 5.3);
    const o = p;
    p = p * (1 + drift + 0.004 * Math.cos(i * 1.7));
    const h = Math.max(o, p) * (1 + 0.006 + 0.003 * Math.abs(Math.sin(i)));
    const l = Math.min(o, p) * (1 - 0.006 - 0.003 * Math.abs(Math.cos(i)));
    out.push({ t: Date.UTC(2025, 0, 2) + i * 86_400_000, o, h, l, c: p, v: 4e7 * (1 + 0.5 * Math.abs(Math.sin(i / 3))) });
  }
  const closes = out.map((b) => b.c);
  const sma = (n, i) => (i >= n - 1 ? closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n : null);
  let gain = 0, loss = 0;
  return out.map((b, i) => {
    if (i > 0) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * 13 + Math.max(d, 0)) / 14;
      loss = (loss * 13 + Math.max(-d, 0)) / 14;
    }
    const m20 = sma(20, i);
    const sd = m20 ? Math.sqrt(closes.slice(i - 19, i + 1).reduce((s, x) => s + (x - m20) ** 2, 0) / 20) : null;
    const r = (x) => (x == null ? null : Number(x.toFixed(2)));
    return { ...b, o: r(b.o), h: r(b.h), l: r(b.l), c: r(b.c), sma50: r(sma(50, i)), sma200: r(sma(200, i)), bbUpper: r(m20 && m20 + 2 * sd), bbLower: r(m20 && m20 - 2 * sd), rsi: i > 14 && loss ? r(100 - 100 / (1 + gain / loss)) : null };
  });
}

function bsPrice(type, S, K, T, sigma, r = 0.04) {
  const erf = (x) => {
    const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  };
  const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return type === "call" ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
}

export function exampleCondor() {
  const S = 200, sigma = 0.28, T = 30 / 365;
  const legs = [["put", 1, 180], ["put", -1, 190], ["call", -1, 210], ["call", 1, 220]].map(([type, q, K]) => ({ type, q, K, prem: bsPrice(type, S, K, T, sigma) }));
  const payoff = (p, t) => legs.reduce((sum, l) => sum + 100 * l.q * ((t > 0 ? bsPrice(l.type, p, l.K, t, sigma) : Math.max(0, l.type === "call" ? p - l.K : l.K - p)) - l.prem), 0);
  const curve = Array.from({ length: 121 }, (_, i) => {
    const p = 165 + (70 * i) / 120;
    return { price: Number(p.toFixed(2)), expiry: Number(payoff(p, 0).toFixed(2)), today: Number(payoff(p, T * 0.6).toFixed(2)) };
  });
  const credit = -legs.reduce((sum, l) => sum + l.q * l.prem, 0);
  return { curve, breakevens: [Number((190 - credit).toFixed(2)), Number((210 + credit).toFixed(2))], move: { low: 184, high: 216 } };
}

export const EXAMPLE_TILES = [
  ["AAPL", "Technology", 1.2, 3.4], ["MSFT", "Technology", 0.8, 3.1], ["NVDA", "Semiconductors", 2.6, 2.9], ["AVGO", "Semiconductors", -0.9, 1.1],
  ["AMD", "Semiconductors", 3.1, 0.4], ["GOOGL", "Media", 0.4, 2.1], ["META", "Media", -1.4, 1.5], ["AMZN", "Retail", 1.7, 2.0],
  ["WMT", "Retail", 0.3, 0.7], ["COST", "Retail", -0.6, 0.4], ["JPM", "Banking", -1.1, 0.7], ["BAC", "Banking", -2.2, 0.3],
  ["V", "Financial Services", 0.6, 0.6], ["MA", "Financial Services", 0.9, 0.5], ["LLY", "Pharmaceuticals", -2.8, 0.8], ["JNJ", "Pharmaceuticals", 0.2, 0.4],
  ["XOM", "Energy", 2.2, 0.5], ["CVX", "Energy", 1.5, 0.3],
].map(([ticker, sector, change_pct, weight]) => ({ ticker, sector, change_pct, weight }));

