import { config } from "../config.js";

// SEC EDGAR client. SEC asks for a descriptive User-Agent and <= 10 requests/second.

async function secFetch(url, as = "json") {
  const res = await fetch(url, { headers: { "User-Agent": config.secUserAgent(), "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`SEC request failed (${res.status}): ${url}`);
  return as === "json" ? res.json() : res.text();
}

let tickerMap; // cached for the life of the process

export async function lookupCompany(ticker) {
  if (!tickerMap) {
    const data = await secFetch("https://www.sec.gov/files/company_tickers.json");
    tickerMap = new Map(Object.values(data).map((c) => [c.ticker.toUpperCase(), c]));
  }
  const entry = tickerMap.get(ticker.toUpperCase());
  if (!entry) return null;
  return { ticker: entry.ticker.toUpperCase(), name: entry.title, cik: String(entry.cik_str).padStart(10, "0") };
}

/** Recent 10-K, 10-Q and 8-K filings with links to the primary documents. */
export async function getRecentFilings(cik, limit = 12) {
  const data = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = data.filings.recent;
  const toFiling = (i) => ({
    form: r.form[i],
    filingDate: r.filingDate[i],
    reportDate: r.reportDate[i] || null,
    items: r.items[i] || null, // 8-K item codes, e.g. "2.02,9.01"
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`,
  });

  const filings = [];
  for (let i = 0; i < r.form.length && filings.length < limit; i++) {
    if (["10-K", "10-Q", "8-K"].includes(r.form[i])) filings.push(toFiling(i));
  }
  // Busy filers push the annual report out of the newest N, so find it separately
  const tenKIndex = r.form.indexOf("10-K");
  const latest10K = tenKIndex >= 0 ? toFiling(tenKIndex) : null;
  return { sicDescription: data.sicDescription, filings, latest10K };
}

// XBRL concepts, in order of preference (companies report revenue under different tags)
const DURATION_CONCEPTS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  epsDiluted: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
};
const INSTANT_CONCEPTS = {
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  stockholdersEquity: ["StockholdersEquity"],
};

/**
 * Annual financials straight from XBRL company facts (last 4 fiscal years).
 * Numbers come from SEC data, never from the LLM.
 */
export async function getFinancials(cik) {
  const data = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const gaap = data.facts?.["us-gaap"] ?? {};
  const series = {};

  // Companies switch tags over time (e.g. Revenues -> RevenueFromContract...), so use the tag with the most recent data
  const pick = (names, framePattern) => {
    let best = [];
    for (const name of names) {
      const units = gaap[name]?.units;
      const entries = units?.USD ?? units?.["USD/shares"];
      if (!entries) continue;
      const byYear = new Map();
      for (const e of entries) {
        const m = e.frame?.match(framePattern);
        if (m) byYear.set(Number(m[1]), e.val);
      }
      const points = [...byYear.entries()].sort((a, b) => a[0] - b[0]).slice(-4).map(([year, value]) => ({ year, value }));
      if (points.length && (!best.length || points.at(-1).year > best.at(-1).year)) best = points;
    }
    return best;
  };

  for (const [key, names] of Object.entries(DURATION_CONCEPTS)) series[key] = pick(names, /^CY(\d{4})$/);
  for (const [key, names] of Object.entries(INSTANT_CONCEPTS)) series[key] = pick(names, /^CY(\d{4})Q4I$/);
  return series;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Pulls a section out of a 10-K. The table of contents also mentions each item,
 * so we take the longest start->end span, which is the actual section body.
 */
function extractSection(text, startRe, endRe, maxChars) {
  const starts = [...text.matchAll(startRe)].map((m) => m.index);
  const ends = [...text.matchAll(endRe)].map((m) => m.index);
  let best = null;
  for (const s of starts) {
    const e = ends.find((x) => x > s);
    if (e && (!best || e - s > best[1] - best[0])) best = [s, e];
  }
  if (!best || best[1] - best[0] < 500) return null;
  const body = text.slice(best[0], best[1]);
  return { text: body.slice(0, maxChars), truncated: body.length > maxChars, totalChars: body.length };
}

// Heading matcher tolerant of styled headings like "ITEM 1. B USINESS" (drop-cap first letter split off)
// End markers must be real headings too: "Item 8 of this Form 10-K" cross-references would cut sections short.
const heading = (...pairs) =>
  new RegExp(
    pairs.map(([item, title]) => `item\\s*${item}\\.?\\s*${title.split(" ").map((w) => w.split("").join("\\s?")).join("\\s*")}`).join("|"),
    "gi"
  );

/** Business (Item 1), Risk Factors (Item 1A) and MD&A (Item 7) from a 10-K document. */
export async function get10KSections(url) {
  const text = htmlToText(await secFetch(url, "text"));
  const risk = heading(["1a", "risk factors"]);
  return {
    business: extractSection(text, heading(["1", "business"]), risk, 30000),
    riskFactors: extractSection(text, risk, heading(["1b", "unresolved"], ["1c", "cybersecurity"], ["2", "properties"]), 120000),
    mdna: extractSection(text, heading(["7", "management.s discussion"]), heading(["7a", "quantitative"], ["8", "financial statements"]), 80000),
  };
}
