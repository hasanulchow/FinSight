import { db } from "./db.js";
import { notify } from "./notify.js";
import { withAiUser } from "./aiUsage.js";
import { checkQuota, recordUsage, checkCap } from "./plans.js";
import { track } from "./analytics.js";

// Scheduled Copilot tasks ("Automations"): a saved prompt the Copilot runs on a schedule,
// e.g. "Every Friday, check my watchlist for oversold names near support". Each run continues
// the task's own conversation and sends the answer as a notification.

const FREQUENCIES = ["daily", "weekdays", "weekly"];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Next run time (UTC) after `from` for a schedule. */
export function nextRun({ frequency, hour_utc, weekday }, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour_utc, 0, 0));
  if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 8; i++) {
    const wd = d.getUTCDay();
    if (frequency === "daily" || (frequency === "weekdays" && wd >= 1 && wd <= 5) || (frequency === "weekly" && wd === weekday)) return d.toISOString();
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

function cleanTask(input) {
  const prompt = String(input.prompt ?? "").trim();
  if (prompt.length < 8) throw bad("Describe what the Copilot should do (at least a few words)");
  const frequency = FREQUENCIES.includes(input.frequency) ? input.frequency : "daily";
  const hour = Math.round(Number(input.hour_utc));
  if (!(hour >= 0 && hour <= 23)) throw bad("Pick a time of day");
  const weekday = frequency === "weekly" ? Math.max(0, Math.min(6, Math.round(Number(input.weekday ?? 5)))) : null;
  return { title: String(input.title ?? prompt).trim().slice(0, 80), prompt: prompt.slice(0, 1000), frequency, hour_utc: hour, weekday, enabled: input.enabled !== false };
}

export const listTasks = (userId) => db.list("copilot_tasks", { user_id: userId }, { limit: 50 });

export async function createTask(userId, input) {
  await checkCap(userId, "automations", (await listTasks(userId)).length);
  const t = cleanTask(input);
  const row = await db.insert("copilot_tasks", { user_id: userId, ...t, next_run_at: nextRun(t) });
  track(userId, "automation_created", { frequency: t.frequency });
  return row;
}

export async function updateTask(userId, id, input) {
  const current = await db.get("copilot_tasks", id, userId);
  if (!current) throw bad("Not found", 404);
  const t = cleanTask({ ...current, ...input });
  return db.update("copilot_tasks", id, userId, { ...t, next_run_at: nextRun(t) });
}

export async function deleteTask(userId, id) {
  if (!(await db.remove("copilot_tasks", id, userId))) throw bad("Not found", 404);
}

/** Runs one task now: a Copilot turn in the task's conversation, then a notification. */
export async function runTask(task) {
  const { runCopilot } = await import("./copilot.js");
  await checkQuota(task.user_id, "copilot");
  const result = await runCopilot({ userId: task.user_id, conversationId: task.conversation_id ?? undefined, message: `[Scheduled task: ${task.title}] ${task.prompt}` });
  await recordUsage(task.user_id, "copilot", { task: task.id });
  const text = result.message.content.replace(/[*#_`]/g, "");
  await notify(task.user_id, { kind: "automation", title: task.title, body: text.slice(0, 400), data: { conversation_id: result.conversation_id } });
  return db.update("copilot_tasks", task.id, task.user_id, { conversation_id: result.conversation_id, last_run_at: new Date().toISOString(), last_status: "ok", last_result: text.slice(0, 2000), next_run_at: nextRun(task) });
}

/** Scheduled job: runs every enabled task whose time has come. */
export async function runDueTasks({ limit = 25 } = {}) {
  const now = new Date().toISOString();
  const due = (await db.all("copilot_tasks", { match: { enabled: true } })).filter((t) => t.next_run_at && t.next_run_at <= now).slice(0, limit);
  let ran = 0;
  for (const task of due) {
    try {
      await withAiUser(task.user_id, () => runTask(task));
      ran++;
    } catch (err) {
      // Over quota or a failed run: skip to the next slot so a broken task doesn't retry every few minutes
      await db.update("copilot_tasks", task.id, task.user_id, { last_run_at: now, last_status: "error", last_result: err.message.slice(0, 500), next_run_at: nextRun(task) });
    }
  }
  return { due: due.length, ran };
}
