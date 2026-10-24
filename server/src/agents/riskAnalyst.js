import { runAgent } from "../lib/llm.js";
import { HOUSE_RULES, obj, str, arr, oneOf } from "./schema.js";

const schema = obj({
  overview: str("1-2 sentences on the overall risk profile described in the filing"),
  top_risks: arr(
    obj({
      title: str("Short risk name"),
      category: oneOf(["market", "operational", "financial", "regulatory", "legal", "competitive", "macroeconomic", "technology", "other"], "Risk category"),
      summary: str("1-2 sentences in plain language"),
      evidence: str("A short verbatim excerpt (under 30 words) from the Risk Factors text that supports this risk"),
    }),
    "The 5 most material risks"
  ),
});

export function riskAnalyst({ company, riskFactors, briefingId }) {
  const text = riskFactors
    ? `${riskFactors.text}${riskFactors.truncated ? `\n[Section truncated: showing ${riskFactors.text.length} of ${riskFactors.totalChars} characters]` : ""}`
    : "Not available";
  return runAgent({
    agent: "risk_analyst",
    briefingId,
    schema,
    system: `${HOUSE_RULES}\nYou are the Risk Analyst. You identify the most material risks from Item 1A (Risk Factors) of the latest 10-K. Prioritize company-specific risks over boilerplate. If the text is "Not available", return an empty top_risks list and say so in the overview.`,
    prompt: `Company: ${company.name} (${company.ticker})\n\n<10k_item_1a_risk_factors>\n${text}\n</10k_item_1a_risk_factors>`,
  });
}
