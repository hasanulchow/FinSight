import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// SaaS plans and usage limits. Every AI-backed feature calls checkQuota() before running and
// recordUsage() after, so costs stay bounded per user. Limits are per UTC day unless noted.

const num = (name, fallback) => Number(process.env[name] ?? fallback);

export const PLANS = {
  free: {
    name: "Free",
    price_label: "$0",
    limits: {
      briefing: num("FREE_BRIEFINGS_PER_DAY", 3),
      copilot: num("FREE_COPILOT_PER_DAY", 15),
      ai_tool: num("FREE_AI_TOOLS_PER_DAY", 10), // screener, chart/options explanations, X-ray, journal coach
      question: num("FREE_QUESTIONS_PER_DAY", 10), // Ask the 10-K
    },
    caps: { alerts: 5, holdings: 25, trades: 200 },
  },
  pro: {
    name: "Pro",
    price_label: process.env.PRO_PRICE_LABEL ?? "$19/mo", // display only; Stripe's price is what's charged
    limits: {
      briefing: num("PRO_BRIEFINGS_PER_DAY", 40),
      copilot: num("PRO_COPILOT_PER_DAY", 300),
      ai_tool: num("PRO_AI_TOOLS_PER_DAY", 200),
      question: num("PRO_QUESTIONS_PER_DAY", 200),
    },
    caps: { alerts: 100, holdings: 500, trades: 20000 },
  },
};

const ACTIVE = new Set(["active", "trialing"]);

/** The user's plan key. Local mode uses DEV_PLAN (default pro) so everything can be tested. */
export async function getPlan(userId) {
  if (config.localMode) return process.env.DEV_PLAN === "free" ? "free" : "pro";
  const { data } = await supabase().from("subscriptions").select("plan, status, current_period_end").eq("user_id", userId).maybeSingle();
  if (data && data.plan === "pro" && ACTIVE.has(data.status) && (!data.current_period_end || Date.parse(data.current_period_end) > Date.now() - 86_400_000)) return "pro";
  return "free";
}

const startOfDay = () => `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;

async function usedToday(userId, feature) {
  if (config.localMode) return localStore.rows("usage_events").filter((e) => e.user_id === userId && e.feature === feature && e.created_at >= startOfDay()).length;
  const { count } = await supabase().from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("feature", feature).gte("created_at", startOfDay());
  return count ?? 0;
}

/** Throws a 402 with an upgrade hint when today's limit for `feature` is used up. */
export async function checkQuota(userId, feature) {
  const plan = await getPlan(userId);
  const limit = PLANS[plan].limits[feature];
  const used = await usedToday(userId, feature);
  if (used >= limit) {
    const label = { briefing: "briefings", copilot: "Copilot messages", ai_tool: "AI analyses", question: "filing questions" }[feature];
    throw Object.assign(new Error(plan === "free" ? `You've used today's ${limit} free ${label}. Upgrade to Pro for more, or come back tomorrow.` : `You've reached today's limit of ${limit} ${label}. It resets at midnight UTC.`), { status: 402, upgrade: plan === "free" });
  }
  return { plan, limit, used };
}

export async function recordUsage(userId, feature, meta = null) {
  const row = { user_id: userId, feature, meta };
  if (config.localMode) return localStore.insert("usage_events", row);
  const { error } = await supabase().from("usage_events").insert(row);
  if (error) console.error("usage_events insert failed:", error.message);
}

/** Checks a count cap (alerts, holdings, trades) for the user's plan. */
export async function checkCap(userId, cap, currentCount) {
  const plan = await getPlan(userId);
  const max = PLANS[plan].caps[cap];
  if (currentCount >= max) throw Object.assign(new Error(`Your ${PLANS[plan].name} plan allows ${max} ${cap}.${plan === "free" ? " Upgrade to Pro for more." : ""}`), { status: 402, upgrade: plan === "free" });
}

/** Plan + today's usage, for the account screen. */
export async function planSummary(userId) {
  const plan = await getPlan(userId);
  const usage = {};
  for (const feature of Object.keys(PLANS[plan].limits)) usage[feature] = { used: await usedToday(userId, feature), limit: PLANS[plan].limits[feature] };
  let subscription = null;
  if (!config.localMode) {
    const { data } = await supabase().from("subscriptions").select("plan, status, current_period_end, cancel_at_period_end").eq("user_id", userId).maybeSingle();
    subscription = data;
  }
  return { plan, plan_name: PLANS[plan].name, usage, caps: PLANS[plan].caps, subscription, billing_enabled: Boolean(config.stripeKey && config.stripePricePro) };
}
