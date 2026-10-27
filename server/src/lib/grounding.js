// Deterministic grounding metrics for evaluation (no LLM cost):
//   evidenceMatch    - do the Risk Analyst's "verbatim" quotes actually appear in the 10-K?
//   numericGrounding - does every number in the narrative trace back to source data (XBRL, quote, 10-K)?

/** Only the generated narrative: verbatim evidence quotes and raw data are excluded. */
export function narrativeOf(content) {
  return {
    executive_summary: content.executive_summary,
    key_takeaways: content.key_takeaways,
    talking_points: content.talking_points,
    questions_to_consider: content.questions_to_consider,
    changes_since_last: content.changes_since_last,
    market: content.market,
    fundamentals: content.fundamentals,
    business: content.business && {
      business_overview: content.business.business_overview,
      management_outlook: content.business.management_outlook,
      recent_events: content.business.recent_events?.map((e) => e.summary),
    },
    risks: content.risks && { overview: content.risks.overview, summaries: content.risks.top_risks?.map((r) => `${r.title}. ${r.summary}`) },
    technicals: content.technicals?.analysis,
  };
}

const normalize = (s) =>
  s.toLowerCase().replace(/[‘’“”"']/g, "").replace(/[^a-z0-9%$.]+/g, " ").replace(/\s+/g, " ").trim();

function shingles(s, n = 5) {
  const words = s.split(" ");
  const out = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out.length ? out : [s];
}

/** Share of risk evidence quotes found in the 10-K risk section (exact or >= 70% 5-gram overlap). */
export function evidenceMatch(topRisks = [], riskText) {
  if (!topRisks.length || !riskText) return { total: topRisks.length, matched: 0, rate: null, unmatched: [] };
  const haystack = normalize(riskText);
  const unmatched = [];
  let matched = 0;
  for (const r of topRisks) {
    const quote = normalize((r.evidence || "").replace(/^\.+|\.+$|…/g, ""));
    const grams = shingles(quote);
    const ok = quote && (haystack.includes(quote) || grams.filter((g) => haystack.includes(g)).length / grams.length >= 0.7);
    if (ok) matched++;
    else unmatched.push(r.evidence);
  }
  return { total: topRisks.length, matched, rate: Number((matched / topRisks.length).toFixed(2)), unmatched };
}

const UNIT = { t: 1e12, trillion: 1e12, b: 1e9, billion: 1e9, m: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };
const NUMBER_RE = /(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|percent|trillion|billion|million|thousand|[TBMK]\b)?/gi;

function extractNumbers(text) {
  const out = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const [raw, dollar, intPart, frac = "", unitRaw] = m;
    const value = Number(intPart.replace(/,/g, "") + frac);
    const unit = unitRaw?.toLowerCase();
    const isPct = unit === "%" || unit === "percent";
    // Skip years, item numbers and small counts ("5 risks", "Item 7"), which aren't data claims
    if (!dollar && !unit && !frac && (value < 100 || (value >= 1900 && value <= 2100))) continue;
    out.push({ raw: raw.trim(), value: isPct ? value : value * (UNIT[unit] ?? 1), kind: isPct ? "pct" : "abs" });
  }
  return out;
}

/** Builds the set of values a grounded number may refer to. */
function sourceValues(sourceData) {
  const abs = [];
  const pct = [];
  const fin = sourceData.financials ?? {};
  for (const series of Object.values(fin)) {
    for (const p of series) abs.push(p.value);
    for (let i = 0; i < series.length; i++) {
      for (let j = i + 1; j < series.length; j++) {
        const a = series[i].value, b = series[j].value;
        if (a) pct.push(((b - a) / Math.abs(a)) * 100);
      }
    }
  }
  // Margins: operating and net income as % of revenue
  for (const r of fin.revenue ?? []) {
    for (const key of ["operatingIncome", "netIncome"]) {
      const v = fin[key]?.find((p) => p.year === r.year)?.value;
      if (v != null && r.value) pct.push((v / r.value) * 100);
    }
  }
  const q = sourceData.quote ?? {};
  for (const k of ["price", "change", "open", "high", "low", "previousClose", "week52High", "week52Low", "peRatio", "beta", "dividendYield"]) if (q[k] != null) abs.push(q[k]);
  if (q.marketCapMillions) abs.push(q.marketCapMillions * 1e6);
  if (q.changePercent != null) pct.push(q.changePercent, Math.abs(q.changePercent));
  if (q.dividendYield != null) pct.push(q.dividendYield);
  if (q.price && q.week52High) pct.push(((q.week52High - q.price) / q.week52High) * 100);
  if (q.price && q.week52Low) pct.push(((q.price - q.week52Low) / q.week52Low) * 100);

  // Every number in the technical snapshot (indicator values, levels, performance, signal labels)
  const walk = (v) => {
    if (typeof v === "number") abs.push(v), pct.push(v);
    else if (typeof v === "string") for (const n of extractNumbers(v)) (n.kind === "pct" ? pct : abs).push(n.value);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  if (sourceData.technicals) walk(sourceData.technicals);

  // Numbers stated in the 10-K text (MD&A amounts are often "in millions")
  const tenKText = Object.values(sourceData.tenK ?? {}).map((s) => s?.text ?? "").join("\n");
  for (const n of extractNumbers(tenKText)) {
    if (n.kind === "pct") pct.push(n.value);
    else abs.push(n.value, n.value * 1e6);
  }
  return { abs, pct };
}

const close = (a, b, rel) => Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9);

/** Share of numbers in the narrative that match source data within rounding tolerance. */
export function numericGrounding(content, sourceData) {
  const text = JSON.stringify(narrativeOf(content));
  const numbers = extractNumbers(text);
  if (!numbers.length) return { total: 0, grounded: 0, rate: null, ungrounded: [] };
  const src = sourceValues(sourceData);
  const ungrounded = [];
  let grounded = 0;
  for (const n of numbers) {
    const ok = n.kind === "pct"
      ? src.pct.some((p) => Math.abs(Math.abs(p) - n.value) <= Math.max(0.6, n.value * 0.03))
      : src.abs.some((v) => close(Math.abs(v), n.value, 0.02));
    if (ok) grounded++;
    else ungrounded.push(n.raw);
  }
  return { total: numbers.length, grounded, rate: Number((grounded / numbers.length).toFixed(2)), ungrounded: [...new Set(ungrounded)].slice(0, 15) };
}
