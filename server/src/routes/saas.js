import { requireUser } from "../lib/auth.js";
import { checkQuota, recordUsage, planSummary, checkCap, PLANS } from "../lib/plans.js";
import { createCheckout, createPortal, handleWebhook, cancelFlow, retentionOffer, CANCEL_REASONS } from "../lib/billing.js";
import { runCopilot, resolveAction, listConversations, getMessages, listPendingActions, TOOLS } from "../lib/copilot.js";
import { listTrades, addTrade, updateTrade, deleteTrade, journalStats, journalCoach, parseTradesCsv, tradeResult, EMOTIONS } from "../lib/journal.js";
import { positionSize, stopSuggestions, benchmarkPortfolio } from "../lib/risk.js";
import { getRedFlags } from "../lib/redflags.js";
import { getQuoteLite } from "../tools/quote.js";
import { reportError } from "../lib/monitoring.js";

// Routes for the SaaS layer: Copilot agent, trade journal + coach, risk tools, red flags,
// plans/usage and Stripe billing.

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

// Errors with .status become that HTTP status; 402 responses carry `upgrade` for the app's paywall

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!err.status || err.status >= 500) {
      console.error(`${req.method} ${req.path}:`, err.message);
      reportError(err, { route: req.path, userId: req.user?.id });
    }
    if (!res.headersSent) res.status(err.status ?? 500).json({ error: err.message, ...(err.upgrade != null && { upgrade: err.upgrade }) });
  }
};

export function registerSaasRoutes(app) {
  // ---------- Plans & billing ----------
  app.get("/plans", (_req, res) => res.json(Object.entries(PLANS).map(([key, p]) => ({ key, ...p }))));
  app.get("/account", requireUser, handle(async (req, res) => res.json({ email: req.user.email, ...(await planSummary(req.user.id)) })));
  app.post("/billing/checkout", requireUser, handle(async (req, res) => res.json(await createCheckout(req.user, { returnUrl: req.body?.return_url, interval: req.body?.interval === "year" ? "year" : "month" }))));
  app.get("/billing/cancel-reasons", requireUser, (_req, res) => res.json(Object.entries(CANCEL_REASONS).map(([key, label]) => ({ key, label, offer: retentionOffer(key) }))));
  app.post("/billing/cancel", requireUser, handle(async (req, res) => res.json(await cancelFlow(req.user, req.body ?? {}))));
  app.post("/billing/portal", requireUser, handle(async (req, res) => res.json(await createPortal(req.user, { returnUrl: req.body?.return_url }))));
  // Stripe calls this; express.json keeps the raw bytes in req.rawBody for signature verification
  app.post("/billing/webhook", handle(async (req, res) => res.json(await handleWebhook(req.rawBody, req.headers["stripe-signature"]))));

  // ---------- Copilot ----------
  app.get("/copilot/tools", requireUser, (_req, res) => res.json(TOOLS.map((t) => ({ name: t.name, description: t.description }))));
  app.get("/copilot/conversations", requireUser, handle(async (req, res) => res.json(await listConversations(req.user.id))));
  app.get("/copilot/conversations/:id", requireUser, handle(async (req, res) => res.json(await getMessages(req.user.id, req.params.id))));
  app.get("/copilot/actions", requireUser, handle(async (req, res) => res.json(await listPendingActions(req.user.id))));
  app.post("/copilot/chat", requireUser, handle(async (req, res) => {
    await checkQuota(req.user.id, "copilot");
    const result = await runCopilot({ userId: req.user.id, conversationId: req.body?.conversation_id || null, message: req.body?.message });
    await recordUsage(req.user.id, "copilot", { tools: result.trace.length });
    res.json(result);
  }));
  app.post("/copilot/actions/:id/:decision", requireUser, handle(async (req, res) => {
    if (!["confirm", "cancel"].includes(req.params.decision)) return res.status(400).json({ error: "Use confirm or cancel" });
    res.json(await resolveAction(req.user.id, req.params.id, req.params.decision));
  }));

  // ---------- Trade journal ----------
  app.get("/journal", requireUser, handle(async (req, res) => {
    const trades = await listTrades(req.user.id);
    res.json({ trades: trades.map((t) => ({ ...t, result: tradeResult(t) })), stats: journalStats(trades), emotions: EMOTIONS });
  }));
  app.post("/journal/trades", requireUser, handle(async (req, res) => {
    await checkCap(req.user.id, "trades", (await listTrades(req.user.id)).length);
    res.status(201).json(await addTrade(req.user.id, req.body ?? {}));
  }));
  app.patch("/journal/trades/:id", requireUser, handle(async (req, res) => {
    const t = await updateTrade(req.user.id, req.params.id, req.body ?? {});
    t ? res.json(t) : res.status(404).json({ error: "Not found" });
  }));
  app.delete("/journal/trades/:id", requireUser, handle(async (req, res) => ((await deleteTrade(req.user.id, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" }))));
  app.post("/journal/import", requireUser, handle(async (req, res) => {
    const { trades, skipped, error } = parseTradesCsv(req.body?.csv);
    if (!trades.length) return res.status(400).json({ error: error ?? "No trades found in that file", skipped: skipped.slice(0, 10) });
    await checkCap(req.user.id, "trades", (await listTrades(req.user.id)).length + trades.length - 1);
    for (const t of trades) await addTrade(req.user.id, t);
    res.json({ imported: trades.length, skipped: skipped.slice(0, 20) });
  }));
  app.post("/journal/coach", requireUser, handle(async (req, res) => {
    const trades = await listTrades(req.user.id);
    const stats = journalStats(trades);
    if (stats.totals.closed < 3) return res.status(400).json({ error: "Log at least 3 closed trades so the coach has something to work with." });
    await checkQuota(req.user.id, "ai_tool");
    const recent = trades.filter((t) => t.exit_price != null).slice(0, 25).map(({ ticker, side, instrument, quantity, entry_price, exit_price, stop_price, entry_date, exit_date, setup, emotion }) => ({ ticker, side, instrument, quantity, entry_price, exit_price, stop_price, entry_date, exit_date, setup, emotion }));
    const coach = await journalCoach(stats, recent);
    await recordUsage(req.user.id, "ai_tool", { tool: "journal_coach" });
    res.json(coach);
  }));

  // ---------- Risk tools ----------
  app.post("/risk/position-size", requireUser, handle(async (req, res) => {
    const b = req.body ?? {};
    let entry = Number(b.entry), atr = null, suggestions = null;
    if (b.ticker) {
      const t = String(b.ticker).toUpperCase();
      if (!TICKER_RE.test(t)) return res.status(400).json({ error: "Invalid ticker" });
      suggestions = await stopSuggestions(t).catch(() => null);
      if (!(entry > 0)) entry = suggestions?.price ?? (await getQuoteLite(t)).price;
      atr = suggestions?.atr14 ?? null;
    }
    const result = positionSize({ account: Number(b.account_size), riskPct: Number(b.risk_pct), entry, stop: Number(b.stop) || null, side: b.side === "short" ? "short" : "long", maxPositionPct: Number(b.max_position_pct) || 100, atr });
    res.json({ entry, ...result, suggestions });
  }));
  app.get("/portfolio/benchmark", requireUser, handle(async (req, res) => res.json(await benchmarkPortfolio(req.user.id, { days: Math.min(500, Math.max(20, Number(req.query.days) || 252)) }))));
  app.get("/stocks/:ticker/redflags", requireUser, handle(async (req, res) => {
    const t = String(req.params.ticker).toUpperCase();
    if (!TICKER_RE.test(t)) return res.status(400).json({ error: "Invalid ticker" });
    res.json(await getRedFlags(t));
  }));
}

