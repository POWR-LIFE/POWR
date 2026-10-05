/**
 * MINUTES — mindful minutes as a thin progress ring sitting on the seam
 * between the photo and the ground: half over the picture, half over the
 * dark. The number inside at ultra-light weight, the streak in mono under
 * it, then the headline. For meditation apps, studios and POWR's streaks.
 */
import { TYPE } from '../../../fonts';
import { ring, dot } from '../../../shapes';
import { capHeight } from '../../../text';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, SOFT, DIM, GROUND, unitOf, ground, prep, footRow, headColor, label, rewardLine } from './_parts';

const num = (s) => {
    const m = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
};

// The ring centred on (cx, cy): a dark disc, the track, the arc, the number.
function dial(e, cx, cy, R, k) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    ctx.save();
    ctx.fillStyle = 'rgba(12,11,10,0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ring(ctx, cx, cy, R, 'rgba(244,241,234,0.18)', Math.max(1, 2 * k));
    e.mark('goal', { x: cx - R, y: cy - R, w: R * 2, h: R * 2 });
    const mins = num(e.fields.minutes);
    const goal = num(e.fields.goal);
    const frac = Number.isFinite(goal) && goal > 0 && Number.isFinite(mins) ? Math.max(0, Math.min(1, mins / goal)) : 1;
    if (frac > 0) {
        const a0 = -Math.PI / 2;
        const a1 = a0 + frac * Math.PI * 2;
        ctx.save();
        ctx.strokeStyle = e.accent;
        ctx.lineWidth = 3.5 * k;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, R, a0, a1);
        ctx.stroke();
        ctx.restore();
        if (frac < 1) dot(ctx, cx + R * Math.cos(a1), cy + R * Math.sin(a1), 7 * k, e.accent);
    }
    const nb = prep(e, e.fields.minutes, TYPE.brandXL, { maxW: R * 1.3 * size, maxH: R * 0.62 * size, lines: 1, tracking: -0.02 });
    const uPx = R * 0.13;
    const uCap = capHeight(ctx, TYPE.brandL, uPx);
    const unit = String(e.fields.unit ?? '').trim();
    const gH = nb.h + (unit ? R * 0.14 + uCap : 0);
    const top = cy - gH / 2;
    nb.draw('minutes', cx, top, { align: 'center', color: e.ink });
    if (unit) label(e, 'unit', unit, cx, top + nb.h + R * 0.14 + uCap, { px: uPx, maxW: R * 1.2, align: 'center', color: DIM, spec: TYPE.brandL, tracking: 0.2 });
}

// Streak, headline, line — stacked from `top` (or centred in a band).
function words(e, x, top, maxW, maxH, k, align) {
    const size = e.look.size ?? 1;
    const sPx = 18 * k;
    const streak = String(e.fields.streak ?? '').trim();
    const hb = prep(e, e.fields.headline, e.headline, { maxW: maxW * size, maxH: maxH * size, max: 76 * k * size, lines: 2, gap: 0.22 });
    const lPx = 28 * k;
    const line = String(e.fields.line ?? '').trim();
    let y = top;
    if (streak) {
        label(e, 'streak', streak, x, y + capHeight(e.ctx, TYPE.mono, sPx), { px: sPx, maxW, align, color: e.accent, spec: TYPE.mono, tracking: 0.22 });
        y += capHeight(e.ctx, TYPE.mono, sPx) + 30 * k;
    }
    hb.draw('headline', x, y, { align, color: headColor(e) });
    y += hb.h + hb.desc;
    if (line) label(e, 'line', line, x, y + 26 * k + lPx * 0.72, { px: lPx, maxW, align, color: SOFT, spec: TYPE.brandL, tracking: 0, upper: false });
}

function wordsHeight(e, maxW, maxH, k) {
    const size = e.look.size ?? 1;
    const hb = prep(e, e.fields.headline, e.headline, { maxW: maxW * size, maxH: maxH * size, max: 76 * k * size, lines: 2, gap: 0.22 });
    return (String(e.fields.streak ?? '').trim() ? capHeight(e.ctx, TYPE.mono, 18 * k) + 30 * k : 0)
        + hb.h + hb.desc + (String(e.fields.line ?? '').trim() ? 26 * k + 28 * k * 0.72 : 0);
}

function banner(e) {
    const { W, H, safe, shape } = e;
    const k = unitOf(e);
    const strip = shape === 'strip';
    ground(e, GROUND);
    const seam = W * (strip ? 0.3 : 0.4);
    e.photo({ x: 0, y: 0, w: seam, h: H });
    e.fade(0, 0, seam, H, 'right', 0.35);
    const R = Math.min((H - safe.t - safe.b) / 2 * (strip ? 0.98 : 0.8), seam * 0.6);
    dial(e, seam, H / 2, R, k);
    const x0 = seam + R + (strip ? 60 : 90) * k;
    const x1 = W - safe.r;
    const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k, lockH: strip ? 22 : 26 });
    const maxH = (footTop - safe.t) * (strip ? 0.4 : 0.3);
    const h = wordsHeight(e, x1 - x0, maxH, k);
    words(e, x0, safe.t + Math.max(0, (footTop - 30 * k - safe.t - h) / 2), x1 - x0, maxH, k, 'left');
}

export default {
    id: 'mindful-minutes',
    name: 'Minutes',
    category: 'Mind',
    blurb: 'Mindful minutes as a thin progress ring on the seam of the photo, the number ultra-light inside, the streak under it.',
    refs: 'an activity ring',
    headlineFont: 'brandL',
    fields: [
        { key: 'minutes', label: 'Number', value: '10', hint: 'Big, inside the ring.' },
        { key: 'unit', label: 'Unit', value: 'min' },
        { key: 'goal', label: 'Ring fills at', value: '15', hint: 'The arc shows the number out of this. Leave empty for a full ring.' },
        { key: 'streak', label: 'Streak', value: 'Day 21' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Ten quiet minutes.', hint: '{Braces} colour a word.' },
        { key: 'line', label: 'Line under it', value: 'Before the day had a say.' },
        { key: 'footer', label: 'Small print', value: 'Mindful minutes' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Daily sit', fields: { minutes: '10', unit: 'min', goal: '15', streak: 'Day 21', headline: 'Ten quiet minutes.', line: 'Before the day had a say.', footer: 'Mindful minutes' } },
        { name: 'Goal met', fields: { minutes: '20', unit: 'min', goal: '20', streak: 'Goal met', headline: 'Twenty, done.', line: 'Same time tomorrow.', footer: 'Northside Meditation' } },
        { name: 'Monthly', fields: { minutes: '312', unit: 'minutes', goal: '', streak: 'September', headline: 'A month of sitting still.', line: 'One session at a time.', footer: 'Your month in minutes' } },
        { name: 'Streak', fields: { minutes: '30', unit: 'days', goal: '30', streak: 'The streak is yours', headline: 'Thirty days\nof showing up.', line: 'Five minutes counts.', footer: 'Every move counts' } },
    ],
    look: { ...MIND_LOOK, mono: 0.65, target: 0.26 },
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const tall = shape === 'tall';
        const sq = shape === 'square';
        ground(e, GROUND);
        const seam = H * (tall ? 0.47 : sq ? 0.42 : 0.47);
        e.photo({ x: 0, y: 0, w: W, h: seam });
        e.fade(0, 0, W, H * 0.2, 'top', 0.35);
        e.fade(0, seam * 0.55, W, seam * 0.45, 'bottom', 0.45);
        const x0 = safe.l;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k });
        const R = tall ? W * 0.25 : sq ? H * 0.16 : W * 0.21;
        dial(e, W / 2, seam, R, k);
        const top = seam + R + (sq ? 44 : 64) * k;
        const maxH = Math.max(40 * k, (footTop - (sq ? 40 : 60) * k - top) * 0.5);
        const h = wordsHeight(e, (x1 - x0) * 0.86, maxH, k);
        words(e, W / 2, top + Math.max(0, (footTop - (sq ? 40 : 60) * k - top - h) / 2 * (tall ? 0.6 : 0.4)), (x1 - x0) * 0.86, maxH, k, 'center');
    },
};
