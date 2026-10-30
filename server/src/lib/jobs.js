import { config } from "../config.js";
import { runAlertChecks } from "./alerts.js";
import { refreshScreener } from "./screener.js";
import { sendDailyDigests } from "./portfolio.js";
import { sendMorningBriefs } from "./brief.js";
import { runThesisChecks } from "./watchlist.js";
import { runDueTasks } from "./tasks.js";
import { runPaperOrders } from "./paper.js";
import { sendEarningsHeadsUps } from "./earnings.js";
import { sendWeeklyEmails } from "./email.js";
import { reportError } from "./monitoring.js";

// Scheduled work. Triggered by:
//   - GET/POST /jobs/run with "Authorization: Bearer $CRON_SECRET" (Vercel Cron, Render Cron, any scheduler), or
//   - an in-process timer when JOBS_INTERVAL_MINUTES > 0 (long-running servers like Render or local dev).

let running = false;

export async function runJobs({ tasks = ["alerts", "screener", "digests", "briefs", "theses", "automations", "paper", "earnings", "emails"], force = false } = {}) {
  if (running) return { skipped: "previous run still in progress" };
  running = true;
  const started = Date.now();
  const result = {};
  try {
    if (tasks.includes("alerts")) result.alerts = await runAlertChecks().catch((e) => ({ error: e.message }));
    if (tasks.includes("screener")) result.screener = await refreshScreener().catch((e) => ({ error: e.message }));
    // Digests go out once a day after the US close (21:00 UTC covers both EST and EDT)
    if (tasks.includes("digests") && (force || new Date().getUTCHours() >= 21)) result.digests = await sendDailyDigests().catch((e) => ({ error: e.message }));
    // Pre-market: re-check theses first so the morning brief sees fresh verdicts
    const hour = new Date().getUTCHours();
    if (tasks.includes("theses") && (force || (hour >= 10 && hour <= 15))) result.theses = await runThesisChecks().catch((e) => ({ error: e.message }));
    if (tasks.includes("briefs")) result.briefs = await sendMorningBriefs({ force }).catch((e) => ({ error: e.message }));
    if (tasks.includes("automations")) result.automations = await runDueTasks().catch((e) => ({ error: e.message }));
    if (tasks.includes("paper")) result.paper = await runPaperOrders().catch((e) => ({ error: e.message }));
    if (tasks.includes("earnings") && (force || (hour >= 11 && hour <= 14))) result.earnings = await sendEarningsHeadsUps().catch((e) => ({ error: e.message }));
    if (tasks.includes("emails")) result.emails = await sendWeeklyEmails({ force }).catch((e) => ({ error: e.message }));
    for (const [name, r] of Object.entries(result)) if (r?.error) reportError(new Error(`Job ${name}: ${r.error}`), { where: "jobs" });
  } finally {
    running = false;
  }
  return { ...result, ms: Date.now() - started };
}

export function startScheduler() {
  if (!config.jobsIntervalMinutes || process.env.VERCEL) return;
  const every = config.jobsIntervalMinutes * 60_000;
  setInterval(() => runJobs().then((r) => console.log("Jobs:", JSON.stringify(r))).catch((e) => console.error("Jobs failed:", e.message)), every).unref();
  console.log(`Scheduler: running alerts, screener, digests, morning briefs, thesis checks and automations every ${config.jobsIntervalMinutes} min`);
}
