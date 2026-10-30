// Renders the app icons from the brand mark. Run from a folder that has `sharp` installed:
//   node render-icons.mjs <path-to-mobile/assets>
// Outputs: icon.png (iOS/app stores, full-bleed square), adaptive-icon.png (Android foreground, safe zone),
// splash-icon.png, favicon.png, plus brand/mark-1024.png.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const assets = process.argv[2];
const mark = readFileSync(join(assets, "brand/mark.svg"), "utf8");

// App-store icons are square; the OS applies its own corner mask, so drop our rounded corners.
const square = mark.replaceAll('rx="17"', 'rx="0"');

// Android adaptive icon: only the glyph, scaled into the 66% safe zone on a transparent canvas;
// the background color comes from app.json.
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  <g transform="translate(32 32) scale(0.62) translate(-32 -32)">
    <circle cx="27" cy="35" r="14" stroke="#FFFFFF" stroke-width="4.8" fill="none"/>
    <path d="M18 40 L24 33.5 L29.5 37.5 L46 20" stroke="#FFFFFF" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="48.5" cy="17.5" r="4.8" fill="#22D3EE"/>
  </g>
</svg>`;

const out = (name) => join(assets, name);
await sharp(Buffer.from(square)).resize(1024, 1024).png().toFile(out("icon.png"));
await sharp(Buffer.from(glyph)).resize(1024, 1024).png().toFile(out("adaptive-icon.png"));
await sharp(Buffer.from(mark)).resize(512, 512).png().toFile(out("splash-icon.png"));
await sharp(Buffer.from(mark)).resize(196, 196).png().toFile(out("favicon.png"));
await sharp(Buffer.from(mark)).resize(1024, 1024).png().toFile(out("brand/mark-1024.png"));
console.log("icons rendered");
