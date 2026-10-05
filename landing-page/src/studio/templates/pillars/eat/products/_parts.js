/**
 * Shared by the Eat product templates: the stage a product stands on (a dark
 * ground, an accent glow), a product slot that frames a rectangular shot on
 * purpose, and the small type pieces every layout sets (eyebrows, fitted
 * headlines, per-serving stats, wrapped lines).
 */
import { TYPE } from '../../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines, capHeight, textWidth } from '../../../../text';
import { rule } from '../../../../shapes';
import { productShot, isCutout, textOn, mockRect } from '../../kit';
import { INK, SOFT, GREY, DIM, HAIR, lift, mix, alpha, luminance, rows, num, fitPx } from '../_parts';

export { INK, SOFT, GREY, DIM, HAIR, lift, mix, alpha, luminance, rows, num, fitPx, textOn };

export const GROUND = '#0C0C0B';

/** The size unit: type on banner strips is sized off the strip's height. */
export const unitOf = (e) => (e.shape === 'strip' ? e.tu : e.u);

/** The dark ground over the whole canvas. */
export function ground(e, colour = GROUND) {
    e.ctx.fillStyle = colour;
    e.ctx.fillRect(0, 0, e.W, e.H);
}

/** A soft pool of the accent: the light a product is staged in. */
export function glow(e, cx, cy, r, { strength = 1, colour = e.accent, sy = 1 } = {}) {
    const { ctx } = e;
    if (r <= 0) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    // A dark brand colour barely shows on black: lift it a little.
    const c = luminance(colour) < 0.08 ? mix(colour, INK, 0.18) : colour;
    g.addColorStop(0, alpha(c, 0.62 * strength));
    g.addColorStop(0.35, alpha(c, 0.34 * strength));
    g.addColorStop(0.7, alpha(c, 0.09 * strength));
    g.addColorStop(1, alpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** True when the uploaded product shot is a rectangle (framed, not cut out). */
export const framed = (e) => {
    const img = e.asset('product');
    return !!img && !isCutout(img);
};

/** A rect of aspect `ar` (w/h) fitted inside `box`, placed by align / valign. */
export function fitAspect(box, ar, { align = 'center', valign = 'bottom' } = {}) {
    let w = box.w;
    let h = w / ar;
    if (h > box.h) { h = box.h; w = h * ar; }
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
    const y = valign === 'top' ? box.y : valign === 'center' ? box.y + (box.h - h) / 2 : box.y + box.h - h;
    return { x, y, w, h };
}

/** Where the product will land in `box` (what productShot draws), without drawing it. */
export function productRect(e, box, { kind = 'tub', align = 'center', valign = 'bottom', frame = 0.8 } = {}) {
    const img = e.asset('product');
    if (!img) return mockRect(box, kind, align);
    if (!isCutout(img)) return fitAspect(box, frame, { align, valign });
    const s = Math.min(box.w / img.width, box.h / img.height);
    const w = img.width * s;
    const h = img.height * s;
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
    return { x, y: box.y + box.h - h, w, h };
}

/**
 * A pool of warm light on the floor under a product and a faint wash behind
 * it, soft on every edge (no drop shadow).
 */
export function pool(e, cx, baseY, w, strength = 1) {
    const { ctx } = e;
    ctx.save();
    ctx.translate(cx, baseY - w * 0.3);
    ctx.scale(1, 0.9);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.85);
    g.addColorStop(0, `rgba(255,250,235,${0.1 * strength})`);
    g.addColorStop(0.55, `rgba(255,250,235,${0.035 * strength})`);
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(1, 0.1);
    const f = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.62);
    f.addColorStop(0, `rgba(255,250,235,${0.24 * strength})`);
    f.addColorStop(0.6, `rgba(255,250,235,${0.07 * strength})`);
    f.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * The product in `box`. A framed shot gets a box of its own aspect (`frame`,
 * w/h) inside the slot rather than a crop of the whole slot, so a lineup of
 * framed shots reads as cards, and one hero reads as a print. A cut-out or
 * the stand-in stands in a pool of light (`stage` 0–1; 0 for none).
 */
export function slot(e, box, { kind = 'tub', label, sub = '', align = 'center', valign = 'bottom', frame = 0.8, stage = 1, radius = 18 } = {}) {
    const isFramed = framed(e);
    const b = isFramed ? fitAspect(box, frame, { align, valign }) : box;
    if (stage && !isFramed) {
        const r = productRect(e, box, { kind, align });
        pool(e, r.x + r.w / 2, r.y + r.h, Math.max(r.w, r.h * 0.55), stage);
    }
    return productShot(e, b, { kind, label, sub, align, stage: false, radius });
}

/**
 * A photo dropped on a template that doesn't need one: set far back, dim,
 * behind everything (the one e.photo call). Returns true if drawn.
 */
export function backdrop(e, rect, { dim = 0.7 } = {}) {
    if (!e.hasMedia) return false;
    const r = rect ?? { x: 0, y: 0, w: e.W, h: e.H };
    e.photo(r, { target: 0.2, vignette: 0.7 });
    e.ctx.fillStyle = `rgba(12,12,11,${dim})`;
    e.ctx.fillRect(r.x, r.y, r.w, r.h);
    return true;
}

/** One line of text shrunk to fit `maxW`, marked as `key`. Returns its box. */
export function line(e, key, text, spec, px, x, y, { maxW = Infinity, align = 'left', tracking = 0, color = INK } = {}) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    const p = fitPx(e.ctx, s, spec, px, maxW, tracking);
    const box = drawText(e.ctx, s, spec, p, x, y, { align, tracking, color, accent: lift(e.accent) });
    if (key) e.mark(key, box);
    return box;
}

/** A tracked mono eyebrow, in caps unless the look says not. */
export const eyebrow = (e, key, text, px, x, y, opts = {}) =>
    line(e, key, e.caps(text), TYPE.mono, px, x, y, { tracking: 0.18, color: GREY, ...opts });

/**
 * The headline block (e.headline, the editor's size knob) fitted to
 * maxW × maxH with its first cap at `top`. Returns { box, bottom, px }.
 */
export function head(e, key, text, x, top, { maxW, maxH, align = 'left', color, gap = 0.16, spec, max = Infinity, lines = 4 } = {}) {
    const { ctx } = e;
    const ls = splitLines(text).slice(0, lines);
    const sp = spec ?? e.headline;
    if (!ls.some((l) => l.trim())) return { box: null, bottom: top, px: 0, h: 0 };
    const k = e.look.size ?? 1;
    const block = fitBlock(ctx, ls, sp, { maxW: maxW * k, maxH: maxH * k, gap, max });
    const acc = lift(e.accent);
    const boxes = drawBlock(ctx, block, sp, x, top, { align, color: color ?? (e.headlineAccent ? acc : INK), accent: acc });
    const box = blockBox(boxes);
    if (key) e.mark(key, box);
    const h = block.cap + (ls.length - 1) * block.step;
    return { box, bottom: top + h, px: block.px, h };
}

/** Height a head() of `text` would take at most (for bottom-up layouts). */
export function headHeight(e, text, { maxW, maxH, gap = 0.16, spec, lines = 4, max = Infinity } = {}) {
    const ls = splitLines(text).slice(0, lines);
    if (!ls.some((l) => l.trim())) return 0;
    const k = e.look.size ?? 1;
    const block = fitBlock(e.ctx, ls, spec ?? e.headline, { maxW: maxW * k, maxH: maxH * k, gap, max });
    return block.cap + (ls.length - 1) * block.step;
}

/** Running text wrapped to `maxW`, at most `max` lines, first baseline at y. */
export function para(e, key, text, spec, px, x, y, maxW, max = 3, { align = 'left', color = SOFT, leading = 1.32 } = {}) {
    const s = String(text ?? '').trim();
    if (!s) return { box: null, lines: 0, h: 0 };
    const ls = wrapLines(e.ctx, s, spec, px, maxW, max);
    const box = drawText(e.ctx, ls.join('\n'), spec, px, x, y, { align, color, leading, accent: lift(e.accent) });
    if (key) e.mark(key, box);
    return { box, lines: ls.length, h: (ls.length - 1) * px * leading + px };
}

/** How many lines para() would set. */
export const paraLines = (e, text, spec, px, maxW, max = 3) =>
    (String(text ?? '').trim() ? wrapLines(e.ctx, text, spec, px, maxW, max).length : 0);

/**
 * Per-serving numbers, "24g | Protein" one per line, as a row of columns
 * split by hairlines: the value big, its label in mono under it. (x, top) is
 * the row's top-left; `align` 'center' centres each value in its column.
 * Returns the row's height.
 */
export function stats(e, key, text, x, top, w, U, { max = 3, numPx = 58, labPx = 17, align = 'center', rules = true, color = INK } = {}) {
    const { ctx } = e;
    const data = rows(text, max).filter((r) => r[0]);
    if (!data.length) return 0;
    const n = data.length;
    const cw = w / n;
    let vp = numPx * U;
    data.forEach((r) => { vp = Math.min(vp, fitPx(ctx, r[0], TYPE.brandSB, vp, cw - 24 * U)); });
    const lp = labPx * U;
    const cap = capHeight(ctx, TYPE.brandSB, vp);
    const h = cap + lp * 2.1;
    let box = null;
    data.forEach((r, i) => {
        const cx = align === 'center' ? x + cw * (i + 0.5) : x + cw * i + (i ? 22 * U : 0);
        const a = align === 'center' ? 'center' : 'left';
        if (i && rules) rule(ctx, x + cw * i, top + 4 * U, x + cw * i, top + h, HAIR, Math.max(1, 1.2 * U));
        const vb = drawText(ctx, r[0], TYPE.brandSB, vp, cx, top + cap, { align: a, color });
        const lab = e.caps(r[1] ?? '');
        const lb = lab.trim() ? drawText(ctx, lab, TYPE.mono, fitPx(ctx, lab, TYPE.mono, lp, cw - 24 * U, 0.14), cx, top + cap + lp * 1.9, { align: a, tracking: 0.14, color: GREY }) : null;
        [vb, lb].forEach((b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; });
    });
    if (key) e.mark(key, box);
    return h;
}

/** Height stats() will take. */
export function statsHeight(e, text, U, { max = 3, numPx = 58, labPx = 17, w = Infinity } = {}) {
    const data = rows(text, max).filter((r) => r[0]);
    if (!data.length) return 0;
    let vp = numPx * U;
    data.forEach((r) => { vp = Math.min(vp, fitPx(e.ctx, r[0], TYPE.brandSB, vp, w / data.length - 24 * U)); });
    return capHeight(e.ctx, TYPE.brandSB, vp) + labPx * U * 2.1;
}

/** A pill with a word in it; fill picks the text colour. Returns its box. */
export function pill(e, key, text, x, y, px, { fill, stroke, color, align = 'left', spec = TYPE.brandSB, tracking = 0.12, round = true } = {}) {
    const { ctx } = e;
    const t = String(text ?? '').trim();
    if (!t) return null;
    const padX = px * 0.85;
    const h = px * 2;
    const w = textWidth(ctx, t, spec, px, tracking) + padX * 2;
    const bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, y, w, h, round ? h / 2 : px * 0.2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, px * 0.08); ctx.stroke(); }
    ctx.restore();
    const box = drawText(ctx, t, spec, px, bx + padX, y + h / 2 + capHeight(ctx, spec, px) / 2, { tracking, color: color ?? (fill ? textOn(fill) : INK) });
    if (key) e.mark(key, box);
    return { x: bx, y, w, h };
}

/** Width pill() would take. */
export const pillWidth = (e, text, px, { spec = TYPE.brandSB, tracking = 0.12 } = {}) =>
    (String(text ?? '').trim() ? textWidth(e.ctx, String(text).trim(), spec, px, tracking) + px * 1.7 : 0);

/** A seeded 0–1 random from a string (stable layouts from field text). */
export function seeded(text) {
    let h = 2166136261;
    for (const ch of String(text ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => {
        h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
        return ((h >>> 0) % 10000) / 10000;
    };
}

/**
 * #111 or ink on a colour fill, whichever has more contrast. (The break
 * sits near luminance 0.18, below textOn's 0.3, so mid-tone brand colours
 * like a raspberry get ink at ≥ 4:1 rather than #111 at under 3:1.)
 */
export function onColour(bg) {
    const L = luminance(bg);
    return (L + 0.05) / 0.0556 >= 0.93 / (L + 0.05) ? '#111111' : INK;
}
