/**
 * Helpers the Move templates share: greys, a light-or-dark pick for type on
 * the accent, the top row (lockup + eyebrow), rounded rects, leader dots, a
 * seeded random, list and time parsing.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, capHeight } from '../../../text';
import { lockup } from '../kit';

export const GREY = 'rgba(244,241,234,0.6)';
export const SOFT = 'rgba(244,241,234,0.86)';
export const DIM = 'rgba(244,241,234,0.34)';
export const HAIR = 'rgba(244,241,234,0.16)';

/** Relative luminance (0–1) of a CSS colour: #rgb, #rrggbb or rgb(). */
export function luminance(c) {
    let r = 250;
    let g = 204;
    let b = 21;
    const s = String(c ?? '').trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    } else {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (m) [r, g, b] = m[1].split(',').map((v) => parseFloat(v));
    }
    const lin = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Type colour for text set ON an accent fill: near-black on a light accent, ink on a dark one. */
export const onAccent = (c) => (luminance(c) > 0.3 ? '#111111' : '#F4F1EA');

/** True for the landscape sizes (16:9, 1.91:1) and the thin banners. */
export const isBanner = (e) => e.shape === 'wide' || e.shape === 'strip';

/** The size unit: type on the thin banners is sized off their height. */
export const unitOf = (e) => (e.shape === 'strip' ? e.tu : e.u);

/** `px`, or smaller if `text` would run wider than `maxW`. */
export function fitPx(ctx, text, spec, px, maxW, tracking = 0) {
    const w = textWidth(ctx, text, spec, px, tracking);
    return w > maxW && w > 0 ? (px * maxW) / w : px;
}

/** Rounded-rect path (not filled or stroked). */
export function rrect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** A row of small dots from x1 to x2 on y — a leader between a name and its number. */
export function leader(ctx, x1, x2, y, r, gap, color) {
    if (x2 - x1 < gap * 2) return;
    ctx.save();
    ctx.fillStyle = color;
    const n = Math.floor((x2 - x1) / gap);
    const start = x2 - n * gap;
    for (let i = 0; i <= n; i++) {
        const x = start + i * gap;
        if (x < x1) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Small tracked mono caps — labels, eyebrows, column heads. Returns the box. */
export function mono(e, text, x, y, px, { align = 'left', color = GREY, tracking = 0.18, spec = TYPE.mono, maxW } = {}) {
    const t = e.caps(text).trim();
    if (!t) return null;
    const p = maxW ? fitPx(e.ctx, t, spec, px, maxW, tracking) : px;
    return drawText(e.ctx, t, spec, p, x, y, { align, tracking, color });
}

/**
 * The top row: the POWR lockup (× partner) left, an eyebrow right, both on
 * one line `h` tall from `y`. Returns the row's bottom edge.
 */
export function topRow(e, x0, x1, y, h, { key = 'eyebrow', px, color = SOFT, lockupShare = 0.56 } = {}) {
    const k = unitOf(e);
    const lk = lockup(e, x0, y, h, { maxW: (x1 - x0) * lockupShare });
    const text = e.caps(e.fields[key] ?? '').trim();
    if (text) {
        const size = px ?? h * 0.34;
        const room = x1 - (lk.x + lk.w) - 36 * k;
        const p = fitPx(e.ctx, text, TYPE.mono, size, room, 0.18);
        const cap = capHeight(e.ctx, TYPE.mono, p);
        e.mark(key, drawText(e.ctx, text, TYPE.mono, p, x1, y + h / 2 + cap / 2, { align: 'right', tracking: 0.18, color }));
    }
    return Math.max(y + h, lk.y + lk.h);
}

/** Deterministic random numbers from a string (same words, same route). */
export function seeded(str) {
    let h = 2166136261;
    for (const ch of String(str ?? '')) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A list field's lines, each split into cells on · | — – or a tab. */
export const rowsOf = (text) => String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s*(?:·|\||\t|—|–|\s-\s)\s*/).map((c) => c.trim()));

/** "4:58" → 298, "1:02:10" → 3730, "45" → 45 (seconds). NaN if unreadable. */
export function seconds(t) {
    const parts = String(t ?? '').trim().split(':').map(Number);
    if (!parts.length || parts.some((p) => Number.isNaN(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** 2894 → "48:14", 4470 → "1:14:30". */
export function clock(s) {
    const v = Math.round(s);
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const sec = String(v % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** A big number with a small unit after it on one baseline ("10" + "km"). Returns the box. */
export function figure(e, value, unit, x, base, px, { spec, unitSpec = TYPE.brandR, color = e.ink, unitColor = GREY, align = 'left', unitScale = 0.3 } = {}) {
    const { ctx } = e;
    const s = spec ?? e.headline;
    const v = String(value ?? '').trim();
    const un = String(unit ?? '').trim();
    const uPx = px * unitScale;
    const vw = textWidth(ctx, v, s, px, -0.02);
    const gap = un ? px * 0.08 : 0;
    const uw = un ? textWidth(ctx, un, unitSpec, uPx, 0.02) : 0;
    const total = vw + gap + uw;
    const left = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    const a = drawText(ctx, v, s, px, left, base, { tracking: -0.02, color });
    if (un) drawText(ctx, un, unitSpec, uPx, left + vw + gap, base, { tracking: 0.02, color: unitColor });
    const cap = capHeight(ctx, s, px);
    return a ? { x: left, y: base - cap, w: total, h: cap } : null;
}

/** Split "10 km" into a number and a unit ("10", "km"); a bare word stays whole. */
export function splitUnit(text) {
    const m = String(text ?? '').trim().match(/^([+\-−]?[\d.,:]+)\s*(.*)$/);
    return m ? [m[1], m[2]] : [String(text ?? '').trim(), ''];
}
