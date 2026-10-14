/**
 * Extra images a template can take besides the photo — a partner's logo, a
 * product shot. Logos arrive in every state (transparent PNG, logo on a white
 * JPG, huge margins), so each upload is cleaned the same way: a flat
 * background is keyed out, then the image is trimmed to its ink.
 *
 * A product is cut out more carefully (`background: 'edges'`): only the
 * background that reaches the photo's edges goes, so a white tub on white
 * keeps its white body — and where the product is close to its background
 * colour anyway, the photo is kept whole unless the editor says cut it out.
 */

const MAX_EDGE = 1600;

// Colour distance (|ΔR|+|ΔG|+|ΔB|) below SURE is background; up to SOFT is the
// anti-aliased fringe between it and the subject.
const SURE = 24;
const SOFT = 72;

/**
 * The file as an image ready for a template. `background`: 'all' keys out
 * every pixel of a flat background's colour (a logo's counters too); 'edges'
 * only the background connected to the border (a product). For 'edges' the
 * result also carries `source` (the photo as uploaded), `cutout` (it cut out)
 * and `keep` (which one `image` is): `keep` undefined lets the photo decide.
 */
export async function loadAsset(file, { background = 'all', keep } = {}) {
    let bmp;
    try {
        bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        throw new Error('That file could not be read as an image — PNG, JPG, WebP or SVG.');
    }
    const s = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s));
    const h = Math.max(1, Math.round(bmp.height * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const name = file.name || 'image';
    const cut = keyOutFlatBackground(c, background);
    if (!cut) return { image: trim(c), name };
    if (background !== 'edges') return { image: trim(cut.canvas), name };
    const cutout = trim(cut.canvas);
    const k = keep ?? cut.risky;
    return { image: k ? c : cutout, name, source: c, cutout, keep: k };
}

/** The same asset showing its cut-out (keep false) or the photo as uploaded (keep true). */
export function withBackground(a, keep) {
    if (!a?.source || a.keep === keep) return a;
    return withPreview({ ...a, image: keep ? a.source : a.cutout, keep });
}

/**
 * No transparency but four matching corners (a logo on white, or on black):
 * a copy with that colour made transparent, feathered so edges stay smooth —
 * or null when there's no flat background to take. With 'edges', `risky`
 * says the subject itself is mostly near that colour (white on white), where
 * a cut-out would lose its highlights wherever they touch the outline.
 */
function keyOutFlatBackground(src, mode) {
    const w = src.width;
    const h = src.height;
    const img = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return null; // already has alpha
    const at = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const bg = corners[0];
    const close = (a, b, t) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < t;
    if (!corners.every((c) => close(c, bg, 30))) return null;
    const n = w * h;
    const dist = new Uint16Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) dist[i] = Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]);
    let risky = false;
    if (mode === 'edges') {
        // Background = near-bg pixels reachable from the border (flood fill).
        const out = new Uint8Array(n);
        const q = new Int32Array(n);
        let head = 0;
        let tail = 0;
        const push = (i) => { if (!out[i] && dist[i] < SURE) { out[i] = 1; q[tail++] = i; } };
        for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
        while (head < tail) {
            const i = q[head++];
            const x = i % w;
            if (x > 0) push(i - 1);
            if (x < w - 1) push(i + 1);
            if (i >= w) push(i - w);
            if (i < n - w) push(i + w);
        }
        // The fringe: two pixels round the background, faded by colour.
        let ring = out;
        const fringe = new Uint8Array(n);
        for (let step = 0; step < 2; step++) {
            const next = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
                if (out[i] || fringe[i]) continue;
                const x = i % w;
                if ((x > 0 && ring[i - 1]) || (x < w - 1 && ring[i + 1]) || (i >= w && ring[i - w]) || (i < n - w && ring[i + w])) next[i] = 1;
            }
            for (let i = 0; i < n; i++) if (next[i]) fringe[i] = 1;
            ring = next;
        }
        let subject = 0;
        let pale = 0;
        for (let i = 0, p = 3; i < n; i++, p += 4) {
            if (out[i]) { d[p] = 0; continue; }
            if (fringe[i] && dist[i] < SOFT) { d[p] = Math.round(((Math.max(dist[i], SURE) - SURE) / (SOFT - SURE)) * 255); continue; }
            subject++;
            if (dist[i] < SOFT) pale++;
        }
        risky = subject > 0 && pale / subject > 0.3;
    } else {
        for (let i = 0, p = 3; i < n; i++, p += 4) d[p] = dist[i] < SURE ? 0 : dist[i] < SOFT ? Math.round(((dist[i] - SURE) / (SOFT - SURE)) * 255) : 255;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(img, 0, 0);
    return { canvas: c, risky };
}

/** Crop a canvas to its non-transparent pixels. */
export function trim(src) {
    const w = src.width;
    const h = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return src;
    const t = document.createElement('canvas');
    t.width = x1 - x0 + 1;
    t.height = y1 - y0 + 1;
    t.getContext('2d').drawImage(src, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
    return t;
}

const tints = new WeakMap();

/** The image as a flat silhouette in `color` (e.g. an all-white logo on dark). */
export function tinted(img, color) {
    let byColor = tints.get(img);
    if (!byColor) { byColor = new Map(); tints.set(img, byColor); }
    if (!byColor.has(color)) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, c.width, c.height);
        byColor.set(color, c);
    }
    return byColor.get(color);
}

/**
 * Fit `img` inside a box (contain), optionally turned 90° so it reads bottom
 * to top — how the partner series sets wordmarks. Returns the drawn box.
 */
export function drawContained(ctx, img, box, { rotate = false, align = 'center' } = {}) {
    const iw = rotate ? img.height : img.width;
    const ih = rotate ? img.width : img.height;
    const s = Math.min(box.w / iw, box.h / ih);
    const w = iw * s;
    const h = ih * s;
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
    const y = box.y + (box.h - h) / 2;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    if (rotate) {
        ctx.translate(x, y + h);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, 0, 0, h, w);
    } else {
        ctx.drawImage(img, x, y, w, h);
    }
    ctx.restore();
    return { x, y, w, h };
}

/**
 * Mean luminance of an image's opaque pixels (sampled small) — tells a dark
 * logo, which goes white on the dark ground, from a light or colourful one.
 */
const lumaCache = new WeakMap();
export function inkLuma(img) {
    if (lumaCache.has(img)) return lumaCache.get(img);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = Math.max(1, Math.round((64 * img.height) / img.width));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
    }
    const l = n ? sum / n / 255 : 1;
    lumaCache.set(img, l);
    return l;
}

/** The asset with a small preview (data URL) of its image, for the field that shows it. */
function withPreview(a) {
    const pv = document.createElement('canvas');
    const k = Math.min(1, 160 / Math.max(a.image.width, a.image.height));
    pv.width = Math.max(1, Math.round(a.image.width * k));
    pv.height = Math.max(1, Math.round(a.image.height * k));
    pv.getContext('2d').drawImage(a.image, 0, 0, pv.width, pv.height);
    a.preview = pv.toDataURL();
    return a;
}

/** loadAsset, plus a small preview (data URL) for the field that shows it. */
export async function assetWithPreview(file, opts) {
    return withPreview(await loadAsset(file, opts));
}
