import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// Guardrails, applied at three points:
//   input     - text typed by advisors (questions, saved memories): length, PII redaction, prompt injection
//   retrieval - filing text pulled into prompts is untrusted data; injection-like passages are flagged and fenced
//   output    - generated briefing/answers: no recommendations, predictions, guarantees or leaked PII
// Every action is written to guardrail_events as an audit trail for compliance.

// ---------- PII ----------
const PII_PATTERNS = [
  { type: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "card_number", re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => luhn(m.replace(/\D/g, "")) },
  { type: "account_number", re: /\b(?:acct|account|a\/c|routing)\s*(?:no\.?|number|#)?\s*[:#]?\s*\d{6,17}\b/gi },
  { type: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "phone", re: /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)/g },
];

function luhn(digits) {
  if (digits.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Replaces PII with [REDACTED:type]. Returns { text, found: [types] }. */
export function redactPII(text) {
  const found = new Set();
  let out = text;
  for (const { type, re, check } of PII_PATTERNS) {
    out = out.replace(re, (m) => {
      if (check && !check(m)) return m;
      found.add(type);
      return `[REDACTED:${type}]`;
    });
  }
  return { text: out, found: [...found] };
}

// ---------- Prompt injection ----------
const INJECTION_PATTERNS = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any |the )?(previous|prior|above|system) (instructions|prompts?|rules)/i,
  /(reveal|show|print|repeat|leak) (me )?(your|the) (system )?(prompt|instructions)/i,
  /\byou are now\b|\bact as (an? )?(unfiltered|unrestricted|jailbroken)/i,
  /\b(developer|dan|god) mode\b/i,
  /<\/?(system|assistant|instructions?)>/i,
  /\boverride (your|the) (rules|guardrails|safety|compliance)\b/i,
];

export const detectInjection = (text) => INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);

// ---------- Advice-seeking (allowed, but the answer must stay neutral) ----------
const ADVICE_PATTERNS = [
  /\bshould (i|we|my client|clients?) (buy|sell|hold|invest|short)\b/i,
  /\b(is|would) (it|this|the stock) (be )?a (good|bad|smart) (buy|investment)\b/i,
  /\b(will|is) (it|the stock|the price) (go(ing)? (up|down)|rise|fall|double)\b/i,
  /\bprice target\b|\bhow much will\b/i,
];
export const seeksAdvice = (text) => ADVICE_PATTERNS.some((re) => re.test(text));

/**
 * Input guardrail for advisor-typed text.
 * Returns { ok, text (PII-redacted), reason?, flags: {pii, advice} }
 */
export function checkInput(raw, { maxLength = 1000, label = "Text" } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: `${label} can't be empty.`, rule: "empty" };
  if (text.length > maxLength) return { ok: false, reason: `${label} is too long (max ${maxLength} characters).`, rule: "too_long" };

  const injection = detectInjection(text);
  if (injection.length) {
    return { ok: false, reason: "That looks like an attempt to change the assistant's instructions, so it was blocked.", rule: "prompt_injection", detail: injection };
  }

  const { text: redacted, found } = redactPII(text);
  return { ok: true, text: redacted, flags: { pii: found, advice: seeksAdvice(text) } };
}

// ---------- Retrieval guardrail ----------
/** Flags retrieved passages that contain instruction-like text; the prompt fences all passages as data. */
export function screenRetrieved(chunks) {
  return chunks.map((c) => ({ ...c, suspicious: detectInjection(c.content).length > 0 }));
}

// ---------- Output guardrail ----------
export const BANNED_OUTPUT = [
  /\byou should (buy|sell|hold)\b/i,
  /\b(strong )?(buy|sell) (rating|recommendation)\b/i,
  /\bwe recommend (buying|selling|holding)\b/i,
  // Promises of performance only: 10-K risk language ("there can be no guarantee that...") is fine
  /\bguarantee[ds]? (?:a |an )?(returns?|profits?|gains?|growth|performance|upside|income)\b/i,
  /\b(returns?|profits?|gains?|upside) (?:are|is) guaranteed\b/i,
  /\brisk[- ]free (investment|return|bet|stock)\b/i,
  /\bprice target\b/i,
  /\bwill (rise|soar|double|go up|skyrocket|crash)\b/i,
];

/** Returns the banned patterns and PII types found in any string inside `value`. */
export function scanOutput(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return {
    banned: BANNED_OUTPUT.filter((re) => re.test(text)).map((re) => re.source),
    pii: redactPII(text).found.filter((t) => t !== "phone" && t !== "email"), // filings legitimately contain company phone/email
  };
}

/**
 * Last-line output guardrail: removes any sentence that still matches a banned pattern after the
 * compliance agent, in every string field of `obj`. Returns { value, removed: [sentences] }.
 */
export function enforceOutput(obj) {
  const removed = [];
  const clean = (s) => {
    if (!BANNED_OUTPUT.some((re) => re.test(s))) return s;
    const kept = s.split(/(?<=[.!?])\s+/).filter((sentence) => {
      const bad = BANNED_OUTPUT.some((re) => re.test(sentence));
      if (bad) removed.push(sentence);
      return !bad;
    });
    return kept.join(" ") || "[Removed by compliance guardrail]";
  };
  const walk = (v) => (typeof v === "string" ? clean(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return { value: walk(obj), removed };
}

// ---------- Rate limits ----------
export async function checkRateLimit(userId, kind) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const limit = kind === "briefing" ? config.briefingsPerHour : config.questionsPerHour;
  let used;
  if (config.localMode) {
    used = kind === "briefing" ? localStore.countBriefingsSince(userId, since) : localStore.countQuestionsSince(userId, since);
  } else {
    const query = kind === "briefing"
      ? supabase().from("briefings").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since)
      : supabase().from("chat_messages").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("role", "user").gte("created_at", since);
    const { count, error } = await query;
    if (error) throw new Error(`Rate limit check failed: ${error.message}`);
    used = count ?? 0;
  }
  return used >= limit
    ? { ok: false, reason: `You've reached the limit of ${limit} ${kind === "briefing" ? "briefings" : "questions"} per hour. Try again later.`, rule: "rate_limit" }
    : { ok: true };
}

// ---------- Audit log ----------
export async function logGuardrail({ userId, briefingId = null, stage, rule, action, detail = null }) {
  const row = { user_id: userId, briefing_id: briefingId, stage, rule, action, detail };
  if (config.localMode) return localStore.insertGuardrailEvent(row);
  const { error } = await supabase().from("guardrail_events").insert(row);
  if (error) console.error("guardrail_events insert failed:", error.message);
}
