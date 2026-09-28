/**
 * BEDTIME — a 24-hour dial: the night as an accent arc from bedtime round to
 * waking, a crescent at one end and a sun at the other, the time in bed in
 * the middle and the two times set large beside it. For a schedule someone
 * keeps — mattress and bedding brands, trackers, POWR on rest.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, textWidth, capHeight } from '../../../text';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, backdrop, wash, label, line, parseClock, clock, span, dur, crescent, sun, onAccent, nightRgba } from './_parts';

const angle = (m) => -Math.PI / 2 + (m / 1440) * Math.PI * 2;

const times = (e) => {
    const bed = parseClock(e.fields.bed) ?? 22 * 60 + 45;
    const wake = parseClock(e.fields.wake) ?? 6 * 60 + 30;
    const total = String(e.fields.total ?? '').trim() || dur(span(bed, wake));
    return { bed, wake, total };
};

// The dial, centred on (cx, cy) with the arc's centre line at radius R.
function dial(e, cx, cy, R, k, { centre = true } = {}) {
    const { ctx } = e;
    const { bed, wake, total } = times(e);
    const tw = Math.max(10 * k, R * 0.13);
    // A calm dark face under the dial, so the photo stays behind it.
    if (e.hasMedia) {
        ctx.fillStyle = nightRgba(0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, R + tw / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    // Track, then the night on it.
    ctx.save();
    ctx.lineWidth = tw;
    ctx.strokeStyle = 'rgba(244,241,234,0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = e.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, R, angle(bed), angle(bed) + ((span(bed, wake) || 1) / 1440) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const on = onAccent(e.accent);
    const at = (m) => ({ x: cx + Math.cos(angle(m)) * R, y: cy + Math.sin(angle(m)) * R });
    const b = at(bed);
    const w = at(wake);
    crescent(ctx, b.x, b.y, tw * 0.3, on);
    sun(ctx, w.x, w.y, tw * 0.3, on, Math.max(1, tw * 0.05));

    // Ticks: every quarter hour, the hours longer; 00 · 06 · 12 · 18 inside.
    const rin = R - tw / 2 - 12 * k;
    ctx.save();
    ctx.lineCap = 'butt';
    for (let i = 0; i < 96; i++) {
        const hour = i % 4 === 0;
        const a = angle(i * 15);
        const l = hour ? R * 0.07 : R * 0.03;
        ctx.strokeStyle = hour ? 'rgba(244,241,234,0.62)' : 'rgba(244,241,234,0.24)';
        ctx.lineWidth = (hour ? 2 : 1.4) * k;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rin, cy + Math.sin(a) * rin);
        ctx.lineTo(cx + Math.cos(a) * (rin - l), cy + Math.sin(a) * (rin - l));
        ctx.stroke();
    }
    ctx.restore();
    const lPx = Math.max(11 * k, R * 0.055);
    const rl = rin - R * 0.07 - lPx * 1.1;
    [0, 6, 12, 18].forEach((h) => {
        const a = angle(h * 60);
        line(e, null, String(h).padStart(2, '0'), TYPE.mono, lPx, cx + Math.cos(a) * rl, cy + Math.sin(a) * rl + lPx * 0.36, { align: 'center', tracking: 0.04, color: MUTED });
    });

    if (!centre) return;
    // The middle: "time in bed" over the duration.
    const inner = rl - lPx * 1.4;
    const block = fitBlock(ctx, [total], e.headline, { maxW: inner * 1.3 * (e.look.size ?? 1), maxH: inner * 0.34 * (e.look.size ?? 1), tracking: -0.01 });
    const cPx = Math.max(11 * k, R * 0.05);
    const gap = inner * 0.1;
    const h = cPx + gap + block.cap;
    const top = cy - h / 2;
    label(e, 'centre', e.fields.centre, cPx, cx, top + cPx * 0.8, { align: 'center', maxW: inner * 1.4, color: SOFT });
    const heads = drawBlock(ctx, block, e.headline, cx, top + cPx + gap, { align: 'center', tracking: -0.01, color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('total', blockBox(heads));
}

// A glyph, a small label and the time large under it. Returns its height.
function stamp(e, key, labelKey, glyph, x, top, px, k, align = 'left', maxW = Infinity) {
    const { ctx } = e;
    const lPx = Math.max(12 * k, px * 0.2);
    const gR = lPx * 0.62;
    const lab = e.caps(e.fields[labelKey]);
    const lw = Math.min(textWidth(ctx, lab, TYPE.mono, lPx, 0.18), maxW - gR * 2 - 12 * k);
    const rowW = gR * 2 + 12 * k + lw;
    const lx = align === 'right' ? x - rowW : align === 'center' ? x - rowW / 2 : x;
    const gy = top + lPx * 0.36;
    if (glyph === 'moon') crescent(ctx, lx + gR, gy - lPx * 0.34, gR, e.accent);
    else sun(ctx, lx + gR, gy - lPx * 0.34, gR, e.accent, Math.max(1, 1.6 * k));
    label(e, labelKey, lab, lPx, lx + gR * 2 + 12 * k, gy, { color: SOFT, maxW: lw });
    const cap = capHeight(ctx, TYPE.brandXL, px);
    const t = clock(parseClock(e.fields[key]) ?? 0);
    line(e, key, t, TYPE.brandXL, px, x, top + lPx + 22 * k + cap, { align, tracking: -0.01, color: INK, maxW });
    return lPx + 22 * k + cap;
}

function serif(e, x, y, px, maxW, align) {
    return line(e, 'line', e.fields.line, TYPE.serifI, px, x, y, { align, maxW, color: SOFT });
}

export default {
    id: 'bedtime',
    name: 'Bedtime',
    category: 'Sleep',
    blurb: 'A 24-hour dial with the night as an arc, bedtime to waking, the two times large.',
    refs: 'a phone’s bedtime dial',
    headlineFont: 'brandXL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Sleep schedule' },
        { key: 'bedLabel', label: 'Bedtime label', value: 'Bedtime' },
        { key: 'bed', label: 'Bedtime', value: '22:45', hint: '24-hour clock, e.g. 22:45.' },
        { key: 'wakeLabel', label: 'Wake label', value: 'Wake up' },
        { key: 'wake', label: 'Wake time', value: '06:30' },
        { key: 'centre', label: 'Middle label', value: 'Time in bed' },
        { key: 'total', label: 'Middle number', value: '', hint: 'Leave empty to work it out from the two times.' },
        { key: 'line', label: 'Line', value: 'Same time, most nights.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Weeknights', fields: { eyebrow: 'Sleep schedule', bed: '22:45', wake: '06:30', line: 'Same time, most nights.' } },
        { name: 'Early night', fields: { eyebrow: 'Sunday reset', bed: '21:30', wake: '06:00', line: 'In bed before the week starts.' }, style: { accent: '#C9B79C' } },
        { name: 'Tracker', fields: { eyebrow: 'Your target window', bedLabel: 'Lights out', wakeLabel: 'Alarm', bed: '23:00', wake: '07:00', line: 'Set once. Kept most nights.' }, style: { accent: '#9DB8FF' } },
        { name: 'Rest day', fields: { eyebrow: 'Rest day', bed: '22:15', wake: '07:15', centre: 'Nine hours off', total: '9h', line: 'The streak is yours. So is the lie-in.' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.85, target: 0.17, vignette: 0.8 },
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        backdrop(e, null, { optional: true, glow: { x: 0.5, y: 0.4 } });
        if (e.hasMedia) wash(ctx, 0, 0, W, H, 0.5);
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const y0 = safe.t + 4 * k;
        const y1 = H - safe.b - 4 * k;

        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const R = (y1 - y0) * (strip ? 0.46 : 0.42);
            const cx = x0 + R + R * 0.08;
            const cy = (y0 + y1) / 2;
            dial(e, cx, cy, R, k, { centre: !strip || R > 150 * k });
            const tx = cx + R * 1.1 + (strip ? 60 : 110) * k;
            const lk = lockup(e, x1, y0, (strip ? 28 : 36) * k, { align: 'right', maxW: (x1 - tx) * 0.5 });
            label(e, 'eyebrow', e.fields.eyebrow, (strip ? 14 : 17) * k, tx, y0 + lk.h * 0.5 + 6 * k, { maxW: (x1 - tx) * 0.45, color: SOFT });
            const tPx = (strip ? 88 : 118) * k;
            if (strip) {
                const top = y0 + (y1 - y0) * 0.26;
                stamp(e, 'bed', 'bedLabel', 'moon', tx, top, tPx, k, 'left', (x1 - tx) * 0.46);
                stamp(e, 'wake', 'wakeLabel', 'sun', tx + (x1 - tx) * 0.5, top, tPx, k, 'left', (x1 - tx) * 0.46);
                serif(e, tx, y1 - 4 * k, 26 * k, x1 - tx, 'left');
            } else {
                let top = y0 + (y1 - y0) * 0.2;
                top += stamp(e, 'bed', 'bedLabel', 'moon', tx, top, tPx, k, 'left', x1 - tx) + 60 * k;
                stamp(e, 'wake', 'wakeLabel', 'sun', tx, top, tPx, k, 'left', x1 - tx);
                serif(e, tx, y1 - 6 * k, 38 * k, x1 - tx, 'left');
            }
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const lh = 40 * k;
        const lk = lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.6 });
        label(e, 'eyebrow', e.fields.eyebrow, 17 * k, x1, lk.y + lk.h / 2 + 6 * k, { align: 'right', maxW: (x1 - x0) * 0.34, color: SOFT });

        const lPx = (sq ? 34 : 40) * k;
        const lineBase = y1 - 6 * k;
        serif(e, W / 2, lineBase, lPx, x1 - x0, 'center');
        const tPx = (sq ? 92 : tall ? 120 : 112) * k;
        const rowH = Math.max(12 * k, tPx * 0.2) + 22 * k + capHeight(ctx, TYPE.brandXL, tPx);
        const rowTop = lineBase - lPx - (sq ? 44 : 64) * k - rowH;
        const colX = (x1 - x0) * 0.25;
        stamp(e, 'bed', 'bedLabel', 'moon', x0 + colX, rowTop, tPx, k, 'center', colX * 1.8);
        stamp(e, 'wake', 'wakeLabel', 'sun', x1 - colX, rowTop, tPx, k, 'center', colX * 1.8);
        ctx.fillStyle = 'rgba(244,241,234,0.2)';
        ctx.fillRect(W / 2 - 0.75 * k, rowTop, 1.5 * k, rowH);

        const dTop = y0 + lh + (sq ? 40 : 70) * k;
        const dBottom = rowTop - (sq ? 44 : tall ? 110 : 70) * k;
        const R = Math.min((x1 - x0) * (sq ? 0.3 : 0.38), (dBottom - dTop) / 2 - 20 * k);
        dial(e, W / 2, (dTop + dBottom) / 2, R, k);
    },
};
