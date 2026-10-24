import { config } from "../config.js";

// Voyage AI embeddings (Anthropic's recommended embeddings provider; Claude has no embeddings endpoint).
// Without VOYAGE_API_KEY, embeddings are disabled and retrieval falls back to keyword search.

const URL = "https://api.voyageai.com/v1/embeddings";
const BATCH = 128;

export const embeddingsEnabled = () => Boolean(config.voyageKey);

/**
 * Embeds texts. inputType "document" for stored chunks, "query" for search queries.
 * Returns one 1024-dim vector per text, or null when embeddings are not configured.
 */
export async function embed(texts, inputType) {
  if (!embeddingsEnabled() || texts.length === 0) return null;
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.voyageKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: texts.slice(i, i + BATCH),
        input_type: inputType,
        output_dimension: config.embeddingDimensions,
      }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const item of body.data.sort((a, b) => a.index - b.index)) vectors.push(item.embedding);
  }
  return vectors;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
