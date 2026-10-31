import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { db } from "./db.js";
import { withLivePrice, keepWarm } from "./stream.js";
import { addTrade } from "./journal.js";
import { notify } from "./notify.js";
import { track } from "./analytics.js";

// Paper trading: a practice brokerage account with fake money and live prices.
// Market orders fill at the last price during market hours (queued until the open otherwise);
// limit and stop orders rest until the price crosses them. Shorting is supported: side "short" sells
// shares you don't own (a negative position), and a buy on a short position covers it. Shorts hold
// 150% of their value against buying power (the sale proceeds plus 50% margin, like Reg T).
// Closed trades are written to the journal (setup "paper") so the coach and stats include them.

export const STARTING_CASH = Number(process.env.PAPER_STARTING_CASH || 100_000);
const TYPES = ["market", "limit", "stop"];
const SIDES = ["buy", "sell", "short"];
const SHORT_MARGIN = 0.5; // extra buying power a short holds on top of its proceeds
const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const round = (x, d = 2) => Number(Number(x).toFixed(d));

// ---------- Market hours (NYSE regular session, holidays not modeled) ----------
export function marketStatus(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  const open = weekday && minutes >= 570 && minutes < 960; // 9:30 to 16:00 ET
  return { open, label: open ? "Market open" : weekday && minutes < 570 ? "Pre-market" : weekday && minutes >= 960 ? "After hours" : "Weekend" };
}

// ---------- Pure fill logic (unit tested) ----------
/** Whether a resting order fills at `price`, and at what price. */
export function shouldFill(order, price, { open }) {
  if (!open || !(price > 0)) return null;
  if (order.type === "market") return price;
  if (order.type === "limit") return order.side === "buy" ? (price <= order.limit_price ? Math.min(price, order.limit_price) : null) : price >= order.limit_price ? Math.max(price, order.limit_price) : null;
  if (order.type === "stop") return order.side === "buy" ? (price >= order.stop_price ? price : null) : price <= order.stop_price ? price : null;
  return null;
}

/**
 * Applies a fill to a position (weighted average cost; negative qty = short). Returns the new position
 * and realized P/L for sells and covers.
 */
export function applyFill(position, { side, qty, price }) {
  const pos = position ?? { qty: 0, avg_cost: 0 };
  if (side === "short") {
    if (pos.qty > 1e-9) throw bad(`Sell your ${pos.qty} shares before shorting`);
    const qtyNew = pos.qty - qty;
    return { position: { ...pos, qty: round(qtyNew, 6), avg_cost: round((-pos.qty * pos.avg_cost + qty * price) / -qtyNew, 6) }, realized: 0 };
  }
  if (side === "buy" && pos.qty < -1e-9) {
    // Buy to cover a short
    if (qty > -pos.qty + 1e-9) throw bad(`You're short ${-pos.qty} shares: buy up to that many to cover`);
    return { position: { ...pos, qty: round(pos.qty + qty, 6) }, realized: round((pos.avg_cost - price) * qty) };
  }
  if (side === "buy") {
    const qtyNew = pos.qty + qty;
    return { position: { ...pos, qty: round(qtyNew, 6), avg_cost: round((pos.qty * pos.avg_cost + qty * price) / qtyNew, 6) }, realized: 0 };
  }
  if (pos.qty < -1e-9) throw bad("You're short this stock: buy to cover it");
  if (qty > pos.qty + 1e-9) throw bad(`You only have ${pos.qty} shares to sell`);
  return { position: { ...pos, qty: round(pos.qty - qty, 6) }, realized: round((price - pos.avg_cost) * qty) };
}

// ---------- Storage ----------
async function getAccountRow(userId) {
  if (config.localMode) return localStore.rows("paper_accounts").find((a) => a.user_id === userId) ?? null;
  const { data } = await supabase().from("paper_accounts").select("*").eq("user_id", userId).maybeSingle();
  return data;
}
async function saveAccount(userId, fields) {
  const row = { user_id: userId, ...fields, updated_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("paper_accounts", "user_id", row);
  const { data, error } = await supabase().from("paper_accounts").upsert(row, { onConflict: "user_id" }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}
async function ensureAccount(userId) {
  return (await getAccountRow(userId)) ?? saveAccount(userId, { cash: STARTING_CASH, starting_cash: STARTING_CASH, realized_pnl: 0, resets: 0 });
}
const listPositions = (userId) => db.list("paper_positions", { user_id: userId }, { order: "ticker", limit: 500 });
const listOrders = (userId, limit = 100) => db.list("paper_orders", { user_id: userId }, { order: "created_at", ascending: false, limit });

async function upsertPosition(userId, ticker, pos) {
  const existing = (await listPositions(userId)).find((p) => p.ticker === ticker);
  if (Math.abs(pos.qty) <= 1e-9) {
    if (existing) await db.remove("paper_positions", existing.id, userId);
    return null;
  }
  return existing ? db.update("paper_positions", existing.id, userId, { qty: pos.qty, avg_cost: pos.avg_cost, opened_at: existing.opened_at ?? pos.opened_at }) : db.insert("paper_positions", { user_id: userId, ticker, qty: pos.qty, avg_cost: pos.avg_cost, opened_at: pos.opened_at });
}

// ---------- Account view ----------
/** Cash, positions at live prices, equity, P/L and buying power (cash minus what open buy orders reserve). */
export async function getPaperAccount(userId) {
  await processOpenOrders(userId).catch(() => {});
  const account = await ensureAccount(userId);
  const [positions, orders] = await Promise.all([listPositions(userId), listOrders(userId, 50)]);
  const priced = await Promise.all(
    positions.map(async (p) => {
      const q = await withLivePrice(p.ticker).catch(() => null);
      const price = q?.price ?? p.avg_cost;
      const qty = Number(p.qty), cost = Number(p.avg_cost);
      const dir = qty < 0 ? -1 : 1;
      // Bought today: today's change is the move since the fill, not the stock's whole-day move
      const boughtToday = String(p.opened_at ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10);
      return { ticker: p.ticker, name: q?.name ?? p.ticker, side: dir < 0 ? "short" : "long", qty, avg_cost: round(cost, 4), price, value: round(qty * price), unrealized: round((price - cost) * qty), unrealized_pct: round(((price - cost) / cost) * 100 * dir), day_change: boughtToday ? round((price - cost) * qty) : q ? round((q.change ?? 0) * qty) : 0, day_change_pct: q?.changePercent != null ? round(q.changePercent) : null, opened_at: p.opened_at };
    })
  );
  const open = orders.filter((o) => o.status === "open");
  // Open buys reserve their cost (except covers, which the short's margin already holds); open shorts reserve their margin
  const shortTickers = new Set(priced.filter((p) => p.qty < 0).map((p) => p.ticker));
  const orderValue = (o) => Number(o.qty) * Number(o.limit_price ?? o.stop_price ?? o.est_price ?? 0);
  const reserved = open.reduce((s, o) => s + (o.side === "buy" && !shortTickers.has(o.ticker) ? orderValue(o) : o.side === "short" ? orderValue(o) * SHORT_MARGIN : 0), 0);
  const shortValue = priced.reduce((s, p) => s + (p.qty < 0 ? -p.value : 0), 0);
  const invested = priced.reduce((s, p) => s + p.value, 0);
  const cash = Number(account.cash);
  const equity = cash + invested;
  return {
    cash: round(cash),
    buying_power: round(Math.max(0, cash - reserved - shortValue * (1 + SHORT_MARGIN))),
    invested: round(invested),
    equity: round(equity),
    starting_cash: Number(account.starting_cash),
    total_pnl: round(equity - Number(account.starting_cash)),
    total_pnl_pct: round(((equity - Number(account.starting_cash)) / Number(account.starting_cash)) * 100),
    realized_pnl: round(Number(account.realized_pnl ?? 0)),
    day_change: round(priced.reduce((s, p) => s + p.day_change, 0)),
    positions: priced.sort((a, b) => b.value - a.value),
    open_orders: open,
    recent_orders: orders.filter((o) => o.status !== "open").slice(0, 25),
    market: marketStatus(),
    resets: account.resets ?? 0,
  };
}

// ---------- Orders ----------
function cleanOrder(input) {
  const ticker = String(input.ticker ?? "").trim().toUpperCase();
  if (!SYM.test(ticker)) throw bad("Enter a valid ticker");
  const side = SIDES.includes(input.side) ? input.side : "buy";
  const type = TYPES.includes(input.type) ? input.type : "market";
  const qty = Number(input.qty);
  if (!(qty > 0) || qty > 1e6) throw bad("Enter a quantity greater than 0");
  const limit = Number(input.limit_price), stop = Number(input.stop_price);
  if (type === "limit" && !(limit > 0)) throw bad("Enter a limit price");
  if (type === "stop" && !(stop > 0)) throw bad("Enter a stop price");
  return { ticker, side, type, qty: round(qty, 6), limit_price: type === "limit" ? limit : null, stop_price: type === "stop" ? stop : null, time_in_force: input.time_in_force === "day" ? "day" : "gtc" };
}

/** What an order would do, without placing it: estimated price and cost, buying power after, problems. */
export async function previewPaperOrder(userId, input) {
  const o = cleanOrder(input);
  const [acct, quote] = await Promise.all([getPaperAccount(userId), withLivePrice(o.ticker)]);
  const estPrice = o.type === "limit" ? o.limit_price : o.type === "stop" ? o.stop_price : quote.price;
  const cost = estPrice * o.qty;
  const held = acct.positions.find((p) => p.ticker === o.ticker)?.qty ?? 0;
  const pendingSells = acct.open_orders.filter((x) => x.ticker === o.ticker && x.side === "sell").reduce((s, x) => s + Number(x.qty), 0);
  const problems = [];
  const covering = o.side === "buy" && held < 0;
  const pendingCovers = acct.open_orders.filter((x) => x.ticker === o.ticker && x.side === "buy").reduce((s, x) => s + Number(x.qty), 0);
  if (o.side === "buy" && !covering && cost > acct.buying_power) problems.push(`Not enough buying power: this needs about ${cost.toFixed(2)}, you have ${acct.buying_power.toFixed(2)}.`);
  if (covering && o.qty > -held - pendingCovers + 1e-9) problems.push(`You're short ${-held} shares of ${o.ticker}: buy up to ${Math.max(0, -held - pendingCovers)} to cover.`);
  if (o.side === "sell" && held < 0) problems.push(`You're short ${o.ticker}: buy to cover it instead.`);
  else if (o.side === "sell" && o.qty > held - pendingSells + 1e-9) problems.push(`You can sell up to ${Math.max(0, held - pendingSells)} shares of ${o.ticker}.`);
  if (o.side === "short" && held > 0) problems.push(`Sell your ${held} shares of ${o.ticker} before shorting it.`);
  if (o.side === "short" && cost * SHORT_MARGIN > acct.buying_power) problems.push(`Not enough buying power: a short holds 50% margin (about ${(cost * SHORT_MARGIN).toFixed(2)}), you have ${acct.buying_power.toFixed(2)}.`);
  if (o.type === "market" && !acct.market.open) problems.push(`${acct.market.label}: a market order will fill at the next open, at whatever the price is then.`);
  return {
    order: o,
    quote: { price: quote.price, change_pct: quote.changePercent, name: quote.name },
    est_price: round(estPrice),
    est_cost: round(cost),
    buying_power: acct.buying_power,
    buying_power_after: round(acct.buying_power + (o.side === "short" ? -cost * SHORT_MARGIN : covering ? cost * SHORT_MARGIN : o.side === "buy" ? -cost : cost)),
    position_qty: held,
    market: acct.market,
    blocking: problems.filter((p) => !p.includes("next open")),
    warnings: problems.filter((p) => p.includes("next open")),
  };
}

export async function placePaperOrder(userId, input) {
  const preview = await previewPaperOrder(userId, input);
  if (preview.blocking.length) throw bad(preview.blocking[0]);
  const o = preview.order;
  const row = await db.insert("paper_orders", { user_id: userId, ...o, status: "open", est_price: preview.est_price });
  track(userId, "paper_order", { side: o.side, type: o.type });
  // Market orders during market hours fill now; everything else rests until the price or the open arrives
  if (o.type !== "market") keepWarm([o.ticker], 7 * 86_400_000); // stream resting orders' symbols so they fill on live prices
  const filled = await tryFill(userId, row, preview.quote.price, preview.market);
  return filled ?? row;
}

export async function cancelPaperOrder(userId, id) {
  const order = await db.get("paper_orders", id, userId);
  if (!order) throw bad("Order not found", 404);
  if (order.status !== "open") throw bad(`This order is already ${order.status}`, 409);
  return db.update("paper_orders", id, userId, { status: "cancelled", closed_at: new Date().toISOString() });
}

/** Fills one order at `price` if it should fill now: moves cash, updates the position, journals closed trades. */
async function tryFill(userId, order, price, market) {
  const fillPrice = shouldFill(order, price, market);
  if (fillPrice == null) return null;
  const account = await ensureAccount(userId);
  const positions = await listPositions(userId);
  const current = positions.find((p) => p.ticker === order.ticker);
  const qty = Number(order.qty);
  const cost = fillPrice * qty;
  if (order.side === "buy" && !(Number(current?.qty) < 0) && cost > Number(account.cash) + 1e-6) {
    return db.update("paper_orders", order.id, userId, { status: "rejected", reason: "Not enough cash when the order triggered", closed_at: new Date().toISOString() });
  }
  let result;
  try {
    result = applyFill(current && { qty: Number(current.qty), avg_cost: Number(current.avg_cost) }, { side: order.side, qty, price: fillPrice });
  } catch (err) {
    return db.update("paper_orders", order.id, userId, { status: "rejected", reason: err.message, closed_at: new Date().toISOString() });
  }
  const now = new Date().toISOString();
  await upsertPosition(userId, order.ticker, { ...result.position, opened_at: current?.opened_at ?? now });
  await saveAccount(userId, {
    cash: round(Number(account.cash) + (order.side === "buy" ? -cost : cost), 4),
    realized_pnl: round(Number(account.realized_pnl ?? 0) + result.realized, 4),
  });
  const filled = await db.update("paper_orders", order.id, userId, { status: "filled", filled_price: round(fillPrice, 4), filled_at: now, closed_at: now });
  const closing = current && ((order.side === "sell" && Number(current.qty) > 0) || (order.side === "buy" && Number(current.qty) < 0));
  if (closing) {
    await addTrade(userId, {
      ticker: order.ticker, side: order.side === "buy" ? "short" : "long", instrument: "stock", quantity: qty,
      entry_price: Number(current.avg_cost), entry_date: String(current.opened_at ?? now).slice(0, 10),
      exit_price: fillPrice, exit_date: now.slice(0, 10), setup: "paper", notes: `Paper trade (${order.type} order)`, external_id: `paper:${order.id}`,
    }).catch(() => {});
  }
  return filled;
}

/** Checks one user's resting orders against live prices (also runs from the scheduled job). */
export async function processOpenOrders(userId) {
  const open = (await listOrders(userId, 200)).filter((o) => o.status === "open");
  if (!open.length) return 0;
  const market = marketStatus();
  if (!market.open) {
    // Day orders expire at the close
    for (const o of open.filter((x) => x.time_in_force === "day" && x.type !== "market" && x.created_at.slice(0, 10) < new Date().toISOString().slice(0, 10))) {
      await db.update("paper_orders", o.id, userId, { status: "expired", closed_at: new Date().toISOString() });
    }
    return 0;
  }
  const prices = new Map();
  let filled = 0;
  for (const o of open.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!prices.has(o.ticker)) prices.set(o.ticker, (await withLivePrice(o.ticker).catch(() => null))?.price ?? null);
    const row = await tryFill(userId, o, prices.get(o.ticker), market);
    if (row?.status === "filled") {
      filled++;
      if (o.type !== "market") await notify(userId, { kind: "paper_fill", ticker: o.ticker, title: `Paper order filled: ${o.side} ${o.qty} ${o.ticker}`, body: `Your ${o.type} order filled at $${Number(row.filled_price).toFixed(2)}.` }).catch(() => {});
    }
  }
  return filled;
}

/** Scheduled job: every user's resting paper orders. */
export async function runPaperOrders() {
  if (!marketStatus().open) return { skipped: "market closed" };
  const users = [...new Set((await db.all("paper_orders", { match: { status: "open" }, columns: "user_id" })).map((o) => o.user_id))];
  let filled = 0;
  for (const u of users) filled += await processOpenOrders(u).catch(() => 0);
  return { users: users.length, filled };
}

/** Starts over with fresh cash: clears positions and open orders (history is kept). */
export async function resetPaperAccount(userId) {
  const account = await ensureAccount(userId);
  for (const p of await listPositions(userId)) await db.remove("paper_positions", p.id, userId);
  for (const o of (await listOrders(userId, 500)).filter((x) => x.status === "open")) await db.update("paper_orders", o.id, userId, { status: "cancelled", closed_at: new Date().toISOString() });
  track(userId, "paper_reset");
  return saveAccount(userId, { cash: STARTING_CASH, starting_cash: STARTING_CASH, realized_pnl: 0, resets: (account.resets ?? 0) + 1 });
}
