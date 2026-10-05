/**
 * Helpers the Move PRODUCT templates share: the frame (safe area + shape
 * flags), the lit ground a product stands on, an optional photo backdrop,
 * an accent chip, fitted single lines and blocks that mark their field, and
 * money parsing for prices and savings.
 */
import { TYPE } from '../../../../fonts';
import { drawText, capHeight, fitBlock, drawBlock, blockBox, splitLines, textWidth } from '../../../../text';
import { textOn } from '../../kit';
import { unitOf, fitPx, rrect, luminance } from '../_parts';

export { GREY, SOFT, DIM, HAIR, mono, fitPx, unitOf, rrect, rowsOf, luminance, onAccent, seeded } from '../_parts';

/** The safe box and the shape flags every layout branches on. */
export function frame(e) {
    const { W, H, safe, shape } = e;
    return {
        k: unitOf(e),
        x0: safe.l, x1: W - safe.r, y0: safe.t, y1: H - safe.b,
        tall: shape === 'tall', sq: shape === 'square', wide: shape === 'wide', strip: shape === 'strip',
        banner: shape === 'wide' || shape === 'strip',
    };
}

const hex = (c) => {
    const m = String(c ?? '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/** `color` (#hex) at alpha `a`; anything else passes through. */
export function alpha(color, a) {
    const rgb = hex(color);
    return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})` : color;
}

/**
 * A colour lifted enough to glow on near-black: a very dark brand colour
 * (navy, black) is mixed toward warm white so its light still shows.
 */
export function glowOf(color) {
    const rgb = hex(color) ?? [250, 204, 21];
    const l = luminance(color);
    const t = l < 0.06 ? 0.45 : l < 0.15 ? 0.25 : 0;
    return `#${rgb.map((v, i) => Math.round(v + ([255, 246, 228][i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The dark ground: near-black, a soft light from above, and a glow in
 * `color` (the accent by default) centred on (cx, cy) — the lit stage.
 */
export function ground(e, { cx, cy, r, color, amount = 1, cone = true } = {}) {
    const { ctx, W, H } = e;
    ctx.fillStyle = '#0B0B0A';
    ctx.fillRect(0, 0, W, H);
    const x = cx ?? W / 2;
    const y = cy ?? H / 2;
    const rad = r ?? Math.max(W, H) * 0.45;
    const g = glowOf(color ?? e.accent);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, alpha(g, 0.3 * amount));
    rg.addColorStop(0.45, alpha(g, 0.1 * amount));
    rg.addColorStop(1, alpha(g, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    if (cone) {
        // A soft key light falling from above onto the stage.
        const top = Math.min(0, y - rad * 1.6);
        const lg = ctx.createLinearGradient(0, top, 0, y + rad * 0.4);
        lg.addColorStop(0, 'rgba(255,250,238,0.07)');
        lg.addColorStop(1, 'rgba(255,250,238,0)');
        ctx.save();
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(x - rad * 0.18, top);
        ctx.lineTo(x + rad * 0.18, top);
        ctx.lineTo(x + rad * 0.95, y + rad * 0.4);
        ctx.lineTo(x - rad * 0.95, y + rad * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

/**
 * With a photo loaded: the photo over the whole post (or `rect`), dimmed so
 * the product stays the hero. Returns true when there was one.
 */
export function backdrop(e, { rect, dim = 0.58 } = {}) {
    if (!e.hasMedia) return false;
    const { ctx, W, H } = e;
    const r = rect ?? { x: 0, y: 0, w: W, h: H };
    e.photo(r);
    ctx.fillStyle = `rgba(10,10,9,${dim})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    e.fade(r.x, r.y + r.h * 0.45, r.w, r.h * 0.55, 'bottom', 0.7);
    return true;
}

/**
 * A pill in the accent with `text` in #111 or ink by the accent's light,
 * `h` tall, its left (or right/centre) at x and top at y. Returns the box.
 */
export function chip(e, key, x, y, h, { align = 'left', maxW = Infinity, fill, spec = TYPE.mono, outline = false } = {}) {
    const { ctx } = e;
    const t = e.caps(e.fields[key] ?? '').trim();
    if (!t) return null;
    const bg = fill ?? e.accent;
    let px = h * 0.38;
    const pad = h * 0.55;
    px = fitPx(ctx, t, spec, px, maxW - pad * 2, 0.16);
    const w = textWidth(ctx, t, spec, px, 0.16) + pad * 2;
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.save();
    rrect(ctx, left, y, w, h, h / 2);
    if (outline) {
        ctx.strokeStyle = bg;
        ctx.lineWidth = Math.max(1, h * 0.04);
        ctx.stroke();
    } else {
        ctx.fillStyle = bg;
        ctx.fill();
    }
    ctx.restore();
    drawText(ctx, t, spec, px, left + pad, y + h / 2 + capHeight(ctx, spec, px) / 2, { tracking: 0.16, color: outline ? bg : textOn(bg) });
    const box = { x: left, y, w, h };
    e.mark(key, box);
    return box;
}

/** One line of a field, shrunk to `maxW`, baseline at `base`. Returns its box (or null). */
export function line(e, key, spec, px, x, base, maxW, { align = 'left', color, tracking = 0, caps = false } = {}) {
    const raw = String(e.fields[key] ?? '').replace(/\s*\n\s*/g, ' ').trim();
    const t = caps ? e.caps(raw) : raw;
    if (!t) return null;
    const p = fitPx(e.ctx, t, spec, px, maxW, tracking);
    const box = drawText(e.ctx, t, spec, p, x, base, { align, color: color ?? e.ink, tracking, accent: e.accent });
    e.mark(key, box);
    return box;
}

/**
 * A field's lines as one fitted block (the product name, a headline) with
 * its first cap-top at `top` (or its last baseline at `top` with bottom).
 * Returns { box, h } — h is the height it takes, 0 when empty.
 */
export function block(e, key, x, top, maxW, maxH, { spec, align = 'left', tracking = -0.03, gap = 0.1, max = Infinity, bottom = false, caps = true, color, maxLines = 3 } = {}) {
    const raw = String(e.fields[key] ?? '');
    const lines = splitLines(caps ? e.caps(raw) : raw).slice(0, maxLines);
    if (!lines.length || !lines.some((l) => l.trim())) return { box: null, h: 0, px: 0 };
    const s = spec ?? e.headline;
    const b = fitBlock(e.ctx, lines, s, { maxW, maxH, tracking, gap, max });
    const h = b.cap + (lines.length - 1) * b.step;
    const t = bottom ? top - h : top;
    const box = blockBox(drawBlock(e.ctx, b, s, x, t, { align, tracking, color: color ?? (e.headlineAccent ? e.accent : e.ink), accent: e.accent }));
    e.mark(key, box);
    return { box, h, px: b.px };
}

/** Height a block would take (for stacking before drawing). */
export function blockHeight(e, key, maxW, maxH, { spec, tracking = -0.03, gap = 0.1, max = Infinity, caps = true, maxLines = 3 } = {}) {
    const raw = String(e.fields[key] ?? '');
    const lines = splitLines(caps ? e.caps(raw) : raw).slice(0, maxLines);
    if (!lines.length || !lines.some((l) => l.trim())) return 0;
    const b = fitBlock(e.ctx, lines, spec ?? e.headline, { maxW, maxH, tracking, gap, max });
    return b.cap + (lines.length - 1) * b.step;
}

/** "£1,299.50" → 1299.5; NaN when there's no number. */
export function money(s) {
    const m = String(s ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : NaN;
}

/** The currency sign a price is written with ("£" by default). */
export const currency = (s) => (String(s ?? '').match(/[£$€]/) ?? ['£'])[0];

/** 18 → "£18", 12.5 → "£12.50". */
export function price(n, sign = '£') {
    if (!Number.isFinite(n)) return '';
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    const v = whole ? Math.round(n).toLocaleString('en-GB') : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}${v}`;
}

/** Cap height helper so layouts can stack type on its caps. */
export const cap = (e, spec, px) => capHeight(e.ctx, spec, px);

/** The stand-in's label: the partner's name, else POWR. */
export const makerOf = (e) => String(e.fields.brand ?? '').trim() || 'POWR';
