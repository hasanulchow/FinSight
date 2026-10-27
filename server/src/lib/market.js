import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { massiveGet, getDailyBars } from "../tools/prices.js";
import { cached } from "./cache.js";
import { universe } from "./screener.js";

// Market overview from Massive's grouped daily bars: one call returns every US stock's OHLCV for a day,
// so indices (ETFs), sectors, breadth, top movers and a heatmap cost two calls per refresh (cached 3 hours).

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

export const INDEX_ETFS = { SPY: "S&P 500", QQQ: "Nasdaq 100", DIA: "Dow Jones", IWM: "Russell 2000" };
export const SECTOR_ETFS = {
  XLK: "Technology", XLF: "Financials", XLV: "Health Care", XLY: "Consumer Discretionary", XLP: "Consumer Staples", XLE: "Energy",
  XLI: "Industrials", XLC: "Communication", XLU: "Utilities", XLB: "Materials", XLRE: "Real Estate",
};

/** The two most recent trading days with data (walks back over weekends and holidays). */
async function lastTwoSessions() {
  const days = [];
  let denied = 0, tried = 0;
  for (let back = 0; back < 9 && days.length < 2; back++) {
    const date = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    const day = new Date(date).getUTCDay();
    if (day === 0 || day === 6) continue;
    tried++;
    // On end-of-day plans the current session returns 403 until it's published, so a 403 just means "try the day before"
    const body = await massiveGet(`/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`).catch((e) => {
      if (e.status === 403) denied++;
      return null;
    });
    if (body?.results?.length) days.push({ date, rows: body.results });
  }
  if (days.length < 2) {
    if (denied === tried) throw Object.assign(new Error("Market-wide daily data isn't included in the current Massive plan"), { status: 403 });
    throw Object.assign(new Error("Market data for the last two sessions isn't available yet"), { status: 503 });
  }
  return days;
}

async function snapshotSectors() {
  if (config.localMode) return new Map(localStore.rows("screener_snapshots").map((s) => [s.ticker, s]));
  const { data } = await supabase().from("screener_snapshots").select("ticker, name, sector, data");
  return new Map((data ?? []).map((s) => [s.ticker, s]));
}

async function computeOverview() {
  const [today, prev] = await lastTwoSessions();
  const prevClose = new Map(prev.rows.map((r) => [r.T, r.c]));
  const rows = today.rows
    .filter((r) => prevClose.has(r.T) && /^[A-Z]{1,5}$/.test(r.T))
    .map((r) => ({ ticker: r.T, close: r.c, change_pct: round(((r.c - prevClose.get(r.T)) / prevClose.get(r.T)) * 100), volume: r.v, dollar_volume: r.c * r.v }));
  const by = new Map(rows.map((r) => [r.ticker, r]));
  const pick = (map) => Object.entries(map).map(([t, name]) => ({ ticker: t, name, close: by.get(t)?.close ?? null, change_pct: by.get(t)?.change_pct ?? null })).filter((x) => x.close != null);

  // Movers among liquid names, excluding ETFs we already show
  const liquid = rows.filter((r) => r.close >= 5 && r.dollar_volume >= 20_000_000 && !INDEX_ETFS[r.ticker] && !SECTOR_ETFS[r.ticker]);
  const sorted = [...liquid].sort((a, b) => b.change_pct - a.change_pct);
  const breadthBase = rows.filter((r) => r.close >= 1 && r.volume >= 100_000);

  // Heatmap: the screener universe, grouped by sector, sized by market cap (or dollar volume before snapshots exist)
  const snaps = await snapshotSectors();
  const heatmap = universe()
    .map((t) => {
      const r = by.get(t.replace(".", "")) ?? by.get(t);
      if (!r) return null;
      const s = snaps.get(t);
      return { ticker: t, sector: s?.sector ?? "Other", change_pct: r.change_pct, weight: s?.data?.market_cap_b ?? r.dollar_volume / 1e9 };
    })
    .filter(Boolean);

  return {
    session: today.date,
    previous_session: prev.date,
    indices: pick(INDEX_ETFS),
    sectors: pick(SECTOR_ETFS).sort((a, b) => b.change_pct - a.change_pct),
    breadth: {
      advancers: breadthBase.filter((r) => r.change_pct > 0).length,
      decliners: breadthBase.filter((r) => r.change_pct < 0).length,
      unchanged: breadthBase.filter((r) => r.change_pct === 0).length,
      total: breadthBase.length,
    },
    gainers: sorted.slice(0, 10),
    losers: sorted.slice(-10).reverse(),
    most_active: [...liquid].sort((a, b) => b.dollar_volume - a.dollar_volume).slice(0, 10),
    heatmap,
    updated_at: new Date().toISOString(),
  };
}

export const getMarketOverview = () => cached("market:overview", 180, computeOverview);

/** Relative performance (% from the first common date) for up to 5 tickers over `days` sessions. */
export async function compareTickers(tickers, days = 252) {
  const list = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)))].slice(0, 5);
  if (list.length < 1) throw Object.assign(new Error("Enter at least one ticker"), { status: 400 });
  const series = await Promise.all(list.map(async (t) => ({ ticker: t, bars: await getDailyBars(t).catch(() => []) })));
  const valid = series.filter((s) => s.bars.length);
  if (!valid.length) throw Object.assign(new Error("No price history for those tickers"), { status: 404 });
  const dateSets = valid.map((s) => new Map(s.bars.map((b) => [new Date(b.t).toISOString().slice(0, 10), b.c])));
  const common = [...dateSets[0].keys()].filter((d) => dateSets.every((m) => m.has(d))).slice(-days);
  const base = dateSets.map((m) => m.get(common[0]));
  const step = Math.max(1, Math.floor(common.length / 250));
  const points = common.filter((_, i) => i % step === 0 || i === common.length - 1).map((d) => ({ date: d, ...Object.fromEntries(valid.map((s, j) => [s.ticker, round((dateSets[j].get(d) / base[j] - 1) * 100)])) }));
  return {
    tickers: valid.map((s) => s.ticker),
    missing: list.filter((t) => !valid.some((s) => s.ticker === t)),
    from: common[0],
    to: common[common.length - 1],
    points,
    total_return_pct: Object.fromEntries(valid.map((s, j) => [s.ticker, round((dateSets[j].get(common[common.length - 1]) / base[j] - 1) * 100)])),
  };
}
