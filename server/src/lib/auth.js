import { config, LOCAL_USER } from "../config.js";
import { supabase } from "./supabase.js";

// Express middleware: verifies the Supabase JWT sent by the mobile app.
export async function requireUser(req, res, next) {
  if (config.localMode) {
    req.user = LOCAL_USER;
    return next();
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || token === "undefined" || token === "null") return res.status(401).json({ error: "Missing bearer token" });

  let result;
  try {
    result = await supabase().auth.getUser(token);
  } catch (err) {
    // Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, or Supabase unreachable: a server problem, not a bad session.
    console.error("Auth check failed:", err.message);
    return res.status(500).json({ error: "Server can't verify sessions. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server." });
  }

  const { data, error } = result;
  if (error || !data?.user) return res.status(401).json({ error: "Invalid or expired session" });

  req.user = data.user;
  next();
}
