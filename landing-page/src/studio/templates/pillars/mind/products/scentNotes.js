/**
 * SCENT NOTES — a candle or oil with its fragrance pyramid: a thin-ruled
 * triangle in three bands (Top · Heart · Base), the apex in the accent, a
 * hairline from each band to its notes set in serif italic. Under it the
 * facts in mono (burn time, wax, weight). For candles, room oils, mists and
 * incense.
 */
import { TYPE } from '../../../../fonts';
import { capHeight, drawText, textWidth } from '../../../../text';
import { rule, dot } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, DIM, HAIR, GROUND, frame, ground, veil, footRow, footH, headColor, glow, framedShot,
    lineItem, blockItem, priceItem, stack, stackH, pairs, productFill,
} from './_parts';

const TIERS = [['top', 'Top'], ['heart', 'Heart'], ['base', 'Base']];
const CUTS = [0, 0.3, 0.64, 1];

// The pyramid, apex at (cx, y), base w wide at y + h. Returns each band's
// middle and the triangle's right edge there.
function pyramid(e, cx, y, w, h, k) {
    const { ctx } = e;
    const half = (t) => (w / 2) * t;
    const bands = [];
    ctx.save();
    for (let i = 0; i < 3; i++) {
        const a = CUTS[i];
        const b = CUTS[i + 1];
        const ya = y + h * a;
        const yb = y + h * b;
        ctx.beginPath();
        ctx.moveTo(cx - half(a), ya);
        ctx.lineTo(cx + half(a), ya);
        ctx.lineTo(cx + half(b), yb);
        ctx.lineTo(cx - half(b), yb);
        ctx.closePath();
        ctx.fillStyle = i === 0 ? e.accent : `rgba(244,241,234,${i === 1 ? 0.05 : 0.1})`;
        ctx.fill();
        const m = (a + b) / 2;
        bands.push({ y: y + h * m, edge: cx + half(m) });
    }
    ctx.strokeStyle = 'rgba(244,241,234,0.42)';
    ctx.lineWidth = Math.max(1, 1.3 * k);
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx + w / 2, y + h);
    ctx.lineTo(cx - w / 2, y + h);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    [1, 2].forEach((i) => rule(ctx, cx - half(CUTS[i]), y + h * CUTS[i], cx + half(CUTS[i]), y + h * CUTS[i], 'rgba(244,241,234,0.42)', Math.max(1, 1.3 * k)));
    return bands;
}

// A small pyramid with only band i filled: which tier a column is.
function bandIcon(e, x, y, s, i, k) {
    const { ctx } = e;
    const cx = x + s / 2;
    const a = CUTS[i];
    const b = CUTS[i + 1];
    ctx.save();
    ctx.fillStyle = i === 0 ? e.accent : 'rgba(244,241,234,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx - (s / 2) * a, y + s * a);
    ctx.lineTo(cx + (s / 2) * a, y + s * a);
    ctx.lineTo(cx + (s / 2) * b, y + s * b);
    ctx.lineTo(cx - (s / 2) * b, y + s * b);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.42)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(x + s, y + s);
    ctx.lineTo(x, y + s);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

// The notes, broken only between notes ("Fig leaf · Bergamot ·" / "Pink
// grapefruit"), at most two lines, shrunk to fit. A stack piece.
function noteLines(e, key, x, w, k, px) {
    const { ctx } = e;
    const notes = String(e.fields[key] ?? '').split(/\s*[·•,\n]\s*/).map((t) => t.trim()).filter(Boolean).slice(0, 4);
    if (!notes.length) return null;
    const lay = (p) => notes.reduce((ls, n) => {
        const last = ls[ls.length - 1];
        if (last && textWidth(ctx, `${last} · ${n}`, TYPE.serifI, p) <= w) ls[ls.length - 1] = `${last} · ${n}`;
        else ls.push(n);
        return ls;
    }, []);
    let p = px;
    let lines = lay(p);
    for (let i = 0; i < 6 && (lines.length > 2 || lines.some((l) => textWidth(ctx, l, TYPE.serifI, p) > w)); i++) {
        p *= 0.9;
        lines = lay(p);
    }
    lines = lines.slice(0, 2);
    const cap = capHeight(ctx, TYPE.serifI, p);
    return {
        h: cap + (lines.length - 1) * p * 1.18 + p * 0.2, before: 14 * k,
        draw: (y) => e.mark(key, drawText(ctx, lines.join('\n'), TYPE.serifI, p, x, y + cap, { color: e.ink, leading: 1.18 })),
    };
}

// One tier's words, a hairline leading in from the pyramid: TOP over the notes.
function tierWords(e, key, name, x, midY, w, k, { px, from }) {
    const lab = lineItem(e, null, name, x, { px: 14 * k, spec: TYPE.monoR, color: DIM, tracking: 0.24 });
    const notes = noteLines(e, key, x, w, k, px);
    const h = stackH([lab, notes]);
    const top = midY - h / 2;
    if (from != null) {
        rule(e.ctx, from + 14 * k, midY, x - 22 * k, midY, HAIR, Math.max(1, 1.1 * k));
        dot(e.ctx, from + 14 * k, midY, 2.4 * k, 'rgba(244,241,234,0.5)');
    }
    stack([lab, notes], top);
}

// Pyramid + notes in a box: the triangle left, the notes to its right.
function notesBlock(e, box, k) {
    const pw = Math.min(box.w * 0.48, box.h * 0.85, 380 * k);
    const ph = Math.min(box.h, pw * 1.12);
    const py = box.y + (box.h - ph) / 2;
    const bands = pyramid(e, box.x + pw / 2, py, pw, ph, k);
    const tx = box.x + pw + 58 * k;
    const px = Math.min(40 * k, (ph / 3) * 0.34);
    TIERS.forEach(([key, name], i) => tierWords(e, key, name, tx, bands[i].y, box.x + box.w - tx, k, { px, from: bands[i].edge }));
}

// The facts: label over value, columns split by hairlines.
function data(e, x0, x1, y, k, { px = 19 * k } = {}) {
    const { ctx } = e;
    const rows = pairs(e.fields.data, 4);
    if (!rows.length) return y;
    rule(ctx, x0, y, x1, y, HAIR, Math.max(1, 1.1 * k));
    const cw = (x1 - x0) / rows.length;
    const lCap = capHeight(ctx, TYPE.monoR, 13 * k);
    const vCap = capHeight(ctx, TYPE.mono, px);
    rows.forEach(([l, v], i) => {
        const x = x0 + i * cw + (i ? 24 * k : 0);
        if (i) rule(ctx, x0 + i * cw, y + 18 * k, x0 + i * cw, y + 30 * k + lCap + 16 * k + vCap, HAIR, Math.max(1, 1.1 * k));
        lineItem(e, null, l, x, { px: 13 * k, spec: TYPE.monoR, maxW: cw - 40 * k, color: DIM, tracking: 0.2 })?.draw(y + 26 * k);
        lineItem(e, null, v, x, { px, spec: TYPE.mono, maxW: cw - 40 * k, color: e.ink, tracking: 0.06 })?.draw(y + 26 * k + lCap + 16 * k);
    });
    e.mark('data', { x: x0, y, w: x1 - x0, h: 26 * k + lCap + 16 * k + vCap });
    return y + 26 * k + lCap + 16 * k + vCap;
}
const dataH = (e, k, px = 19 * k) => (pairs(e.fields.data, 4).length ? 26 * k + capHeight(e.ctx, TYPE.monoR, 13 * k) + 16 * k + capHeight(e.ctx, TYPE.mono, px) : 0);

function head(e, x, w, k, { namePx, maxH }) {
    const size = e.look.size ?? 1;
    return [
        lineItem(e, 'kind', e.fields.kind, x, { px: 15 * k, spec: TYPE.monoR, maxW: w, tracking: 0.22 }),
        blockItem(e, 'name', e.fields.name, x, e.headline, { maxW: w * size, maxH: maxH * size, max: namePx * k * size, lines: 2, gap: 0.2 }, { color: headColor(e), before: 22 * k }),
        priceItem(e, x, { px: 30 * k, maxW: w, before: 26 * k }),
    ];
}

function product(e, box) {
    if (framedShot(e)) {
        const w = Math.min(box.w, box.h * 0.8);
        const h = Math.min(box.h, w * 1.25);
        return productShot(e, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }, { stage: false, radius: 8 });
    }
    // Not taller than it needs to be: the product sits level with the notes.
    const h = Math.min(box.h, box.w * 1.55);
    const b = { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h };
    glow(e, b.x + b.w / 2, b.y + b.h * 0.55, b.w * 0.55, b.h * 0.5, 0.16);
    return productShot(e, b, { kind: e.look.kind ?? 'candle', sub: e.fields.kind });
}

export default {
    id: 'scent-notes',
    name: 'Scent Notes',
    category: 'Mind',
    section: 'Products',
    blurb: 'A candle or oil with its fragrance pyramid (Top · Heart · Base) drawn in thin rules, the notes in serif italic and the burn time in mono.',
    refs: 'a perfumer’s note card',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kind', label: 'What it is', value: 'Scented candle · 220 g' },
        { key: 'name', label: 'Name', rows: 2, value: 'Fig & Cedar', hint: '{Braces} colour a word.' },
        { key: 'top', label: 'Top notes', value: 'Fig leaf · Bergamot', hint: 'One to three notes.' },
        { key: 'heart', label: 'Heart notes', value: 'Violet · Black tea' },
        { key: 'base', label: 'Base notes', value: 'Cedarwood · Vetiver · Musk' },
        { key: 'data', label: 'Facts', rows: 3, value: 'Burn time | 45 h\nWax | Soy and coconut\nWick | Cotton', hint: 'One per line: label | value. Up to four.' },
        { key: 'price', label: 'Price', value: '£38' },
        { key: 'points', label: 'Points', value: 'or 3,800 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Northside Home' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Candle', fields: { kind: 'Scented candle · 220 g', name: 'Fig & Cedar', top: 'Fig leaf · Bergamot', heart: 'Violet · Black tea', base: 'Cedarwood · Vetiver · Musk', data: 'Burn time | 45 h\nWax | Soy and coconut\nWick | Cotton', price: '£38', points: 'or 3,800 POWR points', footer: 'Northside Home' } },
        { name: 'Room oil', fields: { kind: 'Diffuser · 100 ml', name: 'Hinoki', top: 'Yuzu', heart: 'Hinoki · Cypress', base: 'Oakmoss · Amber', data: 'Lasts | About 8 weeks\nReeds | 8 rattan\nVolume | 100 ml', price: '£45', points: 'or 4,500 POWR points', footer: 'Northside Home' } },
        { name: 'Linen mist', fields: { kind: 'Linen mist · 50 ml', name: 'Still Water', top: 'Neroli', heart: 'Lavender · Chamomile', base: 'White musk', data: 'Volume | 50 ml\nSprays | About 400\nBase | Plant alcohol', price: '£24', points: 'Members first in the POWR app', footer: 'Northside Home' } },
        { name: 'Incense', fields: { kind: 'Incense · 40 sticks', name: 'Temple Smoke', top: 'Pink pepper', heart: 'Frankincense · Rose', base: 'Sandalwood · Benzoin', data: 'Burn time | 30 min each\nSticks | 40\nMade | By hand', price: '£18', points: 'or 1,800 POWR points', footer: 'Northside Home' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, target: 0.2, kind: 'candle' },
    controls: [
        { key: 'kind', label: 'Stand-in', options: [['candle', 'Candle'], ['jar', 'Jar'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => productFill(r) },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k } = f;
        ground(e, GROUND);
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.62);
        }

        if (f.strip) {
            const footTop = f.bottom - footH(e, k, { lockH: 22 });
            const pb = { x: f.x0, y: f.top, w: W * 0.13, h: f.bottom - f.top };
            product(e, pb);
            const hx = pb.x + pb.w + 50 * k;
            const hw = W * 0.2;
            const list = head(e, hx, hw, k, { namePx: 64, maxH: (f.bottom - f.top) * 0.36 });
            stack(list, f.top + Math.max(0, (footTop - 30 * k - f.top - stackH(list)) / 2));
            footRow(e, { x0: hx, x1: hx + hw, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            // Three tiers across, each with its band of a small pyramid.
            const tx = hx + hw + 60 * k;
            const cw = (f.x1 - tx) / 3;
            TIERS.forEach(([key, name], i) => {
                const x = tx + i * cw;
                const s = 44 * k;
                const mid = (f.top + f.bottom) / 2;
                bandIcon(e, x, mid - s / 2, s, i, k);
                tierWords(e, key, name, x + s + 26 * k, mid, cw - s - 60 * k, k, { px: 30 * k });
            });
            return;
        }

        if (f.wide) {
            const footTop = f.bottom - footH(e, k);
            const pb = { x: f.x0, y: f.top + 20 * k, w: W * 0.28, h: footTop - 40 * k - f.top - 20 * k };
            product(e, pb);
            const x = pb.x + pb.w + 90 * k;
            const w = f.x1 - x;
            const list = head(e, x, w, k, { namePx: 84, maxH: H * 0.14 });
            const hb = stack(list, f.top + 10 * k);
            const dh = dataH(e, k);
            const dy = footTop - 40 * k - dh;
            notesBlock(e, { x, y: hb + 50 * k, w: w * 0.85, h: dy - 50 * k - hb - 50 * k }, k);
            data(e, x, f.x1, dy, k);
            footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
            return;
        }

        // Post, square, story.
        const footTop = f.bottom - footH(e, k);
        const w = f.x1 - f.x0;
        const top = f.top + (f.tall ? 40 : 0) * k;
        const list = head(e, f.x0, w * (f.tall ? 1 : 0.6), k, { namePx: f.sq ? 84 : 110, maxH: H * (f.tall ? 0.1 : 0.13) });
        const hb = stack(list, top);
        const dh = dataH(e, k);
        const dy = footTop - (f.sq ? 36 : 50) * k - dh;
        const midTop = hb + (f.sq ? 40 : 60) * k;
        const midBottom = dy - (f.sq ? 36 : 50) * k;
        if (f.tall) {
            const split = midTop + (midBottom - midTop) * 0.48;
            product(e, { x: f.x0 + w * 0.2, y: midTop, w: w * 0.6, h: split - midTop - 30 * k });
            notesBlock(e, { x: f.x0 + w * 0.04, y: split + 30 * k, w: w * 0.92, h: midBottom - split - 30 * k }, k);
        } else {
            const pw = w * (f.sq ? 0.34 : 0.36);
            product(e, { x: f.x0, y: midTop, w: pw, h: midBottom - midTop });
            notesBlock(e, { x: f.x0 + pw + 50 * k, y: midTop, w: w - pw - 50 * k, h: midBottom - midTop }, k);
        }
        data(e, f.x0, f.x1, dy, k);
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
    },
};
