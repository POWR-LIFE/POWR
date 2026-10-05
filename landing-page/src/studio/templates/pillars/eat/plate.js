/**
 * PLATE — the photo cropped to a circle, the plate itself, with a thin ring
 * around it divided into labelled arcs (protein · veg · carbs · fats, in
 * the proportions set in the fields), labels outside the ring on leader
 * lines. For cafés, meal-prep and food brands.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, textWidth, wrapLines } from '../../../text';
import { dot } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, GREY, SOFT, rows, lift, fitPx, alpha, num } from './_parts';

const GROUND = '#0D0D0C';

// The ring and its labels around (cx, cy), photo radius r.
function ring(e, cx, cy, r, U, { bounds }) {
    const { ctx } = e;
    const acc = lift(e.accent);
    const parts = rows(e.fields.split, 5).map(([name = '', v = '']) => ({ name, v, n: Math.max(0, num(v)) })).filter((p) => p.name && p.n > 0);
    const total = parts.reduce((a, p) => a + p.n, 0);
    const R = r + 24 * U;
    const lw = Math.max(2, 9 * U);
    // A hairline between the plate and the ring.
    ctx.save();
    ctx.strokeStyle = alpha(INK, 0.22);
    ctx.lineWidth = Math.max(1, 1.2 * U);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (!total) return;
    const shades = [acc, alpha(INK, 0.9), alpha(INK, 0.58), alpha(INK, 0.34), alpha(INK, 0.2)];
    const gapA = Math.min(0.06, 8 * U / R);
    let a = -Math.PI / 2;
    const labels = [];
    parts.forEach((p, i) => {
        const sweep = (p.n / total) * Math.PI * 2;
        ctx.save();
        ctx.strokeStyle = shades[i];
        ctx.lineWidth = lw;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.arc(cx, cy, R, a + gapA / 2, a + Math.max(gapA, sweep - gapA / 2));
        ctx.stroke();
        ctx.restore();
        const mid = a + sweep / 2;
        labels.push({ ...p, mid, colour: i === 0 ? acc : INK, right: Math.cos(mid) >= 0 });
        a += sweep;
    });

    // Labels: out from the arc's middle, then an elbow to the side. Each side
    // is spread so no two labels touch.
    const namePx = 16 * U;
    const valPx = 44 * U;
    const labH = namePx * 1.6 + valPx * 0.75;
    const out = R + lw / 2 + 26 * U;
    labels.forEach((l) => { l.y = cy + Math.sin(l.mid) * out; });
    for (const side of [true, false]) {
        const s = labels.filter((l) => l.right === side).sort((p, q) => p.y - q.y);
        for (let k = 1; k < s.length; k++) s[k].y = Math.max(s[k].y, s[k - 1].y + labH + 26 * U);
        const over = s.length ? s[s.length - 1].y + labH / 2 - bounds.b : 0;
        if (over > 0) s.forEach((l) => { l.y -= over; });
        for (let k = s.length - 2; k >= 0; k--) s[k].y = Math.min(s[k].y, s[k + 1].y - labH - 26 * U);
        // …and never above the title.
        if (s.length && s[0].y - namePx * 1.6 < bounds.t) {
            s[0].y = bounds.t + namePx * 1.6;
            for (let k = 1; k < s.length; k++) s[k].y = Math.max(s[k].y, s[k - 1].y + labH + 26 * U);
        }
    }
    let box = null;
    labels.forEach((l) => {
        const sx = cx + Math.cos(l.mid) * (R + lw / 2 + 4 * U);
        const sy = cy + Math.sin(l.mid) * (R + lw / 2 + 4 * U);
        const ox = cx + Math.cos(l.mid) * out;
        const dir = l.right ? 1 : -1;
        // Shrink a label that can't fit between its leader and the frame.
        const avail = (l.right ? bounds.r - ox : ox - bounds.l) - 34 * U;
        const tw0 = Math.max(textWidth(ctx, e.caps(l.name), TYPE.mono, namePx, 0.18), textWidth(ctx, l.v, TYPE.brandL, valPx));
        const k = tw0 > avail ? Math.max(0.45, avail / tw0) : 1;
        const nPx = namePx * k;
        const vPx = valPx * Math.max(k, 0.7);
        const tw = Math.max(textWidth(ctx, e.caps(l.name), TYPE.mono, nPx, 0.18), textWidth(ctx, l.v, TYPE.brandL, vPx));
        let ex = ox + dir * 30 * U;
        // Keep the label inside the frame.
        if (l.right) ex = Math.min(ex, bounds.r - 12 * U - tw);
        else ex = Math.max(ex, bounds.l + 12 * U + tw);
        ex = l.right ? Math.max(ex, ox + 10 * U) : Math.min(ex, ox - 10 * U);
        ctx.save();
        ctx.strokeStyle = alpha(INK, 0.5);
        ctx.lineWidth = Math.max(1, 1.4 * U);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ox, l.y);
        ctx.lineTo(ex, l.y);
        ctx.stroke();
        ctx.restore();
        dot(ctx, sx, sy, 3 * U, l.colour);
        const tx = ex + dir * 12 * U;
        const align = l.right ? 'left' : 'right';
        const b1 = drawText(ctx, e.caps(l.name), TYPE.mono, fitPx(ctx, e.caps(l.name), TYPE.mono, nPx, avail, 0.18), tx, l.y - namePx * 0.35, { align, tracking: 0.18, color: l.colour === INK ? GREY : l.colour });
        const b2 = drawText(ctx, l.v, TYPE.brandL, fitPx(ctx, l.v, TYPE.brandL, vPx, avail), tx, l.y + namePx * 0.5 + vPx * 0.75, { align, color: l.colour });
        for (const b of [b1, b2]) if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b;
    });
    e.mark('split', box);
}

// The photo, then the ground over everything but the circle.
function plate(e, cx, cy, r) {
    const { ctx, W, H } = e;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    e.photo({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
    ctx.save();
    ctx.fillStyle = GROUND;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
}

function heading(e, x, top, w, maxH, U) {
    const { ctx } = e;
    const kPx = 18 * U;
    let y = top;
    const k = e.caps(e.fields.kicker).trim();
    if (k) {
        e.mark('kicker', drawText(ctx, k, TYPE.mono, fitPx(ctx, k, TYPE.mono, kPx, w, 0.18), x, y + kPx * 0.75, { tracking: 0.18, color: lift(e.accent) }));
        y += kPx * 0.75 + 22 * U;
    }
    const lines = splitLines(e.fields.title).slice(0, 3);
    const block = fitBlock(ctx, lines, e.headline, { maxW: w * (e.look.size ?? 1), maxH: maxH * (e.look.size ?? 1), gap: 0.16 });
    const boxes = drawBlock(ctx, block, e.headline, x, y, { color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) });
    e.mark('title', blockBox(boxes));
    return boxes[boxes.length - 1].baseline + block.px * 0.2;
}

function note(e, x, base, w, U, max = 2) {
    const t = String(e.fields.note ?? '').trim();
    if (!t) return;
    const px = 24 * U;
    const lines = wrapLines(e.ctx, t, TYPE.brandL, px, w, max);
    e.mark('note', drawText(e.ctx, lines.join('\n'), TYPE.brandL, px, x, base - (lines.length - 1) * px * 1.3, { color: SOFT, leading: 1.3 }));
}

export default {
    id: 'plate',
    name: 'Plate',
    category: 'Eat',
    blurb: 'The dish cropped to a circle, ringed by labelled arcs for protein · veg · carbs · fats. For cafés, meal prep and food brands.',
    refs: 'a dinner-plate diagram, set like a watch dial',
    headlineFont: 'brandL',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'On the plate · Lunch' },
        { key: 'title', label: 'Title', rows: 2, value: 'What’s on\nthe {plate}.' },
        { key: 'split', label: 'The split', rows: 4, value: 'Protein — 30%\nVeg — 40%\nCarbs — 20%\nFats — 10%', hint: 'Up to five lines: name — share. The arcs follow the numbers; the first is set in the accent.' },
        { key: 'note', label: 'Line', value: 'Chicken thigh, tenderstem, brown rice, olive oil.', hint: 'Leave empty to hide it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Lunch plate', fields: {} },
        { name: 'Café bowl', fields: { kicker: 'The gym kitchen · £9.50', title: 'The {bowl},\nby the numbers.', split: 'Protein — 41g\nCarbs — 57g\nFat — 14g\nFibre — 8g', note: 'Chicken, jasmine rice, edamame, sesame. Redeem with POWR points.' } },
        { name: 'Plant plate', fields: { kicker: 'Plant based · Dinner', title: 'All {plants}.', split: 'Legumes — 35%\nVeg — 35%\nGrains — 20%\nNuts & seeds — 10%', note: 'Chickpeas, roast squash, freekeh, tahini.' }, style: { accent: '#8FD694' } },
        { name: 'Meal prep', fields: { kicker: 'Northside Kitchen · Meal prep', title: 'Five boxes.\nOne {split}.', split: 'Protein — 30%\nVeg — 35%\nCarbs — 25%\nFats — 10%', note: 'Delivered Sunday. Earn points training, redeem them on the box.' } },
    ],
    look: { ...LOOK, target: 0.3, vignette: 0.35 },
    fill: { reward: (r) => ({ ...rewardWords(r), kicker: r.cost ? `${r.brand} · ${rewardWords(r).points}` : `On the plate · ${r.brand}` }) },

    draw(e) {
        const { W, H, u, tu, safe, shape } = e;
        const bounds = { l: safe.l, r: W - safe.r, t: safe.t, b: H - safe.b };
        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const U = strip ? tu * 0.9 : tu;
            const r = (H - safe.t - safe.b) * (strip ? 0.4 : 0.36);
            const cx = W * (strip ? 0.66 : 0.66);
            const cy = H / 2;
            plate(e, cx, cy, r);
            const x = safe.l + 4 * U;
            const colW = W * (strip ? 0.3 : 0.34);
            lockup(e, x, safe.t, (strip ? 28 : 40) * U, { maxW: colW });
            heading(e, x, safe.t + (strip ? 64 : 110) * U, colW, H * (strip ? 0.36 : 0.3), U);
            if (!strip) note(e, x, H - safe.b, colW, U, 3);
            ring(e, cx, cy, r, U, { bounds: { ...bounds, l: x + colW + 20 * U } });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x = safe.l + 6 * u;
        const w = W - safe.r - 6 * u - x;
        const r = W * (tall ? 0.28 : sq ? 0.22 : 0.26);
        const cx = sq ? W * 0.6 : W / 2;
        const cy = tall ? H * 0.54 : sq ? H * 0.58 : H * 0.58;
        plate(e, cx, cy, r);
        const lk = lockup(e, x, safe.t + 6 * u, 44 * u, { maxW: w });
        const hb = heading(e, x, lk.y + lk.h + (tall ? 70 : 44) * u, sq ? w * 0.5 : w * 0.8, H * (tall ? 0.1 : sq ? 0.16 : 0.12), u);
        note(e, x, H - safe.b - 4 * u, sq ? w * 0.34 : w, u, sq ? 4 : 2);
        ring(e, cx, cy, r, u, { bounds: { ...bounds, t: hb + 30 * u, b: H - safe.b - (sq ? 0 : 90 * u) } });
    },
};
