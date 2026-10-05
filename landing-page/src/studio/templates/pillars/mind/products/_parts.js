/**
 * Shared by the Mind product templates: the frame every layout starts from,
 * stackable text pieces (a line, a fitted block, a wrapped paragraph), the
 * price line, a soft accent glow, and the reward fill. The voice is the Mind
 * library's: warm black, serif names, light Outfit, mono for the data.
 */
import { TYPE } from '../../../../fonts';
import { drawText, capHeight, splitLines, textWidth, wrapLines } from '../../../../text';
import { isCutout, rewardWords } from '../../kit';
import { thousands } from '../../../../words';
import { DIM, unitOf, prep, label, fitPx, balanced } from '../_parts';

export { SOFT, DIM, FAINT, HAIR, GROUND, MIND_LOOK, unitOf, ground, veil, prep, label, footRow, headColor, onAccent, fitPx, balanced } from '../_parts';

/** The layout family and the safe box, in one object. */
export function frame(e) {
    const { W, H, safe, shape } = e;
    return {
        k: unitOf(e),
        size: e.look.size ?? 1,
        tall: shape === 'tall',
        post: shape === 'post',
        sq: shape === 'square',
        wide: shape === 'wide',
        strip: shape === 'strip',
        banner: shape === 'wide' || shape === 'strip',
        x0: safe.l,
        x1: W - safe.r,
        top: safe.t,
        bottom: H - safe.b,
    };
}

/** True when the uploaded product shot is a rectangle (a product on a set), not a cut-out. */
export function framedShot(e) {
    const img = e.asset('product');
    return !!img && !isCutout(img);
}

export const hasProduct = (e) => !!e.asset('product');

const hexRgb = (hex) => {
    const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
    const n = m ? parseInt(m[1], 16) : 0xfacc15;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The accent (or any #hex) at `a` opacity. */
export const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;

/** Mix two #hex colours: t = 0 → a, 1 → b. Returns rgb(). */
export function mix(a, b, t) {
    const A = hexRgb(a);
    const B = hexRgb(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}

/** A soft elliptical glow of `color` centred on (cx, cy). */
export function glow(e, cx, cy, rx, ry, alpha, color = e.accent) {
    if (alpha <= 0 || rx <= 0 || ry <= 0) return;
    const { ctx } = e;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        g.addColorStop(t, rgba(color, (alpha * (1 - t * t) ** 2).toFixed(4)));
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// ── Stackable pieces ─────────────────────────────────────────────────────
// Each is { h, draw(top) } (or null when its field is empty), so a column
// can be measured, centred, then drawn: see stackH / stack.

/** One line of small text (tracked caps by default), fitted to maxW. */
export function lineItem(e, key, text, x, { px, spec = TYPE.brandR, color = DIM, align = 'left', maxW = Infinity, tracking = 0.2, upper = true, before = 0, min = 0 } = {}) {
    let t = upper ? e.caps(text).trim() : String(text ?? '').trim();
    if (!t) return null;
    // Shrink to fit, but never below px × min: past that, cut it with an ellipsis.
    const p = Math.max(fitPx(e.ctx, t, spec, px, maxW, tracking), px * min);
    if (min && textWidth(e.ctx, t, spec, p, tracking) > maxW) t = wrapLines(e.ctx, t, spec, p, maxW, 1, tracking)[0] ?? t;
    const cap = capHeight(e.ctx, spec, p);
    return { h: cap, before, draw: (y) => label(e, key, t, x, y + cap, { px: p, maxW, align, color, spec, tracking, upper: false }) };
}

/** A display block fitted to maxW × maxH (prep), as a stack piece. */
export function blockItem(e, key, text, x, spec, fit, { align = 'left', color = e.ink, before = 0 } = {}) {
    const pb = prep(e, text, spec, fit);
    if (pb.empty) return null;
    return { h: pb.h + pb.desc, pb, before, draw: (y) => pb.draw(key, x, y, { align, color }) };
}

/**
 * Running text wrapped to maxW (typed line breaks kept, each paragraph
 * balanced), shrunk until it fits maxH and maxLines.
 */
export function paraItem(e, key, text, x, { px, spec = TYPE.brandL, maxW, maxH = Infinity, maxLines = 4, color = e.ink, leading = 1.34, align = 'left', before = 0, min = 0.62 } = {}) {
    const { ctx } = e;
    const raw = splitLines(text).filter((l) => l.trim());
    if (!raw.length) return null;
    let p = px;
    let lines = [];
    for (let i = 0; i < 8; i++) {
        lines = raw.flatMap((l) => balanced(ctx, l, spec, p, maxW, maxLines));
        const cap = capHeight(ctx, spec, p);
        const h = cap + (lines.length - 1) * p * leading;
        if ((lines.length <= maxLines && h <= maxH) || p <= px * min) break;
        p *= 0.92;
    }
    lines = lines.slice(0, maxLines);
    const cap = capHeight(ctx, spec, p);
    const h = cap + (lines.length - 1) * p * leading + p * 0.22;
    return {
        h, px: p, n: lines.length, before,
        draw: (y) => {
            const box = drawText(ctx, lines.join('\n'), spec, p, x, y + cap, { align, color, leading, accent: e.accent });
            if (key) e.mark(key, box);
            return box;
        },
    };
}

/** A fixed-height gap in a stack. */
export const gapItem = (h) => ({ h, draw: () => null });

export const stackH = (items) => items.reduce((s, it) => s + (it ? (it.before ?? 0) + it.h : 0), 0);

/** Draw stack pieces down from `top`. Returns the bottom. */
export function stack(items, top) {
    let y = top;
    for (const it of items) {
        if (!it) continue;
        y += it.before ?? 0;
        it.draw(y);
        y += it.h;
    }
    return y;
}

/**
 * The price line: the price in light Outfit, then the points in dim — "£38
 * · or 3,800 POWR points" — on one line, or two when it won't fit.
 */
export function priceItem(e, x, { px, maxW, align = 'left', before = 0, color = e.ink, dim = DIM, priceKey = 'price', pointsKey = 'points' } = {}) {
    const { ctx } = e;
    const price = String(e.fields[priceKey] ?? '').trim();
    const pts = String(e.fields[pointsKey] ?? '').trim();
    if (!price && !pts) return null;
    const pPx = px;
    const qPx = px * 0.62;
    const pCap = price ? capHeight(ctx, TYPE.brandL, pPx) : 0;
    const qCap = capHeight(ctx, TYPE.brandR, qPx);
    const gap = px * 0.55;
    const pw = price ? textWidth(ctx, price, TYPE.brandL, pPx) : 0;
    const qw = pts ? textWidth(ctx, pts, TYPE.brandR, qPx, 0.02) : 0;
    const oneLine = price && pts && align === 'left' && pw + gap + qw <= maxW;
    const twoH = pCap + (price && pts ? px * 0.62 + qCap : pts ? qCap : 0);
    const h = oneLine ? pCap : twoH;
    return {
        h, before,
        draw: (y) => {
            if (price) e.mark(priceKey, drawText(ctx, price, TYPE.brandL, fitPx(ctx, price, TYPE.brandL, pPx, maxW), x, y + pCap, { align, color }));
            if (!pts) return;
            const q = fitPx(ctx, pts, TYPE.brandR, qPx, oneLine ? maxW - pw - gap : maxW, 0.02);
            if (oneLine) {
                const px2 = align === 'right' ? x - pw - gap : x + pw + gap;
                e.mark(pointsKey, drawText(ctx, pts, TYPE.brandR, q, px2, y + pCap, { align, color: dim, tracking: 0.02 }));
            } else {
                const base = price ? y + pCap + px * 0.62 + qCap : y + qCap;
                e.mark(pointsKey, drawText(ctx, pts, TYPE.brandR, q, x, base, { align, color: dim, tracking: 0.02 }));
            }
        },
    };
}

/** "Label | value" rows → [[label, value], …] (a lone value keeps an empty label). */
export const pairs = (text, max = 8) => splitLines(text)
    .map((l) => l.split('|').map((s) => s.trim()))
    .filter((p) => p.some(Boolean))
    .slice(0, max)
    .map((p) => (p.length > 1 ? p : ['', p[0]]));

/** Items typed one per line (or split on ·), trimmed. */
export const items = (text, max = 8) => splitLines(text).map((s) => s.trim()).filter(Boolean).slice(0, max);

/** A reward's price and points words, for any template with price + points fields. */
export function productFill(r, extra = {}) {
    const v = r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''}` : '';
    const pts = r.cost ? `${thousands(r.cost)} POWR points` : '';
    return {
        ...rewardWords(r),
        points: v && pts ? `${v} for ${pts}` : pts ? `or ${pts}` : v ? `${v} in the POWR app` : '',
        ...extra,
    };
}

/** How tall footRow() will be (so a scene can be drawn before it). */
export function footH(e, k, { align = 'split', lockH = 26, footKey = 'footer' } = {}) {
    const foot = String(e.fields[footKey] ?? '').trim();
    if (align !== 'center' || !foot) return lockH * k;
    return lockH * k + 26 * k + capHeight(e.ctx, TYPE.brandR, 15 * k);
}

const lum = (hex) => hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);

/**
 * The accent for small marks and numerals on the dark ground: the accent
 * itself when it reads (≥ 3:1 on #0D0C0B), else lifted towards ink.
 */
export function readableAccent(e) {
    const L = lum(e.accent);
    if ((L + 0.05) / (0.0045 + 0.05) >= 3) return e.accent;
    for (let t = 0.2; t <= 1; t += 0.1) {
        const m = mix(e.accent, '#F4F1EA', t).match(/\d+/g).map(Number);
        const hex = `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        if ((lum(hex) + 0.05) / 0.0545 >= 3) return hex;
    }
    return '#F4F1EA';
}
