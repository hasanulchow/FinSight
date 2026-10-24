import { runAgent } from "../lib/llm.js";
import { HOUSE_RULES, obj, str, arr } from "./schema.js";

const schema = obj({
  headline: str("One sentence on where the stock is trading today"),
  commentary: str("2-4 sentences on today's move, position in the 52-week range and valuation context"),
  key_stats: arr(str("A notable stat, e.g. 'Trading 8% below its 52-week high'"), "3-5 notable stats"),
});

export function marketAnalyst({ company, quote, briefingId }) {
  return runAgent({
    agent: "market_analyst",
    briefingId,
    effort: "low",
    schema,
    system: `${HOUSE_RULES}\nYou are the Market Data Analyst. You interpret the current quote and key statistics.`,
    prompt: `Company: ${company.name} (${company.ticker})\n\nQuote and key stats (JSON):\n${JSON.stringify(quote, null, 2)}`,
  });
}
