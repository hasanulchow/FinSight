import { massiveGet, getDailyBars } from "../tools/prices.js";
import { getQuoteLite } from "../tools/quote.js";
import { cached } from "./cache.js";
import { technicalSnapshot } from "./indicators.js";
import { blackScholes, impliedVol, historicalVol, expectedMove, probAbove, analyzeStrategy, buildStrategy, nearestStrike, STRATEGIES, RISK_FREE } from "./optionsMath.js";

// Options overview for one underlying and expiration.
//   Paid Massive options plans: the real chain snapshot (bid/ask, IV, greeks, open interest, volume).
//   Free plan: contract list + previous-day prices of the at-the-money call and put -> implied volatility,
//   then every strike is priced with Black-Scholes at that IV ("model" values, clearly labeled).

const CACHE_MINUTES = 6 * 60;
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));

let snapshotEntitled = true; // flips to false after a 403, so free plans don't waste calls on it
let entitlementCheckedAt = 0;

async function listContracts(ticker, expiration) {
  const horizon = new Date(Date.now() + 75 * 86_400_000).toISOString().slice(0, 10);
  const q = expiration ? `expiration_date=${expiration}` : `expiration_date.gte=${today()}&expiration_date.lte=${horizon}`;
  const body = await massiveGet(`/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(ticker)}&expired=false&${q}&order=asc&sort=expiration_date&limit=1000`);
  return (body.results ?? []).map((c) => ({ ticker: c.ticker, type: c.contract_type, strike: c.strike_price, expiration: c.expiration_date, shares: c.shares_per_contract ?? 100 }));
}

async function chainSnapshot(ticker, expiration) {
  if (!snapshotEntitled && Date.now() - entitlementCheckedAt < 6 * 3_600_000) return null;
  try {
    const body = await massiveGet(`/v3/snapshot/options/${encodeURIComponent(ticker)}?expiration_date=${expiration}&limit=250`);
    snapshotEntitled = true;
    return (body.results ?? []).map((r) => ({
      type: r.details?.contract_type,
      strike: r.details?.strike_price,
      bid: r.last_quote?.bid ?? null,
      ask: r.last_quote?.ask ?? null,
      mid: r.last_quote?.midpoint ?? r.day?.close ?? null,
      last: r.day?.close ?? null,
      volume: r.day?.volume ?? 0,
      open_interest: r.open_interest ?? 0,
      iv: r.implied_volatility ?? null,
      greeks: r.greeks ?? null,
      underlying: r.underlying_asset?.price ?? null,
    }));
  } catch (err) {
    if (err.status === 403) {
      snapshotEntitled = false;
      entitlementCheckedAt = Date.now();
      return null;
    }
    throw err;
  }
}

async function prevClose(optionTicker) {
  try {
    const body = await massiveGet(`/v2/aggs/ticker/${encodeURIComponent(optionTicker)}/prev`);
    return body.results?.[0]?.c ?? null;
  } catch {
    return null;
  }
}

/** Max pain: the strike where option holders' total payout at expiration would be smallest (needs open interest). */
function maxPain(rows) {
  const strikes = [...new Set(rows.map((r) => r.strike))];
  let best = null;
  for (const K of strikes) {
    const pain = rows.reduce((s, r) => s + r.open_interest * (r.type === "call" ? Math.max(0, K - r.strike) : Math.max(0, r.strike - K)), 0);
    if (!best || pain < best.pain) best = { strike: K, pain };
  }
  return best?.strike ?? null;
}

async function computeOverview(ticker, expiration) {
  const bars = await getDailyBars(ticker);
  if (!bars.length) throw Object.assign(new Error(`No price history for ${ticker}`), { status: 404 });
  // Spot must be as fresh as the option prices, or implied vol is skewed: prefer the live quote over the last daily bar
  const quote = await getQuoteLite(ticker).catch(() => null);
  const S = quote?.price ?? bars[bars.length - 1].c;
  const spotAsOf = quote ? new Date().toISOString().slice(0, 10) : new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
  const tech = technicalSnapshot(bars);
  const hv20 = historicalVol(bars, 20), hv60 = historicalVol(bars, 60);

  const contracts = await listContracts(ticker);
  if (!contracts.length) throw Object.assign(new Error(`${ticker} has no listed options`), { status: 404 });
  const expirations = [...new Set(contracts.map((c) => c.expiration))].sort();
  // Default: the first expiration at least 5 days out (weeklies expiring tomorrow are noisy)
  const exp = expiration && expirations.includes(expiration) ? expiration : expirations.find((e) => daysBetween(today(), e) >= 5) ?? expirations[0];
  let forExp = contracts.filter((c) => c.expiration === exp);
  if (expiration && !forExp.length) forExp = await listContracts(ticker, expiration);
  const strikes = [...new Set(forExp.map((c) => c.strike))].sort((a, b) => a - b);
  const dte = daysBetween(today(), exp);
  const T = Math.max(dte, 0.5) / 365;
  const atm = nearestStrike(strikes, S);

  // 1. Real chain if the plan includes it
  const snap = await chainSnapshot(ticker, exp);
  let source, atmIv, rows;
  if (snap?.length) {
    source = "market";
    const atmRows = snap.filter((r) => r.strike === atm && r.iv);
    atmIv = atmRows.length ? atmRows.reduce((s, r) => s + r.iv, 0) / atmRows.length : hv20;
    rows = snap;
  } else {
    // 2. Free plan: price the ATM call and put, back out implied vol
    source = "model";
    const atmCall = forExp.find((c) => c.strike === atm && c.type === "call");
    const atmPut = forExp.find((c) => c.strike === atm && c.type === "put");
    const [callPx, putPx] = await Promise.all([atmCall ? prevClose(atmCall.ticker) : null, atmPut ? prevClose(atmPut.ticker) : null]);
    const ivs = [
      callPx && impliedVol({ type: "call", price: callPx, S, K: atm, T }),
      putPx && impliedVol({ type: "put", price: putPx, S, K: atm, T }),
    ].filter(Boolean);
    atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
    rows = null;
    var atmPrices = { call: callPx, put: putPx };
  }
  const ivSource = atmIv ? (source === "market" ? "market chain" : "at-the-money option prices") : "historical volatility (no option prices available)";
  const sigma = atmIv ?? hv20 ?? 0.3;

  // Chain: strikes within about +-2.5 expected moves (max 25 each side of ATM)
  const em = expectedMove({ S, sigma, T });
  const band = strikes.filter((k) => Math.abs(k - S) <= Math.max(em.move * 2.5, S * 0.05));
  const centered = band.length > 50 ? band.slice(Math.max(0, band.indexOf(atm) - 25), band.indexOf(atm) + 26) : band;
  const chain = centered.map((K) => {
    const side = (type) => {
      const real = rows?.find((r) => r.strike === K && r.type === type);
      const model = blackScholes({ type, S, K, T, sigma: real?.iv ?? sigma });
      return {
        price: round(real?.mid ?? model.price),
        bid: real?.bid ?? null,
        ask: real?.ask ?? null,
        iv: round((real?.iv ?? sigma) * 100, 1),
        delta: round(real?.greeks?.delta ?? model.delta, 3),
        gamma: round(real?.greeks?.gamma ?? model.gamma, 4),
        theta: round(real?.greeks?.theta ?? model.theta, 3),
        vega: round(real?.greeks?.vega ?? model.vega, 3),
        volume: real?.volume ?? null,
        open_interest: real?.open_interest ?? null,
        prob_itm: round((type === "call" ? probAbove({ S, level: K, T, sigma }) : 1 - probAbove({ S, level: K, T, sigma })) * 100, 1),
      };
    };
    return { strike: K, call: side("call"), put: side("put") };
  });

  // Market-wide stats only exist with real volume/OI
  let flow = null;
  if (rows?.length) {
    const sum = (type, k) => rows.filter((r) => r.type === type).reduce((s, r) => s + (r[k] ?? 0), 0);
    flow = {
      put_call_volume_ratio: sum("call", "volume") ? round(sum("put", "volume") / sum("call", "volume")) : null,
      put_call_oi_ratio: sum("call", "open_interest") ? round(sum("put", "open_interest") / sum("call", "open_interest")) : null,
      max_pain: maxPain(rows),
      total_open_interest: sum("call", "open_interest") + sum("put", "open_interest"),
    };
  }

  // Probabilities of reaching the chart's key levels by expiration
  const levels = [
    ...(tech?.levels.resistance ?? []).slice(0, 2).map((l) => ({ label: "resistance", level: l.level })),
    ...(tech?.levels.support ?? []).slice(0, 2).map((l) => ({ label: "support", level: l.level })),
    { label: "+1 expected move", level: em.high },
    { label: "-1 expected move", level: em.low },
  ].map((x) => ({ ...x, prob_above: round(probAbove({ S, level: x.level, T, sigma }) * 100, 1) }));

  return {
    ticker,
    spot: round(S),
    spot_as_of: spotAsOf,
    expiration: exp,
    expirations: expirations.slice(0, 12),
    dte,
    data_source: source, // "market" = real chain; "model" = Black-Scholes at the ATM implied volatility
    atm_strike: atm,
    atm_prices: source === "model" ? atmPrices : null,
    iv: round(sigma * 100, 1),
    iv_source: ivSource,
    hv20: round(hv20 * 100, 1),
    hv60: round(hv60 * 100, 1),
    iv_vs_hv: atmIv && hv20 ? round(atmIv / hv20, 2) : null,
    expected_move: em,
    straddle_price: source === "model" && atmPrices.call && atmPrices.put ? round(atmPrices.call + atmPrices.put) : chain.find((c) => c.strike === atm) ? round(chain.find((c) => c.strike === atm).call.price + chain.find((c) => c.strike === atm).put.price) : null,
    levels,
    flow,
    chain,
    strikes,
    risk_free_rate: RISK_FREE,
    updated_at: new Date().toISOString(),
  };
}

/** Cached options overview (6 hours per ticker and expiration). */
export function getOptionsOverview(ticker, { expiration } = {}) {
  const symbol = ticker.toUpperCase();
  return cached(`options:${symbol}:${expiration ?? "default"}`, CACHE_MINUTES, () => computeOverview(symbol, expiration));
}

/** Builds and analyzes a strategy template on top of the overview (no extra market data calls). */
export function strategyFromOverview(ov, name, { customLegs } = {}) {
  const T = Math.max(ov.dte, 0.5) / 365;
  const sigma = ov.iv / 100;
  const priceOf = (kind, K) => {
    const row = ov.chain.find((r) => r.strike === K);
    return row ? row[kind].price : blackScholes({ type: kind, S: ov.spot, K, T, sigma }).price;
  };
  const legs = customLegs ?? buildStrategy(name, { S: ov.spot, strikes: ov.strikes, move: ov.expected_move.move, price: priceOf });
  return {
    strategy: name,
    ...(STRATEGIES[name] ?? { label: "Custom" }),
    expiration: ov.expiration,
    dte: ov.dte,
    spot: ov.spot,
    iv: ov.iv,
    legs,
    analysis: analyzeStrategy({ legs, S: ov.spot, T, sigma }),
  };
}

export { STRATEGIES };
