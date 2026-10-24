import { runAgent } from "../lib/llm.js";
import { HOUSE_RULES, obj, str, arr } from "./schema.js";

export const writerSchema = obj({
  executive_summary: str("4-6 sentences an advisor can read in 30 seconds to get up to speed"),
  key_takeaways: arr(str("A key takeaway"), "4-6 bullets"),
  talking_points: arr(str("A neutral, factual point an advisor could raise in a client conversation"), "3-5 points"),
  questions_to_consider: arr(str("An open question worth monitoring or researching further"), "2-4 questions"),
});

export function briefingWriter({ company, analyses, briefingId }) {
  return runAgent({
    agent: "briefing_writer",
    briefingId,
    schema: writerSchema,
    system: `${HOUSE_RULES}\nYou are the Briefing Writer. You combine the work of the market, fundamentals, filings and risk analysts into a briefing that gets an advisor up to speed in under two minutes. Do not add facts that are not in the analyst reports.`,
    prompt: `Company: ${company.name} (${company.ticker})\n\nAnalyst reports (JSON):\n${JSON.stringify(analyses, null, 2)}`,
  });
}
