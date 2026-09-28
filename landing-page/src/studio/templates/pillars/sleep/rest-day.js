/**
 * REST DAY — "Rest is part of it.": a week drawn as a strip of days joined
 * by one unbroken line, the days before filled, the rest day lit in the
 * accent with a crescent in it, and the line running straight on through it
 * — the streak keeps. POWR's own post for a planned day off; a recovery or
 * sleepwear brand can take it too.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, splitLines } from '../../../text';
import { rule, dot, ring } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, backdrop, fadeTo, label, line, crescent, onAccent, readable } from './_parts';

function headline(e, x, bottom, maxW, maxH) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const lines = splitLines(e.fields.headline).slice(0, 3);
    const block = fitBlock(ctx, lines, e.headline, { maxW: maxW * size, maxH: maxH * size, gap: 0.2 });
    const top = bottom - block.cap - (lines.length - 1) * block.step;
    e.shade({ x, y: top, w: maxW, h: bottom - top }, { ceiling: 0.26, max: 0.6 });
    const boxes = drawBlock(ctx, block, e.headline, x, top, { align: 'left', color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('headline', blockBox(boxes));
    return top;
}

// The week across x..x1, circle centres on `cy`. Returns the bottom.
function week(e, x, x1, cy, k, { r, dayPx }) {
    const { ctx } = e;
    const days = String(e.fields.days ?? '').split(/[\s,·]+/).filter(Boolean).slice(0, 7);
    const n = days.length;
    if (!n) return cy;
    const rest = Math.min(n - 1, Math.max(0, Number(e.look.restDay ?? 3)));
    const colW = (x1 - x) / n;
    const X = (i) => x + colW * (i + 0.5);
    const lit = readable(e.accent);
    // The streak: one line through every day — solid to the rest day and
    // through it, dashed on into the days still to come.
    rule(ctx, X(0), cy, X(rest), cy, 'rgba(244,241,234,0.7)', 2 * k);
    if (rest < n - 1) {
        rule(ctx, X(rest), cy, X(rest + 1), cy, 'rgba(244,241,234,0.7)', 2 * k);
        ctx.save();
        ctx.setLineDash([4 * k, 7 * k]);
        rule(ctx, X(rest + 1), cy, X(n - 1), cy, 'rgba(244,241,234,0.32)', 2 * k);
        ctx.restore();
    }
    let box = null;
    days.forEach((d, i) => {
        const cx = X(i);
        const b = line(e, null, e.caps(d), TYPE.mono, dayPx, cx, cy - r * (i === rest ? 1.5 : 1) - 24 * k, { align: 'center', tracking: 0.14, color: i === rest ? lit : MUTED, maxW: colW - 6 * k });
        if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: box.h } : b;
        if (i === rest) {
            dot(ctx, cx, cy, r * 1.5, e.accent);
            crescent(ctx, cx, cy, r * 0.72, onAccent(e.accent));
        } else if (i < rest) {
            dot(ctx, cx, cy, r * 0.62, INK);
        } else {
            dot(ctx, cx, cy, r * 0.62, '#0C0E13');
            ring(ctx, cx, cy, r * 0.62, 'rgba(244,241,234,0.45)', 1.8 * k);
        }
    });
    e.mark('days', box ? { ...box, h: cy + r * 1.5 - box.y } : null);
    const lb = cy + r * 1.5 + 30 * k + dayPx * 0.72;
    line(e, 'restLabel', e.caps(e.fields.restLabel), TYPE.mono, dayPx, X(rest), lb, { align: 'center', tracking: 0.16, color: lit, maxW: colW * 1.6 });
    return lb;
}

export default {
    id: 'rest-day',
    name: 'Rest Day',
    category: 'Sleep',
    blurb: 'A week joined by one unbroken line: the rest day lit, and the streak running straight through it.',
    refs: 'a train line through a request stop',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Rest day' },
        { key: 'headline', label: 'Headline', rows: 3, value: 'Rest is\npart of it.', hint: '{Braces} colour a word.' },
        { key: 'days', label: 'Days', value: 'Mon Tue Wed Thu Fri Sat Sun', hint: 'Seven short names, spaced.' },
        { key: 'restLabel', label: 'Rest-day label', value: 'Rest' },
        { key: 'line', label: 'Line', value: 'Your streak keeps.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Rest day', fields: { eyebrow: 'Rest day', headline: 'Rest is\npart of it.', line: 'Your streak keeps.' }, look: { restDay: '3' } },
        { name: 'Sunday', fields: { eyebrow: 'Sunday', headline: 'Day off.\nStreak on.', restLabel: 'Off', line: 'The streak is yours. So is today.' }, look: { restDay: '6' } },
        { name: 'Recovery brand', fields: { eyebrow: 'Midweek', headline: 'Legs up.\nPhone down.', restLabel: 'Recover', line: 'Planned rest, still on the streak.' }, look: { restDay: '2' }, style: { accent: '#7FE0C2' } },
        { name: 'Sleepwear', fields: { eyebrow: 'Saturday', headline: 'A day for\n{pyjamas}.', restLabel: 'Lie-in', line: 'Your streak keeps.' }, look: { restDay: '5' }, style: { accent: '#B9A7E8' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.8, tintAmount: 0.6, target: 0.2, restDay: '3' },
    controls: [
        { key: 'restDay', label: 'Rest day', options: [['0', '1st day'], ['1', '2nd day'], ['2', '3rd day'], ['3', '4th day'], ['4', '5th day'], ['5', '6th day'], ['6', '7th day']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const y0 = safe.t + 4 * k;
        const y1 = H - safe.b - 4 * k;

        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const pw = W * (strip ? 0.3 : 0.42);
            const px0 = W - pw;
            backdrop(e, { x: px0, y: 0, w: pw, h: H });
            fadeTo(ctx, px0, 0, pw * 0.5, H, 'left', 1);
            const lk = lockup(e, x0, y0, (strip ? 28 : 36) * k, { maxW: (px0 - x0) * 0.5 });
            const cw = px0 - x0 - (strip ? 40 : 60) * k;
            if (strip) {
                label(e, 'eyebrow', e.fields.eyebrow, 14 * k, x0 + cw, y0 + lk.h / 2 + 5 * k, { align: 'right', maxW: cw * 0.3, color: SOFT });
                const hw = cw * 0.4;
                headline(e, x0, y1 - 64 * k, hw, (y1 - y0) * 0.46);
                line(e, 'line', e.fields.line, TYPE.brandR, 20 * k, x0, y1, { color: SOFT, maxW: hw });
                week(e, x0 + hw + 50 * k, x0 + cw, (y0 + y1) / 2 + 10 * k, k, { r: 14 * k, dayPx: 13 * k });
            } else {
                label(e, 'eyebrow', e.fields.eyebrow, 17 * k, x0, lk.y + lk.h + 60 * k, { maxW: cw, color: SOFT });
                week(e, x0, x0 + cw, y1 - 150 * k, k, { r: 18 * k, dayPx: 15 * k });
                line(e, 'line', e.fields.line, TYPE.serifI, 40 * k, x0, y1 - 4 * k, { color: SOFT, maxW: cw });
                headline(e, x0, y1 - 150 * k - 18 * k * 1.5 - 24 * k - 15 * k - 70 * k, cw * 0.9, (y1 - y0) * 0.36);
            }
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const ph = H * (tall ? 0.56 : sq ? 0.56 : 0.6);
        backdrop(e, { x: 0, y: 0, w: W, h: ph });
        fadeTo(ctx, 0, ph * 0.35, W, ph * 0.65 + 1, 'bottom', 1);
        e.fade(0, 0, W, H * 0.2, 'top', 0.45);
        const lk = lockup(e, x0, y0, 40 * k, { maxW: (x1 - x0) * 0.6 });
        label(e, 'eyebrow', e.fields.eyebrow, 18 * k, x1, lk.y + lk.h / 2 + 6 * k, { align: 'right', maxW: (x1 - x0) * 0.34, color: SOFT });

        const lPx = (sq ? 34 : 40) * k;
        const lBase = y1 - (tall ? 30 : 6) * k;
        line(e, 'line', e.fields.line, TYPE.serifI, lPx, x0, lBase, { color: SOFT, maxW: x1 - x0 });
        const r = (sq ? 18 : 22) * k;
        const dayPx = (sq ? 15 : 17) * k;
        const cy = lBase - lPx - (sq ? 50 : 70) * k - 30 * k - dayPx - r * 1.5;
        week(e, x0 - 10 * k, x1 + 10 * k, cy, k, { r, dayPx });
        const wTop = cy - r * 1.5 - 24 * k - dayPx;
        headline(e, x0, wTop - (sq ? 70 : tall ? 130 : 100) * k, (x1 - x0) * 0.86, H * (tall ? 0.15 : sq ? 0.2 : 0.18));
    },
};
