import { lookupCompany, getFilingIndex, getSharesOutstanding, getFinancials, getRecentFilings, get10KSections } from "../tools/sec.js";
import { getQuoteLite } from "../tools/quote.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { technicalSnapshot } from "./indicators.js";
import { cached } from "./cache.js";

// Red-flag scanner ("scam radar"): deterministic checks on SEC filings and market data that
// often precede blow-ups or show up in pump-and-dumps. Every flag cites its evidence.
// Checks: dilution, offerings, going-concern language, exchange deficiency notices, auditor
// changes, late filings, cash runway, penny/micro-cap status, extreme volatility.

const round = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const daysAgo = (date) => (Date.now() - Date.parse(date)) / 86_400_000;
const SEVERITY_POINTS = { high: 3, medium: 2, low: 1 };

async function compute(ticker) {
  const company = await lookupCompany(ticker);
  const flags = [];
  const add = (id, severity, title, evidence) => flags.push({ id, severity, title, evidence });

  const [quote, bars] = await Promise.all([getQuoteLite(ticker).catch(() => null), pricesEnabled() ? getDailyBars(ticker).catch(() => null) : null]);
  const tech = bars?.length ? technicalSnapshot(bars) : null;

  if (quote) {
    if (quote.price < 1) add("sub_dollar", "high", "Trades below $1", `Last price $${quote.price}. Sub-$1 stocks risk delisting and are common pump-and-dump targets.`);
    else if (quote.price < 5) add("penny_stock", "medium", "Penny-stock price range", `Last price $${quote.price}, under $5.`);
    if (quote.marketCapMillions != null && quote.marketCapMillions < 300) add("micro_cap", quote.marketCapMillions < 50 ? "high" : "medium", "Micro-cap company", `Market cap about $${round(quote.marketCapMillions, 0)}M. Small, thinly traded stocks move violently on little news.`);
  }
  if (tech?.atr_pct >= 8) add("extreme_volatility", "medium", "Extreme volatility", `Average daily range (ATR) is ${tech.atr_pct}% of the price.`);

  if (company) {
    const [index, shares, fin] = await Promise.all([getFilingIndex(company.cik).catch(() => null), getSharesOutstanding(company.cik).catch(() => []), getFinancials(company.cik).catch(() => null)]);

    // Dilution: shares outstanding growth over ~1 year
    if (shares.length >= 2) {
      const latest = shares[shares.length - 1];
      const yearAgo = [...shares].reverse().find((s) => daysAgo(s.end) - daysAgo(latest.end) >= 300) ?? shares[0];
      const growth = (latest.shares / yearAgo.shares - 1) * 100;
      if (growth >= 25) add("heavy_dilution", "high", "Heavy share dilution", `Shares outstanding rose ${round(growth)}% from ${yearAgo.end} to ${latest.end}.`);
      else if (growth >= 10) add("dilution", "medium", "Share dilution", `Shares outstanding rose ${round(growth)}% from ${yearAgo.end} to ${latest.end}.`);
    }

    if (index) {
      const recent = (days) => index.filings.filter((f) => daysAgo(f.filingDate) <= days);
      const offerings = recent(180).filter((f) => /^(S-1|S-3|F-1|F-3|424B\d?)(\/A)?$/.test(f.form));
      if (offerings.length >= 3) add("frequent_offerings", "high", "Frequent stock offerings", `${offerings.length} registration/prospectus filings (S-1, S-3, 424B) in the last 6 months.`);
      else if (offerings.length) add("recent_offering", "low", "Recent stock offering", `${offerings.length} offering-related filing(s) in the last 6 months (${offerings[0].form} on ${offerings[0].filingDate}).`);
      const deficiency = recent(365).filter((f) => f.form.startsWith("8-K") && f.items.includes("3.01"));
      if (deficiency.length) add("listing_deficiency", "high", "Exchange listing deficiency notice", `8-K Item 3.01 (notice of delisting or failure to meet listing rules) filed ${deficiency[0].filingDate}.`);
      const auditor = recent(730).filter((f) => f.form.startsWith("8-K") && f.items.includes("4.01"));
      if (auditor.length) add("auditor_change", "medium", "Change of auditor", `8-K Item 4.01 (change in certifying accountant) filed ${auditor[0].filingDate}.`);
      const restatement = recent(730).filter((f) => f.form.startsWith("8-K") && f.items.includes("4.02"));
      if (restatement.length) add("restatement", "high", "Prior financials can't be relied on", `8-K Item 4.02 (non-reliance on previously issued financial statements) filed ${restatement[0].filingDate}.`);
      const late = recent(730).filter((f) => /^NT 10-[KQ]/.test(f.form));
      if (late.length) add("late_filings", "medium", "Late SEC filings", `${late.length} notice(s) of late filing (${late.map((f) => `${f.form} ${f.filingDate}`).slice(0, 3).join(", ")}).`);
      const reverseSplit = recent(730).filter((f) => f.form.startsWith("8-K") && f.items.includes("5.03"));
      if (reverseSplit.length >= 2) add("charter_changes", "low", "Repeated charter/bylaw amendments", `${reverseSplit.length} 8-K Item 5.03 filings in two years (often reverse splits or share authorizations).`);
    }

    // Cash runway: negative operating cash flow vs cash on hand
    const ocf = fin?.operatingCashFlow?.at(-1)?.value;
    const cash = fin?.cash?.at(-1)?.value;
    if (ocf != null && ocf < 0 && cash != null) {
      const months = (cash / Math.abs(ocf)) * 12;
      if (months < 12) add("short_runway", months < 6 ? "high" : "medium", "Short cash runway", `Cash of $${round(cash / 1e6, 0)}M covers about ${round(months)} months at last year's operating cash burn ($${round(Math.abs(ocf) / 1e6, 0)}M).`);
    }

    // Going-concern language in the latest 10-K
    const { latest10K } = await getRecentFilings(company.cik, 1).catch(() => ({}));
    if (latest10K) {
      const sections = await get10KSections(latest10K.url).catch(() => null);
      const text = [sections?.riskFactors?.text, sections?.mdna?.text, sections?.business?.text].filter(Boolean).join("\n");
      const m = text.match(/[^.]{0,160}substantial doubt[^.]{0,120}going concern[^.]{0,80}\./i);
      if (m) add("going_concern", "high", "Going-concern warning", `The ${latest10K.filingDate} 10-K says: “${m[0].trim().slice(0, 260)}”`);
    }
  } else {
    add("not_sec_registered", "medium", "No SEC filings found", "This ticker isn't in the SEC's company list, so its financials and disclosures can't be checked.");
  }

  const score = flags.reduce((s, f) => s + SEVERITY_POINTS[f.severity], 0);
  const level = score >= 6 || flags.some((f) => f.severity === "high" && ["going_concern", "restatement", "listing_deficiency", "heavy_dilution"].includes(f.id)) ? "high" : score >= 3 ? "elevated" : score >= 1 ? "low" : "none";
  const order = { high: 0, medium: 1, low: 2 };
  return {
    ticker,
    company: company?.name ?? null,
    risk_level: level,
    score,
    flags: flags.sort((a, b) => order[a.severity] - order[b.severity]),
    checks_run: ["price & market cap", "volatility", ...(company ? ["dilution", "offerings", "listing notices", "auditor changes", "restatements", "late filings", "cash runway", "going concern"] : [])],
    updated_at: new Date().toISOString(),
    note: "Automated checks on public data. A flag is a reason to look closer, not proof of wrongdoing.",
  };
}

/** Red-flag report for a ticker, cached 12 hours and shared by all users. */
export const getRedFlags = (ticker) => cached(`redflags:${ticker.toUpperCase()}`, 720, () => compute(ticker.toUpperCase()));
