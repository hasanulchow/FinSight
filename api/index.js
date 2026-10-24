// Vercel serverless function: the whole Express API (server/src/index.js).
// vercel.json rewrites /health and /briefings/* here; the Expo web app is served from the CDN.
export { default } from "../server/src/index.js";
