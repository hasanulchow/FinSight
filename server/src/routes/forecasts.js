import { requireUser } from "../lib/auth.js";
import { listForUser, submitForecast, askQuestion, myStats, leaderboard, setNickname, ensureWeeklyQuestions } from "../lib/forecasts.js";
import { reportError } from "../lib/monitoring.js";

// Routes for Forecasts: the play-money prediction game on where stocks close.

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if ((err.status ?? 500) >= 500) {
      console.error(`${req.method} ${req.path}:`, err.message);
      reportError(err, { route: req.path, userId: req.user?.id });
    }
    if (!res.headersSent) res.status(err.status ?? 500).json({ error: err.message });
  }
};

let seeded = false;

export function registerForecastRoutes(app) {
  // Open or resolved questions, optionally for one ticker (the stock page)
  app.get("/forecasts/questions", requireUser, handle(async (req, res) => {
    // First visit on a fresh server: start creating this week's questions in the background instead of
    // waiting for the scheduled job (options data is rate limited, so this can take a few minutes)
    if (!seeded && !req.query.ticker) {
      seeded = true;
      ensureWeeklyQuestions().catch(() => {});
    }
    res.json(await listForUser(req.user.id, { status: req.query.status === "resolved" ? "resolved" : "open", ticker: req.query.ticker }));
  }));
  app.post("/forecasts/questions", requireUser, handle(async (req, res) => res.status(201).json(await askQuestion(req.user.id, req.body ?? {}))));
  app.post("/forecasts", requireUser, handle(async (req, res) => res.json(await submitForecast(req.user.id, req.body ?? {}))));
  app.get("/forecasts/me", requireUser, handle(async (req, res) => res.json(await myStats(req.user.id))));
  app.get("/forecasts/leaderboard", requireUser, handle(async (req, res) => res.json(await leaderboard(req.user.id, { period: req.query.period === "all" ? "all" : "30d" }))));
  app.patch("/forecasts/profile", requireUser, handle(async (req, res) => res.json(await setNickname(req.user.id, req.body?.nickname))));
}
