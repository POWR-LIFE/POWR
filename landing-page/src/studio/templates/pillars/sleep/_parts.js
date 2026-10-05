/**
 * Shared by the Sleep library: the night palette and grade, a cool ground
 * for the no-photo versions, clock and duration parsing, and the few glyphs
 * the templates draw (moon phases, a sun, a crescent).
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, splitLines } from '../../../text';

export const INK = '#F4F1EA';
export const SOFT = 'rgba(244,241,234,0.84)';
export const MUTED = 'rgba(244,241,234,0.6)';
export const DIM = 'rgba(244,241,234,0.4)';
export const HAIR = 'rgba(244,241,234,0.14)';
// The night ground: a cool near-black, never pure black.
export const NIGHT = [12, 14, 19];
export const nightRgba = (a) => `rgba(${NIGHT[0]},${NIGHT[1]},${NIGHT[2]},${a})`;

/** The night grade every Sleep template starts from (spread, then tweak). */
export const NIGHT_LOOK = {
    mono: 0.85, target: 0.18, auto: 0.85, contrast: 0.45, crush: 0.15, fade: 0,
    tint: 'cool', tintAmount: 0.65, motion: 0, angle: 0, focus: 0.6, vignette: 0.75, grain: 0.6, size: 1,
};

/** Relative luminance (0–1) of a #rgb / #rrggbb / rgb() colour. */
export function colourLuma(c) {
    const s = String(c ?? '').trim();
    let r = 0;
    let g = 0;
    let b = 0;
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
        [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    } else {
        const m = s.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
        if (!m) return 0.5;
        [r, g, b] = [m[1], m[2], m[3]].map(Number);
    }
    const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Type colour for text sitting ON an accent fill. */
export const onAccent = (c) => (colourLuma(c) > 0.3 ? '#111111' : INK);

/** The accent, lifted towards ink when it is too dark to read on the night ground. */
export function readable(c) {
    return colourLuma(c) < 0.09 ? INK : c;
}

/** A fade into the night ground (not black), darkest at `from`. */
export function fadeTo(ctx, x, y, w, h, from, alpha = 1) {
    if (alpha <= 0 || w <= 0 || h <= 0) return;
    const g = from === 'top' ? ctx.createLinearGradient(0, y, 0, y + h)
        : from === 'left' ? ctx.createLinearGradient(x, 0, x + w, 0)
        : from === 'right' ? ctx.createLinearGradient(x + w, 0, x, 0)
        : ctx.createLinearGradient(0, y + h, 0, y);
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        g.addColorStop(t, nightRgba((alpha * (1 - t) ** 1.6).toFixed(4)));
    }
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

/** A flat night wash over a rect. */
export function wash(ctx, x, y, w, h, alpha) {
    ctx.save();
    ctx.fillStyle = nightRgba(alpha);
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

/**
 * The night ground over the whole canvas: a flat cool near-black and, with
 * no photo, a faint moonlit glow — what the no-photo versions sit on.
 */
export function ground(e, glow = { x: 0.78, y: 0.18 }) {
    const { ctx, W, H } = e;
    // Flat, so fades into it (fadeTo) never leave a seam.
    ctx.fillStyle = nightRgba(1);
    ctx.fillRect(0, 0, W, H);
    if (glow && !e.hasMedia) {
        const r = Math.max(W, H) * 0.6;
        const rg = ctx.createRadialGradient(W * glow.x, H * glow.y, 0, W * glow.x, H * glow.y, r);
        rg.addColorStop(0, 'rgba(150,172,210,0.1)');
        rg.addColorStop(0.5, 'rgba(150,172,210,0.03)');
        rg.addColorStop(1, 'rgba(150,172,210,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
    }
}

/**
 * The photo in `rect` — or, for a template that is complete without one and
 * has no media, just the night ground. Always paints the ground first so a
 * photo in part of the frame sits on it.
 */
export function backdrop(e, rect, { optional = false, overrides, glow } = {}) {
    ground(e, glow);
    if (optional && !e.hasMedia) return null;
    return e.photo(rect ?? { x: 0, y: 0, w: e.W, h: e.H }, overrides);
}

/** One line of small text, shrunk to fit `maxW`, marked as `key`. */
export function line(e, key, text, spec, px, x, y, { maxW = Infinity, align = 'left', tracking = 0, color = INK } = {}) {
    const s = String(text ?? '');
    if (!s.trim()) return null;
    const w = textWidth(e.ctx, s, spec, px, tracking);
    const p = w > maxW ? (px * maxW) / w : px;
    const box = drawText(e.ctx, s, spec, p, x, y, { align, tracking, color, accent: e.accent });
    if (key) e.mark(key, box);
    return box;
}

/** A tracked mono label (eyebrows, axis names), in caps unless the look says not. */
export const label = (e, key, text, px, x, y, opts = {}) =>
    line(e, key, e.caps(text), TYPE.mono, px, x, y, { tracking: 0.18, color: MUTED, ...opts });

// ── Time ───────────────────────────────────────────────────────────────────

/** "23:04", "11.30pm", "6am", "0630" → minutes after midnight (null if not a time). */
export function parseClock(s) {
    const m = String(s ?? '').trim().match(/^(\d{1,2})(?:[:.h ]?(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 24 || min > 59) return null;
    return (h * 60 + min) % 1440;
}

const pad = (n) => String(n).padStart(2, '0');
/** Minutes after midnight → "HH:MM". */
export const clock = (m) => { const v = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`; };

/** "7h 42m", "7:42", "7.7", "7h", "42m" → minutes (null if none). */
export function parseDur(s) {
    const t = String(s ?? '').trim().toLowerCase();
    if (!t) return null;
    let m = t.match(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(?:(\d+)\s*m)?/);
    if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
    m = t.match(/^(\d+)\s*m/);
    if (m) return Number(m[1]);
    m = t.match(/^(\d+):(\d{2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = t.match(/^(\d+(?:\.\d+)?)$/);
    if (m) return Number(m[1]) * 60;
    return null;
}

/** Minutes → "7h 42m" (or "42m"). */
export function dur(min) {
    const v = Math.max(0, Math.round(min));
    const h = Math.floor(v / 60);
    return h ? `${h}h ${pad(v % 60)}m` : `${v % 60}m`;
}

/** Minutes from `a` to `b` on the clock, across midnight. */
export const span = (a, b) => ((b - a) % 1440 + 1440) % 1440;

/**
 * A week of nights, one per line: "Mon — 7h 12m" (also "Mon 7.2", "Mon: 7:12").
 * Returns [{ day, min }] with at most 7 entries.
 */
export function parseNights(text) {
    return splitLines(text).slice(0, 7).map((l) => {
        const m = l.trim().match(/^(.*?)\s*[—–|:]\s*(.+)$/) ?? l.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) return { day: l.trim(), min: parseDur(l) ?? 0 };
        return { day: m[1], min: parseDur(m[2]) ?? 0 };
    }).filter((n) => n.day);
}

// ── Glyphs ─────────────────────────────────────────────────────────────────

/**
 * The moon at `phase` (0 new → 0.5 full → 1 new again), waxing lit on the
 * right as seen from the north. Fills the unlit disc with `dark` (skip with
 * null) and the lit part with `lit`.
 */
export function moon(ctx, cx, cy, r, phase, lit, dark) {
    const p = ((phase % 1) + 1) % 1;
    ctx.save();
    if (dark) {
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }
    const f = (1 - Math.cos(2 * Math.PI * p)) / 2; // lit fraction
    if (f > 0.002) {
        ctx.translate(cx, cy);
        if (p > 0.5) ctx.scale(-1, 1);
        ctx.fillStyle = lit;
        ctx.beginPath();
        if (f > 0.998) {
            ctx.arc(0, 0, r, 0, Math.PI * 2);
        } else {
            ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
            const rx = r * Math.abs(1 - 2 * f);
            // The terminator: through the right for a crescent, the left for gibbous.
            ctx.ellipse(0, 0, Math.max(0.01, rx), r, 0, Math.PI / 2, -Math.PI / 2, f < 0.5);
        }
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

/** A thin crescent (bedtime), tilted a little. */
export function crescent(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.45);
    moon(ctx, 0, 0, r, 0.86, color, null);
    ctx.restore();
}

/** A sun: a small disc and eight short rays (wake time). */
export function sun(ctx, cx, cy, r, color, width) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
    }
    ctx.restore();
}

/** Rounded rectangle path (no fill/stroke). */
export function rrect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
