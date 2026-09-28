/**
 * THREE THINGS — a gratitude / reflection list: the photo as a tall panel
 * down the left edge, and beside it on the dark a date in mono, "Three good
 * things" in serif italic, then 1 · 2 · 3 with serif numerals in the accent,
 * hairlines between and a lot of air. For journaling brands, wellness apps
 * and a member's end-of-week post.
 */
import { TYPE } from '../../../fonts';
import { capHeight, drawText, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, DIM, GROUND, balanced, unitOf, ground, prep, footRow, headColor, label, rewardLine } from './_parts';

const KEYS = ['one', 'two', 'three'];

// One row, a hairline above: the numeral left and the item beside it, or
// (stack) the numeral over the item.
function row(e, i, x0, x1, y, h, k, { numPx, itemPx, maxLines, stack = false }) {
    const { ctx } = e;
    rule(ctx, x0, y, x1, y, 'rgba(244,241,234,0.16)', Math.max(1, 1.2 * k));
    const nCap = capHeight(ctx, TYPE.serif, numPx);
    const top = y + Math.min(h * 0.3, (stack ? 30 : 40) * k);
    const numW = textWidth(ctx, '3', TYPE.serif, numPx);
    drawText(ctx, String(i + 1), TYPE.serif, numPx, x0, top + nCap, { color: e.accent });
    const tx = stack ? x0 : x0 + numW + 44 * k;
    const lines = balanced(ctx, e.fields[KEYS[i]], TYPE.brandL, itemPx, x1 - tx, maxLines);
    if (!lines.length) return;
    const iCap = capHeight(ctx, TYPE.brandL, itemPx);
    // Beside: the item's first cap-top level with the numeral's.
    const first = stack ? top + nCap + 26 * k + iCap : top + iCap + (nCap - iCap) * 0.12;
    e.mark(KEYS[i], drawText(ctx, lines.join('\n'), TYPE.brandL, itemPx, tx, first, { color: e.ink, leading: 1.28 }));
}

function strip(e) {
    const { W, H, safe } = e;
    const k = unitOf(e);
    const size = e.look.size ?? 1;
    ground(e, GROUND);
    const pw = W * 0.24;
    e.photo({ x: 0, y: 0, w: pw, h: H });
    const x0 = pw + 56 * k;
    const x1 = W - safe.r;
    const colA = W * 0.2;
    const footTop = footRow(e, { x0, x1: x0 + colA, bottom: H - safe.b, k, lockH: 22, footKey: 'none' });
    label(e, 'date', e.fields.date, x0, safe.t + capHeight(e.ctx, TYPE.mono, 16 * k), { px: 16 * k, maxW: colA, color: DIM, spec: TYPE.mono, tracking: 0.2 });
    const tb = prep(e, e.fields.title, e.headline, { maxW: colA * size, maxH: (footTop - safe.t - 80 * k) * size, max: 64 * k, lines: 3, gap: 0.26 });
    tb.draw('title', x0, safe.t + 44 * k, { color: headColor(e) });
    const lx = x0 + colA + 40 * k;
    const cw = (x1 - lx) / 3;
    KEYS.forEach((_, i) => row(e, i, lx + i * cw, lx + (i + 1) * cw - 36 * k, safe.t + (H - safe.t - safe.b) * 0.16, H - safe.t - safe.b, k, { numPx: 60 * k, itemPx: 28 * k, maxLines: 3, stack: true }));
}

export default {
    id: 'three-things',
    name: 'Three Things',
    category: 'Mind',
    blurb: 'A gratitude list: "Three good things", then 1 · 2 · 3 with serif numerals in the accent and a lot of air, beside a tall photo.',
    refs: 'a five-minute journal page',
    headlineFont: 'serifI',
    fields: [
        { key: 'date', label: 'Date', value: 'Sunday' },
        { key: 'title', label: 'Title', rows: 2, value: 'Three good\nthings', hint: '{Braces} colour a word.' },
        { key: 'one', label: '1', value: 'Coffee on the back step' },
        { key: 'two', label: '2', value: 'A long call with an old friend' },
        { key: 'three', label: '3', value: 'Walking home the slow way' },
        { key: 'footer', label: 'Small print', value: 'What were yours?' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Good things', fields: { date: 'Sunday', title: 'Three good\nthings', one: 'Coffee on the back step', two: 'A long call with an old friend', three: 'Walking home the slow way', footer: 'What were yours?' } },
        { name: 'Week in review', fields: { date: 'Week 39', title: 'Three things\nthis week', one: 'Four sessions, none missed', two: 'Slept with the window open', three: 'Said no to one thing', footer: 'Every session counts' } },
        { name: 'Studio', fields: { date: 'This month at Northside', title: 'Three things\nwe noticed', one: 'The 7am class kept growing', two: 'More of you stayed for savasana', three: 'Someone brought their mum', footer: 'Northside Yoga' } },
        { name: 'Tomorrow', fields: { date: 'Tonight', title: 'Three things\nfor tomorrow', one: 'Water before coffee', two: 'Ten minutes outside', three: 'One message I’ve been putting off', footer: 'Write yours down' } },
    ],
    look: { ...MIND_LOOK, mono: 0.55, tintAmount: 0.55, target: 0.26, fade: 0.12 },
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const wide = shape === 'wide';
        ground(e, GROUND);
        const pw = W * (wide ? 0.38 : tall ? 0.34 : sq ? 0.34 : 0.36);
        e.photo({ x: 0, y: 0, w: pw, h: H });
        e.fade(pw * 0.6, 0, pw * 0.4, H, 'right', 0.3);

        const x0 = pw + (wide ? 90 : sq ? 56 : 64) * k;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k });

        const dPx = 17 * k;
        const dCap = capHeight(e.ctx, TYPE.mono, dPx);
        const top = safe.t + (tall ? 30 : 10) * k;
        label(e, 'date', e.fields.date, x0, top + dCap, { px: dPx, maxW: x1 - x0, color: DIM, spec: TYPE.mono, tracking: 0.2 });
        const tTop = top + dCap + (sq ? 30 : 40) * k;
        const tb = prep(e, e.fields.title, e.headline, { maxW: (x1 - x0) * size, maxH: H * (sq || wide ? 0.2 : 0.16) * size, max: (sq ? 76 : 92) * k * size, lines: 2, gap: 0.24 });
        tb.draw('title', x0, tTop, { color: headColor(e) });

        const listTop = tTop + tb.h + tb.desc + (sq || wide ? 50 : 80) * k;
        const listBottom = footTop - (sq || wide ? 40 : 70) * k;
        const rowH = (listBottom - listTop) / 3;
        const numPx = Math.min(rowH * 0.7, (sq || wide ? 84 : 110) * k);
        const itemPx = Math.min((sq ? 36 : 44) * k, rowH * 0.22);
        KEYS.forEach((_, i) => row(e, i, x0, x1, listTop + i * rowH, rowH, k, { numPx, itemPx, maxLines: rowH > 170 * k ? 3 : 2 }));
    },
};
