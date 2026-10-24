import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see server/.env.example)`);
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  llmModel: process.env.LLM_MODEL || "claude-sonnet-5-5",
  evalModel: process.env.EVAL_MODEL || process.env.LLM_MODEL || "claude-sonnet-5-5",
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  finnhubKey: () => required("FINNHUB_API_KEY"),
  secUserAgent: () => required("SEC_USER_AGENT"),
  // Embeddings (optional): without a key, filing search falls back to keyword matching
  voyageKey: process.env.VOYAGE_API_KEY || null,
  embeddingModel: process.env.EMBEDDING_MODEL || "voyage-4",
  embeddingDimensions: 1024, // must match vector(1024) in supabase/002_memory_guardrails_embeddings.sql
  // Guardrails: per-user limits over a rolling hour
  briefingsPerHour: Number(process.env.BRIEFINGS_PER_HOUR || 20),
  questionsPerHour: Number(process.env.QUESTIONS_PER_HOUR || 60),
  // No Supabase on a dev machine: skip auth and keep data in memory (lib/localStore.js).
  // Never on Vercel or in production, so a missing env var can't open up a deployed API.
  localMode: !process.env.SUPABASE_URL && !process.env.VERCEL && process.env.NODE_ENV !== "production",
};

// Keys the research pipeline can't run without (checked before a briefing starts).
export function missingResearchKeys() {
  return ["ANTHROPIC_API_KEY", "FINNHUB_API_KEY", "SEC_USER_AGENT"].filter((name) => !process.env[name]);
}

// Every request is this user in local mode.
export const LOCAL_USER = { id: "00000000-0000-0000-0000-000000000001", email: "local@finsight.dev" };
