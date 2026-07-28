// Generates the static map behind beat 1 of the placements explainer
// (src/components/PlacementExplainer.jsx).
//
// Why a flat image and not a map component: that panel only has to sit there
// and look like the placement editor. Mounting a live Google map would bill
// per load and pull a third-party script into the partner portal for a
// decoration — a real cost and a real dependency for no interactivity.
//
// Why OpenStreetMap and not Google: Google's Maps Platform terms don't permit
// storing their imagery as a permanent asset. OSM is ODbL, which explicitly
// allows redistribution with attribution — PlacementExplainer renders the
// required "© OpenStreetMap" credit over the image.
//
// The squares are REAL Web-Mercator tiles at CELL_Z, painted in the editor's
// own three layers (faint slate available-grid → GOLD @0.5 → RED @0.38, all
// matching PlacementGridMap.redraw()), and centred in the frame so that every
// object-cover crop the panel can produce still contains them.
//
// Output: landing-page/public/placement-map.webp (~60 KB)
// Re-run with:  npm i -D puppeteer-core && node scripts/gen-placement-map.mjs
// (puppeteer-core is deliberately NOT a committed dependency — this runs about
// once a year. It drives the system Chrome below.)
import puppeteer from 'puppeteer-core';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'placement-map.webp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ── Must stay in step with PlacementExplainer.jsx ────────────────────────────
const DEMO = { lat: 51.5074, lng: -0.1278 };   // = placementGrid DEFAULT_CENTER
const CELL_Z = 18;                             // ~95 m cells ≈ one city block
const CELL_PX = 90;                            // cell size in the 2× image
const SELECTED = [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2], [2, 2]];
const BOOKED = [2, 1];                         // another brand already holds it
const GOLD = '#E8D200';
const RED = '#ef4444';
const W = 1200, H = 440;                       // 2× of a 600×220 CSS panel

// Slippy-tile math, mirroring src/lib/placementGrid.js.
const lngLatToTile = (lat, lng, z) => {
    const n = 2 ** z;
    return {
        x: Math.floor(((lng + 180) / 360) * n),
        y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
    };
};

const base = lngLatToTile(DEMO.lat, DEMO.lng, CELL_Z);
// Source one zoom coarser than the cells: each tile then covers 2×2 cells and
// renders at 2·CELL_PX, i.e. DOWN-scaled from 256 — sharper than upscaling.
const SRC_Z = CELL_Z - 1;
const TILE_PX = CELL_PX * 2;

// Put the centre of the painted patch at the centre of the frame.
const offX = W / 2 - ((base.x + 1.5) / 2) * TILE_PX;
const offY = H / 2 - ((base.y + 1.5) / 2) * TILE_PX;

const tiles = [];
for (let ty = Math.floor(-offY / TILE_PX); ty <= Math.floor((H - offY) / TILE_PX); ty++)
    for (let tx = Math.floor(-offX / TILE_PX); tx <= Math.floor((W - offX) / TILE_PX); tx++)
        tiles.push({ tx, ty, left: tx * TILE_PX + offX, top: ty * TILE_PX + offY });

const cellBox = (dx, dy) => ({
    left: (base.x + dx) * CELL_PX + offX,
    top: (base.y + dy) * CELL_PX + offY,
});

const grid = [];
for (let dy = Math.ceil((-offY - base.y * CELL_PX) / CELL_PX); dy * CELL_PX + base.y * CELL_PX + offY < H; dy++)
    for (let dx = Math.ceil((-offX - base.x * CELL_PX) / CELL_PX); dx * CELL_PX + base.x * CELL_PX + offX < W; dx++)
        grid.push(cellBox(dx, dy));

const box = (b, style) =>
    `<div style="position:absolute;left:${b.left}px;top:${b.top}px;width:${CELL_PX}px;height:${CELL_PX}px;${style}"></div>`;

// invert+hue-rotate turns the light OSM raster into a dark basemap while KEEPING
// its labels legible; the brightness/saturate pull then drops it to the same
// tone as the phone panels either side of it.
const html = `<!doctype html><html><body style="margin:0;background:#0b0b0b">
<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#0b0b0b">
  <div style="position:absolute;inset:0;filter:invert(1) hue-rotate(180deg) saturate(0.16) brightness(0.46) contrast(1.18)">
    ${tiles.map((t) => `<img src="https://tile.openstreetmap.org/${SRC_Z}/${t.tx}/${t.ty}.png"
        style="position:absolute;left:${t.left}px;top:${t.top}px;width:${TILE_PX}px;height:${TILE_PX}px" />`).join('')}
  </div>
  ${grid.map((b) => box(b, 'border:1px solid rgba(148,163,184,0.22)')).join('')}
  ${SELECTED.map(([dx, dy]) => box(cellBox(dx, dy), `background:${GOLD}80;border:1px solid ${GOLD}f2`)).join('')}
  ${box(cellBox(...BOOKED), `background:${RED}61;border:1px solid ${RED}e6`)}
</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
// OSM's tile usage policy requires an identifying User-Agent.
await page.setUserAgent('POWR-partner-portal-asset-generator/1.0 (jamie@powr.life)');
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));   // let the filter settle
await page.screenshot({ path: OUT, type: 'webp', quality: 82, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();

console.log(`${tiles.length} tiles → ${OUT} (${statSync(OUT).size} bytes)`);
