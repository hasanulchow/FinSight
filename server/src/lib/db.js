import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// Small table helper that works against Supabase or the in-memory local store (local mode).
// Rows are always scoped to a user where a userId is given.

const fail = (error) => {
  if (error) throw new Error(error.message);
};

export const db = {
  async insert(table, row) {
    if (config.localMode) return localStore.insert(table, row);
    const { data, error } = await supabase().from(table).insert(row).select("*").single();
    fail(error);
    return data;
  },

  async update(table, id, userId, fields) {
    if (config.localMode) return localStore.update(table, (r) => r.id === id && r.user_id === userId, fields)[0] ?? null;
    const { data, error } = await supabase().from(table).update(fields).eq("id", id).eq("user_id", userId).select("*").maybeSingle();
    fail(error);
    return data;
  },

  async get(table, id, userId) {
    if (config.localMode) return localStore.rows(table).find((r) => r.id === id && r.user_id === userId) ?? null;
    const { data } = await supabase().from(table).select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    return data;
  },

  /** Rows matching every key in `match` (equality), ordered and limited. */
  async list(table, match, { order = "created_at", ascending = true, limit = 50 } = {}) {
    if (config.localMode) {
      const rows = localStore.rows(table).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v));
      rows.sort((a, b) => (ascending ? 1 : -1) * String(a[order]).localeCompare(String(b[order])));
      return ascending ? rows.slice(-limit) : rows.slice(0, limit);
    }
    let q = supabase().from(table).select("*");
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const { data, error } = await q.order(order, { ascending }).limit(limit);
    fail(error);
    return data;
  },

  async remove(table, id, userId) {
    if (config.localMode) return localStore.remove(table, (r) => r.id === id && r.user_id === userId) > 0;
    const { data, error } = await supabase().from(table).delete().eq("id", id).eq("user_id", userId).select("id");
    fail(error);
    return data.length > 0;
  },

  /** Deletes every row of `table` that belongs to the user (account deletion). */
  async removeAllForUser(table, userId, column = "user_id") {
    if (config.localMode) return localStore.remove(table, (r) => r[column] === userId);
    const { error } = await supabase().from(table).delete().eq(column, userId);
    if (error && !/does not exist/.test(error.message)) throw new Error(error.message);
  },

  async count(table, match = {}, { since, sinceColumn = "created_at" } = {}) {
    if (config.localMode) return localStore.rows(table).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v) && (!since || r[sinceColumn] >= since)).length;
    let q = supabase().from(table).select("*", { count: "exact", head: true });
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    if (since) q = q.gte(sinceColumn, since);
    const { count, error } = await q;
    fail(error);
    return count ?? 0;
  },

  /** All rows (optionally since a date), for jobs and admin metrics. Capped at `limit`. */
  async all(table, { since, sinceColumn = "created_at", columns = "*", match = {}, limit = 10000 } = {}) {
    if (config.localMode) return localStore.rows(table).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v) && (!since || r[sinceColumn] >= since)).slice(0, limit);
    let q = supabase().from(table).select(columns);
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    if (since) q = q.gte(sinceColumn, since);
    const { data, error } = await q.limit(limit);
    fail(error);
    return data;
  },
};
