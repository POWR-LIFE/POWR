/**
 * Shared by the Eat library: colour maths for brand accents (any colour a
 * partner sets must stay legible on the dark ground), the colour photo look,
 * a few small type helpers and a row parser for "name — value" fields.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, capHeight, splitLines } from '../../../text';

export const INK = '#F4F1EA';
export const DARK = '#111111';
export const SOFT = 'rgba(244,241,234,0.86)';
export const GREY = 'rgba(244,241,234,0.62)';
export const DIM = 'rgba(244,241,234,0.42)';
export const HAIR = 'rgba(244,241,234,0.2)';

/**
 * Food in black and white looks dead: Eat keeps the photo's own colour, set
 * moody (low exposure, vignette, a light warm grade and a little grain).
 */
export const LOOK = {
    mono: 0, target: 0.28, auto: 0.85, contrast: 0.45, crush: 0.08, fade: 0,
    tint: 'warm', tintAmount: 0.15, motion: 0, angle: 0, focus: 0.6, vignette: 0.5, grain: 0.35, size: 1,
};

// ── Colour ──────────────────────────────────────────────────────────────

/** [r, g, b] 0–255 from #rgb, #rrggbb or rgb(); POWR yellow if unreadable. */
export function rgbOf(c) {
    const s = String(c ?? '').trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
    m = s.match(/^#([0-9a-f]{6})/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [m[1], m[2], m[3]].map(Number);
    return [250, 204, 21];
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** WCAG relative luminance, 0–1. */
export function luminance(c) {
    const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = rgbOf(c).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `a` → `b` by t (0–1), as #rrggbb. */
export function mix(a, b, t) {
    const x = rgbOf(a);
    const y = rgbOf(b);
    return hex(x.map((v, i) => v + (y[i] - v) * t));
}

export const alpha = (c, a) => { const [r, g, b] = rgbOf(c); return `rgba(${r},${g},${b},${a})`; };

/** Text colour for a solid fill of `c`: near-black on a light fill, ink on a dark one. */
export const onFill = (c) => (luminance(c) > 0.36 ? DARK : INK);

/**
 * The accent, lifted toward ink until it reads on the dark ground (≥ ~4.5:1
 * on #0B0B0B). POWR yellow and most brand colours pass untouched; a navy or
 * a deep green comes back as a lighter tint of itself.
 */
export function lift(c, min = 0.2) {
    let t = 0;
    let out = mix(c, INK, 0);
    while (luminance(out) < min && t < 1) { t += 0.04; out = mix(c, INK, t); }
    return out;
}

// ── Words ───────────────────────────────────────────────────────────────

/** The first number in a string ("32g" → 32, "1,640 kJ" → 1640), else 0. */
export function num(s) {
    const m = String(s ?? '').replace(/,(?=\d{3})/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
}

/** "Oats — 60g" · "Oats | 60g" · tab-separated → ['Oats', '60g']. */
export const cells = (line) => String(line ?? '').split(/\s+[—–]\s+|\s*\|\s*|\t/).map((s) => s.trim());

/** Non-empty lines of a field, each split into cells. */
export const rows = (text, max = Infinity) => splitLines(text).filter((l) => l.trim()).slice(0, max).map(cells);

/** The largest px ≤ `px` at which `text` fits `maxW`. */
export function fitPx(ctx, text, spec, px, maxW, tracking = 0) {
    const w = textWidth(ctx, text, spec, px, tracking);
    return w > maxW && w > 0 ? (px * maxW) / w : px;
}

/**
 * A solid chip with a word in it (text colour picked from the fill's
 * luminance). (x, y) is the top-left; align 'right' ends at x. Returns the
 * chip's box.
 */
export function chip(e, key, text, x, y, px, { fill, align = 'left', tracking = 0.1, spec = TYPE.brandSB } = {}) {
    const { ctx } = e;
    const t = String(text ?? '').trim();
    if (!t) return null;
    const f = fill ?? e.accent;
    const padX = px * 0.7;
    const h = px * 1.7;
    const w = textWidth(ctx, t, spec, px, tracking) + padX * 2;
    const cx = align === 'right' ? x - w : x;
    ctx.fillStyle = f;
    ctx.fillRect(cx, y, w, h);
    const box = drawText(ctx, t, spec, px, cx + padX, y + h / 2 + capHeight(ctx, spec, px) / 2, { tracking, color: onFill(f) });
    if (key) e.mark(key, box);
    return { x: cx, y, w, h };
}
