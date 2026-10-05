/**
 * TASTING NOTES — a flavour described the way a roaster describes a coffee:
 * the name in a serif, a line of notes in italic, then three to five scales
 * (sweet · salty · rich · smooth) as rows of five dots, the product beside.
 * Taste, not claims. For protein, snack, coffee and drinks brands.
 */
import { TYPE } from '../../../../fonts';
import { rule, dot, ring } from '../../../../shapes';
import { drawText, capHeight } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, backdrop, eyebrow, head, headHeight, para, paraLines, rows, num, lift, alpha, SOFT, GREY, HAIR, INK, fitPx } from './_parts';

/** The scales: label left, five dots right. Returns the height drawn. */
function scales(e, x, top, w, U, { px = 18, r = 9, pitch = 3.2 } = {}) {
    const { ctx } = e;
    const data = rows(e.fields.notes, 5).filter((d) => d[0]);
    if (!data.length) return 0;
    const lp = px * U;
    const rr = r * U;
    const rowH = lp * pitch;
    const acc = lift(e.accent);
    const dotsW = rr * 2 * 5 + rr * 1.6 * 4;
    let box = null;
    rule(ctx, x, top, x + w, top, HAIR, Math.max(1, 1.2 * U));
    data.forEach((d, i) => {
        const cy = top + rowH * (i + 0.5);
        const lab = e.caps(d[0]);
        const b = drawText(ctx, lab, TYPE.mono, fitPx(ctx, lab, TYPE.mono, lp, w - dotsW - 20 * U, 0.16), x, cy + capHeight(ctx, TYPE.mono, lp) / 2, { tracking: 0.16, color: SOFT });
        if (b) box = box ? { x: box.x, y: box.y, w: Math.max(box.w, b.x + b.w - box.x), h: b.y + b.h - box.y } : b;
        const v = Math.max(0, Math.min(5, Math.round(num(d[1]))));
        for (let k = 0; k < 5; k++) {
            const dx = x + w - dotsW + rr + k * rr * 3.6;
            if (k < v) dot(ctx, dx, cy, rr, acc);
            else ring(ctx, dx, cy, rr - 0.6 * U, alpha(INK, 0.32), Math.max(1, 1.2 * U));
        }
        rule(ctx, x, top + rowH * (i + 1), x + w, top + rowH * (i + 1), HAIR, Math.max(1, 1.2 * U));
    });
    e.mark('notes', { x, y: top, w, h: rowH * data.length });
    return rowH * data.length;
}
const scalesH = (e, U, px = 18, pitch = 3.2) => rows(e.fields.notes, 5).filter((d) => d[0]).length * px * U * pitch;

/**
 * The words in a column, top-down: name eyebrow, the flavour in the serif,
 * the notes line, the scales. Bottom-aligned at `bottom`.
 */
function card(e, x, w, top, bottom, U, { flavourH = 220, notePx = 32, px = 18 } = {}) {
    const f = e.fields;
    const sh = scalesH(e, U, px);
    const dl = paraLines(e, f.descriptor, TYPE.serifI, notePx * U, w, 3);
    const dh = dl ? (dl - 1) * notePx * U * 1.2 + notePx * U : 0;
    const room = bottom - top - sh - (dl ? dh + 60 * U : 0) - 60 * U - 50 * U;
    const fh = headHeight(e, f.flavour, { maxW: w, maxH: Math.min(flavourH * U, room), lines: 3, gap: 0.08 });
    let y = bottom - sh - (dl ? dh + 56 * U : 0) - fh - 50 * U;
    y = Math.max(top + 36 * U, y);
    eyebrow(e, 'name', f.name, 19 * U, x, y - 30 * U, { maxW: w, color: lift(e.accent) });
    const t = head(e, 'flavour', f.flavour, x, y, { maxW: w, maxH: Math.min(flavourH * U, room), lines: 3, gap: 0.08 });
    y = t.bottom + 50 * U;
    if (dl) {
        para(e, 'descriptor', f.descriptor, TYPE.serifI, notePx * U, x, y + notePx * U * 0.8, w, 3, { color: SOFT, leading: 1.2 });
        y += dh + 56 * U;
    }
    scales(e, x, bottom - sh, w, U, { px });
}

function strip(e) {
    const { W, H, safe, tu: U } = e;
    const f = e.fields;
    ground(e);
    backdrop(e);
    const pw = H * 0.62;
    const px0 = W - safe.r - pw;
    glow(e, px0 + pw / 2, H * 0.6, pw * 0.75, { strength: 0.6 });
    slot(e, { x: px0, y: safe.t, w: pw, h: H - safe.t - safe.b }, { kind: e.look.kind ?? 'tub', sub: String(f.flavour ?? '').replace(/\s*\n\s*/g, ' ') });
    const x = safe.l;
    const colW = (px0 - x) * 0.46;
    lockup(e, x, safe.t, 26 * U, { maxW: colW });
    eyebrow(e, 'name', f.name, 16 * U, x, safe.t + 96 * U, { maxW: colW, color: lift(e.accent) });
    const t = head(e, 'flavour', f.flavour, x, safe.t + 122 * U, { maxW: colW, maxH: 150 * U, lines: 2, gap: 0.08 });
    para(e, 'descriptor', f.descriptor, TYPE.serifI, 22 * U, x, Math.max(t.bottom + 44 * U, H - safe.b - 22 * U * 1.2), colW, 2, { color: SOFT, leading: 1.2 });
    const sx = x + colW + 60 * U;
    const sw = px0 - 50 * U - sx;
    const sh = scalesH(e, U, 16, 2.9);
    eyebrow(e, 'kicker', f.kicker, 15 * U, sx, (H - sh) / 2 - 18 * U, { maxW: sw, color: GREY });
    scales(e, sx, (H - sh) / 2, sw, U, { px: 16, r: 8, pitch: 2.9 });
}

export default {
    id: 'eat-tasting-notes',
    name: 'Tasting Notes',
    category: 'Eat',
    section: 'Products',
    blurb: 'A flavour described like a coffee: the name in a serif, a line of notes, five-dot scales for sweet, salty, rich and smooth, the product beside.',
    refs: 'a speciality coffee bag’s tasting card',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Tasting notes' },
        { key: 'name', label: 'Product name', value: 'Northside Whey' },
        { key: 'flavour', label: 'Flavour', rows: 3, value: 'Salted\nCaramel', hint: 'Set in the headline font (a serif by default).' },
        { key: 'descriptor', label: 'Notes', rows: 2, value: 'Brown butter, toffee and a pinch of sea salt.', hint: 'What it tastes of. Leave empty to hide it.' },
        { key: 'notes', label: 'Scales', rows: 5, value: 'Sweet | 4\nSalty | 2\nRich | 4\nSmooth | 5', hint: 'Three to five, one per line: name | 0 to 5.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein', fields: {}, look: { kind: 'tub' } },
        { name: 'Cold brew', fields: { kicker: 'Cupping notes', name: 'Northside Cold Brew', flavour: 'Colombia\nHuila', descriptor: 'Dark chocolate, red apple, a long cocoa finish.', notes: 'Sweet | 3\nBitter | 2\nBody | 4\nAcidity | 3' }, look: { kind: 'bottle' }, style: { accent: '#D9A066' } },
        { name: 'Bar', fields: { kicker: 'How it eats', name: 'Northside Bar', flavour: 'Peanut\nCrunch', descriptor: 'Roasted peanut, a salted crunch, milk chocolate coat.', notes: 'Sweet | 3\nSalty | 3\nCrunch | 5\nChew | 2' }, look: { kind: 'pouch' }, style: { accent: '#C98A4B' } },
        { name: 'Matcha', fields: { kicker: 'Tasting notes', name: 'Northside Matcha', flavour: 'Ceremonial\nGrade', descriptor: 'Fresh grass, sweet umami, a clean finish.', notes: 'Grassy | 4\nUmami | 4\nSweet | 2\nBitter | 1' }, look: { kind: 'jar' }, style: { accent: '#7FE0C2' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['jar', 'Jar'], ['pouch', 'Pouch'], ['bottle', 'Bottle'], ['box', 'Box']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), name: r.brand }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        if (shape === 'strip') return strip(e);
        const U = unitOf(e);
        const f = e.fields;
        const kind = e.look.kind ?? 'tub';
        const sub = String(f.flavour ?? '').replace(/\s*\n\s*/g, ' ');
        ground(e);
        backdrop(e);
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        if (shape === 'tall') {
            const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
            eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: SOFT, maxW: w * 0.36 });
            const ph = H * 0.3;
            const pbox = { x: x + w * 0.22, y: lk.y + lk.h + 50 * U, w: w * 0.56, h: ph };
            glow(e, W / 2, pbox.y + ph * 0.6, ph * 0.75, { strength: 0.6 });
            slot(e, pbox, { kind, sub });
            card(e, x, w, pbox.y + ph + 40 * U, H - safe.b, U, { flavourH: 220, px: 20 });
            return;
        }
        if (shape === 'post') {
            // Post: the product lit above, the card in two columns below.
            const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
            eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: SOFT, maxW: w * 0.36 });
            const colW = w * 0.52;
            const sx = x + colW + 50 * U;
            const sw = x + w - sx;
            const sh = scalesH(e, U, 19, 3);
            const bottom = H - safe.b;
            const dl = paraLines(e, f.descriptor, TYPE.serifI, 30 * U, colW, 3);
            const dh = dl ? (dl - 1) * 30 * U * 1.2 + 30 * U + 40 * U : 0;
            const fMax = 200 * U;
            const fh = headHeight(e, f.flavour, { maxW: colW, maxH: fMax, lines: 3, gap: 0.08 });
            const cardTop = bottom - Math.max(fh + dh, sh);
            const pbox = { x: x + w * 0.22, y: lk.y + lk.h + 40 * U, w: w * 0.56, h: cardTop - 80 * U - (lk.y + lk.h + 40 * U) };
            glow(e, W / 2, pbox.y + pbox.h * 0.6, Math.min(pbox.h * 0.62, w * 0.4), { strength: 0.6 });
            slot(e, pbox, { kind, sub });
            eyebrow(e, 'name', f.name, 19 * U, x, cardTop - 30 * U, { maxW: colW, color: lift(e.accent) });
            const t = head(e, 'flavour', f.flavour, x, cardTop, { maxW: colW, maxH: fMax, lines: 3, gap: 0.08 });
            if (dl) para(e, 'descriptor', f.descriptor, TYPE.serifI, 30 * U, x, t.bottom + 40 * U + 30 * U * 0.8, colW, 3, { color: SOFT, leading: 1.2 });
            scales(e, sx, bottom - sh, sw, U, { px: 19, r: 9, pitch: 3 });
            return;
        }
        const wide = shape === 'wide';
        const sq = shape === 'square';
        const split = wide ? 0.5 : sq ? 0.54 : 0.56;
        const colW = w * split - 40 * U;
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: colW });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: SOFT, maxW: w * 0.36 });
        card(e, x, colW, lk.y + lk.h, H - safe.b, U, { flavourH: wide ? 260 : sq ? 170 : 320, notePx: sq ? 28 : 34, px: sq ? 16 : 20 });
        const pbox = { x: x + w * split, y: lk.y + lk.h + (sq ? 60 : 110) * U, w: w * (1 - split), h: H - safe.b - (lk.y + lk.h + (sq ? 60 : 110) * U) };
        glow(e, pbox.x + pbox.w / 2, pbox.y + pbox.h * 0.62, pbox.w * 0.62, { strength: 0.6 });
        slot(e, pbox, { kind, sub, frame: 0.72 });
    },
};
