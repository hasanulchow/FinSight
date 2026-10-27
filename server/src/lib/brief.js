import { db } from "./db.js";
import { runAgent } from "./llm.js";
import { enforceOutput } from "./guardrails.js";
import { obj, str, arr, oneOf } from "../agents/schema.js";
import { listHoldings } from "./portfolio.js";
import { listWatch } from "./watchlist.js";
import { getQuoteLite } from "../tools/quote.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { technicalSnapshot } from "./indicators.js";
import { getEventData } from "./events.js";
import { getRedFlags } from "./redflags.js";
import { lookupCompany, getRecentFilings } from "../tools/sec.js";
import { notify } from "./notify.js";
import { withAiUser } from "./aiUsage.js";
import { track } from "./analytics.js";

// Morning brief: once a day before the US open, an agent reviews everything the user owns or watches
// and writes "what changed and why it matters" (moves, earnings, filings, insider trades, red flags, theses).

const MAX_TICKERS = 15;
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function mapLimit(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

/** Facts per ticker: last move, trend, earnings soon, new filings and insider trades in the last 3 days, red flags. */
async function tickerFacts(ticker, watchItem) {
  const recent = day(-3);
  const [quote, bars, events, flags, filings] = await Promise.all([
    getQuoteLite(ticker).catch(() => null),
    pricesEnabled() ? getDailyBars(ticker, { maxAgeHours: 20 }).catch(() => null) : null,
    getEventData(ticker).catch(() => null),
    getRedFlags(ticker).catch(() => null),
    lookupCompany(ticker).then((c) => (c ? getRecentFilings(c.cik, 8) : null)).catch(() => null),
  ]);
  const tech = bars?.length ? technicalSnapshot(bars) : null;
  return {
    ticker,
    price: quote?.price ?? null,
    change_pct: quote?.changePercent != null ? Number(quote.changePercent.toFixed(2)) : null,
    trend: tech?.trend ?? null,
    rsi14: tech?.rsi14 ?? null,
    signals: tech?.signals?.slice(0, 3).map((s) => s.label) ?? [],
    next_earnings: events?.next_earnings && events.next_earnings.date <= day(7) ? events.next_earnings : null,
    new_filings: (filings?.filings ?? []).filter((f) => f.filingDate >= recent).map((f) => `${f.form}${f.items ? ` (items ${f.items})` : ""} on ${f.filingDate}`),
    insider_trades_3d: (events?.insider_trades ?? []).filter((t) => (t.date ?? t.transactionDate ?? "") >= recent).slice(0, 4),
    red_flags: flags && flags.risk_level !== "none" ? { level: flags.risk_level, top: flags.flags.slice(0, 2).map((f) => f.title) } : null,
    thesis: watchItem?.thesis ? { text: watchItem.thesis, status: watchItem.status } : null,
  };
}

const briefSchema = obj({
  headline: str("One sentence: the single most important thing for this user today"),
  market_note: str("One sentence on the broader context if the facts show it (e.g. most holdings fell together), otherwise an empty string"),
  items: arr(
    obj({
      ticker: str("Ticker"),
      importance: oneOf(["high", "medium", "low"], "How much this matters today"),
      what_changed: str("The fact that changed, with numbers"),
      why_it_matters: str("Why a holder or watcher might care, factually, without advice"),
    }),
    "Only tickers with something notable, most important first, at most 8"
  ),
  calendar: arr(str("Upcoming event this week, e.g. 'NVDA reports earnings Wed after close'"), "0-5 items"),
  quiet: arr(str("Ticker with nothing notable"), "Tickers with no news"),
});

/** Builds (and stores) today's brief for one user. Returns null if they have nothing to cover. */
export async function buildBrief(userId, { force = false } = {}) {
  const today = day();
  if (!force) {
    const existing = (await db.list("daily_briefs", { user_id: userId, date: today }, { limit: 1 }))[0];
    if (existing) return existing;
  }
  const [holdings, watch] = await Promise.all([listHoldings(userId), listWatch(userId)]);
  const watchBy = new Map(watch.map((w) => [w.ticker, w]));
  const tickers = [...new Set([...holdings.map((h) => h.ticker), ...watch.map((w) => w.ticker)])].slice(0, MAX_TICKERS);
  if (!tickers.length) return null;

  const facts = await mapLimit(tickers, 4, (t) => tickerFacts(t, watchBy.get(t)));
  const owned = new Set(holdings.map((h) => h.ticker));
  const content = enforceOutput(
    await runAgent({
      agent: "morning_brief",
      effort: "low",
      schema: briefSchema,
      system: `You write a short pre-market brief for a retail investor in an educational app: what changed overnight for the stocks they own or watch, and why it might matter.
Use only the facts given; every number must come from them. Lead with what is most consequential (big moves, earnings within days, new 8-Ks, insider trades, red flags, weakening theses).
Never tell the user to buy, sell or hold, and never predict prices. Plain English, no jargon without a short explanation.`,
      prompt: `Date: ${today}\nOwned: ${[...owned].join(", ") || "none"}\nWatching only: ${tickers.filter((t) => !owned.has(t)).join(", ") || "none"}\n\nFacts per ticker (JSON):\n${JSON.stringify(facts, null, 2)}`,
    })
  ).value;

  const row = { user_id: userId, date: today, content: { ...content, facts }, created_at: new Date().toISOString() };
  const existing = (await db.list("daily_briefs", { user_id: userId, date: today }, { limit: 1 }))[0];
  return existing ? db.update("daily_briefs", existing.id, userId, row) : db.insert("daily_briefs", row);
}

export async function latestBrief(userId) {
  return (await db.list("daily_briefs", { user_id: userId }, { order: "date", ascending: false, limit: 1 }))[0] ?? null;
}

/** Scheduled job: briefs for everyone with holdings or a watchlist who hasn't opted out. Runs 11:00-15:00 UTC (pre-market ET). */
export async function sendMorningBriefs({ force = false, limit = 200 } = {}) {
  const hour = new Date().getUTCHours();
  if (!force && (hour < 11 || hour > 15)) return { skipped: "outside the morning window" };
  const day0 = day();
  const users = [...new Set([...(await db.all("holdings", { columns: "user_id" })), ...(await db.all("watchlist", { columns: "user_id" }))].map((r) => r.user_id))];
  const optedOut = new Set((await db.all("user_settings", { columns: "user_id, brief_enabled" })).filter((s) => s.brief_enabled === false).map((s) => s.user_id));
  const done = new Set((await db.all("daily_briefs", { columns: "user_id, date", match: { date: day0 } })).map((b) => b.user_id));
  let sent = 0;
  for (const userId of users.filter((u) => !optedOut.has(u) && !done.has(u)).slice(0, limit)) {
    try {
      const brief = await withAiUser(userId, () => buildBrief(userId));
      if (!brief) continue;
      await notify(userId, { kind: "brief", title: "Your morning brief", body: brief.content.headline });
      track(userId, "brief_sent");
      sent++;
    } catch (err) {
      console.error(`Brief for ${userId}:`, err.message);
    }
  }
  return { users: users.length, sent };
}

