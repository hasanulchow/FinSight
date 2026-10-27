// Options math, all in code: Black-Scholes pricing and greeks, implied volatility,
// historical volatility, lognormal probabilities and multi-leg strategy analysis.
// Conventions: S spot, K strike, T years, r risk-free rate, q dividend yield, sigma annualized volatility.

export const RISK_FREE = Number(process.env.RISK_FREE_RATE || 0.04);
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

// Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf, |error| < 1.5e-7) and PDF
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
export const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Black-Scholes(-Merton) price and greeks. theta per calendar day, vega and rho per 1 percentage point. */
export function blackScholes({ type, S, K, T, sigma, r = RISK_FREE, q = 0 }) {
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
    return { price: intrinsic, delta: type === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  const call = type === "call";
  const price = call ? S * dq * normCdf(d1) - K * dr * normCdf(d2) : K * dr * normCdf(-d2) - S * dq * normCdf(-d1);
  const delta = call ? dq * normCdf(d1) : -dq * normCdf(-d1);
  const gamma = (dq * normPdf(d1)) / (S * sigma * sqT);
  const thetaYear = call
    ? (-S * dq * normPdf(d1) * sigma) / (2 * sqT) - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1)
    : (-S * dq * normPdf(d1) * sigma) / (2 * sqT) + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1);
  const vega = S * dq * normPdf(d1) * sqT;
  const rho = call ? K * T * dr * normCdf(d2) : -K * T * dr * normCdf(-d2);
  return { price, delta, gamma, theta: thetaYear / 365, vega: vega / 100, rho: rho / 100 };
}

/** Implied volatility from an option price (bisection: robust for deep ITM/OTM). Null if no solution. */
export function impliedVol({ type, price, S, K, T, r = RISK_FREE, q = 0 }) {
  if (!(price > 0) || T <= 0) return null;
  const intrinsic = type === "call" ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T));
  if (price < intrinsic - 1e-6) return null;
  let lo = 0.001, hi = 5;
  if (blackScholes({ type, S, K, T, sigma: hi, r, q }).price < price) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholes({ type, S, K, T, sigma: mid, r, q }).price > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

/** Annualized close-to-close historical volatility over the last `n` sessions. */
export function historicalVol(bars, n = 20) {
  if (!bars || bars.length < n + 1) return null;
  const closes = bars.slice(-(n + 1)).map((b) => b.c);
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

/** Probability (risk-neutral, lognormal) that the price ends above `level` at T. */
export function probAbove({ S, level, T, sigma, r = RISK_FREE, q = 0 }) {
  if (T <= 0 || sigma <= 0) return S > level ? 1 : 0;
  const d2 = (Math.log(S / level) + (r - q - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normCdf(d2);
}

/** One-standard-deviation expected move by expiration: S * sigma * sqrt(T). */
export function expectedMove({ S, sigma, T }) {
  const move = S * sigma * Math.sqrt(T);
  return { move: round(move), pct: round((move / S) * 100), low: round(S - move), high: round(S + move) };
}

// ---------- Strategies ----------
// A leg: { kind: "call" | "put" | "stock", side: "long" | "short", strike?, qty (contracts or 100-share lots), premium? (per share) }
const legSign = (leg) => (leg.side === "long" ? 1 : -1);

function legPayoffAtExpiry(leg, price) {
  const mult = 100 * leg.qty * legSign(leg);
  if (leg.kind === "stock") return mult * (price - leg.premium); // premium = entry price for stock legs
  const intrinsic = leg.kind === "call" ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price);
  return mult * (intrinsic - leg.premium);
}

function legValueNow(leg, price, T, sigma) {
  const mult = 100 * leg.qty * legSign(leg);
  if (leg.kind === "stock") return mult * (price - leg.premium);
  return mult * (blackScholes({ type: leg.kind, S: price, K: leg.strike, T, sigma }).price - leg.premium);
}

/**
 * Full analysis of a multi-leg position: payoff curves (at expiration and today), breakevens,
 * max profit/loss (with unbounded detection), probability of profit, net debit/credit and position greeks.
 */
export function analyzeStrategy({ legs, S, T, sigma }) {
  const strikes = legs.filter((l) => l.strike).map((l) => l.strike);
  const span = Math.max(S * sigma * Math.sqrt(Math.max(T, 1 / 365)) * 3, S * 0.15);
  const lo = Math.max(0.01, Math.min(S - span, ...strikes.map((k) => k * 0.85)));
  const hi = Math.max(S + span, ...strikes.map((k) => k * 1.15));
  const N = 120;
  const prices = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N);
  const atExpiry = (p) => legs.reduce((s, l) => s + legPayoffAtExpiry(l, p), 0);
  const today = (p) => legs.reduce((s, l) => s + legValueNow(l, p, T, sigma), 0);
  const curve = prices.map((p) => ({ price: round(p), expiry: round(atExpiry(p)), today: round(today(p)) }));

  // Breakevens: sign changes of the expiry payoff, refined by bisection
  const breakevens = [];
  for (let i = 0; i < prices.length - 1; i++) {
    const a = atExpiry(prices[i]), b = atExpiry(prices[i + 1]);
    if (a === 0) breakevens.push(prices[i]);
    else if (a * b < 0) {
      let x0 = prices[i], x1 = prices[i + 1];
      for (let j = 0; j < 50; j++) {
        const m = (x0 + x1) / 2;
        if (atExpiry(x0) * atExpiry(m) <= 0) x1 = m;
        else x0 = m;
      }
      breakevens.push((x0 + x1) / 2);
    }
  }

  // Max profit/loss: slopes beyond the last strike tell us if either side is unbounded
  const netCalls = legs.reduce((s, l) => s + (l.kind === "call" ? legSign(l) * l.qty : 0), 0);
  const netStock = legs.reduce((s, l) => s + (l.kind === "stock" ? legSign(l) * l.qty : 0), 0);
  const upSlope = netCalls + netStock; // payoff slope as price -> infinity
  const candidates = [0.01, ...strikes, hi].map(atExpiry);
  const maxProfit = upSlope > 0 ? null : Math.max(...candidates);
  const maxLoss = upSlope < 0 ? null : Math.min(...candidates); // downside is bounded at price 0

  // Probability of profit at expiration: lognormal mass where the payoff is positive (integrated on a fine grid)
  let pop = 0;
  const M = 400, pLo = 0.01, pHi = S * Math.exp(6 * sigma * Math.sqrt(Math.max(T, 1 / 365)));
  for (let i = 0; i < M; i++) {
    const p1 = pLo + ((pHi - pLo) * i) / M, p2 = pLo + ((pHi - pLo) * (i + 1)) / M;
    if (atExpiry((p1 + p2) / 2) > 0) pop += probAbove({ S, level: p1, T, sigma }) - probAbove({ S, level: p2, T, sigma });
  }
  if (atExpiry(pHi) > 0) pop += probAbove({ S, level: pHi, T, sigma });

  const netPremium = legs.reduce((s, l) => s + (l.kind === "stock" ? 0 : -legSign(l) * l.premium * 100 * l.qty), 0);
  const greeks = legs.reduce(
    (g, l) => {
      if (l.kind === "stock") return { ...g, delta: g.delta + legSign(l) * l.qty * 100 };
      const x = blackScholes({ type: l.kind, S, K: l.strike, T, sigma });
      const m = legSign(l) * l.qty * 100;
      return { delta: g.delta + m * x.delta, gamma: g.gamma + m * x.gamma, theta: g.theta + m * x.theta, vega: g.vega + m * x.vega };
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 }
  );

  return {
    curve,
    breakevens: breakevens.map((b) => round(b)),
    max_profit: maxProfit == null ? null : round(maxProfit),
    max_loss: maxLoss == null ? null : round(maxLoss),
    unbounded_profit: maxProfit == null,
    unbounded_loss: maxLoss == null,
    probability_of_profit: round(pop * 100, 1),
    net_premium: round(netPremium), // > 0 credit received, < 0 debit paid
    position_greeks: { delta: round(greeks.delta, 1), gamma: round(greeks.gamma, 3), theta_per_day: round(greeks.theta), vega_per_1pct: round(greeks.vega) },
  };
}

/** Closest strike in `strikes` to `target`. */
export const nearestStrike = (strikes, target) => strikes.reduce((best, k) => (Math.abs(k - target) < Math.abs(best - target) ? k : best), strikes[0]);

export const STRATEGIES = {
  long_call: { label: "Long call", view: "Bullish", risk: "Limited to premium" },
  long_put: { label: "Long put", view: "Bearish", risk: "Limited to premium" },
  covered_call: { label: "Covered call", view: "Neutral to mildly bullish", risk: "Stock downside, capped upside" },
  cash_secured_put: { label: "Cash-secured put", view: "Neutral to bullish", risk: "Obligation to buy at the strike" },
  protective_put: { label: "Protective put", view: "Bullish with insurance", risk: "Limited to premium plus distance to strike" },
  bull_call_spread: { label: "Bull call spread", view: "Moderately bullish", risk: "Limited to net debit" },
  bear_put_spread: { label: "Bear put spread", view: "Moderately bearish", risk: "Limited to net debit" },
  long_straddle: { label: "Long straddle", view: "Big move either way", risk: "Limited to premium" },
  long_strangle: { label: "Long strangle", view: "Very big move either way", risk: "Limited to premium" },
  iron_condor: { label: "Iron condor", view: "Range-bound", risk: "Limited to width minus credit" },
};

/**
 * Builds legs for a template around the spot price. `price(kind, strike)` returns the option premium
 * (market or model). Strikes snap to the listed strikes; widths scale with the expected move.
 */
export function buildStrategy(name, { S, strikes, move, price }) {
  const atm = nearestStrike(strikes, S);
  const up = (n) => nearestStrike(strikes.filter((k) => k > atm), atm + n * move) ?? atm;
  const down = (n) => nearestStrike(strikes.filter((k) => k < atm), atm - n * move) ?? atm;
  const opt = (kind, side, strike) => ({ kind, side, strike, qty: 1, premium: round(price(kind, strike)) });
  const stock = { kind: "stock", side: "long", qty: 1, premium: round(S) };
  switch (name) {
    case "long_call": return [opt("call", "long", atm)];
    case "long_put": return [opt("put", "long", atm)];
    case "covered_call": return [stock, opt("call", "short", up(0.5))];
    case "cash_secured_put": return [opt("put", "short", down(0.5))];
    case "protective_put": return [stock, opt("put", "long", down(0.5))];
    case "bull_call_spread": return [opt("call", "long", atm), opt("call", "short", up(1))];
    case "bear_put_spread": return [opt("put", "long", atm), opt("put", "short", down(1))];
    case "long_straddle": return [opt("call", "long", atm), opt("put", "long", atm)];
    case "long_strangle": return [opt("call", "long", up(0.5)), opt("put", "long", down(0.5))];
    case "iron_condor": return [opt("put", "long", down(1.5)), opt("put", "short", down(0.75)), opt("call", "short", up(0.75)), opt("call", "long", up(1.5))];
    default: throw Object.assign(new Error(`Unknown strategy. Use one of: ${Object.keys(STRATEGIES).join(", ")}`), { status: 400 });
  }
}
