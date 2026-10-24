import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// EXPO_PUBLIC_ values are baked in at build time. Without them createClient throws and the
// whole app renders blank, so fall back to a dummy client.
export const supabaseConfigured = Boolean(url && anonKey) && !url.includes("example.supabase.co");

// Local mode: no Supabase, so the app skips login and the local server skips auth (server config.localMode).
export const localMode = !supabaseConfigured;
export const LOCAL_SESSION = { user: { email: "local@finsight.dev" } };

export const supabase = createClient(url || "https://not-configured.supabase.co", anonKey || "not-configured", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On web, email confirmation and magic links land back on the site with the session in the URL.
    detectSessionInUrl: Platform.OS === "web",
  },
});
