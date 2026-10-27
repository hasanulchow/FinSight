// Product analytics. Sends events to PostHog when POSTHOG_KEY is set; otherwise a no-op.
// Server-side capture means no tracking script in the app and no third-party cookies.

const KEY = process.env.POSTHOG_KEY || null;
const HOST = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");

// Events the app itself may send through POST /events (everything else is captured server-side)
export const CLIENT_EVENTS = new Set(["screen_view", "upgrade_viewed", "upgrade_clicked", "share_opened", "landing_cta", "onboarding_step"]);

export const analyticsEnabled = () => Boolean(KEY);

/** Fire-and-forget event. Never throws and never blocks the request. */
export function track(userId, event, properties = {}) {
  if (!KEY || !userId) return;
  fetch(`${HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: KEY, event, distinct_id: userId, properties: { ...properties, $lib: "finsight-server" }, timestamp: new Date().toISOString() }),
  }).catch(() => {});
}
