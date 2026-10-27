import { config } from "../config.js";

const BASE = process.env.FINNHUB_API_BASE || "https://finnhub.io/api/v1";

async function finnhub(path, params) {
  const qs = new URLSearchParams({ ...params, token: config.finnhubKey() });
  const res = await fetch(`${BASE}${path}?${qs}`);
  if (!res.ok) throw new Error(`Finnhub ${path} failed (${res.status})`);
  return res.json();
}

/** Current quote + key stats from Finnhub. */
export async function getQuote(ticker) {
  const [quote, metrics, profile] = await Promise.all([
    finnhub("/quote", { symbol: ticker }),
    finnhub("/stock/metric", { symbol: ticker, metric: "all" }),
    finnhub("/stock/profile2", { symbol: ticker }),
  ]);
  if (!quote || !quote.c) throw new Error(`No quote data for ${ticker}`);

  const m = metrics?.metric ?? {};
  return {
    price: quote.c,
    change: quote.d,
    changePercent: quote.dp,
    open: quote.o,
    high: quote.h,
    low: quote.l,
    previousClose: quote.pc,
    asOf: new Date(quote.t * 1000).toISOString(),
    week52High: m["52WeekHigh"] ?? null,
    week52Low: m["52WeekLow"] ?? null,
    peRatio: m.peBasicExclExtraTTM ?? m.peTTM ?? null,
    beta: m.beta ?? null,
    dividendYield: m.dividendYieldIndicatedAnnual ?? null,
    marketCapMillions: profile?.marketCapitalization ?? m.marketCapitalization ?? null,
    industry: profile?.finnhubIndustry ?? null,
    exchange: profile?.exchange ?? null,
    logo: profile?.logo ?? null,
  };
}

// Company profiles barely change: cache them for the life of the process
const profiles = new Map();
async function profile(ticker) {
  if (!profiles.has(ticker)) profiles.set(ticker, await finnhub("/stock/profile2", { symbol: ticker }).catch(() => ({})));
  return profiles.get(ticker);
}

/** Quote + name/sector only (2 calls, profile cached): for portfolios with many holdings. */
export async function getQuoteLite(ticker) {
  const [quote, p] = await Promise.all([finnhub("/quote", { symbol: ticker }), profile(ticker)]);
  if (!quote?.c) throw new Error(`No quote data for ${ticker}`);
  return {
    ticker,
    name: p?.name ?? ticker,
    sector: p?.finnhubIndustry ?? "Other",
    price: quote.c,
    change: quote.d,
    changePercent: quote.dp,
    previousClose: quote.pc,
    marketCapMillions: p?.marketCapitalization ?? null,
  };
}

/** Valuation and growth metrics (Finnhub basic financials). */
export async function getMetrics(ticker) {
  const m = (await finnhub("/stock/metric", { symbol: ticker, metric: "all" }))?.metric ?? {};
  return {
    pe: m.peBasicExclExtraTTM ?? m.peTTM ?? null,
    dividendYield: m.dividendYieldIndicatedAnnual ?? null,
    beta: m.beta ?? null,
    revenueGrowth: m.revenueGrowthTTMYoy ?? null,
    epsGrowth: m.epsGrowthTTMYoy ?? null,
    netMargin: m.netProfitMarginTTM ?? null,
    week52High: m["52WeekHigh"] ?? null,
    week52Low: m["52WeekLow"] ?? null,
    marketCapMillions: m.marketCapitalization ?? null,
  };
}

/** Earnings calendar between two dates (YYYY-MM-DD), optionally for one ticker. */
export async function getEarningsCalendar({ from, to, ticker }) {
  const body = await finnhub("/calendar/earnings", { from, to, ...(ticker && { symbol: ticker }) });
  return (body?.earningsCalendar ?? []).map((e) => ({
    ticker: e.symbol,
    date: e.date,
    hour: e.hour, // bmo = before market open, amc = after market close
    quarter: e.quarter,
    year: e.year,
    epsEstimate: e.epsEstimate,
    epsActual: e.epsActual,
    revenueEstimate: e.revenueEstimate,
    revenueActual: e.revenueActual,
  }));
}

/** Last 4 quarters of EPS actual vs estimate. */
export async function getEarningsSurprises(ticker) {
  const rows = await finnhub("/stock/earnings", { symbol: ticker });
  return (rows ?? []).slice(0, 4).map((r) => ({ period: r.period, actual: r.actual, estimate: r.estimate, surprise: r.surprise, surprisePercent: r.surprisePercent }));
}
