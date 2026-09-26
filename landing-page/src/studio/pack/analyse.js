/**
 * What each photo offers a template, read from a small copy (the photo is
 * decoded once and let go; a 480 px thumbnail is kept to show it and to
 * preview posts):
 *   - quality: sharp enough, not murky or blown out, big enough;
 *   - subject: where the action is (crops and type steer by it);
 *   - calm: how quiet each edge band is — where a headline can sit;
 *   - hash: a fingerprint, so a burst of near-identical shots counts once.
 */
import { analyze, scratch } from '../media';

const THUMB = 480;

export async function analysePhoto(file) {
    let bmp;
    try {
        bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return { ok: false, reason: /hei[cf]/i.test(`${file.name} ${file.type}`) ? 'heic' : 'unreadable' };
    }
    const { width, height } = bmp;
    const k = Math.min(1, THUMB / Math.max(width, height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(width * k));
    thumb.height = Math.max(1, Math.round(height * k));
    const tctx = thumb.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(bmp, 0, 0, thumb.width, thumb.height);
    bmp.close?.();
    return { ok: true, kind: 'photo', width, height, thumb, ...read(thumb) };
}

/** A clip: its size, length and a frame a quarter of the way in. */
export async function analyseClip(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    try {
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
        const duration = Number.isFinite(v.duration) ? v.duration : 0;
        await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(duration * 0.25, Math.max(0, duration - 0.1)); });
        const k = Math.min(1, THUMB / Math.max(v.videoWidth, v.videoHeight));
        const thumb = document.createElement('canvas');
        thumb.width = Math.max(1, Math.round(v.videoWidth * k));
        thumb.height = Math.max(1, Math.round(v.videoHeight * k));
        thumb.getContext('2d').drawImage(v, 0, 0, thumb.width, thumb.height);
        return { ok: true, kind: 'clip', width: v.videoWidth, height: v.videoHeight, duration, thumb, ...read(thumb) };
    } catch {
        return { ok: false, reason: 'unreadable' };
    } finally {
        v.removeAttribute('src');
        v.load();
        URL.revokeObjectURL(url);
    }
}

/**
 * Many at once, three at a time — decoding runs off the main thread, so three
 * in flight is about twice as fast as one by one. Results keep input order.
 */
export async function analyseAll(items, { onProgress, concurrency = 3 } = {}) {
    const out = new Array(items.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = items[i].kind === 'clip' ? await analyseClip(items[i].file) : await analysePhoto(items[i].file);
            onProgress?.(++done, items.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return out;
}

// Everything that can be read off the thumbnail.
function read(src) {
    const stats = analyze(src); // luminance percentiles + sharpness, as the grade reads them
    const w = 48;
    const h = Math.max(8, Math.round((w * src.height) / src.width));
    const { ctx } = scratch('probe-pack', w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    // Edge energy: where there's detail (people, kit, text) and where it's quiet.
    const E = new Float32Array(w * h);
    let total = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            E[i] = Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]);
            total += E[i];
        }
    }
    const mean = total / Math.max(1, (w - 2) * (h - 2)) || 1;
    const band = (x0, y0, x1, y1) => {
        let s = 0;
        let n = 0;
        for (let y = Math.max(1, Math.floor(y0 * h)); y < Math.min(h - 1, Math.ceil(y1 * h)); y++) {
            for (let x = Math.max(1, Math.floor(x0 * w)); x < Math.min(w - 1, Math.ceil(x1 * w)); x++) { s += E[y * w + x]; n++; }
        }
        return n ? s / n : mean;
    };
    // 1 = as quiet as can be, 0 = as busy as the photo gets.
    const calmOf = (e) => Math.min(1, Math.max(0, (1.3 - e / mean) / 1));
    const calm = {
        top: calmOf(band(0, 0, 1, 0.3)),
        bottom: calmOf(band(0, 0.7, 1, 1)),
        left: calmOf(band(0, 0, 0.4, 1)),
        right: calmOf(band(0.6, 0, 1, 1)),
    };
    // The subject: the weight of the detail, pulled toward the middle.
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const dx = x / w - 0.5;
            const dy = y / h - 0.45;
            const wt = E[y * w + x] ** 1.5 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
            sx += wt * (x / w);
            sy += wt * (y / h);
            sw += wt;
        }
    }
    const clamp = (v) => Math.min(0.8, Math.max(0.2, v));
    const subject = sw ? { x: clamp(sx / sw), y: clamp(sy / sw) } : { x: 0.5, y: 0.45 };
    return { stats, calm, subject, hash: dhash(src) };
}

// 64-bit difference hash of a 9×8 grey copy, as 16 hex digits.
function dhash(src) {
    const { ctx } = scratch('probe-dhash', 9, 8);
    ctx.drawImage(src, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = (x, y) => { const i = (y * 9 + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
    let hex = '';
    for (let y = 0; y < 8; y++) {
        let byte = 0;
        for (let x = 0; x < 8; x++) byte = (byte << 1) | (g(x, y) > g(x + 1, y) ? 1 : 0);
        hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
}

/** Bits that differ between two hashes (0–64). */
export function hashDistance(a, b) {
    let n = 0;
    for (let i = 0; i < 16; i += 2) {
        let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
        while (x) { n += x & 1; x >>= 1; }
    }
    return n;
}

/**
 * 0–1: how good a photo is to post. Motion blur is welcome (it's the house
 * look), so softness only costs once a photo is really out of focus; murky or
 * blown-out exposure and small files cost more.
 */
export function quality(a) {
    const { lo, mid, hi, sharp } = a.stats;
    const focus = Math.min(1, Math.max(0, (sharp - 40) / 360));
    const exposure = 1 - Math.min(1, Math.abs(mid - 0.4) * 1.5);
    const range = Math.min(1, Math.max(0, (hi - lo) / 0.6));
    const size = Math.min(1, Math.min(a.width, a.height) / 1080);
    return 0.35 * focus + 0.3 * exposure + 0.2 * range + 0.15 * size;
}

/** Why a photo would come last, or null. */
export function weakness(a) {
    const { mid, hi, sharp } = a.stats;
    if (mid < 0.07 && hi < 0.35) return 'dark';
    if (sharp < 40) return 'soft';
    if (mid > 0.9) return 'bright';
    if (Math.min(a.width, a.height) < 640) return 'small';
    return null;
}

/**
 * Group near-identical shots (bursts): each group keeps its best photo as the
 * pick; the rest are marked with the pick they duplicate.
 */
export function markDuplicates(items, threshold = 10) {
    const photos = items.filter((m) => m.kind === 'photo' && m.analysis?.ok);
    const parent = new Map(photos.map((m) => [m.id, m.id]));
    const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
    for (let i = 0; i < photos.length; i++) {
        for (let j = i + 1; j < photos.length; j++) {
            if (hashDistance(photos[i].analysis.hash, photos[j].analysis.hash) <= threshold) {
                parent.set(find(photos[j].id), find(photos[i].id));
            }
        }
    }
    const groups = new Map();
    for (const m of photos) {
        const root = find(m.id);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(m);
    }
    const dupOf = new Map();
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const best = group.reduce((a, b) => (quality(b.analysis) > quality(a.analysis) ? b : a));
        for (const m of group) if (m !== best) dupOf.set(m.id, best.id);
    }
    return dupOf;
}
