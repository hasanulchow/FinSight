import { config } from "../config.js";
import { requireUser } from "../lib/auth.js";
import { checkInput, enforceOutput, logGuardrail } from "../lib/guardrails.js";
import { lookupCompany } from "../tools/sec.js";
import { getDailyBars } from "../tools/prices.js";
import { technicalSnapshot, chartSeries } from "../lib/indicators.js";
import { technicalAnalyst } from "../agents/technicalAnalyst.js";
import { getStockEvents } from "../lib/events.js";
import { ALERT_TYPES, createAlert, deleteAlert, listAlerts, updateAlert } from "../lib/alerts.js";
import { listNotifications, markRead, registerPushToken } from "../lib/notify.js";
import { runScreen, universe, NUMERIC_FIELDS } from "../lib/screener.js";
import { computeXray, deleteHolding, listHoldings, parseHoldingsCsv, portfolioAnalyst, upsertHoldings } from "../lib/portfolio.js";
import { runJobs } from "../lib/jobs.js";
import { checkCap, checkQuota, recordUsage } from "../lib/plans.js";
import { getOptionsOverview, strategyFromOverview, STRATEGIES } from "../lib/options.js";
import { optionsAnalyst } from "../agents/optionsAnalyst.js";
import { runBacktest, BACKTEST_STRATEGIES } from "../lib/backtest.js";
import { getMarketOverview, compareTickers } from "../lib/market.js";
import { getEarningsCalendar } from "../tools/quote.js";

// Routes for the trading features: technical analysis, alerts + notifications, screener,
// earnings & insiders, portfolio X-ray, and the scheduled-jobs trigger.

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

// AI-backed tools (screener, chart/options explanations, X-ray analysis) count against the plan's daily quota
async function aiQuota(userId, tool) {
  await checkQuota(userId, "ai_tool");
  await recordUsage(userId, "ai_tool", { tool });
}

// Wraps async handlers: errors with .status become that HTTP status
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.path}:`, err.message);
    if (!res.headersSent) res.status(err.status ?? 500).json({ error: err.message, ...(err.upgrade != null && { upgrade: err.upgrade }) });
  }
};

const tickerParam = (req, res) => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    res.status(400).json({ error: "Enter a valid ticker, e.g. AAPL" });
    return null;
  }
  return ticker;
};

export function registerTradingRoutes(app) {
  // ---------- Technical analysis ----------
  app.get("/stocks/:ticker/technicals", requireUser, handle(async (req, res) => {
    const ticker = tickerParam(req, res);
    if (!ticker) return;
    const bars = await getDailyBars(ticker);
    if (bars.length < 30) return res.status(404).json({ error: `Not enough price history for ${ticker}` });
    const snapshot = technicalSnapshot(bars);
    const out = { ticker, snapshot, chart: chartSeries(bars, Number(req.query.days) || 180) };
    if (req.query.explain === "1") {
      await aiQuota(req.user.id, "technicals");
      const company = (await lookupCompany(ticker)) ?? { name: ticker, ticker };
      out.analysis = enforceOutput(await technicalAnalyst({ company, snapshot })).value;
    }
    res.json(out);
  }));

  // ---------- Earnings & smart money ----------
  app.get("/stocks/:ticker/events", requireUser, handle(async (req, res) => {
    const ticker = tickerParam(req, res);
    if (!ticker) return;
    res.json(await getStockEvents(ticker));
  }));

  // ---------- Alerts ----------
  app.get("/alerts/types", requireUser, (_req, res) => res.json(Object.entries(ALERT_TYPES).map(([type, s]) => ({ type, label: s.label, needs: s.needs ?? null }))));
  app.get("/alerts", requireUser, handle(async (req, res) => res.json(await listAlerts(req.user.id))));
  app.post("/alerts", requireUser, handle(async (req, res) => {
    await checkCap(req.user.id, "alerts", (await listAlerts(req.user.id)).filter((a) => a.active).length);
    res.status(201).json(await createAlert(req.user.id, req.body ?? {}));
  }));
  app.patch("/alerts/:id", requireUser, handle(async (req, res) => ((await updateAlert(req.user.id, req.params.id, req.body ?? {})) ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" }))));
  app.delete("/alerts/:id", requireUser, handle(async (req, res) => ((await deleteAlert(req.user.id, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" }))));

  // ---------- Notifications + push ----------
  app.get("/notifications", requireUser, handle(async (req, res) => res.json(await listNotifications(req.user.id))));
  app.post("/notifications/:id/read", requireUser, handle(async (req, res) => {
    await markRead(req.user.id, req.params.id);
    res.json({ ok: true });
  }));
  app.post("/push/register", requireUser, handle(async (req, res) => {
    await registerPushToken(req.user.id, String(req.body?.token ?? ""), req.body?.platform);
    res.json({ ok: true });
  }));

  // ---------- Screener ----------
  app.get("/screener/fields", requireUser, (_req, res) => res.json({ fields: NUMERIC_FIELDS, universe_size: universe().length }));
  app.post("/screener", requireUser, handle(async (req, res) => {
    const input = checkInput(req.body?.query, { maxLength: 300, label: "Screen" });
    if (!input.ok) {
      await logGuardrail({ userId: req.user.id, stage: "input", rule: input.rule, action: "blocked", detail: { where: "screener" } });
      return res.status(400).json({ error: input.reason });
    }
    await aiQuota(req.user.id, "screener");
    res.json(await runScreen(input.text));
  }));

  // ---------- Portfolio ----------
  app.get("/portfolio", requireUser, handle(async (req, res) => res.json(await listHoldings(req.user.id))));
  app.post("/portfolio/import", requireUser, handle(async (req, res) => {
    const csv = String(req.body?.csv ?? "");
    if (csv.length > 200_000) return res.status(400).json({ error: "That file is too large (max 200 KB)" });
    const { holdings, skipped } = parseHoldingsCsv(csv);
    if (!holdings.length) return res.status(400).json({ error: "No holdings found. Use columns like Symbol, Quantity, Average Cost, or lines like 'AAPL,10,150'.", skipped: skipped.slice(0, 10) });
    await checkCap(req.user.id, "holdings", (req.body?.mode === "replace" ? 0 : (await listHoldings(req.user.id)).length) + holdings.length - 1);
    const saved = await upsertHoldings(req.user.id, holdings, { mode: req.body?.mode === "replace" ? "replace" : "merge" });
    res.json({ imported: holdings.length, skipped: skipped.slice(0, 20), holdings: saved });
  }));
  app.post("/portfolio/holdings", requireUser, handle(async (req, res) => {
    const ticker = String(req.body?.ticker ?? "").trim().toUpperCase();
    const shares = Number(req.body?.shares);
    const cost = req.body?.cost_basis === "" || req.body?.cost_basis == null ? null : Number(req.body.cost_basis);
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "Enter a valid ticker" });
    if (!(shares > 0)) return res.status(400).json({ error: "Shares must be greater than 0" });
    if (cost != null && !(cost > 0)) return res.status(400).json({ error: "Cost per share must be greater than 0" });
    const current = await listHoldings(req.user.id);
    if (!current.some((h) => h.ticker === ticker)) await checkCap(req.user.id, "holdings", current.length);
    res.json(await upsertHoldings(req.user.id, [{ ticker, shares, cost_basis: cost }]));
  }));
  app.delete("/portfolio/holdings/:id", requireUser, handle(async (req, res) => ((await deleteHolding(req.user.id, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" }))));
  app.get("/portfolio/xray", requireUser, handle(async (req, res) => {
    const xray = await computeXray(req.user.id);
    if (!xray) return res.json({ empty: true });
    let analysis = null;
    if (req.query.analysis !== "0") {
      try {
        await aiQuota(req.user.id, "xray");
      } catch (err) {
        return res.json({ ...xray, analysis: null, analysis_error: err.message, upgrade: err.upgrade });
      }
      analysis = await portfolioAnalyst(xray).catch((err) => (console.error("Portfolio analyst:", err.message), null));
    }
    res.json({ ...xray, analysis });
  }));

  // ---------- Options ----------
  const nextEarnings = async (ticker) => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    return (await getEarningsCalendar({ from, to, ticker }).catch(() => []))[0] ?? null;
  };
  const expirationParam = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : undefined);

  app.get("/options/strategies", requireUser, (_req, res) => res.json(Object.entries(STRATEGIES).map(([key, s]) => ({ key, ...s }))));

  app.get("/stocks/:ticker/options", requireUser, handle(async (req, res) => {
    const ticker = tickerParam(req, res);
    if (!ticker) return;
    const overview = await getOptionsOverview(ticker, { expiration: expirationParam(req.query.expiration) });
    const earnings = await nextEarnings(ticker);
    let ai = null;
    if (req.query.explain === "1") {
      await aiQuota(req.user.id, "options");
      ai = enforceOutput(await optionsAnalyst({ overview, nextEarnings: earnings })).value;
    }
    res.json({ ...overview, next_earnings: earnings, ai });
  }));

  app.post("/stocks/:ticker/options/strategy", requireUser, handle(async (req, res) => {
    const ticker = tickerParam(req, res);
    if (!ticker) return;
    const name = String(req.body?.strategy ?? "");
    if (!STRATEGIES[name]) return res.status(400).json({ error: `Unknown strategy. Use one of: ${Object.keys(STRATEGIES).join(", ")}` });
    const overview = await getOptionsOverview(ticker, { expiration: expirationParam(req.body?.expiration) });
    const strategy = strategyFromOverview(overview, name);
    // `analysis` is the payoff math; the AI explanation goes in `ai`
    let ai = null;
    if (req.body?.explain) {
      await aiQuota(req.user.id, "strategy");
      ai = enforceOutput(await optionsAnalyst({ overview, strategy, nextEarnings: await nextEarnings(ticker) })).value;
    }
    res.json({ ...strategy, data_source: overview.data_source, ai });
  }));

  // ---------- Backtesting ----------
  app.get("/backtest/strategies", requireUser, (_req, res) =>
    res.json(Object.entries(BACKTEST_STRATEGIES).map(([key, s]) => ({ key, label: s.label, params: s.params, rules: s.describe(s.params) })))
  );
  app.post("/stocks/:ticker/backtest", requireUser, handle(async (req, res) => {
    const ticker = tickerParam(req, res);
    if (!ticker) return;
    const bars = await getDailyBars(ticker);
    const costBps = Math.min(100, Math.max(0, Number(req.body?.cost_bps ?? 5)));
    res.json({ ticker, ...runBacktest(bars, { strategy: String(req.body?.strategy ?? ""), params: req.body?.params ?? {}, costBps }) });
  }));

  // ---------- Markets ----------
  app.get("/market/overview", requireUser, handle(async (_req, res) => res.json(await getMarketOverview())));
  app.get("/market/compare", requireUser, handle(async (req, res) => {
    const tickers = String(req.query.tickers ?? "").split(",");
    res.json(await compareTickers(tickers, Math.min(500, Math.max(20, Number(req.query.days) || 252))));
  }));

  // ---------- Scheduled jobs ----------
  const jobsHandler = handle(async (req, res) => {
    // Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Local mode allows unauthenticated runs for testing.
    const authorized = config.cronSecret ? req.headers.authorization === `Bearer ${config.cronSecret}` : config.localMode;
    if (!authorized) return res.status(401).json({ error: "Unauthorized" });
    const tasks = req.query.tasks ? String(req.query.tasks).split(",") : undefined;
    res.json(await runJobs({ tasks, force: req.query.force === "1" }));
  });
  app.get("/jobs/run", jobsHandler);
  app.post("/jobs/run", jobsHandler);
}
