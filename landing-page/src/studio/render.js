/**
 * Renders one post: the template lays out the photo and type through the
 * env helpers below, then a print pass lays grain over everything.
 *
 * All sizes are in "u" — 1u is 1 px on the short side of a 1080 canvas — so
 * an export at 2× is the same design, twice the pixels.
 */
import { FORMATS, shapeOf } from './formats';
import { ensureFonts, TYPE } from './fonts';
import { createGrader, TINTS, blit } from './grade';
import { scratch, coverCrop, analyze, solveTone, motionBudget } from './media';
import { ensureLogo, drawLogo } from './logo';
import { fade, spot } from './shapes';
import { unionBox } from './text';

export const INK = '#F4F1EA';

export const COLOURWAYS = [
    { id: 'powr',   label: 'POWR',   accent: '#FACC15', headlineAccent: false },
    { id: 'gold',   label: 'Gold',   accent: '#FACC15', headlineAccent: true },
    { id: 'mono',   label: 'Mono',   accent: INK,       headlineAccent: false },
    { id: 'signal', label: 'Signal', accent: '#FF3B2F', headlineAccent: true },
];

let grader = null;

/** Fonts + logo. Must resolve before the first render. */
export async function prepareStudio() {
    const [fonts] = await Promise.all([ensureFonts(), ensureLogo()]);
    grader ??= createGrader();
    return fonts;
}

export const fieldDefaults = (template) =>
    Object.fromEntries(template.fields.filter((f) => f.type !== 'image').map((f) => [f.key, f.value]));

// A canvas of exactly w×h, created on first use and cleared on reuse.
function sized(c, w, h) {
    const canvas = c ?? document.createElement('canvas');
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.getContext('2d').clearRect(0, 0, w, h);
    return canvas;
}

// A stand-in 2D context whose draws go to whichever real context is current.
// Layered builds point it at the "under" layer, then at "over" once the
// photo is placed.
function switchable(initial) {
    let target = initial;
    const proxy = new Proxy({}, {
        get: (_, k) => {
            const v = target[k];
            return typeof v === 'function' ? v.bind(target) : v;
        },
        set: (_, k, v) => {
            target[k] = v;
            return true;
        },
    });
    return { proxy, to: (t) => { target = t; } };
}

/**
 * Draw `template` into `canvas`. Returns where the photo landed and how it
 * was cropped, so the editor can turn a click into a new focal point.
 *
 * With `layers` (live video playback), nothing is drawn to `canvas`: what the
 * template draws before the photo lands in `layers.under`, what it draws after
 * (fades, shading, type, logo) in `layers.over`, and the photo's grade is
 * recorded so compositeLayers() can re-grade each new frame between the two —
 * the type is set once, not 30 times a second.
 */
export function renderPost(canvas, opts) {
    const { template, format, media, fields = {}, style = {}, look = {}, focal = { x: 0.5, y: 0.45 }, zoom = 1, scale = 1, seed = 7, cache = null, layers = null, assets = null, bleed = 0 } = opts;
    const F = FORMATS[format];
    // Print bleed widens the canvas on every side; the design keeps the trim
    // size's scale and its type stays inside the trim's safe area.
    const b = Math.round(bleed * scale);
    const W = Math.round(F.w * scale) + 2 * b;
    const H = Math.round(F.h * scale) + 2 * b;
    const u = Math.min(F.w, F.h) * scale / 1080;
    let ctx;
    let toOver = null;
    if (layers) {
        layers.under = sized(layers.under, W, H);
        layers.over = sized(layers.over, W, H);
        layers.photo = null;
        Object.assign(layers, { W, H, u });
        const under = layers.under.getContext('2d');
        const over = layers.over.getContext('2d');
        under.imageSmoothingQuality = 'high';
        over.imageSmoothingQuality = 'high';
        const sw = switchable(under);
        ctx = sw.proxy;
        toOver = () => sw.to(over);
    } else {
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
    }
    ctx.fillStyle = '#0B0B0B';
    ctx.fillRect(0, 0, W, H);

    const lk = { ...template.look, ...look };
    const colourway = COLOURWAYS.find((c) => c.id === style.colourway) ?? COLOURWAYS[0];
    const accent = style.accent || colourway.accent;
    const info = { W, H, photo: null, boxes: {} };
    // Set once the photo is placed: its box, crop and grade, plus a copy of
    // the graded frame — what video shading is measured against.
    let placed = null;

    // Grade settings for the photo in a w×h box, shared by the still/export
    // path (pre-cropped source) and live video (uCrop on the raw frame).
    function gradeFor(L, stats, crop, w, h) {
        const tone = solveTone(stats, { target: L.target ?? 0.28, auto: L.auto ?? 0.85, exposure: L.exposure ?? 0 });
        // A photo that already has motion in it gets less of ours.
        const motion = (L.motion ?? 0) * (L.motionAuto === false ? 1 : motionBudget(stats.sharp));
        const fx = (focal.x * media.width - crop.sx) / crop.sw;
        const fy = (focal.y * media.height - crop.sy) / crop.sh;
        const tint = TINTS[L.tint] ?? TINTS.none;
        const angle = ((L.angle ?? 0) * Math.PI) / 180;
        return {
            motion, fx, fy,
            uniforms: {
                uSat: 1 - (L.mono ?? 1),
                uBlack: Math.min(0.6, tone.black + (L.crush ?? 0) * 0.1),
                uWhite: tone.white,
                uGamma: tone.gamma,
                uGain: tone.gain,
                uContrast: L.contrast ?? 0.5,
                uFade: L.fade ?? 0,
                uShadow: tint.shadow,
                uHigh: tint.high,
                uTint: tint.amount,
                uMotion: motion * 120 * u,
                uDir: [Math.cos(angle), Math.sin(angle)],
                uFocal: [fx, fy],
                uFocus: L.focus ?? 0.6,
                uVignette: L.vignette ?? 0.4,
                uGrain: (L.grain ?? 0.5) * 0.12,
                uGrainSize: 1.6 * u,
            },
        };
    }

    // Mean luminance of `c` (a graded copy of the photo) under a canvas-space
    // rect; null when the rect misses the photo (e.g. type beside Grid's inset).
    function photoLuma(c, rect) {
        const r = placed.rect;
        const x0 = Math.max(0, Math.floor(((rect.x - r.x) / r.w) * c.width));
        const y0 = Math.max(0, Math.floor(((rect.y - r.y) / r.h) * c.height));
        const x1 = Math.min(c.width, Math.ceil(((rect.x + rect.w - r.x) / r.w) * c.width));
        const y1 = Math.min(c.height, Math.ceil(((rect.y + rect.h - r.y) / r.h) * c.height));
        if (x1 <= x0 || y1 <= y0) return null;
        const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return sum / (d.length / 4) / 255;
    }

    // The clip's sampled frames (media.js) graded exactly like the photo, at a
    // quarter size — once per design, kept in the cache.
    function clipFrames() {
        if (cache?.clip) return cache.clip;
        const { rect, crop, uniforms } = placed;
        const ow = Math.max(24, Math.round(rect.w / 4));
        const oh = Math.max(24, Math.round(rect.h / 4));
        const frames = media.samples.map((sample) => {
            const out = grader.grade(sample, ow, oh, {
                ...uniforms,
                uCrop: [crop.sx / media.width, crop.sy / media.height, crop.sw / media.width, crop.sh / media.height],
                uAA: 1,
                uGrain: 0,
                uMotion: uniforms.uMotion * (ow / rect.w),
                uSeed: 1,
            });
            const c = document.createElement('canvas');
            c.width = ow;
            c.height = oh;
            blit(c.getContext('2d', { willReadFrequently: true }), out, 0, 0);
            return c;
        });
        if (cache) cache.clip = frames;
        return frames;
    }

    const env = {
        ctx, W, H, u,
        safe: { t: F.safe.t * scale + b, r: F.safe.r * scale + b, b: F.safe.b * scale + b, l: F.safe.l * scale + b },
        shape: shapeOf(F.w, F.h),
        // Text unit: u everywhere except the thin banner strips, where type is
        // sized off the strip's height or it would come out unreadably small.
        tu: shapeOf(F.w, F.h) === 'strip' ? (F.h * scale) / 560 : u,
        fields: { ...fieldDefaults(template), ...fields },
        look: lk,
        ink: INK,
        accent,
        headlineAccent: style.headlineAccent ?? colourway.headlineAccent,
        headline: TYPE[style.headlineFont || template.headlineFont] ?? TYPE.anton,
        caps: (s) => (lk.caps === false ? String(s ?? '') : String(s ?? '').toUpperCase()),
        hasMedia: !!media,

        /** Grade the photo into `rect`; returns the focal point in canvas px. */
        photo(rect, overrides = {}) {
            const L = { ...lk, ...overrides };
            const w = Math.max(1, Math.round(rect.w));
            const h = Math.max(1, Math.round(rect.h));
            if (!media) {
                const g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + h);
                g.addColorStop(0, '#2a2a28');
                g.addColorStop(1, '#121211');
                ctx.fillStyle = g;
                ctx.fillRect(rect.x, rect.y, w, h);
                info.photo = { rect, crop: null };
                return { x: rect.x + w * 0.5, y: rect.y + h * 0.42 };
            }
            const crop = coverCrop(media.width, media.height, w, h, focal, zoom);
            const r = { x: rect.x, y: rect.y, w, h };

            if (layers && media.stats) {
                // Live video: grade the <video> frame straight from its texture
                // (uCrop picks the window) — no 2D resample per frame.
                const g = gradeFor(L, media.stats, crop, w, h);
                const uniforms = {
                    ...g.uniforms,
                    uCrop: [crop.sx / media.width, crop.sy / media.height, crop.sw / media.width, crop.sh / media.height],
                    uAA: crop.sw / w > 1.4 ? 1 : 0,
                };
                layers.photoCanvas = sized(layers.photoCanvas, w, h);
                blit(layers.photoCanvas.getContext('2d'), grader.grade(media.source, w, h, { ...uniforms, uSeed: seed }), 0, 0);
                layers.photo = { rect: r, uniforms };
                placed = { rect: r, crop, uniforms: g.uniforms, now: layers.photoCanvas };
                toOver();
                info.photo = { rect: r, crop, size: { w: media.width, h: media.height }, stats: media.stats, motion: g.motion };
                return { x: rect.x + g.fx * w, y: rect.y + g.fy * h };
            }

            const s = scratch('crop', w, h);
            s.ctx.imageSmoothingQuality = 'high';
            s.ctx.clearRect(0, 0, w, h);
            s.ctx.drawImage(media.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
            // A video carries one exposure read for the whole clip (media.js);
            // re-reading every frame would make the grade pump.
            const stats = media.stats ?? analyze(s.canvas);
            const g = gradeFor(L, stats, crop, w, h);
            const graded = grader.grade(s.canvas, w, h, { ...g.uniforms, uSeed: seed });
            blit(ctx, graded, rect.x, rect.y, w, h);
            if (media.samples) {
                const now = scratch('probe-photo-now', Math.max(24, Math.round(w / 4)), Math.max(24, Math.round(h / 4)));
                blit(now.ctx, graded, 0, 0, now.canvas.width, now.canvas.height);
                placed = { rect: r, crop, uniforms: g.uniforms, now: now.canvas };
            }
            info.photo = { rect: r, crop, size: { w: media.width, h: media.height }, stats, motion: g.motion };
            return { x: rect.x + g.fx * w, y: rect.y + g.fy * h };
        },

        /** Mean luminance (0–1) of what has been drawn inside `rect` so far. */
        luma(rect) {
            const pw = 120;
            const ph = Math.round((pw * H) / W);
            const p = scratch('probe-luma', pw, ph);
            if (layers) {
                p.ctx.clearRect(0, 0, pw, ph);
                p.ctx.drawImage(layers.under, 0, 0, pw, ph);
                if (layers.photo) {
                    const r = layers.photo.rect;
                    p.ctx.drawImage(layers.photoCanvas, (r.x / W) * pw, (r.y / H) * ph, (r.w / W) * pw, (r.h / H) * ph);
                }
                p.ctx.drawImage(layers.over, 0, 0, pw, ph);
            } else {
                p.ctx.drawImage(canvas, 0, 0, pw, ph);
            }
            const x0 = Math.max(0, Math.floor((rect.x / W) * pw));
            const y0 = Math.max(0, Math.floor((rect.y / H) * ph));
            const x1 = Math.min(pw, Math.ceil(((rect.x + rect.w) / W) * pw));
            const y1 = Math.min(ph, Math.ceil(((rect.y + rect.h) / H) * ph));
            if (x1 <= x0 || y1 <= y0) return 0;
            const d = p.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            return sum / (d.length / 4) / 255;
        },

        fade: (x, y, w, h, from, alpha) => fade(ctx, x, y, w, h, from, alpha),

        /**
         * Keep light type readable: if the photo behind `rect` is brighter
         * than `ceiling`, lay a soft shadow under it — only as dark as needed.
         */
        shade(rect, { ceiling = 0.3, max = 0.62, spread = 1, form = 'spot' } = {}) {
            const measure = () => {
                let l = env.luma(rect);
                // Video: type has to read over the BRIGHTEST moment of the
                // clip, not just this frame. Scale the reading by how much
                // brighter the footage under it gets across the sampled frames
                // (fades and overlays scale with it, so the ratio carries them).
                if (placed && media?.samples) {
                    const now = photoLuma(placed.now, rect);
                    if (now !== null) {
                        const peak = Math.max(...clipFrames().map((c) => photoLuma(c, rect) ?? 0));
                        if (peak > now) l = now > 0.03 ? Math.min(1, (l * peak) / now) : Math.max(l, peak * 0.85);
                    }
                }
                return Math.min(max, Math.max(0, (l - ceiling) * 1.9));
            };
            let alpha;
            if (!cache) {
                alpha = measure();
            } else {
                // Cached per design with scale-free keys: measured once, then
                // shared by the preview, playback and export — steady on video,
                // and the file matches the screen.
                const key = [rect.x / W, rect.y / H, rect.w / W, rect.h / H, ceiling, max].map((v) => Math.round(v * 1000)).join(',');
                const shades = (cache.shade ??= new Map());
                if (!shades.has(key)) shades.set(key, measure());
                alpha = shades.get(key);
            }
            // A soft spot suits a word or a block; type too big for a spot gets
            // light falling off from the nearest edge instead.
            if (alpha > 0.02) {
                if (form === 'left') fade(ctx, 0, rect.y - rect.h * 0.1, (rect.x + rect.w) * 1.5 * spread, rect.h * 1.2, 'left', alpha);
                else if (form === 'top') fade(ctx, 0, 0, W, (rect.y + rect.h) * 1.25 * spread, 'top', alpha);
                else spot(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.72 * spread, rect.h * 1.05 * spread, alpha);
            }
            return alpha;
        },

        logo: (color, x, y, w) => drawLogo(ctx, color, x, y, w),

        /** An uploaded extra image (a partner logo…) for a template field, or null. */
        asset: (key) => assets?.[key]?.image ?? null,

        /** Record where a field's text landed (canvas px) for the editor's outline. */
        mark(key, box) {
            if (box) info.boxes[key] = unionBox(info.boxes[key], box);
        },
    };

    template.draw(env);

    if (layers) {
        layers.printGrain = lk.printGrain ?? 0.045;
        return info;
    }
    blit(ctx, grader.print(canvas, W, H, { uGrain: lk.printGrain ?? 0.045, uGrainSize: 1.5 * u, uSeed: seed + 0.37 }), 0, 0);
    return info;
}

/**
 * One live-video frame from prebuilt layers: under → this frame, graded →
 * over → print grain. A handful of GPU copies and one shader pass, so it keeps
 * up with 30 fps where a full renderPost() could not.
 */
export function compositeLayers(canvas, layers, source, { seed = 1, print = true } = {}) {
    const { W, H } = layers;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(layers.under, 0, 0);
    if (layers.photo) {
        const { rect, uniforms } = layers.photo;
        blit(ctx, grader.grade(source, rect.w, rect.h, { ...uniforms, uSeed: seed }), rect.x, rect.y);
    }
    ctx.drawImage(layers.over, 0, 0);
    if (print) {
        blit(ctx, grader.print(canvas, W, H, { uGrain: layers.printGrain, uGrainSize: 1.5 * layers.u, uSeed: seed + 0.37 }), 0, 0);
    }
}
