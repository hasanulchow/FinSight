import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { waitUntil } from "@vercel/functions";
import { config } from "./config.js";
import { supabase } from "./lib/supabase.js";
import { requireUser } from "./lib/auth.js";
import { runResearch } from "./agents/orchestrator.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Local dev: serves the Expo web build (mobile/dist) when it exists. On Vercel the CDN serves it.
const webDist = fileURLToPath(new URL("../../mobile/dist", import.meta.url));
if (existsSync(webDist)) app.use(express.static(webDist));

/**
 * Starts a research run and returns the briefing id immediately.
 * The agents run in the background (~30-90s); the app polls GET /briefings/:id.
 */
app.post("/briefings", requireUser, async (req, res) => {
  const ticker = String(req.body?.ticker || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return res.status(400).json({ error: "Enter a valid ticker, e.g. AAPL" });

  const { data: row, error } = await supabase()
    .from("briefings")
    .insert({ user_id: req.user.id, ticker, status: "running", progress: "Starting" })
    .select("id")
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(202).json({ id: row.id });
  // On Vercel, waitUntil keeps the function alive after the response until the agents finish
  // (bounded by maxDuration in vercel.json). Locally it just lets the promise run.
  waitUntil(processBriefing(row.id, ticker));
});

async function processBriefing(id, ticker) {
  const db = supabase();
  try {
    const result = await runResearch({
      ticker,
      briefingId: id,
      progress: (step) => db.from("briefings").update({ progress: step }).eq("id", id),
    });

    await db.from("evaluations").insert({ briefing_id: id, judge_model: config.evalModel, ...result.evaluation });
    await db.from("briefings").update({
      status: "complete",
      progress: "Done",
      company_name: result.company.name,
      source_data: result.sourceData,
      content: result.content,
      completed_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (err) {
    console.error(`Briefing ${id} (${ticker}) failed:`, err);
    await db.from("briefings").update({ status: "failed", error: String(err.message || err) }).eq("id", id);
  }
}

app.get("/briefings", requireUser, async (req, res) => {
  const { data, error } = await supabase()
    .from("briefings")
    .select("id, ticker, company_name, status, created_at, evaluations(overall)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/briefings/:id", requireUser, async (req, res) => {
  const { data, error } = await supabase()
    .from("briefings")
    .select("id, ticker, company_name, status, progress, content, error, created_at, evaluations(*), agent_logs(agent, model, input_tokens, output_tokens, latency_ms, status)")
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

app.post("/briefings/:id/feedback", requireUser, async (req, res) => {
  const rating = Number(req.body?.rating);
  if (![1, -1].includes(rating)) return res.status(400).json({ error: "rating must be 1 or -1" });

  const { data: owned } = await supabase().from("briefings").select("id").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { error } = await supabase()
    .from("feedback")
    .upsert({ briefing_id: req.params.id, user_id: req.user.id, rating, comment: req.body?.comment ?? null }, { onConflict: "briefing_id,user_id" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Vercel imports the app as a function (api/index.js); everywhere else, run a normal server.
if (!process.env.VERCEL) {
  app.listen(config.port, () => console.log(`FinSight API listening on :${config.port}`));
}

export default app;
