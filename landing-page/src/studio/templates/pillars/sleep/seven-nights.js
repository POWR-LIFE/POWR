/**
 * SEVEN NIGHTS — a week of sleep as a row of moons, drawn in vector and
 * waxing from a sliver on Monday to full on Sunday, each night's hours under
 * its moon and the best night ringed in the accent. The weekly recap: a
 * tracker's week in review, or POWR's Sunday post.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, splitLines, textWidth, capHeight } from '../../../text';
import { ring } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, backdrop, fadeTo, label, line, parseNights, dur, moon, readable } from './_parts';

function headline(e, x, bottom, maxW, maxH) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const lines = splitLines(e.fields.headline).slice(0, 2);
    const block = fitBlock(ctx, lines, e.headline, { maxW: maxW * size, maxH: maxH * size, gap: 0.2 });
    const top = bottom - block.cap - (lines.length - 1) * block.step;
    e.shade({ x, y: top, w: maxW, h: bottom - top }, { ceiling: 0.26, max: 0.6 });
    const boxes = drawBlock(ctx, block, e.headline, x, top, { align: 'left', color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('headline', blockBox(boxes));
    return top;
}

const summaryOf = (e, nights) => {
    const s = String(e.fields.summary ?? '').trim();
    if (s) return s;
    const got = nights.filter((n) => n.min > 0);
    return got.length ? `Average ${dur(got.reduce((a, n) => a + n.min, 0) / got.length)}` : '';
};

// The row of moons across x..x1, moon centres on `cy`. Returns its bottom.
function moons(e, x, x1, cy, k, { r: rMax, dayPx, hrsPx }) {
    const { ctx } = e;
    const nights = parseNights(e.fields.nights);
    const n = nights.length;
    if (!n) return cy;
    const colW = (x1 - x) / n;
    const r = Math.min(rMax, colW * 0.34);
    const best = nights.reduce((b, v, i) => (v.min > nights[b].min ? i : b), 0);
    const lit = readable(e.accent);
    const hp = Math.min(hrsPx, (hrsPx * (colW - 10 * k)) / Math.max(1, ...nights.map((v) => textWidth(ctx, dur(v.min), TYPE.brandL, hrsPx, 0))));
    const hCap = capHeight(ctx, TYPE.brandL, hp);
    let box = null;
    const grow = (b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; };
    let bottom = cy;
    nights.forEach((v, i) => {
        const cx = x + colW * (i + 0.5);
        const isBest = i === best && e.look.best !== 'none';
        grow(line(e, null, e.caps(v.day), TYPE.mono, dayPx, cx, cy - r - 26 * k, { align: 'center', tracking: 0.14, color: isBest ? lit : MUTED, maxW: colW - 8 * k }));
        moon(ctx, cx, cy, r, n > 1 ? 0.06 + (i / (n - 1)) * 0.44 : 0.5, 'rgba(244,241,234,0.92)', 'rgba(244,241,234,0.08)');
        if (isBest) ring(ctx, cx, cy, r + 10 * k, e.accent, 2 * k);
        const hb = cy + r + 30 * k + hCap;
        grow(line(e, null, dur(v.min), isBest ? TYPE.brandR : TYPE.brandL, hp, cx, hb, { align: 'center', color: isBest ? lit : INK }));
        bottom = hb;
        if (isBest && String(e.fields.bestLabel ?? '').trim()) {
            line(e, 'bestLabel', e.caps(e.fields.bestLabel), TYPE.mono, dayPx * 0.9, cx, hb + 20 * k + dayPx, { align: 'center', tracking: 0.16, color: lit, maxW: colW });
        }
    });
    e.mark('nights', box);
    return bottom + 20 * k + dayPx;
}

export default {
    id: 'seven-nights',
    name: 'Seven Nights',
    category: 'Sleep',
    blurb: 'A week as a row of waxing moons, each night’s hours under it, the best night ringed.',
    refs: 'an almanac’s moon table',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Week 41' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Seven nights.' },
        { key: 'summary', label: 'Summary', value: '', hint: 'Leave empty for the week’s average.' },
        { key: 'nights', label: 'Nights', rows: 7, value: 'Mon — 7h 12m\nTue — 6h 48m\nWed — 7h 30m\nThu — 6h 55m\nFri — 7h 05m\nSat — 8h 20m\nSun — 7h 44m', hint: 'One per line: day — hours (7h 12m or 7.2). One person’s week: edit to match.' },
        { key: 'bestLabel', label: 'Best-night label', value: 'Best' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Week in review', fields: { eyebrow: 'Week 41', headline: 'Seven nights.' } },
        { name: 'Tracker recap', fields: { eyebrow: 'Your week, tracked', headline: 'The week,\nby night.', nights: 'Mon — 6h 40m\nTue — 7h 05m\nWed — 6h 52m\nThu — 7h 26m\nFri — 6h 18m\nSat — 8h 02m\nSun — 7h 50m' }, style: { accent: '#9DB8FF' } },
        { name: 'New mattress', fields: { eyebrow: 'The first week', headline: 'Week one\non the new bed.', nights: 'Night 1 — 7h 02m\nNight 2 — 7h 18m\nNight 3 — 7h 40m\nNight 4 — 7h 11m\nNight 5 — 7h 55m\nNight 6 — 8h 06m\nNight 7 — 7h 47m', bestLabel: 'Longest' }, style: { accent: '#C9B79C' } },
        { name: 'POWR Sunday', fields: { eyebrow: 'POWR · Sunday recap', headline: 'Moved all week.\n{Slept} on it.', bestLabel: 'Longest' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.9, tintAmount: 0.7, target: 0.18, best: 'auto' },
    controls: [
        { key: 'best', label: 'Best night', options: [['auto', 'Ring the longest'], ['none', 'No ring']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const y0 = safe.t + 4 * k;
        const y1 = H - safe.b - 4 * k;
        const nights = parseNights(e.fields.nights);

        if (shape === 'strip') {
            const pw = W * 0.36;
            backdrop(e, { x: 0, y: 0, w: pw, h: H }, { optional: true, glow: { x: 0.15, y: 0.3 } });
            if (e.hasMedia) {
                fadeTo(ctx, pw * 0.4, 0, pw * 0.6 + 1, H, 'right', 1);
                e.fade(0, H * 0.3, pw, H * 0.7, 'bottom', 0.7);
            }
            const colW = W * 0.3;
            lockup(e, x0, y0, 28 * k, { maxW: colW });
            const sPx = 15 * k;
            line(e, 'summary', e.caps(summaryOf(e, nights)), TYPE.mono, sPx, x0, y1, { tracking: 0.16, color: SOFT, maxW: colW });
            const hTop = headline(e, x0, y1 - sPx - 30 * k, colW, (y1 - y0) * 0.36);
            label(e, 'eyebrow', e.fields.eyebrow, 14 * k, x0, hTop - 22 * k, { maxW: colW });
            moons(e, x0 + colW + 40 * k, x1, (y0 + y1) / 2 - 16 * k, k, { r: 46 * k, dayPx: 14 * k, hrsPx: 24 * k });
            return;
        }

        const wide = shape === 'wide';
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const ph = H * (wide ? 1 : tall ? 0.5 : sq ? 0.54 : 0.56);
        backdrop(e, { x: 0, y: 0, w: W, h: ph }, { optional: true, glow: { x: 0.8, y: 0.12 } });
        if (e.hasMedia) {
            fadeTo(ctx, 0, ph * (wide ? 0.25 : 0.35), W, ph * (wide ? 0.75 : 0.65) + 1, 'bottom', wide ? 0.95 : 1);
            e.fade(0, 0, W, H * 0.22, 'top', 0.45);
        }
        const lk = lockup(e, x0, y0, (wide ? 36 : 40) * k, { maxW: (x1 - x0) * 0.55 });
        label(e, 'eyebrow', e.fields.eyebrow, (sq ? 16 : 18) * k, x1, lk.y + lk.h / 2 + 6 * k, { align: 'right', maxW: (x1 - x0) * 0.36, color: SOFT });

        const dayPx = (sq ? 15 : wide ? 16 : 17) * k;
        const r = (wide ? 56 : sq ? 46 : 54) * k;
        const hrsPx = (wide ? 32 : sq ? 28 : 32) * k;
        // Moons from the bottom: best label, hours, moon, day.
        const bottom = y1 - (tall ? 40 : 6) * k;
        const cy = bottom - (dayPx + 20 * k) - capHeight(ctx, TYPE.brandL, hrsPx) - 30 * k - r;
        moons(e, x0 - 10 * k, x1 + 10 * k, cy, k, { r, dayPx, hrsPx });
        const topOfRow = cy - r - 26 * k - dayPx;
        const sPx = (sq ? 16 : 18) * k;
        const sBase = topOfRow - (sq ? 44 : tall ? 110 : 64) * k;
        line(e, 'summary', e.caps(summaryOf(e, nights)), TYPE.mono, sPx, x0, sBase, { tracking: 0.16, color: SOFT, maxW: x1 - x0 });
        headline(e, x0, sBase - sPx - (sq ? 26 : 34) * k, (x1 - x0) * (wide ? 0.6 : 0.86), H * (wide ? 0.16 : tall ? 0.1 : sq ? 0.13 : 0.13));
    },
};
