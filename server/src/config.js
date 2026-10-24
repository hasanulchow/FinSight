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
};
