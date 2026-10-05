/**
 * INSIDE — a journal or book opened up in words: the product, then three
 * numbers set ultra-light (192 pages · 120 gsm · 84 prompts) between thin
 * uprights, and an "Inside:" list in serif italic with what the pages hold.
 * For journals, planners, books and card decks.
 */
import { TYPE } from '../../../../fonts';
import { capHeight, textWidth } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, DIM, HAIR, GROUND, frame, ground, veil, footRow, footH, headColor, glow, framedShot, fitPx,
    lineItem, blockItem, priceItem, stack, stackH, pairs, items, productFill,
} from './_parts';

// "120 gsm" → ['120', 'gsm']; "A5" → ['A5', ''].
const split = (v) => {
    const m = String(v).trim().match(/^([\d.,/×x]+)\s*(.*)$/);
    return m ? [m[1], m[2]] : [String(v).trim(), ''];
};

// Three (or so) numbers across, uprights between. Returns its height.
function stats(e, x0, x1, y, k, { numPx = 84 * k, measure = false } = {}) {
    const { ctx } = e;
    const rows = pairs(e.fields.stats, 4).map(([a, b]) => (a ? [a, b] : [b, '']));
    if (!rows.length) return 0;
    const cw = (x1 - x0) / rows.length;
    const pad = 28 * k;
    // One number size for all, fitted to the narrowest need.
    let px = numPx;
    rows.forEach(([v]) => {
        const [n, unit] = split(v);
        const need = textWidth(ctx, n, TYPE.brandXL, px, -0.02) + (unit ? 10 * k + textWidth(ctx, unit, TYPE.brandL, px * 0.34) : 0);
        if (need > cw - pad * 2) px *= (cw - pad * 2) / need;
    });
    const cap = capHeight(ctx, TYPE.brandXL, px);
    const lPx = Math.min(14 * k, px * 0.3);
    const lCap = capHeight(ctx, TYPE.monoR, lPx);
    const h = cap + 22 * k + lCap;
    if (measure) return h;
    rows.forEach(([v, l], i) => {
        const x = x0 + i * cw + (i ? pad : 0);
        if (i) rule(ctx, x0 + i * cw, y, x0 + i * cw, y + h, HAIR, Math.max(1, 1.1 * k));
        const [n, unit] = split(v);
        const nb = lineItem(e, null, n, x, { px, spec: TYPE.brandXL, color: e.ink, tracking: -0.02, upper: false }).draw(y);
        if (unit && nb) lineItem(e, null, unit, nb.x + nb.w + 10 * k, { px: px * 0.34, spec: TYPE.brandL, color: e.ink, tracking: 0, upper: false }).draw(y + cap - capHeight(ctx, TYPE.brandL, px * 0.34));
        lineItem(e, null, l, x, { px: lPx, spec: TYPE.monoR, maxW: cw - pad * 2, color: DIM, tracking: 0.2 })?.draw(y + cap + 22 * k);
    });
    e.mark('stats', { x: x0, y, w: x1 - x0, h });
    return h;
}

// "Inside:" then the items on hairlines, in `cols` columns.
function inside(e, x0, x1, y0, y1, cols, k, { px = 28 * k } = {}) {
    const { ctx } = e;
    const list = items(e.fields.inside, 6);
    const lab = String(e.fields.insideLabel ?? '').trim();
    let y = y0;
    if (lab) {
        const l = lineItem(e, 'insideLabel', lab, x0, { px: px * 1.3, spec: TYPE.serifI, color: e.ink, tracking: 0, upper: false });
        l.draw(y);
        y += l.h + 26 * k;
    }
    if (!list.length) return;
    const rows = Math.ceil(list.length / cols);
    const gap = 40 * k;
    const cw = (x1 - x0 - gap * (cols - 1)) / cols;
    const rh = Math.min((y1 - y) / rows, px * 2.6);
    let p = Math.min(px, rh * 0.42);
    const dash = 26 * k;
    p = Math.max(p * 0.8, Math.min(p, ...list.map((t) => fitPx(ctx, t, TYPE.brandL, p, cw - dash - 16 * k))));
    const cap = capHeight(ctx, TYPE.brandL, p);
    list.forEach((t, i) => {
        const c = Math.floor(i / rows);
        const r = i % rows;
        const x = x0 + c * (cw + gap);
        const ry = y + r * rh;
        rule(ctx, x, ry, x + cw, ry, HAIR, Math.max(1, 1.1 * k));
        const base = ry + rh / 2 + cap / 2;
        ctx.fillStyle = e.accent;
        ctx.fillRect(x, base - cap * 0.42, dash * 0.6, Math.max(1.5, 2.2 * k));
        lineItem(e, null, t, x + dash, { px: p, spec: TYPE.brandL, maxW: cw - dash - 16 * k, color: e.ink, tracking: 0, upper: false, min: 1 }).draw(base - cap);
    });
    e.mark('inside', { x: x0, y, w: x1 - x0, h: rows * rh });
}

function head(e, x, w, k, { namePx, maxH }) {
    const size = e.look.size ?? 1;
    return [
        lineItem(e, 'kicker', e.fields.kicker, x, { px: 16 * k, spec: TYPE.monoR, maxW: w, tracking: 0.22 }),
        blockItem(e, 'name', e.fields.name, x, e.headline, { maxW: w * size, maxH: maxH * size, max: namePx * k * size, lines: 2, gap: 0.2 }, { color: headColor(e), before: 22 * k }),
        priceItem(e, x, { px: 30 * k, maxW: w, before: 28 * k }),
    ];
}

function product(e, box) {
    if (framedShot(e)) {
        productShot(e, box, { stage: false, radius: 8 });
        return;
    }
    glow(e, box.x + box.w / 2, box.y + box.h * 0.6, box.w * 0.5, box.h * 0.55, 0.16);
    productShot(e, box, { kind: 'box', sub: e.fields.kicker });
}

export default {
    id: 'mind-inside',
    name: 'Inside',
    category: 'Mind',
    section: 'Products',
    blurb: 'A journal or book opened up in words: the product, three numbers set ultra-light (pages, paper, prompts), and an "Inside:" list of what the pages hold.',
    refs: 'a stationery catalogue spec',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'What it is', value: 'Journal · A5 · Lay-flat' },
        { key: 'name', label: 'Name', rows: 2, value: 'The Evening\nJournal', hint: '{Braces} colour a word.' },
        { key: 'stats', label: 'Numbers', rows: 3, value: '192 | pages\n120 gsm | paper\n84 | prompts', hint: 'One per line: number | label. Up to four.' },
        { key: 'insideLabel', label: 'List title', value: 'Inside:' },
        { key: 'inside', label: 'What’s inside', rows: 4, value: 'Dated pages for twelve weeks\nA prompt for every evening\nRibbon marker, back pocket\nThread-sewn, opens flat', hint: 'One per line, up to six. Features, not promises.' },
        { key: 'price', label: 'Price', value: '£28' },
        { key: 'points', label: 'Points', value: 'or 2,800 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Northside Paper' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Journal', fields: { kicker: 'Journal · A5 · Lay-flat', name: 'The Evening\nJournal', stats: '192 | pages\n120 gsm | paper\n84 | prompts', insideLabel: 'Inside:', inside: 'Dated pages for twelve weeks\nA prompt for every evening\nRibbon marker, back pocket\nThread-sewn, opens flat', price: '£28', points: 'or 2,800 POWR points', footer: 'Northside Paper' } },
        { name: 'Planner', fields: { kicker: 'Planner · Undated · A5', name: 'Twelve\nWeeks', stats: '12 | weeks\n240 | pages\n100 gsm | paper', insideLabel: 'Inside:', inside: 'A week to a spread\nSunday reset pages\nHabit grid for each month\nTwo ribbons', price: '£24', points: 'Members first in the POWR app', footer: 'Northside Paper' } },
        { name: 'Card deck', fields: { kicker: 'Card deck · Boxed', name: 'Fifty-Two\nQuestions', stats: '52 | cards\n4 | suits\n350 gsm | card', insideLabel: 'In the box:', inside: 'A question on every card\nFour suits: morning, work, people, night\nA card to start with\nA linen pouch', price: '£19', points: 'or 1,900 POWR points', footer: 'Northside Games' } },
        { name: 'Book', fields: { kicker: 'Paperback · 224 pages', name: 'Slow\nMornings', stats: '224 | pages\n30 | short chapters\n12 | practices', insideLabel: 'Inside:', inside: 'One chapter for each morning of the month\nTwelve practices to try\nSpace to write after each\nNotes and further reading', price: '£14.99', points: '', footer: 'Northside Books' } },
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
            const pb = { x: f.x0, y: f.top, w: W * 0.17, h: f.bottom - f.top };
            product(e, pb);
            const hx = pb.x + pb.w + 50 * k;
            const hw = W * 0.24;
            const list = head(e, hx, hw, k, { namePx: 64, maxH: (f.bottom - f.top) * 0.36 });
            stack(list, f.top + Math.max(0, (f.bottom - 50 * k - f.top - stackH(list)) / 2));
            footRow(e, { x0: hx, x1: hx + hw, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            const sx = hx + hw + 60 * k;
            const sh = stats(e, sx, f.x1, 0, k, { numPx: 100 * k, measure: true });
            stats(e, sx, f.x1, (H - sh) / 2, k, { numPx: 100 * k });
            return;
        }

        const footTop = f.bottom - footH(e, k);
        if (f.wide || f.sq) {
            const pw = W * (f.wide ? 0.36 : 0.4);
            const x = f.x0 + pw + (f.wide ? 80 : 50) * k;
            const w = f.x1 - x;
            product(e, { x: f.x0, y: f.top + 30 * k, w: pw, h: footTop - 70 * k - f.top - 30 * k });
            const list = head(e, x, w, k, { namePx: f.wide ? 88 : 72, maxH: H * (f.wide ? 0.2 : 0.16) });
            const hb = stack(list, f.top + 10 * k);
            const sy = hb + (f.sq ? 44 : 60) * k;
            const sh = stats(e, x, f.x1, sy, k, { numPx: (f.wide ? 84 : 64) * k });
            inside(e, x, f.x1, sy + sh + (f.sq ? 40 : 60) * k, footTop - (f.sq ? 30 : 50) * k, f.wide ? 2 : 1, k, { px: (f.sq ? 22 : 26) * k });
            footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
            return;
        }

        // Post and story: head, product, numbers, list.
        const w = f.x1 - f.x0;
        const top = f.top + (f.tall ? 30 : 0) * k;
        const list = head(e, f.x0, w * 0.8, k, { namePx: f.tall ? 100 : 96, maxH: H * 0.11 });
        const hb = stack(list, top);
        const nList = Math.ceil(items(e.fields.inside, 6).length / 2);
        const listH = (String(e.fields.insideLabel ?? '').trim() ? 70 * k : 0) + nList * 80 * k;
        const listTop = footTop - (f.tall ? 60 : 50) * k - listH;
        const numPx = (f.tall ? 96 : 84) * k;
        const sh = stats(e, f.x0, f.x1, 0, k, { numPx, measure: true });
        const sy = listTop - 56 * k - sh;
        product(e, { x: f.x0 + w * 0.08, y: hb + 50 * k, w: w * 0.84, h: sy - 60 * k - hb - 50 * k });
        stats(e, f.x0, f.x1, sy, k, { numPx });
        inside(e, f.x0, f.x1, listTop, footTop - 40 * k, 2, k, { px: 30 * k });
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
    },
};
