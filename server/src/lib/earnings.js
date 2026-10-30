import { getEarningsCalendar, getEarningsSurprises } from "../tools/quote.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { getOptionsOverview } from "./options.js";
import { getStockEvents } from "./events.js";
import { runAgent } from "./llm.js";
import { enforceOutput } from "./guardrails.js";
import { cached } from "./cache.js";
import { obj, str, arr } from "../agents/schema.js";
import { db } from "./db.js";
import { notify } from "./notify.js";
import { listHoldings } from "./portfolio.js";

// Earnings companion: before a report, the move options are pricing in vs how far the stock has
// actually moved after past reports, what analysts expect, and what to watch. After the report,
// a recap of the results (from the 8-K earnings release).

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

/** % move on each past earnings reaction day (after-close reports move the next session). Pure, unit tested. */
export function historicalMoves(reports, bars) {
  const byDate = bars.map((b) => ({ date: new Date(b.t).toISOString().slice(0, 10), c: b.c }));
  const idx = (date) => byDate.findIndex((b) => b.date >= date);
  const moves = [];
  for (const r of reports) {
    const i = idx(r.date);
    if (i < 1 || i >= byDate.length) continue;
    // Before the open (or unknown): previous close -> report-day close. After the close: report-day close -> next close.
    const [from, to] = r.hour === "amc" ? [byDate[i], byDate[i + 1]] : [byDate[i - 1], byDate[i]];
    if (!from || !to || byDate[i].date !== r.date) continue;
    moves.push({ date: r.date, hour: r.hour, move_pct: round(((to.c - from.c) / from.c) * 100) });
  }
  return moves;
}

const previewSchema = obj({
  headline: str("One sentence: when they report and how big a move the options market is pricing vs history"),
  what_to_watch: arr(str("A specific number or topic to watch in this report, from the facts"), "2-4 items"),
  setup: str("2-3 sentences on how the stock is positioned going in (recent run-up or sell-off, beat history, implied vs historical move), factual only"),
  risk_note: str("One sentence on earnings risk for holders and option buyers (e.g. moves can exceed the implied move; IV usually drops after the report)"),
});

/** Pre-earnings view for one ticker, cached 6 hours. */
export function earningsPreview(ticker) {
  const t = ticker.toUpperCase();
  return cached(`earnings-preview:${t}:${day()}`, 360, async () => {
    const [upcoming, past, surprises] = await Promise.all([
      getEarningsCalendar({ from: day(-1), to: day(60), ticker: t }).catch(() => []),
      getEarningsCalendar({ from: day(-760), to: day(-1), ticker: t }).catch(() => []),
      getEarningsSurprises(t).catch(() => []),
    ]);
    const next = upcoming.filter((e) => e.date >= day()).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    if (!next) return { ticker: t, next: null, message: "No earnings date in the next 60 days." };

    const bars = pricesEnabled() ? await getDailyBars(t).catch(() => []) : [];
    const moves = historicalMoves(past.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8), bars);
    const avgAbs = moves.length ? round(moves.reduce((s, m) => s + Math.abs(m.move_pct), 0) / moves.length) : null;

    // Implied move: the first expiration on or after the reaction day
    let implied = null;
    try {
      const base = await getOptionsOverview(t);
      // After-close reports move the next session, so the option must expire after that day
      const reaction = next.hour === "amc" ? new Date(Date.parse(`${next.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : next.date;
      const exp = base.expirations.find((e) => e >= reaction);
      const ov = exp && exp !== base.expiration ? await getOptionsOverview(t, { expiration: exp }) : base;
      implied = { expiration: ov.expiration, pct: ov.expected_move.pct, low: ov.expected_move.low, high: ov.expected_move.high, iv: ov.iv, spot: ov.spot, source: ov.data_source };
    } catch {
      implied = null;
    }
    const last = bars.length ? bars[bars.length - 1].c : null;
    const run30 = bars.length > 22 ? round(((last - bars[bars.length - 22].c) / bars[bars.length - 22].c) * 100) : null;
    const facts = {
      ticker: t,
      next: { date: next.date, timing: next.hour === "amc" ? "after the close" : next.hour === "bmo" ? "before the open" : "time not announced", eps_estimate: next.epsEstimate, revenue_estimate: next.revenueEstimate },
      implied_move: implied,
      past_moves: moves,
      avg_abs_move_pct: avgAbs,
      beat_history: surprises.slice(0, 4),
      change_last_month_pct: run30,
    };
    const ai = enforceOutput(
      await runAgent({
        agent: "earnings_companion",
        effort: "low",
        schema: previewSchema,
        system: `You prepare a retail investor for an upcoming earnings report in an educational app. Use only the facts given; every number must come from them.
Compare the options-implied move with the stock's past post-earnings moves. Never predict the result or the direction, and never recommend a trade.`,
        prompt: `Facts (JSON):\n${JSON.stringify(facts, null, 2)}`,
      })
    ).value;
    return { ...facts, ...ai, updated_at: new Date().toISOString() };
  });
}

/** Earnings in the next `days` days for the user's holdings and watchlist (no AI). */
export async function upcomingForUser(userId, days = 14) {
  const [holdings, watch] = await Promise.all([listHoldings(userId), db.list("watchlist", { user_id: userId }, { limit: 200 })]);
  const owned = new Set(holdings.map((h) => h.ticker));
  const tickers = new Set([...owned, ...watch.map((w) => w.ticker)]);
  if (!tickers.size) return [];
  const all = await getEarningsCalendar({ from: day(), to: day(days) }).catch(() => []);
  return all.filter((e) => tickers.has(e.ticker)).sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ ...e, owned: owned.has(e.ticker) }));
}

/** Post-earnings recap: the events summary refreshed after the report (8-K results + AI recap). */
export async function earningsRecap(ticker) {
  const ev = await getStockEvents(ticker.toUpperCase(), { refresh: true });
  return { ticker: ticker.toUpperCase(), latest_release: ev.latest_release, surprises: ev.surprises?.slice(0, 4) ?? [], summary: ev.summary };
}

/** Job: the morning of a report day, notify holders/watchers with the implied vs historical move. */
export async function sendEarningsHeadsUps() {
  const today = day();
  const reports = await getEarningsCalendar({ from: today, to: today }).catch(() => []);
  if (!reports.length) return { reports: 0, sent: 0 };
  const byTicker = new Map(reports.map((r) => [r.ticker, r]));
  const rows = [...(await db.all("holdings", { columns: "user_id, ticker" })), ...(await db.all("watchlist", { columns: "user_id, ticker" }))].filter((r) => byTicker.has(r.ticker));
  const done = new Set((await db.all("notifications", { since: `${today}T00:00:00Z`, columns: "user_id, kind, ticker" })).filter((n) => n.kind === "earnings_today").map((n) => `${n.user_id}:${n.ticker}`));
  let sent = 0;
  for (const r of rows) {
    const key = `${r.user_id}:${r.ticker}`;
    if (done.has(key)) continue;
    done.add(key);
    const p = await earningsPreview(r.ticker).catch(() => null);
    const when = byTicker.get(r.ticker).hour === "amc" ? "after the close" : byTicker.get(r.ticker).hour === "bmo" ? "before the open" : "today";
    const body = p?.implied_move?.pct != null
      ? `Options imply about ±${p.implied_move.pct}% by ${p.implied_move.expiration}${p.avg_abs_move_pct != null ? `; it has moved ${p.avg_abs_move_pct}% on average after recent reports` : ""}.`
      : "Open FinSight for the earnings preview.";
    await notify(r.user_id, { kind: "earnings_today", ticker: r.ticker, title: `${r.ticker} reports ${when}`, body }).catch(() => {});
    sent++;
  }
  return { reports: reports.length, sent };
}
