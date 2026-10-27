import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// Small shared key/value cache (Supabase `kv_cache`, or memory in local mode) for expensive market data:
// options overviews, market snapshots. Everyone shares entries, so one user's fetch serves all.

export async function cacheGet(key, maxAgeMinutes) {
  let row;
  if (config.localMode) row = localStore.rows("kv_cache").find((r) => r.key === key);
  else {
    const { data } = await supabase().from("kv_cache").select("data, fetched_at").eq("key", key).maybeSingle();
    row = data;
  }
  if (!row) return null;
  return Date.now() - Date.parse(row.fetched_at) < maxAgeMinutes * 60_000 ? row.data : null;
}

export async function cacheSet(key, data) {
  const row = { key, data, fetched_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("kv_cache", "key", row);
  const { error } = await supabase().from("kv_cache").upsert(row, { onConflict: "key" });
  if (error) console.error("kv_cache upsert failed:", error.message);
}

/** Returns the cached value, or computes, caches and returns it. Concurrent callers share one computation. */
const inflight = new Map();
export async function cached(key, maxAgeMinutes, compute) {
  const hit = await cacheGet(key, maxAgeMinutes);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = compute()
    .then(async (value) => {
      await cacheSet(key, value);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
