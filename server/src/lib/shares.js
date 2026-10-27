import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { db } from "./db.js";
import { listTrades, journalStats } from "./journal.js";
import { getSettings } from "./account.js";
import { track } from "./analytics.js";

// Public share links: a frozen snapshot of a briefing summary or the user's journal stats card.
// Snapshots never include dollar amounts from the journal or anything that identifies the user.

const newToken = () => randomBytes(9).toString("base64url"); // 12 chars

async function getBriefingRow(id, userId) {
  if (config.localMode) return localStore.getBriefingRow(id, userId);
  const { data } = await supabase().from("briefings").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

export async function shareBriefing(user, briefingId) {
  const b = await getBriefingRow(briefingId, user.id);
  if (!b) throw Object.assign(new Error("Briefing not found"), { status: 404 });
  if (b.status !== "complete" || !b.content) throw Object.assign(new Error("Wait for the briefing to finish"), { status: 409 });
  const c = b.content;
  const payload = {
    ticker: b.ticker,
    company: b.company_name ?? c.company?.name ?? null,
    created_at: b.created_at,
    summary: c.executive_summary ?? null,
    takeaways: (c.key_takeaways ?? []).slice(0, 5),
    risks: (c.risks?.top_risks ?? []).slice(0, 3).map((r) => r.title).filter(Boolean),
  };
  return createShare(user, "briefing", briefingId, payload);
}

export async function shareJournal(user) {
  const trades = await listTrades(user.id);
  const s = journalStats(trades);
  if (!s.totals.closed) throw Object.assign(new Error("Close a few trades first"), { status: 400 });
  const payload = {
    closed: s.totals.closed,
    win_rate: s.totals.win_rate,
    profit_factor: s.totals.profit_factor,
    avg_r: s.totals.avg_r,
    trades_with_stop_pct: s.totals.trades_with_stop_pct,
    best_setup: s.by_setup.slice().sort((a, b) => b.win_rate - a.win_rate)[0]?.key ?? null,
    calm_win_rate: s.by_emotion.find((e) => e.key === "calm")?.win_rate ?? null,
    // Equity curve as % of peak-to-trough range only (no dollars)
    curve: normalize(s.equity_curve.map((p) => p.equity)),
  };
  return createShare(user, "journal", null, payload);
}

function normalize(values) {
  if (values.length < 2) return [];
  const min = Math.min(0, ...values), max = Math.max(...values);
  const step = Math.max(1, Math.floor(values.length / 60));
  return values.filter((_, i) => i % step === 0 || i === values.length - 1).map((v) => (max === min ? 50 : Math.round(((v - min) / (max - min)) * 100)));
}

async function createShare(user, kind, refId, payload) {
  const settings = await getSettings(user);
  const row = await db.insert("shares", { token: newToken(), user_id: user.id, kind, ref_id: refId, payload: { ...payload, ref: settings.referral_code } });
  track(user.id, "share_created", { kind });
  return { token: row.token, url: `${config.appUrl.replace(/\/$/, "")}/?share=${row.token}` };
}

/** Public: a share snapshot by token (no auth). */
export async function getShare(token) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(token)) return null;
  const row = config.localMode
    ? localStore.rows("shares").find((s) => s.token === token)
    : (await supabase().from("shares").select("kind, payload, created_at").eq("token", token).maybeSingle()).data;
  return row ? { kind: row.kind, payload: row.payload, created_at: row.created_at } : null;
}
