import { config, LOCAL_USER } from "../config.js";
import { db } from "./db.js";

// Founder dashboard: signups, plans, revenue, usage and AI cost per user.
// Access: emails listed in ADMIN_EMAILS (comma-separated). In local mode the local user is an admin.

const ADMINS = new Set((process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
const PRO_PRICE = Number(process.env.PRO_PRICE_MONTHLY || 19);

export const isAdmin = (user) => (config.localMode && user?.id === LOCAL_USER.id) || ADMINS.has(String(user?.email ?? "").toLowerCase());

export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: "Admins only" });
  next();
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const round = (x, d = 2) => Number((x ?? 0).toFixed(d));

export async function adminMetrics() {
  const [settings, subs, usage30, ai30] = await Promise.all([
    db.all("user_settings", { columns: "user_id, email, created_at, onboarded_at, referred_by, pro_until, experience" }),
    db.all("subscriptions", { columns: "user_id, plan, status, created_at:updated_at, cancel_at_period_end" }).catch(() => []),
    db.all("usage_events", { since: daysAgo(30), columns: "user_id, feature, created_at" }),
    db.all("ai_usage", { since: daysAgo(30), columns: "user_id, agent, cost_usd, input_tokens, output_tokens, created_at" }),
  ]);
  const now = Date.now();
  const paying = subs.filter((s) => s.plan === "pro" && ["active", "trialing"].includes(s.status));
  const trialing = paying.filter((s) => s.status === "trialing").length;
  const referralPro = settings.filter((s) => s.pro_until && Date.parse(s.pro_until) > now).length;
  const active7 = new Set(usage30.filter((u) => u.created_at >= daysAgo(7)).map((u) => u.user_id));
  const active30 = new Set(usage30.map((u) => u.user_id));

  const usageByFeature = {};
  for (const u of usage30.filter((x) => x.created_at >= daysAgo(7))) usageByFeature[u.feature] = (usageByFeature[u.feature] ?? 0) + 1;

  const costByUser = new Map(), costByAgent = {};
  let aiCost = 0;
  for (const a of ai30) {
    const c = Number(a.cost_usd) || 0;
    aiCost += c;
    costByUser.set(a.user_id, (costByUser.get(a.user_id) ?? 0) + c);
    costByAgent[a.agent] = (costByAgent[a.agent] ?? 0) + c;
  }
  const emailOf = new Map(settings.map((s) => [s.user_id, s.email]));
  const payingSet = new Set(paying.map((s) => s.user_id));
  const signupsByDay = {};
  for (const s of settings.filter((x) => x.created_at >= daysAgo(30))) signupsByDay[s.created_at.slice(0, 10)] = (signupsByDay[s.created_at.slice(0, 10)] ?? 0) + 1;

  const mrr = (paying.length - trialing) * PRO_PRICE;
  return {
    generated_at: new Date().toISOString(),
    users: {
      total: settings.length,
      new_7d: settings.filter((s) => s.created_at >= daysAgo(7)).length,
      new_30d: settings.filter((s) => s.created_at >= daysAgo(30)).length,
      onboarded: settings.filter((s) => s.onboarded_at).length,
      referred: settings.filter((s) => s.referred_by).length,
      active_7d: active7.size,
      active_30d: active30.size,
    },
    revenue: {
      pro_paying: paying.length - trialing,
      pro_trialing: trialing,
      pro_via_referral: referralPro,
      cancelling: paying.filter((s) => s.cancel_at_period_end).length,
      mrr_usd: mrr,
      price_usd: PRO_PRICE,
      conversion_pct: settings.length ? round(((paying.length - trialing) / settings.length) * 100, 1) : 0,
    },
    ai_cost_30d: {
      total_usd: round(aiCost),
      per_active_user_usd: active30.size ? round(aiCost / active30.size, 3) : 0,
      gross_margin_pct: mrr ? round(((mrr - aiCost) / mrr) * 100, 1) : null,
      by_agent: Object.entries(costByAgent).map(([agent, usd]) => ({ agent, usd: round(usd, 3) })).sort((a, b) => b.usd - a.usd),
      top_users: [...costByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, usd]) => ({ email: emailOf.get(id) ?? id.slice(0, 8), usd: round(usd, 3), pro: payingSet.has(id) })),
    },
    usage_7d: usageByFeature,
    signups_by_day: Object.entries(signupsByDay).sort().map(([date, count]) => ({ date, count })),
  };
}
