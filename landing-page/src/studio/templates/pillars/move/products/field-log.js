/**
 * FIELD LOG — the product beside its logbook page: a ruled card with a
 * margin line, what it's been through entered line by line (sessions, km,
 * weeks), a week-by-day grid of the sessions it was worn for, and who
 * tested it, signed in italic. Numbers, not promises. For kit, footwear and
 * wearables brands with a wear test to show (theirs or a member's).
 */
import { TYPE } from '../../../../fonts';
import { drawText, wrapLines } from '../../../../text';
import { rule, dot } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { GREY, SOFT, DIM, HAIR, frame, ground, backdrop, fitPx, makerOf, mono, rrect, rowsOf, seeded, cap } from './_parts';

// "Sessions · 48" → { label, value }. At most 4.
const statsOf = (e) => rowsOf(e.fields.stats).map((c) => ({ label: c[0], value: c.slice(1).join(' ') || '' })).filter((r) => r.label).slice(0, 4);

// Weeks and sessions for the grid, read from the stats.
function gridOf(e, stats) {
    const num = (re) => {
        const r = stats.find((s) => re.test(s.label));
        const n = r ? parseInt(String(r.value).replace(/,/g, ''), 10) : NaN;
        return Number.isFinite(n) ? n : NaN;
    };
    let weeks = num(/week/i);
    if (!Number.isFinite(weeks)) weeks = 12;
    weeks = Math.max(1, Math.min(16, weeks));
    let sessions = num(/session|run|ride|wear|workout|class/i);
    if (!Number.isFinite(sessions)) sessions = Math.round(weeks * 4);
    sessions = Math.max(0, Math.min(weeks * 7, sessions));
    // Spread the sessions across the days, the same way every time for the same words.
    const rnd = seeded(`${e.fields.name}|${sessions}|${weeks}`);
    const days = Array.from({ length: weeks * 7 }, (_, i) => ({ i, r: rnd() + ((i % 7) === 6 ? 0.35 : 0) }));
    const on = new Set(days.sort((a, b) => a.r - b.r).slice(0, sessions).map((d) => d.i));
    return { weeks, on };
}

// The grid: weeks as columns, days as rows, a filled dot per session.
function grid(e, g, x0, x1, top, h) {
    const { ctx } = e;
    const k = frame(e).k;
    const labPx = Math.max(10 * k, Math.min(13 * k, h * 0.07));
    const dayW = labPx * 1.6;
    const colW = (x1 - x0 - dayW) / g.weeks;
    const rowH = (h - labPx * 2) / 7;
    const r = Math.max(2 * k, Math.min(colW, rowH) * 0.3);
    'MTWTFSS'.split('').forEach((d, j) => drawText(ctx, d, TYPE.mono, labPx, x0, top + j * rowH + rowH / 2 + labPx * 0.36, { color: DIM }));
    for (let w = 0; w < g.weeks; w++) {
        const cx = x0 + dayW + colW * (w + 0.5);
        for (let d = 0; d < 7; d++) {
            const cy = top + d * rowH + rowH / 2;
            if (g.on.has(w * 7 + d)) dot(ctx, cx, cy, r, e.accent);
            else dot(ctx, cx, cy, r * 0.42, 'rgba(244,241,234,0.2)');
        }
        if (g.weeks <= 12 || w % 2 === 0) drawText(ctx, `${w + 1}`, TYPE.mono, labPx, cx, top + 7 * rowH + labPx * 1.6, { align: 'center', color: DIM });
    }
    e.mark('stats', { x: x0, y: top, w: x1 - x0, h });
}

/**
 * The logbook card at (x, y, w, h): header, ruled stat lines, the grid, the
 * signature. `s` scales the type.
 */
function card(e, x, y, w, h, s) {
    const { ctx } = e;
    const k = frame(e).k;
    const hair = Math.max(1, 1.2 * k);
    ctx.save();
    rrect(ctx, x, y, w, h, 22 * k);
    ctx.fillStyle = 'rgba(18,18,17,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.14)';
    ctx.lineWidth = hair;
    ctx.stroke();
    ctx.restore();
    const pad = 40 * k * s;
    const mx = x + pad * 1.5;
    // The margin line, as in a logbook.
    rule(ctx, mx - pad * 0.6, y + pad * 0.5, mx - pad * 0.6, y + h - pad * 0.5, e.accent, Math.max(1, 1.6 * k));
    const x1 = x + w - pad;
    const labPx = 15 * k * s;
    let yy = y + pad + labPx;
    e.mark('logLabel', mono(e, e.fields.logLabel, mx, yy, labPx, { color: GREY, maxW: (x1 - mx) * 0.55 }));
    e.mark('period', mono(e, e.fields.period, x1, yy, labPx, { align: 'right', color: SOFT, maxW: (x1 - mx) * 0.42 }));
    yy += 26 * k * s;
    rule(ctx, mx - pad * 1.2, yy, x + w, yy, HAIR, hair);
    const stats = statsOf(e);
    // Signature at the foot; stats and the grid share what's between.
    const sigPx = 36 * k * s;
    const sig = String(e.fields.tester ?? '').trim();
    const sl = sig ? wrapLines(ctx, sig, TYPE.serifI, sigPx, x1 - mx, 2) : [];
    const sigTop = y + h - pad - sl.length * sigPx * 1.1;
    const avail = (sl.length ? sigTop - 30 * k * s : y + h - pad) - yy;
    const g = gridOf(e, stats);
    const cell = (x1 - mx) / (g.weeks + 1.6);
    const gNat = Math.min((x1 - mx) * 0.9, avail * 0.5, cell * 7.9);
    const rowH = stats.length ? Math.max(60 * k * s, Math.min(150 * k * s, (avail - gNat - 40 * k * s) / stats.length)) : 0;
    const vPx = Math.min(rowH * 0.6, 90 * k * s);
    stats.forEach((st) => {
        const base = yy + rowH * 0.5 + cap(e, TYPE.brandL, vPx) / 2;
        drawText(ctx, e.caps(st.label), TYPE.mono, labPx, mx, yy + rowH * 0.5 + labPx * 0.36, { tracking: 0.16, color: GREY });
        drawText(ctx, st.value, TYPE.brandL, fitPx(ctx, st.value, TYPE.brandL, vPx, (x1 - mx) * 0.6), x1, base, { align: 'right', color: e.ink, tracking: -0.02 });
        yy += rowH;
        rule(ctx, mx - pad * 1.2, yy, x + w, yy, HAIR, hair);
    });
    if (stats.length) e.mark('stats', { x: mx, y: yy - rowH * stats.length, w: x1 - mx, h: rowH * stats.length });
    sl.forEach((l, i) => {
        const b = drawText(ctx, l, TYPE.serifI, sigPx, mx, sigTop + sigPx * 0.8 + i * sigPx * 1.1, { color: SOFT });
        e.mark('tester', b);
    });
    const gTop = yy + 34 * k * s;
    const gH = (sl.length ? sigTop - 30 * k * s : y + h - pad) - gTop;
    if (gH > 70 * k * s) grid(e, g, mx, x1, gTop, Math.min(gH, gNat));
}

export default {
    id: 'move-field-log',
    name: 'Field Log',
    category: 'Move',
    section: 'Products',
    blurb: 'The product beside its logbook page: sessions, km and weeks it was worn for, a day-by-day grid of the sessions, signed by whoever tested it. For kit and wearables with a wear test.',
    refs: 'a pilot’s logbook page',
    headlineFont: 'brandSB',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Wear test' },
        { key: 'name', label: 'Product name', value: 'Tempo runner' },
        { key: 'logLabel', label: 'Log label', value: 'Field log · No. 07' },
        { key: 'period', label: 'Period', value: 'Jun – Sep 2026' },
        { key: 'stats', label: 'Log', rows: 4, value: 'Sessions · 48\nDistance · 212 km\nWeeks · 12', hint: 'One per line: label · value. Up to four. "Sessions" and "Weeks" fill the grid.' },
        { key: 'tester', label: 'Signed', value: 'Worn by the Northside run crew' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Trainer', fields: { eyebrow: 'Wear test', name: 'Tempo runner', logLabel: 'Field log · No. 07', period: 'Jun – Sep 2026', stats: 'Sessions · 48\nDistance · 212 km\nWeeks · 12', tester: 'Worn by the Northside run crew' } },
        { name: 'Leggings', fields: { eyebrow: 'In the studio', name: 'Studio tight', logLabel: 'Field log · No. 03', period: 'Eight weeks', stats: 'Classes · 31\nWashes · 24\nWeeks · 8', tester: 'Worn by our design team' } },
        { name: 'Watch', fields: { eyebrow: 'Kit check', name: 'Pace 2', logLabel: 'Field log · No. 12', period: 'Summer 2026', stats: 'Sessions · 64\nHours · 71\nKm · 402\nWeeks · 14', tester: 'Worn by a POWR member' } },
        { name: 'Bag', fields: { eyebrow: 'Carried daily', name: 'Kit holdall', logLabel: 'Field log · No. 02', period: '2025 – 2026', stats: 'Gym visits · 96\nWeeks · 16', tester: 'Carried by the Northside coaches' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r) }),
    },

    draw(e) {
        const f = frame(e);
        const { ctx, W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const opts = { kind: 'box', label: makerOf(e), sub: e.fields.name };

        if (strip) {
            const pw = W * 0.2;
            ground(e, { cx: x0 + pw / 2, cy: H * 0.55, r: H * 0.8 });
            backdrop(e);
            productShot(e, { x: x0, y: y0, w: pw, h: y1 - y0 }, opts);
            const tx = x0 + pw + 50 * k;
            lockup(e, tx, y0, 34 * k, { maxW: W * 0.2 });
            const nPx = 48 * k;
            const nm = String(e.fields.name ?? '').trim();
            e.mark('name', drawText(ctx, nm, e.headline, fitPx(ctx, nm, e.headline, nPx, W * 0.24), tx, y1 - 40 * k, { color: e.ink, tracking: -0.02 }));
            e.mark('eyebrow', mono(e, e.fields.eyebrow, tx, y1, 13 * k, { color: SOFT, maxW: W * 0.24 }));
            const cx = W * 0.5;
            card(e, cx, y0, x1 - cx, y1 - y0, 0.62);
            return;
        }

        const lh = (sq ? 46 : 54) * k;
        const side = !tall;
        let pBox;
        let c;
        if (side) {
            const pw = (x1 - x0) * (wide ? 0.4 : sq ? 0.4 : 0.4);
            const top = y0 + lh + (sq ? 30 : 50) * k;
            const nPx = (wide ? 60 : sq ? 44 : 52) * k;
            pBox = { x: x0, y: top + nPx * 1.6, w: pw - 20 * k, h: y1 - top - nPx * 1.6 };
            c = { x: x0 + pw + 30 * k, y: top, w: x1 - x0 - pw - 30 * k, h: y1 - top };
            ground(e, { cx: x0 + pw / 2, cy: pBox.y + pBox.h * 0.6, r: Math.max(pw, pBox.h * 0.6) });
            backdrop(e);
            productShot(e, pBox, opts);
            const nm = String(e.fields.name ?? '').trim();
            const lines = wrapLines(ctx, nm, e.headline, nPx, pw - 30 * k, 2);
            lines.forEach((l, i) => e.mark('name', drawText(ctx, l, e.headline, fitPx(ctx, l, e.headline, nPx, pw - 30 * k), x0, top + cap(e, e.headline, nPx) + i * nPx * 1.05, { color: e.ink, tracking: -0.02 })));
            card(e, c.x, c.y, c.w, c.h, wide ? 1 : sq ? 0.74 : 0.82);
        } else {
            const cardH = (y1 - y0) * 0.54;
            const top = y0 + lh + 60 * k;
            const nPx = 76 * k;
            pBox = { x: x0 + (x1 - x0) * 0.2, y: top + nPx * 1.5, w: (x1 - x0) * 0.6, h: y1 - cardH - 50 * k - top - nPx * 1.5 };
            ground(e, { cx: W / 2, cy: pBox.y + pBox.h * 0.6, r: W * 0.55 });
            backdrop(e);
            productShot(e, pBox, opts);
            const nm = String(e.fields.name ?? '').trim();
            e.mark('name', drawText(ctx, nm, e.headline, fitPx(ctx, nm, e.headline, nPx, x1 - x0), x0, top + cap(e, e.headline, nPx), { color: e.ink, tracking: -0.02 }));
            card(e, x0, y1 - cardH, x1 - x0, cardH, 1.08);
        }
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, (sq ? 16 : 18) * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
    },
};
