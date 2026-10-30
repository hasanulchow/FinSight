import Stripe from "stripe";
import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { TRIAL_DAYS } from "./plans.js";
import { track } from "./analytics.js";

// Stripe subscriptions: Checkout for upgrades, the Customer Portal for managing/cancelling,
// and a webhook that keeps the `subscriptions` table in sync. Plans are enforced in lib/plans.js.

let stripe;
const api = () => {
  if (!config.stripeKey || !config.stripePricePro) throw Object.assign(new Error("Billing isn't set up on this server yet."), { status: 503 });
  stripe ??= new Stripe(config.stripeKey);
  return stripe;
};

async function getSubscriptionRow(userId) {
  const { data } = await supabase().from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

/** Stripe Checkout URL for upgrading to Pro. Reuses the Stripe customer if the user had one. */
export async function createCheckout(user, { returnUrl, interval = "month" } = {}) {
  const s = api();
  const existing = await getSubscriptionRow(user.id);
  const base = returnUrl || config.appUrl;
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: interval === "year" && config.stripePriceProAnnual ? config.stripePriceProAnnual : config.stripePricePro, quantity: 1 }],
    success_url: `${base}?billing=success`,
    cancel_url: `${base}?billing=cancelled`,
    client_reference_id: user.id,
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: user.email }),
    // First subscription only: a free trial (card collected up front, cancel anytime before it ends)
    subscription_data: { metadata: { user_id: user.id }, ...(!existing?.stripe_subscription_id && TRIAL_DAYS > 0 && { trial_period_days: TRIAL_DAYS }) },
    metadata: { user_id: user.id },
    allow_promotion_codes: true,
  });
  track(user.id, "checkout_started", { interval, trial: !existing?.stripe_subscription_id && TRIAL_DAYS > 0 });
  return { url: session.url };
}

/** Cancels the subscription immediately (account deletion). No-op without billing or a subscription. */
export async function cancelSubscriptionNow(userId) {
  if (!config.stripeKey) return;
  const row = await getSubscriptionRow(userId);
  if (!row?.stripe_subscription_id || ["canceled", "incomplete_expired"].includes(row.status)) return;
  await api().subscriptions.cancel(row.stripe_subscription_id);
}

/** Stripe Customer Portal URL (change card, cancel, invoices). */
export async function createPortal(user, { returnUrl } = {}) {
  const s = api();
  const row = await getSubscriptionRow(user.id);
  if (!row?.stripe_customer_id) throw Object.assign(new Error("No billing account yet. Upgrade first."), { status: 400 });
  const session = await s.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: returnUrl || config.appUrl });
  return { url: session.url };
}

/** Writes a Stripe subscription's state to our table. */
async function syncSubscription(sub, userIdHint) {
  const userId = sub.metadata?.user_id || userIdHint;
  if (!userId) return console.error("Stripe subscription without user_id metadata:", sub.id);
  // Newer API versions put the billing period on the subscription items
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const row = {
    user_id: userId,
    plan: sub.items?.data?.some((i) => [config.stripePricePro, config.stripePriceProAnnual].includes(i.price?.id)) ? "pro" : "free",
    interval: sub.items?.data?.[0]?.price?.recurring?.interval ?? null,
    paused_until: sub.pause_collection?.resumes_at ? new Date(sub.pause_collection.resumes_at * 1000).toISOString() : null,
    status: sub.status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase().from("subscriptions").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
}

/** Verifies and handles a Stripe webhook. `rawBody` must be the exact request bytes. */
export async function handleWebhook(rawBody, signature) {
  const s = api();
  if (!config.stripeWebhookSecret) throw Object.assign(new Error("STRIPE_WEBHOOK_SECRET is not set"), { status: 503 });
  let event;
  try {
    event = s.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch (err) {
    throw Object.assign(new Error(`Webhook signature check failed: ${err.message}`), { status: 400 });
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.subscription) await syncSubscription(await s.subscriptions.retrieve(session.subscription), session.client_reference_id);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
    default:
      break; // other events are acknowledged and ignored
  }
  return { received: true, type: event.type };
}

// ---------- Cancel flow ----------
// Ask why, then offer a fitting alternative (pause, a discount, or the annual plan) before cancelling
// at the end of the period. Every answer is recorded so the reasons can be reviewed.

export const CANCEL_REASONS = {
  too_expensive: "It's too expensive",
  not_using: "I'm not using it enough",
  missing_feature: "It's missing something I need",
  ai_quality: "The AI answers weren't good enough",
  switching: "I'm switching to another app",
  break: "I'm taking a break from trading",
  other: "Something else",
};

async function activeSubscription(userId) {
  const row = await getSubscriptionRow(userId);
  if (!row?.stripe_subscription_id || ["canceled", "incomplete_expired"].includes(row.status)) throw Object.assign(new Error("No active subscription"), { status: 400 });
  return row;
}

/** The offer to show for a reason, if any. */
export function retentionOffer(reason) {
  if (["break", "not_using"].includes(reason)) return { kind: "pause", label: "Pause billing for a month instead", detail: "Keep your data and Pro features return when you're back. No charge while paused." };
  if (reason === "too_expensive" && config.stripeRetentionCoupon) return { kind: "discount", label: "Get a discount instead", detail: "Stay on Pro at a lower price for the next few months." };
  if (reason === "too_expensive" && config.stripePriceProAnnual) return { kind: "annual", label: "Switch to yearly and save", detail: "The yearly plan costs less per month." };
  return null;
}

/**
 * action: "pause" | "discount" | "cancel" | "resume".
 * Cancel takes effect at the end of the paid period; resume undoes a pending cancel or pause.
 */
export async function cancelFlow(user, { action, reason, feedback }) {
  const s = api();
  const row = await activeSubscription(user.id);
  await supabase().from("cancel_feedback").insert({ user_id: user.id, reason: CANCEL_REASONS[reason] ? reason : "other", feedback: feedback ? String(feedback).slice(0, 1000) : null, action }).then(({ error }) => error && console.error("cancel_feedback:", error.message));
  track(user.id, `cancel_flow_${action}`, { reason });
  let sub;
  if (action === "pause") sub = await s.subscriptions.update(row.stripe_subscription_id, { pause_collection: { behavior: "void", resumes_at: Math.floor(Date.now() / 1000) + 30 * 86_400 } });
  else if (action === "discount") {
    if (!config.stripeRetentionCoupon) throw Object.assign(new Error("No discount is available"), { status: 400 });
    sub = await s.subscriptions.update(row.stripe_subscription_id, { discounts: [{ coupon: config.stripeRetentionCoupon }] });
  } else if (action === "cancel") sub = await s.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true, cancellation_details: { comment: feedback ? String(feedback).slice(0, 500) : undefined } });
  else if (action === "resume") sub = await s.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: false, pause_collection: "" });
  else throw Object.assign(new Error("Unknown action"), { status: 400 });
  await syncSubscription(sub, user.id);
  return { status: sub.status, cancel_at_period_end: sub.cancel_at_period_end, paused: Boolean(sub.pause_collection) };
}
