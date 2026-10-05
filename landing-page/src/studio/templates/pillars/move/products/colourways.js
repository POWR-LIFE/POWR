/**
 * COLOURWAYS — the product lit in the colour you've picked: a column (or a
 * row) of drawn swatches, each named with its hex, the active one ringed,
 * and the backdrop glowing in that colour. The name and price underneath.
 * For activewear and footwear launching or restocking in colours.
 */
import { TYPE } from '../../../../fonts';
import { drawText, textWidth } from '../../../../text';
import { rule, ring } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { GREY, SOFT, DIM, HAIR, frame, ground, backdrop, line, block, blockHeight, cap, fitPx, makerOf, mono } from './_parts';

// "Black #111111 · Stone #C9C1B3" → [{ name, color }], at most 6.
function coloursOf(e) {
    return String(e.fields.colours ?? '')
        .split(/\s*(?:·|\||,|\n)\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const m = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
            const name = s.replace(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i, '').trim();
            return { name: name || (m ? `#${m[1]}` : s), color: m ? `#${m[1]}` : '#6b6b68', hex: m ? `#${m[1].toUpperCase()}` : '' };
        })
        .slice(0, 6);
}

function activeOf(e, list) {
    const a = String(e.fields.active ?? '').trim().toLowerCase();
    const i = list.findIndex((c) => c.name.toLowerCase() === a);
    if (i >= 0) return i;
    const n = parseInt(a, 10);
    return Number.isFinite(n) && n >= 1 && n <= list.length ? n - 1 : 0;
}

// One swatch disc with a hairline rim (so black reads on black).
function disc(e, x, y, r, c, on) {
    const { ctx } = e;
    const k = frame(e).k;
    ctx.save();
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // A soft highlight: it's fabric under a light, not a flat dot.
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ring(ctx, x, y, r, 'rgba(244,241,234,0.22)', Math.max(1, 1.2 * k));
    if (on) ring(ctx, x, y, r * 1.32, e.ink, Math.max(1.5, 2.2 * k));
}

// The swatches as a column from `top` in x0..x1: disc, name, hex. Returns the box.
function column(e, list, act, x0, x1, top, bottom) {
    const k = frame(e).k;
    const n = list.length;
    if (!n) return null;
    const step = Math.min(130 * k, (bottom - top) / n);
    const r = Math.min(step * 0.3, 34 * k);
    list.forEach((c, i) => {
        const cy = top + step * (i + 0.5);
        const on = i === act;
        disc(e, x0 + r * 1.35, cy, r, c, on);
        const tx = x0 + r * 3.3;
        const px = Math.min(r * 0.95, 30 * k);
        const nm = fitPx(e.ctx, c.name, TYPE.brandM, px, x1 - tx);
        drawText(e.ctx, c.name, on ? TYPE.brandSB : TYPE.brandR, nm, tx, cy + (c.hex ? -px * 0.08 : px * 0.35), { color: on ? e.ink : SOFT });
        if (c.hex) drawText(e.ctx, c.hex, TYPE.mono, px * 0.48, tx, cy + px * 0.78, { tracking: 0.14, color: on ? GREY : DIM });
    });
    const box = { x: x0, y: top, w: x1 - x0, h: step * n };
    e.mark('colours', box);
    return box;
}

// The swatches as a row across x0..x1 (names under). Returns the box.
function row(e, list, act, x0, x1, top, h) {
    const k = frame(e).k;
    const n = list.length;
    if (!n) return null;
    const cell = (x1 - x0) / n;
    const px = Math.min(h * 0.2, 24 * k, cell * 0.18);
    const r = Math.min(cell * 0.3, (h - px * 2.6) * 0.38);
    list.forEach((c, i) => {
        const cx = x0 + cell * (i + 0.5);
        const cy = top + r * 1.35;
        disc(e, cx, cy, r, c, i === act);
        const on = i === act;
        const p = fitPx(e.ctx, c.name, TYPE.brandM, px, cell * 0.92);
        drawText(e.ctx, c.name, on ? TYPE.brandSB : TYPE.brandR, p, cx, cy + r * 1.35 + px * 1.4, { align: 'center', color: on ? e.ink : GREY });
    });
    const box = { x: x0, y: top, w: x1 - x0, h };
    e.mark('colours', box);
    return box;
}

// "04 colourways": the count in the headline face, the word in mono.
function count(e, n, x, base, px) {
    if (!n) return;
    const { ctx } = e;
    const num = String(n).padStart(2, '0');
    drawText(ctx, num, TYPE.brandXL, px, x, base, { color: e.accent, tracking: -0.02 });
    const w = textWidth(ctx, num, TYPE.brandXL, px, -0.02);
    mono(e, e.fields.countLabel ?? '', x + w + px * 0.18, base, px * 0.2, { color: SOFT });
    e.mark('countLabel', { x, y: base - cap(e, TYPE.brandXL, px), w: w + px * 1.6, h: cap(e, TYPE.brandXL, px) });
}

export default {
    id: 'move-colourways',
    name: 'Colourways',
    category: 'Move',
    section: 'Products',
    blurb: 'The product with its colours as drawn swatches, named with their hex, the active one ringed and lighting the backdrop. For kit landing in new colours.',
    refs: 'a paint-chip card',
    headlineFont: 'brandSB',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'New colourways' },
        { key: 'name', label: 'Product name', value: 'Studio tight' },
        { key: 'price', label: 'Price', value: '£68' },
        { key: 'colours', label: 'Colours', rows: 3, value: 'Black #111111 · Stone #C9C1B3 · Volt #D7F25A · Clay #B86B4B', hint: 'Name then hex, split with · (up to six).' },
        { key: 'active', label: 'Shown colour', value: 'Stone', hint: 'Its name (or its number). It is ringed and lights the backdrop.' },
        { key: 'countLabel', label: 'Count label', value: 'Colourways' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Leggings', fields: { eyebrow: 'New colourways', name: 'Studio tight', price: '£68', colours: 'Black #111111 · Stone #C9C1B3 · Volt #D7F25A · Clay #B86B4B', active: 'Stone' } },
        { name: 'Trainer', fields: { eyebrow: 'Autumn run', name: 'Tempo runner', price: '£125', colours: 'Chalk #E9E4D8 · Volt #D7F25A · Ember #E4572E', active: 'Volt' } },
        { name: 'Bottle', fields: { eyebrow: 'Five finishes', name: 'Trail bottle', price: '£32', colours: 'Steel #A8ABAE · Carbon #1C1C1C · Sage #8FA58A · Sky #7FB5E0 · Rust #A4502C', active: 'Carbon' } },
        { name: 'Gym merch', fields: { eyebrow: 'Club hoodie', name: 'POWR club hoodie', price: '£55', colours: 'Carbon #1B1B1B · Bone #E7E1D3 · Forest #2F4A3A', active: 'Bone', countLabel: 'Colours' } },
    ],
    look: {
        mono: 1, target: 0.24, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), ...(r.value ? { eyebrow: `${r.value}${r.unit ? ` ${r.unit}` : ''} with points` } : {}) }),
    },

    draw(e) {
        const f = frame(e);
        const { ctx, W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const list = coloursOf(e);
        const act = activeOf(e, list);
        const glow = list[act]?.color;
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const sub = e.fields.name;

        if (strip) {
            const pw = W * 0.2;
            ground(e, { cx: x0 + pw / 2, cy: H * 0.55, r: H * 0.8, color: glow, amount: 1.7 });
            backdrop(e);
            productShot(e, { x: x0, y: y0, w: pw, h: y1 - y0 }, { kind: 'pouch', label: makerOf(e), sub });
            const tx = x0 + pw + 50 * k;
            const tw = W * 0.3;
            lockup(e, tx, y0, 36 * k, { maxW: tw });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, tx, y0 + 36 * k + 50 * k, 14 * k, { maxW: tw, color: SOFT }));
            const nb = y1 - 70 * k;
            block(e, 'name', tx, nb, tw, 110 * k, { bottom: true, tracking: -0.02, maxLines: 2, caps: false });
            line(e, 'price', TYPE.brandL, 48 * k, tx, y1, tw, { tracking: -0.02 });
            row(e, list, act, tx + tw + 40 * k, x1, y0 + (y1 - y0) * 0.18, (y1 - y0) * 0.7);
            return;
        }

        if (wide) {
            const pw = (x1 - x0) * 0.42;
            ground(e, { cx: x0 + pw / 2, cy: H * 0.55, r: H * 0.6, color: glow, amount: 1.7 });
            backdrop(e);
            productShot(e, { x: x0 + pw * 0.1, y: y0 + 110 * k, w: pw * 0.8, h: y1 - y0 - 110 * k }, { kind: 'pouch', label: makerOf(e), sub });
            lockup(e, x0, y0, 50 * k, { maxW: pw });
            const cx = x0 + pw + 80 * k;
            count(e, list.length, cx, y0 + 90 * k, 110 * k);
            const nh = 150 * k;
            const priceBase = y1;
            const nameTop = priceBase - 70 * k - nh;
            column(e, list, act, cx, x1, y0 + 130 * k, nameTop - 30 * k);
            rule(ctx, cx, nameTop - 24 * k, x1, nameTop - 24 * k, HAIR, Math.max(1, 1.2 * k));
            const hh = blockHeight(e, 'name', x1 - cx, nh, { tracking: -0.02, maxLines: 2, caps: false });
            block(e, 'name', cx, priceBase - 76 * k - hh, x1 - cx, nh, { tracking: -0.02, maxLines: 2, caps: false });
            line(e, 'price', TYPE.brandL, 54 * k, cx, priceBase, (x1 - cx) * 0.5, { tracking: -0.02 });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, priceBase, 15 * k, { align: 'right', maxW: (x1 - cx) * 0.45, color: SOFT }));
            return;
        }

        const lh = (sq ? 46 : 54) * k;
        // Bottom: name left, price right on one line.
        const namePx = (tall ? 70 : sq ? 54 : 62) * k;
        const nameBase = y1 - (tall ? 10 : 0) * k;
        const ruleY = nameBase - cap(e, TYPE.brandSB, namePx) - 34 * k;
        const top = y0 + lh + (sq ? 40 : 60) * k;

        if (tall) {
            // Story: product up top, the swatches as a row above the name.
            const rowH = 190 * k;
            const rowTop = ruleY - 40 * k - rowH;
            ground(e, { cx: W / 2, cy: (top + rowTop) / 2, r: W * 0.6, color: glow, amount: 1.7 });
            backdrop(e);
            productShot(e, { x: x0 + (x1 - x0) * 0.1, y: top + 120 * k, w: (x1 - x0) * 0.8, h: rowTop - top - 180 * k }, { kind: 'pouch', label: makerOf(e), sub });
            row(e, list, act, x0, x1, rowTop, rowH);
            count(e, list.length, x0, top + 90 * k, 110 * k);
        } else {
            const split = x0 + (x1 - x0) * (sq ? 0.56 : 0.58);
            ground(e, { cx: (x0 + split) / 2, cy: (top + ruleY) / 2, r: (split - x0) * 0.9, color: glow, amount: 1.7 });
            backdrop(e);
            productShot(e, { x: x0 + (split - x0) * 0.1, y: top + 30 * k, w: (split - x0) * 0.8 - 20 * k, h: ruleY - top - 70 * k }, { kind: 'pouch', label: makerOf(e), sub });
            const cx = split + 30 * k;
            const cPx = (sq ? 90 : 110) * k;
            count(e, list.length, cx, top + cap(e, TYPE.brandXL, cPx), cPx);
            column(e, list, act, cx, x1, top + cap(e, TYPE.brandXL, cPx) + 40 * k, ruleY - 30 * k);
        }
        e.shade({ x: x0, y: y0, w: x1 - x0, h: lh }, { ceiling: 0.3, max: 0.5 });
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, (sq ? 16 : 18) * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        rule(ctx, x0, ruleY, x1, ruleY, HAIR, Math.max(1, 1.2 * k));
        const pr = line(e, 'price', TYPE.brandL, namePx, x1, nameBase, (x1 - x0) * 0.3, { align: 'right', tracking: -0.02 });
        line(e, 'name', e.headline, namePx, x0, nameBase, (x1 - x0) - (pr ? pr.w + 40 * k : 0), { tracking: -0.02 });
    },
};
