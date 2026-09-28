/**
 * Shared by the Mind library: the quiet palette, the soft warm photo look,
 * a fitted-block helper and the footer row (POWR × partner lockup + a line
 * of small print) every Mind template signs off with.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, lineMetrics, textWidth, blockBox, capHeight, wrapLines } from '../../../text';
import { lockup, hasPartner } from '../kit';

export const SOFT = 'rgba(244,241,234,0.8)';
export const DIM = 'rgba(244,241,234,0.52)';
export const FAINT = 'rgba(244,241,234,0.3)';
export const HAIR = 'rgba(244,241,234,0.2)';
export const GROUND = '#0D0C0B';

/** Soft and warm: mostly monochrome, a warm cast, low contrast, a little fade. */
export const MIND_LOOK = {
    mono: 0.75, target: 0.22, auto: 0.8, contrast: 0.35, crush: 0.05, fade: 0.1,
    tint: 'warm', tintAmount: 0.5, motion: 0, angle: 0, focus: 0.55, vignette: 0.5, grain: 0.55, size: 1,
};

/** Type unit: the banner strips size off their height. */
export const unitOf = (e) => (e.shape === 'strip' ? e.tu : e.u);

export const ground = (e, color = GROUND) => {
    e.ctx.fillStyle = color;
    e.ctx.fillRect(0, 0, e.W, e.H);
};

/** A flat warm-black veil over everything drawn so far. */
export const veil = (e, alpha) => {
    if (alpha <= 0) return;
    e.ctx.fillStyle = `rgba(10,9,8,${alpha})`;
    e.ctx.fillRect(0, 0, e.W, e.H);
};

/** #111 or ink — whichever reads on an accent fill. */
export function onAccent(accent) {
    const m = String(accent).match(/^#?([0-9a-f]{6})$/i);
    if (!m) return '#111111';
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    return L > 0.3 ? '#111111' : '#F4F1EA';
}

export const headColor = (e) => (e.headlineAccent ? e.accent : e.ink);

/** `px`, or smaller if one line of `text` would run wider than maxW. */
export function fitPx(ctx, text, spec, px, maxW, tracking = 0) {
    const w = textWidth(ctx, text, spec, px, tracking);
    return w > maxW && w > 0 ? (px * maxW) / w : px;
}

/**
 * Running text wrapped to maxW, then the measure narrowed until the lines
 * are as even as they'll go — no word left alone on the last line.
 */
export function balanced(ctx, text, spec, px, maxW, maxLines = Infinity, tracking = 0) {
    const lines = wrapLines(ctx, text, spec, px, maxW, maxLines, tracking);
    if (lines.length < 2 || lines[lines.length - 1].endsWith('…')) return lines;
    let best = lines;
    for (let w = maxW * 0.95; w > maxW * 0.4; w -= maxW * 0.05) {
        const next = wrapLines(ctx, text, spec, px, w, maxLines, tracking);
        if (next.length !== lines.length || next[next.length - 1].endsWith('…')) break;
        best = next;
    }
    return best;
}

// The lines to set: as typed, except a line too long for maxW at the size
// the block wants is re-wrapped (balanced) — so a sentence typed on one line
// still sets as a block instead of shrinking to fit one line.
function flow(ctx, text, spec, { maxW, maxH, max, lines, gap, tracking }) {
    const typed = splitLines(text);
    if (lines < 2 || !Number.isFinite(max)) return typed.slice(0, lines);
    let px = max;
    let out = typed;
    for (let i = 0; i < 10; i++) {
        out = typed.flatMap((l) => (textWidth(ctx, l, spec, px, tracking) > maxW ? balanced(ctx, l, spec, px, maxW, Infinity, tracking) : [l]));
        if (out.length > lines) { px *= 0.9; continue; }
        const b = fitBlock(ctx, out, spec, { maxW, maxH, max: px, gap, tracking });
        if (b.px >= px * 0.96) return out;
        px = b.px;
    }
    return out.length > lines ? typed.slice(0, lines) : out;
}

/**
 * A block of display lines fitted to maxW × maxH (never above `max` px).
 * Returns its height (first cap-top to last baseline), the last line's
 * descent, and draw(key, x, top, opts) → the block's box.
 */
export function prep(e, text, spec, { maxW, maxH, max = Infinity, lines = 3, gap = 0.22, tracking = 0 }) {
    const { ctx } = e;
    const ls = flow(ctx, text, spec, { maxW, maxH, max, lines, gap, tracking });
    if (!ls.length || !ls.join('').trim()) return { h: 0, desc: 0, w: 0, px: 0, draw: () => null, empty: true };
    const b = fitBlock(ctx, ls, spec, { maxW, maxH, max, gap, tracking });
    const h = b.cap + (ls.length - 1) * b.step;
    const desc = lineMetrics(ctx, b.segs[b.segs.length - 1], spec, b.px, tracking).descent;
    const w = Math.max(...b.segs.map((sg) => lineMetrics(ctx, sg, spec, b.px, tracking).inkW));
    return {
        h, desc, w, px: b.px, cap: b.cap, n: ls.length,
        draw(key, x, top, { align = 'left', color = e.ink } = {}) {
            const boxes = drawBlock(ctx, b, spec, x, top, { align, color, accent: e.accent, tracking });
            const box = blockBox(boxes);
            if (key) e.mark(key, box);
            return box;
        },
    };
}

/** Small tracked caps on one line, fitted to maxW. Returns the box. */
export function label(e, key, text, x, base, { px, maxW = Infinity, align = 'left', color = DIM, spec = TYPE.brandR, tracking = 0.2, upper = true } = {}) {
    const t = upper ? e.caps(text).trim() : String(text ?? '').trim();
    if (!t) return null;
    const p = fitPx(e.ctx, t, spec, px, maxW, tracking);
    const box = drawText(e.ctx, t, spec, p, x, base, { align, tracking, color, accent: e.accent });
    if (key) e.mark(key, box);
    return box;
}

/**
 * The sign-off row along `bottom`: the lockup (POWR × partner) and the
 * footer's small print. 'split' puts the lockup left and the print right;
 * 'center' stacks the print over a centred lockup. Returns the row's top.
 */
export function footRow(e, { x0, x1, bottom, k, align = 'split', lockH = 26, footKey = 'footer' }) {
    const { ctx } = e;
    const h = lockH * k;
    const px = 15 * k;
    const foot = e.caps(e.fields[footKey] ?? '').trim();
    if (align === 'center') {
        const lk = lockup(e, (x0 + x1) / 2, bottom - h, h, { align: 'center', maxW: (x1 - x0) * 0.7 });
        let top = lk.y;
        if (foot) {
            const box = label(e, footKey, foot, (x0 + x1) / 2, lk.y - 26 * k, { px, maxW: x1 - x0, align: 'center' });
            if (box) top = box.y;
        }
        return top;
    }
    const partner = hasPartner(e);
    const lk = lockup(e, x0, bottom - h, h, { align: 'left', maxW: (x1 - x0) * (partner ? 0.55 : 0.4) });
    if (foot) {
        const room = x1 - (lk.x + lk.w) - 40 * k;
        const cap = capHeight(ctx, TYPE.brandR, px);
        label(e, footKey, foot, x1, bottom - h / 2 + cap / 2, { px, maxW: room, align: 'right' });
    }
    return Math.min(lk.y, bottom - h);
}

/** A footer line from a partner's reward: "35% off at Northside · with points". */
export function rewardLine(r) {
    const v = r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''}` : '';
    return v ? `${v} at ${r.brand} · with points` : `${r.brand} × POWR`;
}
