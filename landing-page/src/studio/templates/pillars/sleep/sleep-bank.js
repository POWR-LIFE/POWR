/**
 * SLEEP BANK — the week as a ledger: seven bars against a dashed target
 * line, nights under it in dim ink and nights at or over it in the accent,
 * with the week's total and the gap to target set like a balance. For
 * trackers and bedding brands, and POWR's weekly numbers.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, HAIR, backdrop, wash, fadeTo, label, line, parseNights, parseDur, dur, readable } from './_parts';

function sums(e) {
    const nights = parseNights(e.fields.nights);
    const target = parseDur(e.fields.target) ?? 480;
    const total = nights.reduce((a, n) => a + n.min, 0);
    const need = target * nights.length;
    const diff = total - need;
    const gap = diff === 0 ? 'On target' : `${dur(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'}`;
    return { nights, target, total: String(e.fields.total ?? '').trim() || dur(total), need, gap };
}

// A figure: a mono label over a big thin number (cap top at `top`).
function figure(e, labKey, key, lab, value, x, top, maxW, maxH, k, px, { align = 'left', color = INK, spec } = {}) {
    const { ctx } = e;
    label(e, labKey, lab, px, x, top + px * 0.72, { align, maxW, color: SOFT });
    const size = e.look.size ?? 1;
    const block = fitBlock(ctx, [value], spec ?? e.headline, { maxW: maxW * size, maxH: maxH * size, tracking: -0.01 });
    const nTop = top + px + 24 * k;
    const boxes = drawBlock(ctx, block, spec ?? e.headline, x, nTop, { align, tracking: -0.01, color, accent: e.accent });
    if (key) e.mark(key, blockBox(boxes));
    return nTop + block.cap;
}

// Slim bars in `box` — each night's day and hours under it — and a dashed
// target line across them, labelled in a gutter at its right end.
function bars(e, box, k, { dayPx, valPx }) {
    const { ctx } = e;
    const { nights, target } = sums(e);
    const n = nights.length;
    if (!n) return;
    const tl = e.caps(e.fields.targetLabel).trim();
    const tv = dur(target).replace(/ 00m$/, '');
    const gutter = Math.max(textWidth(ctx, tl, TYPE.mono, dayPx, 0.14), textWidth(ctx, tv, TYPE.brandL, dayPx * 1.9, 0)) + 30 * k;
    const x1 = box.x + box.w - gutter;
    const top = box.y;
    const bottom = box.y + box.h - dayPx * 1.6 - valPx * 1.6 - 34 * k;
    const maxMin = Math.max(target * 1.15, ...nights.map((v) => v.min));
    const Y = (m) => bottom - (m / maxMin) * (bottom - top);
    const colW = (x1 - box.x) / n;
    const bw = Math.min(colW * 0.2, 26 * k);
    const lit = readable(e.accent);
    rule(ctx, box.x, bottom, x1, bottom, HAIR, 1.5 * k);
    nights.forEach((v, i) => {
        const cx = box.x + colW * (i + 0.5);
        const over = v.min >= target;
        const y = Y(v.min);
        ctx.fillStyle = over ? e.accent : 'rgba(244,241,234,0.3)';
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2, bottom);
        ctx.lineTo(cx - bw / 2, y + bw / 2);
        ctx.arc(cx, y + bw / 2, bw / 2, Math.PI, 0);
        ctx.lineTo(cx + bw / 2, bottom);
        ctx.closePath();
        ctx.fill();
        const dBase = bottom + 22 * k + dayPx * 0.72;
        line(e, null, e.caps(v.day), TYPE.mono, dayPx, cx, dBase, { align: 'center', tracking: 0.14, color: MUTED, maxW: colW - 6 * k });
        line(e, null, dur(v.min).replace(/ /g, ''), TYPE.brandR, valPx, cx, dBase + 12 * k + valPx, { align: 'center', color: over ? lit : SOFT, maxW: colW - 6 * k });
    });
    e.mark('nights', { x: box.x, y: top, w: x1 - box.x, h: box.y + box.h - top });
    const ty = Y(target);
    ctx.save();
    ctx.setLineDash([8 * k, 8 * k]);
    rule(ctx, box.x, ty, x1 + 10 * k, ty, 'rgba(244,241,234,0.7)', 1.5 * k);
    ctx.restore();
    const gx = x1 + 22 * k;
    e.mark('targetLabel', line(e, null, tl, TYPE.mono, dayPx, gx, ty - 10 * k, { tracking: 0.14, color: MUTED }));
    e.mark('target', line(e, null, tv, TYPE.brandL, dayPx * 1.9, gx, ty + 10 * k + dayPx * 1.9 * 0.72, { color: INK }));
}

export default {
    id: 'sleep-bank',
    name: 'Sleep Bank',
    category: 'Sleep',
    blurb: 'The week as a ledger: seven bars against a target line, the total and the gap set like a balance.',
    refs: 'a bank statement',
    headlineFont: 'brandXL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Total label', value: 'Banked this week' },
        { key: 'total', label: 'Total', value: '', hint: 'Leave empty to add up the nights.' },
        { key: 'gapLabel', label: 'Gap label', value: 'Against target' },
        { key: 'nights', label: 'Nights', rows: 7, value: 'Mon — 7h 10m\nTue — 6h 25m\nWed — 8h 05m\nThu — 7h 40m\nFri — 6h 05m\nSat — 8h 50m\nSun — 8h 15m', hint: 'One per line: day — hours. One person’s week: edit to match.' },
        { key: 'target', label: 'Nightly target', value: '8h' },
        { key: 'targetLabel', label: 'Target label', value: 'Target' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'The week', fields: { eyebrow: 'Banked this week', target: '8h' } },
        { name: 'Tracker', fields: { eyebrow: 'Week 41 · Time asleep', target: '7h 30m', nights: 'Mon — 7h 02m\nTue — 7h 41m\nWed — 6h 48m\nThu — 7h 35m\nFri — 6h 20m\nSat — 8h 12m\nSun — 7h 55m' }, style: { accent: '#9DB8FF' } },
        { name: 'Mattress trial', fields: { eyebrow: 'First week on the new bed', target: '8h', gapLabel: 'Against an 8h night', nights: 'N1 — 7h 30m\nN2 — 7h 48m\nN3 — 8h 10m\nN4 — 7h 55m\nN5 — 8h 20m\nN6 — 8h 35m\nN7 — 8h 05m' }, style: { accent: '#C9B79C' } },
        { name: 'POWR week', fields: { eyebrow: 'Trained five. Slept seven.', target: '7h 30m' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.9, target: 0.18, tintAmount: 0.7 },
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const y0 = safe.t + 4 * k;
        const y1 = H - safe.b - 4 * k;
        backdrop(e, null, { optional: true, glow: { x: 0.2, y: 0.1 } });
        if (e.hasMedia) {
            wash(ctx, 0, 0, W, H, 0.5);
            fadeTo(ctx, 0, H * 0.35, W, H * 0.65, 'bottom', 0.75);
        }
        const s = sums(e);
        const gapColor = SOFT;

        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const colW = W * (strip ? 0.26 : 0.3);
            lockup(e, x0, y0, (strip ? 28 : 36) * k, { maxW: colW });
            const px = (strip ? 13 : 16) * k;
            const top = y0 + (strip ? 70 : 130) * k;
            const nb = figure(e, 'eyebrow', 'total', e.fields.eyebrow, s.total, x0, top, colW, (y1 - y0) * (strip ? 0.22 : 0.18), k, px);
            if (!strip) figure(e, 'gapLabel', 'nights', e.fields.gapLabel, s.gap, x0, nb + 60 * k, colW, (y1 - y0) * 0.1, k, px, { color: gapColor, spec: TYPE.brandL });
            else line(e, 'nights', `${s.gap} · ${String(e.fields.gapLabel ?? '').toLowerCase()}`, TYPE.brandL, 22 * k, x0, nb + 44 * k, { color: gapColor, maxW: colW });
            const bx = x0 + colW + (strip ? 50 : 90) * k;
            bars(e, { x: bx, y: y0 + (strip ? 10 : 40) * k, w: x1 - bx, h: y1 - y0 - (strip ? 10 : 40) * k }, k, { dayPx: (strip ? 13 : 16) * k, valPx: (strip ? 17 : 24) * k });
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        lockup(e, x0, y0, 40 * k, { maxW: (x1 - x0) * 0.6 });
        const px = (sq ? 15 : 17) * k;
        const top = y0 + (sq ? 90 : tall ? 150 : 120) * k;
        const fh = H * (tall ? 0.07 : sq ? 0.09 : 0.085);
        figure(e, 'eyebrow', 'total', e.fields.eyebrow, s.total, x0, top, (x1 - x0) * 0.5, fh * 1.35, k, px);
        figure(e, 'gapLabel', 'nights', e.fields.gapLabel, s.gap, x1, top, (x1 - x0) * 0.36, fh * 0.7, k, px, { align: 'right', color: gapColor, spec: TYPE.brandL });
        const cTop = top + px + 24 * k + fh * 1.35 + (sq ? 50 : tall ? 140 : 90) * k;
        bars(e, { x: x0, y: cTop, w: x1 - x0, h: y1 - cTop - (tall ? 30 : 0) * k }, k, { dayPx: (sq ? 15 : 17) * k, valPx: (sq ? 22 : 27) * k });
    },
};
