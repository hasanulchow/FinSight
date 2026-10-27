import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

// In-app notifications (always) + Expo push notifications (when the user registered a device).

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function registerPushToken(userId, token, platform) {
  if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token)) throw Object.assign(new Error("Invalid Expo push token"), { status: 400 });
  const row = { user_id: userId, token, platform: platform ?? null, updated_at: new Date().toISOString() };
  if (config.localMode) return localStore.upsertBy("push_tokens", "token", row);
  const { error } = await supabase().from("push_tokens").upsert(row, { onConflict: "token" });
  if (error) throw new Error(error.message);
}

async function pushTokens(userId) {
  if (config.localMode) return localStore.rows("push_tokens").filter((t) => t.user_id === userId).map((t) => t.token);
  const { data } = await supabase().from("push_tokens").select("token").eq("user_id", userId);
  return (data ?? []).map((t) => t.token);
}

async function sendPush(tokens, { title, body, data }) {
  if (!tokens.length) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: "default" }))),
    });
    const result = await res.json().catch(() => ({}));
    // Drop tokens Expo says are no longer valid
    const dead = (result.data ?? []).map((r, i) => (r.details?.error === "DeviceNotRegistered" ? tokens[i] : null)).filter(Boolean);
    if (dead.length && !config.localMode) await supabase().from("push_tokens").delete().in("token", dead);
  } catch (err) {
    console.error("Push send failed:", err.message);
  }
}

/** Saves an in-app notification and pushes it to the user's devices. */
export async function notify(userId, { kind, title, body, ticker = null, data = null }) {
  const row = { user_id: userId, kind, title, body, ticker, data, read: false };
  let saved;
  if (config.localMode) saved = localStore.insert("notifications", row);
  else {
    const res = await supabase().from("notifications").insert(row).select("id").single();
    if (res.error) console.error("notifications insert failed:", res.error.message);
    saved = res.data;
  }
  await sendPush(await pushTokens(userId), { title, body: body.slice(0, 180), data: { kind, ticker, notificationId: saved?.id, ...data } });
  return saved;
}

export async function listNotifications(userId, limit = 50) {
  if (config.localMode) return localStore.rows("notifications").filter((n) => n.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  const { data, error } = await supabase().from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

export async function markRead(userId, id) {
  if (config.localMode) return localStore.update("notifications", (n) => n.user_id === userId && (id === "all" || n.id === id), { read: true });
  let q = supabase().from("notifications").update({ read: true }).eq("user_id", userId);
  if (id !== "all") q = q.eq("id", id);
  const { error } = await q;
  if (error) throw new Error(error.message);
}
