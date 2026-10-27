import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { runAgent } from "./llm.js";
import { enforceOutput } from "./guardrails.js";
import { obj, str, arr } from "../agents/schema.js";

// Trade journal: log trades with setup, emotion and plan (stop/target), then get hard statistics
// (win rate, expectancy, R-multiples, profit factor, drawdown, patterns by setup/emotion/time),
// realized P/L and wash-sale flags, plus an AI coach that explains the patterns behind the numbers.

export const EMOTIONS = ["calm", "confident", "fomo", "fearful", "revenge", "bored", "greedy", "impulsive"];
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

// ---------- CRUD ----------
export async function listTrades(userId) {
  if (config.localMode) return localStore.rows("trades").filter((t) => t.user_id === userId).sort((a, b) => (b.entry_date ?? "").localeCompare(a.entry_date ?? ""));
  const { data, error } = await supabase().from("trades").select("*").eq("user_id", userId).order("entry_date", { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  return data;
}

const FIELDS = ["ticker", "side", "instrument", "quantity", "entry_price", "entry_date", "exit_price", "exit_date", "stop_price", "target_price", "setup", "emotion", "notes", "fees"];

/** Validates and normalizes a trade from user input. Throws 400 with a readable message. */
export function cleanTrade(input, { partial = false } = {}) {
  const t = Object.fromEntries(Object.entries(input ?? {}).filter(([k]) => FIELDS.includes(k)));
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
  if (!partial || "ticker" in t) {
    t.ticker = String(t.ticker ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,20}$/.test(t.ticker)) throw bad("Enter a valid ticker");
  }
  if (!partial || "side" in t) {
    t.side = t.side === "short" ? "short" : "long";
  }
  if (!partial || "instrument" in t) t.instrument = ["stock", "option", "etf", "crypto", "future"].includes(t.instrument) ? t.instrument : "stock";
  for (const k of ["quantity", "entry_price", "exit_price", "stop_price", "target_price", "fees"]) if (k in t) t[k] = numOrNull(t[k]);
  if (!partial || "quantity" in t) if (!(t.quantity > 0)) throw bad("Quantity must be greater than 0");
  if (!partial || "entry_price" in t) if (!(t.entry_price > 0)) throw bad("Entry price must be greater than 0");
  if (t.exit_price != null && !(t.exit_price > 0)) throw bad("Exit price must be greater than 0");
  for (const k of ["entry_date", "exit_date"]) {
    if (k in t && t[k]) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(t[k]))) throw bad(`${k.replace("_", " ")} must be YYYY-MM-DD`);
      t[k] = String(t[k]).slice(0, 10);
    }
  }
  if (!partial && !t.entry_date) t.entry_date = new Date().toISOString().slice(0, 10);
  if (t.exit_price != null && !t.exit_date) t.exit_date = new Date().toISOString().slice(0, 10);
  if (t.exit_date && t.entry_date && t.exit_date < t.entry_date) throw bad("Exit date can't be before entry date");
  if ("emotion" in t && t.emotion && !EMOTIONS.includes(t.emotion)) t.emotion = null;
  for (const k of ["setup", "notes"]) if (k in t && t[k] != null) t[k] = String(t[k]).slice(0, k === "notes" ? 1000 : 60);
  return t;
}

export async function addTrade(userId, input) {
  const row = { user_id: userId, ...cleanTrade(input) };
  if (config.localMode) return localStore.insert("trades", row);
  const { data, error } = await supabase().from("trades").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateTrade(userId, id, input) {
  const fields = cleanTrade(input, { partial: true });
  if (config.localMode) {
    const hit = localStore.update("trades", (t) => t.id === id && t.user_id === userId, fields);
    return hit[0] ?? null;
  }
  const { data, error } = await supabase().from("trades").update(fields).eq("id", id).eq("user_id", userId).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTrade(userId, id) {
  if (config.localMode) return localStore.remove("trades", (t) => t.id === id && t.user_id === userId) > 0;
  const { data, error } = await supabase().from("trades").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) throw new Error(error.message);
  return data.length > 0;
}

// ---------- Statistics (pure) ----------
const multiplier = (t) => (t.instrument === "option" ? 100 : 1);

/** P/L in dollars, return %, and R-multiple (if a stop was set) for a closed trade. */
export function tradeResult(t) {
  if (t.exit_price == null) return null;
  const dir = t.side === "short" ? -1 : 1;
  const gross = dir * (t.exit_price - t.entry_price) * t.quantity * multiplier(t);
  const pnl = gross - (t.fees ?? 0);
  const risk = t.stop_price != null ? Math.abs(t.entry_price - t.stop_price) * t.quantity * multiplier(t) : null;
  return {
    pnl: round(pnl),
    return_pct: round(((dir * (t.exit_price - t.entry_price)) / t.entry_price) * 100),
    r_multiple: risk ? round(pnl / risk) : null,
    hold_days: t.exit_date && t.entry_date ? Math.round((Date.parse(t.exit_date) - Date.parse(t.entry_date)) / 86_400_000) : null,
  };
}

function groupStats(closed, keyFn) {
  const groups = new Map();
  for (const t of closed) {
    const k = keyFn(t);
    if (k == null) continue;
    const g = groups.get(k) ?? { trades: 0, wins: 0, pnl: 0 };
    g.trades++;
    if (t.result.pnl > 0) g.wins++;
    g.pnl += t.result.pnl;
    groups.set(k, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, trades: g.trades, win_rate: round((g.wins / g.trades) * 100, 1), pnl: round(g.pnl), avg_pnl: round(g.pnl / g.trades) }))
    .sort((a, b) => b.trades - a.trades);
}

/**
 * Wash-sale flags (US rule, simplified): a stock closed at a loss with a purchase of the same ticker
 * within 30 days before or after the sale. Flags for review; not tax advice.
 */
export function washSales(trades) {
  const flags = [];
  for (const t of trades) {
    const r = tradeResult(t);
    if (!r || r.pnl >= 0 || t.side === "short") continue;
    const sale = Date.parse(t.exit_date);
    // Replacement shares: bought within 30 days of the loss sale and still held after it (a lot that was
    // already sold before the loss sale doesn't replace anything)
    const rebuy = trades.find(
      (o) =>
        o.id !== t.id &&
        o.ticker === t.ticker &&
        o.side === "long" &&
        Math.abs(Date.parse(o.entry_date) - sale) <= 30 * 86_400_000 &&
        (!o.exit_date || o.exit_date > t.exit_date)
    );
    if (rebuy) flags.push({ trade_id: t.id, ticker: t.ticker, sold: t.exit_date, loss: r.pnl, rebought: rebuy.entry_date });
  }
  return flags;
}

export function journalStats(trades) {
  const closed = trades.map((t) => ({ ...t, result: tradeResult(t) })).filter((t) => t.result).sort((a, b) => a.exit_date.localeCompare(b.exit_date));
  const open = trades.filter((t) => t.exit_price == null);
  const wins = closed.filter((t) => t.result.pnl > 0);
  const losses = closed.filter((t) => t.result.pnl < 0);
  const sum = (xs) => xs.reduce((s, t) => s + t.result.pnl, 0);
  const grossWin = sum(wins), grossLoss = Math.abs(sum(losses));

  // Equity curve and max drawdown on cumulative realized P/L
  let equity = 0, peak = 0, maxDd = 0;
  const curve = closed.map((t) => {
    equity += t.result.pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
    return { date: t.exit_date, equity: round(equity), ticker: t.ticker };
  });

  // Streaks
  let streak = 0, maxWinStreak = 0, maxLossStreak = 0;
  for (const t of closed) {
    if (t.result.pnl > 0) streak = streak > 0 ? streak + 1 : 1;
    else if (t.result.pnl < 0) streak = streak < 0 ? streak - 1 : -1;
    maxWinStreak = Math.max(maxWinStreak, streak);
    maxLossStreak = Math.min(maxLossStreak, streak);
  }

  // Trades placed within 2 days after a loss: a proxy for revenge trading
  const afterLoss = closed.filter((t, i) => i > 0 && closed[i - 1].result.pnl < 0 && Math.abs(Date.parse(t.entry_date) - Date.parse(closed[i - 1].exit_date)) <= 2 * 86_400_000);
  const rs = closed.map((t) => t.result.r_multiple).filter((r) => r != null);
  const year = new Date().getUTCFullYear().toString();
  const ytd = closed.filter((t) => t.exit_date.startsWith(year));
  const holdWins = wins.map((t) => t.result.hold_days).filter((d) => d != null);
  const holdLosses = losses.map((t) => t.result.hold_days).filter((d) => d != null);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    totals: {
      trades: trades.length,
      closed: closed.length,
      open: open.length,
      win_rate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
      net_pnl: round(sum(closed)),
      avg_win: wins.length ? round(grossWin / wins.length) : null,
      avg_loss: losses.length ? round(-grossLoss / losses.length) : null,
      profit_factor: grossLoss ? round(grossWin / grossLoss) : wins.length ? null : null,
      expectancy: closed.length ? round(sum(closed) / closed.length) : null,
      avg_r: rs.length ? round(avg(rs)) : null,
      trades_with_stop_pct: closed.length ? round((closed.filter((t) => t.stop_price != null).length / closed.length) * 100, 1) : null,
      max_drawdown: round(maxDd),
      best_trade: closed.length ? round(Math.max(...closed.map((t) => t.result.pnl))) : null,
      worst_trade: closed.length ? round(Math.min(...closed.map((t) => t.result.pnl))) : null,
      max_win_streak: maxWinStreak,
      max_loss_streak: Math.abs(maxLossStreak),
      avg_hold_days_wins: round(avg(holdWins), 1),
      avg_hold_days_losses: round(avg(holdLosses), 1),
    },
    realized: { ytd_pnl: round(sum(ytd)), ytd_trades: ytd.length, year: Number(year) },
    after_loss: { trades: afterLoss.length, win_rate: afterLoss.length ? round((afterLoss.filter((t) => t.result.pnl > 0).length / afterLoss.length) * 100, 1) : null, pnl: round(sum(afterLoss)) },
    by_setup: groupStats(closed, (t) => t.setup || null),
    by_emotion: groupStats(closed, (t) => t.emotion || null),
    by_ticker: groupStats(closed, (t) => t.ticker).slice(0, 10),
    by_side: groupStats(closed, (t) => t.side),
    by_weekday: groupStats(closed, (t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${t.entry_date}T12:00:00Z`).getUTCDay()]),
    wash_sales: washSales(trades),
    equity_curve: curve,
  };
}

// ---------- AI coach ----------
const coachSchema = obj({
  headline: str("One sentence summary of how the trader is doing, citing the key numbers"),
  strengths: arr(str("Something the data shows they do well, with the numbers"), "1-3 items"),
  leaks: arr(obj({ pattern: str("A costly behavior pattern"), evidence: str("The numbers from the stats that show it"), impact: str("Roughly what it cost, from the stats") }), "1-4 of the most costly patterns, most costly first"),
  rules_to_consider: arr(str("A concrete, testable trading rule that targets a leak (e.g. 'No new trades within 1 day after a loss')"), "2-4 rules"),
  next_focus: str("The single most important thing to work on next, in one sentence"),
});

/** AI trading coach: interprets journal statistics. Grounded on computed numbers; process-focused, no stock picks. */
export async function journalCoach(stats, recentTrades) {
  const out = await runAgent({
    agent: "journal_coach",
    effort: "low",
    schema: coachSchema,
    system: `You are a trading performance coach reviewing a retail trader's journal statistics.
Use only the numbers provided; every figure you cite must appear in the data. Focus on process and behavior (risk management, discipline, emotions, timing, sizing), not on predicting markets.
Never recommend specific securities or trades. Be direct and constructive. If there are fewer than 10 closed trades, say the sample is small and conclusions are tentative.`,
    prompt: `Journal statistics (JSON):\n${JSON.stringify({ ...stats, equity_curve: undefined }, null, 2)}\n\nMost recent closed trades (JSON):\n${JSON.stringify(recentTrades, null, 2)}`,
  });
  return enforceOutput(out).value;
}

// ---------- CSV import (broker trade history) ----------
/**
 * Parses closed-trade CSVs with columns like Symbol, Side, Qty, Entry/Buy Price, Exit/Sell Price,
 * Entry Date/Open Date, Exit Date/Close Date, Fees. Returns {trades, skipped}.
 */
export function parseTradesCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { trades: [], skipped: [] };
  const delim = [",", ";", "\t"].map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const split = (l) => l.split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const col = (...names) => {
    for (const n of names) if (header.includes(n)) return header.indexOf(n);
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const idx = {
    ticker: col("symbol", "ticker"),
    side: col("side", "direction", "type"),
    quantity: col("qty", "quantity", "shares", "size"),
    entry_price: col("entry price", "buy price", "open price", "entry", "avg entry"),
    exit_price: col("exit price", "sell price", "close price", "exit", "avg exit"),
    entry_date: col("entry date", "open date", "buy date", "opened", "date opened"),
    exit_date: col("exit date", "close date", "sell date", "closed", "date closed"),
    fees: col("fees", "commission"),
    setup: col("setup", "strategy", "tag"),
    stop_price: col("stop", "stop loss", "stop price"),
    target_price: col("target", "take profit", "target price"),
    emotion: col("emotion", "feeling", "mood"),
    notes: col("notes", "note", "comment"),
    instrument: col("instrument", "asset class", "asset"),
  };
  if (idx.ticker < 0 || idx.quantity < 0 || idx.entry_price < 0) return { trades: [], skipped: lines.slice(1, 6), error: "Couldn't find Symbol, Quantity and Entry Price columns" };
  const trades = [], skipped = [];
  for (const line of lines.slice(1)) {
    const c = split(line);
    const get = (k) => (idx[k] >= 0 ? c[idx[k]] : undefined);
    const num = (v) => (v == null || v === "" ? undefined : Number(String(v).replace(/[$,]/g, "")));
    try {
      trades.push(cleanTrade({
        ticker: get("ticker"),
        side: /short|sell short|^s$/i.test(get("side") ?? "") ? "short" : "long",
        quantity: Math.abs(num(get("quantity"))),
        entry_price: num(get("entry_price")),
        exit_price: num(get("exit_price")),
        entry_date: get("entry_date") ? new Date(get("entry_date")).toISOString().slice(0, 10) : undefined,
        exit_date: get("exit_date") ? new Date(get("exit_date")).toISOString().slice(0, 10) : undefined,
        fees: num(get("fees")),
        setup: get("setup"),
        stop_price: num(get("stop_price")),
        target_price: num(get("target_price")),
        emotion: get("emotion")?.toLowerCase() || undefined,
        notes: get("notes"),
        instrument: get("instrument")?.toLowerCase(),
      }));
    } catch {
      skipped.push(line);
    }
  }
  return { trades, skipped };
}
