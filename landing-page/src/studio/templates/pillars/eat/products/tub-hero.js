/**
 * TUB HERO — the product alone on a stage lit in the brand's colour: a soft
 * accent glow behind it, a fine ring, the product standing in a pool of
 * light. Under it the flavour, set large, and three per-serving numbers in a
 * ruled row. The packshot post every protein and supplement brand needs.
 */
import { TYPE } from '../../../../fonts';
import { ring } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, productRect, backdrop, eyebrow, head, headHeight, stats, statsHeight, para, paraLines, lift, alpha, SOFT, GREY } from './_parts';

// The lit stage: glow and ring centred on where the product lands, then it.
function stage(e, box, U, opts, limit = Infinity) {
    const p = productRect(e, box, opts);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h * 0.5;
    // The ring clears the words under the stage.
    const r = Math.min(Math.max(p.w, p.h) * 0.62 + 40 * U, limit - cy);
    glow(e, cx, cy, r * 1.35, { strength: 0.95 });
    ring(e.ctx, cx, cy, r, alpha(lift(e.accent), 0.3), Math.max(1, 1.4 * U));
    return slot(e, box, opts);
}

/**
 * The words, bottom-up from `bottom` in a column (x, w): note, stats, the
 * flavour, the product name over it. Returns the top of the column.
 */
function words(e, x, w, bottom, U, { align = 'center', flavourH = 120, statPx = 58, noteLines = 2 } = {}) {
    const f = e.fields;
    const ax = align === 'center' ? x + w / 2 : x;
    const nPx = 21 * U;
    let y = bottom;
    const nl = paraLines(e, f.note, TYPE.brandL, nPx, w, noteLines);
    if (nl) {
        para(e, 'note', f.note, TYPE.brandL, nPx, ax, y - (nl - 1) * nPx * 1.32, w, noteLines, { align, color: GREY });
        y -= (nl - 1) * nPx * 1.32 + nPx + 44 * U;
    }
    const sh = statsHeight(e, f.stats, U, { numPx: statPx, w });
    if (sh) {
        const sw = align === 'center' ? w : Math.min(w, 620 * U);
        stats(e, 'stats', f.stats, x + (align === 'center' ? (w - sw) / 2 : 0), y - sh, sw, U, { numPx: statPx, align: align === 'center' ? 'center' : 'left' });
        y -= sh + 46 * U;
    }
    const fh = headHeight(e, f.flavour, { maxW: w, maxH: flavourH * U, lines: 2 });
    if (fh) {
        head(e, 'flavour', f.flavour, ax, y - fh, { maxW: w, maxH: flavourH * U, align, lines: 2 });
        y -= fh + 26 * U;
    }
    const nb = eyebrow(e, 'name', f.name, 20 * U, ax, y, { maxW: w, align, color: lift(e.accent) });
    if (nb) y -= 20 * U;
    return y;
}

function strip(e) {
    const { W, H, safe, tu: U } = e;
    const f = e.fields;
    ground(e);
    const pw = H * 0.78;
    const pbox = { x: safe.l + 10 * U, y: safe.t + 6 * U, w: pw, h: H - safe.t - safe.b - 6 * U };
    backdrop(e);
    stage(e, pbox, U, { kind: e.look.kind ?? 'tub', sub: String(f.flavour ?? '').replace(/\s*\n\s*/g, ' ') });
    const x = pbox.x + pbox.w + 50 * U;
    const statsW = (W - safe.r - x) * 0.46;
    const colW = W - safe.r - x - statsW - 50 * U;
    const lk = lockup(e, x, safe.t, 26 * U, { maxW: colW });
    eyebrow(e, 'name', f.name, 18 * U, x, lk.y + lk.h + 58 * U, { maxW: colW, color: lift(e.accent) });
    head(e, 'flavour', f.flavour, x, lk.y + lk.h + 84 * U, { maxW: colW, maxH: H - safe.b - (lk.y + lk.h + 84 * U) - 60 * U, lines: 2 });
    para(e, 'note', f.note, TYPE.brandL, 17 * U, x, H - safe.b, colW, 1, { color: GREY });
    const sx = W - safe.r - statsW;
    const sh = statsHeight(e, f.stats, U, { numPx: 64, w: statsW });
    stats(e, 'stats', f.stats, sx, (H - sh) / 2, statsW, U, { numPx: 64 });
    eyebrow(e, 'kicker', f.kicker, 16 * U, W - safe.r, safe.t + 16 * U, { align: 'right', maxW: statsW, color: SOFT });
}

export default {
    id: 'eat-tub-hero',
    name: 'Tub Hero',
    category: 'Eat',
    section: 'Products',
    blurb: 'The product alone on a stage lit in the brand’s colour, the flavour under it and three per-serving numbers. For protein, supplement and snack brands.',
    refs: 'a studio packshot on a coloured sweep',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'New · 1kg tub' },
        { key: 'name', label: 'Product name', value: 'Northside Whey' },
        { key: 'flavour', label: 'Flavour', rows: 2, value: 'Salted Caramel', hint: 'One or two lines.' },
        { key: 'stats', label: 'Per serving', rows: 3, value: '24g | Protein\n118 | kcal\n33 | Servings', hint: 'Up to three, one per line: number | label. Numbers from your pack.' },
        { key: 'note', label: 'Line', value: 'Per 30g scoop. Unlock it in the POWR app.', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein tub', fields: {}, look: { kind: 'tub' } },
        { name: 'Capsules', fields: { kicker: '60 capsules', name: 'Northside Daily', flavour: 'Magnesium\nGlycinate', stats: '2 | A day\n60 | Capsules\n30 | Days', note: 'Food supplement. Take with water.' }, look: { kind: 'jar' }, style: { accent: '#7FE0C2' } },
        { name: 'Snack pouch', fields: { kicker: 'Resealable · 250g', name: 'Northside Granola', flavour: 'Cacao &\nHazelnut', stats: '11g | Protein\n5.1g | Fibre\n8 | Bowls', note: 'Per 30g serving. Members first in the POWR app.' }, look: { kind: 'pouch' }, style: { accent: '#D9A066' } },
        { name: 'Electrolytes', fields: { kicker: '20 sticks', name: 'Northside Hydrate', flavour: 'Yuzu & Lime', stats: '500mg | Sodium\n12 | kcal\n20 | Sticks', note: 'One stick to 500 ml water.' }, look: { kind: 'box' }, style: { accent: '#C6E86B' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['jar', 'Jar'], ['pouch', 'Pouch'], ['box', 'Box'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), name: r.brand, kicker: r.cost ? `Or ${rewardWords(r).points}` : 'New' }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        if (shape === 'strip') return strip(e);
        const U = unitOf(e);
        const f = e.fields;
        const kind = e.look.kind ?? 'tub';
        const sub = String(f.flavour ?? '').replace(/\s*\n\s*/g, ' ');
        ground(e);
        backdrop(e);
        if (shape === 'wide') {
            const split = W * 0.5;
            const pbox = { x: split, y: safe.t + 40 * U, w: W - safe.r - split, h: H - safe.t - safe.b - 60 * U };
            stage(e, pbox, U, { kind, sub });
            const x = safe.l;
            const w = split - x - 60 * U;
            lockup(e, x, safe.t, 40 * U, { maxW: w });
            eyebrow(e, 'kicker', f.kicker, 20 * U, W - safe.r, safe.t + 20 * U, { align: 'right', color: SOFT, maxW: W - safe.r - split });
            words(e, x, w, H - safe.b, U, { align: 'left', flavourH: 190, statPx: 64 });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: SOFT, maxW: w * 0.36 });
        if (sq) {
            // Square: the product left, the words right.
            const pbox = { x, y: lk.y + lk.h + 60 * U, w: w * 0.5, h: H - safe.b - (lk.y + lk.h + 60 * U) };
            stage(e, pbox, U, { kind, sub });
            const cx = x + w * 0.56;
            words(e, cx, x + w - cx, H - safe.b, U, { align: 'left', flavourH: 150, statPx: 46, noteLines: 3 });
            return;
        }
        const top = words(e, x, w, H - safe.b, U, { flavourH: tall ? 150 : 124, statPx: tall ? 64 : 58 });
        const room = { y: lk.y + lk.h + (tall ? 80 : 50) * U, bottom: top - (tall ? 90 : 50) * U };
        const ph = Math.min(room.bottom - room.y, H * (tall ? 0.36 : 0.4));
        const pbox = { x: x + w * 0.22, y: room.bottom - ph - (tall ? 40 : 10) * U, w: w * 0.56, h: ph };
        stage(e, pbox, U, { kind, sub }, top - 36 * U);
    },
};
