/**
 * IN THE BOX — a ritual kit drawn like an exploded catalogue plate: the
 * product in the middle, what's in the box numbered round it (01 Candle ·
 * 02 Journal · 03 Matches …), each joined to the product by a hairline that
 * ends in a small ring. The kit's name in serif above, the price below. For
 * gift sets, ritual kits and subscription boxes.
 */
import { TYPE } from '../../../../fonts';
import { capHeight } from '../../../../text';
import { rule, dot, ring } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, HAIR, GROUND, frame, ground, veil, footRow, footH, headColor, glow, framedShot, fitPx,
    lineItem, blockItem, priceItem, stack, stackH, items, productFill, readableAccent,
} from './_parts';

const num = (i) => String(i + 1).padStart(2, '0');

// One item: "01" in mono over the name. Returns its box and its anchor (where the leader starts).
function item(e, i, text, x, y, w, k, { px, align }) {
    const { ctx } = e;
    const nPx = Math.min(15 * k, px * 0.55);
    const nCap = capHeight(ctx, TYPE.mono, nPx);
    const p = Math.max(px * 0.8, fitPx(ctx, text, TYPE.brandL, px, w));
    const cap = capHeight(ctx, TYPE.brandL, p);
    lineItem(e, null, num(i), x, { px: nPx, spec: TYPE.mono, color: readableAccent(e), tracking: 0.16, align, upper: false }).draw(y);
    const b = lineItem(e, null, text, x, { px: p, spec: TYPE.brandL, maxW: w, color: e.ink, tracking: 0, align, upper: false, min: 1 }).draw(y + nCap + 14 * k);
    return { h: nCap + 14 * k + cap, mid: y + nCap / 2, box: b };
}

// The plate: items split left and right of the product, leaders to it.
function plate(e, rect, x0, x1, y0, y1, k, { px }) {
    const { ctx } = e;
    const list = items(e.fields.items, 6);
    if (!list.length) return;
    const nl = Math.ceil(list.length / 2);
    const cols = [list.slice(0, nl), list.slice(nl)];
    const gap = 50 * k;
    cols.forEach((col, side) => {
        if (!col.length) return;
        const right = side === 1;
        const colX = right ? rect.x + rect.w + gap * 1.6 : x0;
        const colW = right ? x1 - colX : rect.x - gap * 1.6 - x0;
        const ax = right ? colX : x0 + colW;
        const span = Math.min(y1 - y0, Math.max(rect.h * 1.05, col.length * px * 3.4));
        const top = (y0 + y1) / 2 - span / 2;
        const step = span / col.length;
        col.forEach((text, j) => {
            const i = right ? nl + j : j;
            const y = top + step * j + step * 0.3;
            const it = item(e, i, text, ax, y, colW, k, { px, align: right ? 'left' : 'right' });
            // Leader: out from beside the number, to a ring on the product.
            const ty = Math.min(rect.y + rect.h * 0.88, Math.max(rect.y + rect.h * 0.14, rect.y + rect.h * ((j + 0.5) / col.length)));
            const tx = right ? rect.x + rect.w * 0.88 : rect.x + rect.w * 0.12;
            const sx = right ? ax - 22 * k : ax + 22 * k;
            rule(ctx, sx, it.mid, tx, ty, 'rgba(244,241,234,0.32)', Math.max(1, 1.1 * k));
            dot(ctx, sx, it.mid, 2.2 * k, 'rgba(244,241,234,0.6)');
            ring(ctx, tx, ty, 7 * k, 'rgba(244,241,234,0.75)', Math.max(1, 1.3 * k));
            dot(ctx, tx, ty, 3 * k, readableAccent(e));
        });
    });
    e.mark('items', { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

function product(e, box) {
    if (framedShot(e)) {
        const w = Math.min(box.w, box.h * 0.85);
        const h = Math.min(box.h, w * 1.2);
        return productShot(e, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }, { stage: false, radius: 8 }).rect;
    }
    glow(e, box.x + box.w / 2, box.y + box.h * 0.55, box.w * 0.6, box.h * 0.5, 0.16);
    return productShot(e, box, { kind: 'box', sub: e.fields.kicker }).rect;
}

function head(e, x, w, k, { namePx, maxH, align = 'center' }) {
    const size = e.look.size ?? 1;
    return [
        lineItem(e, 'kicker', e.fields.kicker, x, { px: 16 * k, spec: TYPE.monoR, maxW: w, tracking: 0.22, align }),
        blockItem(e, 'name', e.fields.name, x, e.headline, { maxW: w * size, maxH: maxH * size, max: namePx * k * size, lines: 2, gap: 0.2 }, { align, color: headColor(e), before: 22 * k }),
    ];
}

export default {
    id: 'in-the-box',
    name: 'In the Box',
    category: 'Mind',
    section: 'Products',
    blurb: 'A ritual kit laid out like a catalogue plate: the product in the middle, what’s in the box numbered round it with hairlines to the product, the kit’s name above.',
    refs: 'an exploded-view catalogue plate',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'The ritual kit' },
        { key: 'name', label: 'Kit name', rows: 2, value: 'The Evening Box', hint: '{Braces} colour a word.' },
        { key: 'items', label: 'In the box', rows: 6, value: 'Candle, 220 g\nJournal, A5\nMatches\nLinen mist, 50 ml\nLoose tea, 50 g\nA card with the ritual', hint: 'One per line, up to six. They’re numbered for you.' },
        { key: 'price', label: 'Price', value: '£64' },
        { key: 'points', label: 'Points', value: 'or 6,400 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Boxed and wrapped · Northside' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Evening box', fields: { kicker: 'The ritual kit', name: 'The Evening Box', items: 'Candle, 220 g\nJournal, A5\nMatches\nLinen mist, 50 ml\nLoose tea, 50 g\nA card with the ritual', price: '£64', points: 'or 6,400 POWR points', footer: 'Boxed and wrapped · Northside' } },
        { name: 'Starter kit', fields: { kicker: 'Start here', name: 'Sitting Kit', items: 'Buckwheat cushion\nWool blanket\nBrass bell\nA month of guided sits', price: '£85', points: 'Members first in the POWR app', footer: 'Northside Studio' } },
        { name: 'Monthly box', fields: { kicker: 'October box', name: 'The Slow\nMonth', items: 'A seasonal candle\nFour prompt cards\nHerbal tea, 20 bags\nA short read\nPressed flowers', price: '£30 a month', points: 'Or your first box for 3,000 POWR points', footer: 'Skip or stop any month' } },
        { name: 'Journal set', fields: { kicker: 'Gift set', name: 'Pages', items: 'Journal, A5\nFountain pen\nBlack ink, 30 ml\nLinen bookmark', price: '£48', points: 'or 4,800 POWR points', footer: 'Northside Paper' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, target: 0.2 },
    fill: { reward: (r) => productFill(r) },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k } = f;
        ground(e, GROUND);
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.64);
        }

        if (f.strip) {
            const pb = { x: f.x0, y: f.top, w: W * 0.14, h: f.bottom - f.top };
            product(e, pb);
            const hx = pb.x + pb.w + 50 * k;
            const hw = W * 0.22;
            const list = [...head(e, hx, hw, k, { namePx: 64, maxH: (f.bottom - f.top) * 0.36, align: 'left' }), priceItem(e, hx, { px: 26 * k, maxW: hw, before: 22 * k })];
            stack(list, f.top + Math.max(0, (f.bottom - 50 * k - f.top - stackH(list)) / 2));
            footRow(e, { x0: hx, x1: hx + hw, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            // The items in a grid, three across.
            const gx = hx + hw + 60 * k;
            const list2 = items(e.fields.items, 6);
            const cols = Math.min(3, list2.length);
            const rows = Math.ceil(list2.length / cols);
            const cw = (f.x1 - gx) / Math.max(1, cols);
            const rh = (f.bottom - f.top) / Math.max(1, rows);
            list2.forEach((t, i) => {
                const c = i % cols;
                const r = Math.floor(i / cols);
                const x = gx + c * cw;
                const y = f.top + r * rh;
                rule(e.ctx, x, y + 4 * k, x + cw - 30 * k, y + 4 * k, HAIR, Math.max(1, 1.1 * k));
                item(e, i, t, x, y + 30 * k, cw - 40 * k, k, { px: 26 * k, align: 'left' });
            });
            e.mark('items', { x: gx, y: f.top, w: f.x1 - gx, h: f.bottom - f.top });
            return;
        }

        const footTop = f.bottom - footH(e, k, { align: 'center' });
        const top = f.top + (f.tall ? 40 : 0) * k;
        const w = f.x1 - f.x0;
        const hb = stack(head(e, W / 2, w * 0.8, k, { namePx: f.sq ? 72 : f.wide ? 84 : 92, maxH: H * (f.wide ? 0.14 : 0.1) }), top);
        const price = priceItem(e, W / 2, { px: 30 * k, maxW: w, align: 'center' });
        const py = footTop - (f.sq ? 40 : 60) * k - (price?.h ?? 0);
        price?.draw(py);
        const y0 = hb + (f.sq ? 50 : 80) * k;
        const y1 = py - (f.sq ? 50 : 80) * k;
        const pw = w * (f.wide ? 0.26 : f.sq ? 0.3 : f.tall ? 0.4 : 0.38);
        const ph = Math.min(y1 - y0, pw * 1.5);
        const rect = product(e, { x: W / 2 - pw / 2, y: (y0 + y1) / 2 - ph / 2, w: pw, h: ph });
        plate(e, rect, f.x0, f.x1, y0, y1, k, { px: (f.sq ? 24 : f.wide ? 30 : 28) * k });
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k, align: 'center' });
    },
};
