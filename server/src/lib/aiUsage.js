import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// Per-user AI cost tracking. requireUser (and jobs) run each request inside a context that
// carries the user id, so every Claude call can be attributed without threading ids through.

const context = new AsyncLocalStorage();

/** Runs `fn` with AI usage attributed to `userId`. */
export const withAiUser = (userId, fn) => context.run({ userId }, fn);

// USD per million tokens. Defaults are Claude Sonnet 5.5 list prices; override for other models.
const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const price = (model) => {
  const p = PRICES[model] ?? PRICES[config.llmModel] ?? PRICES["claude-sonnet-5-5"];
  return {
    input: Number(process.env.AI_INPUT_USD_PER_MTOK ?? p.input),
    output: Number(process.env.AI_OUTPUT_USD_PER_MTOK ?? p.output),
    cacheRead: p.cacheRead,
  };
};

export function costUsd(model, usage) {
  const p = price(model);
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25;
  return (input * p.input + (usage.cache_read_input_tokens ?? 0) * p.cacheRead + (usage.output_tokens ?? 0) * p.output) / 1e6;
}

/** Records one Claude response's token usage against the current user (no-op outside a user context). */
export async function recordAiUsage(response, agent) {
  const userId = context.getStore()?.userId;
  if (!userId || !response?.usage) return;
  const row = {
    user_id: userId,
    agent,
    model: response.model,
    input_tokens: response.usage.input_tokens ?? 0,
    output_tokens: response.usage.output_tokens ?? 0,
    cost_usd: Number(costUsd(response.model, response.usage).toFixed(6)),
  };
  try {
    if (config.localMode) localStore.insert("ai_usage", row);
    else {
      const { error } = await supabase().from("ai_usage").insert(row);
      if (error) console.error("ai_usage insert failed:", error.message);
    }
  } catch (err) {
    console.error("ai_usage insert failed:", err.message);
  }
}
