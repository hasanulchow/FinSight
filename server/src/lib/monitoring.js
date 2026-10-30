import * as Sentry from "@sentry/node";

// Error monitoring with Sentry (SENTRY_DSN). Without a DSN everything here is a no-op.
// Only 5xx errors are reported; user mistakes (4xx) are not.

const DSN = process.env.SENTRY_DSN || null;
let started = false;

export function initMonitoring() {
  if (!DSN || started) return;
  Sentry.init({
    dsn: DSN,
    environment: process.env.RENDER ? "render" : process.env.VERCEL ? "vercel" : process.env.NODE_ENV || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    sendDefaultPii: false,
    // Never send request bodies, cookies or auth headers (they can hold tokens or financial data)
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) delete event.request.headers.authorization;
      }
      return event;
    },
  });
  started = true;
  process.on("unhandledRejection", (reason) => reportError(reason, { where: "unhandledRejection" }));
}

/** Reports a server error with context (route, user id). Safe to call when monitoring is off. */
export function reportError(err, context = {}) {
  if (!started) return;
  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    for (const [k, v] of Object.entries(context)) if (k !== "userId") scope.setTag(k, String(v).slice(0, 200));
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

export const monitoringEnabled = () => started;
