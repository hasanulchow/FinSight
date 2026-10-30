import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import { config } from "../config.js";
import { db } from "./db.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { upsertHoldings } from "./portfolio.js";
import { listTrades, addTrade } from "./journal.js";
import { track } from "./analytics.js";

// Broker sync through SnapTrade (read-only connections to Robinhood, Schwab, Fidelity, IBKR, Webull, ...).
// The user links an account in SnapTrade's portal; we then import positions into Holdings and
// buy/sell fills into the trade journal, matched first-in-first-out into round trips.
// FinSight never places orders.

const CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID || null;
const CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY || null;
export const brokerEnabled = () => Boolean(CLIENT_ID && CONSUMER_KEY);
// Placing real orders is a separate switch: needs SnapTrade's trading plan and your own legal sign-off
export const brokerTradingEnabled = () => brokerEnabled() && process.env.BROKER_TRADING_ENABLED === "true";

let client;
const api = () => {
  if (!brokerEnabled()) throw Object.assign(new Error("Broker sync isn't set up on this server yet."), { status: 503 });
  client ??= new Snaptrade({ auth: SnaptradeAuth.commercialApiKey({ clientId: CLIENT_ID, consumerKey: CONSUMER_KEY }) });
  return client;
};

// The SnapTrade user secret is encrypted at rest (AES-256-GCM). Key: ENCRYPTION_KEY, else derived from the consumer key.
const key = () => createHash("sha256").update(process.env.ENCRYPTION_KEY || CONSUMER_KEY || "finsight-local").digest();
function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

async function getConnection(userId) {
  if (config.localMode) return localStore.rows("broker_connections").find((c) => c.user_id === userId) ?? null;
  const { data } = await supabase().from("broker_connections").select("*").eq("user_id", userId).maybeSingle();
  return data;
}
async function saveConnection(userId, fields) {
  const row = { user_id: userId, ...fields, updated_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("broker_connections", "user_id", row);
  const { error } = await supabase().from("broker_connections").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function brokerStatus(userId) {
  const conn = await getConnection(userId);
  return { enabled: brokerEnabled(), trading_enabled: brokerTradingEnabled(), connected: Boolean(conn), last_sync_at: conn?.last_sync_at ?? null, last_sync: conn?.last_sync ?? null };
}

/** Registers the user with SnapTrade if needed and returns the connection-portal URL. */
export async function connectUrl(userId, { returnUrl } = {}) {
  const s = api();
  let conn = await getConnection(userId);
  if (!conn) {
    const { data } = await s.authentication.registerSnapTradeUser({ userId });
    await saveConnection(userId, { snaptrade_user_id: data.userId, user_secret_enc: encrypt(data.userSecret) });
    conn = await getConnection(userId);
    track(userId, "broker_register");
  }
  const { data } = await s.authentication.loginSnapTradeUser({
    userId: conn.snaptrade_user_id,
    userSecret: decrypt(conn.user_secret_enc),
    connectionType: brokerTradingEnabled() ? "trade" : "read",
    ...(returnUrl && { customRedirect: returnUrl }),
  });
  if (!data?.redirectURI) throw new Error("SnapTrade didn't return a connection link");
  return { url: data.redirectURI };
}

/** Pairs buy and sell fills per ticker, first in first out, into journal round trips (long only). */
export function fifoRoundTrips(fills) {
  const open = new Map(); // ticker -> [{qty, price, date, id}]
  const trips = [];
  for (const f of [...fills].sort((a, b) => a.date.localeCompare(b.date))) {
    const lots = open.get(f.ticker) ?? [];
    if (f.side === "buy") {
      lots.push({ qty: f.qty, price: f.price, date: f.date, id: f.id });
      open.set(f.ticker, lots);
      continue;
    }
    let qty = f.qty;
    while (qty > 1e-9 && lots.length) {
      const lot = lots[0];
      const used = Math.min(qty, lot.qty);
      trips.push({ ticker: f.ticker, quantity: Number(used.toFixed(6)), entry_price: lot.price, entry_date: lot.date, exit_price: f.price, exit_date: f.date, external_id: `${lot.id}>${f.id}:${used}` });
      lot.qty -= used;
      qty -= used;
      if (lot.qty <= 1e-9) lots.shift();
    }
  }
  // Still-open lots become open journal trades
  for (const [ticker, lots] of open) for (const lot of lots) if (lot.qty > 1e-9) trips.push({ ticker, quantity: Number(lot.qty.toFixed(6)), entry_price: lot.price, entry_date: lot.date, external_id: `${lot.id}:open:${lot.qty}` });
  return trips;
}

/** Imports positions (into Holdings) and the last year of buy/sell fills (into the journal). */
export async function syncBroker(userId) {
  const s = api();
  const conn = await getConnection(userId);
  if (!conn) throw Object.assign(new Error("Connect a broker first"), { status: 400 });
  const auth = { userId: conn.snaptrade_user_id, userSecret: decrypt(conn.user_secret_enc) };
  const { data: accounts } = await s.accountInformation.listUserAccounts(auth);

  const positions = new Map();
  const fills = [];
  const start = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  for (const acct of accounts ?? []) {
    const { data: holdings } = await s.accountInformation.getUserHoldings({ ...auth, accountId: acct.id });
    for (const p of holdings?.positions ?? []) {
      const ticker = p.symbol?.symbol?.symbol?.toUpperCase();
      const units = Number(p.units ?? 0);
      if (!ticker || !(units > 0) || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) continue;
      const prev = positions.get(ticker);
      const cost = Number(p.average_purchase_price) || null;
      positions.set(ticker, prev ? { ticker, shares: prev.shares + units, cost_basis: prev.cost_basis && cost ? (prev.cost_basis * prev.shares + cost * units) / (prev.shares + units) : prev.cost_basis ?? cost } : { ticker, shares: units, cost_basis: cost });
    }
    for (let offset = 0; offset < 5000; offset += 1000) {
      const { data: page } = await s.accountInformation.getAccountActivities({ ...auth, accountId: acct.id, startDate: start, type: "BUY,SELL", offset, limit: 1000 });
      const rows = page?.data ?? [];
      for (const a of rows) {
        const ticker = a.symbol?.symbol?.toUpperCase?.();
        if (!ticker || a.option_symbol || !["BUY", "SELL"].includes(a.type)) continue;
        const qty = Math.abs(Number(a.units));
        const price = Number(a.price);
        if (!(qty > 0) || !(price > 0)) continue;
        fills.push({ id: a.id, ticker, side: a.type === "BUY" ? "buy" : "sell", qty, price, date: String(a.trade_date ?? a.settlement_date).slice(0, 10) });
      }
      if (rows.length < 1000) break;
    }
  }

  if (positions.size) await upsertHoldings(userId, [...positions.values()].map((p) => ({ ...p, cost_basis: p.cost_basis ? Number(p.cost_basis.toFixed(4)) : null })), { mode: "merge" });

  // Only add round trips we haven't imported before (external_id is stable per lot/fill pair)
  const seen = new Set((await listTrades(userId)).map((t) => t.external_id).filter(Boolean));
  let imported = 0;
  for (const trip of fifoRoundTrips(fills)) {
    if (seen.has(trip.external_id)) continue;
    await addTrade(userId, { ...trip, side: "long", setup: "broker import" }).catch(() => {});
    imported++;
  }
  const summary = { accounts: accounts?.length ?? 0, positions: positions.size, fills: fills.length, trades_imported: imported };
  await saveConnection(userId, { last_sync_at: new Date().toISOString(), last_sync: summary });
  track(userId, "broker_synced", summary);
  return summary;
}

export async function disconnectBroker(userId) {
  const conn = await getConnection(userId);
  if (!conn) return { connected: false };
  if (brokerEnabled()) await api().authentication.deleteSnapTradeUser({ userId: conn.snaptrade_user_id }).catch((e) => console.error("SnapTrade delete:", e.message));
  await db.removeAllForUser("broker_connections", userId);
  return { connected: false };
}

// ---------- Live trading through the user's own broker ----------
// Two steps, always: preview (SnapTrade checks the order with the broker and returns a trade id),
// then the user confirms in the app and we place exactly that previewed trade. Nothing is placed
// without an explicit confirm, and the Copilot can never call these.

const ORDER_TYPES = { market: "Market", limit: "Limit", stop: "Stop" };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function tradingAuth(userId) {
  if (!brokerTradingEnabled()) throw bad("Live trading isn't switched on for this server.", 503);
  const conn = await getConnection(userId);
  if (!conn) throw bad("Connect a broker first");
  return { userId: conn.snaptrade_user_id, userSecret: decrypt(conn.user_secret_enc) };
}

/** Linked brokerage accounts with cash and buying power. */
export async function liveAccounts(userId) {
  const auth = await tradingAuth(userId);
  const s = api();
  const { data: accounts } = await s.accountInformation.listUserAccounts(auth);
  return Promise.all((accounts ?? []).map(async (a) => {
    const { data: balances } = await s.accountInformation.getUserAccountBalance({ ...auth, accountId: a.id }).catch(() => ({ data: [] }));
    const usd = (balances ?? []).find((b) => b.currency?.code === "USD") ?? balances?.[0];
    return { id: a.id, name: a.name ?? a.institution_name, institution: a.institution_name, number: a.number ? `••${String(a.number).slice(-4)}` : null, cash: usd?.cash ?? null, buying_power: usd?.buying_power ?? null, total: a.balance?.total?.amount ?? null };
  }));
}

/** Asks the broker what an order would do. Returns a preview the user must confirm. */
export async function previewLiveOrder(userId, input) {
  const auth = await tradingAuth(userId);
  const s = api();
  const ticker = String(input.ticker ?? "").trim().toUpperCase();
  const qty = Number(input.qty);
  const type = ORDER_TYPES[input.type] ? input.type : "market";
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) throw bad("Enter a valid ticker");
  if (!(qty > 0)) throw bad("Enter a quantity greater than 0");
  if (!input.account_id) throw bad("Pick an account");
  if (type === "limit" && !(Number(input.limit_price) > 0)) throw bad("Enter a limit price");
  if (type === "stop" && !(Number(input.stop_price) > 0)) throw bad("Enter a stop price");

  const { data: symbols } = await s.referenceData.symbolSearchUserAccount({ ...auth, accountId: input.account_id, substring: ticker });
  const symbol = (symbols ?? []).find((x) => String(x.symbol).toUpperCase() === ticker);
  if (!symbol) throw bad(`${ticker} can't be traded in this account`);
  const { data } = await s.trading.getOrderImpact({
    ...auth,
    account_id: input.account_id,
    action: input.side === "sell" ? "SELL" : "BUY",
    universal_symbol_id: symbol.id,
    order_type: ORDER_TYPES[type],
    time_in_force: input.time_in_force === "gtc" ? "GTC" : "Day",
    units: qty,
    price: type === "limit" ? Number(input.limit_price) : null,
    stop: type === "stop" ? Number(input.stop_price) : null,
  });
  const impact = data?.trade_impacts?.[0];
  const row = await db.insert("live_orders", {
    user_id: userId, account_id: input.account_id, ticker, side: input.side === "sell" ? "sell" : "buy", type, qty,
    limit_price: type === "limit" ? Number(input.limit_price) : null, stop_price: type === "stop" ? Number(input.stop_price) : null,
    trade_id: data?.trade?.id, status: "previewed",
    preview: { price: data?.trade?.price ?? null, estimated_commission: impact?.estimated_commission ?? null, remaining_cash: impact?.remaining_cash ?? data?.combined_remaining_balance?.cash ?? null, description: symbol.description ?? null },
  });
  track(userId, "live_order_previewed", { side: row.side, type });
  return row;
}

/** Places a previewed order. Requires confirm: true from the app. */
export async function placeLiveOrder(userId, id, { confirm } = {}) {
  if (confirm !== true) throw bad("Confirm the order to place it");
  const auth = await tradingAuth(userId);
  const order = await db.get("live_orders", id, userId);
  if (!order) throw bad("Order not found", 404);
  if (order.status !== "previewed") throw bad(`This order was already ${order.status}`, 409);
  if (Date.now() - Date.parse(order.created_at) > 4 * 60_000) {
    await db.update("live_orders", id, userId, { status: "expired" });
    throw bad("This preview expired. Preview the order again for a fresh quote.", 409);
  }
  try {
    const { data } = await api().trading.placeOrder({ ...auth, tradeId: order.trade_id, wait_to_confirm: true });
    track(userId, "live_order_placed", { side: order.side, type: order.type });
    return db.update("live_orders", id, userId, { status: "placed", placed_at: new Date().toISOString(), result: { brokerage_order_id: data?.brokerage_order_id ?? null, status: data?.status ?? null, filled_quantity: data?.filled_quantity ?? null, execution_price: data?.execution_price ?? null } });
  } catch (err) {
    const message = err?.responseBody?.detail ?? err?.message ?? "The broker rejected the order";
    await db.update("live_orders", id, userId, { status: "failed", result: { error: String(message).slice(0, 500) } });
    throw bad(String(message));
  }
}

export const listLiveOrders = (userId) => db.list("live_orders", { user_id: userId }, { order: "created_at", ascending: false, limit: 50 });
