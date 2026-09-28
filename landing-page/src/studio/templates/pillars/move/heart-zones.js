/**
 * HEART ZONES — the five heart-rate zones as a stepped bar, Z1 to Z5 rising,
 * one zone lit in the accent with its bpm range over it, and the time spent
 * there set big. For wearables and cardio classes.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, HAIR, topRow, mono, unitOf, fitPx, figure, splitUnit } from './_parts';

const zoneOf = (e) => {
    const n = parseInt(String(e.fields.zone ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 4;
};
const names = (e) => {
    const n = String(e.fields.zones ?? '').split(/\s*[·|,\n]\s*/).map((s) => s.trim());
    return [0, 1, 2, 3, 4].map((i) => n[i] ?? '');
};

// The stat label: "Time in zone 4 · Threshold".
const statLabel = (e) => {
    const z = zoneOf(e);
    const nm = names(e)[z - 1];
    return `${String(e.fields.statLabel ?? '').trim() || 'Time in zone'} ${z}${nm ? ` · ${nm}` : ''}`;
};

// The chart in x0..x1, bars standing on `base`, the tallest `h` high. Labels
// (Z1…, names) hang under the base. Returns the bottom of the labels.
function chart(e, x0, x1, base, h, { withNames = true, labPx } = {}) {
    const { ctx } = e;
    const k = unitOf(e);
    const lit = zoneOf(e) - 1;
    const gap = (x1 - x0) * 0.022;
    const bw = (x1 - x0 - gap * 4) / 5;
    const nm = names(e);
    const lp = labPx ?? 16 * k;
    const bpm = String(e.fields.bpm ?? '').trim();
    rule(ctx, x0, base + 1.5 * k, x1, base + 1.5 * k, HAIR, Math.max(1, 1.5 * k));
    let bottom = base;
    for (let i = 0; i < 5; i++) {
        const x = x0 + i * (bw + gap);
        const bh = h * (0.34 + i * 0.165);
        const on = i === lit;
        ctx.fillStyle = on ? e.accent : `rgba(244,241,234,${(0.1 + i * 0.045).toFixed(3)})`;
        ctx.fillRect(x, base - bh, bw, bh);
        // A hairline top edge on the unlit bars keeps them crisp over a photo.
        if (!on) rule(ctx, x, base - bh, x + bw, base - bh, 'rgba(244,241,234,0.4)', Math.max(1, 1.5 * k));
        const zb = base + lp * 2.1;
        drawText(ctx, `Z${i + 1}`, TYPE.mono, lp * 1.15, x, zb, { tracking: 0.08, color: on ? e.accent : SOFT });
        bottom = zb;
        if (withNames && nm[i]) {
            const np = fitPx(ctx, e.caps(nm[i]), TYPE.mono, lp * 0.8, bw, 0.1);
            drawText(ctx, e.caps(nm[i]), TYPE.mono, np, x, zb + lp * 1.7, { tracking: 0.1, color: GREY });
            bottom = zb + lp * 1.7;
        }
        if (on && bpm) {
            // The range over the lit bar, on a short tick.
            const bp = fitPx(ctx, bpm, TYPE.brandM, lp * 1.5, Math.max(bw * 1.7, 120 * k), 0);
            const tw = textWidth(ctx, bpm, TYPE.brandM, bp, 0);
            const cx = Math.min(Math.max(x + bw / 2, x0 + tw / 2), x1 - tw / 2);
            const ty = base - bh - 16 * k;
            rule(ctx, x + bw / 2, ty, x + bw / 2, base - bh - 4 * k, e.accent, Math.max(1, 2 * k));
            e.mark('bpm', drawText(ctx, bpm, TYPE.brandM, bp, cx, ty - 12 * k, { align: 'center', color: e.ink }));
        }
    }
    e.mark('zone', { x: x0, y: base - h, w: x1 - x0, h });
    if (withNames) e.mark('zones', { x: x0, y: base, w: x1 - x0, h: bottom - base });
    return bottom;
}

// The time-in-zone stat: label over a big light number. Returns its baseline.
function stat(e, x, top, px, labPx, maxW) {
    const { ctx } = e;
    const lab = mono(e, statLabel(e), x, top + labPx * 0.75, labPx, { color: SOFT, maxW });
    if (lab) e.mark('statLabel', lab);
    const [v, un] = splitUnit(e.fields.time);
    const w = textWidth(ctx, v, e.headline, px, -0.02) * 1.35;
    const p = w > maxW ? (px * maxW) / w : px;
    const base = top + labPx + 20 * unitOf(e) + capHeight(ctx, e.headline, p);
    e.mark('time', figure(e, v, un, x - p * 0.03, base, p, { color: e.headlineAccent ? e.accent : e.ink }));
    return base;
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.65, H, 'left', 0.85);
    e.fade(0, H * 0.35, W, H * 0.65, 'bottom', 0.7);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    topRow(e, x0, strip ? W * 0.4 : W * 0.46, y0, (strip ? 42 : 56) * k, { px: (strip ? 14 : 16) * k });
    const colW = W * (strip ? 0.34 : 0.4);
    const px = strip ? Math.min(150 * k, (y1 - y0) * 0.42) : 190 * k;
    const statTop = strip ? y0 + 84 * k : H * 0.36;
    const base = stat(e, x0, statTop, px, (strip ? 14 : 17) * k, colW);
    if (!strip) {
        const lPx = 30 * k;
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, colW), x0, base + 44 * k + lPx * 0.72, { color: SOFT }));
        e.mark('footer', mono(e, e.fields.footer, x0, y1, 16 * k, { tracking: 0.16 }));
    }
    const cx0 = strip ? W * 0.46 : W * 0.54;
    const labPx = (strip ? 14 : 16) * k;
    const chartBase = y1 - labPx * (strip ? 2.3 : 4.2);
    chart(e, cx0, x1, chartBase, (chartBase - y0 - (strip ? 44 : 110) * k) * (strip ? 1 : 0.82), { withNames: !strip, labPx });
}

export default {
    id: 'heart-zones',
    name: 'Heart Zones',
    category: 'Move',
    blurb: 'The five heart-rate zones as a rising bar, one lit with its bpm range, time in zone set big. For wearables and cardio classes.',
    refs: 'a heart-rate strap’s zone screen',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Tuesday · Spin 45' },
        { key: 'zone', label: 'Zone lit (1–5)', value: '4' },
        { key: 'bpm', label: 'Its bpm range', value: '152–168 bpm' },
        { key: 'time', label: 'Time in zone', value: '18:40', hint: 'A time or a number and unit (18 min).' },
        { key: 'statLabel', label: 'Stat label', value: 'Time in zone', hint: 'The zone number and name are added.' },
        { key: 'zones', label: 'Zone names', value: 'Recovery · Endurance · Tempo · Threshold · Max', hint: 'Five, split with ·' },
        { key: 'line', label: 'Line', value: 'Forty-five minutes, most of it in four.' },
        { key: 'footer', label: 'Footer', value: 'Every move counts · powr.life' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Spin class (POWR)', fields: { eyebrow: 'Tuesday · Spin 45', zone: '4', bpm: '152–168 bpm', time: '18:40', line: 'Forty-five minutes, most of it in four.', footer: 'Every move counts · powr.life' } },
        { name: 'Easy run', fields: { eyebrow: 'Recovery run · 6 km', zone: '2', bpm: '118–134 bpm', time: '41 min', line: 'Slow on purpose. Conversation pace.', footer: 'Every move counts · powr.life' } },
        { name: 'Wearable brand', fields: { eyebrow: 'Measured on the Northside band', zone: '5', bpm: '171–186 bpm', time: '4:20', statLabel: 'Time in zone', line: 'Every beat, on your wrist and in the app.', footer: 'Northside · Connects to POWR' } },
        { name: 'Studio', fields: { eyebrow: 'Northside Studio · HIIT 30', zone: '3', bpm: '140–155 bpm', time: '12:15', line: 'Thirty minutes, four rounds, one playlist.', footer: 'Book in the app · Northside Studio' } },
    ],
    look: {
        mono: 1, target: 0.2, auto: 0.85, contrast: 0.45, crush: 0.14, fade: 0,
        tint: 'warm', tintAmount: 0.45, motion: 0.1, angle: 0, focus: 0.6, vignette: 0.55, grain: 0.5, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), footer: `${r.brand} · Rewards in the POWR app` }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.24, 'top', 0.5);
        e.fade(0, H * 0.3, W, H * 0.7, 'bottom', 0.92);
        topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);

        const footBase = H - safe.b - 4 * u;
        const labPx = (sq ? 14 : 16) * u;
        const chartBase = footBase - (sq ? 60 : 80) * u - labPx * 3.8;
        const chartH = H * (tall ? 0.2 : sq ? 0.2 : 0.21);
        // The chart sits on a darker floor so the bars read as bars.
        e.fade(0, chartBase - chartH - 120 * u, W, H - (chartBase - chartH - 120 * u), 'bottom', 0.75);
        chart(e, x0, x1, chartBase, chartH, { labPx });
        e.mark('footer', mono(e, e.fields.footer, x0, footBase, (sq ? 15 : 17) * u, { tracking: 0.16 }));
        const px = (tall ? 220 : sq ? 150 : 190) * u * size;
        const lPx = (sq ? 27 : 31) * u;
        const statLab = (sq ? 16 : 18) * u;
        const lineBase = chartBase - chartH - (sq ? 70 : 96) * u;
        const statH = statLab + 20 * u + capHeight(ctx, e.headline, px);
        const statTop = lineBase - lPx * 0.72 - 36 * u - statH;
        e.shade({ x: x0, y: statTop, w: (x1 - x0) * 0.8, h: statH }, { ceiling: 0.28, max: 0.5 });
        stat(e, x0, statTop, px, statLab, x1 - x0);
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, x1 - x0), x0, lineBase, { color: SOFT }));
    },
};
