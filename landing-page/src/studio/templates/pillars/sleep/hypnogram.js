/**
 * HYPNOGRAM — one night as a tracker draws it: four rows (Awake · REM ·
 * Light · Deep), the night stepping between them from bedtime to waking, an
 * hour axis under it, and the time asleep set big and thin above. The stages
 * are a string of letters, one per slot of the night, so any night can be
 * typed in. For sleep trackers and wearables; POWR posts it as a recap.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, DIM, HAIR, backdrop, fadeTo, label, line, parseClock, clock, span, rrect } from './_parts';

const ROWS = [
    { id: 'A', name: 'Awake', tone: 'rgba(244,241,234,0.42)' },
    { id: 'R', name: 'REM', tone: 'rgba(244,241,234,0.92)' },
    { id: 'L', name: 'Light', tone: 'rgba(244,241,234,0.66)' },
    { id: 'D', name: 'Deep', tone: INK },
];

const stagesOf = (s) => [...String(s ?? '').toUpperCase()].map((c) => (c === 'W' ? 'A' : c)).filter((c) => 'ARLD'.includes(c));

// The chart in `box`: row names in a left gutter, the night, an hour axis.
function chart(e, box, k, px) {
    const { ctx } = e;
    const st = stagesOf(e.fields.stages);
    const bed = parseClock(e.fields.bed) ?? 23 * 60;
    const len = span(bed, parseClock(e.fields.wake) ?? 7 * 60) || 480;
    const a0 = Math.floor(bed / 60) * 60;
    const a1 = Math.ceil((bed + len) / 60) * 60;
    const names = ROWS.map((r) => e.caps(r.name));
    const gut = Math.max(...names.map((n) => textWidth(ctx, n, TYPE.mono, px, 0.14))) + 26 * k;
    const px0 = box.x + gut;
    const px1 = box.x + box.w;
    const axisH = px * 2.6;
    const top = box.y;
    const bottom = box.y + box.h - axisH;
    const step = (bottom - top) / ROWS.length;
    const rowY = (i) => top + (i + 0.5) * step;
    const X = (m) => px0 + ((m - a0) / (a1 - a0)) * (px1 - px0);
    const hi = e.look.highlight ?? 'D';

    // Rows: a name and a faint dotted rule each.
    ROWS.forEach((r, i) => {
        drawTextRow(e, names[i], px, box.x, rowY(i) + px * 0.36, r.id === hi ? e.accent : MUTED);
        ctx.save();
        ctx.setLineDash([1.5 * k, 7 * k]);
        rule(ctx, px0, rowY(i), px1, rowY(i), HAIR, 1.5 * k);
        ctx.restore();
    });

    // Hour axis: a tick every hour, a label as often as the width allows.
    const hours = (a1 - a0) / 60;
    const lw = textWidth(ctx, '00:00', TYPE.mono, px, 0.06);
    const every = [1, 2, 3, 4].find((n) => ((px1 - px0) / hours) * n > lw * 1.7) ?? 4;
    rule(ctx, px0, bottom + 2 * k, px1, bottom + 2 * k, HAIR, 1.5 * k);
    let axis = null;
    for (let h = 0; h <= hours; h++) {
        const x = X(a0 + h * 60);
        rule(ctx, x, bottom + 2 * k, x, bottom + 10 * k, DIM, 1.5 * k);
        if (h % every) continue;
        const align = h === 0 ? 'left' : h === hours ? 'right' : 'center';
        const b = line(e, null, clock(a0 + h * 60), TYPE.mono, px, x, bottom + axisH * 0.78, { align, tracking: 0.06, color: MUTED });
        axis = axis ? { x: Math.min(axis.x, b.x), y: axis.y, w: Math.max(axis.x + axis.w, b.x + b.w) - Math.min(axis.x, b.x), h: axis.h } : b;
    }
    e.mark('bed', axis);
    e.mark('wake', axis);

    if (!st.length) return;
    // Runs of one stage; each a rounded bar on its row, joined by hairlines.
    const runs = [];
    st.forEach((c, i) => {
        const last = runs[runs.length - 1];
        if (last && last.id === c) last.n += 1;
        else runs.push({ id: c, from: i, n: 1 });
    });
    const slot = len / st.length;
    const barH = Math.min(step * 0.42, 24 * k);
    const row = (id) => ROWS.findIndex((r) => r.id === id);
    ctx.save();
    ctx.strokeStyle = 'rgba(244,241,234,0.34)';
    ctx.lineWidth = 1.5 * k;
    runs.forEach((r, i) => {
        if (!i) return;
        const x = X(bed + r.from * slot);
        ctx.beginPath();
        ctx.moveTo(x, rowY(row(runs[i - 1].id)));
        ctx.lineTo(x, rowY(row(r.id)));
        ctx.stroke();
    });
    ctx.restore();
    runs.forEach((r) => {
        const i = row(r.id);
        const xa = X(bed + r.from * slot);
        const xb = X(bed + (r.from + r.n) * slot);
        ctx.fillStyle = r.id === hi ? e.accent : ROWS[i].tone;
        rrect(ctx, xa, rowY(i) - barH / 2, Math.max(xb - xa, barH * 0.6), barH, barH / 2);
        ctx.fill();
    });
    e.mark('stages', { x: px0, y: top, w: px1 - px0, h: bottom - top });
}

function drawTextRow(e, text, px, x, y, color) {
    line(e, null, text, TYPE.mono, px, x, y, { tracking: 0.14, color });
}

// Eyebrow, then the big total, then "23:10 – 06:58" — bottom-up from `base`.
function readout(e, x, base, maxW, maxH, k, ePx, { right } = {}) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const block = fitBlock(ctx, [String(e.fields.total ?? '')], e.headline, { maxW: maxW * size, maxH: maxH * size, tracking: -0.01 });
    const top = base - block.cap;
    e.shade({ x, y: top, w: maxW, h: block.cap }, { ceiling: 0.26, max: 0.6 });
    const boxes = drawBlock(ctx, block, e.headline, x, top, { align: 'left', tracking: -0.01, color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('total', blockBox(boxes));
    const eBase = top - 28 * k;
    label(e, 'eyebrow', e.fields.eyebrow, ePx, x, eBase, { maxW: right ? maxW * 0.55 : maxW, color: SOFT });
    const times = `${clock(parseClock(e.fields.bed) ?? 0)} – ${clock(parseClock(e.fields.wake) ?? 0)}`;
    if (right) line(e, null, times, TYPE.mono, ePx, right, eBase, { align: 'right', tracking: 0.1, color: MUTED });
    return eBase - ePx;
}

function band(e) {
    const { ctx, W, H, safe, shape } = e;
    const k = e.tu;
    const strip = shape === 'strip';
    const pw = W * (strip ? 0.4 : 0.44);
    backdrop(e, { x: 0, y: 0, w: pw, h: H }, { optional: true, glow: { x: 0.2, y: 0.2 } });
    if (e.hasMedia) {
        fadeTo(ctx, pw * 0.45, 0, pw * 0.55 + 1, H, 'right', 1);
        e.fade(0, H * 0.3, pw, H * 0.7, 'bottom', 0.75);
        e.fade(0, 0, pw, H * 0.3, 'top', 0.4);
    }
    const x0 = safe.l + 4 * k;
    const colW = W * (strip ? 0.3 : 0.34);
    lockup(e, x0, safe.t + 4 * k, (strip ? 30 : 36) * k, { maxW: colW });
    const ePx = (strip ? 14 : 16) * k;
    const base = H - safe.b - (strip ? 2 : 8) * k - ePx * 2.2;
    readout(e, x0, base, colW, H * (strip ? 0.26 : 0.2), k, ePx);
    const tBase = base + ePx * 2.2;
    const times = `${clock(parseClock(e.fields.bed) ?? 0)} – ${clock(parseClock(e.fields.wake) ?? 0)}`;
    line(e, null, times, TYPE.mono, ePx, x0, tBase, { tracking: 0.1, color: MUTED });
    if (!strip) label(e, 'date', e.fields.date, ePx, x0, safe.t + 4 * k + 36 * k + 50 * k, { maxW: colW, color: MUTED });
    const cx = x0 + colW + (strip ? 60 : 80) * k;
    chart(e, { x: cx, y: safe.t + (strip ? 8 : 20) * k, w: W - safe.r - cx, h: H - safe.t - safe.b - (strip ? 8 : 20) * k }, k, (strip ? 13 : 15) * k);
}

export default {
    id: 'hypnogram',
    name: 'Hypnogram',
    category: 'Sleep',
    blurb: 'One night as a tracker draws it: Awake, REM, Light and Deep across the hours, the time asleep big.',
    refs: 'a sleep tracker’s night view',
    headlineFont: 'brandXL',
    photo: 'optional',
    fields: [
        { key: 'date', label: 'Date (top right)', value: 'Sun 12 Oct' },
        { key: 'eyebrow', label: 'Eyebrow', value: 'Last night · Time asleep' },
        { key: 'total', label: 'Time asleep', value: '7h 22m', hint: 'One person’s night: edit it to match.' },
        { key: 'bed', label: 'Asleep from', value: '23:10' },
        { key: 'wake', label: 'Awake at', value: '06:58' },
        { key: 'stages', label: 'Stages', rows: 2, value: 'ALLDDDLLDDLRLLDLLRRLLDLRRLLLRRRLARRLA', hint: 'One letter per slot of the night, bedtime to waking: A awake · R REM · L light · D deep.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Last night', fields: { date: 'Sun 12 Oct', eyebrow: 'Last night · Time asleep', total: '7h 22m', bed: '23:10', wake: '06:58' } },
        { name: 'Tracker', fields: { date: 'Night 214', eyebrow: 'Tracked overnight', total: '6h 51m', bed: '23:48', wake: '07:05', stages: 'ALLLDDLDDLLRLLLDLRRLALLRLRRLLRRA' }, style: { accent: '#9DB8FF' } },
        { name: 'Weekend', fields: { date: 'Sat 18 Oct', eyebrow: 'Saturday · Time asleep', total: '8h 34m', bed: '22:40', wake: '07:30', stages: 'ALLDDDDLLDDLRRLLDLLRRLLDLRRRLLRRRLLRRRA' } },
        { name: 'Mattress', fields: { date: 'Night one', eyebrow: 'First night on the new mattress', total: '7h 48m', bed: '22:55', wake: '06:52' }, style: { accent: '#C9B79C' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.8, tintAmount: 0.6, highlight: 'D' },
    controls: [
        { key: 'highlight', label: 'Accent row', options: [['D', 'Deep'], ['R', 'REM'], ['L', 'Light'], ['none', 'None']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return band(e);
        const { ctx, W, H, u: k, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x0 = safe.l + 8 * k;
        const x1 = W - safe.r - 8 * k;
        const ph = H * (tall ? 0.52 : sq ? 0.5 : 0.56);
        backdrop(e, { x: 0, y: 0, w: W, h: ph }, { optional: true });
        if (e.hasMedia) {
            fadeTo(ctx, 0, ph * 0.3, W, ph * 0.7 + 1, 'bottom', 1);
            e.fade(0, 0, W, H * 0.2, 'top', 0.5);
        }

        const lh = 40 * k;
        const lk = lockup(e, x0, safe.t + 6 * k, lh, { maxW: (x1 - x0) * 0.62 });
        label(e, 'date', e.fields.date, 17 * k, x1, lk.y + lk.h / 2 + 6 * k, { align: 'right', maxW: (x1 - x0) * 0.32, color: SOFT });

        const ePx = (sq ? 16 : 18) * k;
        const bottom = H - safe.b - 2 * k;
        const ch = (H - safe.t - safe.b) * (tall ? 0.3 : sq ? 0.34 : 0.33);
        const cTop = bottom - ch;
        chart(e, { x: x0, y: cTop, w: x1 - x0, h: ch }, k, (sq ? 14 : 16) * k);
        readout(e, x0, cTop - (sq ? 56 : 72) * k, (x1 - x0) * 0.86, H * (tall ? 0.1 : sq ? 0.13 : 0.12), k, ePx, { right: x1 });
    },
};
