import { runAgent } from "../lib/llm.js";
import { HOUSE_RULES, obj, str, arr } from "./schema.js";

const schema = obj({
  business_overview: str("3-4 sentences: what the company does, how it makes money"),
  segments: arr(str("A business segment or major product line, with a few words of context"), "Main segments, if described"),
  management_outlook: str("2-4 sentences on management's discussion: drivers, guidance, tone. 'Not available' if MD&A is missing"),
  recent_events: arr(
    obj({
      date: str("Filing date YYYY-MM-DD"),
      form: str("10-K, 10-Q or 8-K"),
      summary: str("What the filing is about. For 8-Ks, infer from the item codes (e.g. 2.02 = results of operations, 5.02 = officer/director changes)"),
    }),
    "Most notable recent filings, newest first, max 6"
  ),
});

const section = (s) => (s ? `${s.text}${s.truncated ? `\n[Section truncated: showing ${s.text.length} of ${s.totalChars} characters]` : ""}` : "Not available");

export function filingsAnalyst({ company, filings, sections, briefingId }) {
  return runAgent({
    agent: "filings_analyst",
    briefingId,
    schema,
    system: `${HOUSE_RULES}\nYou are the SEC Filings Analyst. You summarize the business description and MD&A from the latest 10-K, and the list of recent filings.`,
    prompt: `Company: ${company.name} (${company.ticker})

Recent filings (JSON):
${JSON.stringify(filings, null, 2)}

<10k_item_1_business>
${section(sections?.business)}
</10k_item_1_business>

<10k_item_7_mdna>
${section(sections?.mdna)}
</10k_item_7_mdna>`,
  });
}
