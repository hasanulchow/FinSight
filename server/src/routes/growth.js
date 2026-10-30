import { requireUser } from "../lib/auth.js";
import { checkQuota, recordUsage, checkCap } from "../lib/plans.js";
import { getSettings, updateSettings, completeOnboarding, saveRules, deleteAccount, referralStats, TERMS_VERSION } from "../lib/account.js";
import { listWatch, addWatch, updateWatch, deleteWatch, checkThesis } from "../lib/watchlist.js";
import { buildBrief, latestBrief } from "../lib/brief.js";
import { listTasks, createTask, updateTask, deleteTask, runTask } from "../lib/tasks.js";
import { RULE_DEFS, cleanRules, precheckTrade } from "../lib/rules.js";
import { explainOptionPnl } from "../lib/optionPnl.js";
import { taxSummary } from "../lib/tax.js";
import { brokerStatus, connectUrl, syncBroker, disconnectBroker } from "../lib/broker.js";
import { shareBriefing, shareJournal, getShare } from "../lib/shares.js";
import { adminMetrics, isAdmin, requireAdmin } from "../lib/admin.js";
import { track, CLIENT_EVENTS } from "../lib/analytics.js";
import { db } from "../lib/db.js";
import { reportError } from "../lib/monitoring.js";

// Routes for the proactive agent (morning brief, thesis tracker, automations), trading discipline
// (rules checklist, option P/L explainer, tax), broker sync, and launch basics
// (onboarding, settings, referrals, sharing, account deletion, analytics, admin metrics).


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

export function registerGrowthRoutes(app) {
  // ---------- Account, onboarding, referrals ----------
  app.get("/settings", requireUser, handle(async (req, res) => {
    const s = await getSettings(req.user);
    res.json({ ...s, is_admin: isAdmin(req.user), terms_version: TERMS_VERSION, needs_onboarding: !s.onboarded_at || s.terms_version !== TERMS_VERSION });
  }));
  app.patch("/settings", requireUser, handle(async (req, res) => res.json(await updateSettings(req.user, req.body))));
  app.post("/onboarding", requireUser, handle(async (req, res) => res.json(await completeOnboarding(req.user, req.body ?? {}))));
  app.get("/referrals", requireUser, handle(async (req, res) => res.json(await referralStats(req.user))));
  app.delete("/account", requireUser, handle(async (req, res) => {
    if (req.body?.confirm !== "DELETE") return res.status(400).json({ error: 'Type DELETE to confirm' });
    res.json(await deleteAccount(req.user));
  }));
  app.post("/events", requireUser, handle(async (req, res) => {
    const { event, properties } = req.body ?? {};
    if (CLIENT_EVENTS.has(event)) track(req.user.id, event, typeof properties === "object" && properties ? properties : {});
    res.status(204).end();
  }));

  // ---------- Watchlist + thesis tracker ----------
  app.get("/watchlist", requireUser, handle(async (req, res) => res.json(await listWatch(req.user.id))));
  app.post("/watchlist", requireUser, handle(async (req, res) => {
    const items = await listWatch(req.user.id);
    if (!items.some((w) => w.ticker === String(req.body?.ticker ?? "").toUpperCase())) await checkCap(req.user.id, "watchlist", items.length);
    res.status(201).json(await addWatch(req.user.id, req.body ?? {}));
  }));
  app.patch("/watchlist/:id", requireUser, handle(async (req, res) => res.json(await updateWatch(req.user.id, req.params.id, req.body ?? {}))));
  app.delete("/watchlist/:id", requireUser, handle(async (req, res) => {
    await deleteWatch(req.user.id, req.params.id);
    res.status(204).end();
  }));
  app.post("/watchlist/:id/check", requireUser, handle(async (req, res) => {
    const item = await db.get("watchlist", req.params.id, req.user.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    await checkQuota(req.user.id, "ai_tool");
    const row = await checkThesis(req.user.id, item, { notifyOnChange: false });
    await recordUsage(req.user.id, "ai_tool", { tool: "thesis" });
    res.json(row);
  }));

  // ---------- Morning brief ----------
  app.get("/brief", requireUser, handle(async (req, res) => res.json((await latestBrief(req.user.id)) ?? { empty: true })));
  app.post("/brief/generate", requireUser, handle(async (req, res) => {
    await checkQuota(req.user.id, "ai_tool");
    const brief = await buildBrief(req.user.id, { force: true });
    if (!brief) return res.json({ empty: true });
    await recordUsage(req.user.id, "ai_tool", { tool: "brief" });
    track(req.user.id, "brief_generated");
    res.json(brief);
  }));

  // ---------- Automations (scheduled Copilot tasks) ----------
  app.get("/automations", requireUser, handle(async (req, res) => res.json(await listTasks(req.user.id))));
  app.post("/automations", requireUser, handle(async (req, res) => res.status(201).json(await createTask(req.user.id, req.body ?? {}))));
  app.patch("/automations/:id", requireUser, handle(async (req, res) => res.json(await updateTask(req.user.id, req.params.id, req.body ?? {}))));
  app.delete("/automations/:id", requireUser, handle(async (req, res) => {
    await deleteTask(req.user.id, req.params.id);
    res.status(204).end();
  }));
  app.post("/automations/:id/run", requireUser, handle(async (req, res) => {
    const task = await db.get("copilot_tasks", req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: "Not found" });
    res.json(await runTask(task));
  }));

  // ---------- Trading rules + pre-trade checklist ----------
  app.get("/rules", requireUser, handle(async (req, res) => res.json({ definitions: RULE_DEFS, rules: (await getSettings(req.user)).rules ?? {} })));
  app.put("/rules", requireUser, handle(async (req, res) => {
    const rules = cleanRules(req.body?.rules ?? req.body);
    await saveRules(req.user, rules);
    res.json({ rules });
  }));
  app.post("/journal/precheck", requireUser, handle(async (req, res) => {
    const rules = (await getSettings(req.user)).rules ?? {};
    res.json(Object.keys(rules).length ? await precheckTrade(req.user.id, rules, req.body ?? {}) : { ok: true, failed: 0, checks: [], no_rules: true });
  }));

  // ---------- Option P/L explainer, tax ----------
  app.post("/options/pnl-explain", requireUser, handle(async (req, res) => res.json(await explainOptionPnl(req.body ?? {}))));
  app.get("/tax/summary", requireUser, handle(async (req, res) => res.json(await taxSummary(req.user.id, { year: Number(req.query.year) || new Date().getUTCFullYear() }))));

  // ---------- Broker sync (SnapTrade) ----------
  app.get("/broker", requireUser, handle(async (req, res) => res.json(await brokerStatus(req.user.id))));
  app.post("/broker/connect", requireUser, handle(async (req, res) => res.json(await connectUrl(req.user.id, { returnUrl: req.body?.return_url }))));
  app.post("/broker/sync", requireUser, handle(async (req, res) => res.json(await syncBroker(req.user.id))));
  app.delete("/broker", requireUser, handle(async (req, res) => res.json(await disconnectBroker(req.user.id))));

  // ---------- Sharing ----------
  app.post("/briefings/:id/share", requireUser, handle(async (req, res) => res.json(await shareBriefing(req.user, req.params.id))));
  app.post("/journal/share", requireUser, handle(async (req, res) => res.json(await shareJournal(req.user))));
  app.get("/share/:token", handle(async (req, res) => {
    const share = await getShare(req.params.token);
    if (!share) return res.status(404).json({ error: "This link doesn't exist or was removed" });
    res.json(share);
  }));

  // ---------- Admin ----------
  app.get("/admin/metrics", requireUser, requireAdmin, handle(async (_req, res) => res.json(await adminMetrics())));
}
