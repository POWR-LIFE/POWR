/**
 * RITUAL — an evening product's ritual card: the partner's logo large at the
 * top, the product's name in serif, a "30 min before bed" timing line, then
 * three numbered steps with a short verb each. A dark card laid over the
 * photo, like the insert in the box. Timing only — never a dose or a
 * benefit. For teas, magnesium, pillow sprays, sleepwear, candles.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, blockBox, splitLines, capHeight } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, hasPartner, brandMark, rewardWords } from '../kit';
import { NIGHT_LOOK, INK, SOFT, MUTED, HAIR, backdrop, label, line, nightRgba, crescent, readable } from './_parts';

const parseSteps = (text) => splitLines(text).slice(0, 3).map((l) => {
    const m = l.trim().match(/^(.*?)\s+[—–|-]\s+(.+)$/);
    return m ? { verb: m[1], note: m[2] } : { verb: l.trim(), note: '' };
}).filter((s) => s.verb);

const grow = (box, b) => (!b ? box : !box ? b : { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) });

// The card in `c` (x, y, w, h). `row` lays the steps across instead of down.
function card(e, c, k, { row = false, compact = false } = {}) {
    const { ctx } = e;
    ctx.fillStyle = nightRgba(0.88);
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = 'rgba(244,241,234,0.16)';
    ctx.lineWidth = 1.5 * k;
    ctx.strokeRect(c.x + 0.75 * k, c.y + 0.75 * k, c.w - 1.5 * k, c.h - 1.5 * k);
    const P = (compact ? 30 : 52) * k;
    const x = c.x + P;
    const x1 = c.x + c.w - P;
    let y = c.y + P;
    const lit = readable(e.accent);

    // Head: the partner's mark large, else the eyebrow.
    const markH = (compact ? 46 : row ? 64 : 84) * k;
    if (hasPartner(e)) {
        // Compact cards keep the POWR mark top right, so the eyebrow steps left of it.
        const ex = compact ? x1 - 72 * k : x1;
        brandMark(e, { x, y, w: (x1 - x) * (compact ? 0.5 : 0.6), h: markH }, { align: 'left' });
        label(e, 'eyebrow', e.fields.eyebrow, (compact ? 13 : 16) * k, ex, y + markH / 2 + 5 * k, { align: 'right', maxW: (x1 - x) * (compact ? 0.26 : 0.34) });
        y += markH + (compact ? 22 : 44) * k;
    } else {
        label(e, 'eyebrow', e.fields.eyebrow, (compact ? 13 : 17) * k, x, y + 14 * k, { maxW: x1 - x - (compact ? 80 * k : 0), color: SOFT });
        y += (compact ? 34 : 56) * k;
    }

    // Product name, then the timing line.
    const size = e.look.size ?? 1;
    const pLines = splitLines(e.fields.product).slice(0, 2);
    const block = fitBlock(ctx, pLines, e.headline, { maxW: (x1 - x) * (row ? 0.5 : 1) * size, maxH: (compact ? 60 : row ? 110 : 150) * k * size, gap: 0.14 });
    const heads = drawBlock(ctx, block, e.headline, x, y, { align: 'left', color: e.headlineAccent ? e.accent : INK, accent: e.accent });
    e.mark('product', blockBox(heads));
    y = heads[heads.length - 1].baseline + (compact ? 30 : 44) * k;
    const tPx = (compact ? 13 : 17) * k;
    crescent(ctx, x + tPx * 0.5, y - tPx * 0.36, tPx * 0.55, e.accent);
    label(e, 'timing', e.fields.timing, tPx, x + tPx * 1.5, y, { maxW: x1 - x - tPx * 1.5, color: lit });
    y += (compact ? 26 : 40) * k;
    rule(ctx, x, y, x1, y, HAIR, 1.5 * k);

    // Steps.
    const steps = parseSteps(e.fields.steps);
    const bottom = c.y + c.h - P - (compact ? 0 : 40 * k);
    const numPx = (compact ? 13 : 16) * k;
    let box = null;
    if (row) {
        const colW = (x1 - x) / Math.max(1, steps.length);
        const vPx = (compact ? 36 : 40) * k;
        const vy = y + (bottom - y) / 2;
        steps.forEach((s, i) => {
            const sx = x + i * colW;
            box = grow(box, line(e, null, String(i + 1).padStart(2, '0'), TYPE.mono, numPx, sx, vy - vPx * 0.9, { tracking: 0.1, color: lit }));
            box = grow(box, line(e, null, s.verb, TYPE.brandL, vPx, sx, vy + vPx * 0.5, { maxW: colW - 24 * k, color: INK }));
        });
    } else {
        const n = Math.max(1, steps.length);
        const stepH = (bottom - y) / n;
        const vPx = Math.min(stepH * 0.4, 60 * k);
        const nPx = Math.min(vPx * 0.5, 26 * k);
        const cap = capHeight(ctx, TYPE.brandL, vPx);
        steps.forEach((s, i) => {
            const top = y + i * stepH;
            const base = top + stepH / 2 + (s.note ? -nPx * 0.3 : cap / 2);
            if (i) rule(ctx, x, top, x1, top, 'rgba(244,241,234,0.08)', 1.5 * k);
            box = grow(box, line(e, null, String(i + 1).padStart(2, '0'), TYPE.mono, numPx, x, base, { tracking: 0.1, color: lit }));
            const vx = x + numPx * 4;
            box = grow(box, line(e, null, s.verb, TYPE.brandL, vPx, vx, base, { maxW: x1 - vx, color: INK }));
            if (s.note) box = grow(box, line(e, null, s.note, TYPE.brandR, nPx, vx, base + nPx * 1.5, { maxW: x1 - vx, color: MUTED }));
        });
    }
    e.mark('steps', box);

    // Foot: the POWR mark and the offer, if there is one.
    if (!compact) {
        const fb = c.y + c.h - P + 6 * k;
        const lw = 64 * k;
        e.logo(INK, x, fb - lw * 0.62, lw);
        line(e, 'offer', e.fields.offer, TYPE.brandR, 20 * k, x1, fb, { align: 'right', maxW: x1 - x - lw - 40 * k, color: SOFT });
    } else {
        const lw = 48 * k;
        e.logo(INK, x1 - lw, c.y + P, lw);
    }
}

export default {
    id: 'ritual',
    name: 'Ritual',
    category: 'Sleep',
    blurb: 'An evening product’s ritual card: partner logo large, the product, when, and three short steps.',
    refs: 'the card inside the box',
    headlineFont: 'serif',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'The evening ritual' },
        { key: 'product', label: 'Product', rows: 2, value: 'Evening Blend' },
        { key: 'timing', label: 'Timing', value: '30 min before bed', hint: 'When, not how much. No doses, no benefits.' },
        { key: 'steps', label: 'Steps', rows: 3, value: 'Brew — Kettle on, one mug.\nDim — Lamps, not the big light.\nBreathe — Slow, no rush.', hint: 'Three, one per line: a verb — an optional short note.' },
        { key: 'offer', label: 'Offer (card foot)', value: '', hint: 'Optional, e.g. 20% off with POWR points.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Tea', fields: { eyebrow: 'The evening ritual', product: 'Evening Blend', timing: '30 min before bed', steps: 'Brew — Kettle on, one mug.\nDim — Lamps, not the big light.\nBreathe — Slow, no rush.' }, style: { accent: '#D8B98A' } },
        { name: 'Pillow spray', fields: { eyebrow: 'Lights-out ritual', product: 'Lavender\nPillow Mist', timing: 'Just before lights out', steps: 'Spray — Two mists, pillow corner.\nSettle — Phone face down.\nRest — Lights off.' }, style: { accent: '#B9A7E8' } },
        { name: 'Magnesium', fields: { eyebrow: 'Evening routine', product: 'Night Flakes', timing: 'In the bath, before bed', steps: 'Run — A warm bath.\nSoak — Ten quiet minutes.\nWrap — Robe on, screens off.' }, style: { accent: '#9DB8FF' } },
        { name: 'POWR rest', fields: { eyebrow: 'Rest day', product: 'The Rest Day', timing: 'From 21:00', steps: 'Stretch — Ten slow minutes.\nDim — Screens off.\nSleep — The streak keeps.' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.7, tintAmount: 0.5, target: 0.18, crush: 0.2 },
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            ...(r.value ? { offer: `${r.value}${r.unit ? ` ${r.unit}` : ''} with POWR points` } : {}),
        }),
    },

    draw(e) {
        const { W, H, safe, shape } = e;
        const k = e.tu;
        backdrop(e, { x: 0, y: 0, w: W, h: H });
        const x0 = safe.l;
        const x1 = W - safe.r;
        const y0 = safe.t;
        const y1 = H - safe.b;

        if (shape === 'strip') {
            const cx = W * 0.34;
            card(e, { x: cx, y: y0, w: x1 - cx, h: y1 - y0 }, k, { row: true, compact: true });
            return;
        }
        if (shape === 'wide' || shape === 'square') {
            const cx = W * (shape === 'wide' ? 0.5 : 0.36);
            card(e, { x: cx, y: y0, w: x1 - cx, h: y1 - y0 }, k);
            e.fade(0, 0, cx, H * 0.3, 'top', 0.3);
            return;
        }
        const top = H * (shape === 'tall' ? 0.34 : 0.3);
        card(e, { x: x0, y: top, w: x1 - x0, h: y1 - top }, k);
    },
};
