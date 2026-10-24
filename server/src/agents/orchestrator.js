import { lookupCompany, getRecentFilings, getFinancials, get10KSections } from "../tools/sec.js";
import { getQuote } from "../tools/quote.js";
import { marketAnalyst } from "./marketAnalyst.js";
import { fundamentalsAnalyst } from "./fundamentalsAnalyst.js";
import { filingsAnalyst } from "./filingsAnalyst.js";
import { riskAnalyst } from "./riskAnalyst.js";
import { briefingWriter } from "./briefingWriter.js";
import { complianceReviewer, DISCLAIMER } from "./complianceReviewer.js";
import { evaluator, deterministicChecks } from "./evaluator.js";

/**
 * Orchestrator: gathers data, then runs the agents.
 *
 *   tools (parallel) -> market | fundamentals | filings | risk (parallel)
 *   -> briefing writer -> compliance reviewer -> evaluator
 *
 * `progress(step)` is called as each stage starts so the app can show live status.
 */
export async function runResearch({ ticker, briefingId = null, progress = async () => {} }) {
  await progress("Looking up company");
  const company = await lookupCompany(ticker);
  if (!company) throw new Error(`Unknown ticker "${ticker}". Only SEC-registered US companies are supported.`);

  // 1. Data gathering (tools, no LLM)
  await progress("Fetching quote, financials and SEC filings");
  const [quote, filingData, financials] = await Promise.all([
    getQuote(company.ticker),
    getRecentFilings(company.cik),
    getFinancials(company.cik),
  ]);
  const latest10K = filingData.latest10K;
  await progress("Reading the latest 10-K");
  const sections = latest10K ? await get10KSections(latest10K.url).catch(() => null) : null;

  // 2. Specialist agents in parallel
  await progress("Analysts at work: market, fundamentals, filings, risks");
  const [market, fundamentals, filings, risks] = await Promise.all([
    marketAnalyst({ company, quote, briefingId }),
    fundamentalsAnalyst({ company, financials, briefingId }),
    filingsAnalyst({ company, filings: filingData.filings, sections, briefingId }),
    riskAnalyst({ company, riskFactors: sections?.riskFactors, briefingId }),
  ]);

  // 3. Synthesis, then compliance review
  await progress("Writing the briefing");
  const draft = await briefingWriter({ company, analyses: { market, fundamentals, filings, risks }, briefingId });

  await progress("Compliance review");
  const reviewed = await complianceReviewer({ draft, briefingId });

  const content = {
    company: { ...company, industry: quote.industry, exchange: quote.exchange, logo: quote.logo },
    snapshot: quote,
    financials, // straight from SEC XBRL, never LLM-generated
    ...reviewed.revised,
    market,
    fundamentals,
    business: filings,
    risks,
    sources: { latest10K: latest10K?.url ?? null, filings: filingData.filings },
    compliance: { issues_found: reviewed.issues_found },
    disclaimer: DISCLAIMER,
  };

  // 4. Evaluation: deterministic checks + LLM-as-judge against the raw source data
  await progress("Evaluating quality");
  const sourceData = { quote, financials, filings: filingData.filings, tenK: sections };
  const checks = deterministicChecks(content);
  const judge = await evaluator({ briefing: content, sourceData, briefingId });

  const clamp = (n) => Math.min(5, Math.max(1, Math.round(n)));
  const scores = {
    faithfulness: clamp(judge.faithfulness),
    completeness: clamp(judge.completeness),
    compliance: clamp(judge.compliance),
    clarity: clamp(judge.clarity),
  };
  const evaluation = {
    ...scores,
    overall: Number((Object.values(scores).reduce((a, b) => a + b, 0) / 4).toFixed(2)),
    rationale: judge.rationale,
    issues: judge.unsupported_claims,
    checks,
  };

  return { company, sourceData: { quote, financials, filings: filingData.filings, latest10K: latest10K?.url ?? null }, content, evaluation };
}
