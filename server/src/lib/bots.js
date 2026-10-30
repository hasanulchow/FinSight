import { db } from "./db.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { getQuoteLite } from "../tools/quote.js";
import { sma, atr } from "./indicators.js";
import { BULL_FLAG_DEFAULTS, detectBullFlag, flagEndingAt, marketRegime, regimePasses, stopFor, targetFor } from "./patterns.js";
import { universe as largeCaps } from "./screener.js";
import { getPaperAccount, placePaperOrder, cancelPaperOrder, marketStatus } from "./paper.js";
import { notify } from "./notify.js";
import { checkCap } from "./plans.js";
import { track } from "./analytics.js";

// Trading bots: rule-based strategies that scan a universe for a chart pattern, check the market
// regime, and act on the entry rule.
//  - mode "paper": the bot trades the practice account on its own (entry, stop, target, time stop).
//  - mode "alert": the bot sends the exact setup (entry, stop, target, shares) for the user to place,
//    for example as a real order through their broker. Bots never place real-money orders themselves.

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const today = () => new Date().toISOString().slice(0, 10);
const MAX_SCAN_PER_RUN = 25;

export const BOT_TEMPLATES = {
  bull_flag_breakout: {
    name: "Bull flag breakout",
    description: "Finds bull flags while SPY is above its 200-day and buys the break above the flag. Stop under the flag, target the measured move.",
    config: {
      pattern: "bull_flag",
      universe: { type: "watchlist", tickers: [] },
      market_filter: "not_bear", // "good market" = SPY above its 200-day; the stricter "bull" filter backtested worse
      pattern_params: { min_pole_pct: 8, max_retrace_pct: 50, max_flag_bars: 15 },
      entry: { trigger: "intraday", buffer_pct: 0.1, require_volume: false, volume_mult: 1.5 },
      exit: { stop: "flag_low", atr_mult: 2, target: "measured_move", time_stop_days: 15 },
      sizing: { risk_pct: 1, max_position_pct: 20, max_positions: 3 },
      mode: "paper",
    },
  },
};

const UNIVERSES = ["watchlist", "large_caps", "custom"];
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Validates a bot config from the app; unknown values fall back to the template's. */
export function cleanConfig(input = {}) {
  const t = BOT_TEMPLATES.bull_flag_breakout.config;
  const u = input.universe ?? {};
  const tickers = (Array.isArray(u.tickers) ? u.tickers : String(u.tickers ?? "").split(/[\s,]+/)).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)).slice(0, 50);
  const pp = input.pattern_params ?? {}, en = input.entry ?? {}, ex = input.exit ?? {}, sz = input.sizing ?? {};
  const cfg = {
    pattern: "bull_flag",
    universe: { type: UNIVERSES.includes(u.type) ? u.type : t.universe.type, tickers },
    market_filter: ["bull", "not_bear", "off"].includes(input.market_filter) ? input.market_filter : t.market_filter,
    pattern_params: { min_pole_pct: clamp(pp.min_pole_pct, 4, 50, 8), max_retrace_pct: clamp(pp.max_retrace_pct, 20, 62, 50), max_flag_bars: clamp(pp.max_flag_bars, 3, 25, 15) },
    entry: { trigger: en.trigger === "close" ? "close" : "intraday", buffer_pct: clamp(en.buffer_pct, 0, 2, 0.1), require_volume: Boolean(en.require_volume), volume_mult: clamp(en.volume_mult, 1, 5, 1.5) },
    exit: { stop: ex.stop === "atr" ? "atr" : "flag_low", atr_mult: clamp(ex.atr_mult, 0.5, 5, 2), target: ["measured_move", "r2", "r3"].includes(ex.target) ? ex.target : "measured_move", time_stop_days: clamp(ex.time_stop_days, 0, 60, 15) },
    sizing: { risk_pct: clamp(sz.risk_pct, 0.1, 5, 1), max_position_pct: clamp(sz.max_position_pct, 1, 100, 20), max_positions: Math.round(clamp(sz.max_positions, 1, 20, 3)) },
    mode: input.mode === "alert" ? "alert" : "paper",
  };
  if (cfg.universe.type === "custom" && !cfg.universe.tickers.length) throw bad("Add at least one ticker to scan");
  return cfg;
}

// ---------- CRUD ----------
export const listBots = (userId) => db.list("trading_bots", { user_id: userId }, { limit: 50 });

export async function createBot(userId, { name, config, template = "bull_flag_breakout" } = {}) {
  await checkCap(userId, "bots", (await listBots(userId)).length);
  const tpl = BOT_TEMPLATES[template] ?? BOT_TEMPLATES.bull_flag_breakout;
  const cfg = cleanConfig({ ...tpl.config, ...(config ?? {}) });
  const row = await db.insert("trading_bots", { user_id: userId, name: String(name || tpl.name).slice(0, 60), template, config: cfg, enabled: false, state: {} });
  track(userId, "bot_created", { mode: cfg.mode, universe: cfg.universe.type });
  return row;
}

export async function updateBot(userId, id, { name, config, enabled }) {
  const bot = await db.get("trading_bots", id, userId);
  if (!bot) throw bad("Bot not found", 404);
  const fields = {};
  if (name != null) fields.name = String(name).slice(0, 60);
  if (config) fields.config = cleanConfig({ ...bot.config, ...config });
  if (enabled != null) fields.enabled = Boolean(enabled);
  return db.update("trading_bots", id, userId, fields);
}

export async function deleteBot(userId, id) {
  if (!(await db.remove("trading_bots", id, userId))) throw bad("Bot not found", 404);
}

export const listSignals = (userId, botId) => db.list("bot_signals", { user_id: userId, bot_id: botId }, { order: "created_at", ascending: false, limit: 100 });

// ---------- Scanning ----------
async function tickersFor(userId, bot) {
  const u = bot.config.universe;
  if (u.type === "custom") return u.tickers;
  if (u.type === "large_caps") return largeCaps();
  const watch = (await db.list("watchlist", { user_id: userId }, { limit: 200 })).map((w) => w.ticker);
  const held = (await db.list("holdings", { user_id: userId }, { limit: 500 })).map((h) => h.ticker);
  return [...new Set([...watch, ...held])];
}

async function regimeNow() {
  const spy = await getDailyBars("SPY", { maxAgeHours: 12 });
  return marketRegime(spy);
}

/**
 * Scans the bot's universe once. Returns setups found, without acting on them.
 * Large universes are scanned in slices across runs (price data is rate limited).
 */
export async function scanBot(userId, bot) {
  if (!pricesEnabled()) throw bad("Price history isn't set up on this server (MASSIVE_API_KEY).", 503);
  const cfg = bot.config;
  const regime = await regimeNow().catch(() => ({ state: "unknown", reasons: ["SPY data unavailable"] }));
  const all = await tickersFor(userId, bot);
  const cursor = bot.state?.cursor ?? 0;
  const slice = all.length > MAX_SCAN_PER_RUN ? [...all, ...all].slice(cursor % all.length, (cursor % all.length) + MAX_SCAN_PER_RUN) : all;
  const setups = [];
  for (const ticker of slice) {
    try {
      const bars = await getDailyBars(ticker, { maxAgeHours: 20 });
      const setup = detectBullFlag(bars, { ...BULL_FLAG_DEFAULTS, ...cfg.pattern_params, volume_mult: cfg.entry.volume_mult });
      if (setup) setups.push({ ticker, ...setup, atr14: round(atr(bars, 14)[bars.length - 1]) });
    } catch {
      // skip tickers without data
    }
  }
  return { regime, regime_ok: regimePasses(cfg.market_filter, regime.state), scanned: slice.length, universe_size: all.length, next_cursor: (cursor + slice.length) % Math.max(1, all.length), setups };
}

// ---------- Acting ----------
/** Shares for a risk budget, capped by position size and buying power. */
export function sizePosition({ equity, buyingPower, entry, stop, risk_pct, max_position_pct }) {
  const perShare = entry - stop;
  if (!(perShare > 0)) return 0;
  const byRisk = Math.floor((equity * risk_pct) / 100 / perShare);
  const byPosition = Math.floor((equity * max_position_pct) / 100 / entry);
  const byCash = Math.floor(buyingPower / entry);
  return Math.max(0, Math.min(byRisk, byPosition, byCash));
}

async function openSignals(userId, botId) {
  return (await listSignals(userId, botId)).filter((s) => ["entered", "pending_entry"].includes(s.status));
}

/** Runs one bot: scan, then enter (paper) or alert on triggered setups, then manage open bot trades. */
export async function runBot(userId, bot, { manual = false } = {}) {
  const cfg = bot.config;
  const market = marketStatus();
  const scan = await scanBot(userId, bot);
  const log = { at: new Date().toISOString(), regime: scan.regime.state, regime_ok: scan.regime_ok, scanned: scan.scanned, setups: scan.setups.length, entered: 0, alerted: 0, managed: 0 };
  await manageBot(userId, bot, log).catch((e) => (log.manage_error = e.message));

  const existing = await listSignals(userId, bot.id);
  const seen = new Set(existing.map((s) => `${s.ticker}:${s.flag_start}`));
  const open = existing.filter((s) => ["entered", "pending_entry"].includes(s.status));
  let slots = cfg.sizing.max_positions - open.length;
  const account = cfg.mode === "paper" ? await getPaperAccount(userId) : null;

  for (const setup of scan.setups) {
    const key = `${setup.ticker}:${setup.flag.start}`;
    // Triggers: close-confirmed breakout (daily bar) or an intraday break of the flag high
    let price = null, triggered = false;
    if (setup.status === "breakout" && (!cfg.entry.require_volume || setup.volume_confirmed)) {
      triggered = true;
      price = setup.breakout_close;
    } else if (setup.status === "forming" && cfg.entry.trigger === "intraday" && market.open) {
      price = (await getQuoteLite(setup.ticker).catch(() => null))?.price ?? null;
      triggered = price != null && price >= setup.breakout_level * (1 + cfg.entry.buffer_pct / 100);
    }
    if (!triggered) {
      if (setup.status === "forming" && !seen.has(key)) {
        await db.insert("bot_signals", { user_id: userId, bot_id: bot.id, ticker: setup.ticker, flag_start: setup.flag.start, status: "watching", setup });
        seen.add(key);
      }
      continue;
    }
    const prior = existing.find((s) => `${s.ticker}:${s.flag_start}` === key);
    if (prior && prior.status !== "watching") continue; // already acted on this flag
    if (!scan.regime_ok) {
      await upsertSignal(userId, bot, prior, setup, { status: "skipped", reason: `Market filter: SPY is ${scan.regime.state}` });
      continue;
    }
    if (open.some((s) => s.ticker === setup.ticker) || account?.positions.some((p) => p.ticker === setup.ticker)) continue;

    const bars = await getDailyBars(setup.ticker, { maxAgeHours: 20 });
    const entry = round(Math.max(price, setup.breakout_level));
    const stop = stopFor(setup, bars, cfg.exit);
    const target = targetFor(setup, entry, stop, cfg.exit);
    const equity = account?.equity ?? 100_000;
    const shares = sizePosition({ equity, buyingPower: account?.buying_power ?? equity, entry, stop, risk_pct: cfg.sizing.risk_pct, max_position_pct: cfg.sizing.max_position_pct });
    const plan = { entry, stop, target, shares, risk_dollars: round(shares * (entry - stop)), r_target: round((target - entry) / (entry - stop), 2) };

    if (cfg.mode === "alert" || !(shares > 0) || slots <= 0) {
      const why = slots <= 0 ? "max positions reached" : !(shares > 0) ? "position size rounds to 0" : null;
      await upsertSignal(userId, bot, prior, setup, { status: cfg.mode === "alert" ? "alerted" : "skipped", plan, reason: why });
      if (cfg.mode === "alert") {
        await notify(userId, { kind: "bot", ticker: setup.ticker, title: `${bot.name}: ${setup.ticker} broke out`, body: `Bull flag breakout above $${setup.breakout_level}. Plan: ${shares} sh near $${entry}, stop $${stop}, target $${target} (${plan.r_target}R).` }).catch(() => {});
        log.alerted++;
      }
      continue;
    }
    try {
      const order = await placePaperOrder(userId, { ticker: setup.ticker, side: "buy", type: "market", qty: shares });
      await upsertSignal(userId, bot, prior, setup, { status: order.status === "filled" ? "entered" : "pending_entry", plan, entry_order_id: order.id, entry_price: order.filled_price ?? null, entered_at: order.filled_at ?? null });
      await notify(userId, { kind: "bot", ticker: setup.ticker, title: `${bot.name} bought ${shares} ${setup.ticker}`, body: `Bull flag breakout. ${order.status === "filled" ? `Filled at $${Number(order.filled_price).toFixed(2)}` : "Fills at the open"}; stop $${stop}, target $${target}. Practice account.` }).catch(() => {});
      log.entered++;
      slots--;
    } catch (err) {
      await upsertSignal(userId, bot, prior, setup, { status: "skipped", plan, reason: err.message });
    }
  }
  await db.update("trading_bots", bot.id, userId, { last_run_at: log.at, state: { ...(bot.state ?? {}), cursor: scan.next_cursor, last_log: log, last_regime: scan.regime } });
  if (manual) track(userId, "bot_run", log);
  return { ...log, regime: scan.regime, setups: scan.setups };
}

async function upsertSignal(userId, bot, prior, setup, fields) {
  if (prior) return db.update("bot_signals", prior.id, userId, { ...fields, setup });
  return db.insert("bot_signals", { user_id: userId, bot_id: bot.id, ticker: setup.ticker, flag_start: setup.flag.start, setup, ...fields });
}

/**
 * Manages the bot's open practice trades: places the protective stop once the entry fills, sells at
 * the target (cancelling the stop), and exits after the time stop. One order per side keeps it simple.
 */
export async function manageBot(userId, bot, log = {}) {
  if (bot.config.mode !== "paper") return;
  const signals = await openSignals(userId, bot.id);
  if (!signals.length) return;
  const account = await getPaperAccount(userId);
  const orders = [...account.open_orders, ...account.recent_orders];
  const market = marketStatus();
  for (const s of signals) {
    const pos = account.positions.find((p) => p.ticker === s.ticker);
    const entryOrder = orders.find((o) => o.id === s.entry_order_id);
    if (s.status === "pending_entry") {
      if (entryOrder?.status === "filled") {
        Object.assign(s, await db.update("bot_signals", s.id, userId, { status: "entered", entry_price: Number(entryOrder.filled_price), entered_at: entryOrder.filled_at }));
      } else if (entryOrder && entryOrder.status !== "open") {
        await db.update("bot_signals", s.id, userId, { status: "skipped", reason: `Entry order ${entryOrder.status}` });
        continue;
      } else continue;
    }
    const stopOrder = orders.find((o) => o.id === s.stop_order_id);
    // Position gone: the stop filled (or the user sold it)
    if (!pos) {
      const exit = stopOrder?.status === "filled" ? Number(stopOrder.filled_price) : null;
      await closeSignal(userId, s, exit, stopOrder?.status === "filled" ? "stop" : "closed manually");
      log.managed = (log.managed ?? 0) + 1;
      continue;
    }
    if (!s.stop_order_id || (stopOrder && stopOrder.status !== "open")) {
      const so = await placePaperOrder(userId, { ticker: s.ticker, side: "sell", type: "stop", stop_price: s.plan.stop, qty: pos.qty, time_in_force: "gtc" }).catch(() => null);
      if (so) await db.update("bot_signals", s.id, userId, { stop_order_id: so.id });
      continue;
    }
    if (!market.open) continue;
    const ageDays = s.entered_at ? (Date.now() - Date.parse(s.entered_at)) / 86_400_000 : 0;
    const hitTarget = pos.price >= s.plan.target;
    const timeUp = bot.config.exit.time_stop_days > 0 && ageDays >= bot.config.exit.time_stop_days;
    if (hitTarget || timeUp) {
      await cancelPaperOrder(userId, s.stop_order_id).catch(() => {});
      const sell = await placePaperOrder(userId, { ticker: s.ticker, side: "sell", type: "market", qty: pos.qty }).catch(() => null);
      await closeSignal(userId, s, sell?.filled_price ?? pos.price, hitTarget ? "target" : "time stop");
      log.managed = (log.managed ?? 0) + 1;
    }
  }
}

async function closeSignal(userId, s, exitPrice, reason) {
  const entry = Number(s.entry_price ?? s.plan.entry);
  const r = exitPrice != null ? round((exitPrice - entry) / (entry - s.plan.stop), 2) : null;
  await db.update("bot_signals", s.id, userId, { status: "exited", exit_price: exitPrice, exit_reason: reason, exited_at: new Date().toISOString(), r_multiple: r });
  await notify(userId, { kind: "bot", ticker: s.ticker, title: `Bot closed ${s.ticker}: ${reason}`, body: exitPrice != null ? `Exit $${Number(exitPrice).toFixed(2)} (${r > 0 ? "+" : ""}${r}R). Practice account.` : "Position closed." }).catch(() => {});
}

/** Scheduled job: every enabled bot. Intraday bots run during market hours; close-confirmed bots any time. */
export async function runAllBots({ limit = 50 } = {}) {
  if (!pricesEnabled()) return { skipped: "no price data" };
  const bots = (await db.all("trading_bots", { match: { enabled: true } })).slice(0, limit);
  let ran = 0, entered = 0, alerted = 0;
  for (const bot of bots) {
    try {
      const r = await runBot(bot.user_id, bot);
      ran++;
      entered += r.entered;
      alerted += r.alerted;
    } catch (err) {
      console.error(`Bot ${bot.id}:`, err.message);
    }
  }
  return { bots: bots.length, ran, entered, alerted };
}

// ---------- Backtest ----------
/**
 * Replays the bot's rules over ~2 years of daily bars for up to 12 tickers:
 * regime filter on SPY, bull flag detection each day, entry on the break of the flag high
 * (intraday: at max(open, level); close: next open after a close above), then stop / target / time stop.
 * Results are in R (multiples of the risk per trade), so they don't depend on account size.
 */
export async function backtestBot(userId, botOrConfig, { maxTickers = 12 } = {}) {
  if (!pricesEnabled()) throw bad("Price history isn't set up on this server (MASSIVE_API_KEY).", 503);
  const cfg = botOrConfig.config ? botOrConfig.config : cleanConfig(botOrConfig);
  const tickers = (await tickersFor(userId, { config: cfg })).slice(0, maxTickers);
  if (!tickers.length) throw bad("No tickers to test. Add stocks to your watchlist or pick a universe.");
  const spy = await getDailyBars("SPY");
  const spyCloses = spy.map((b) => b.c);
  const s50 = sma(spyCloses, 50), s200 = sma(spyCloses, 200);
  const spyIndex = new Map(spy.map((b, i) => [new Date(b.t).toISOString().slice(0, 10), i]));
  const params = { ...BULL_FLAG_DEFAULTS, ...cfg.pattern_params, volume_mult: cfg.entry.volume_mult };
  const trades = [];
  let skippedRegime = 0;

  for (const ticker of tickers) {
    let bars;
    try {
      bars = await getDailyBars(ticker, { maxAgeHours: 24 });
    } catch {
      continue;
    }
    const atrs = atr(bars, 14);
    let i = 60;
    while (i < bars.length - 1) {
      const date = new Date(bars[i].t).toISOString().slice(0, 10);
      // Signal at bar i
      let entryIdx = null, entry = null, setup = null;
      if (cfg.entry.trigger === "intraday") {
        const f = flagEndingAt(bars, i - 1, params);
        const level = f && f.flagHigh * (1 + cfg.entry.buffer_pct / 100);
        if (f && bars[i].h >= level) {
          setup = { breakout_level: f.flagHigh, stop_level: f.flagLow, target_measured_move: f.flagHigh + (f.poleTop - f.poleBottom), flag: { start: f.flagStart } };
          entryIdx = i;
          entry = Math.max(bars[i].o, level);
        }
      } else {
        const d = detectBullFlag(bars, { end: i, ...params });
        if (d?.status === "breakout" && (!cfg.entry.require_volume || d.volume_confirmed)) {
          setup = d;
          entryIdx = i + 1;
          entry = bars[i + 1].o;
        }
      }
      if (!setup) {
        i++;
        continue;
      }
      const si = spyIndex.get(date);
      const regime = si != null ? marketRegime(spy, { end: si, sma50: s50, sma200: s200 }).state : "unknown";
      if (!regimePasses(cfg.market_filter, regime)) {
        skippedRegime++;
        i++;
        continue;
      }
      const stop = cfg.exit.stop === "atr" && atrs[i] ? setup.breakout_level - cfg.exit.atr_mult * atrs[i] : setup.stop_level * 0.998;
      if (!(entry > stop)) {
        i++;
        continue;
      }
      const target = cfg.exit.target === "r2" ? entry + 2 * (entry - stop) : cfg.exit.target === "r3" ? entry + 3 * (entry - stop) : setup.target_measured_move;
      // Walk forward from the entry bar
      let exitIdx = null, exit = null, reason = null;
      for (let j = entryIdx; j < bars.length; j++) {
        const b = bars[j];
        const firstBar = j === entryIdx;
        if (b.l <= stop) {
          exit = firstBar ? stop : Math.min(b.o, stop); // gaps through the stop fill at the open
          reason = "stop";
        } else if (b.h >= target) {
          exit = firstBar ? target : Math.max(b.o, target);
          reason = "target";
        } else if (cfg.exit.time_stop_days > 0 && j - entryIdx >= cfg.exit.time_stop_days) {
          exit = b.c;
          reason = "time";
        }
        if (exit != null) {
          exitIdx = j;
          break;
        }
      }
      if (exit == null) {
        exitIdx = bars.length - 1;
        exit = bars[exitIdx].c;
        reason = "open";
      }
      const r = (exit - entry) / (entry - stop);
      trades.push({ ticker, entry_date: new Date(bars[entryIdx].t).toISOString().slice(0, 10), exit_date: new Date(bars[exitIdx].t).toISOString().slice(0, 10), entry: round(entry), stop: round(stop), target: round(target), exit: round(exit), r: round(r, 2), reason, days: exitIdx - entryIdx });
      i = exitIdx + 1; // one trade at a time per ticker
    }
  }

  trades.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const closed = trades.filter((t) => t.reason !== "open");
  const wins = closed.filter((t) => t.r > 0);
  const grossW = wins.reduce((s, t) => s + t.r, 0), grossL = Math.abs(closed.filter((t) => t.r <= 0).reduce((s, t) => s + t.r, 0));
  let eq = 0, peak = 0, dd = 0;
  const curve = closed.map((t) => {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq - peak);
    return { date: t.exit_date, r: round(eq, 2) };
  });
  const totalR = closed.reduce((s, t) => s + t.r, 0);
  return {
    tickers,
    period: { from: trades[0]?.entry_date ?? null, to: today() },
    trades: closed.length,
    open_trades: trades.length - closed.length,
    win_rate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    avg_r: closed.length ? round(totalR / closed.length, 2) : null,
    total_r: round(totalR, 2),
    profit_factor: grossL ? round(grossW / grossL, 2) : null,
    max_drawdown_r: round(dd, 2),
    account_return_pct: round(totalR * cfg.sizing.risk_pct, 1),
    skipped_by_market_filter: skippedRegime,
    exits: { target: closed.filter((t) => t.reason === "target").length, stop: closed.filter((t) => t.reason === "stop").length, time: closed.filter((t) => t.reason === "time").length },
    curve,
    recent: trades.slice(-25).reverse(),
    note: "Simulated on daily bars: fills at the stated level or the open on gaps, no slippage or fees, one trade per ticker at a time. Past results don't predict future returns.",
  };
}
