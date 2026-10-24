import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// Three kinds of memory:
//   advisor memory   - preferences and notes an advisor saves (e.g. "My clients are income-focused"),
//                      injected into the Briefing Writer so briefings emphasize what matters to them
//   research memory  - the advisor's previous briefing on the same ticker, so a new briefing can say what changed
//   conversation     - the chat history of follow-up questions on a briefing, for the Filing Q&A agent

export const MEMORY_KINDS = ["preference", "note", "client_context"];
const MAX_MEMORIES = 50;

export async function listMemories(userId) {
  if (config.localMode) return localStore.listMemories(userId);
  const { data, error } = await supabase()
    .from("advisor_memories")
    .select("id, kind, ticker, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_MEMORIES);
  if (error) throw new Error(error.message);
  return data;
}

export async function addMemory(userId, { kind, ticker, content }) {
  const existing = await listMemories(userId);
  if (existing.length >= MAX_MEMORIES) throw Object.assign(new Error(`You can save up to ${MAX_MEMORIES} memories. Delete some first.`), { status: 400 });
  const row = { user_id: userId, kind, ticker: ticker || null, content };
  if (config.localMode) return localStore.insertMemory(row);
  const { data, error } = await supabase().from("advisor_memories").insert(row).select("id, kind, ticker, content, created_at").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMemory(userId, id) {
  if (config.localMode) return localStore.deleteMemory(id, userId);
  const { data, error } = await supabase().from("advisor_memories").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) throw new Error(error.message);
  return data.length > 0;
}

/** Memories relevant to a briefing: general ones plus those tagged with this ticker. */
export async function memoriesForTicker(userId, ticker) {
  return (await listMemories(userId)).filter((m) => !m.ticker || m.ticker === ticker).slice(0, 15);
}

/** The advisor's most recent completed briefing on this ticker (excluding the current one). */
export async function previousBriefing(userId, ticker, excludeId) {
  let row;
  if (config.localMode) {
    row = localStore.previousBriefing(userId, ticker, excludeId);
  } else {
    let query = supabase()
      .from("briefings")
      .select("id, created_at, content")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    row = data[0];
  }
  if (!row?.content) return null;
  const c = row.content;
  // A compact summary is enough for "what changed" and keeps the prompt small
  return {
    date: row.created_at,
    price: c.snapshot?.price,
    executive_summary: c.executive_summary,
    key_takeaways: c.key_takeaways,
    top_risks: c.risks?.top_risks?.map((r) => r.title),
    latest10K: c.sources?.latest10K,
  };
}

// ---------- Conversation memory ----------
export async function chatHistory(briefingId, userId, limit = 20) {
  if (config.localMode) return localStore.listChat(briefingId, userId).slice(-limit);
  const { data, error } = await supabase()
    .from("chat_messages")
    .select("id, role, content, citations, guardrail, evaluation, created_at")
    .eq("briefing_id", briefingId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data.reverse();
}

export async function saveChatMessage(row) {
  if (config.localMode) return localStore.insertChat(row);
  const { data, error } = await supabase().from("chat_messages").insert(row).select("id, role, content, citations, guardrail, evaluation, created_at").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateChatMessage(id, fields) {
  if (config.localMode) return localStore.updateChat(id, fields);
  const { error } = await supabase().from("chat_messages").update(fields).eq("id", id);
  if (error) console.error("chat_messages update failed:", error.message);
}
