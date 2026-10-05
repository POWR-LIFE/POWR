#!/usr/bin/env node
/**
 * Render a CHECKED blueprint at every size, on POWR's own preview photo, so
 * whoever made it can look before publishing (the weekly trend routine does):
 *   npm i --no-save playwright && npx playwright install chromium   (once)
 *   node scripts/blueprint-render.mjs blueprint.clean.json out-dir/
 * Starts the Vite dev server itself, renders through studio-lab.html, writes
 * <size>.png (and a <size>-<n>.png per extra colour on the post size).
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [file, outDir = 'blueprint-renders'] = process.argv.slice(2);
if (!file) {
    console.error('usage: node scripts/blueprint-render.mjs blueprint.clean.json [out-dir]');
    process.exit(2);
}
const blueprint = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5299;

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    console.error('playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
    process.exit(3);
}

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { vite.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/studio-lab.html`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
}

// Playwright's browser ignores HTTPS_PROXY, so in a sandbox whose only way
// out is that proxy (the cloud routine's) the Google Fonts request fails and
// every render silently falls back to a system font. Hand the proxy over.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
    args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'],
    ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}),
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/studio-lab.html`);
await page.waitForFunction(() => window.__studio, null, { timeout: 60000 });
const jobs = ['post', 'story', 'square', 'landscape', 'link', 'header'].map((format) => ({ format, name: format }));
(blueprint.swatches ?? []).slice(1).forEach((flood, i) => jobs.push({ format: 'post', name: `post-colour${i + 2}`, look: { flood } }));
for (const j of jobs) {
    const r = await page.evaluate((spec) => window.__studio.render(spec), {
        blueprint, format: j.format, photo: '/studio/preview.jpg', focal: { x: 0.8, y: 0.45 }, look: j.look, scale: 0.5,
    });
    fs.writeFileSync(path.join(outDir, `${j.name}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(`✓ ${j.name}`);
}
await browser.close();
stop();
if (errors.length) {
    console.error('page errors:', errors);
    process.exit(1);
}
