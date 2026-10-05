/**
 * FLAVOUR RANGE — the whole range lined up on one floor: three to five of
 * the product side by side, the middle one largest, each with its flavour
 * and a dot of its colour under it, and one marked "New". A shop window for
 * protein, snack and drinks brands with more than one flavour.
 */
import { TYPE } from '../../../../fonts';
import { rule, dot } from '../../../../shapes';
import { wrapLines, drawText } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, slot, framed, productRect, backdrop, eyebrow, head, headHeight, para, paraLines, pill, rows, lift, mix, alpha, SOFT, GREY, HAIR, INK } from './_parts';

const COLOUR = /^#?[0-9a-f]{6}$|^#?[0-9a-f]{3}$/i;

// The flavours: name + colour (a hex after |, else a shade of the accent).
function range(e) {
    const list = rows(e.fields.flavours, 5).filter((r) => r[0]);
    // No flavours listed: the product alone, unnamed.
    if (!list.length) return [{ name: '', colour: e.accent, blank: true }];
    return list.map((r, i) => {
        const c = COLOUR.test(r[1] ?? '') ? (r[1].startsWith('#') ? r[1] : `#${r[1]}`) : mix(e.accent, i % 2 ? '#000000' : INK, 0.15 + 0.12 * i);
        return { name: r[0], colour: c };
    });
}

const isFresh = (e, name) => {
    const fresh = String(e.fields.fresh ?? '').trim().toLowerCase();
    return !!fresh && name.trim().toLowerCase() === fresh;
};

/**
 * The lineup across (x, w), standing on `floor`, products up to `maxH`
 * tall, names under the floor. Returns the lowest y it drew to.
 */
function lineup(e, x, w, floor0, maxH, U, { namePx = 22, top = null } = {}) {
    const { ctx } = e;
    const items = range(e);
    const n = items.length;
    if (!n) return floor0;
    const kind = e.look.kind ?? 'tub';
    const c = (n - 1) / 2;
    const s = items.map((_, i) => 1 - 0.14 * Math.abs(i - c));
    const sum = s.reduce((a, v) => a + v, 0);
    const gap = 14 * U;
    // A short product (a wide cut-out) leaves air above the range: centre the
    // group (products + names) in the room between `top` and the floor.
    let floor = floor0;
    if (top !== null) {
        let tallest = 0;
        let cx0 = x;
        items.forEach((_, i) => {
            const sw = (w * s[i]) / sum;
            const bw = framed(e) ? sw - gap : Math.min(sw * (n > 3 ? 1.5 : 1.2), w / 2);
            const r = productRect(e, { x: cx0 + sw / 2 - bw / 2, y: floor0 - maxH * s[i], w: bw, h: maxH * s[i] }, { kind, frame: 0.72 });
            tallest = Math.max(tallest, r.h);
            cx0 += sw;
        });
        const spare = floor0 - top - tallest;
        if (spare > 0) floor = floor0 - spare * 0.42;
    }
    // The floor: a hairline the range stands on.
    rule(ctx, x - 20 * U, floor + 1, x + w + 20 * U, floor + 1, HAIR, Math.max(1, 1.2 * U));
    const nPx = namePx * U;
    // Slots across; a cut-out or stand-in is wider than its slot so the range
    // overlaps, the sides behind the middle. Framed shots stay side by side.
    const card = framed(e);
    const slots = [];
    let cx = x;
    items.forEach((it, i) => {
        const sw = (w * s[i]) / sum;
        const bw = card ? sw - gap : Math.min(sw * (n > 3 ? 1.5 : 1.2), w / 2);
        slots.push({ it, i, sw, mid: cx + sw / 2, box: { x: cx + sw / 2 - bw / 2, y: floor - maxH * s[i], w: bw, h: maxH * s[i] } });
        cx += sw;
    });
    const rects = [];
    [...slots].sort((a, b) => s[a.i] - s[b.i]).forEach((sl) => {
        rects[sl.i] = slot(e, sl.box, { kind, sub: sl.it.name, frame: 0.72, stage: 0.7, radius: 12 }).rect;
    });
    let low = floor;
    slots.forEach(({ it, sw, mid, box }, i) => {
        if (isFresh(e, it.name)) {
            const pr = rects[i] ?? productRect(e, box, { kind });
            const px = Math.max(13 * U, Math.min(19 * U, sw * 0.09));
            pill(e, 'fresh', e.caps(e.fields.chip), mid, pr.y - px * 2 - 14 * U, px, { fill: e.accent, align: 'center', tracking: 0.14 });
        }
        if (it.blank) return;
        // The dot, then the name centred under it.
        const dy = floor + 30 * U;
        dot(ctx, mid, dy, 8 * U, it.colour);
        ctx.save();
        ctx.strokeStyle = alpha(INK, 0.35);
        ctx.lineWidth = Math.max(1, 1 * U);
        ctx.beginPath();
        ctx.arc(mid, dy, 8 * U, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const ls = wrapLines(ctx, it.name, TYPE.brandR, nPx, sw - 10 * U, 2);
        const b = drawText(ctx, ls.join('\n'), TYPE.brandR, nPx, mid, dy + 26 * U + nPx * 0.8, { align: 'center', color: isFresh(e, it.name) ? INK : SOFT, leading: 1.2 });
        if (b) { e.mark('flavours', b); low = Math.max(low, b.y + b.h); }
    });
    return low;
}

/** Height the names take under the floor. */
const namesH = (e, U, namePx = 22) => 30 * U + 26 * U + namePx * U * 2.2;

function strip(e) {
    const { W, H, safe, tu: U } = e;
    const f = e.fields;
    ground(e);
    backdrop(e);
    const x = safe.l;
    const colW = W * 0.28;
    lockup(e, x, safe.t, 26 * U, { maxW: colW });
    eyebrow(e, 'kicker', f.kicker, 16 * U, x, safe.t + 90 * U, { maxW: colW, color: lift(e.accent) });
    const t = head(e, 'title', f.title, x, safe.t + 116 * U, { maxW: colW, maxH: 150 * U, lines: 2 });
    para(e, 'line', f.line, TYPE.brandL, 17 * U, x, Math.max(t.bottom + 50 * U, H - safe.b - 20 * U), colW, 2, { color: GREY });
    const lx = x + colW + 70 * U;
    const floor = H - safe.b - namesH(e, U, 18) + 4 * U;
    lineup(e, lx, W - safe.r - lx, floor, floor - safe.t - 40 * U, U, { namePx: 18 });
}

export default {
    id: 'eat-flavour-range',
    name: 'Flavour Range',
    category: 'Eat',
    section: 'Products',
    blurb: 'The range lined up on one floor, each flavour named with a dot of its colour and one marked New. For brands with more than one flavour.',
    refs: 'a shop-window lineup',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'The range' },
        { key: 'title', label: 'Title', rows: 2, value: 'Five flavours.\nPick yours.' },
        {
            key: 'flavours', label: 'Flavours', rows: 5,
            value: 'Salted Caramel | #C98A4B\nDouble Chocolate | #6B4431\nVanilla Bean | #E8D9B0\nStrawberry | #E0556B\nIced Coffee | #9C7A5B',
            hint: 'Three to five, one per line: name | colour (a hex like #C98A4B). The middle one stands tallest.',
        },
        { key: 'fresh', label: 'Marked flavour', value: 'Iced Coffee', hint: 'Which flavour carries the chip. Leave empty for none.' },
        { key: 'chip', label: 'Chip', value: 'New' },
        { key: 'line', label: 'Line', value: 'All 1kg · £29.99 each. Members first in the POWR app.', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein range', fields: {}, look: { kind: 'tub' } },
        { name: 'Snack pouches', fields: { kicker: 'Granola', title: 'Three bakes.\nOne pantry.', flavours: 'Cacao & Hazelnut | #6B4431\nMaple Pecan | #C98A4B\nRaspberry & Coconut | #D2466B', fresh: 'Raspberry & Coconut', chip: 'Just landed', line: '400g pouches · £6.50 each.' }, look: { kind: 'pouch' }, style: { accent: '#D9A066' } },
        { name: 'Drinks', fields: { kicker: 'Electrolytes', title: 'Four flavours,\nzero fuss.', flavours: 'Yuzu & Lime | #C6E86B\nBlood Orange | #E2583E\nWatermelon | #E0556B\nBerry | #7A4FA0', fresh: 'Blood Orange', chip: 'Summer only', line: 'Boxes of 20 sticks · £18 each.' }, look: { kind: 'box' }, style: { accent: '#C6E86B' } },
        { name: 'Café shakes', fields: { kicker: 'On the counter', title: 'Shakes,\nmade to order.', flavours: 'Banana & Oat | #E8D9B0\nPeanut Butter | #B07A45\nCold Brew | #5A3E2B', fresh: '', line: '£4.80 each, or redeem with POWR points.' }, look: { kind: 'bottle' }, style: { accent: '#E0556B' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['pouch', 'Pouch'], ['box', 'Box'], ['jar', 'Jar'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.offer ? { line: r.offer } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        if (shape === 'strip') return strip(e);
        const U = unitOf(e);
        const f = e.fields;
        ground(e);
        backdrop(e);
        if (shape === 'wide') {
            const x = safe.l;
            const colW = W * 0.3;
            lockup(e, x, safe.t, 40 * U, { maxW: colW });
            const lh = paraLines(e, f.line, TYPE.brandL, 22 * U, colW, 3);
            const th = headHeight(e, f.title, { maxW: colW, maxH: 260 * U, lines: 3 });
            const bottom = H - safe.b - (lh ? (lh - 1) * 22 * U * 1.32 + 22 * U + 50 * U : 0);
            eyebrow(e, 'kicker', f.kicker, 20 * U, x, bottom - th - 40 * U, { maxW: colW, color: lift(e.accent) });
            head(e, 'title', f.title, x, bottom - th, { maxW: colW, maxH: 260 * U, lines: 3 });
            if (lh) para(e, 'line', f.line, TYPE.brandL, 22 * U, x, H - safe.b - (lh - 1) * 22 * U * 1.32, colW, 3, { color: GREY });
            const lx = x + colW + 90 * U;
            const floor = H - safe.b - namesH(e, U, 24);
            lineup(e, lx, W - safe.r - lx, floor, floor - safe.t - 110 * U, U, { namePx: 24 });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: lift(e.accent), maxW: w * 0.36 });
        const tTop = lk.y + lk.h + (tall ? 90 : 60) * U;
        const t = head(e, 'title', f.title, x, tTop, { maxW: w * (sq ? 0.8 : 0.9), maxH: (tall ? 250 : sq ? 150 : 190) * U, lines: 3 });
        const lh = paraLines(e, f.line, TYPE.brandL, 22 * U, w, 2);
        if (lh) para(e, 'line', f.line, TYPE.brandL, 22 * U, x, H - safe.b - (lh - 1) * 22 * U * 1.32, w, 2, { color: GREY });
        const bottom = H - safe.b - (lh ? (lh - 1) * 22 * U * 1.32 + 22 * U + (tall ? 70 : 44) * U : 0);
        const floor = bottom - namesH(e, U);
        const maxH = Math.min(floor - t.bottom - (tall ? 150 : 90) * U, H * (tall ? 0.34 : 0.4));
        lineup(e, x + 10 * U, w - 20 * U, floor - (tall ? 60 : 0) * U, maxH, U, { top: t.bottom + 80 * U });
    },
};
