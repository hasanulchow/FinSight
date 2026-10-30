import { requireUser } from "../lib/auth.js";
import { checkQuota, recordUsage } from "../lib/plans.js";
import { getPaperAccount, previewPaperOrder, placePaperOrder, cancelPaperOrder, resetPaperAccount } from "../lib/paper.js";
import { liveAccounts, previewLiveOrder, placeLiveOrder, listLiveOrders } from "../lib/broker.js";
import { earningsPreview, earningsRecap, upcomingForUser } from "../lib/earnings.js";
import { weeklyReportData, renderWeeklyEmail, sendEmail, emailEnabled, verifyUnsubscribe, unsubscribe } from "../lib/email.js";
import { getSettings } from "../lib/account.js";
import { precheckTrade } from "../lib/rules.js";
import { reportError } from "../lib/monitoring.js";

// Routes for paper trading, live trading through the user's broker, the earnings companion and email reports.

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if ((err.status ?? 500) >= 500) {
      console.error(`${req.method} ${req.path}:`, err.message);
      reportError(err, { route: req.path, userId: req.user?.id });
    }
    if (!res.headersSent) res.status(err.status ?? 500).json({ error: err.message, ...(err.upgrade != null && { upgrade: err.upgrade }) });
  }
};

/** The user's trading rules applied to an order (journal fields), or null when they have no rules. */
async function rulesCheck(user, order, price) {
  const rules = (await getSettings(user)).rules ?? {};
  if (!Object.keys(rules).length || order.side === "sell") return null;
  return precheckTrade(user.id, rules, { ticker: order.ticker, side: "long", instrument: "stock", quantity: order.qty, entry_price: price, stop_price: order.stop_loss, target_price: order.take_profit, emotion: order.emotion });
}

export function registerTradeRoutes(app) {
  // ---------- Paper trading ----------
  app.get("/paper", requireUser, handle(async (req, res) => res.json(await getPaperAccount(req.user.id))));
  app.post("/paper/orders/preview", requireUser, handle(async (req, res) => {
    const preview = await previewPaperOrder(req.user.id, req.body ?? {});
    res.json({ ...preview, rules: await rulesCheck(req.user, { ...preview.order, ...req.body }, preview.est_price).catch(() => null) });
  }));
  app.post("/paper/orders", requireUser, handle(async (req, res) => res.status(201).json(await placePaperOrder(req.user.id, req.body ?? {}))));
  app.delete("/paper/orders/:id", requireUser, handle(async (req, res) => res.json(await cancelPaperOrder(req.user.id, req.params.id))));
  app.post("/paper/reset", requireUser, handle(async (req, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirm the reset" });
    await resetPaperAccount(req.user.id);
    res.json(await getPaperAccount(req.user.id));
  }));

  // ---------- Live trading (user's own broker via SnapTrade) ----------
  app.get("/live/accounts", requireUser, handle(async (req, res) => res.json(await liveAccounts(req.user.id))));
  app.get("/live/orders", requireUser, handle(async (req, res) => res.json(await listLiveOrders(req.user.id))));
  app.post("/live/orders/preview", requireUser, handle(async (req, res) => {
    const preview = await previewLiveOrder(req.user.id, req.body ?? {});
    res.json({ ...preview, rules: await rulesCheck(req.user, { ...req.body, ticker: preview.ticker, qty: preview.qty }, preview.preview?.price ?? Number(req.body?.limit_price) ?? 0).catch(() => null) });
  }));
  app.post("/live/orders/:id/place", requireUser, handle(async (req, res) => res.json(await placeLiveOrder(req.user.id, req.params.id, { confirm: req.body?.confirm }))));

  // ---------- Earnings companion ----------
  app.get("/earnings/upcoming", requireUser, handle(async (req, res) => res.json(await upcomingForUser(req.user.id, Math.min(30, Number(req.query.days) || 14)))));
  app.get("/stocks/:ticker/earnings-preview", requireUser, handle(async (req, res) => {
    const t = String(req.params.ticker).toUpperCase();
    if (!TICKER_RE.test(t)) return res.status(400).json({ error: "Invalid ticker" });
    await checkQuota(req.user.id, "ai_tool");
    const preview = await earningsPreview(t);
    await recordUsage(req.user.id, "ai_tool", { tool: "earnings_preview" });
    res.json(preview);
  }));
  app.get("/stocks/:ticker/earnings-recap", requireUser, handle(async (req, res) => {
    const t = String(req.params.ticker).toUpperCase();
    if (!TICKER_RE.test(t)) return res.status(400).json({ error: "Invalid ticker" });
    await checkQuota(req.user.id, "ai_tool");
    const recap = await earningsRecap(t);
    await recordUsage(req.user.id, "ai_tool", { tool: "earnings_recap" });
    res.json(recap);
  }));

  // ---------- Weekly email ----------
  app.get("/email/preview", requireUser, handle(async (req, res) => {
    res.type("html").send(renderWeeklyEmail(await weeklyReportData(req.user.id), { userId: req.user.id }));
  }));
  app.post("/email/test", requireUser, handle(async (req, res) => {
    if (!emailEnabled()) return res.status(503).json({ error: "Email isn't set up on this server yet." });
    if (!req.user.email) return res.status(400).json({ error: "Your account has no email address" });
    await sendEmail({ to: req.user.email, subject: "Your FinSight week in review (test)", html: renderWeeklyEmail(await weeklyReportData(req.user.id), { userId: req.user.id }), userId: req.user.id });
    res.json({ sent: true, to: req.user.email });
  }));
  // One-click unsubscribe from the email link (GET) and mail clients (POST, RFC 8058). No login: the token is an HMAC.
  const unsub = handle(async (req, res) => {
    const u = String(req.query.u ?? ""), t = String(req.query.t ?? "");
    if (!/^[0-9a-f-]{36}$/.test(u) || !verifyUnsubscribe(u, t)) return res.status(400).type("html").send("<p>This unsubscribe link isn't valid.</p>");
    await unsubscribe(u);
    res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px -apple-system,Segoe UI,Arial;padding:40px;text-align:center"><h2>You're unsubscribed</h2><p>You won't get weekly reports anymore. You can turn them back on in Account.</p></body>`);
  });
  app.get("/email/unsubscribe", unsub);
  app.post("/email/unsubscribe", unsub);
}
