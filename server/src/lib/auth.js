import { supabase } from "./supabase.js";

// Express middleware: verifies the Supabase JWT sent by the mobile app.
export async function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  const { data, error } = await supabase().auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Invalid or expired session" });

  req.user = data.user;
  next();
}
