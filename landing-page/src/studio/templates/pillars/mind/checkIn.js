/**
 * CHECK-IN — a mood scale: five points on a hairline, one picked in the
 * accent with a ring round it, a word under each, and the question above in
 * serif. Asks, never diagnoses. For wellness apps, studios' daily check-ins
 * and POWR's end-of-week posts.
 */
import { TYPE } from '../../../fonts';
import { rule, dot, ring } from '../../../shapes';
import { capHeight } from '../../../text';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, SOFT, DIM, unitOf, veil, prep, footRow, headColor, label, rewardLine } from './_parts';

const points = (s) => String(s ?? '').split(/\s*[·•|\n]\s*/).map((t) => t.trim()).filter(Boolean).slice(0, 7);

// The scale on one line from x0 to x1 with its dots at y. Returns its box.
function scale(e, x0, x1, y, k) {
    const { ctx } = e;
    const pts = points(e.fields.scale);
    const n = Math.max(pts.length, 2);
    const pick = Math.round(Number(String(e.fields.pick ?? '').replace(/[^\d]/g, ''))) - 1;
    const inset = (x1 - x0) * (0.5 / n);
    const X = (i) => x0 + inset + (i * (x1 - x0 - inset * 2)) / (n - 1);
    rule(ctx, x0, y, x1, y, 'rgba(244,241,234,0.3)', Math.max(1, 1.3 * k));
    const px = 22 * k;
    const cap = capHeight(ctx, TYPE.brandL, px);
    const base = y + 44 * k + cap;
    const cell = (x1 - x0 - inset * 2) / (n - 1);
    pts.forEach((p, i) => {
        const on = i === pick;
        if (on) {
            ring(ctx, X(i), y, 22 * k, e.accent, Math.max(1, 1.5 * k));
            dot(ctx, X(i), y, 10 * k, e.accent);
            e.mark('pick', { x: X(i) - 22 * k, y: y - 22 * k, w: 44 * k, h: 44 * k });
        } else {
            dot(ctx, X(i), y, 4.5 * k, 'rgba(244,241,234,0.62)');
        }
        label(e, null, p, X(i), base, { px, maxW: cell * 0.92, align: 'center', color: on ? e.ink : DIM, spec: on ? TYPE.brandR : TYPE.brandL, tracking: 0.04, upper: false });
    });
    const box = { x: x0, y: y - 22 * k, w: x1 - x0, h: base - (y - 22 * k) };
    e.mark('scale', box);
    return box;
}

function strip(e) {
    const { W, H, safe } = e;
    const k = unitOf(e);
    const size = e.look.size ?? 1;
    e.photo({ x: 0, y: 0, w: W, h: H });
    veil(e, 0.3);
    e.fade(0, 0, W * 0.6, H, 'left', 0.6);
    const x0 = safe.l;
    const mid = W * 0.46;
    const footTop = footRow(e, { x0, x1: mid - 40 * k, bottom: H - safe.b, k, lockH: 22 });
    const qb = prep(e, e.fields.question, e.headline, { maxW: (mid - x0 - 40 * k) * size, maxH: (footTop - safe.t - 30 * k) * size, max: 70 * k, lines: 2, gap: 0.3 });
    qb.draw('question', x0, safe.t + (footTop - 24 * k - safe.t - qb.h) / 2, { color: headColor(e) });
    scale(e, mid + 30 * k, W - safe.r, H / 2 - 20 * k, k);
}

export default {
    id: 'check-in',
    name: 'Check-in',
    category: 'Mind',
    blurb: 'A mood scale: five points on a line, one picked in the accent, the question above. Asks, never diagnoses.',
    refs: 'a mood-tracker scale',
    headlineFont: 'serif',
    fields: [
        { key: 'question', label: 'Question', rows: 2, value: 'How did today _land_?', hint: '_Underscores_ set a word in italic, {braces} colour it.' },
        { key: 'scale', label: 'Scale (low to high)', value: 'Low · Flat · Steady · Good · Bright', hint: 'Three to seven words, separated with ·' },
        { key: 'pick', label: 'Picked point', value: '4', hint: 'Its number along the scale, from 1. Leave empty for none.' },
        { key: 'line', label: 'Line under it', value: 'No wrong answers. Just notice it.' },
        { key: 'footer', label: 'Small print', value: 'Evening check-in' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Evening', fields: { question: 'How did today _land_?', scale: 'Low · Flat · Steady · Good · Bright', pick: '4', line: 'No wrong answers. Just notice it.', footer: 'Evening check-in' } },
        { name: 'Energy', fields: { question: 'Where’s your\nenergy at?', scale: 'Empty · Low · Level · Up · Full', pick: '3', line: 'Train to match it, not to fight it.', footer: 'Before you train' } },
        { name: 'Week', fields: { question: 'How was\nyour _week_?', scale: 'Heavy · Busy · Fine · Good · Great', pick: '4', line: 'Tell us in the comments.', footer: 'Friday check-in · Northside' } },
        { name: 'Three points', fields: { question: 'Right now, you feel…', scale: 'Wired · Settled · Sleepy', pick: '2', line: 'Take one breath before you answer.', footer: 'Check in with yourself' } },
    ],
    look: { ...MIND_LOOK, mono: 0.7, target: 0.22 },
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const sq = shape === 'square';
        const wide = shape === 'wide';
        e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.12);
        e.fade(0, 0, W, H * 0.24, 'top', 0.5);
        e.fade(0, H * (wide ? 0.25 : 0.35), W, H * (wide ? 0.75 : 0.65), 'bottom', 0.92);
        const x0 = safe.l;
        const x1 = W - safe.r;
        // The sign-off sits at the top here; the scale owns the foot.
        footRow(e, { x0, x1, bottom: safe.t + 26 * k, k });

        const bottom = H - safe.b;
        const lPx = (sq ? 24 : 27) * k;
        const hasLine = String(e.fields.line ?? '').trim() !== '';
        const lineBase = bottom - 4 * k;
        if (hasLine) label(e, 'line', e.fields.line, x0, lineBase, { px: lPx, maxW: x1 - x0, color: SOFT, spec: TYPE.brandL, tracking: 0, upper: false });
        const labPx = 22 * k;
        const scaleY = (hasLine ? lineBase - lPx - (sq ? 56 : 80) * k : bottom) - 44 * k - capHeight(e.ctx, TYPE.brandL, labPx) - 6 * k;
        scale(e, x0, x1, scaleY, k);

        const qBottom = scaleY - (sq ? 76 : wide ? 90 : 110) * k;
        const qb = prep(e, e.fields.question, e.headline, {
            maxW: (x1 - x0) * (wide ? 0.62 : 0.9) * size,
            maxH: Math.min(H * (sq ? 0.2 : wide ? 0.26 : 0.22), qBottom - safe.t - 120 * k) * size,
            max: (sq ? 92 : 110) * k * size,
            lines: 3,
            gap: 0.28,
        });
        const top = qBottom - qb.h;
        e.shade({ x: x0, y: top, w: (x1 - x0) * 0.8, h: qb.h }, { ceiling: 0.28, max: 0.55 });
        qb.draw('question', x0, top, { color: headColor(e) });
    },
};
