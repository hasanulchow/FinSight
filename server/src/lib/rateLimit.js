// In-memory rate limiting (fixed one-minute windows per key). Protects the API from floods and scripted abuse;
// plan quotas (lib/plans.js) separately cap the expensive AI features per user per day.
// Note: limits are per server instance. On Vercel (many instances) treat it as best effort.

const buckets = new Map();
let lastSweep = Date.now();

/** Returns true if `key` may make another request in the current window. Pure enough to unit test. */
export function hit(key, limit, windowMs = 60_000, now = Date.now()) {
  if (now - lastSweep > windowMs) {
    for (const [k, b] of buckets) if (now - b.start > windowMs) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return { ok: true, remaining: limit - 1, reset: now + windowMs };
  }
  b.count++;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), reset: b.start + windowMs };
}

const clientIp = (req) => (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown");

/**
 * Express middleware. `limit` requests per minute per IP; stricter `writeLimit` for non-GET requests.
 * Health checks, the Stripe webhook, cron and static files are exempt.
 */
export function rateLimit({ limit = Number(process.env.RATE_LIMIT_PER_MIN || 240), writeLimit = Number(process.env.RATE_LIMIT_WRITES_PER_MIN || 60) } = {}) {
  const exempt = /^\/(health|billing\/webhook|jobs\/run)$/;
  return (req, res, next) => {
    if (exempt.test(req.path) || req.path.startsWith("/_expo") || req.path.startsWith("/assets")) return next();
    const ip = clientIp(req);
    const write = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    const r = write ? hit(`w:${ip}`, writeLimit) : hit(`r:${ip}`, limit);
    res.setHeader("RateLimit-Remaining", String(r.remaining));
    if (!r.ok) {
      res.setHeader("Retry-After", String(Math.ceil((r.reset - Date.now()) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please slow down and try again in a minute." });
    }
    next();
  };
}
