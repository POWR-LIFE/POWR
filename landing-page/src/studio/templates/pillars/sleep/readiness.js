/**
 * READINESS — the morning score a wearable gives you: a big thin number in a
 * semicircle gauge, the arc filled to it in the accent, and two or three of
 * the numbers behind it in small type. Always "your score": it shows the
 * number, never what it means for you. For wearables and recovery brands.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, splitLines, capHeight } from '../../../text';
import { rule, dot } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, HAIR, backdrop, wash, fadeTo, label, line } from './_parts';

const parseStats = (text) => splitLines(text).slice(0, 3).map((l) => {
    const m = l.trim().match(/^(.*?)\s*[—–|:]\s*(.+)$/);
    return m ? { name: m[1], value: m[2] } : { name: '', value: l.trim() };
}).filter((s) => s.name || s.value);

const scoreOf = (e) => {
    const n = parseFloat(String(e.fields.score ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 0;
};

// The gauge: a half ring on (cx, cy) of centre-line radius R, the score in
// it sitting on cy, its label under. Returns the bottom of the label.
function gauge(e, cx, cy, R, k, { labelPx }) {
    const { ctx } = e;
    const tw = Math.max(8 * k, R * 0.075);
    const f = scoreOf(e);
    e.shade({ x: cx - R * 0.7, y: cy - R * 0.75, w: R * 1.4, h: R * 0.9 }, { ceiling: 0.2, max: 0.55, spread: 1.2 });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = tw;
    ctx.strokeStyle = 'rgba(244,241,234,0.1)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
    ctx.stroke();
    if (f > 0) {
        ctx.strokeStyle = e.accent;
        ctx.beginPath();
        ctx.arc(cx, cy, R, Math.PI, Math.PI + Math.PI * f);
        ctx.stroke();
    }
    // Ticks outside the ring: every 5, the tens longer.
    ctx.lineCap = 'butt';
    for (let i = 0; i <= 20; i++) {
        const a = Math.PI + (i / 20) * Math.PI;
        const r0 = R + tw / 2 + 12 * k;
        const r1 = r0 + (i % 2 ? R * 0.03 : R * 0.06);
        ctx.strokeStyle = i / 20 <= f + 0.001 ? 'rgba(244,241,234,0.7)' : 'rgba(244,241,234,0.28)';
        ctx.lineWidth = (i % 2 ? 1.3 : 2) * k;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
    }
    ctx.restore();
    // The end of the fill: a small ink bead on the accent.
    const a = Math.PI + Math.PI * f;
    dot(ctx, cx + Math.cos(a) * R, cy + Math.sin(a) * R, tw * 0.28, '#0E1015');

    const mPx = Math.max(11 * k, labelPx * 0.85);
    line(e, null, '0', TYPE.mono, mPx, cx - R, cy + tw / 2 + 12 * k + mPx, { align: 'center', color: MUTED });
    line(e, null, '100', TYPE.mono, mPx, cx + R, cy + tw / 2 + 12 * k + mPx, { align: 'center', color: MUTED });

    const size = e.look.size ?? 1;
    const inner = R - tw / 2;
    const block = fitBlock(ctx, [String(e.fields.score ?? '')], e.headline, { maxW: inner * 1.25 * size, maxH: inner * 0.62 * size, tracking: -0.02 });
    const heads = drawBlock(ctx, block, e.headline, cx, cy - block.cap, { align: 'center', tracking: -0.02, color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('score', blockBox(heads));
    const lb = cy + tw / 2 + 12 * k + labelPx * 1.1;
    label(e, 'scoreLabel', e.fields.scoreLabel, labelPx, cx, lb, { align: 'center', maxW: R * 1.5, color: SOFT });
    return lb;
}

// Stats as columns: a mono name over a light value, hairlines between.
function columns(e, x, x1, top, k, { namePx, valPx }) {
    const { ctx } = e;
    const stats = parseStats(e.fields.stats);
    if (!stats.length) return;
    const colW = (x1 - x) / stats.length;
    rule(ctx, x, top, x1, top, HAIR, 1.5 * k);
    const cap = capHeight(ctx, TYPE.brandL, valPx);
    let box = null;
    stats.forEach((s, i) => {
        const cx = x + i * colW + (i ? 28 * k : 0);
        if (i) rule(ctx, x + i * colW, top + 22 * k, x + i * colW, top + 22 * k + namePx + 24 * k + cap, HAIR, 1.5 * k);
        const a = label(e, null, s.name, namePx, cx, top + 30 * k + namePx * 0.72, { maxW: colW - 40 * k, color: MUTED });
        const b = line(e, null, s.value, TYPE.brandL, valPx, cx, top + 30 * k + namePx + 24 * k + cap, { maxW: colW - 40 * k, color: INK });
        [a, b].forEach((q) => { if (q) box = box ? { x: Math.min(box.x, q.x), y: Math.min(box.y, q.y), w: Math.max(box.x + box.w, q.x + q.w) - Math.min(box.x, q.x), h: Math.max(box.y + box.h, q.y + q.h) - Math.min(box.y, q.y) } : q; });
    });
    e.mark('stats', box);
    return top + 30 * k + namePx + 24 * k + cap;
}

// Stats as a table: name left, value right, one per row.
function table(e, x, x1, top, bottom, k, { namePx, valPx }) {
    const { ctx } = e;
    const stats = parseStats(e.fields.stats);
    if (!stats.length) return;
    const rowH = Math.min((bottom - top) / stats.length, valPx * 2.6);
    top += Math.max(0, (bottom - top - rowH * stats.length) / 2);
    const cap = capHeight(ctx, TYPE.brandL, valPx);
    let box = null;
    stats.forEach((s, i) => {
        const y = top + i * rowH;
        rule(ctx, x, y, x1, y, HAIR, 1.5 * k);
        const base = y + rowH / 2 + cap / 2;
        const b = line(e, null, s.value, TYPE.brandL, valPx, x1, base, { align: 'right', color: INK, maxW: (x1 - x) * 0.55 });
        const a = label(e, null, s.name, namePx, x, y + rowH / 2 + namePx * 0.36, { maxW: (x1 - x) * 0.4, color: SOFT });
        [a, b].forEach((q) => { if (q) box = box ? { x: Math.min(box.x, q.x), y: Math.min(box.y, q.y), w: Math.max(box.x + box.w, q.x + q.w) - Math.min(box.x, q.x), h: Math.max(box.y + box.h, q.y + q.h) - Math.min(box.y, q.y) } : q; });
    });
    rule(ctx, x, top + stats.length * rowH, x1, top + stats.length * rowH, HAIR, 1.5 * k);
    e.mark('stats', box);
}

export default {
    id: 'readiness',
    name: 'Readiness',
    category: 'Sleep',
    blurb: 'A morning score in a semicircle gauge, with the numbers behind it in small type. For wearables.',
    refs: 'a wearable’s morning screen',
    headlineFont: 'brandXL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'This morning' },
        { key: 'score', label: 'Score (out of 100)', value: '86' },
        { key: 'scoreLabel', label: 'Score label', value: 'Your readiness score' },
        { key: 'stats', label: 'Numbers', rows: 3, value: 'Resting HR — 52 bpm\nHRV — 64 ms\nSleep — 7h 38m', hint: 'Up to three, one per line: name — value. One person’s morning: edit to match.' },
        { key: 'line', label: 'Line', value: 'Your number. Your call.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Morning', fields: { eyebrow: 'This morning', score: '86', scoreLabel: 'Your readiness score' } },
        { name: 'Wearable', fields: { eyebrow: 'Monday · 06:42', score: '74', scoreLabel: 'Recovery score', stats: 'Resting HR — 55 bpm\nHRV — 58 ms\nTime asleep — 6h 54m', line: 'Read it, then decide.' }, style: { accent: '#7FE0C2' } },
        { name: 'Rest day', fields: { eyebrow: 'Rest day', score: '91', scoreLabel: 'Your score today', stats: 'Sleep — 8h 16m\nResting HR — 49 bpm', line: 'A rest day. The streak keeps.' } },
        { name: 'Recovery tool', fields: { eyebrow: 'After the session', score: '68', scoreLabel: 'Your score, post-session', stats: 'HRV — 51 ms\nSleep — 7h 02m\nSteps — 11,240', line: 'Numbers, not a verdict.' }, style: { accent: '#FF8A5B' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.9, tintAmount: 0.7, target: 0.18, vignette: 0.8 },
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const y0 = safe.t + 4 * k;
        const y1 = H - safe.b - 4 * k;
        backdrop(e, null, { optional: true, glow: { x: 0.5, y: 0.3 } });
        if (e.hasMedia) wash(ctx, 0, 0, W, H, 0.55);

        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            if (e.hasMedia) fadeTo(ctx, W * 0.35, 0, W * 0.65, H, 'right', 0.92);
            const R = strip ? Math.min((y1 - y0) * 0.62, W * 0.14) : (y1 - y0) * 0.44;
            const cx = x0 + R + 30 * k;
            const labelPx = (strip ? 14 : 17) * k;
            const cy = strip ? y0 + R + 30 * k : (y0 + y1) / 2 + R * 0.35;
            gauge(e, cx, cy, R, k, { labelPx });
            const tx = cx + R + (strip ? 110 : 150) * k;
            const lk = lockup(e, x1, y0, (strip ? 28 : 36) * k, { align: 'right', maxW: (x1 - tx) * 0.5 });
            label(e, 'eyebrow', e.fields.eyebrow, labelPx, tx, y0 + lk.h / 2 + labelPx * 0.36, { maxW: (x1 - tx) * 0.45, color: SOFT });
            if (strip) {
                columns(e, tx, x1, y0 + lk.h + 50 * k, k, { namePx: 13 * k, valPx: 36 * k });
                line(e, 'line', e.fields.line, TYPE.serifI, 26 * k, tx, y1, { maxW: x1 - tx, color: SOFT });
            } else {
                table(e, tx, x1, y0 + lk.h + 60 * k, y1 - 110 * k, k, { namePx: 18 * k, valPx: 50 * k });
                line(e, 'line', e.fields.line, TYPE.serifI, 40 * k, tx, y1 - 6 * k, { maxW: x1 - tx, color: SOFT });
            }
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        if (e.hasMedia) fadeTo(ctx, 0, H * 0.45, W, H * 0.55, 'bottom', 0.8);
        const lk = lockup(e, x0, y0, 40 * k, { maxW: (x1 - x0) * 0.6 });
        label(e, 'eyebrow', e.fields.eyebrow, 17 * k, x1, lk.y + lk.h / 2 + 6 * k, { align: 'right', maxW: (x1 - x0) * 0.34, color: SOFT });

        // Bottom-up: the numbers, the line, then the gauge in what's left.
        const namePx = (sq ? 14 : 16) * k;
        const valPx = (sq ? 40 : 48) * k;
        const statsH = 30 * k + namePx + 24 * k + capHeight(ctx, TYPE.brandL, valPx);
        const sTop = y1 - statsH - 4 * k;
        columns(e, x0, x1, sTop, k, { namePx, valPx });
        const lPx = (sq ? 32 : 40) * k;
        const lBase = sTop - (sq ? 44 : 64) * k;
        line(e, 'line', e.fields.line, TYPE.serifI, lPx, W / 2, lBase, { align: 'center', maxW: x1 - x0, color: SOFT });
        const labelPx = (sq ? 16 : 18) * k;
        const gBottom = lBase - lPx - (sq ? 40 : 60) * k;
        const gTop = y0 + lk.h + (sq ? 50 : tall ? 120 : 80) * k;
        // Gauge height ≈ R (arc + ticks) + label under the centre line.
        const R = Math.min((x1 - x0) * (sq ? 0.36 : 0.42), (gBottom - gTop - labelPx * 1.6 - 30 * k) / 1.12);
        const gh = R * 1.12 + labelPx * 1.6 + 30 * k;
        const cy = gTop + Math.max(0, (gBottom - gTop - gh) / 2) + R * 1.12;
        gauge(e, W / 2, cy, R, k, { labelPx });
    },
};
