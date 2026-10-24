// Small helpers for structured-output JSON schemas (every object closed, every field required).

export const str = (description) => ({ type: "string", description });
export const int = (description) => ({ type: "integer", description });
export const arr = (items, description) => ({ type: "array", items, description });
export const oneOf = (values, description) => ({ type: "string", enum: values, description });

export function obj(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

// Shared rules every agent follows
export const HOUSE_RULES = `You work for a wealth management firm. Your reader is a financial advisor preparing to discuss a stock with clients.
Rules:
- Use only the data provided. If something is not in the data, say it is not available. Never invent numbers, dates or facts.
- Be neutral and factual. Never recommend buying, selling or holding, and never predict prices.
- Be concise: advisors skim. Prefer short sentences and plain language.`;
