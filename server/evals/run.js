// Offline eval: runs the full agent pipeline on a fixed set of tickers and prints a score table.
// Usage: npm run eval            (all tickers in golden.json)
//        npm run eval -- AAPL MSFT
// Each ticker costs real API usage (8 Claude calls).

import fs from "node:fs";
import { runResearch } from "../src/agents/orchestrator.js";

const golden = JSON.parse(fs.readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
const args = process.argv.slice(2).map((t) => t.toUpperCase());
const cases = args.length
  ? args.map((ticker) => golden.find((c) => c.ticker === ticker) ?? { ticker, expected_risk_keywords: [] })
  : golden;

const rows = [];
for (const c of cases) {
  const started = Date.now();
  process.stdout.write(`Running ${c.ticker}... `);
  try {
    const { content, evaluation } = await runResearch({ ticker: c.ticker });

    // Reference check: did the risk analyst surface the risks we expect for this company?
    const riskText = JSON.stringify(content.risks).toLowerCase();
    const hits = c.expected_risk_keywords.filter((k) => riskText.includes(k.toLowerCase()));
    const riskRecall = c.expected_risk_keywords.length ? hits.length / c.expected_risk_keywords.length : null;

    rows.push({
      ticker: c.ticker,
      faith: evaluation.faithfulness,
      complete: evaluation.completeness,
      comply: evaluation.compliance,
      clarity: evaluation.clarity,
      overall: evaluation.overall,
      checks: `${evaluation.checks.passed}/${evaluation.checks.total}`,
      risk_recall: riskRecall === null ? "-" : `${Math.round(riskRecall * 100)}%`,
      secs: Math.round((Date.now() - started) / 1000),
    });
    console.log("done");
  } catch (err) {
    rows.push({ ticker: c.ticker, error: err.message });
    console.log(`failed: ${err.message}`);
  }
}

console.table(rows);
const ok = rows.filter((r) => !r.error);
if (ok.length) {
  const avg = (k) => (ok.reduce((s, r) => s + r[k], 0) / ok.length).toFixed(2);
  console.log(`Averages - faithfulness ${avg("faith")}, completeness ${avg("complete")}, compliance ${avg("comply")}, clarity ${avg("clarity")}, overall ${avg("overall")}`);
}

fs.mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
const out = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
fs.writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`Saved ${out.pathname}`);
