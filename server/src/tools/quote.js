import { config } from "../config.js";

const BASE = "https://finnhub.io/api/v1";

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
