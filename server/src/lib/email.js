import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { db } from "./db.js";
import { listTrades, tradeResult } from "./journal.js";
import { benchmarkPortfolio } from "./risk.js";
import { upcomingForUser } from "./earnings.js";
import { getPaperAccount } from "./paper.js";
import { track } from "./analytics.js";

// Weekly email report (Sundays): portfolio vs SPY, the week's journal, earnings ahead, thesis changes
// and the paper account. Sent with Resend (RESEND_API_KEY); every email has a one-click unsubscribe.

const RESEND_KEY = process.env.RESEND_API_KEY || null;
const FROM = process.env.EMAIL_FROM || "FinSight <reports@finsight.app>";
export const emailEnabled = () => Boolean(RESEND_KEY);

const secret = () => process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || "finsight-local";
export const unsubscribeToken = (userId) => createHmac("sha256", secret()).update(`unsub:${userId}`).digest("base64url").slice(0, 24);
export function verifyUnsubscribe(userId, token) {
  const a = Buffer.from(unsubscribeToken(userId)), b = Buffer.from(String(token ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const money = (v) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
const color = (v) => (v > 0 ? "#059669" : v < 0 ? "#DC2626" : "#4A5368");

/** The report's data for one user over the last 7 days. */
export async function weeklyReportData(userId) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [bench, trades, earnings, watch, paper] = await Promise.all([
    benchmarkPortfolio(userId, { days: 5 }).catch(() => null),
    listTrades(userId).catch(() => []),
    upcomingForUser(userId, 7).catch(() => []),
    db.list("watchlist", { user_id: userId }, { limit: 200 }).catch(() => []),
    getPaperAccount(userId).catch(() => null),
  ]);
  const closed = trades.map((t) => ({ ...t, result: tradeResult(t) })).filter((t) => t.result && t.exit_date >= since);
  const wins = closed.filter((t) => t.result.pnl > 0).length;
  return {
    week_ending: new Date().toISOString().slice(0, 10),
    portfolio: bench && !bench.empty ? { return_pct: bench.portfolio.total_return_pct, spy_pct: bench.benchmark_stats.total_return_pct, excess_pct: bench.excess_return_pct } : null,
    journal: { closed: closed.length, pnl: closed.reduce((s, t) => s + t.result.pnl, 0), win_rate: closed.length ? Math.round((wins / closed.length) * 100) : null, best: closed.sort((a, b) => b.result.pnl - a.result.pnl)[0] ?? null },
    earnings,
    theses: watch.filter((w) => w.thesis && w.last_check?.checked_at >= since).map((w) => ({ ticker: w.ticker, status: w.status, summary: w.last_check.summary })),
    paper: paper && paper.equity !== paper.starting_cash ? { equity: paper.equity, total_pnl: paper.total_pnl, total_pnl_pct: paper.total_pnl_pct, positions: paper.positions.length } : null,
  };
}

/** Renders the report as an email-safe HTML table layout. */
export function renderWeeklyEmail(d, { userId } = {}) {
  const base = config.appUrl.replace(/\/$/, "");
  const unsub = userId ? `${base}/email/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}` : "#";
  const section = (title, inner) => `<tr><td style="padding:18px 24px 0"><div style="font:700 12px/1.4 -apple-system,Segoe UI,Arial;color:#7D869B;text-transform:uppercase;letter-spacing:.5px">${title}</div><div style="font:15px/1.55 -apple-system,Segoe UI,Arial;color:#0A0F1E;margin-top:6px">${inner}</div></td></tr>`;
  const rows = [];
  if (d.portfolio) rows.push(section("Your portfolio this week", `You <b style="color:${color(d.portfolio.return_pct)}">${pct(d.portfolio.return_pct)}</b> vs S&amp;P 500 <b>${pct(d.portfolio.spy_pct)}</b> (${d.portfolio.excess_pct >= 0 ? "ahead" : "behind"} by ${Math.abs(d.portfolio.excess_pct).toFixed(2)} pts).`));
  if (d.journal.closed) rows.push(section("Your trading", `${d.journal.closed} closed trade${d.journal.closed > 1 ? "s" : ""}, <b style="color:${color(d.journal.pnl)}">${money(d.journal.pnl)}</b>, ${d.journal.win_rate}% winners.${d.journal.best ? ` Best: ${esc(d.journal.best.ticker)} ${money(d.journal.best.result.pnl)}.` : ""}`));
  if (d.paper) rows.push(section("Paper account", `${money(d.paper.equity)} (<span style="color:${color(d.paper.total_pnl)}">${money(d.paper.total_pnl)}, ${pct(d.paper.total_pnl_pct)}</span> since start), ${d.paper.positions} position${d.paper.positions === 1 ? "" : "s"}.`));
  if (d.earnings.length) rows.push(section("Earnings this week", d.earnings.map((e) => `<div>• <b>${esc(e.ticker)}</b> ${esc(new Date(`${e.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))} ${e.hour === "amc" ? "after close" : e.hour === "bmo" ? "before open" : ""}${e.owned ? " (you own it)" : ""}</div>`).join("")));
  if (d.theses.length) rows.push(section("Thesis checks", d.theses.map((t) => `<div style="margin-bottom:6px">• <b>${esc(t.ticker)}</b>: ${esc(t.status)}. ${esc(t.summary)}</div>`).join("")));
  if (!rows.length) rows.push(section("A quiet week", "Add holdings, a watchlist or a few journal trades and next week's report will show how you did."));
  return `<!doctype html><html><body style="margin:0;background:#F5F6FA"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E4E7EF;border-radius:18px">
<tr><td style="padding:22px 24px 0;font:800 20px -apple-system,Segoe UI,Arial;color:#4F46E5">FinSight</td></tr>
<tr><td style="padding:4px 24px 0;font:700 22px/1.3 -apple-system,Segoe UI,Arial;color:#0A0F1E">Your week in review</td></tr>
${rows.join("\n")}
<tr><td style="padding:22px 24px"><a href="${base}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;font:700 15px -apple-system,Segoe UI,Arial;padding:12px 20px;border-radius:12px">Open FinSight</a></td></tr>
<tr><td style="padding:0 24px 22px;font:12px/1.5 -apple-system,Segoe UI,Arial;color:#7D869B">Educational information, not investment advice. <a href="${unsub}" style="color:#7D869B">Unsubscribe</a> from weekly reports.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmail({ to, subject, html, userId }) {
  if (!RESEND_KEY) throw Object.assign(new Error("Email isn't set up on this server (RESEND_API_KEY)."), { status: 503 });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [to], subject, html,
      headers: userId ? { "List-Unsubscribe": `<${config.appUrl.replace(/\/$/, "")}/email/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Email failed (${res.status})`);
  return body;
}

/** Job: Sundays from 14:00 UTC, one report per opted-in user per week. */
export async function sendWeeklyEmails({ force = false, limit = 500 } = {}) {
  if (!emailEnabled()) return { skipped: "RESEND_API_KEY not set" };
  const now = new Date();
  if (!force && (now.getUTCDay() !== 0 || now.getUTCHours() < 14)) return { skipped: "not Sunday afternoon" };
  const week = now.toISOString().slice(0, 10);
  const users = (await db.all("user_settings", { columns: "user_id, email, weekly_email, last_weekly_email" })).filter((s) => s.email && s.weekly_email !== false && s.last_weekly_email !== week).slice(0, limit);
  let sent = 0;
  for (const u of users) {
    try {
      const data = await weeklyReportData(u.user_id);
      await sendEmail({ to: u.email, subject: data.portfolio ? `Your week: ${pct(data.portfolio.return_pct)} vs S&P 500 ${pct(data.portfolio.spy_pct)}` : "Your FinSight week in review", html: renderWeeklyEmail(data, { userId: u.user_id }), userId: u.user_id });
      if (config.localMode) await db.all("user_settings").then((rows) => rows.filter((r) => r.user_id === u.user_id).forEach((r) => (r.last_weekly_email = week)));
      else await supabase().from("user_settings").update({ last_weekly_email: week }).eq("user_id", u.user_id);
      track(u.user_id, "weekly_email_sent");
      sent++;
    } catch (err) {
      console.error(`Weekly email ${u.user_id}:`, err.message);
    }
  }
  return { users: users.length, sent };
}

export async function unsubscribe(userId) {
  if (config.localMode) return (await db.all("user_settings")).filter((r) => r.user_id === userId).forEach((r) => (r.weekly_email = false));
  const { error } = await supabase().from("user_settings").update({ weekly_email: false }).eq("user_id", userId);
  if (error) throw new Error(error.message);
}
