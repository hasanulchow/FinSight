import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let client;

// Service-role client: server-side only, bypasses RLS.
export function supabase() {
  if (!client) {
    client = createClient(config.supabaseUrl(), config.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
