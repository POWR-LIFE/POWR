/**
 * Extra images a template can take besides the photo — a partner's logo, a
 * product shot. Logos arrive in every state (transparent PNG, logo on a white
 * JPG, huge margins), so each upload is cleaned the same way: a flat
 * background is keyed out, then the image is trimmed to its ink.
 */

const MAX_EDGE = 1600;

export async function loadAsset(file) {
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
    keyOutFlatBackground(ctx, w, h);
    return { image: trim(c), name: file.name || 'image' };
}

// No transparency but four matching corners (a logo on white, or on black):
// make that colour transparent, feathered so edges stay smooth.
function keyOutFlatBackground(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return; // already has alpha
    const at = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const bg = corners[0];
    const close = (a, b, t) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < t;
    if (!corners.every((c) => close(c, bg, 30))) return;
    for (let i = 0; i < d.length; i += 4) {
        const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
        d[i + 3] = dist < 24 ? 0 : dist < 72 ? Math.round(((dist - 24) / 48) * 255) : 255;
    }
    ctx.putImageData(img, 0, 0);
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
