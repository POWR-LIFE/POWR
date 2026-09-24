/**
 * Photo loading, cropping and the auto-exposure read that lets any upload
 * land on the same grade.
 */

// Longest edge kept in memory. A 12 MP phone photo decodes to ~48 MB of
// RGBA; 3200 px still leaves headroom to zoom a 9:16 crop.
const MAX_EDGE = 3200;

const scratches = new Map();

/** Reusable offscreen canvases, keyed so nested users never share one. */
export function scratch(key, w, h) {
    let s = scratches.get(key);
    if (!s) {
        const canvas = document.createElement('canvas');
        s = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: key.startsWith('probe') }) };
        scratches.set(key, s);
    }
    if (s.canvas.width !== w) s.canvas.width = w;
    if (s.canvas.height !== h) s.canvas.height = h;
    return s;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;

export const isVideoInput = (input) =>
    typeof input === 'string' ? VIDEO_EXT.test(input) : /^video\//.test(input?.type || '') || VIDEO_EXT.test(input?.name || '');

const once = (el, ok, fail = 'error') => new Promise((resolve, reject) => {
    const done = () => { el.removeEventListener(ok, done); el.removeEventListener(fail, bad); resolve(); };
    const bad = () => { el.removeEventListener(ok, done); el.removeEventListener(fail, bad); reject(new Error('media error')); };
    el.addEventListener(ok, done);
    el.addEventListener(fail, bad);
});

/**
 * A video becomes a muted, looping <video> the preview draws each frame from.
 * Its exposure is read ONCE from frames across the clip and reused for every
 * frame — per-frame auto-exposure would pump and flicker.
 */
async function loadVideo(input) {
    const blob = typeof input === 'string' ? null : input;
    const url = blob ? URL.createObjectURL(blob) : input;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = url;
    try {
        await once(video, 'loadeddata');
    } catch {
        throw new Error('That video could not be read here — MP4 (H.264) works everywhere; iPhone HEVC needs Chrome or Safari on a Mac.');
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;

    // Six small frames spread across the clip: the exposure read averages
    // them, and the templates measure their text shading against the
    // brightest of them, so type stays legible for the whole clip.
    const sw = 240;
    const sh = Math.max(1, Math.round((sw * height) / width));
    const samples = [];
    const reads = [];
    for (const f of [0.06, 0.24, 0.42, 0.6, 0.78, 0.94]) {
        video.currentTime = Math.min(Math.max(0, duration * f), Math.max(0, duration - 0.05));
        await once(video, 'seeked').catch(() => {});
        const c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        c.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, sw, sh);
        samples.push(c);
        reads.push(analyze(c));
    }
    const avg = (k) => reads.reduce((sum, r) => sum + r[k], 0) / reads.length;
    video.currentTime = 0;
    await once(video, 'seeked').catch(() => {});

    return {
        kind: 'video',
        source: video,
        width,
        height,
        duration,
        name: blob?.name || url.split('/').pop().split('?')[0],
        blob,
        url,
        stats: { lo: avg('lo'), mid: avg('mid'), hi: avg('hi'), sharp: avg('sharp') },
        samples,
    };
}

/**
 * Decode a File or URL into something drawImage and WebGL can take, with the
 * EXIF rotation applied and the long edge capped at MAX_EDGE. Videos go to
 * loadVideo().
 */
export async function loadMedia(input) {
    if (isVideoInput(input)) return loadVideo(input);
    let bitmap;
    let name = 'photo';
    if (typeof input === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.src = input;
        await img.decode();
        bitmap = img;
        name = input.split('/').pop().split('?')[0];
    } else {
        name = input.name || name;
        try {
            bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
        } catch {
            const heic = /\.hei[cf]$/i.test(name) || /hei[cf]/i.test(input.type || '');
            throw new Error(heic
                ? 'HEIC photos only open in Safari — export it as JPEG, or open the Studio in Safari.'
                : 'That file could not be read as an image.');
        }
    }
    const w0 = bitmap.naturalWidth || bitmap.width;
    const h0 = bitmap.naturalHeight || bitmap.height;
    const s = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    if (s === 1) return { kind: 'image', source: bitmap, width: w0, height: h0, name };

    const w = Math.round(w0 * s);
    const h = Math.round(h0 * s);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return { kind: 'image', source: canvas, width: w, height: h, name };
}

/**
 * The source rectangle that covers a w×h box, centred on `focal` (0–1 in the
 * source) as far as the edges allow. zoom > 1 tightens the crop.
 */
export function coverCrop(srcW, srcH, w, h, focal = { x: 0.5, y: 0.5 }, zoom = 1) {
    const scale = Math.max(w / srcW, h / srcH) * Math.max(1, zoom);
    const sw = w / scale;
    const sh = h / scale;
    const sx = Math.min(Math.max(focal.x * srcW - sw / 2, 0), srcW - sw);
    const sy = Math.min(Math.max(focal.y * srcH - sh / 2, 0), srcH - sh);
    return { sx, sy, sw, sh };
}

/**
 * What's actually in frame: luminance percentiles, plus `sharp` — the
 * variance of the Laplacian at 96 px wide (measured through the browser's
 * high-quality downscale). Sharp gym shots score ~2500–7500; photos that
 * already carry motion blur score under ~700, and adding more synthetic
 * blur to those turns them to mush.
 */
export function analyze(canvas) {
    const w = 96;
    const h = Math.max(1, Math.round((w * canvas.height) / canvas.width));
    const { ctx } = scratch('probe-analyze', w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const hist = new Uint32Array(256);
    const lum = new Float32Array(w * h);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
        const l = 0.36 * d[i] + 0.53 * d[i + 1] + 0.11 * d[i + 2];
        lum[i / 4] = l;
        hist[Math.min(255, Math.round(l))]++;
        n++;
    }
    let s1 = 0;
    let s2 = 0;
    let k = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const lap = lum[i - w] + lum[i + w] + lum[i - 1] + lum[i + 1] - 4 * lum[i];
            s1 += lap;
            s2 += lap * lap;
            k++;
        }
    }
    const sharp = k ? s2 / k - (s1 / k) ** 2 : 0;
    const pct = (p) => {
        let acc = 0;
        for (let i = 0; i < 256; i++) {
            acc += hist[i];
            if (acc >= p * n) return i / 255;
        }
        return 1;
    };
    return { lo: pct(0.015), mid: pct(0.5), hi: pct(0.985), sharp };
}

/** How much of the template's motion blur a photo can take (0.2–1). */
export const motionBudget = (sharp) => Math.min(1, Math.max(0.2, (sharp - 400) / 1800));

/**
 * Levels + gamma that put this photo's median on the template's target, so a
 * bright street shot and a dark gym shot come out at the same key. `auto`
 * (0–1) is how much of the stretch to apply — foggy, soft photos want less.
 *
 * Gamma alone can't pull a high-key photo down to a night-time key without
 * crushing it, so past a point the rest comes from gain (a dimmer, not a curve).
 */
export function solveTone(stats, { target = 0.3, auto = 0.85, exposure = 0 }) {
    const black = stats.lo * auto;
    const white = 1 - (1 - stats.hi) * auto;
    const mid = Math.min(0.98, Math.max(0.02, (stats.mid - black) / Math.max(0.05, white - black)));
    const t = Math.min(0.85, Math.max(0.04, target * 2 ** exposure));
    const gamma = Math.min(2.4, Math.max(0.45, Math.log(t) / Math.log(mid)));
    const gain = Math.min(1, Math.max(0.42, t / mid ** gamma));
    return { black, white, gamma, gain };
}
