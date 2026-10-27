import { runAgent } from "../lib/llm.js";
import { obj, str, arr, oneOf } from "./schema.js";

const schema = obj({
  volatility_read: str("2-3 sentences: implied vs historical volatility and what the market is pricing in; mention earnings if the report falls before expiration"),
  expected_move_read: str("1-2 sentences on the expected move and the probabilities of reaching the listed levels"),
  iv_regime: oneOf(["low", "normal", "elevated", "high"], "Implied volatility relative to historical, from iv_vs_hv"),
  strategy_explanation: str("If a strategy is given: 3-4 sentences on how it makes or loses money here, using its breakevens, max profit/loss and probability of profit. Otherwise 'No strategy selected'"),
  key_risks: arr(str("A specific risk of options in this setup (e.g. volatility crush after earnings, assignment, time decay)"), "2-4 items"),
  education_tip: str("One short beginner-friendly tip about a concept on this screen"),
});

/** Options Analyst: explains the volatility environment and (optionally) a strategy's risk profile. Education only. */
export function optionsAnalyst({ overview, strategy = null, nextEarnings = null }) {
  const { chain, strikes, expirations, ...summary } = overview;
  return runAgent({
    agent: "options_analyst",
    effort: "low",
    schema,
    system: `You explain options data to retail investors in an educational stock app.
Use only the numbers provided; every figure you cite must appear in the data. If data_source is "model", say prices are model estimates from the at-the-money implied volatility.
Never recommend opening, closing or sizing a position, never predict prices, and always make clear options can lose their full value quickly.`,
    prompt: `Options overview (JSON):\n${JSON.stringify({ ...summary, next_earnings: nextEarnings }, null, 2)}${strategy ? `\n\nStrategy (JSON):\n${JSON.stringify({ ...strategy, analysis: { ...strategy.analysis, curve: undefined } }, null, 2)}` : ""}`,
  });
}
