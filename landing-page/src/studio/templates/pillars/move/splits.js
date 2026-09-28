/**
 * SPLITS — a run or ride read out like the watch does it: total distance and
 * time big and light, then the kilometre splits stacked (km · pace · a bar
 * for speed · time so far), the fastest in the accent. On the thin banners
 * the splits stand up as a bar chart. For run clubs and running kit.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, DIM, HAIR, topRow, mono, rowsOf, seconds, clock, figure, splitUnit, unitOf, fitPx } from './_parts';

// Rows: "4:58" or "5 — 9:12" (a label, then the split). Unreadable times are dropped.
function parse(e) {
    const rows = rowsOf(e.fields.splits).map((cells, i) => {
        const t = cells.length > 1 ? cells[cells.length - 1] : cells[0];
        return { km: cells.length > 1 ? cells[0] : String(i + 1), t, s: seconds(t) };
    }).filter((r) => Number.isFinite(r.s) && r.s > 0);
    let run = 0;
    rows.forEach((r) => { run += r.s; r.elapsed = clock(run); });
    const fastest = rows.length ? rows.reduce((a, b) => (b.s < a.s ? b : a)) : null;
    const lo = Math.min(...rows.map((r) => r.s));
    const hi = Math.max(...rows.map((r) => r.s));
    // Bar length: the fastest split fills it, the slowest keeps a third.
    rows.forEach((r) => { r.bar = hi > lo ? 0.34 + 0.66 * ((hi - r.s) / (hi - lo)) : 0.8; r.best = r === fastest; });
    return rows;
}

const heads = (e) => {
    const c = String(e.fields.cols ?? '').split(/\s*[·|,]\s*/).filter(Boolean);
    return [c[0] ?? 'Km', c[1] ?? 'Pace', c[2] ?? 'Time'];
};

// The two totals, side by side, labels over them. Returns the bottom (baseline).
function totals(e, x, top, colW, px, labPx) {
    const { ctx } = e;
    const base = top + labPx + 18 * unitOf(e) + capHeight(ctx, e.headline, px);
    [['distance', 'Distance'], ['time', 'Time']].forEach(([key, lab], i) => {
        const cx = x + i * colW;
        const [v, un] = key === 'distance' ? splitUnit(e.fields.distance) : [String(e.fields.time ?? '').trim(), ''];
        if (!v) return;
        mono(e, lab, cx, top + labPx * 0.75, labPx, { color: GREY });
        const w = textWidth(ctx, v, e.headline, px, -0.02) * 1.34;
        const p = w > colW * 0.94 ? (px * colW * 0.94) / w : px;
        e.mark(key, figure(e, v, un, cx - p * 0.04, base, p, { color: e.headlineAccent ? e.accent : e.ink }));
    });
    return base;
}

// The table: head row, then one row per split. (x0..x1, top..bottom)
function table(e, rows, x0, x1, top, rowH, px) {
    const { ctx } = e;
    const k = unitOf(e);
    const [hKm, hPace, hTime] = heads(e);
    const labPx = Math.max(11 * k, px * 0.5);
    const headH = labPx * 2.4;
    const kmW = Math.max(textWidth(ctx, '00', TYPE.mono, px * 0.72, 0.06), textWidth(ctx, e.caps(hKm), TYPE.mono, labPx, 0.18));
    const paceX = x0 + kmW + 34 * k;
    const paceW = Math.max(textWidth(ctx, '0:00', TYPE.brandSB, px, 0), textWidth(ctx, e.caps(hPace), TYPE.mono, labPx, 0.18));
    const timeW = Math.max(textWidth(ctx, '00:00', TYPE.mono, px * 0.72, 0.04), textWidth(ctx, e.caps(hTime), TYPE.mono, labPx, 0.18));
    const barX = paceX + paceW + 34 * k;
    const barW = x1 - timeW - 40 * k - barX;
    const hb = top + labPx;
    const a = mono(e, hKm, x0, hb, labPx, { color: GREY });
    mono(e, hPace, paceX, hb, labPx, { color: GREY });
    const c = mono(e, hTime, x1, hb, labPx, { color: GREY, align: 'right' });
    if (a && c) e.mark('cols', { x: a.x, y: a.y, w: c.x + c.w - a.x, h: a.h });
    rule(ctx, x0, top + headH - 8 * k, x1, top + headH - 8 * k, HAIR, Math.max(1, 1.2 * k));
    const cap = capHeight(ctx, TYPE.brandSB, px);
    const barH = Math.max(3 * k, Math.min(rowH * 0.2, 10 * k));
    rows.forEach((r, i) => {
        const yMid = top + headH + i * rowH + rowH / 2;
        const base = yMid + cap / 2;
        const col = r.best ? e.accent : e.ink;
        const kmPx = fitPx(ctx, r.km, TYPE.mono, px * 0.72, kmW + 20 * k, 0.06);
        drawText(ctx, r.km, TYPE.mono, kmPx, x0, base, { tracking: 0.06, color: r.best ? e.accent : GREY });
        drawText(ctx, r.t, TYPE.brandSB, px, paceX, base, { color: col });
        if (barW > 30 * k) {
            ctx.fillStyle = r.best ? e.accent : DIM;
            ctx.fillRect(barX, yMid - barH / 2, barW * r.bar, barH);
        }
        drawText(ctx, r.elapsed, TYPE.mono, px * 0.72, x1, base, { align: 'right', tracking: 0.04, color: r.best ? e.accent : GREY });
    });
    e.mark('splits', { x: x0, y: top + headH, w: x1 - x0, h: rows.length * rowH });
    return top + headH + rows.length * rowH;
}

// Thin banners: totals left, the splits as standing bars right.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.62, H, 'left', 0.9);
    ctx.fillStyle = 'rgba(10,10,10,0.5)';
    ctx.fillRect(W * 0.46, 0, W * 0.54, H);
    const x0 = safe.l + 4 * tu;
    const y0 = safe.t;
    const y1 = H - safe.b;
    topRow(e, x0, W * 0.42, y0, 44 * tu, { px: 15 * tu });
    const px = Math.min(140 * tu, (y1 - y0) * 0.36);
    totals(e, x0, y0 + 90 * tu, W * 0.19, px, 15 * tu);
    const rows = parse(e).slice(0, 12);
    const cx0 = W * 0.5;
    const cx1 = W - safe.r;
    const n = Math.max(1, rows.length);
    const step = (cx1 - cx0) / n;
    const colW = Math.min(step * 0.56, 40 * tu);
    const labPx = Math.min(16 * tu, step * 0.26);
    const baseY = y1 - labPx * 2;
    const topY = y0 + labPx * 2.6;
    rows.forEach((r, i) => {
        const cx = cx0 + step * (i + 0.5);
        const h = (baseY - topY) * r.bar;
        ctx.fillStyle = r.best ? e.accent : 'rgba(244,241,234,0.4)';
        ctx.fillRect(cx - colW / 2, baseY - h, colW, h);
        drawText(ctx, r.km, TYPE.mono, labPx, cx, y1, { align: 'center', color: r.best ? e.accent : GREY });
        drawText(ctx, r.t, TYPE.mono, labPx, cx, baseY - h - labPx * 0.7, { align: 'center', color: r.best ? e.accent : SOFT });
    });
    if (rows.length) e.mark('splits', { x: cx0, y: y0, w: cx1 - cx0, h: y1 - y0 });
}

// 16:9, 1.91:1: the totals and line left, the table right on a darker panel.
function wide(e) {
    const { ctx, W, H, safe, u } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.6, H, 'left', 0.8);
    e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.5);
    const px0 = W * 0.52;
    ctx.fillStyle = 'rgba(10,10,10,0.66)';
    ctx.fillRect(px0, 0, W - px0, H);
    const x0 = safe.l;
    const y0 = safe.t;
    const y1 = H - safe.b;
    topRow(e, x0, px0 - 60 * u, y0, 56 * u);
    const px = Math.min(170 * u, (y1 - y0) * 0.2);
    const base = totals(e, x0, y0 + (y1 - y0) * 0.3, (px0 - x0 - 60 * u) / 2, px, 17 * u);
    const lPx = 30 * u;
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, String(e.fields.line ?? ''), TYPE.brandR, lPx, px0 - x0 - 60 * u), x0, base + 48 * u + lPx * 0.72, { color: SOFT }));
    e.mark('footer', mono(e, e.fields.footer, x0, y1, 16 * u, { color: GREY, tracking: 0.16 }));
    const rows = parse(e).slice(0, 12);
    const tx0 = px0 + 60 * u;
    const tx1 = W - safe.r;
    const rowH = Math.min(60 * u, (y1 - y0 - 50 * u) / Math.max(1, rows.length));
    const rpx = Math.min(30 * u, rowH * 0.5);
    const tH = rpx * 0.5 * 2.4 + rows.length * rowH;
    table(e, rows, tx0, tx1, y0 + (y1 - y0 - tH) / 2, rowH, rpx);
}

export default {
    id: 'splits',
    name: 'Splits',
    category: 'Move',
    blurb: 'A run or ride read out: distance and time big, the kilometre splits stacked, the fastest in the accent. For run clubs and running kit.',
    refs: 'a running watch’s splits screen',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Sunday long run' },
        { key: 'distance', label: 'Distance', value: '10 km' },
        { key: 'time', label: 'Time', value: '48:14' },
        { key: 'line', label: 'Line', value: 'Negative split, start to finish.' },
        { key: 'splits', label: 'Splits', rows: 8, value: '5:02\n4:58\n4:55\n4:51\n4:49\n4:52\n4:47\n4:44\n4:40\n4:36', hint: 'One per line, first to last: a time (4:58), or a label and a time (5 — 9:12). The fastest lights up; time so far adds itself.' },
        { key: 'cols', label: 'Column heads', value: 'Km · Pace · Time', hint: 'Three words, split with ·' },
        { key: 'footer', label: 'Footer', value: 'Every move counts · powr.life' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Long run (POWR)', fields: { eyebrow: 'Sunday long run', distance: '10 km', time: '48:14', line: 'Negative split, start to finish.', splits: '5:02\n4:58\n4:55\n4:51\n4:49\n4:52\n4:47\n4:44\n4:40\n4:36', cols: 'Km · Pace · Time', footer: 'Every move counts · powr.life' } },
        { name: 'Run club 5K', fields: { eyebrow: 'Thursday club run', distance: '5 km', time: '26:31', line: 'Canal path, 7pm. All paces, every week.', splits: '5:31\n5:22\n5:18\n5:12\n5:08', cols: 'Km · Pace · Time', footer: 'Northside Run Club · Thursdays 7pm' } },
        { name: 'Ride', fields: { eyebrow: 'Saturday ride', distance: '40 km', time: '1:18:20', line: 'Out along the river, back by ten.', splits: '5 — 10:12\n10 — 9:48\n15 — 9:55\n20 — 9:31\n25 — 9:40\n30 — 9:22\n35 — 9:58\n40 — 9:54', cols: 'Km · Split · Time', footer: 'Every move counts · powr.life' } },
        { name: 'Kit test', fields: { eyebrow: 'Race kit, tested', distance: '21.1 km', time: '1:44:52', line: 'Thirteen miles in. Nothing rubbed.', splits: '3 — 15:06\n6 — 14:58\n9 — 14:55\n12 — 14:51\n15 — 14:57\n18 — 14:49\n21.1 — 15:16', cols: 'Km · Split · Time', footer: 'Northside · Race kit' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.12, fade: 0,
        tint: 'cool', tintAmount: 0.35, motion: 0.12, angle: 0, focus: 0.6, vignette: 0.5, grain: 0.5, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), footer: `${r.brand} · ${r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''} in the POWR app` : 'Rewards in the POWR app'}` }),
    },

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        if (e.shape === 'wide') return wide(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.24, 'top', 0.55);
        e.fade(0, H * 0.22, W, H * 0.78, 'bottom', 0.95);

        const headBottom = topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);
        const footBase = H - safe.b - 4 * u;
        e.mark('footer', mono(e, e.fields.footer, x0, footBase, (sq ? 15 : 17) * u, { color: GREY, tracking: 0.16 }));

        const rows = parse(e).slice(0, 12);
        const n = Math.max(1, rows.length);
        const tableBottom = footBase - (sq ? 40 : 54) * u;
        // Stats + line take a fixed band; the table takes what's left.
        const bigPx = (tall ? 190 : sq ? 128 : 160) * u * size;
        const labPx = (sq ? 15 : 17) * u;
        const lPx = (sq ? 26 : 30) * u;
        const statsH = labPx + 18 * u + capHeight(ctx, e.headline, bigPx) + 34 * u + lPx;
        const want = (tall ? 70 : sq ? 44 : 54) * u;
        const room = tableBottom - (headBottom + (tall ? 140 : sq ? 40 : 90) * u) - statsH - 60 * u;
        const rowH = Math.max(28 * u, Math.min(want, (room - 40 * u) / n));
        const rpx = Math.min((tall ? 34 : sq ? 26 : 30) * u, rowH * 0.56);
        const headH = Math.max(11 * u, rpx * 0.5) * 2.4;
        const tableTop = tableBottom - headH - n * rowH;
        const statsTop = tableTop - 60 * u - statsH;
        e.shade({ x: x0, y: statsTop, w: x1 - x0, h: statsH }, { ceiling: 0.26, max: 0.5, spread: 1.1 });
        const base = totals(e, x0, statsTop, (x1 - x0) / 2, bigPx, labPx);
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, String(e.fields.line ?? ''), TYPE.brandR, lPx, x1 - x0), x0, base + 34 * u + lPx * 0.72, { color: SOFT }));
        table(e, rows, x0, x1, tableTop, rowH, rpx);
    },
};
