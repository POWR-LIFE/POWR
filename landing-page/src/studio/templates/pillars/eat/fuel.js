/**
 * FUEL TIMING — the day around a session as a timeline: before · during ·
 * after, each a time and what's eaten, on a line with nodes; the "after"
 * node in the accent. Vertical on posts and stories, across on banners.
 * For sports-nutrition brands, gyms and coaches. Timings, not outcomes.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines, capHeight, textWidth } from '../../../text';
import { rule, dot, ring } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, rows, lift, fitPx, alpha } from './_parts';

// The plan: "16:30 | Before | Oats, banana, honey", three or four stops.
// The stop called "After" (else the last) is the one in the accent.
function plan(e) {
    const list = rows(e.fields.plan, 4).map(([time = '', label = '', what = '']) => ({ time, label, what }));
    const hi = list.findIndex((s) => /\bafter\b/i.test(s.label));
    return list.map((s, i) => ({ ...s, hi: i === (hi >= 0 ? hi : list.length - 1) }));
}

function node(e, x, y, r, hi, U) {
    const acc = lift(e.accent);
    if (hi) {
        dot(e.ctx, x, y, r * 2.1, alpha(acc, 0.18));
        dot(e.ctx, x, y, r * 1.2, acc);
    } else {
        dot(e.ctx, x, y, r, '#0D0D0C');
        ring(e.ctx, x, y, r, INK, Math.max(1.5, 2.5 * U));
    }
}

// Kicker + title at (x, top), fitted to w × maxH. Returns the bottom.
function heading(e, x, top, w, maxH, U, align = 'left') {
    const { ctx } = e;
    const kPx = 18 * U;
    const k = e.caps(e.fields.kicker).trim();
    let y = top;
    if (k) y += kPx * 0.75 + 24 * U;
    const lines = splitLines(e.fields.title).slice(0, 3);
    const block = fitBlock(ctx, lines, e.headline, { maxW: w * (e.look.size ?? 1), maxH: maxH * (e.look.size ?? 1), gap: 0.16 });
    e.shade({ x, y, w, h: block.cap + (lines.length - 1) * block.step }, { ceiling: 0.26, max: 0.6 });
    if (k) e.mark('kicker', drawText(ctx, k, TYPE.mono, fitPx(ctx, k, TYPE.mono, kPx, w, 0.18), x, top + kPx * 0.75, { align, tracking: 0.18, color: lift(e.accent) }));
    const boxes = drawBlock(ctx, block, e.headline, x, y, { align, color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) });
    e.mark('title', blockBox(boxes));
    return boxes[boxes.length - 1].baseline + block.px * 0.2;
}

function note(e, x, y, w, U, align = 'left') {
    const t = String(e.fields.note ?? '').trim();
    if (!t) return;
    const px = 18 * U;
    e.mark('note', drawText(e.ctx, t, TYPE.brandL, fitPx(e.ctx, t, TYPE.brandL, px, w), x, y, { align, color: GREY }));
}

// Down the frame: times left of the line, what's eaten right of it.
function vertical(e, { x, y0, y1, w, U }) {
    const { ctx } = e;
    const stops = plan(e);
    if (!stops.length) return;
    const acc = lift(e.accent);
    const tPx = 40 * U;
    const timeW = Math.min(220 * U, Math.max(90 * U, ...stops.map((s) => textWidth(ctx, s.time, TYPE.brandL, tPx))));
    const lx = x + timeW + 34 * U;
    const tx = lx + 44 * U;
    const gap = stops.length > 1 ? (y1 - y0) / (stops.length - 1) : 0;
    const whatPx = Math.min(38 * U, gap * 0.26 || 38 * U);
    const labPx = 16 * U;
    // The line, a touch past the first and last stops.
    rule(ctx, lx, y0 - 30 * U, lx, y1 + 30 * U, alpha(INK, 0.35), Math.max(1, 2 * U));
    const hiIdx = stops.findIndex((s) => s.hi);
    if (hiIdx > 0) rule(ctx, lx, y0 + (hiIdx - 1) * gap, lx, y0 + hiIdx * gap, acc, Math.max(2, 3 * U));
    let box = null;
    stops.forEach((s, i) => {
        const y = y0 + i * gap;
        const lines = wrapLines(ctx, s.what, TYPE.brandR, whatPx, x + w - tx, 2);
        const blockH = labPx * 1.9 + whatPx * 0.75 + (lines.length - 1) * whatPx * 1.2;
        e.shade({ x, y: y - labPx * 1.5, w: x + w - x, h: blockH }, { ceiling: 0.14, max: 0.82, spread: 1.25 }); // food is busy: mean light understates it
        drawText(ctx, s.time, TYPE.brandL, fitPx(ctx, s.time, TYPE.brandL, tPx, timeW), lx - 34 * U, y + capHeight(ctx, TYPE.brandL, tPx) / 2, { align: 'right', color: s.hi ? acc : INK });
        node(e, lx, y, 9 * U, s.hi, U);
        drawText(ctx, e.caps(s.label), TYPE.mono, labPx, tx, y - labPx * 0.55, { tracking: 0.2, color: s.hi ? acc : GREY });
        drawText(ctx, lines.join('\n'), TYPE.brandR, whatPx, tx, y + labPx * 0.75 + whatPx * 0.8, { color: s.hi ? INK : SOFT, leading: 1.2 });
        const b = { x, y: y - labPx * 1.5, w, h: blockH };
        box = box ? { x, y: box.y, w, h: b.y + b.h - box.y } : b;
    });
    e.mark('plan', box);
}

// Across the frame: time above each node, label and what below.
function horizontal(e, { x0, x1, y, U, maxWhat = 2, bottom }) {
    const { ctx } = e;
    const stops = plan(e);
    if (!stops.length) return;
    const acc = lift(e.accent);
    const n = stops.length;
    const colW = (x1 - x0) / n;
    const pad = 26 * U;
    const tPx = 38 * U;
    const labPx = 15 * U;
    let whatPx = 28 * U;
    rule(ctx, x0, y, x1, y, alpha(INK, 0.35), Math.max(1, 2 * U));
    const hiIdx = stops.findIndex((s) => s.hi);
    if (hiIdx > 0) rule(ctx, x0 + (hiIdx - 1) * colW, y, x0 + hiIdx * colW, y, acc, Math.max(2, 3 * U));
    // The what shrinks to fit the room under the line.
    const room = bottom - (y + 30 * U + labPx * 2);
    while (whatPx > 14 * U && stops.some((s) => wrapLines(ctx, s.what, TYPE.brandR, whatPx, colW - pad, maxWhat).length * whatPx * 1.2 > room)) whatPx *= 0.93;
    stops.forEach((s, i) => {
        const nx = x0 + i * colW;
        node(e, nx, y, 8 * U, s.hi, U);
        drawText(ctx, s.time, TYPE.brandL, fitPx(ctx, s.time, TYPE.brandL, tPx, colW - pad), nx, y - 30 * U, { color: s.hi ? acc : INK });
        drawText(ctx, e.caps(s.label), TYPE.mono, fitPx(ctx, e.caps(s.label), TYPE.mono, labPx, colW - pad, 0.2), nx, y + 30 * U + labPx * 0.75, { tracking: 0.2, color: s.hi ? acc : GREY });
        const lines = wrapLines(ctx, s.what, TYPE.brandR, whatPx, colW - pad, maxWhat);
        drawText(ctx, lines.join('\n'), TYPE.brandR, whatPx, nx, y + 30 * U + labPx * 2 + whatPx * 0.8, { color: s.hi ? INK : SOFT, leading: 1.2 });
    });
    e.mark('plan', { x: x0, y: y - 30 * U - tPx, w: x1 - x0, h: bottom - (y - 30 * U - tPx) });
}

export default {
    id: 'fuel-timing',
    name: 'Fuel Timing',
    category: 'Eat',
    blurb: 'Before · during · after a session on a timeline, each with a time and what’s eaten. For sports nutrition, gyms and coaches.',
    refs: 'a race-day fuelling plan',
    headlineFont: 'brandL',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Fuel timing · Evening session' },
        { key: 'title', label: 'Title', rows: 2, value: 'Around the\n{session}.' },
        { key: 'plan', label: 'Timeline', rows: 4, value: '16:30 | Before | Oats, banana, honey\n18:30 | During | Water + electrolytes\n19:30 | After | Shake, then chicken rice bowl', hint: 'Three or four lines: time | stage | what. The “After” stage is set in the accent.' },
        { key: 'note', label: 'Small print', value: 'A plan, not a prescription. Eat what works for you.', hint: 'Leave empty to hide it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Evening session', fields: {} },
        { name: 'Morning run', fields: { kicker: 'Fuel timing · Long run', title: 'Before the\n{miles}.', plan: '06:15 | Before | Toast, honey, coffee\n07:30 | During | One gel at 45 minutes\n08:45 | After | Eggs, sourdough, orange juice' } },
        { name: 'Protein brand', fields: { kicker: 'Northside · How our team fuels', title: 'The shake\nhas a {time}.', plan: '12:30 | Lunch | Rice, chicken, greens\n17:00 | Before | Banana + Northside Bar\n18:00 | During | Water, 500ml\n19:15 | After | Northside Whey, 30g scoop', note: 'Northside Whey · 24g protein per scoop' } },
        { name: 'Gym café', fields: { kicker: 'The gym kitchen · Open 6am–9pm', title: 'Train here.\n{Eat} here.', plan: '06:30 | Before | Espresso + banana bread\n07:00 | During | Free water at the bar\n08:00 | After | Protein pancakes · £6.50', note: 'Order at the bar · Redeem with POWR points' } },
    ],
    look: { ...LOOK, target: 0.28 },
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, u, tu, safe, shape } = e;
        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            e.photo({ x: 0, y: 0, w: W, h: H });
            ctx.fillStyle = 'rgba(10,10,9,0.45)';
            ctx.fillRect(0, 0, W, H);
            e.fade(0, 0, W * 0.7, H, 'left', 0.7);
            const x0 = safe.l + 4 * tu;
            const colW = W * (strip ? 0.27 : 0.34);
            lockup(e, x0, safe.t, (strip ? 26 : 40) * tu, { maxW: colW });
            heading(e, x0, safe.t + (strip ? 70 : 110) * tu, colW, H * (strip ? 0.4 : 0.34), tu);
            if (!strip) note(e, x0, H - safe.b, colW, tu);
            const tx0 = x0 + colW + (strip ? 70 : 90) * tu;
            const lineY = strip ? H * 0.42 : H * 0.48;
            horizontal(e, { x0: tx0, x1: W - safe.r, y: lineY, U: strip ? tu * 0.9 : tu * 1.3, maxWhat: strip ? 2 : 3, bottom: H - safe.b });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        // The timeline crosses the middle of the dish — food is busy, so the
        // whole frame dims a step and the left falls off hard under the type.
        ctx.fillStyle = 'rgba(10,10,9,0.3)';
        ctx.fillRect(0, 0, W, H);
        e.fade(0, 0, W, H, 'left', 0.88);
        e.fade(0, 0, W, H * 0.3, 'top', 0.5);
        e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.6);
        const x = safe.l + 6 * u;
        const w = W - safe.r - 6 * u - x;
        const lk = lockup(e, x, safe.t + 6 * u, 44 * u, { maxW: w });
        const hb = heading(e, x, lk.y + lk.h + (tall ? 80 : sq ? 44 : 60) * u, w * 0.8, H * (tall ? 0.13 : sq ? 0.17 : 0.15), u);
        const noteBase = H - safe.b - 6 * u;
        note(e, x, noteBase, w, u);
        const y0 = hb + (tall ? 170 : sq ? 90 : 120) * u;
        const y1 = noteBase - (tall ? 190 : sq ? 120 : 150) * u;
        vertical(e, { x, y0, y1, w, U: sq ? u * 0.9 : u });
    },
};
