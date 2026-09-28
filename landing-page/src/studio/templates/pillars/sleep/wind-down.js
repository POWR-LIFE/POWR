/**
 * WIND-DOWN — the evening as a timeline: four or five small steps from
 * 21:00 to lights out on a thin vertical line, times in mono, the last step
 * in the accent. The photo sits in its own column beside it. For evening-
 * ritual brands (teas, sleepwear, bedding, magnesium) and for POWR's rest.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, splitLines, textWidth, capHeight } from '../../../text';
import { rule, dot, ring } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, backdrop, fadeTo, label, line, readable } from './_parts';

const parseSteps = (text) => splitLines(text).slice(0, 5).map((l) => {
    const m = l.trim().match(/^(\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm))\s*[—–|-]*\s*(.*)$/i);
    return m ? { time: m[1], name: m[2].trim() } : { time: '', name: l.trim() };
}).filter((s) => s.name || s.time);

// The headline, fitted into maxW × maxH with its cap top at `top`.
function headline(e, x, top, maxW, maxH, align = 'left') {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const lines = splitLines(e.fields.headline).slice(0, 3);
    const block = fitBlock(ctx, lines, e.headline, { maxW: maxW * size, maxH: maxH * size, gap: 0.3 });
    const boxes = drawBlock(ctx, block, e.headline, x, top, { align, color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('headline', blockBox(boxes));
    return boxes.length ? boxes[boxes.length - 1].baseline : top;
}

// The vertical timeline between `top` and `bottom`, from x.
function column(e, x, top, bottom, maxW, k, { namePx, timePx }) {
    const { ctx } = e;
    const steps = parseSteps(e.fields.steps);
    if (!steps.length) return;
    const n = steps.length;
    const timeW = textWidth(ctx, '00:00', TYPE.mono, timePx, 0.06);
    const lx = x + timeW + 30 * k;
    const nx = lx + 34 * k;
    const stepY = n > 1 ? Math.min((bottom - top) / (n - 1), namePx * 3.4) : 0;
    const y0 = top + (n > 1 ? (bottom - top - stepY * (n - 1)) / 2 : (bottom - top) / 2);
    const Y = (i) => y0 + i * stepY;
    rule(ctx, lx, Y(0), lx, Y(n - 1), 'rgba(244,241,234,0.26)', 1.5 * k);
    const cap = capHeight(ctx, TYPE.brandL, namePx);
    const lit = readable(e.accent);
    let box = null;
    steps.forEach((s, i) => {
        const last = i === n - 1;
        const y = Y(i);
        if (last) {
            dot(ctx, lx, y, 9 * k, e.accent);
            ring(ctx, lx, y, 16 * k, e.accent, 1.5 * k);
        } else {
            dot(ctx, lx, y, 7 * k, '#0E1015');
            ring(ctx, lx, y, 6 * k, 'rgba(244,241,234,0.7)', 2 * k);
        }
        const t = line(e, null, s.time, TYPE.mono, timePx, lx - 30 * k, y + timePx * 0.36, { align: 'right', tracking: 0.06, color: last ? lit : MUTED });
        const nm = line(e, null, s.name, last ? TYPE.brandR : TYPE.brandL, namePx, nx, y + cap / 2, { maxW: x + maxW - nx, color: last ? lit : INK });
        [t, nm].forEach((b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; });
    });
    e.mark('steps', box);
}

// Banner strip: the same steps laid across, time over the line, step under.
function across(e, x, x1, y, k, { namePx, timePx }) {
    const steps = parseSteps(e.fields.steps);
    const n = steps.length;
    if (!n) return;
    const colW = (x1 - x) / n;
    const lit = readable(e.accent);
    rule(e.ctx, x + 8 * k, y, x + colW * (n - 1) + 8 * k, y, 'rgba(244,241,234,0.26)', 1.5 * k);
    let box = null;
    steps.forEach((s, i) => {
        const cx = x + i * colW + 8 * k;
        const last = i === n - 1;
        if (last) { dot(e.ctx, cx, y, 8 * k, e.accent); ring(e.ctx, cx, y, 14 * k, e.accent, 1.5 * k); } else { dot(e.ctx, cx, y, 6 * k, '#0E1015'); ring(e.ctx, cx, y, 5.5 * k, 'rgba(244,241,234,0.7)', 2 * k); }
        const t = line(e, null, s.time, TYPE.mono, timePx, cx - 8 * k, y - 26 * k, { tracking: 0.06, color: last ? lit : MUTED, maxW: colW - 16 * k });
        const nm = line(e, null, s.name, last ? TYPE.brandR : TYPE.brandL, namePx, cx - 8 * k, y + 30 * k + namePx * 0.72, { maxW: colW - 20 * k, color: last ? lit : INK });
        [t, nm].forEach((b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; });
    });
    e.mark('steps', box);
}

export default {
    id: 'wind-down',
    name: 'Wind-down',
    category: 'Sleep',
    blurb: 'The evening as a timeline: a few small steps to lights out, the last one in the accent.',
    refs: 'a hotel turndown card',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'The wind-down' },
        { key: 'headline', label: 'Headline', rows: 3, value: 'The hour\nbefore bed.', hint: 'Short and calm. {Braces} colour a word.' },
        { key: 'steps', label: 'Steps', rows: 5, value: '21:00 — Screens off\n21:20 — Stretch\n21:45 — Tea\n22:15 — Read\n22:45 — Lights out', hint: 'One per line: time — step. Up to five; the last one is lit.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Evening', fields: { eyebrow: 'The wind-down', headline: 'The hour\nbefore bed.' } },
        { name: 'Tea brand', fields: { eyebrow: 'Tonight’s ritual', headline: 'Kettle on.\nDay off.', steps: '21:15 — Phone on charge\n21:30 — Kettle on\n21:40 — One cup, no rush\n22:00 — A few pages\n22:30 — Lights out' }, style: { accent: '#D8B98A' } },
        { name: 'Sleepwear', fields: { eyebrow: 'Sunday night', headline: 'Slow\nSunday.', steps: '20:30 — Bath\n21:00 — Pyjamas on\n21:30 — Screens away\n22:15 — Lights out' }, style: { accent: '#B9A7E8' } },
        { name: 'Rest day', fields: { eyebrow: 'Rest day · POWR', headline: 'Rest is\n{earned} too.', steps: '19:00 — Walk, no watch\n20:30 — Stretch\n21:30 — Screens off\n22:30 — Lights out' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.75, tintAmount: 0.55, target: 0.2 },
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
            backdrop(e, { x: 0, y: 0, w: pw, h: H });
            fadeTo(ctx, pw * 0.6, 0, pw * 0.4 + 1, H, 'right', 1);
            const cx = pw + (strip ? 30 : 50) * k;
            const lk = lockup(e, x1, y0, (strip ? 28 : 36) * k, { align: 'right', maxW: (x1 - cx) * 0.4 });
            const ePx = (strip ? 14 : 17) * k;
            label(e, 'eyebrow', e.fields.eyebrow, ePx, cx, y0 + lk.h / 2 + ePx * 0.36, { maxW: (x1 - cx) * 0.5, color: SOFT });
            if (strip) {
                headline(e, cx, y0 + lk.h + 26 * k, (x1 - cx) * 0.7, (y1 - y0) * 0.3);
                across(e, cx, x1, y0 + (y1 - y0) * 0.72, k, { namePx: 26 * k, timePx: 15 * k });
            } else {
                const colW = (x1 - cx) * 0.46;
                headline(e, cx, y0 + lk.h + 60 * k, colW, (y1 - y0) * 0.4);
                const tx = cx + colW + 50 * k;
                column(e, tx, y0 + lk.h + 70 * k, y1 - 20 * k, x1 - tx, k, { namePx: 42 * k, timePx: 18 * k });
            }
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        if (tall) {
            const ph = H * 0.44;
            backdrop(e, { x: 0, y: 0, w: W, h: ph });
            fadeTo(ctx, 0, ph * 0.4, W, ph * 0.6 + 1, 'bottom', 1);
            e.fade(0, 0, W, H * 0.2, 'top', 0.45);
            const lk = lockup(e, x0, y0, 40 * k, { maxW: (x1 - x0) * 0.6 });
            label(e, 'eyebrow', e.fields.eyebrow, 18 * k, x1, lk.y + lk.h / 2 + 6 * k, { align: 'right', maxW: (x1 - x0) * 0.36, color: SOFT });
            const hb = headline(e, x0, ph - H * 0.08, (x1 - x0) * 0.8, H * 0.13);
            column(e, x0, hb + 110 * k, y1 - 30 * k, x1 - x0, k, { namePx: 50 * k, timePx: 21 * k });
            return;
        }

        // Post, square, print: the photo is a column on the right.
        const pw = W * (sq ? 0.42 : 0.44);
        const px = W - pw;
        backdrop(e, { x: px, y: 0, w: pw, h: H });
        fadeTo(ctx, px, 0, pw * 0.4, H, 'left', 1);
        const colW = px - x0 - 30 * k;
        const lk = lockup(e, x0, y0, 40 * k, { maxW: colW });
        const ePx = (sq ? 16 : 18) * k;
        const eBase = lk.y + lk.h + (sq ? 60 : 80) * k;
        label(e, 'eyebrow', e.fields.eyebrow, ePx, x0, eBase, { maxW: colW, color: SOFT });
        const hb = headline(e, x0, eBase + (sq ? 30 : 40) * k, colW, H * (sq ? 0.2 : 0.2));
        column(e, x0, hb + (sq ? 80 : 120) * k, y1 - 20 * k, colW + 20 * k, k, { namePx: (sq ? 36 : 42) * k, timePx: (sq ? 17 : 19) * k });
    },
};
