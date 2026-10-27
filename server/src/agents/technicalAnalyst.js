import { runAgent } from "../lib/llm.js";
import { obj, str, arr } from "./schema.js";

const schema = obj({
  summary: str("2-3 sentences: what the chart shows right now, in plain English"),
  trend: str("1-2 sentences on the trend, using the moving averages and trend structure"),
  momentum: str("1-2 sentences on momentum (RSI, MACD, stochastic)"),
  volatility: str("1-2 sentences on volatility and volume (ATR, Bollinger Bands, volume ratio)"),
  key_levels: str("1-2 sentences naming the nearest support and resistance levels from the data"),
  signals_explained: arr(obj({ signal: str("The signal, as given"), meaning: str("What traders usually read into it, in one sentence") }), "One entry per signal in the data, max 6"),
  bullish_scenario: str("What would strengthen the bullish case, referring to specific levels or indicators"),
  bearish_scenario: str("What would strengthen the bearish case, referring to specific levels or indicators"),
  beginner_tip: str("One short educational tip about an indicator that matters most on this chart"),
});

/**
 * Technical Analyst: explains indicator values computed in code (lib/indicators.js).
 * It never computes numbers itself and never tells the user to buy or sell.
 */
export function technicalAnalyst({ company, snapshot, briefingId }) {
  return runAgent({
    agent: "technical_analyst",
    briefingId,
    effort: "low",
    schema,
    system: `You are the Technical Analyst in a stock research app for retail traders and investors.
You explain a chart using ONLY the indicator values, levels and signals provided. Every number you mention must appear in the data.
Rules:
- Describe what the chart shows and what traders typically watch. This is education, not advice.
- Never tell the reader to buy, sell, enter or exit a position, and never give price targets or predictions.
- Use "traders often read this as..." language rather than certainty. Plain English; explain jargon briefly.
- The overall rating in the data was computed by rules; describe it, don't change it.`,
    prompt: `Company: ${company.name} (${company.ticker})\n\nTechnical snapshot (JSON, daily bars):\n${JSON.stringify(snapshot, null, 2)}`,
  });
}
