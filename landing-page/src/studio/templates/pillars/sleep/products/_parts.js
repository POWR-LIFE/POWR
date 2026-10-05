/**
 * Shared by the Sleep product templates: the frame every layout starts from,
 * a night ground that can take a photo sunk deep into it, the accent as a
 * dim light, the lockup + eyebrow head, fitted titles and "a — b" lists.
 */
import { TYPE } from '../../../../fonts';
import { fitBlock, drawBlock, blockBox, splitLines, textWidth } from '../../../../text';
import { lockup } from '../../kit';
import { INK, MUTED, ground, wash, fadeTo, readable, label as baseLabel, line as baseLine } from '../_parts';

export { INK, SOFT, MUTED, DIM, HAIR, NIGHT_LOOK, nightRgba, readable, onAccent, moon, crescent, rrect, fadeTo } from '../_parts';

// {Accent} markup in small type uses the accent lifted to read on the night
// ground (a navy brand colour would vanish on it).
const lifted = (e) => (readable(e.accent) === e.accent ? e : { ...e, accent: readable(e.accent) });
/** One line of small text, shrunk to fit (sleep/_parts `line`, accent made readable). */
export const line = (e, ...a) => baseLine(lifted(e), ...a);
/** A tracked mono label (sleep/_parts `label`, accent made readable). */
export const label = (e, ...a) => baseLabel(lifted(e), ...a);

/** The safe frame and the layout family. */
export function frame(e) {
    const { W, H, safe, shape } = e;
    return {
        k: e.tu,
        x0: safe.l,
        x1: W - safe.r,
        y0: safe.t,
        y1: H - safe.b,
        tall: shape === 'tall',
        post: shape === 'post',
        sq: shape === 'square',
        wide: shape === 'wide',
        strip: shape === 'strip',
        side: shape === 'wide' || shape === 'strip',
    };
}

/** '#rrggbb' (or '#rgb') + alpha → rgba(); anything else falls back to POWR yellow. */
export function tint(c, a) {
    const s = String(c ?? '').trim();
    const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    let r = 250;
    let g = 204;
    let b = 21;
    if (m) {
        const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
        [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    return `rgba(${r},${g},${b},${a})`;
}

/**
 * The night ground. With a photo, it goes down first and is sunk under a
 * night wash so the product stays the hero. Returns true when a photo landed.
 */
export function nightGround(e, { glow = { x: 0.5, y: 0.35 }, sink = 0.6 } = {}) {
    const { ctx, W, H } = e;
    ground(e, glow);
    if (!e.hasMedia) return false;
    e.photo({ x: 0, y: 0, w: W, h: H });
    wash(ctx, 0, 0, W, H, sink);
    fadeTo(ctx, 0, H * 0.55, W, H * 0.45, 'bottom', 0.7);
    return true;
}

/** A soft round light in the accent, `a` at the centre, gone by `r`. */
export function glow(e, cx, cy, r, a = 0.16) {
    const { ctx } = e;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, tint(e.accent, a));
    g.addColorStop(0.45, tint(e.accent, a * 0.35));
    g.addColorStop(1, tint(e.accent, 0));
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
}

/** Lockup top-left, the eyebrow top-right on the lockup's middle. Returns the head's bottom. */
export function head(e, f, { h, eyebrowKey = 'eyebrow', eyebrowMax = 0.5 } = {}) {
    const lh = h ?? (f.strip ? 24 : f.tall ? 38 : f.wide ? 32 : 34) * f.k;
    const lk = lockup(e, f.x0, f.y0, lh, { maxW: (f.x1 - f.x0) * (1 - eyebrowMax) - 24 * f.k });
    const px = (f.strip ? 13 : 16) * f.k;
    label(e, eyebrowKey, e.fields[eyebrowKey], px, f.x1, f.y0 + lh / 2 + px * 0.36, { align: 'right', maxW: (f.x1 - f.x0) * eyebrowMax });
    return Math.max(lk.y + lk.h, f.y0 + lh);
}

/**
 * A title fitted to maxW × maxH (at most `max` px), first cap at `top`.
 * Returns { boxes, box, bottom (last baseline) }.
 */
export function title(e, key, text, x, top, { maxW, maxH, max = Infinity, lines = 2, align = 'left', spec, color, gap = 0.16 } = {}) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const ls = splitLines(text).slice(0, lines);
    const sp = spec ?? e.headline;
    const block = fitBlock(ctx, ls, sp, { maxW: maxW * size, maxH: maxH * size, max: max * size, gap });
    const acc = readable(e.accent);
    const boxes = drawBlock(ctx, block, sp, x, top, { align, color: color ?? (e.headlineAccent ? acc : INK), accent: acc });
    const box = ls.length ? blockBox(boxes) : null;
    if (box) e.mark(key, box);
    return { boxes, box, bottom: boxes[boxes.length - 1].baseline, px: block.px, cap: block.cap };
}

/** "Name — detail — more" per line → arrays of trimmed parts (at most n lines). */
export const parseRows = (text, n = 8) => splitLines(text).slice(0, n)
    .map((l) => l.split(/\s+[—–|]\s+|\s+-\s+/).map((s) => s.trim()))
    .filter((p) => p[0]);

/** A price: thin figures, an optional mono note before it. Returns the box. */
export function price(e, key, x, base, px, { align = 'left', maxW = Infinity, color = INK } = {}) {
    return line(e, key, e.fields[key], TYPE.brandL, px, x, base, { align, maxW, color });
}

/** Small mono text in the muted colour (small print). */
export const small = (e, key, x, base, px, opts = {}) =>
    line(e, key, e.fields[key], TYPE.monoR, px, x, base, { tracking: 0.04, color: MUTED, ...opts });

/** Width of a single line at px (for layouts that need to measure before drawing). */
export const measure = (e, text, spec, px, tracking = 0) => textWidth(e.ctx, String(text ?? ''), spec, px, tracking);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const bboxCache = new WeakMap();
/** The painted part of a cut-out as fractions of the image { x, y, w, h } (whole image if none). */
export function contentBox(img) {
    if (bboxCache.has(img)) return bboxCache.get(img);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = Math.max(1, Math.round((64 * img.height) / img.width));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let l = c.width;
    let t = c.height;
    let r = -1;
    let b = -1;
    for (let j = 0; j < c.height; j++) {
        for (let i = 0; i < c.width; i++) {
            if (d[(j * c.width + i) * 4 + 3] > 40) { l = Math.min(l, i); r = Math.max(r, i); t = Math.min(t, j); b = Math.max(b, j); }
        }
    }
    const out = r < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: l / c.width, y: t / c.height, w: (r - l + 1) / c.width, h: (b - t + 1) / c.height };
    bboxCache.set(img, out);
    return out;
}
