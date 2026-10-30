// Syntax-checks every server source file (used by CI): node scripts/check.js
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = readdirSync("src", { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => `src/${f.replaceAll("\\", "/")}`);
for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`Checked ${files.length} files`);
