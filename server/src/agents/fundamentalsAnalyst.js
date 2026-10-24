import { runAgent } from "../lib/llm.js";
import { HOUSE_RULES, obj, str, arr, oneOf } from "./schema.js";

const schema = obj({
  summary: str("2-3 sentences on overall financial health"),
  trends: arr(
    obj({
      metric: str("e.g. Revenue, Net income, Diluted EPS"),
      direction: oneOf(["up", "down", "flat", "mixed"], "Multi-year direction"),
      detail: str("One sentence with the actual figures and % change, computed from the data"),
    }),
    "One entry per metric with data"
  ),
  strengths: arr(str("A financial strength supported by the data"), "1-3 items"),
  concerns: arr(str("A financial concern supported by the data"), "1-3 items"),
});

export function fundamentalsAnalyst({ company, financials, briefingId }) {
  return runAgent({
    agent: "fundamentals_analyst",
    briefingId,
    schema,
    system: `${HOUSE_RULES}\nYou are the Fundamentals Analyst. You analyze multi-year financials reported to the SEC (XBRL). Values are in USD (EPS in USD per share). Format large numbers readably, e.g. $391.0B.`,
    prompt: `Company: ${company.name} (${company.ticker})\n\nAnnual financials by calendar year (JSON, from SEC XBRL):\n${JSON.stringify(financials, null, 2)}`,
  });
}
