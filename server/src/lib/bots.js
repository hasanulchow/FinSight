import { db } from "./db.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { withLivePrice, keepWarm } from "./stream.js";
import { sma, atr } from "./indicators.js";
import { marketRegime, regimePasses } from "./patterns.js";
import { STRATEGIES, strategyFor, currentSetup, through, stopPrice, targetPrice, rMultiple, simulate } from "./strategies.js";
import { universe as largeCaps } from "./screener.js";
import { getPaperAccount, placePaperOrder, cancelPaperOrder, marketStatus } from "./paper.js";
import { notify } from "./notify.js";
import { checkCap } from "./plans.js";
import { track } from "./analytics.js";

// Trading bots: rule-based strategies (lib/strategies.js) that scan a universe for a setup, check the
// market regime, and act on the entry rule. Long strategies buy; short strategies (bear flag) sell short.
//  - mode "paper": the bot trades the practice account on its own (entry, stop, target, exit rules).
//  - mode "alert": the bot sends the exact plan (entry, stop, target, shares) for the user to place,
//    for example as a real order through their broker. Bots never place real-money orders themselves.

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const today = () => new Date().toISOString().slice(0, 10);
const MAX_SCAN_PER_RUN = 25;

const BASE_CONFIG = {
  universe: { type: "watchlist", tickers: [] },
  entry: { trigger: "intraday", buffer_pct: 0.1, require_volume: false, volume_mult: 1.5 },
  exit: { stop: "pattern", atr_mult: 2, target: "pattern", time_stop_days: 15 },
  sizing: { risk_pct: 1, max_position_pct: 20, max_positions: 3 },
  mode: "paper",
};

/** Templates for the app: each strategy's rules, options and default config. */
export const BOT_TEMPLATES = Object.fromEntries(
  Object.entries(STRATEGIES).map(([key, st]) => [
    key,
    {
      name: st.name,
      description: st.description,
      direction: st.direction,
      entry_type: st.entry,
      level_name: st.level_name,
      stop_label: st.stop_label,
      targets: st.targets,
      filters: st.filters,
      params: st.params.map(({ key: k, label, options, suffix }) => ({ key: k, label, options, suffix })),
      config: {
        ...BASE_CONFIG,
        strategy: key,
        market_filter: st.config.market_filter,
        pattern_params: st.config.pattern_params,
        entry: { ...BASE_CONFIG.entry, trigger: st.entry === "close" ? "close" : "intraday" },
        exit: { ...BASE_CONFIG.exit, ...st.config.exit },
      },
    },
  ])
);

const UNIVERSES = ["watchlist", "large_caps", "custom"];
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Validates a bot config from the app; unknown values fall back to the strategy's defaults. */
export function cleanConfig(input = {}) {
  const key = STRATEGIES[input.strategy] ? input.strategy : "bull_flag_breakout";
  const st = STRATEGIES[key];
  const t = BOT_TEMPLATES[key].config;
  const u = input.universe ?? {};
  const tickers = (Array.isArray(u.tickers) ? u.tickers : String(u.tickers ?? "").split(/[\s,]+/)).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)).slice(0, 50);
  const pp = input.pattern_params ?? {}, en = input.entry ?? {}, ex = input.exit ?? {}, sz = input.sizing ?? {};
  // Older bull flag bots stored "flag_low" and "measured_move"
  const stop = ex.stop === "atr" ? "atr" : "pattern";
  const target = ex.target === "measured_move" ? "pattern" : ex.target;
  const cfg = {
    strategy: key,
    universe: { type: UNIVERSES.includes(u.type) ? u.type : t.universe.type, tickers },
    market_filter: st.filters.some(([k]) => k === input.market_filter) ? input.market_filter : t.market_filter,
    pattern_params: Object.fromEntries(st.params.map((p) => [p.key, clamp(pp[p.key], p.min, p.max, t.pattern_params[p.key])])),
    entry: { trigger: st.entry === "close" || en.trigger === "close" ? "close" : "intraday", buffer_pct: clamp(en.buffer_pct, 0, 2, 0.1), require_volume: Boolean(en.require_volume), volume_mult: clamp(en.volume_mult, 1, 5, 1.5) },
    exit: { stop, atr_mult: clamp(ex.atr_mult, 0.5, 5, 2), target: st.targets.some(([k]) => k === target) ? target : t.exit.target, time_stop_days: clamp(ex.time_stop_days, 0, 60, t.exit.time_stop_days) },
    sizing: { risk_pct: clamp(sz.risk_pct, 0.1, 5, 1), max_position_pct: clamp(sz.max_position_pct, 1, 100, 20), max_positions: Math.round(clamp(sz.max_positions, 1, 20, 3)) },
    mode: input.mode === "alert" ? "alert" : "paper",
  };
  if (cfg.universe.type === "custom" && !cfg.universe.tickers.length) throw bad("Add at least one ticker to scan");
  return cfg;
}

// ---------- CRUD ----------
export const listBots = (userId) => db.list("trading_bots", { user_id: userId }, { limit: 50 });

export async function createBot(userId, { name, config, template } = {}) {
  await checkCap(userId, "bots", (await listBots(userId)).length);
  const key = STRATEGIES[template] ? template : STRATEGIES[config?.strategy] ? config.strategy : "bull_flag_breakout";
  const tpl = BOT_TEMPLATES[key];
  const cfg = cleanConfig({ ...tpl.config, ...(config ?? {}), strategy: key });
  const row = await db.insert("trading_bots", { user_id: userId, name: String(name || tpl.name).slice(0, 60), template: key, config: cfg, enabled: false, state: {} });
  track(userId, "bot_created", { strategy: key, mode: cfg.mode, universe: cfg.universe.type });
  return row;
}

export async function updateBot(userId, id, { name, config, enabled }) {
  const bot = await db.get("trading_bots", id, userId);
  if (!bot) throw bad("Bot not found", 404);
  const fields = {};
  if (name != null) fields.name = String(name).slice(0, 60);
  if (config) fields.config = cleanConfig({ ...bot.config, ...config, strategy: bot.config.strategy ?? bot.template });
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

/** A setup as stored on signals and shown in the app. */
function setupView(ticker, key, st, s) {
  return {
    ticker,
    strategy: key,
    direction: st.direction,
    status: s.status,
    anchor: s.anchor,
    level: round(s.level),
    stop_level: round(s.stop),
    target_level: round(s.target),
    exit_rule: s.exit_rule ?? null,
    summary: s.summary,
    info: s.info,
    distance_pct: s.distance_pct ?? null,
    trigger_close: round(s.trigger_close),
    volume_confirmed: s.volume_confirmed ?? null,
  };
}

/**
 * Scans the bot's universe once. Returns setups found, without acting on them.
 * Large universes are scanned in slices across runs (price data is rate limited).
 */
export async function scanBot(userId, bot) {
  if (!pricesEnabled()) throw bad("Price history isn't set up on this server (MASSIVE_API_KEY).", 503);
  const cfg = bot.config;
  const key = cfg.strategy ?? "bull_flag_breakout";
  const st = strategyFor(key);
  const regime = await regimeNow().catch(() => ({ state: "unknown", reasons: ["SPY data unavailable"] }));
  const all = await tickersFor(userId, bot);
  const cursor = bot.state?.cursor ?? 0;
  const slice = all.length > MAX_SCAN_PER_RUN ? [...all, ...all].slice(cursor % all.length, (cursor % all.length) + MAX_SCAN_PER_RUN) : all;
  const setups = [];
  for (const ticker of slice) {
    try {
      const bars = await getDailyBars(ticker, { maxAgeHours: 20 });
      const s = currentSetup(st, bars, cfg.pattern_params, { volume_mult: cfg.entry.volume_mult });
      if (s) setups.push({ ...setupView(ticker, key, st, s), atr14: round(atr(bars, 14)[bars.length - 1]) });
    } catch {
      // skip tickers without data
    }
  }
  return { strategy: key, regime, regime_ok: regimePasses(cfg.market_filter, regime.state), scanned: slice.length, universe_size: all.length, next_cursor: (cursor + slice.length) % Math.max(1, all.length), setups };
}

// ---------- Acting ----------
/** Shares for a risk budget, capped by position size and buying power (for shorts the stop is above the entry). */
export function sizePosition({ equity, buyingPower, entry, stop, risk_pct, max_position_pct, direction = "long" }) {
  const perShare = direction === "short" ? stop - entry : entry - stop;
  if (!(perShare > 0)) return 0;
  const byRisk = Math.floor((equity * risk_pct) / 100 / perShare);
  const byPosition = Math.floor((equity * max_position_pct) / 100 / entry);
  // A short holds 50% margin against buying power; a buy uses the full cost
  const byCash = Math.floor(buyingPower / (direction === "short" ? entry * 0.5 : entry));
  return Math.max(0, Math.min(byRisk, byPosition, byCash));
}

async function openSignals(userId, botId) {
  return (await listSignals(userId, botId)).filter((s) => ["entered", "pending_entry"].includes(s.status));
}

const verb = (st) => (st.direction === "short" ? "shorted" : "bought");

/** Runs one bot: scan, then enter (paper) or alert on triggered setups, then manage open bot trades. */
export async function runBot(userId, bot, { manual = false } = {}) {
  const cfg = bot.config;
  const st = strategyFor(cfg.strategy);
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
    const key = `${setup.ticker}:${setup.anchor}`;
    // Triggers: a close through the level (or a close-entry signal), or an intraday break of a forming level
    let price = null, triggered = false;
    if (setup.status === "triggered" && (!cfg.entry.require_volume || setup.volume_confirmed)) {
      triggered = true;
      price = setup.trigger_close;
    } else if (setup.status === "forming" && cfg.entry.trigger === "intraday" && market.open) {
      keepWarm([setup.ticker], 24 * 3_600_000); // stream levels being watched so the break is caught live
      price = (await withLivePrice(setup.ticker).catch(() => null))?.price ?? null;
      triggered = price != null && through(st, price, setup.level, cfg.entry.buffer_pct);
    }
    if (!triggered) {
      if (setup.status === "forming" && !seen.has(key)) {
        await db.insert("bot_signals", { user_id: userId, bot_id: bot.id, ticker: setup.ticker, flag_start: setup.anchor, status: "watching", setup });
        seen.add(key);
      }
      continue;
    }
    const prior = existing.find((s) => `${s.ticker}:${s.flag_start}` === key);
    if (prior && prior.status !== "watching") continue; // already acted on this setup
    if (!scan.regime_ok) {
      await upsertSignal(userId, bot, prior, setup, { status: "skipped", reason: `Market filter: SPY is ${scan.regime.state}` });
      continue;
    }
    if (open.some((s) => s.ticker === setup.ticker) || account?.positions.some((p) => p.ticker === setup.ticker)) continue;

    // Enter at the live price, but never better than the level for stop entries
    const entry = round(st.entry === "close" ? price : st.direction === "short" ? Math.min(price, setup.level) : Math.max(price, setup.level));
    const stop = stopPrice(st, { level: setup.level, stop: setup.stop_level }, cfg.exit, setup.atr14);
    const target = targetPrice(st, { target: setup.target_level, exit_rule: setup.exit_rule }, entry, stop, cfg.exit);
    const equity = account?.equity ?? 100_000;
    const shares = sizePosition({ equity, buyingPower: account?.buying_power ?? equity, entry, stop, risk_pct: cfg.sizing.risk_pct, max_position_pct: cfg.sizing.max_position_pct, direction: st.direction });
    const risk = Math.abs(entry - stop);
    const plan = { side: st.direction, entry, stop, target, exit_rule: target == null ? setup.exit_rule : null, shares, risk_dollars: round(shares * risk), r_target: target != null ? round(Math.abs(target - entry) / risk, 2) : null };
    const planText = `${st.direction === "short" ? "Short" : "Buy"} ${shares} sh near $${entry}, stop $${stop}, ${target != null ? `target $${target} (${plan.r_target}R)` : "exit on a close above the 5-day average"}`;

    if (cfg.mode === "alert" || !(shares > 0) || slots <= 0) {
      const why = slots <= 0 ? "max positions reached" : !(shares > 0) ? "position size rounds to 0" : null;
      await upsertSignal(userId, bot, prior, setup, { status: cfg.mode === "alert" ? "alerted" : "skipped", plan, reason: why });
      if (cfg.mode === "alert") {
        await notify(userId, { kind: "bot", ticker: setup.ticker, title: `${bot.name}: ${setup.ticker} triggered`, body: `${st.name}: ${setup.summary}. Plan: ${planText}.` }).catch(() => {});
        log.alerted++;
      }
      continue;
    }
    try {
      const order = await placePaperOrder(userId, { ticker: setup.ticker, side: st.direction === "short" ? "short" : "buy", type: "market", qty: shares });
      await upsertSignal(userId, bot, prior, setup, { status: order.status === "filled" ? "entered" : "pending_entry", plan, entry_order_id: order.id, entry_price: order.filled_price ?? null, entered_at: order.filled_at ?? null });
      await notify(userId, { kind: "bot", ticker: setup.ticker, title: `${bot.name} ${verb(st)} ${shares} ${setup.ticker}`, body: `${st.name}. ${order.status === "filled" ? `Filled at $${Number(order.filled_price).toFixed(2)}` : "Fills at the open"}; stop $${stop}${target != null ? `, target $${target}` : ""}. Practice account.` }).catch(() => {});
      log.entered++;
      slots--;
    } catch (err) {
      await upsertSignal(userId, bot, prior, setup, { status: "skipped", plan, reason: err.message });
    }
  }
  await db.update("trading_bots", bot.id, userId, { last_run_at: log.at, state: { ...(bot.state ?? {}), cursor: scan.next_cursor, last_log: log, last_regime: scan.regime } });
  if (manual) track(userId, "bot_run", { ...log, strategy: cfg.strategy });
  return { ...log, regime: scan.regime, setups: scan.setups };
}

async function upsertSignal(userId, bot, prior, setup, fields) {
  if (prior) return db.update("bot_signals", prior.id, userId, { ...fields, setup });
  return db.insert("bot_signals", { user_id: userId, bot_id: bot.id, ticker: setup.ticker, flag_start: setup.anchor, setup, ...fields });
}

/** True when the live price closes the trade by the strategy's rule (oversold bounce: back above the 5-day average). */
async function ruleExit(s, price) {
  if (s.plan.exit_rule !== "sma5") return false;
  const bars = await getDailyBars(s.ticker, { maxAgeHours: 20 }).catch(() => null);
  if (!bars?.length) return false;
  const last4 = bars.slice(-4).map((b) => b.c);
  return price > (last4.reduce((a, b) => a + b, 0) + price) / 5;
}

/**
 * Manages the bot's open practice trades: places the protective stop once the entry fills, exits at the
 * target or by rule (cancelling the stop), and exits after the time stop. Works for longs and shorts.
 */
export async function manageBot(userId, bot, log = {}) {
  if (bot.config.mode !== "paper") return;
  const signals = await openSignals(userId, bot.id);
  if (!signals.length) return;
  const account = await getPaperAccount(userId);
  const orders = [...account.open_orders, ...account.recent_orders];
  const market = marketStatus();
  for (const s of signals) {
    const short = s.plan?.side === "short";
    const pos = account.positions.find((p) => p.ticker === s.ticker && (short ? p.qty < 0 : p.qty > 0));
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
    // Position gone: the stop filled (or the user closed it)
    if (!pos) {
      const exit = stopOrder?.status === "filled" ? Number(stopOrder.filled_price) : null;
      await closeSignal(userId, s, exit, stopOrder?.status === "filled" ? "stop" : "closed manually");
      log.managed = (log.managed ?? 0) + 1;
      continue;
    }
    const qty = Math.abs(pos.qty);
    const exitSide = short ? "buy" : "sell";
    if (!s.stop_order_id || (stopOrder && stopOrder.status !== "open")) {
      const so = await placePaperOrder(userId, { ticker: s.ticker, side: exitSide, type: "stop", stop_price: s.plan.stop, qty, time_in_force: "gtc" }).catch(() => null);
      if (so) await db.update("bot_signals", s.id, userId, { stop_order_id: so.id });
      continue;
    }
    if (!market.open) continue;
    const ageDays = s.entered_at ? (Date.now() - Date.parse(s.entered_at)) / 86_400_000 : 0;
    const hitTarget = s.plan.target != null && (short ? pos.price <= s.plan.target : pos.price >= s.plan.target);
    const byRule = !hitTarget && (await ruleExit(s, pos.price));
    const timeUp = bot.config.exit.time_stop_days > 0 && ageDays >= bot.config.exit.time_stop_days;
    if (hitTarget || byRule || timeUp) {
      await cancelPaperOrder(userId, s.stop_order_id).catch(() => {});
      const order = await placePaperOrder(userId, { ticker: s.ticker, side: exitSide, type: "market", qty }).catch(() => null);
      await closeSignal(userId, s, order?.filled_price ?? pos.price, hitTarget ? "target" : byRule ? "exit rule" : "time stop");
      log.managed = (log.managed ?? 0) + 1;
    }
  }
}

async function closeSignal(userId, s, exitPrice, reason) {
  const entry = Number(s.entry_price ?? s.plan.entry);
  const r = exitPrice != null ? round(rMultiple(entry, s.plan.stop, Number(exitPrice)), 2) : null;
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
/** Summary stats for a list of simulated trades (results in R, so they don't depend on account size). */
export function summarize(trades, riskPct) {
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
  const count = (reason) => closed.filter((t) => t.reason === reason).length;
  return {
    trades: closed.length,
    open_trades: trades.length - closed.length,
    win_rate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    avg_r: closed.length ? round(totalR / closed.length, 2) : null,
    total_r: round(totalR, 2),
    profit_factor: grossL ? round(grossW / grossL, 2) : null,
    max_drawdown_r: round(dd, 2),
    account_return_pct: round(totalR * riskPct, 1),
    exits: { target: count("target"), stop: count("stop"), time: count("time"), rule: count("rule") },
    curve,
  };
}

/**
 * Replays the bot's rules over ~2 years of daily bars for up to 12 tickers: market filter on SPY, the
 * strategy's setup each day, entry per the entry rule, then stop / target / exit rule / time stop.
 */
export async function backtestBot(userId, botOrConfig, { maxTickers = 12 } = {}) {
  if (!pricesEnabled()) throw bad("Price history isn't set up on this server (MASSIVE_API_KEY).", 503);
  const cfg = botOrConfig.config ? botOrConfig.config : cleanConfig(botOrConfig);
  const st = strategyFor(cfg.strategy);
  const tickers = (await tickersFor(userId, { config: cfg })).slice(0, maxTickers);
  if (!tickers.length) throw bad("No tickers to test. Add stocks to your watchlist or pick a universe.");
  const spy = await getDailyBars("SPY");
  const spyCloses = spy.map((b) => b.c);
  const s50 = sma(spyCloses, 50), s200 = sma(spyCloses, 200);
  const spyIndex = new Map(spy.map((b, i) => [new Date(b.t).toISOString().slice(0, 10), i]));
  const regimeAt = (t) => {
    const si = spyIndex.get(new Date(t).toISOString().slice(0, 10));
    return regimePasses(cfg.market_filter, si != null ? marketRegime(spy, { end: si, sma50: s50, sma200: s200 }).state : "unknown");
  };
  const trades = [];
  let skippedRegime = 0;
  for (const ticker of tickers) {
    let bars;
    try {
      bars = await getDailyBars(ticker, { maxAgeHours: 24 });
    } catch {
      continue;
    }
    const r = simulate(st, bars, cfg, { regimeAt });
    skippedRegime += r.skippedRegime;
    trades.push(...r.trades.map((t) => ({ ticker, ...t })));
  }
  trades.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return {
    strategy: cfg.strategy,
    tickers,
    period: { from: trades[0]?.entry_date ?? null, to: today() },
    ...summarize(trades, cfg.sizing.risk_pct),
    skipped_by_market_filter: skippedRegime,
    recent: trades.slice(-25).reverse(),
    note: "Simulated on daily bars: fills at the stated level or the open on gaps, no slippage, fees or borrow costs, one trade per ticker at a time. Past results don't predict future returns.",
  };
}
