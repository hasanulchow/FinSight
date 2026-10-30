import { requireUser } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { detectBullFlag, marketRegime } from "../lib/patterns.js";
import { BOT_TEMPLATES, listBots, createBot, updateBot, deleteBot, listSignals, runBot, backtestBot, cleanConfig } from "../lib/bots.js";
import { reportError } from "../lib/monitoring.js";

// Routes for trading bots (rule-based pattern strategies) and on-demand pattern scans.

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

async function ownBot(req) {
  const bot = await db.get("trading_bots", req.params.id, req.user.id);
  if (!bot) throw Object.assign(new Error("Bot not found"), { status: 404 });
  return bot;
}

export function registerBotRoutes(app) {
  app.get("/bots/templates", requireUser, (_req, res) => res.json(Object.entries(BOT_TEMPLATES).map(([key, t]) => ({ key, ...t }))));
  app.get("/bots", requireUser, handle(async (req, res) => res.json(await listBots(req.user.id))));
  app.post("/bots", requireUser, handle(async (req, res) => res.status(201).json(await createBot(req.user.id, req.body ?? {}))));
  app.patch("/bots/:id", requireUser, handle(async (req, res) => res.json(await updateBot(req.user.id, req.params.id, req.body ?? {}))));
  app.delete("/bots/:id", requireUser, handle(async (req, res) => {
    await deleteBot(req.user.id, req.params.id);
    res.status(204).end();
  }));
  app.get("/bots/:id/signals", requireUser, handle(async (req, res) => {
    await ownBot(req);
    res.json(await listSignals(req.user.id, req.params.id));
  }));
  // Run now: scan + act (paper entries or alerts) + manage open bot trades
  app.post("/bots/:id/run", requireUser, handle(async (req, res) => res.json(await runBot(req.user.id, await ownBot(req), { manual: true }))));
  // Backtest a saved bot, or an unsaved config from the editor
  app.post("/bots/:id/backtest", requireUser, handle(async (req, res) => res.json(await backtestBot(req.user.id, await ownBot(req)))));
  app.post("/bots/backtest", requireUser, handle(async (req, res) => res.json(await backtestBot(req.user.id, cleanConfig(req.body?.config ?? req.body ?? {})))));

  // Pattern scan for one stock (stock page) and the current market regime
  app.get("/stocks/:ticker/patterns", requireUser, handle(async (req, res) => {
    const t = String(req.params.ticker).toUpperCase();
    if (!TICKER_RE.test(t)) return res.status(400).json({ error: "Invalid ticker" });
    if (!pricesEnabled()) return res.json({ ticker: t, bull_flag: null, note: "Price history isn't set up on this server." });
    const bars = await getDailyBars(t);
    res.json({ ticker: t, bull_flag: detectBullFlag(bars), as_of: new Date(bars[bars.length - 1].t).toISOString().slice(0, 10) });
  }));
  app.get("/market/regime", requireUser, handle(async (_req, res) => {
    if (!pricesEnabled()) return res.json({ state: "unknown", reasons: ["Price history isn't set up on this server."] });
    res.json(marketRegime(await getDailyBars("SPY", { maxAgeHours: 12 })));
  }));
}
