import { runAgent } from "../lib/llm.js";
import { config } from "../config.js";
import { obj, str, int, arr } from "./schema.js";
import { scanOutput } from "../lib/guardrails.js";
import { narrativeOf } from "../lib/grounding.js";

const score = (what) => int(`1-5 score for ${what} (5 = excellent)`);

const schema = obj({
  faithfulness: score("faithfulness: every claim is supported by the source data, no invented facts or numbers"),
  completeness: score("completeness: covers price, business, financials, outlook, risks and recent filings"),
  compliance: score("compliance: no recommendations, price predictions, guarantees or personalized advice"),
  clarity: score("clarity: an advisor can get up to speed in under two minutes"),
  rationale: str("2-4 sentences explaining the scores"),
  unsupported_claims: arr(str("A claim in the briefing not supported by the source data"), "Empty if none"),
});

/** LLM-as-judge: grades the finished briefing against the raw source data it was built from. */
export function evaluator({ briefing, sourceData, briefingId }) {
  return runAgent({
    agent: "evaluator",
    briefingId,
    model: config.evalModel,
    schema,
    system: `You are a strict evaluator of AI-generated stock briefings for financial advisors. Compare the briefing with the source data and grade it. Be critical: reserve 5 for work with no problems. Check figures against the source data.`,
    prompt: `<source_data>\n${JSON.stringify(sourceData, null, 2)}\n</source_data>\n\n<briefing>\n${JSON.stringify(briefing, null, 2)}\n</briefing>`,
  });
}

/** Deterministic checks that run on every briefing, free. `grounding` comes from lib/grounding.js. */
export function deterministicChecks(content, grounding = {}) {
  const scan = scanOutput(narrativeOf(content));
  const checks = {
    has_disclaimer: Boolean(content.disclaimer),
    no_banned_phrases: scan.banned.length === 0,
    banned_hits: scan.banned,
    no_pii: scan.pii.length === 0,
    evidence_verified: grounding.evidence?.rate == null ? true : grounding.evidence.rate >= 0.8,
    numbers_grounded: grounding.numbers?.rate == null ? true : grounding.numbers.rate >= 0.8,
    has_quote: Boolean(content.snapshot?.price),
    quote_fresh: content.snapshot?.asOf ? Date.now() - Date.parse(content.snapshot.asOf) < 4 * 24 * 3600 * 1000 : false,
    has_financials: Object.values(content.financials ?? {}).some((s) => s.length > 0),
    has_risks: (content.risks?.top_risks?.length ?? 0) > 0,
    has_summary: Boolean(content.executive_summary),
  };
  const boolKeys = Object.keys(checks).filter((k) => typeof checks[k] === "boolean");
  checks.passed = boolKeys.filter((k) => checks[k]).length;
  checks.total = boolKeys.length;
  return checks;
}
