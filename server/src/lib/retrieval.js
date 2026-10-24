import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";
import { embed, embeddingsEnabled, cosine } from "./embeddings.js";
import { get10KSections } from "../tools/sec.js";

// Retrieval over 10-K filings: sections are split into overlapping chunks, embedded once per filing
// (filings never change, so the index doubles as a cache), and searched by vector similarity.
// Without embeddings, search falls back to keyword (TF-IDF) scoring over the same chunks.

const CHUNK_CHARS = 1500;
const OVERLAP_CHARS = 200;
const SECTION_LABELS = { business: "Item 1. Business", riskFactors: "Item 1A. Risk Factors", mdna: "Item 7. MD&A" };

/** Splits text into ~1500-char chunks on paragraph/sentence boundaries, with a small overlap. */
export function chunkText(text) {
  const pieces = text
    .split(/\n{2,}/)
    .flatMap((p) => (p.length > CHUNK_CHARS ? p.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [p] : [p]))
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      // Overlap: carry the tail into the next chunk, starting at a sentence (or at least word) boundary
      const tail = current.slice(-OVERLAP_CHARS);
      const sentenceStart = tail.search(/(?<=[.!?])\s+[A-Z]/);
      current = (sentenceStart >= 0 ? tail.slice(sentenceStart) : tail.slice(tail.indexOf(" ") + 1)).trim();
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current.trim().length > 50) chunks.push(current);
  return chunks;
}

export function chunkSections(sections) {
  const rows = [];
  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    const text = sections?.[key]?.text;
    if (!text) continue;
    chunkText(text).forEach((content, i) => rows.push({ section: label, chunk_index: i, content }));
  }
  return rows;
}

async function loadChunks(sourceUrl, { withEmbeddings = false } = {}) {
  if (config.localMode) return localStore.getChunks(sourceUrl);
  const columns = withEmbeddings ? "id, section, chunk_index, content, embedding" : "id, section, chunk_index, content";
  const { data, error } = await supabase().from("filing_chunks").select(columns).eq("source_url", sourceUrl).order("section").order("chunk_index");
  if (error) throw new Error(`Loading filing chunks failed: ${error.message}`);
  return data;
}

/**
 * Indexes a 10-K once: chunks + embeddings. Returns the number of chunks.
 * Pass `sections` when already fetched (the briefing pipeline does); otherwise they are downloaded.
 */
export async function indexFiling({ sourceUrl, ticker, cik, sections }) {
  if (!sourceUrl) return 0;
  const existing = await loadChunks(sourceUrl);
  if (existing.length) return existing.length; // already indexed: filings are immutable

  const rows = chunkSections(sections ?? (await get10KSections(sourceUrl)));
  if (!rows.length) return 0;

  const vectors = await embed(rows.map((r) => `${r.section}\n${r.content}`), "document");
  const records = rows.map((r, i) => ({ ...r, source_url: sourceUrl, ticker, cik, embedding: vectors?.[i] ?? null, embedding_model: vectors ? config.embeddingModel : null }));

  if (config.localMode) {
    localStore.setChunks(sourceUrl, records);
  } else {
    // Unique (source_url, section, chunk_index): a concurrent indexer for the same filing is a no-op
    const { error } = await supabase().from("filing_chunks").upsert(records, { onConflict: "source_url,section,chunk_index", ignoreDuplicates: true });
    if (error) throw new Error(`Saving filing chunks failed: ${error.message}`);
  }
  return records.length;
}

/** Top-k chunks of one filing for a query: [{id, section, chunk_index, content, score, method}] */
export async function searchFiling({ sourceUrl, query, k = 6 }) {
  if (embeddingsEnabled()) {
    const [queryVector] = await embed([query], "query");
    if (!config.localMode) {
      const { data, error } = await supabase().rpc("match_filing_chunks", { query_embedding: queryVector, filing_url: sourceUrl, match_count: k });
      if (error) throw new Error(`Vector search failed: ${error.message}`);
      if (data.length) return data.map((d) => ({ ...d, score: d.similarity, method: "vector" }));
    } else {
      const chunks = localStore.getChunks(sourceUrl).filter((c) => c.embedding);
      if (chunks.length) {
        return chunks
          .map(({ embedding, ...c }) => ({ ...c, score: cosine(queryVector, embedding), method: "vector" }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
      }
    }
  }
  // Fallback: chunks indexed without embeddings, or embeddings not configured
  return keywordSearch(await loadChunks(sourceUrl), query, k);
}

const STOP = new Set("the and for with that this from are was were has have had our its their they them what which who how does did not but any all can will would could should into about over than been more most also such other these those there when where why your you say says said tell company company's affect affects".split(" "));
const tokens = (s) => s.toLowerCase().match(/[a-z0-9][a-z0-9.\-]{2,}/g)?.filter((t) => !STOP.has(t)) ?? [];

export function keywordSearch(chunks, query, k) {
  const terms = [...new Set(tokens(query))];
  if (!terms.length || !chunks.length) return [];
  const docs = chunks.map(({ embedding, ...c }) => ({ ...c, tf: tokens(c.content) }));
  const df = Object.fromEntries(terms.map((t) => [t, docs.filter((d) => d.tf.includes(t)).length]));
  return docs
    .map(({ tf, ...c }) => {
      const score = terms.reduce((s, t) => {
        const count = tf.filter((x) => x === t).length;
        return s + (count ? (1 + Math.log(count)) * Math.log(1 + docs.length / (df[t] || 1)) : 0);
      }, 0);
      return { ...c, score, method: "keyword" };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
