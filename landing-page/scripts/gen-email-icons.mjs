// Generates the premium activity icons used in the weekly summary email.
//
// Email clients (Gmail, Outlook) don't render SVG, so each icon is sourced from
// Phosphor Icons (MIT, "light" weight — it pairs with the email's ultra-thin
// typography), recoloured to a soft off-white, and rasterised to a crisp PNG.
//
// Output: landing-page/public/email-icons/<activityType>.png  (+ .svg source).
// Also mirrored to Supabase storage (landing-page-assets/email-icons) where the
// email loads them from. Re-run with: node scripts/gen-email-icons.mjs
//
//   npm i -D @resvg/resvg-js @phosphor-icons/core   (already in devDependencies)
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "email-icons");
const PHOSPHOR = join(__dirname, "..", "node_modules", "@phosphor-icons", "core", "assets", "light");
mkdirSync(OUT, { recursive: true });

// Rendered large (retina) — displayed ~22px in rows / ~40px in the longest-session
// feature, so 132px gives headroom either way.
const SIZE = 132;
// Soft off-white reads as an elegant icon on the near-black email canvas.
const COLOR = "#ECECEC";

// activityType (mirrors _shared activity keys) → Phosphor "light" icon name.
const MAP = {
  gym: "barbell-light",
  running: "person-simple-run-light",
  cycling: "person-simple-bike-light",
  walking: "person-simple-walk-light", // the "Steps" row
  swimming: "person-simple-swim-light",
  hiit: "flame-light",
  sports: "soccer-ball-light",
  yoga: "person-simple-tai-chi-light",
  dance: "music-notes-light",
  sleep: "moon-light",
  fallback: "heartbeat-light", // unknown types + longest-session default
};

for (const [type, icon] of Object.entries(MAP)) {
  const src = readFileSync(join(PHOSPHOR, `${icon}.svg`), "utf8")
    .replace(/fill="currentColor"/g, `fill="${COLOR}"`);
  writeFileSync(join(OUT, `${type}.svg`), src);
  const png = new Resvg(src, {
    fitTo: { mode: "width", value: SIZE },
    background: "rgba(0,0,0,0)",
  }).render().asPng();
  writeFileSync(join(OUT, `${type}.png`), png);
  console.log(`  ✓ ${type}.png  ←  ${icon}`);
}
console.log(`\nWrote ${Object.keys(MAP).length} icons to ${OUT}`);
