import { runAgent } from "../lib/llm.js";
import { obj, str, arr, oneOf } from "./schema.js";

const schema = obj({
  earnings_preview: str("2-3 sentences: when the next report is and what investors will likely watch, based on the data. 'No upcoming date found' if none"),
  earnings_recap: str("3-4 sentences on the latest earnings release: headline results, segments, guidance or tone, citing figures from it. 'Not available' if no release"),
  surprise_trend: str("1-2 sentences on how actual EPS compared with estimates over recent quarters"),
  insider_summary: str("2-3 sentences on insider activity: who traded, open-market buys vs sells, and that routine sales (planned or tax-related) are common"),
  insider_signal: oneOf(["net_buying", "net_selling", "mixed", "routine_only", "none"], "Overall read of open-market insider activity, from the computed stats"),
  watch_items: arr(str("Something specific to watch around the next report or insider activity"), "2-4 items"),
});

/** Earnings & smart-money analyst: interprets the earnings calendar, EPS surprises, the latest release and Form 4 trades. */
export function eventsAnalyst({ company, events }) {
  const { release, ...rest } = events;
  return runAgent({
    agent: "events_analyst",
    effort: "low",
    schema,
    system: `You explain upcoming earnings, recent results and insider trading for ${company.name} (${company.ticker}) to retail investors.
Use only the data provided; every figure you cite must appear in it. Neutral and educational: no buy/sell calls, no predictions of results or prices.
Insider sales are often routine (planned 10b5-1 sales, tax withholding); say so when relevant rather than implying a negative signal.`,
    prompt: `Data (JSON):\n${JSON.stringify(rest, null, 2)}\n\n<earnings_release filed="${release?.filingDate ?? "n/a"}">\n${release?.text ?? "Not available"}\n</earnings_release>`,
  });
}
