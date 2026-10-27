import { config } from "../config.js";
import { runAlertChecks } from "./alerts.js";
import { refreshScreener } from "./screener.js";
import { sendDailyDigests } from "./portfolio.js";

// Scheduled work. Triggered by:
//   - GET/POST /jobs/run with "Authorization: Bearer $CRON_SECRET" (Vercel Cron, Render Cron, any scheduler), or
//   - an in-process timer when JOBS_INTERVAL_MINUTES > 0 (long-running servers like Render or local dev).

let running = false;

export async function runJobs({ tasks = ["alerts", "screener", "digests"], force = false } = {}) {
  if (running) return { skipped: "previous run still in progress" };
  running = true;
  const started = Date.now();
  const result = {};
  try {
    if (tasks.includes("alerts")) result.alerts = await runAlertChecks().catch((e) => ({ error: e.message }));
    if (tasks.includes("screener")) result.screener = await refreshScreener().catch((e) => ({ error: e.message }));
    // Digests go out once a day after the US close (21:00 UTC covers both EST and EDT)
    if (tasks.includes("digests") && (force || new Date().getUTCHours() >= 21)) result.digests = await sendDailyDigests().catch((e) => ({ error: e.message }));
  } finally {
    running = false;
  }
  return { ...result, ms: Date.now() - started };
}

export function startScheduler() {
  if (!config.jobsIntervalMinutes || process.env.VERCEL) return;
  const every = config.jobsIntervalMinutes * 60_000;
  setInterval(() => runJobs().then((r) => console.log("Jobs:", JSON.stringify(r))).catch((e) => console.error("Jobs failed:", e.message)), every).unref();
  console.log(`Scheduler: running alerts, screener refresh and digests every ${config.jobsIntervalMinutes} min`);
}
