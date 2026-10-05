/**
 * PREP WEEK — a meal-prep planner: the week as a grid of days × breakfast ·
 * lunch · dinner, a short dish in each cell, today picked out in the accent.
 * Days run down a post or story and across a banner; the thin strips show
 * the next few days from today. For meal-prep brands, cafés and coaches.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, HAIR, rows, lift, fitPx, alpha } from './_parts';

const weekOf = (e) => rows(e.fields.week, 7).filter((r) => r[0]).map(([day, ...meals]) => ({ day, meals: [0, 1, 2].map((i) => meals[i] ?? '') }));
const mealsOf = (e) => String(e.fields.meals ?? '').split(/\s*[|·]\s*/).map((s) => s.trim()).slice(0, 3);
const isToday = (e, d) => {
    const t = String(e.fields.today ?? '').trim().toLowerCase();
    return !!t && d.day.toLowerCase().startsWith(t.slice(0, 3));
};

// Largest px (≤ max) at which every cell wraps into `lines` lines of cw.
function cellPx(ctx, texts, cw, ch, max, min, lines = 2) {
    let px = max;
    const fits = (p) => texts.every((t) => wrapLines(ctx, t, TYPE.brandR, p, cw, 99).length <= lines) && p * 1.2 * lines <= ch;
    while (px > min && !fits(px)) px *= 0.94;
    return px;
}

function cell(e, text, x, y, cw, ch, px, lines, color) {
    const wl = wrapLines(e.ctx, text, TYPE.brandR, px, cw, lines);
    const h = px * 0.75 + (wl.length - 1) * px * 1.2;
    drawText(e.ctx, wl.join('\n'), TYPE.brandR, px, x, y + (ch - h) / 2 + px * 0.75, { color, leading: 1.2 });
}

// Days down the rows, meals across the columns.
function down(e, x, top, w, bottom, U) {
    const { ctx } = e;
    const week = weekOf(e);
    const meals = mealsOf(e);
    if (!week.length) return;
    const acc = lift(e.accent);
    const hPx = 15 * U;
    const headH = hPx * 2.6;
    const dayW = 116 * U;
    const colW = (w - dayW) / 3;
    const rowH = (bottom - top - headH) / week.length;
    const pad = 16 * U;
    meals.forEach((m, i) => drawText(ctx, e.caps(m), TYPE.mono, fitPx(ctx, e.caps(m), TYPE.mono, hPx, colW - pad, 0.18), x + dayW + i * colW + pad, top + hPx, { tracking: 0.18, color: GREY }));
    e.mark('meals', { x: x + dayW, y: top, w: w - dayW, h: hPx });
    const px = cellPx(ctx, week.flatMap((d) => d.meals), colW - pad * 2, rowH - 12 * U, 27 * U, 13 * U);
    const dPx = Math.min(30 * U, rowH * 0.4);
    week.forEach((d, r) => {
        const y = top + headH + r * rowH;
        const today = isToday(e, d);
        if (today) {
            ctx.fillStyle = alpha(acc, 0.14);
            ctx.fillRect(x, y, w, rowH);
            ctx.fillStyle = acc;
            ctx.fillRect(x, y, 4 * U, rowH);
        }
        rule(ctx, x, y, x + w, y, r ? HAIR : alpha(INK, 0.5), Math.max(1, (r ? 1.2 : 2) * U));
        drawText(ctx, e.caps(d.day), TYPE.brandSB, fitPx(ctx, e.caps(d.day), TYPE.brandSB, dPx, dayW - (today ? 36 : 18) * U, 0.04), x + (today ? 18 * U : 0), y + rowH / 2 + dPx * 0.36, { tracking: 0.04, color: today ? acc : INK });
        d.meals.forEach((m, i) => {
            const cx = x + dayW + i * colW;
            rule(ctx, cx, y + 10 * U, cx, y + rowH - 10 * U, HAIR, Math.max(1, 1.2 * U));
            cell(e, m, cx + pad, y, colW - pad * 2, rowH, px, 2, today ? INK : SOFT);
        });
    });
    rule(ctx, x, bottom, x + w, bottom, alpha(INK, 0.5), Math.max(1, 2 * U));
    e.mark('week', { x, y: top + headH, w, h: bottom - top - headH });
}

// Days across the columns, meals down the rows. `days` limits the columns
// (strips show today and the days after it).
function across(e, x, top, w, bottom, U, { days = 7 } = {}) {
    const { ctx } = e;
    let week = weekOf(e);
    const meals = mealsOf(e);
    if (!week.length) return;
    if (days < week.length) {
        const t = Math.max(0, week.findIndex((d) => isToday(e, d)));
        const start = Math.min(t, week.length - days);
        week = week.slice(start, start + days);
    }
    const acc = lift(e.accent);
    const labW = 118 * U;
    const colW = (w - labW) / week.length;
    const dPx = 22 * U;
    const headH = dPx * 2.2;
    const rowH = (bottom - top - headH) / 3;
    const pad = 14 * U;
    const px = cellPx(ctx, week.flatMap((d) => d.meals), colW - pad * 2, rowH - 8 * U, 24 * U, 12 * U, 3);
    week.forEach((d, c) => {
        const cx = x + labW + c * colW;
        const today = isToday(e, d);
        if (today) {
            ctx.fillStyle = alpha(acc, 0.14);
            ctx.fillRect(cx, top, colW, bottom - top);
            ctx.fillStyle = acc;
            ctx.fillRect(cx, top, colW, 4 * U);
        }
        drawText(ctx, e.caps(d.day), TYPE.brandSB, fitPx(ctx, e.caps(d.day), TYPE.brandSB, dPx, colW - pad * 2, 0.04), cx + pad, top + headH * 0.5 + dPx * 0.36, { tracking: 0.04, color: today ? acc : INK });
        if (c) rule(ctx, cx, top + headH, cx, bottom, HAIR, Math.max(1, 1.2 * U));
        d.meals.forEach((m, r) => cell(e, m, cx + pad, top + headH + r * rowH, colW - pad * 2, rowH, px, 3, today ? INK : SOFT));
    });
    const lPx = 13 * U;
    meals.forEach((m, r) => {
        const y = top + headH + r * rowH;
        rule(ctx, x, y, x + w, y, r ? HAIR : alpha(INK, 0.5), Math.max(1, (r ? 1.2 : 2) * U));
        drawText(ctx, e.caps(m), TYPE.mono, fitPx(ctx, e.caps(m), TYPE.mono, lPx, labW - 16 * U, 0.16), x, y + rowH / 2 + lPx * 0.36, { tracking: 0.16, color: GREY });
    });
    rule(ctx, x, bottom, x + w, bottom, alpha(INK, 0.5), Math.max(1, 2 * U));
    e.mark('meals', { x, y: top + headH, w: labW, h: bottom - top - headH });
    e.mark('week', { x: x + labW, y: top, w: w - labW, h: bottom - top });
}

function heading(e, x, top, w, maxH, U) {
    const { ctx } = e;
    const kPx = 18 * U;
    let y = top;
    const k = e.caps(e.fields.kicker).trim();
    if (k) y += kPx * 0.75 + 22 * U;
    const lines = splitLines(e.fields.title).slice(0, 2);
    const block = fitBlock(ctx, lines, e.headline, { maxW: w * (e.look.size ?? 1), maxH: maxH * (e.look.size ?? 1), gap: 0.16 });
    e.shade({ x, y, w, h: block.cap + (lines.length - 1) * block.step }, { ceiling: 0.26, max: 0.6 });
    if (k) e.mark('kicker', drawText(ctx, k, TYPE.mono, fitPx(ctx, k, TYPE.mono, kPx, w, 0.18), x, top + kPx * 0.75, { tracking: 0.18, color: lift(e.accent) }));
    const boxes = drawBlock(ctx, block, e.headline, x, y, { color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) });
    e.mark('title', blockBox(boxes));
    return boxes[boxes.length - 1].baseline + block.px * 0.22;
}

function note(e, x, base, w, U, align = 'left') {
    const t = String(e.fields.note ?? '').trim();
    if (!t) return;
    const px = 20 * U;
    e.mark('note', drawText(e.ctx, t, TYPE.brandL, fitPx(e.ctx, t, TYPE.brandL, px, w), x, base, { align, color: SOFT }));
}

export default {
    id: 'prep-week',
    name: 'Prep Week',
    category: 'Eat',
    blurb: 'A meal-prep planner: days × breakfast · lunch · dinner, today picked out. For meal-prep brands, cafés and coaches.',
    refs: 'a printed weekly planner',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Meal prep · This week' },
        { key: 'title', label: 'Title', rows: 2, value: 'The week,\n{prepped}.' },
        { key: 'meals', label: 'Meal heads', value: 'Breakfast | Lunch | Dinner', hint: 'Three, split with |.' },
        {
            key: 'week', label: 'The week', rows: 7,
            value: 'Mon | Oats, berries | Chicken rice bowl | Salmon, greens\nTue | Eggs on toast | Chicken rice bowl | Turkey chilli\nWed | Oats, berries | Turkey chilli | Tofu stir fry\nThu | Yoghurt, granola | Tofu stir fry | Beef & broccoli\nFri | Eggs on toast | Beef & broccoli | Out\nSat | Pancakes | Leftovers | Fish tacos\nSun | Eggs, avocado | Roast chicken | Prep for Monday',
            hint: 'One day a line: day | breakfast | lunch | dinner. Keep dishes short.',
        },
        { key: 'today', label: 'Today', value: 'Wed', hint: 'Matches a day by its first three letters. Leave empty for none.' },
        { key: 'note', label: 'Line', value: 'Two hours on Sunday. Five boxes in the fridge.', hint: 'Leave empty to hide it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Home prep', fields: {} },
        {
            name: 'Meal-prep brand', fields: {
                kicker: 'Northside Kitchen · Week 40 menu', title: 'Your week,\n{boxed}.', today: 'Mon',
                week: 'Mon | Protein oats | Chicken pesto pasta | Beef chilli, rice\nTue | Egg muffins | Teriyaki salmon | Chicken tikka\nWed | Protein oats | Falafel, tabbouleh | Turkey meatballs\nThu | Egg muffins | Chicken burrito bowl | Thai green curry\nFri | Overnight oats | Poke bowl | Steak, sweet potato\nSat | Delivery day | — | —\nSun | — | — | —',
                note: 'Order by Thursday · Redeem with POWR points',
            },
        },
        {
            name: 'Gym café', fields: {
                kicker: 'The gym kitchen · Specials', title: 'What’s cooking\nthis {week}.', meals: 'Before | After | To take home', today: 'Tue',
                week: 'Mon | Banana bread | Chicken rice bowl | Chilli, two portions\nTue | Protein pancakes | Salmon poke | Curry, two portions\nWed | Overnight oats | Falafel wrap | Lasagne, two portions\nThu | Protein pancakes | Steak & greens | Chilli, two portions\nFri | Granola pot | Fish tacos | —',
                note: 'Order at the bar · 6am – 9pm',
            },
            style: { accent: '#D9A066' },
        },
        {
            name: 'Plant week', fields: {
                kicker: 'Plant based · Batch cook', title: 'Seven days\nof {plants}.', today: 'Thu',
                week: 'Mon | Chia pot | Lentil soup | Tofu curry\nTue | Oats, berries | Tofu curry | Bean chilli\nWed | Chia pot | Bean chilli | Tempeh stir fry\nThu | Smoothie bowl | Tempeh stir fry | Chickpea stew\nFri | Oats, berries | Chickpea stew | Pizza night\nSat | Pancakes | Buddha bowl | Mushroom risotto\nSun | Tofu scramble | Roast veg, hummus | Prep for Monday',
                note: 'Cook three bases. Mix them all week.',
            },
            style: { accent: '#8FD694' },
        },
    ],
    look: { ...LOOK, target: 0.26 },
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, u, tu, safe, shape } = e;
        e.photo({ x: 0, y: 0, w: W, h: H });
        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const U = strip ? tu * 0.9 : tu;
            const x = safe.l + 4 * U;
            const colW = W * (strip ? 0.24 : 0.25);
            const gx = x + colW + (strip ? 40 : 60) * U;
            ctx.fillStyle = 'rgba(11,11,10,0.55)';
            ctx.fillRect(0, 0, W, H);
            e.fade(0, 0, gx, H, 'left', 0.5);
            ctx.fillStyle = 'rgba(11,11,10,0.72)';
            ctx.fillRect(gx - 24 * U, 0, W - gx + 24 * U, H);
            const lk = lockup(e, x, safe.t, (strip ? 26 : 38) * U, { maxW: colW });
            heading(e, x, lk.y + lk.h + (strip ? 30 : 60) * U, colW, H * (strip ? 0.4 : 0.3), U);
            if (!strip) {
                const nl = wrapLines(ctx, e.fields.note, TYPE.brandL, 22 * U, colW, 3);
                if (nl.length) e.mark('note', drawText(ctx, nl.join('\n'), TYPE.brandL, 22 * U, x, H - safe.b - (nl.length - 1) * 22 * U * 1.3, { color: SOFT, leading: 1.3 }));
            }
            across(e, gx, safe.t, W - safe.r - gx, H - safe.b, U, { days: strip ? 4 : 7 });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x = safe.l + 4 * u;
        const w = W - safe.r - 4 * u - x;
        e.fade(0, 0, W, H * 0.4, 'top', 0.7);
        const lk = lockup(e, x, safe.t + 6 * u, 42 * u, { maxW: w });
        const hb = heading(e, x, lk.y + lk.h + (tall ? 60 : 40) * u, sq ? w * 0.6 : w * 0.8, H * (tall ? 0.1 : sq ? 0.12 : 0.11), u);
        const gridTop = hb + (tall ? 60 : 40) * u;
        const noteOn = String(e.fields.note ?? '').trim();
        const bottom = H - safe.b - (noteOn ? 56 * u : 6 * u);
        // The grid sits on a dark panel so the photo stays behind it.
        ctx.fillStyle = 'rgba(11,11,10,0.84)';
        ctx.fillRect(0, gridTop - 24 * u, W, H - gridTop + 24 * u);
        down(e, x, gridTop, w, bottom, u);
        note(e, x, H - safe.b - 6 * u, w, u);
    },
};
