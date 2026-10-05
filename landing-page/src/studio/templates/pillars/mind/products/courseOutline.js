/**
 * COURSE OUTLINE — a course set like a syllabus: "8-week course" in mono,
 * the course's name in serif, when it starts and how it runs, then the
 * weeks in a numbered list on hairlines. Beside it the course book (the
 * product shot) or a photo from the studio. For meditation and breathwork
 * courses, journaling classes and studio programmes.
 */
import { TYPE } from '../../../../fonts';
import { capHeight } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, DIM, HAIR, GROUND, frame, ground, footRow, footH, headColor, glow, framedShot, fitPx,
    lineItem, blockItem, priceItem, stack, stackH, items, productFill,
} from './_parts';

// What goes beside the words: the product, the photo, or the stand-in.
function besideOf(e) {
    const want = e.look.beside ?? 'auto';
    if (want === 'photo') return e.hasMedia ? 'photo' : 'product';
    if (want === 'product') return 'product';
    // A photo is chosen per post (the product shot is shared across templates), so it wins.
    return e.hasMedia ? 'photo' : 'product';
}

function visual(e, box, k, mode) {
    const { ctx } = e;
    if (mode === 'photo') {
        e.photo(box);
        ctx.save();
        ctx.strokeStyle = HAIR;
        ctx.lineWidth = Math.max(1, 1.2 * k);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
        return;
    }
    if (framedShot(e)) {
        productShot(e, box, { stage: false, radius: 6 });
        return;
    }
    glow(e, box.x + box.w / 2, box.y + box.h * 0.55, box.w * 0.6, box.h * 0.55, 0.16);
    productShot(e, { x: box.x + box.w * 0.08, y: box.y, w: box.w * 0.84, h: box.h }, { kind: 'box', sub: e.fields.kicker });
}

// "(starts)" over the date, "(format)" over how it runs — two columns.
function details(e, x, w, k, { before = 0, px = 24 * k } = {}) {
    const { ctx } = e;
    const cols = [['start', '(starts)'], ['format', '(format)']].filter(([key]) => String(e.fields[key] ?? '').trim());
    if (!cols.length) return null;
    const tag = capHeight(ctx, TYPE.monoR, 14 * k);
    const cap = capHeight(ctx, TYPE.brandR, px);
    const cw = w / cols.length;
    return {
        h: tag + 18 * k + cap, before,
        draw: (y) => cols.forEach(([key, t], i) => {
            const cx = x + i * cw;
            lineItem(e, null, t, cx, { px: 14 * k, spec: TYPE.monoR, color: DIM, tracking: 0.04, upper: false }).draw(y);
            lineItem(e, key, e.fields[key], cx, { px, spec: TYPE.brandR, maxW: cw - 30 * k, color: e.ink, tracking: 0, upper: false, min: 0.8 })?.draw(y + tag + 18 * k);
        }),
    };
}

// The weeks: "01  Arriving" on hairlines, in `cols` columns, filled down.
function weeks(e, x0, x1, y0, y1, cols, k, { px = 30 * k } = {}) {
    const { ctx } = e;
    const list = items(e.fields.weeks, 12);
    if (!list.length) return;
    const rows = Math.ceil(list.length / cols);
    const gap = 44 * k;
    const cw = (x1 - x0 - gap * (cols - 1)) / cols;
    const rh = Math.min((y1 - y0) / rows, px * 3.4);
    let p = Math.min(px, rh * 0.4);
    const nPx = Math.min(15 * k, p * 0.6);
    const numW = 56 * k * (p / (30 * k)) + 10 * k;
    // One size for every week: the longest name sets it.
    p = Math.max(p * 0.78, Math.min(p, ...list.map((n) => fitPx(ctx, n, TYPE.brandL, p, cw - numW))));
    list.forEach((name, i) => {
        const c = Math.floor(i / rows);
        const r = i % rows;
        const x = x0 + c * (cw + gap);
        const y = y0 + r * rh;
        rule(ctx, x, y, x + cw, y, HAIR, Math.max(1, 1.1 * k));
        if (i === 0) {
            ctx.fillStyle = e.accent;
            ctx.fillRect(x, y - 1 * k, 36 * k, 2.4 * k);
        }
        const base = y + rh / 2 + capHeight(ctx, TYPE.brandL, p) / 2;
        lineItem(e, null, String(i + 1).padStart(2, '0'), x, { px: nPx, spec: TYPE.mono, color: DIM, tracking: 0.1 })
            .draw(base - capHeight(ctx, TYPE.mono, nPx));
        lineItem(e, null, name, x + numW, { px: p, spec: TYPE.brandL, maxW: cw - numW, color: e.ink, tracking: 0, upper: false, min: 1 })?.draw(base - capHeight(ctx, TYPE.brandL, p));
    });
    rule(ctx, x0, y0 + rows * rh, x0 + cols * cw + (cols - 1) * gap, y0 + rows * rh, HAIR, Math.max(1, 1.1 * k));
    e.mark('weeks', { x: x0, y: y0, w: x1 - x0, h: rows * rh });
}
const weekRows = (e, cols) => Math.ceil(items(e.fields.weeks, 12).length / cols);

function head(e, x, w, k, { namePx, maxH, detailsPx = 24 * k, price = true }) {
    const size = e.look.size ?? 1;
    return [
        lineItem(e, 'kicker', e.fields.kicker, x, { px: 16 * k, spec: TYPE.monoR, maxW: w, tracking: 0.22 }),
        blockItem(e, 'title', e.fields.title, x, e.headline, { maxW: w * size, maxH: maxH * size, max: namePx * k * size, lines: 3, gap: 0.2 }, { color: headColor(e), before: 24 * k }),
        details(e, x, w, k, { before: 44 * k, px: detailsPx }),
        price ? priceItem(e, x, { px: 30 * k, maxW: w, before: 38 * k }) : null,
    ];
}

export default {
    id: 'course-outline',
    name: 'Course Outline',
    category: 'Mind',
    section: 'Products',
    blurb: 'A course set like a syllabus: the name in serif, when it starts and how it runs, the weeks numbered on hairlines, the course book or a studio photo beside it.',
    refs: 'a university course prospectus',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: '8-week course' },
        { key: 'title', label: 'Course name', rows: 2, value: 'The Quiet\nPractice', hint: '{Braces} colour a word, _underscores_ set italic.' },
        { key: 'start', label: '(starts)', value: 'Monday 6 October' },
        { key: 'format', label: '(format)', value: 'Online · Tuesdays, 19:00' },
        { key: 'weeks', label: 'Weeks', rows: 8, value: 'Arriving\nThe breath\nThe body\nAttention\nSound\nWalking\nEvenings\nKeeping it going', hint: 'One per line, up to twelve. They’re numbered for you.' },
        { key: 'price', label: 'Price', value: '£120' },
        { key: 'points', label: 'Points', value: 'or 12,000 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Northside Studio · Book in the app' },
        { ...PRODUCT_FIELD, label: 'Course book / product shot' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: '8-week course', fields: { kicker: '8-week course', title: 'The Quiet\nPractice', start: 'Monday 6 October', format: 'Online · Tuesdays, 19:00', weeks: 'Arriving\nThe breath\nThe body\nAttention\nSound\nWalking\nEvenings\nKeeping it going', price: '£120', points: 'or 12,000 POWR points', footer: 'Northside Studio · Book in the app' } },
        { name: 'Breathwork', fields: { kicker: '6-week course', title: 'Breath,\nweek by week', start: 'Thursday 2 October', format: 'In the studio · 18:30 · 60 min', weeks: 'Noticing\nSlow and low\nBox breathing\nThe long exhale\nHolds\nYour own practice', price: '£90', points: 'or 9,000 POWR points', footer: 'Northside Breath · 12 places' } },
        { name: 'Journaling', fields: { kicker: '4-week class', title: 'Pages', start: 'Sunday 5 October', format: 'Online · Sundays, 10:00', weeks: 'A page a day\nWriting to a prompt\nLists and lines\nKeeping the habit', price: '£48', points: 'Members first in the POWR app', footer: 'Journal included · Northside Paper' } },
        { name: 'Retreat day', fields: { kicker: 'One-day retreat', title: 'A Slow\nSaturday', start: 'Saturday 18 October', format: 'In the studio · 10:00–16:00', weeks: 'Arrive and settle\nMorning sit\nWalk\nLunch\nSound bath\nClose', price: '£85', points: 'or 8,500 POWR points', footer: 'Lunch included · 16 places' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, target: 0.26, beside: 'auto' },
    controls: [
        { key: 'beside', label: 'Beside the words', options: [['auto', 'Auto'], ['product', 'Product'], ['photo', 'Photo']] },
    ],
    fill: { reward: (r) => productFill(r) },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k } = f;
        const mode = besideOf(e);
        ground(e, GROUND);

        if (f.strip) {
            const vw = W * 0.2;
            const vbox = mode === 'photo' ? { x: 0, y: 0, w: vw, h: H } : { x: f.x0, y: f.top, w: vw - f.x0, h: f.bottom - f.top };
            visual(e, vbox, k, mode);
            if (mode === 'photo') e.fade(vw * 0.6, 0, vw * 0.4, H, 'right', 0.3);
            const hx = vw + 56 * k;
            const hw = W * 0.24;
            const list = head(e, hx, hw, k, { namePx: 64, maxH: (f.bottom - f.top) * 0.36, detailsPx: 20 * k, price: false });
            list.splice(2, 1);
            stack(list, f.top + 10 * k);
            footRow(e, { x0: hx, x1: hx + hw, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            const lx = hx + hw + 50 * k;
            const d = details(e, lx, f.x1 - lx, k, { px: 20 * k });
            if (d) d.draw(f.top + 10 * k);
            const ly = f.top + (d ? d.h + 50 * k : 0);
            weeks(e, lx, f.x1, ly, f.bottom, 4, k, { px: 24 * k });
            return;
        }

        if (f.wide) {
            const vw = W * 0.34;
            const footTop = f.bottom - footH(e, k);
            const vbox = mode === 'photo' ? { x: 0, y: 0, w: vw, h: H } : { x: f.x0, y: f.top + 40 * k, w: vw - f.x0 - 20 * k, h: footTop - 80 * k - f.top };
            visual(e, vbox, k, mode);
            const x = vw + 80 * k;
            const w = f.x1 - x;
            const list = head(e, x, w * 0.62, k, { namePx: 92, maxH: H * 0.22 });
            const hb = stack(list, f.top + 10 * k);
            weeks(e, x, f.x1, hb + 60 * k, footTop - 50 * k, 2, k, { px: 28 * k });
            footRow(e, { x0: mode === 'photo' ? x : f.x0, x1: f.x1, bottom: f.bottom, k });
            return;
        }

        // Post, square, story.
        const footTop = f.bottom - footH(e, k);
        const w = f.x1 - f.x0;
        const cols = f.tall ? 1 : 2;
        const rows = weekRows(e, cols);
        const listH = rows * (f.tall ? 64 : f.sq ? 62 : 84) * k;
        const listBottom = footTop - (f.sq ? 36 : 56) * k;
        const listTop = listBottom - listH;
        const top = f.top + (f.tall ? 20 : 0) * k;
        if (f.tall) {
            const list = head(e, f.x0, w, k, { namePx: 100, maxH: H * 0.12 });
            const vis = { x: f.x0, y: top, w, h: 0 };
            const headH = stackH(list);
            vis.h = listTop - 60 * k - headH - 60 * k - top;
            if (mode === 'photo') visual(e, vis, k, mode);
            else visual(e, { x: f.x0 + w * 0.2, y: vis.y, w: w * 0.6, h: vis.h }, k, mode);
            stack(list, vis.y + vis.h + 60 * k);
        } else {
            const vw = w * (f.sq ? 0.36 : 0.4);
            const vis = { x: f.x1 - vw, y: top, w: vw, h: listTop - 60 * k - top };
            visual(e, vis, k, mode);
            const list = head(e, f.x0, w - vw - 60 * k, k, { namePx: f.sq ? 80 : 96, maxH: H * 0.18 });
            stack(list, top + Math.max(0, (vis.h - stackH(list)) / 2));
        }
        weeks(e, f.x0, f.x1, listTop, listBottom, cols, k, { px: (f.sq ? 25 : 30) * k });
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
    },
};
