/**
 * TRAINING WEEK — consistency, drawn: M T W T F S S as seven circles, the
 * days trained filled in the accent (a thin line joins a run of them), rest
 * days outlined; the streak number huge and light beside a short line. For
 * gyms, coaches and POWR.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth } from '../../../text';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, DIM, topRow, mono, unitOf, fitPx, onAccent, figure } from './_parts';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// "1 1 0 1 1 1 0", "x x - x x x -", "MTWFS"-style ticks → seven booleans.
function weekOf(e) {
    const raw = String(e.fields.week ?? '').trim();
    const marks = raw.replace(/\s+/g, '').split('');
    if (marks.length >= 7 && marks.every((c) => /[01xX✓.\-o]/.test(c))) {
        return marks.slice(0, 7).map((c) => /[1xX✓]/.test(c));
    }
    return [0, 1, 2, 3, 4, 5, 6].map((i) => /[1xX✓]/.test(marks[i] ?? ''));
}

// The seven circles centred on cy, across x0..x1 (at most d wide). Returns the box.
function days(e, x0, x1, cy, d) {
    const { ctx } = e;
    const k = unitOf(e);
    const week = weekOf(e);
    const gap = Math.max(8 * k, Math.min(d * 0.3, ((x1 - x0) - d * 7) / 6));
    const size = Math.min(d, (x1 - x0 - gap * 6) / 7);
    const r = size / 2;
    const step = size + gap;
    const left = x0 + (x1 - x0 - (size * 7 + gap * 6)) / 2;
    const cx = (i) => left + r + i * step;
    // The chain: a thin accent line behind each run of trained days.
    ctx.save();
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = Math.max(2, 3 * k);
    for (let i = 0; i < 6; i++) {
        if (week[i] && week[i + 1]) {
            ctx.beginPath();
            ctx.moveTo(cx(i) + r, cy);
            ctx.lineTo(cx(i + 1) - r, cy);
            ctx.stroke();
        }
    }
    ctx.restore();
    const px = size * 0.36;
    week.forEach((on, i) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx(i), cy, r - (on ? 0 : k), 0, Math.PI * 2);
        if (on) {
            ctx.fillStyle = e.accent;
            ctx.fill();
        } else {
            ctx.fillStyle = 'rgba(10,10,10,0.4)';
            ctx.fill();
            ctx.strokeStyle = DIM;
            ctx.lineWidth = Math.max(1, 2 * k);
            ctx.stroke();
        }
        ctx.restore();
        drawText(ctx, LETTERS[i], TYPE.brandSB, px, cx(i), cy + capHeight(ctx, TYPE.brandSB, px) / 2, { align: 'center', color: on ? onAccent(e.accent) : SOFT });
    });
    const box = { x: left, y: cy - r, w: size * 7 + gap * 6, h: size };
    e.mark('week', box);
    return box;
}

const trained = (e) => weekOf(e).filter(Boolean).length;
const summary = (e) => {
    const n = trained(e);
    const s = String(e.fields.summary ?? '').trim();
    return s.replace('{n}', String(n));
};

// The streak: the number huge, its unit beside it. Returns the box.
function streak(e, x, base, px, maxW) {
    const { ctx } = e;
    const v = String(e.fields.streak ?? '').trim();
    const un = String(e.fields.unit ?? '').trim();
    const w = textWidth(ctx, v, e.headline, px, -0.02) + (un ? textWidth(ctx, un, TYPE.brandR, px * 0.2, 0.02) + px * 0.1 : 0);
    const p = w > maxW ? (px * maxW) / w : px;
    const box = figure(e, v, un, x - p * 0.04, base, p, { color: e.headlineAccent ? e.accent : e.ink, unitScale: 0.2, unitColor: SOFT });
    e.mark('streak', box);
    if (un) e.mark('unit', box);
    return box;
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.6, H, 'left', 0.8);
    e.fade(0, H * 0.3, W, H * 0.7, 'bottom', 0.7);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    topRow(e, x0, strip ? W * 0.4 : x1, y0, (strip ? 42 : 56) * k, { px: (strip ? 14 : 16) * k });
    const px = strip ? (y1 - y0) * 0.56 : (y1 - y0) * 0.4;
    const base = strip ? y1 - 4 * k : y0 + (y1 - y0) * 0.62;
    streak(e, x0, base, px, W * (strip ? 0.3 : 0.36));
    const cx0 = strip ? W * 0.42 : W * 0.46;
    const d = strip ? (y1 - y0) * 0.32 : 104 * k;
    const cy = strip ? (y0 + y1) / 2 + 10 * k : base - d / 2;
    e.shade({ x: cx0, y: cy - d / 2, w: x1 - cx0, h: d + (strip ? 50 : 80) * k }, { ceiling: 0.22, max: 0.6, spread: 1.1 });
    const row = days(e, cx0, x1, cy, d);
    const lPx = (strip ? 22 : 30) * k;
    const ly = row.y + row.h + (strip ? 36 : 60) * k;
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, (x1 - row.x) * 0.6), row.x, ly, { color: SOFT }));
    const sm = summary(e);
    if (sm) e.mark('summary', mono(e, sm, x1, ly, (strip ? 13 : 16) * k, { align: 'right', color: GREY }));
    if (!strip) e.mark('footer', mono(e, e.fields.footer, x0, y1, 16 * k, { tracking: 0.16 }));
}

export default {
    id: 'training-week',
    name: 'Training Week',
    category: 'Move',
    blurb: 'M T W T F S S as circles: days trained filled, rest days outlined, the streak big. Consistency, for gyms, coaches and POWR.',
    refs: 'a habit tracker',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Week 12' },
        { key: 'streak', label: 'Streak', value: '12' },
        { key: 'unit', label: 'Streak unit', value: 'weeks' },
        { key: 'week', label: 'This week', value: '1 1 0 1 1 1 0', hint: 'Seven marks, Monday first: 1 (or x) trained, 0 (or -) rest.' },
        { key: 'summary', label: 'Summary', value: '{n} sessions this week', hint: '{n} becomes the number of days trained.' },
        { key: 'line', label: 'Line', value: 'The streak is yours.' },
        { key: 'footer', label: 'Footer', value: 'Every session counts · powr.life' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Streak (POWR)', fields: { eyebrow: 'Week 12', streak: '12', unit: 'weeks', week: '1 1 0 1 1 1 0', summary: '{n} sessions this week', line: 'The streak is yours.', footer: 'Every session counts · powr.life' } },
        { name: 'Member shout-out', fields: { eyebrow: 'Member of the week', streak: '31', unit: 'days', week: '1 1 1 1 1 1 1', summary: '{n} of 7 days', line: 'Morgan K. hasn’t missed a day in a month.', footer: 'Northside Gym · Every visit counts' } },
        { name: 'Coach plan', fields: { eyebrow: 'Your week · Block 2', streak: '4', unit: 'sessions', week: '1 0 1 0 1 0 1', summary: 'Rest days are part of it', line: 'Train, rest, repeat. Four is the plan.', footer: 'Coached by Sam · Week 2 of 8' } },
        { name: 'Comeback', fields: { eyebrow: 'Back at it', streak: '3', unit: 'days', week: '0 0 0 0 1 1 1', summary: '{n} in a row', line: 'Day one was Friday.', footer: 'Every move counts · powr.life' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.12, fade: 0,
        tint: 'warm', tintAmount: 0.3, motion: 0, angle: 0, focus: 0.6, vignette: 0.5, grain: 0.5, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), line: r.value ? `Keep it up: ${r.value}${r.unit ? ` ${r.unit}` : ''} at ${r.brand}.` : 'The streak is yours.' }),
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
        e.fade(0, H * 0.34, W, H * 0.66, 'bottom', 0.9);
        topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);

        // Bottom up: footer, summary, the week, line, the streak.
        const footBase = H - safe.b - 4 * u;
        e.mark('footer', mono(e, e.fields.footer, x0, footBase, (sq ? 15 : 17) * u, { tracking: 0.16 }));
        const d = (x1 - x0) / 8.6;
        const cy = footBase - (sq ? 70 : 96) * u - d / 2;
        const row = days(e, x0, x1, cy, d);
        const sm = summary(e);
        if (sm) e.mark('summary', mono(e, sm, x0, row.y - 30 * u, (sq ? 16 : 18) * u, { color: GREY }));
        const lPx = (sq ? 30 : 36) * u;
        const lineBase = row.y - (sm ? 90 : 50) * u;
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, x1 - x0), x0, lineBase, { color: SOFT }));
        const px = (tall ? 400 : sq ? 250 : 330) * u * size;
        const sBase = lineBase - lPx - (sq ? 30 : 44) * u;
        const cap = capHeight(ctx, e.headline, px);
        e.shade({ x: x0, y: sBase - cap, w: (x1 - x0) * 0.7, h: cap }, { ceiling: 0.28, max: 0.55 });
        streak(e, x0, sBase, px, x1 - x0);
    },
};
