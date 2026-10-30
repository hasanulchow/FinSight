import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { recordAiUsage } from "./aiUsage.js";
import { reportError } from "./monitoring.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

/**
 * Turns Anthropic API failures into errors that are safe to show users (503, plain message),
 * and reports the ones the operator must act on (billing, keys) to monitoring.
 */
export function friendlyAiError(err) {
  if (!(err instanceof Anthropic.APIError)) return err;
  let message = "The AI service is busy right now. Please try again in a minute.";
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    message = "The AI service isn't available right now. We're on it.";
    reportError(err, { where: "anthropic", kind: "auth" });
  } else if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    message = "The AI service isn't available right now. We're on it.";
    reportError(err, { where: "anthropic", kind: "billing" });
    console.error("ANTHROPIC CREDITS EXHAUSTED: top up at console.anthropic.com (Plans & Billing)");
  } else if (err instanceof Anthropic.BadRequestError) {
    message = "The AI couldn't process that request.";
    reportError(err, { where: "anthropic", kind: "bad_request" });
  }
  return Object.assign(new Error(message), { status: 503, cause: err });
}

/**
 * Runs one agent: a single Claude call that must return JSON matching `schema`.
 * Every call is logged to agent_logs (tokens, latency) for tracing and evaluation.
 */
export async function runAgent({ agent, system, prompt, schema, briefingId, model = config.llmModel, effort = "medium" }) {
  const started = Date.now();
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort, format: { type: "json_schema", schema } },
      // Re-run on Anthropic's recommended fallback model if a safety classifier declines
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`${agent}: model declined (${response.stop_details?.category ?? "unknown"})`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error(`${agent}: output hit max_tokens`);
    }

    await recordAiUsage(response, agent);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const output = JSON.parse(text);

    await logAgent({
      briefingId, agent, model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      latency_ms: Date.now() - started,
    });
    return output;
  } catch (err) {
    await logAgent({ briefingId, agent, model, latency_ms: Date.now() - started, status: "error", error: String(err.message || err) });
    throw friendlyAiError(err);
  }
}

async function logAgent({ briefingId, ...row }) {
  if (!briefingId) return; // offline eval runs without a briefing row
  if (config.localMode) return localStore.insertAgentLog({ briefing_id: briefingId, ...row });
  const { error } = await supabase().from("agent_logs").insert({ briefing_id: briefingId, ...row });
  if (error) console.error("agent_logs insert failed:", error.message);
}
