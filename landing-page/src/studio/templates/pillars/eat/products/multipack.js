/**
 * MULTIPACK — the box, opened: the product repeated in a neat grid (as many
 * as the count says, laid out to fill the space), each row on its own
 * divider inside a fine carton outline. "Box of 12" big, then the price per
 * box beside the price per bar. For bar, drink and snack brands selling by
 * the box.
 */
import { TYPE } from '../../../../fonts';
import { rule } from '../../../../shapes';
import { drawText, capHeight } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords, mockRect } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, framed, backdrop, eyebrow, head, headHeight, para, paraLines, rows, num, lift, alpha, GREY, INK, HAIR, fitPx } from './_parts';

// The shot's aspect (w/h) as it will be drawn in a cell.
function aspect(e, kind) {
    const img = e.asset('product');
    if (!img) { const r = mockRect({ x: 0, y: 0, w: 1000, h: 1000 }, kind); return r.w / r.h; }
    if (framed(e)) return 0.8;
    return img.width / img.height;
}

/**
 * The carton: `n` of the product in the grid that makes them biggest in
 * (x, y, w, h), rows on dividers, a fine outline round it all. Returns the
 * carton's box.
 */
function carton(e, box, U, kind, sub) {
    const { ctx } = e;
    const n = Math.max(1, Math.min(24, Math.round(num(e.fields.count)) || 12));
    const ar = aspect(e, kind);
    const pad = 26 * U;
    const gap = 14 * U;
    const iw = box.w - pad * 2;
    const ih = box.h - pad * 2;
    let best = null;
    for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c);
        if (c * r - n >= c) continue;
        const cellH = Math.min((ih - gap * (r - 1)) / r, ((iw - gap * (c - 1)) / c) / ar);
        if (!best || cellH > best.cellH) best = { c, r, cellH };
    }
    const { c, r, cellH } = best;
    const cellW = cellH * ar;
    const gw = c * cellW + (c - 1) * gap;
    const gh = r * cellH + (r - 1) * gap;
    const out = { x: box.x + (box.w - gw) / 2 - pad, y: box.y + (box.h - gh) / 2 - pad, w: gw + pad * 2, h: gh + pad * 2 };
    glow(e, out.x + out.w / 2, out.y + out.h / 2, Math.max(out.w, out.h) * 0.62, { strength: 0.35 });
    ctx.fillStyle = 'rgba(20,20,19,0.9)';
    ctx.beginPath();
    ctx.roundRect(out.x, out.y, out.w, out.h, 10 * U);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = alpha(INK, 0.22);
    ctx.lineWidth = Math.max(1, 1.3 * U);
    ctx.beginPath();
    ctx.roundRect(out.x, out.y, out.w, out.h, 10 * U);
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < n; i++) {
        const row = Math.floor(i / c);
        const col = i % c;
        // A short last row sits centred.
        const inRow = row === r - 1 ? n - row * c : c;
        const rx = out.x + pad + (gw - (inRow * cellW + (inRow - 1) * gap)) / 2;
        const cx = rx + col * (cellW + gap);
        const cy = out.y + pad + row * (cellH + gap);
        slot(e, { x: cx, y: cy, w: cellW, h: cellH }, { kind, sub, frame: 0.8, stage: 0, radius: 6 });
    }
    for (let row = 1; row < r; row++) {
        const y = out.y + pad + row * (cellH + gap) - gap / 2;
        rule(ctx, out.x + pad * 0.5, y, out.x + out.w - pad * 0.5, y, HAIR, Math.max(1, 1 * U));
    }
    e.mark('count', out);
    return out;
}

// One price: the amount big, its unit in mono under it. Returns its width.
function price(e, key, text, x, top, U, { px = 60, maxW = Infinity } = {}) {
    const { ctx } = e;
    const [amt = '', per = ''] = rows(text, 1)[0] ?? [];
    if (!amt) return 0;
    const p = fitPx(ctx, amt, TYPE.brandSB, px * U, maxW);
    const cap = capHeight(ctx, TYPE.brandSB, p);
    const b1 = drawText(ctx, amt, TYPE.brandSB, p, x, top + cap, { color: INK });
    const lab = e.caps(per);
    const b2 = lab.trim() ? drawText(ctx, lab, TYPE.mono, 17 * U, x, top + cap + 17 * U * 1.9, { tracking: 0.16, color: GREY }) : null;
    e.mark(key, b2 ? { x: b1.x, y: b1.y, w: Math.max(b1.w, b2.x + b2.w - b1.x), h: b2.y + b2.h - b1.y } : b1);
    return Math.max(b1.w, b2 ? b2.w : 0);
}
const priceH = (e, U, px = 60) => capHeight(e.ctx, TYPE.brandSB, px * U) + 17 * U * 1.9;

// The two prices side by side with a hairline between. Returns height.
function prices(e, x, top, w, U, px = 60) {
    const half = w / 2;
    price(e, 'price', e.fields.price, x, top, U, { px, maxW: half - 30 * U });
    if (String(e.fields.per ?? '').trim()) {
        rule(e.ctx, x + half - 14 * U, top, x + half - 14 * U, top + priceH(e, U, px), HAIR, Math.max(1, 1.2 * U));
        price(e, 'per', e.fields.per, x + half + 12 * U, top, U, { px, maxW: half - 30 * U });
    }
    return priceH(e, U, px);
}

export default {
    id: 'eat-multipack',
    name: 'Multipack',
    category: 'Eat',
    section: 'Products',
    blurb: 'The box opened: the product repeated in a neat grid by the count, “Box of 12” big, the price per box beside the price per bar.',
    refs: 'a retail-ready tray, seen from the front',
    headlineFont: 'brand',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Stock the cupboard' },
        { key: 'title', label: 'Title', value: 'Box of 12' },
        { key: 'name', label: 'Product name', value: 'Northside Bar · Peanut Crunch' },
        { key: 'count', label: 'How many in the box', value: '12', hint: 'Sets the grid: 1 to 24.' },
        { key: 'price', label: 'Price per box', value: '£24.00 | a box', hint: 'price | unit' },
        { key: 'per', label: 'Price each', value: '£2.00 | a bar', hint: 'price | unit. Leave empty to hide it.' },
        { key: 'line', label: 'Line', value: 'Or 2,400 POWR points a box, in the app.', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Bars', fields: {}, look: { kind: 'pouch' } },
        { name: 'Cans', fields: { kicker: 'Fridge-ready', title: 'Case of 24', name: 'Northside Sparkling · Yuzu', count: '24', price: '£28.80 | a case', per: '£1.20 | a can', line: 'Or 2,880 POWR points a case.' }, look: { kind: 'bottle' }, style: { accent: '#C6E86B' } },
        { name: 'Shakes', fields: { kicker: 'Ready to drink', title: 'Six-pack', name: 'Northside Shake · Cold Brew', count: '6', price: '£15.00 | six', per: '£2.50 | a bottle', line: 'Members first in the POWR app.' }, look: { kind: 'bottle' }, style: { accent: '#D9A066' } },
        { name: 'Sticks', fields: { kicker: 'Twenty days in a box', title: 'Box of 20', name: 'Northside Hydrate · Berry', count: '20', price: '£18.00 | a box', per: '90p | a stick', line: 'One stick to 500 ml water.' }, look: { kind: 'box' }, style: { accent: '#E0556B' } },
    ],
    look: { ...LOOK, kind: 'pouch' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['pouch', 'Bar / pouch'], ['bottle', 'Bottle / can'], ['box', 'Box'], ['tub', 'Tub'], ['jar', 'Jar']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.cost ? { line: `Or ${rewardWords(r).points.replace('points', 'POWR points')} in the app.` } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const U = unitOf(e);
        const f = e.fields;
        const kind = e.look.kind ?? 'pouch';
        const sub = String(f.name ?? '').split('·')[1]?.trim() ?? '';
        ground(e);
        backdrop(e);

        if (shape === 'strip') {
            const x = safe.l;
            const colW = W * 0.3;
            lockup(e, x, safe.t, 26 * U, { maxW: colW });
            eyebrow(e, 'name', f.name, 16 * U, x, safe.t + 96 * U, { maxW: colW, color: lift(e.accent) });
            head(e, 'title', f.title, x, safe.t + 124 * U, { maxW: colW, maxH: 130 * U, lines: 1 });
            para(e, 'line', f.line, TYPE.brandL, 16 * U, x, H - safe.b, colW, 1, { color: GREY });
            const px = x + colW + 60 * U;
            const pw = W * 0.24;
            prices(e, px, (H - priceH(e, U, 54)) / 2, pw, U, 54);
            const gx = px + pw + 40 * U;
            carton(e, { x: gx, y: safe.t - 10 * U, w: W - safe.r - gx + 10 * U, h: H - safe.t - safe.b + 20 * U }, U, kind, sub);
            return;
        }

        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        if (shape === 'wide') {
            const colW = w * 0.4;
            lockup(e, x, safe.t, 40 * U, { maxW: colW });
            const ll = paraLines(e, f.line, TYPE.brandL, 22 * U, colW, 2);
            let y = H - safe.b;
            if (ll) { para(e, 'line', f.line, TYPE.brandL, 22 * U, x, y - (ll - 1) * 22 * U * 1.32, colW, 2, { color: GREY }); y -= (ll - 1) * 22 * U * 1.32 + 22 * U + 50 * U; }
            const ph = priceH(e, U, 64);
            prices(e, x, y - ph, colW, U, 64);
            y -= ph + 60 * U;
            const th = headHeight(e, f.title, { maxW: colW, maxH: 190 * U, lines: 2 });
            head(e, 'title', f.title, x, y - th, { maxW: colW, maxH: 190 * U, lines: 2 });
            eyebrow(e, 'name', f.name, 20 * U, x, y - th - 30 * U, { maxW: colW, color: lift(e.accent) });
            eyebrow(e, 'kicker', f.kicker, 20 * U, x + w, safe.t + 20 * U, { align: 'right', color: GREY });
            const gx = x + colW + 80 * U;
            carton(e, { x: gx, y: safe.t + 60 * U, w: x + w - gx, h: H - safe.b - safe.t - 60 * U }, U, kind, sub);
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: GREY, maxW: w * 0.36 });
        // Bottom-up: line, then title left + prices right.
        let y = H - safe.b;
        const ll = paraLines(e, f.line, TYPE.brandL, 22 * U, w, 2);
        if (ll) { para(e, 'line', f.line, TYPE.brandL, 22 * U, x, y - (ll - 1) * 22 * U * 1.32, w, 2, { color: GREY }); y -= (ll - 1) * 22 * U * 1.32 + 22 * U + 44 * U; }
        const pPx = sq ? 48 : 58;
        const ph = priceH(e, U, pPx);
        const pw = w * 0.44;
        const tw = w - pw - 40 * U;
        const tMax = (tall ? 200 : sq ? 120 : 150) * U;
        const th = headHeight(e, f.title, { maxW: tw, maxH: tMax, lines: 2 });
        const blockH = Math.max(th, ph);
        head(e, 'title', f.title, x, y - th, { maxW: tw, maxH: tMax, lines: 2 });
        prices(e, x + w - pw, y - ph, pw, U, pPx);
        eyebrow(e, 'name', f.name, 20 * U, x, y - blockH - 30 * U, { maxW: w, color: lift(e.accent) });
        const top = lk.y + lk.h + (tall ? 90 : 44) * U;
        const bottom = y - blockH - 80 * U;
        carton(e, { x, y: top, w, h: bottom - top }, U, kind, sub);
    },
};
