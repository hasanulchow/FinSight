import { lookupCompany, getRecentFilings, getFinancials, get10KSections } from "../tools/sec.js";
import { getQuote } from "../tools/quote.js";
import { marketAnalyst } from "./marketAnalyst.js";
import { fundamentalsAnalyst } from "./fundamentalsAnalyst.js";
import { filingsAnalyst } from "./filingsAnalyst.js";
import { riskAnalyst } from "./riskAnalyst.js";
import { briefingWriter } from "./briefingWriter.js";
import { complianceReviewer, DISCLAIMER } from "./complianceReviewer.js";
import { evaluator, deterministicChecks } from "./evaluator.js";
import { memoriesForTicker, previousBriefing } from "../lib/memory.js";
import { indexFiling } from "../lib/retrieval.js";
import { enforceOutput, logGuardrail } from "../lib/guardrails.js";
import { evidenceMatch, numericGrounding } from "../lib/grounding.js";
import { embeddingsEnabled } from "../lib/embeddings.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { technicalSnapshot, chartSeries } from "../lib/indicators.js";
import { technicalAnalyst } from "./technicalAnalyst.js";

/**
 * Orchestrator: gathers data, then runs the agents.
 *
 *   tools (parallel) + memory -> market | fundamentals | filings | risk | filing index (parallel)
 *   -> briefing writer (with memory) -> compliance reviewer -> output guardrail -> evaluation
 *
 * `progress(step)` is called as each stage starts so the app can show live status.
 * `userId` enables memory and guardrail logging; offline evals run without it.
 */
export async function runResearch({ ticker, briefingId = null, userId = null, progress = async () => {} }) {
  await progress("Looking up company");
  const company = await lookupCompany(ticker);
  if (!company) throw new Error(`Unknown ticker "${ticker}". Only SEC-registered US companies are supported.`);

  // 1. Data gathering (tools, no LLM) + memory recall
  await progress("Fetching quote, financials and SEC filings");
  const [quote, filingData, financials, memories, previous, bars] = await Promise.all([
    getQuote(company.ticker),
    getRecentFilings(company.cik),
    getFinancials(company.cik),
    userId ? memoriesForTicker(userId, company.ticker) : [],
    userId ? previousBriefing(userId, company.ticker, briefingId) : null,
    // Technical analysis is optional: without a price-data key (or on a rate limit) the briefing skips it
    pricesEnabled() ? getDailyBars(company.ticker).catch((err) => (console.error(`Price history for ${company.ticker}:`, err.message), null)) : null,
  ]);
  const technical = bars?.length ? technicalSnapshot(bars) : null;
  const latest10K = filingData.latest10K;
  await progress("Reading the latest 10-K");
  const sections = latest10K ? await get10KSections(latest10K.url).catch(() => null) : null;

  // 2. Specialist agents in parallel, while the 10-K is chunked and embedded for follow-up questions
  await progress(`Analysts at work: market, fundamentals, filings, risks${technical ? ", technicals" : ""}`);
  const indexing = indexFiling({ sourceUrl: latest10K?.url, ticker: company.ticker, cik: company.cik, sections }).catch((err) => {
    console.error(`Indexing ${latest10K?.url} failed:`, err.message); // Q&A falls back to indexing on demand
    return 0;
  });
  const [market, fundamentals, filings, risks, technicalView, indexedChunks] = await Promise.all([
    marketAnalyst({ company, quote, briefingId }),
    fundamentalsAnalyst({ company, financials, briefingId }),
    filingsAnalyst({ company, filings: filingData.filings, sections, briefingId }),
    riskAnalyst({ company, riskFactors: sections?.riskFactors, briefingId }),
    technical ? technicalAnalyst({ company, snapshot: technical, briefingId }) : null,
    indexing,
  ]);

  // 3. Synthesis (with advisor memory and the previous briefing), then compliance review
  await progress("Writing the briefing");
  const analyses = { market, fundamentals, filings, risks, ...(technicalView && { technicals: { rating: technical.rating, ...technicalView } }) };
  const draft = await briefingWriter({ company, analyses, memories, previous, briefingId });

  await progress("Compliance review");
  const reviewed = await complianceReviewer({ draft, briefingId });

  // 4. Output guardrail: drop any sentence that still breaks the rules (risk evidence quotes are verbatim, so untouched)
  const guarded = enforceOutput({
    revised: reviewed.revised,
    market,
    fundamentals,
    business: filings,
    risks: { overview: risks.overview, summaries: risks.top_risks.map((r) => r.summary) },
    technical: technicalView,
  });
  const g = guarded.value;
  if (guarded.removed.length && userId) {
    await logGuardrail({ userId, briefingId, stage: "output", rule: "banned_phrase", action: "removed", detail: { sentences: guarded.removed } });
  }

  const content = {
    company: { ...company, industry: quote.industry, exchange: quote.exchange, logo: quote.logo },
    snapshot: quote,
    financials, // straight from SEC XBRL, never LLM-generated
    ...g.revised,
    market: g.market,
    fundamentals: g.fundamentals,
    business: g.business,
    risks: { overview: g.risks.overview, top_risks: risks.top_risks.map((r, i) => ({ ...r, summary: g.risks.summaries[i] })) },
    // Indicator values and chart come from code; only `analysis` is written by the Technical Analyst
    technicals: technical ? { snapshot: technical, chart: chartSeries(bars), analysis: g.technical } : null,
    sources: { latest10K: latest10K?.url ?? null, filings: filingData.filings },
    compliance: { issues_found: reviewed.issues_found, guardrail_removed: guarded.removed },
    memory: { advisor_memories_used: memories.length, previous_briefing_date: previous?.date ?? null },
    retrieval: { indexed_chunks: indexedChunks, method: embeddingsEnabled() ? "vector" : "keyword" },
    disclaimer: DISCLAIMER,
  };

  // 5. Evaluation: grounding metrics + deterministic checks + LLM-as-judge against the raw source data
  await progress("Evaluating quality");
  const sourceData = { quote, financials, filings: filingData.filings, tenK: sections, technicals: technical };
  const grounding = {
    evidence: evidenceMatch(risks.top_risks, sections?.riskFactors?.text),
    numbers: numericGrounding(content, sourceData),
  };
  const checks = deterministicChecks(content, grounding);
  // The judge doesn't need 180 chart points: it grades the analysis against the snapshot in sourceData
  const forJudge = content.technicals ? { ...content, technicals: { analysis: content.technicals.analysis } } : content;
  const judge = await evaluator({ briefing: forJudge, sourceData, briefingId });

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
    grounding,
  };

  return { company, sourceData: { quote, financials, filings: filingData.filings, latest10K: latest10K?.url ?? null }, content, evaluation };
}
