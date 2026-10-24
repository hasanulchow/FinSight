import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { waitUntil } from "@vercel/functions";
import { config, missingResearchKeys } from "./config.js";
import { supabase } from "./lib/supabase.js";
import { localStore } from "./lib/localStore.js";
import { requireUser } from "./lib/auth.js";
import { runResearch } from "./agents/orchestrator.js";
import { qaAgent, evaluateAnswer } from "./agents/qaAgent.js";
import { checkInput, checkRateLimit, enforceOutput, logGuardrail, scanOutput, screenRetrieved } from "./lib/guardrails.js";
import { MEMORY_KINDS, addMemory, chatHistory, deleteMemory, listMemories, saveChatMessage, updateChatMessage } from "./lib/memory.js";
import { indexFiling, searchFiling } from "./lib/retrieval.js";
import { evalSummary } from "./lib/evalSummary.js";

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

  const missing = missingResearchKeys();
  if (missing.length) return res.status(503).json({ error: `The agents can't run: set ${missing.join(", ")} in the server environment and restart it.` });

  const limit = await checkRateLimit(req.user.id, "briefing");
  if (!limit.ok) {
    await logGuardrail({ userId: req.user.id, stage: "input", rule: limit.rule, action: "blocked", detail: { ticker } });
    return res.status(429).json({ error: limit.reason });
  }

  if (config.localMode) {
    const row = localStore.createBriefing({ user_id: req.user.id, ticker, status: "running", progress: "Starting" });
    res.status(202).json({ id: row.id });
    return processBriefing(row.id, ticker, req.user.id);
  }

  const { data: row, error } = await supabase()
    .from("briefings")
    .insert({ user_id: req.user.id, ticker, status: "running", progress: "Starting" })
    .select("id")
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(202).json({ id: row.id });
  // On Vercel, waitUntil keeps the function alive after the response until the agents finish
  // (bounded by maxDuration in vercel.json). Locally it just lets the promise run.
  waitUntil(processBriefing(row.id, ticker, req.user.id));
});

async function processBriefing(id, ticker, userId) {
  const updateBriefing = (fields) =>
    config.localMode ? localStore.updateBriefing(id, fields) : supabase().from("briefings").update(fields).eq("id", id);
  try {
    const result = await runResearch({
      ticker,
      briefingId: id,
      userId,
      progress: (step) => updateBriefing({ progress: step }),
    });

    const evaluation = { briefing_id: id, judge_model: config.evalModel, ...result.evaluation };
    if (config.localMode) localStore.insertEvaluation(evaluation);
    else await supabase().from("evaluations").insert(evaluation);
    await updateBriefing({
      status: "complete",
      progress: "Done",
      company_name: result.company.name,
      source_data: result.sourceData,
      content: result.content,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`Briefing ${id} (${ticker}) failed:`, err);
    await updateBriefing({ status: "failed", error: String(err.message || err) });
  }
}

app.get("/briefings", requireUser, async (req, res) => {
  if (config.localMode) return res.json(localStore.listBriefings(req.user.id));
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
  if (config.localMode) {
    const briefing = localStore.getBriefing(req.params.id, req.user.id);
    return briefing ? res.json(briefing) : res.status(404).json({ error: "Not found" });
  }
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

  if (config.localMode) {
    if (!localStore.getBriefing(req.params.id, req.user.id)) return res.status(404).json({ error: "Not found" });
    localStore.upsertFeedback({ briefing_id: req.params.id, user_id: req.user.id, rating, comment: req.body?.comment ?? null });
    return res.json({ ok: true });
  }

  const { data: owned } = await supabase().from("briefings").select("id").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { error } = await supabase()
    .from("feedback")
    .upsert({ briefing_id: req.params.id, user_id: req.user.id, rating, comment: req.body?.comment ?? null }, { onConflict: "briefing_id,user_id" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Memory: advisor preferences and notes ----------

app.get("/memory", requireUser, async (req, res) => {
  try {
    res.json(await listMemories(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/memory", requireUser, async (req, res) => {
  const kind = MEMORY_KINDS.includes(req.body?.kind) ? req.body.kind : "note";
  const ticker = req.body?.ticker ? String(req.body.ticker).trim().toUpperCase() : null;
  if (ticker && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return res.status(400).json({ error: "Invalid ticker" });

  const input = checkInput(req.body?.content, { maxLength: 500, label: "Memory" });
  if (!input.ok) {
    await logGuardrail({ userId: req.user.id, stage: "input", rule: input.rule, action: "blocked", detail: { where: "memory" } });
    return res.status(400).json({ error: input.reason });
  }
  if (input.flags.pii.length) {
    // Client PII never gets stored: it's redacted before saving
    await logGuardrail({ userId: req.user.id, stage: "input", rule: "pii", action: "redacted", detail: { where: "memory", types: input.flags.pii } });
  }
  try {
    const memory = await addMemory(req.user.id, { kind, ticker, content: input.text });
    res.status(201).json({ ...memory, redacted: input.flags.pii });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

app.delete("/memory/:id", requireUser, async (req, res) => {
  try {
    (await deleteMemory(req.user.id, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Filing Q&A: retrieval (embeddings) + conversation memory + guardrails + evaluation ----------

async function getBriefingRow(id, userId) {
  if (config.localMode) return localStore.getBriefingRow(id, userId);
  const { data, error } = await supabase().from("briefings").select("id, ticker, status, content, source_data").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

app.get("/briefings/:id/chat", requireUser, async (req, res) => {
  try {
    if (!(await getBriefingRow(req.params.id, req.user.id))) return res.status(404).json({ error: "Not found" });
    res.json(await chatHistory(req.params.id, req.user.id, 100));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/briefings/:id/ask", requireUser, async (req, res) => {
  const userId = req.user.id;
  const briefingId = req.params.id;
  try {
    const briefing = await getBriefingRow(briefingId, userId);
    if (!briefing) return res.status(404).json({ error: "Not found" });
    if (briefing.status !== "complete") return res.status(409).json({ error: "Wait for the briefing to finish before asking questions." });
    const sourceUrl = briefing.source_data?.latest10K ?? briefing.content?.sources?.latest10K;
    if (!sourceUrl) return res.status(422).json({ error: "No 10-K is available for this company, so there's nothing to search." });

    // Input guardrails
    const limit = await checkRateLimit(userId, "question");
    if (!limit.ok) {
      await logGuardrail({ userId, briefingId, stage: "input", rule: limit.rule, action: "blocked" });
      return res.status(429).json({ error: limit.reason });
    }
    const input = checkInput(req.body?.question, { maxLength: 500, label: "Question" });
    if (!input.ok) {
      await logGuardrail({ userId, briefingId, stage: "input", rule: input.rule, action: "blocked", detail: input.detail ?? null });
      return res.status(400).json({ error: input.reason });
    }
    if (input.flags.pii.length) await logGuardrail({ userId, briefingId, stage: "input", rule: "pii", action: "redacted", detail: { types: input.flags.pii } });
    if (input.flags.advice) await logGuardrail({ userId, briefingId, stage: "input", rule: "advice_request", action: "neutral_answer" });

    // Conversation memory: earlier turns help resolve follow-ups ("what about its debt?")
    const history = (await chatHistory(briefingId, userId, 12)).map(({ role, content }) => ({ role, content }));
    const lastQuestion = [...history].reverse().find((m) => m.role === "user")?.content;
    const query = lastQuestion && input.text.length < 80 ? `${lastQuestion}\n${input.text}` : input.text;

    // Retrieval: make sure the filing is indexed (older briefings may predate the index), then search
    const company = briefing.content.company;
    await indexFiling({ sourceUrl, ticker: briefing.ticker, cik: company?.cik });
    const passages = screenRetrieved(await searchFiling({ sourceUrl, query, k: 6 }));
    if (passages.some((p) => p.suspicious)) {
      await logGuardrail({ userId, briefingId, stage: "retrieval", rule: "prompt_injection", action: "flagged", detail: { chunks: passages.filter((p) => p.suspicious).map((p) => p.id) } });
    }

    const userMessage = await saveChatMessage({ briefing_id: briefingId, user_id: userId, role: "user", content: input.text, guardrail: input.flags });
    const answer = await qaAgent({ company, question: input.text, passages, history, seeksAdvice: input.flags.advice, briefingId });

    // Output guardrails
    const guarded = enforceOutput({ answer: answer.answer });
    const leaked = scanOutput(guarded.value.answer).pii;
    if (guarded.removed.length) await logGuardrail({ userId, briefingId, stage: "output", rule: "banned_phrase", action: "removed", detail: { sentences: guarded.removed } });
    if (leaked.length) await logGuardrail({ userId, briefingId, stage: "output", rule: "pii", action: "flagged", detail: { types: leaked } });

    const citations = [...new Set(answer.citations)]
      .filter((n) => n >= 1 && n <= passages.length)
      .map((n) => ({ n, section: passages[n - 1].section, excerpt: passages[n - 1].content.slice(0, 400), score: passages[n - 1].score }));
    const assistantMessage = await saveChatMessage({
      briefing_id: briefingId,
      user_id: userId,
      role: "assistant",
      content: guarded.value.answer,
      citations,
      guardrail: { removed: guarded.removed, pii: leaked, answered_from_filing: answer.answered_from_filing, retrieval_method: passages[0]?.method ?? null },
    });

    res.json({ question: userMessage, answer: assistantMessage });

    // Evaluate the answer after responding; the score is saved on the message
    waitUntil(
      evaluateAnswer({ question: input.text, answer, passages, briefingId })
        .then((evaluation) => updateChatMessage(assistantMessage.id, { evaluation }))
        .catch((err) => console.error("Answer evaluation failed:", err.message))
    );
  } catch (err) {
    console.error(`Q&A on briefing ${briefingId} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- Evaluation dashboard ----------

app.get("/evals/summary", requireUser, async (req, res) => {
  try {
    res.json(await evalSummary(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vercel imports the app as a function (api/index.js); everywhere else, run a normal server.
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`FinSight API listening on :${config.port}`);
    if (config.localMode) console.log("Local mode: no SUPABASE_URL, so auth is skipped and data is kept in memory.");
    const missing = missingResearchKeys();
    if (missing.length) console.warn(`Agents disabled until these are set: ${missing.join(", ")}`);
  });
}

export default app;
