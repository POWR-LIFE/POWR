#!/usr/bin/env node
/**
 * Screenshots for the public how-to guides (/docs, /docs/gyms), taken from
 * the REAL portal pages signed in as a made-up gym owner or brand user.
 * Every Supabase call is answered from ./fixtures (see mock.mjs), so nothing
 * touches the database and no real member, gym or brand appears.
 *
 * Run it again whenever a portal page changes, then commit both outputs:
 *   1. in landing-page/:  npm run dev                      (port 5173)
 *   2.                    npm i --no-save puppeteer-core
 *   3.                    node scripts/docs-shots/capture.mjs [id-filter ...]
 * With no filter every shot is retaken; with one, only ids containing it
 * (`'=id'`, quoted for zsh, for exactly that id).
 * `--list` prints the shot ids; `--prune` drops images and entries no shot
 * defines any more. Uses the installed Google Chrome (CHROME=…).
 *
 * Writes public/docs/shots/<id>.webp and, for each shot, its size and the
 * numbered markers' positions into src/pages/docs/shots.json, which <Shot>
 * reads to pin the numbers onto the picture.
 *
 * A shot (shots/*.mjs, default export = array):
 *   id        unique, kebab-case; the file name and the <Shot id>
 *   portal    'gym' | 'partner' | 'none' (signed out)
 *   path      the portal route to open
 *   fixtures  { rest, rpc, fn, http } merged over the portal's fixtures
 *   storage   { local: {k: v}, session: {k: v} } seeded before load
 *   viewport  { width, height } (default 1280×900); mobile: true → 390×844
 *   ready     text or CSS selector to wait for before anything else
 *   prepare   async (page, h) => { … } clicks and typing; h has helpers below
 *   target    what to capture: CSS selector, { text, closest }, or omit for
 *             the viewport. pad: px of page around it (default 0)
 *   markers   { key: selector | { text, closest, anchor, dx, dy } }; anchor
 *             is tl (default) · tr · bl · br · center · left · right · top · bottom
 *   hide      CSS selectors made invisible before the shot
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AUTH_STORAGE_KEY, fakeSession, makeResponder, mergeFixtures } from './mock.mjs';
import { BASE_URL, BRAND, BRAND_USER, OWNER } from './world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'public/docs/shots');
const MANIFEST = path.join(ROOT, 'src/pages/docs/shots.json');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));

// A file that fails to load is skipped with a warning, so one broken fixture
// or spec doesn't stop every other shot.
async function loadDir(dir) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort() : [];
    const mods = [];
    for (const f of files) {
        try {
            mods.push({ file: f, mod: await import(pathToFileURL(path.join(dir, f)).href) });
        } catch (e) {
            console.warn(`  ! skipped ${path.basename(dir)}/${f}: ${e.message.split('\n')[0]}`);
        }
    }
    return mods;
}

// Vite's dev client, stubbed: every capture rewrites shots.json, which the
// docs import, and the real client would reload pages mid-shot. CSS still
// arrives through updateStyle.
const VITE_CLIENT_STUB = `export function createHotContext(){return {accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}
export function updateStyle(id,css){let s=document.querySelector('style[data-vite-dev-id="'+id+'"]');if(!s){s=document.createElement('style');s.setAttribute('data-vite-dev-id',id);document.head.appendChild(s);}s.textContent=css;}
export function removeStyle(id){document.querySelector('style[data-vite-dev-id="'+id+'"]')?.remove();}
export function injectQuery(u){return u}
export class ErrorOverlay{}`;

const fixtureMods = await loadDir(path.join(HERE, 'fixtures'));
// Order: <portal>-base, then <portal>-core (data several pages share), then
// each area's own file. A key belongs to ONE file: a second definition is
// reported, because whichever loads last would silently win.
const portalFixtures = (portal) => {
    const own = (name) => fixtureMods.filter(({ file }) => file === `${portal}-${name}.mjs`);
    const areas = fixtureMods.filter(({ file }) => file.startsWith(`${portal}-`) && ![`${portal}-base.mjs`, `${portal}-core.mjs`].includes(file));
    const ordered = [...own('base'), ...own('core'), ...areas];
    const seen = {};
    for (const { file, mod } of ordered) {
        for (const group of ['rest', 'rpc', 'fn', 'http']) {
            for (const key of Object.keys(mod.default?.[group] ?? {})) {
                const k = `${group} ${key}`;
                if (seen[k]) console.warn(`  ! ${k} is defined in both ${seen[k]} and ${file}; ${file} wins`);
                seen[k] = file;
            }
        }
    }
    return mergeFixtures(...ordered.map(({ mod }) => mod.default));
};

const shots = (await loadDir(path.join(HERE, 'shots'))).flatMap(({ file, mod }) => (mod.default ?? []).map((s) => ({ ...s, file })));
const dupes = shots.map((s) => s.id).filter((id, i, all) => all.indexOf(id) !== i);
if (dupes.length) { console.error('duplicate shot ids:', dupes.join(', ')); process.exit(1); }
if (args.includes('--list')) { for (const s of shots) console.log(`${s.id.padEnd(36)} ${s.file}`); process.exit(0); }
// A filter matches ids containing it; `=id` matches that id only.
const chosen = filters.length ? shots.filter((s) => filters.some((f) => (f.startsWith('=') ? s.id === f.slice(1) : s.id.includes(f)))) : shots;
if (!chosen.length) { console.error('no shots match', filters.join(' ')); process.exit(1); }

const assets = Object.fromEntries(fs.readdirSync(path.join(HERE, 'assets')).map((f) => [f, {
    data: fs.readFileSync(path.join(HERE, 'assets', f)),
    type: f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg',
}]));

// ── Finding things on the page ──────────────────────────────────────────────
// A selector is CSS, or { text, closest?, exact?, nth?, within?, up? }: the
// nth visible element whose own text contains `text`, then .closest(closest)
// or `up` parents. Text matching ignores case and runs of whitespace.
async function find(page, sel) {
    if (!sel) return null;
    if (typeof sel === 'function') return sel(page);
    if (typeof sel === 'string') {
        const el = await page.$(sel);
        if (!el) throw new Error(`no element for selector ${sel}`);
        return el;
    }
    const handle = await page.evaluateHandle((s) => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const want = norm(s.text);
        const root = s.within ? document.querySelector(s.within) : document.body;
        if (!root) return null;
        const own = (el) => norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
        const full = (el) => norm(el.innerText);
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        let hits = [...root.querySelectorAll('*')].filter((el) => visible(el) && (s.exact ? own(el) === want || full(el) === want : own(el).includes(want)));
        // Fall back to whole-text matches, keeping only the deepest ones.
        if (!hits.length) {
            hits = [...root.querySelectorAll('*')].filter((el) => visible(el) && full(el).includes(want));
            hits = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
        }
        let el = hits[s.nth ?? 0];
        if (!el) return null;
        if (s.closest) el = el.closest(s.closest) ?? el;
        for (let i = 0; i < (s.up ?? 0) && el.parentElement; i++) el = el.parentElement;
        return el;
    }, sel);
    const el = handle.asElement();
    if (!el) throw new Error(`no element with text "${sel.text}"`);
    return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, ready) {
    if (!ready) return;
    if (/^[.#[a-z]/.test(ready) && !/\s/.test(ready.trim())) {
        await page.waitForSelector(ready, { timeout: 30000 });
        return;
    }
    await page.waitForFunction((t) => document.body && document.body.innerText.replace(/\s+/g, ' ').toLowerCase().includes(t.toLowerCase()), { timeout: 30000 }, ready);
}

// Helpers handed to prepare().
const helpers = (page) => ({
    find: (sel) => find(page, sel),
    click: async (sel) => { const el = await find(page, typeof sel === 'string' && !/^[.#[a-z]/.test(sel) ? { text: sel, closest: 'button,a,[role=button],[role=tab],[role=radio],label' } : sel); await el.click(); await sleep(400); },
    type: async (sel, text) => { const el = await find(page, sel); await el.click({ clickCount: 3 }); await el.type(text); await sleep(200); },
    wait: (ready) => waitFor(page, ready),
    sleep,
    scrollTo: async (sel) => { const el = await find(page, sel); await el.evaluate((e) => e.scrollIntoView({ block: 'start' })); await sleep(300); },
});

function anchorPoint(box, anchor = 'tl', dx = 0, dy = 0) {
    const x = { tl: box.x, bl: box.x, left: box.x, tr: box.x + box.width, br: box.x + box.width, right: box.x + box.width }[anchor] ?? box.x + box.width / 2;
    const y = { tl: box.y, tr: box.y, top: box.y, bl: box.y + box.height, br: box.y + box.height, bottom: box.y + box.height }[anchor] ?? box.y + box.height / 2;
    return { x: x + dx, y: y + dy };
}

// Page coordinates (not viewport), so a target taller than the window works.
const pageBox = (el) => el.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });

async function capture(browser, shot, manifest) {
    const portal = shot.portal ?? 'none';
    const who = portal === 'partner'
        ? fakeSession({ id: BRAND_USER.id, email: BRAND_USER.email, metadata: { full_name: BRAND_USER.name } })
        : fakeSession({ id: OWNER.id, email: OWNER.email, metadata: { full_name: OWNER.name } });
    const fixtures = mergeFixtures(portal === 'none' ? {} : portalFixtures(portal), shot.fixtures);
    const unknown = new Set();

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const vp = shot.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900, ...shot.viewport };
    await page.setViewport({ ...vp, deviceScaleFactor: 2 });
    // A UK product: dd/mm/yyyy date fields and London time, whatever machine takes the shots.
    await page.emulateTimezone('Europe/London');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-GB' }).catch(() => {});
    await page.setRequestInterception(true);
    const respond = makeResponder({ fixtures, user: who.user, session: who.session, assets, unknown });
    page.on('request', (req) => (new URL(req.url()).pathname === '/@vite/client'
        ? req.respond({ status: 200, contentType: 'application/javascript', body: VITE_CLIENT_STUB })
        : respond(req)));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const local = { ...(shot.storage?.local ?? {}) };
    if (portal !== 'none') local[AUTH_STORAGE_KEY] = JSON.stringify(who.session);
    const session = { ...(shot.storage?.session ?? {}) };
    // The partner portal opens the delivery chooser once per visit until a method is set.
    if (portal === 'partner') session[`powr-partner-method-prompted:${BRAND.name.toLowerCase()}`] = '1';
    await page.evaluateOnNewDocument((l, s) => {
        for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v);
    }, local, session);

    try {
        await page.goto(BASE_URL + shot.path, { waitUntil: 'networkidle2', timeout: 60000 });
        await waitFor(page, shot.ready);
        await page.evaluate(() => document.fonts.ready);
        if (shot.prepare) await shot.prepare(page, helpers(page));
        await sleep(shot.settle ?? 900);
        // Stills: entrance animations jump to their end (pausing them can freeze
        // content on its first, invisible frame); loops like spinners stop where
        // they are. No caret, no half-finished transitions, no scrollbars.
        await page.evaluate(() => document.getAnimations().forEach((a) => {
            try { if (a.effect?.getTiming?.().iterations === Infinity) a.pause(); else a.finish(); } catch { /* finished already */ }
        }));
        await page.addStyleTag({ content: '*,*::before,*::after{transition-duration:0s!important;caret-color:transparent!important;scrollbar-width:none!important}::-webkit-scrollbar{display:none}' });
        for (const sel of shot.hide ?? []) await page.$$eval(sel, (els) => els.forEach((e) => { e.style.visibility = 'hidden'; }));
        await sleep(150);

        const pad = shot.pad ?? 0;
        let clip;
        if (shot.target) {
            let el = await find(page, shot.target);
            // Portal pages scroll inside fixed-height layouts, so anything below
            // the window paints black. A tall target gets a window tall enough.
            const first = await pageBox(el);
            if (first.height + pad * 2 > vp.height) {
                await page.setViewport({ ...vp, height: Math.ceil(first.height + pad * 2 + 80), deviceScaleFactor: 2 });
                await sleep(500);
                el = await find(page, shot.target);
            }
            await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
            await sleep(150);
            const b = await pageBox(el);
            clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
        } else {
            const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
            clip = { x: scroll.x, y: scroll.y, width: vp.width, height: vp.height };
        }
        clip = Object.fromEntries(Object.entries(clip).map(([k, v]) => [k, Math.round(v)]));

        const markers = {};
        for (const [key, sel] of Object.entries(shot.markers ?? {})) {
            const el = await find(page, sel);
            const b = await pageBox(el);
            const p = anchorPoint(b, sel.anchor, sel.dx, sel.dy);
            markers[key] = [+(((p.x - clip.x) / clip.width) * 100).toFixed(2), +(((p.y - clip.y) / clip.height) * 100).toFixed(2)];
        }

        await page.screenshot({ path: path.join(OUT_DIR, `${shot.id}.webp`), type: 'webp', quality: shot.quality ?? 82, clip, captureBeyondViewport: true });
        manifest[shot.id] = { w: clip.width, h: clip.height, markers, captured: new Date().toISOString().slice(0, 10) };
        const kb = Math.round(fs.statSync(path.join(OUT_DIR, `${shot.id}.webp`)).size / 1024);
        console.log(`✓ ${shot.id.padEnd(34)} ${clip.width}×${clip.height}  ${kb} KB  markers: ${Object.keys(markers).join(', ') || '-'}`);
    } catch (e) {
        console.log(`✗ ${shot.id.padEnd(34)} ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: path.join(OUT_DIR, `_failed-${shot.id}.png`) }).catch(() => {});
        process.exitCode = 1;
    } finally {
        if (unknown.size) console.log(`    no fixture for: ${[...unknown].join(' · ')}`);
        if (errors.length) console.log(`    page errors: ${errors.slice(0, 3).join(' | ').slice(0, 300)}`);
        await ctx.close();
    }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// This run's entries only: the file is re-read just before writing, so runs
// taking different shots at the same time don't overwrite each other.
const manifest = {};
const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Realtime sockets can't be intercepted, so they're pointed nowhere.
    args: ['--host-resolver-rules=MAP *.supabase.co 127.0.0.1', '--hide-scrollbars', '--font-render-hinting=none', '--lang=en-GB'],
});
try {
    for (const shot of chosen) await capture(browser, shot, manifest);
} finally {
    await browser.close();
}
// Merge into the current file, sorted so the diff stays readable. --prune also
// drops entries (and images) for shots no spec defines any more.
const current = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
let merged = { ...current, ...manifest };
if (args.includes('--prune')) {
    const ids = new Set(shots.map((s) => s.id));
    for (const id of Object.keys(merged)) {
        if (ids.has(id)) continue;
        delete merged[id];
        fs.rmSync(path.join(OUT_DIR, `${id}.webp`), { force: true });
    }
}
merged = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(MANIFEST, `${JSON.stringify(merged, null, 1)}\n`);
// Chrome's pipes can keep node alive after close; the work is done.
process.exit(process.exitCode ?? 0);
