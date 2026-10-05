/**
 * ALARM — the morning, as the lock screen shows it: the date, the time huge
 * and thin, "Alarm" under a small bell, a line of last night's numbers, and
 * a drawn slide-to-stop pill at the bottom, over the photo softened and
 * dimmed like a phone's wallpaper. The wake-up post: trackers, mattresses,
 * POWR's first-thing check-ins.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, textWidth, capHeight } from '../../../text';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, backdrop, wash, fadeTo, line, rrect, onAccent } from './_parts';

function bell(ctx, cx, cy, s, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.46, cy + s * 0.28);
    ctx.lineTo(cx - s * 0.36, cy + s * 0.14);
    ctx.lineTo(cx - s * 0.36, cy - s * 0.08);
    ctx.arc(cx, cy - s * 0.08, s * 0.36, Math.PI, 0);
    ctx.lineTo(cx + s * 0.36, cy + s * 0.14);
    ctx.lineTo(cx + s * 0.46, cy + s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.4, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// A small bell and "Alarm", centred on (cx, base) — the bell drawn, not a glyph.
function alarmLabel(e, cx, base, px, align = 'center') {
    const { ctx } = e;
    const t = String(e.fields.label ?? '').trim();
    if (!t) return;
    const s = px * 0.95;
    const w = s + px * 0.4 + textWidth(ctx, t, TYPE.brandM, px, 0.02);
    const x = align === 'left' ? cx : cx - w / 2;
    bell(ctx, x + s / 2, base - px * 0.38, s, INK);
    line(e, 'label', t, TYPE.brandM, px, x + s + px * 0.4, base, { tracking: 0.02, color: INK });
}

// The time, fitted and drawn with its cap top at `top`. Returns its bottom.
function bigTime(e, x, top, maxW, maxH, align) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const block = fitBlock(ctx, [String(e.fields.time ?? '')], e.headline, { maxW: maxW * size, maxH: maxH * size, tracking: -0.02 });
    e.shade({ x: align === 'center' ? x - maxW / 2 : x, y: top, w: maxW, h: block.cap }, { ceiling: 0.24, max: 0.55 });
    const heads = drawBlock(ctx, block, e.headline, x, top, { align, tracking: -0.02, color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('time', blockBox(heads));
    return top + block.cap;
}

// The slide-to-stop pill: a frosted track, an accent knob with a chevron.
function pill(e, x, y, w, h, k) {
    const { ctx } = e;
    ctx.fillStyle = 'rgba(244,241,234,0.13)';
    rrect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    const pad = Math.max(5 * k, h * 0.08);
    const r = h / 2 - pad;
    const kx = x + pad + r;
    const ky = y + h / 2;
    ctx.fillStyle = e.accent;
    ctx.beginPath();
    ctx.arc(kx, ky, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = onAccent(e.accent);
    ctx.lineWidth = Math.max(2, r * 0.11);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(kx - r * 0.14, ky - r * 0.3);
    ctx.lineTo(kx + r * 0.18, ky);
    ctx.lineTo(kx - r * 0.14, ky + r * 0.3);
    ctx.stroke();
    ctx.restore();
    const px = Math.min(h * 0.3, 34 * k);
    const tx = kx + r + (x + w - (kx + r)) / 2;
    line(e, 'slide', e.fields.slide, TYPE.brandR, px, tx, ky + capHeight(ctx, TYPE.brandR, px) * 0.5, { align: 'center', maxW: x + w - kx - r - 30 * k, color: SOFT });
}

export default {
    id: 'alarm',
    name: 'Alarm',
    category: 'Sleep',
    blurb: 'The lock screen at wake-up: the time huge and thin, “Alarm”, last night in a line, slide to stop.',
    refs: 'a phone’s alarm screen',
    headlineFont: 'brandXL',
    fields: [
        { key: 'date', label: 'Date', value: 'Monday 13 October' },
        { key: 'time', label: 'Time', value: '06:30' },
        { key: 'label', label: 'Label', value: 'Alarm' },
        { key: 'sub', label: 'Line under it', value: 'Slept 8h 02m', hint: 'One person’s night, e.g. Slept 7h 41m.' },
        { key: 'slide', label: 'Pill', value: 'slide to stop' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Weekday', fields: { date: 'Monday 13 October', time: '06:30', label: 'Alarm', sub: 'Slept 8h 02m', slide: 'slide to stop' } },
        { name: 'Tracker', fields: { date: 'Tuesday 14 October', time: '06:45', label: 'Smart alarm', sub: 'Woke in light sleep · 7h 36m', slide: 'slide to stop' }, style: { accent: '#9DB8FF' } },
        { name: 'Weekend', fields: { date: 'Saturday 18 October', time: '08:15', label: 'No alarm', sub: 'Slept 9h 10m', slide: 'slide to get up' }, style: { accent: '#C9B79C' } },
        { name: 'Gym first', fields: { date: 'Wednesday 15 October', time: '05:45', label: 'Gym', sub: 'Day 41 of the streak', slide: 'slide to stop' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.75, tintAmount: 0.55, target: 0.2, vignette: 0.7, blur: 'soft' },
    controls: [
        { key: 'blur', label: 'Wallpaper', options: [['soft', 'Softened'], ['sharp', 'Sharp']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        // A phone softens its wallpaper under the lock screen: a long, even
        // streak across the whole frame reads as that blur.
        const soft = e.look.blur !== 'sharp';
        backdrop(e, null, { overrides: soft ? { motion: 0.28, motionAuto: false, focus: 0, angle: 90 } : undefined });
        wash(ctx, 0, 0, W, H, soft ? 0.4 : 0.5);
        e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.5);
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const y0 = safe.t + 4 * k;
        const y1 = H - safe.b - 4 * k;

        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            fadeTo(ctx, 0, 0, W * 0.6, H, 'left', 0.5);
            const colW = (x1 - x0) * (strip ? 0.36 : 0.5);
            const dPx = (strip ? 18 : 28) * k;
            line(e, 'date', e.fields.date, TYPE.brandR, dPx, x0, y0 + dPx * 0.8, { maxW: colW, color: SOFT });
            const tb = bigTime(e, x0, y0 + dPx + (strip ? 18 : 40) * k, colW, (y1 - y0) * (strip ? 0.5 : 0.42), 'left');
            const lPx = (strip ? 20 : 30) * k;
            if (strip) {
                const mx = x0 + colW + 40 * k;
                alarmLabel(e, mx, y0 + (y1 - y0) * 0.42, lPx, 'left');
                line(e, 'sub', e.fields.sub, TYPE.brandL, lPx * 0.9, mx, y0 + (y1 - y0) * 0.42 + lPx * 1.8, { maxW: (x1 - mx) * 0.4, color: MUTED });
                lockup(e, mx, y0, 26 * k, { maxW: (x1 - mx) * 0.4 });
                const pw = (x1 - x0) * 0.3;
                pill(e, x1 - pw, (y0 + y1) / 2 - 42 * k, pw, 84 * k, k);
            } else {
                alarmLabel(e, x0, tb + 50 * k + lPx * 0.7, lPx, 'left');
                line(e, 'sub', e.fields.sub, TYPE.brandL, lPx * 0.9, x0, tb + 50 * k + lPx * 2.2, { maxW: colW, color: MUTED });
                lockup(e, x1, y0, 34 * k, { align: 'right', maxW: (x1 - x0) * 0.35 });
                const pw = (x1 - x0) * 0.38;
                pill(e, x1 - pw, y1 - 104 * k, pw, 104 * k, k);
            }
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const cx = W / 2;
        lockup(e, cx, y0 + (tall ? 10 : 0) * k, (sq ? 28 : 32) * k, { align: 'center', maxW: (x1 - x0) * 0.6 });
        const dPx = (sq ? 28 : 32) * k;
        const dBase = y0 + (tall ? 190 : sq ? 100 : 130) * k;
        line(e, 'date', e.fields.date, TYPE.brandR, dPx, cx, dBase, { align: 'center', maxW: x1 - x0, color: SOFT });
        const tb = bigTime(e, cx, dBase + (sq ? 30 : 44) * k, (x1 - x0) * 0.92, H * (tall ? 0.15 : sq ? 0.2 : 0.18), 'center');
        const lPx = (sq ? 30 : 34) * k;
        const lBase = tb + (sq ? 56 : 76) * k;
        alarmLabel(e, cx, lBase, lPx);
        line(e, 'sub', e.fields.sub, TYPE.brandL, lPx * 0.85, cx, lBase + lPx * 1.7, { align: 'center', maxW: x1 - x0, color: MUTED });
        const ph = (sq ? 92 : 112) * k;
        const pw = (x1 - x0) * (sq ? 0.72 : 0.84);
        pill(e, cx - pw / 2, y1 - ph - (tall ? 20 : 4) * k, pw, ph, k);
    },
};
