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
  return { enabled: brokerEnabled(), connected: Boolean(conn), last_sync_at: conn?.last_sync_at ?? null, last_sync: conn?.last_sync ?? null };
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
    connectionType: "read",
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
