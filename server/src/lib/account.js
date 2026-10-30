import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { db } from "./db.js";
import { notify } from "./notify.js";
import { track } from "./analytics.js";

// Account lifecycle: settings row per user, onboarding (terms + profile + watchlist),
// referral rewards, and full account deletion.

export const TERMS_VERSION = "2026-10-27";
const REFERRAL_DAYS = Number(process.env.REFERRAL_PRO_DAYS || 14);
const MAX_REFERRAL_REWARDS = Number(process.env.MAX_REFERRAL_REWARDS || 10);
const EXPERIENCE = ["new", "investor", "active_trader", "options_trader"];
const GOALS = ["long_term", "swing", "day_trading", "options", "income", "learn"];

const newCode = () => randomBytes(4).toString("hex").toUpperCase(); // 8 chars, ~4 billion codes

async function readSettings(userId) {
  if (config.localMode) return localStore.rows("user_settings").find((s) => s.user_id === userId) ?? null;
  const { data, error } = await supabase().from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function writeSettings(userId, fields) {
  const row = { user_id: userId, ...fields, updated_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("user_settings", "user_id", row);
  const { data, error } = await supabase().from("user_settings").upsert(row, { onConflict: "user_id" }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

/** The user's settings, created on first use (with a referral code). */
export async function getSettings(user) {
  const existing = await readSettings(user.id);
  if (existing) return existing;
  return writeSettings(user.id, { email: user.email ?? null, referral_code: newCode(), brief_enabled: true, rules: {} });
}

const ALLOWED = new Set(["brief_enabled", "weekly_email", "timezone", "experience", "goals"]);
export async function updateSettings(user, fields) {
  await getSettings(user);
  const clean = Object.fromEntries(Object.entries(fields ?? {}).filter(([k]) => ALLOWED.has(k)));
  if ("experience" in clean && !EXPERIENCE.includes(clean.experience)) delete clean.experience;
  if ("goals" in clean) clean.goals = (Array.isArray(clean.goals) ? clean.goals : []).filter((g) => GOALS.includes(g));
  if ("brief_enabled" in clean) clean.brief_enabled = Boolean(clean.brief_enabled);
  if ("weekly_email" in clean) clean.weekly_email = Boolean(clean.weekly_email);
  return writeSettings(user.id, clean);
}

export async function saveRules(user, rules) {
  await getSettings(user);
  return writeSettings(user.id, { rules });
}

/**
 * Finishes onboarding: records acceptance of the Terms/Disclaimer (required), the user's profile,
 * a starter watchlist, and an optional referral code.
 */
export async function completeOnboarding(user, { accept_terms, experience, goals, watchlist = [], ref } = {}) {
  if (accept_terms !== true) throw Object.assign(new Error("Please accept the Terms of Service and risk disclaimer to continue."), { status: 400 });
  const settings = await getSettings(user);
  const now = new Date().toISOString();
  const fields = {
    accepted_terms_at: now,
    terms_version: TERMS_VERSION,
    experience: EXPERIENCE.includes(experience) ? experience : null,
    goals: (Array.isArray(goals) ? goals : []).filter((g) => GOALS.includes(g)),
    onboarded_at: settings.onboarded_at ?? now,
  };

  // Referral: both sides get Pro days. Only once per user, never your own code.
  let referral = null;
  const code = String(ref ?? "").trim().toUpperCase();
  if (code && !settings.referred_by && code !== settings.referral_code) {
    const referrer = config.localMode
      ? localStore.rows("user_settings").find((s) => s.referral_code === code)
      : (await supabase().from("user_settings").select("*").eq("referral_code", code).maybeSingle()).data;
    if (referrer && referrer.user_id !== user.id) {
      fields.referred_by = referrer.user_id;
      fields.pro_until = addDays(settings.pro_until, REFERRAL_DAYS);
      const rewarded = await db.count("user_settings", { referred_by: referrer.user_id });
      if (rewarded < MAX_REFERRAL_REWARDS) {
        await writeSettings(referrer.user_id, { pro_until: addDays(referrer.pro_until, REFERRAL_DAYS) });
        await notify(referrer.user_id, { kind: "referral", title: "Someone joined with your link", body: `You both get ${REFERRAL_DAYS} days of FinSight Pro. Thanks for sharing!` }).catch(() => {});
      }
      referral = { days: REFERRAL_DAYS };
      track(referrer.user_id, "referral_converted", { referred: user.id });
    }
  }

  const saved = await writeSettings(user.id, fields);
  // Starter watchlist (up to 10 tickers); the thesis can be added later
  const { addWatch } = await import("./watchlist.js");
  for (const t of watchlist.slice(0, 10)) await addWatch(user.id, { ticker: t }).catch(() => {});
  track(user.id, "onboarded", { experience: fields.experience, goals: fields.goals, watchlist: watchlist.length, referred: Boolean(referral) });
  return { settings: saved, referral };
}

function addDays(fromIso, days) {
  const base = Math.max(Date.now(), fromIso ? Date.parse(fromIso) : 0);
  return new Date(base + days * 86_400_000).toISOString();
}

/** Pro access granted by referrals (in addition to a paid subscription). */
export async function referralProUntil(userId) {
  const s = await readSettings(userId);
  return s?.pro_until && Date.parse(s.pro_until) > Date.now() ? s.pro_until : null;
}

export async function referralStats(user) {
  const s = await getSettings(user);
  return {
    code: s.referral_code,
    link: `${config.appUrl.replace(/\/$/, "")}/?ref=${s.referral_code}`,
    signups: await db.count("user_settings", { referred_by: user.id }),
    days_per_signup: REFERRAL_DAYS,
    max_rewards: MAX_REFERRAL_REWARDS,
    pro_until: s.pro_until && Date.parse(s.pro_until) > Date.now() ? s.pro_until : null,
  };
}

// Every table that holds a user's rows (children before parents)
const USER_TABLES = [
  "copilot_actions", "copilot_messages", "copilot_conversations", "copilot_tasks",
  "paper_orders", "paper_positions", "paper_accounts", "live_orders", "cancel_feedback",
  "trades", "holdings", "alerts", "notifications", "push_tokens", "watchlist", "daily_briefs",
  "usage_events", "ai_usage", "shares", "broker_connections", "advisor_memories", "chat_messages",
  "guardrail_events", "feedback", "briefings", "subscriptions", "user_settings",
];

/**
 * Permanently deletes the account: cancels any Stripe subscription, removes the broker link,
 * deletes every row the user owns, then the auth user itself.
 */
export async function deleteAccount(user) {
  const { cancelSubscriptionNow } = await import("./billing.js");
  const { disconnectBroker } = await import("./broker.js");
  await cancelSubscriptionNow(user.id).catch((e) => console.error("Cancel subscription on delete:", e.message));
  await disconnectBroker(user.id).catch(() => {});
  track(user.id, "account_deleted");
  for (const table of USER_TABLES) {
    await db.removeAllForUser(table, user.id).catch((e) => console.error(`Delete ${table}:`, e.message));
  }
  if (!config.localMode) {
    const { error } = await supabase().auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Couldn't delete the login: ${error.message}`);
  }
  return { deleted: true };
}
