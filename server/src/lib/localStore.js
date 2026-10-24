import { randomUUID } from "node:crypto";

// In-memory stand-in for the Supabase tables, used only in local mode (see config.localMode).
// Data is lost when the server restarts.
const briefings = new Map();
const evaluations = [];
const agentLogs = [];
const feedback = new Map();
const memories = [];
const chatMessages = [];
const guardrailEvents = [];
const filingChunks = new Map(); // source_url -> chunks

const now = () => new Date().toISOString();

export const localStore = {
  createBriefing(row) {
    const briefing = { id: randomUUID(), created_at: now(), ...row };
    briefings.set(briefing.id, briefing);
    return briefing;
  },

  updateBriefing(id, fields) {
    const briefing = briefings.get(id);
    if (briefing) Object.assign(briefing, fields);
  },

  listBriefings(userId) {
    return [...briefings.values()]
      .filter((b) => b.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50)
      .map(({ id, ticker, company_name, status, created_at }) => ({
        id, ticker, company_name, status, created_at,
        evaluations: evaluations.filter((e) => e.briefing_id === id).map(({ overall }) => ({ overall })),
      }));
  },

  getBriefing(id, userId) {
    const b = briefings.get(id);
    if (!b || b.user_id !== userId) return null;
    const { id: _, user_id, source_data, completed_at, ...rest } = b;
    return {
      id, ...rest,
      evaluations: evaluations.filter((e) => e.briefing_id === id),
      agent_logs: agentLogs
        .filter((l) => l.briefing_id === id)
        .map(({ agent, model, input_tokens, output_tokens, latency_ms, status }) => ({ agent, model, input_tokens, output_tokens, latency_ms, status })),
    };
  },

  // Full row including source_data, for server-side use (memory, retrieval)
  getBriefingRow(id, userId) {
    const b = briefings.get(id);
    return b && b.user_id === userId ? b : null;
  },

  previousBriefing(userId, ticker, excludeId) {
    return [...briefings.values()]
      .filter((b) => b.user_id === userId && b.ticker === ticker && b.status === "complete" && b.id !== excludeId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  },

  countBriefingsSince(userId, sinceIso) {
    return [...briefings.values()].filter((b) => b.user_id === userId && b.created_at >= sinceIso).length;
  },

  insertEvaluation(row) {
    evaluations.push({ id: randomUUID(), created_at: now(), ...row });
  },

  listEvaluations(userId) {
    const ids = new Set([...briefings.values()].filter((b) => b.user_id === userId).map((b) => b.id));
    return evaluations.filter((e) => ids.has(e.briefing_id));
  },

  insertAgentLog(row) {
    agentLogs.push({ id: randomUUID(), status: "ok", created_at: now(), ...row });
  },

  upsertFeedback(row) {
    feedback.set(`${row.briefing_id}:${row.user_id}`, row);
  },

  listFeedback(userId) {
    return [...feedback.values()].filter((f) => f.user_id === userId);
  },

  // Advisor memory
  listMemories(userId) {
    return memories.filter((m) => m.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  insertMemory(row) {
    const memory = { id: randomUUID(), created_at: now(), ...row };
    memories.push(memory);
    return memory;
  },
  deleteMemory(id, userId) {
    const i = memories.findIndex((m) => m.id === id && m.user_id === userId);
    if (i >= 0) memories.splice(i, 1);
    return i >= 0;
  },

  // Conversation memory
  listChat(briefingId, userId) {
    return chatMessages.filter((m) => m.briefing_id === briefingId && m.user_id === userId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  insertChat(row) {
    const message = { id: randomUUID(), created_at: now(), ...row };
    chatMessages.push(message);
    return message;
  },
  updateChat(id, fields) {
    const m = chatMessages.find((x) => x.id === id);
    if (m) Object.assign(m, fields);
  },
  listChatAll(userId) {
    return chatMessages.filter((m) => m.user_id === userId && m.role === "assistant");
  },
  countQuestionsSince(userId, sinceIso) {
    return chatMessages.filter((m) => m.user_id === userId && m.role === "user" && m.created_at >= sinceIso).length;
  },

  // Guardrail audit log
  insertGuardrailEvent(row) {
    guardrailEvents.push({ id: randomUUID(), created_at: now(), ...row });
  },
  listGuardrailEvents(userId) {
    return guardrailEvents.filter((e) => e.user_id === userId);
  },

  // Filing chunks (embeddings index)
  getChunks(sourceUrl) {
    return filingChunks.get(sourceUrl) ?? [];
  },
  setChunks(sourceUrl, chunks) {
    filingChunks.set(sourceUrl, chunks.map((c) => ({ id: randomUUID(), ...c })));
  },
};
