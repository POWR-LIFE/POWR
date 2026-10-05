/**
 * FOCUS — a timer dial: sixty tick marks round a circle, the ones inside the
 * focus block lit in the accent with a thin arc just inside them, the time in
 * the middle ("25:00") and what the block is for under it. For focus and
 * productivity brands, co-working studios and study sessions.
 */
import { TYPE } from '../../../fonts';
import { capHeight } from '../../../text';
import { dot } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, DIM, unitOf, veil, prep, footRow, headColor, label, rewardLine } from './_parts';

// Minutes in the block: "25:00" → 25, "1:30:00" → 90, "45 min" → 45.
function blockMinutes(s) {
    const parts = String(s ?? '').match(/\d+/g)?.map(Number) ?? [];
    if (!parts.length) return 0;
    if (/\d+:\d+:\d+/.test(s)) return parts[0] * 60 + parts[1];
    return parts[0];
}

function dial(e, cx, cy, R, k) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const mins = Math.max(0, Math.min(60, blockMinutes(e.fields.time)));
    ctx.save();
    // A dark face so the ticks read over any photo.
    ctx.fillStyle = 'rgba(10,9,8,0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 18 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI * 2;
        const major = i % 5 === 0;
        const on = i < mins;
        const r1 = R - (major ? 26 : 13) * k;
        ctx.strokeStyle = on ? e.accent : major ? 'rgba(244,241,234,0.62)' : 'rgba(244,241,234,0.28)';
        ctx.lineWidth = (major ? 2.4 : 1.4) * k;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
    }
    if (mins > 0) {
        const ra = R - 44 * k;
        const a1 = -Math.PI / 2 + (mins / 60) * Math.PI * 2;
        ctx.strokeStyle = e.accent;
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        ctx.arc(cx, cy, ra, -Math.PI / 2, a1);
        ctx.stroke();
        if (mins < 60) dot(ctx, cx + Math.cos(a1) * ra, cy + Math.sin(a1) * ra, 5.5 * k, e.accent);
    }
    ctx.restore();

    const spec = e.look.face === 'thin' ? TYPE.brandXL : TYPE.monoR;
    const tb = prep(e, e.fields.time, spec, { maxW: R * 1.08 * size, maxH: R * 0.34 * size, lines: 1, tracking: e.look.face === 'thin' ? -0.01 : 0.02 });
    const tPx = Math.max(15 * k, R * 0.068);
    const task = String(e.fields.task ?? '').trim();
    const tCap = capHeight(ctx, TYPE.brandR, tPx);
    const h = tb.h + (task ? R * 0.12 + tCap : 0);
    const top = cy - h / 2;
    e.shade({ x: cx - R * 0.55, y: top, w: R * 1.1, h }, { ceiling: 0.22, max: 0.6 });
    tb.draw('time', cx, top, { align: 'center', color: e.ink });
    if (task) label(e, 'task', task, cx, top + tb.h + R * 0.12 + tCap, { px: tPx, maxW: R * 1.2, align: 'center', color: DIM });
}

// Session line (mono, accent) over the headline.
function words(e, x, top, maxW, maxH, k, align, measure = false) {
    const size = e.look.size ?? 1;
    const sPx = 18 * k;
    const sCap = capHeight(e.ctx, TYPE.mono, sPx);
    const session = String(e.fields.session ?? '').trim();
    const hb = prep(e, e.fields.headline, e.headline, { maxW: maxW * size, maxH: maxH * size, max: 74 * k * size, lines: 3, gap: 0.22 });
    const h = (session ? sCap + 30 * k : 0) + hb.h + hb.desc;
    if (measure) return h;
    let y = top;
    if (session) {
        label(e, 'session', session, x, y + sCap, { px: sPx, maxW, align, color: e.accent, spec: TYPE.mono, tracking: 0.2 });
        y += sCap + 30 * k;
    }
    hb.draw('headline', x, y, { align, color: headColor(e) });
    return h;
}

function banner(e) {
    const { W, H, safe, shape } = e;
    const k = unitOf(e);
    const strip = shape === 'strip';
    e.photo({ x: 0, y: 0, w: W, h: H });
    veil(e, 0.5);
    e.fade(0, 0, W * 0.5, H, 'left', 0.5);
    const R = (H - safe.t - safe.b) / 2 - 4 * k;
    const cx = safe.l + R + (strip ? 10 : 40) * k;
    dial(e, cx, H / 2, R, k);
    const x0 = cx + R + (strip ? 70 : 110) * k;
    const x1 = W - safe.r;
    const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k, lockH: strip ? 22 : 26 });
    const maxH = (footTop - safe.t) * (strip ? 0.45 : 0.36);
    const h = words(e, 0, 0, x1 - x0, maxH, k, 'left', true);
    words(e, x0, safe.t + Math.max(0, (footTop - 30 * k - safe.t - h) / 2), x1 - x0, maxH, k, 'left');
}

export default {
    id: 'focus-timer',
    name: 'Focus',
    category: 'Mind',
    blurb: 'A timer dial of sixty ticks with the focus block lit, the time in the middle. For focus and productivity brands.',
    refs: 'a Braun kitchen timer',
    headlineFont: 'brandL',
    fields: [
        { key: 'time', label: 'Time', value: '25:00', hint: 'The block lights that many minutes of the dial (up to 60).' },
        { key: 'task', label: 'Under the time', value: 'Deep work' },
        { key: 'session', label: 'Session line', value: 'Block 1 of 4' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'One thing.\nTwenty-five minutes.', hint: '{Braces} colour a word.' },
        { key: 'footer', label: 'Small print', value: 'Phone face down' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Deep work', fields: { time: '25:00', task: 'Deep work', session: 'Block 1 of 4', headline: 'One thing.\nTwenty-five minutes.', footer: 'Phone face down' } },
        { name: 'Study hall', fields: { time: '50:00', task: 'Study', session: 'Silent hour · 10am', headline: 'Fifty on.\nTen off.', footer: 'Northside Library Café' } },
        { name: 'Reading', fields: { time: '20:00', task: 'Read', session: 'Before bed', headline: 'Twenty minutes,\none book.', footer: 'Screens off at nine' } },
        { name: 'Stretch break', fields: { time: '05:00', task: 'Stretch', session: 'Between blocks', headline: 'Up from the desk.', footer: 'Every move counts' } },
    ],
    look: { ...MIND_LOOK, mono: 0.9, target: 0.2, face: 'mono' },
    controls: [
        { key: 'face', label: 'Time in', options: [['mono', 'Mono'], ['thin', 'Outfit Thin']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.42);
        e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.7);
        const x0 = safe.l;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k });
        const R = tall ? W * 0.33 : sq ? H * 0.25 : W * 0.3;
        const gap = (sq ? 54 : 80) * k;
        const maxW = (x1 - x0) * 0.9;
        const maxH = H * (sq ? 0.11 : 0.12);
        const wh = words(e, 0, 0, maxW, maxH, k, 'center', true);
        const room = footTop - (sq ? 40 : 60) * k - safe.t;
        const top = safe.t + Math.max(0, (room - (R * 2 + gap + wh)) / 2);
        dial(e, W / 2, top + R, R, k);
        words(e, W / 2, top + R * 2 + gap, maxW, maxH, k, 'center');
    },
};
