/**
 * MORNING / EVENING — two rituals side by side: the frame split down the
 * middle, the morning half a shade lighter under a rising sun, the evening
 * half darker under a crescent. Each has its time in mono, a product and
 * two or three numbered steps. For journals, candles, teas, oils and apps
 * with a morning and an evening use.
 */
import { TYPE } from '../../../../fonts';
import { capHeight } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, HAIR, frame, ground, veil, footRow, footH, headColor, glow, framedShot, fitPx,
    lineItem, blockItem, stack, items, productFill, readableAccent,
} from './_parts';

const SIDES = [
    { key: 'am', kind: 'jar', icon: 'sun' },
    { key: 'pm', kind: 'candle', icon: 'moon' },
];

// A half sun on a horizon, or a crescent, centred on (cx, cy), r the radius.
function icon(e, which, cx, cy, r, k) {
    const { ctx } = e;
    ctx.save();
    if (which === 'sun') {
        ctx.fillStyle = e.accent;
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.45, r, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        rule(ctx, cx - r * 2, cy + r * 0.45, cx + r * 2, cy + r * 0.45, 'rgba(244,241,234,0.5)', Math.max(1, 1.2 * k));
        return;
    }
    ctx.beginPath();
    ctx.rect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    ctx.arc(cx + r * 0.5, cy - r * 0.36, r * 0.84, 0, Math.PI * 2);
    ctx.clip('evenodd');
    ctx.fillStyle = e.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Label and time: "Morning" in serif, "07:00" in mono beside it. Returns a stack piece.
function heading(e, side, x, w, k, { px, align = 'left' }) {
    const { ctx } = e;
    const label = String(e.fields[`${side.key}Label`] ?? '').trim();
    const time = String(e.fields[`${side.key}Time`] ?? '').trim();
    if (!label && !time) return null;
    const lp = label ? fitPx(ctx, label, e.headline, px, w * 0.7) : 0;
    const cap = label ? capHeight(ctx, e.headline, lp) : capHeight(ctx, TYPE.mono, 17 * k);
    return {
        h: cap,
        draw: (y) => {
            const b = label ? lineItem(e, `${side.key}Label`, label, x, { px: lp, spec: e.headline, color: headColor(e), tracking: 0, upper: false, align }).draw(y) : null;
            if (time) {
                const tPx = 17 * k;
                const tx = align === 'center' ? x : b ? b.x + b.w + 22 * k : x;
                lineItem(e, `${side.key}Time`, time, tx, { px: tPx, spec: TYPE.mono, color: 'rgba(244,241,234,0.6)', tracking: 0.14, align: 'left', maxW: w * 0.3 })
                    ?.draw(y + cap - capHeight(ctx, TYPE.mono, tPx));
            }
        },
    };
}

// The steps: "1" in serif, the step in light Outfit, hairlines between.
function steps(e, side, x, w, k, { px = 26 * k, rowH = 64 * k } = {}) {
    const { ctx } = e;
    const list = items(e.fields[`${side.key}Steps`], 4);
    if (!list.length) return null;
    const numW = px * 1.5;
    const p = Math.max(px * 0.8, Math.min(px, ...list.map((t) => fitPx(ctx, t, TYPE.brandL, px, w - numW))));
    const cap = capHeight(ctx, TYPE.brandL, p);
    return {
        h: list.length * rowH,
        draw: (y) => {
            list.forEach((t, i) => {
                const ry = y + i * rowH;
                rule(ctx, x, ry, x + w, ry, HAIR, Math.max(1, 1.1 * k));
                const base = ry + rowH / 2 + cap / 2;
                lineItem(e, null, String(i + 1), x, { px: p * 1.15, spec: TYPE.serif, color: readableAccent(e), tracking: 0, upper: false }).draw(base - capHeight(ctx, TYPE.serif, p * 1.15));
                lineItem(e, null, t, x + numW, { px: p, spec: TYPE.brandL, maxW: w - numW, color: e.ink, tracking: 0, upper: false, min: 1 }).draw(base - cap);
            });
            e.mark(`${side.key}Steps`, { x, y, w, h: list.length * rowH });
        },
    };
}

function product(e, side, box) {
    if (framedShot(e)) {
        const w = Math.min(box.w, box.h * 0.8);
        const h = Math.min(box.h, w * 1.25);
        productShot(e, { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h }, { stage: false, radius: 6 });
        return;
    }
    const h = Math.min(box.h, box.w * 1.1);
    const b = { x: box.x, y: box.y + box.h - h, w: box.w, h };
    glow(e, b.x + b.w / 2, b.y + b.h * 0.6, b.w * 0.5, b.h * 0.5, 0.14);
    productShot(e, b, { kind: side.kind, sub: e.fields[`${side.key}Label`] });
}

// The two halves' grounds (and the photo, dimmed, if there is one).
function halves(e, split, vertical = true) {
    const { ctx, W, H } = e;
    ground(e, '#0B0A09');
    if (e.hasMedia) {
        e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.55);
    }
    ctx.save();
    ctx.fillStyle = e.hasMedia ? 'rgba(255,240,220,0.05)' : '#1A1612';
    if (vertical) ctx.fillRect(0, 0, split, H);
    else ctx.fillRect(0, 0, W, split);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    if (vertical) ctx.fillRect(split, 0, W - split, H);
    else ctx.fillRect(0, split, W, H - split);
    ctx.restore();
}

export default {
    id: 'morning-evening',
    name: 'Morning / Evening',
    category: 'Mind',
    section: 'Products',
    blurb: 'Two rituals side by side: a lighter morning half under a rising sun, a darker evening half under a crescent, each with its time, a product and two or three steps.',
    refs: 'a skincare AM / PM routine card',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'title', label: 'Title', rows: 2, value: 'Twice a day', hint: 'Leave empty to hide it. {Braces} colour a word.' },
        { key: 'amLabel', label: 'Morning: label', value: 'Morning' },
        { key: 'amTime', label: 'Morning: time', value: '07:00' },
        { key: 'amSteps', label: 'Morning: steps', rows: 3, value: 'Window open\nThree lines in the journal\nTea before the phone', hint: 'One per line, two or three.' },
        { key: 'pmLabel', label: 'Evening: label', value: 'Evening' },
        { key: 'pmTime', label: 'Evening: time', value: '21:30' },
        { key: 'pmSteps', label: 'Evening: steps', rows: 3, value: 'Light the candle\nOne page, then close it\nLights low by ten', hint: 'One per line, two or three.' },
        { key: 'footer', label: 'Small print', value: 'The daily set · £48 or 4,800 POWR points' },
        { ...PRODUCT_FIELD, hint: 'Shown in both halves. With no upload, a jar for the morning and a candle for the evening stand in.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Daily set', fields: { title: 'Twice a day', amLabel: 'Morning', amTime: '07:00', amSteps: 'Window open\nThree lines in the journal\nTea before the phone', pmLabel: 'Evening', pmTime: '21:30', pmSteps: 'Light the candle\nOne page, then close it\nLights low by ten', footer: 'The daily set · £48 or 4,800 POWR points' } },
        { name: 'Tea', fields: { title: 'Two blends', amLabel: 'Wake', amTime: '07:30', amSteps: 'Green tea, sencha\nWater at 80°C\nTwo minutes', pmLabel: 'Unwind', pmTime: '21:00', pmSteps: 'Chamomile and oat straw\nJust off the boil\nFive minutes', footer: 'Northside Tea · 20 bags each' } },
        { name: 'App', fields: { title: 'Bookends', amLabel: 'Morning', amTime: '5 min', amSteps: 'One intention\nA short sit', pmLabel: 'Night', pmTime: '10 min', pmSteps: 'Three good things\nA body scan', footer: 'Northside app · Premium with POWR points' } },
        { name: 'Oil', fields: { title: 'One oil, two ways', amLabel: 'AM', amTime: 'Shower', amSteps: 'Three drops on the floor\nRun it hot\nBreathe it in', pmLabel: 'PM', pmTime: 'Pillow', pmSteps: 'One drop on the pillow\nLights off\nPhone in the other room', footer: 'Northside Home · 10 ml · £18' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, target: 0.2 },
    fill: { reward: (r) => { const f = productFill(r); return { ...f, footer: f.points }; } },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k, size } = f;

        if (f.strip) {
            halves(e, W * 0.24 + (W - W * 0.24) / 2);
            const tx = f.x0;
            const tw = W * 0.2;
            const t = blockItem(e, 'title', e.fields.title, tx, e.headline, { maxW: tw * size, maxH: (f.bottom - f.top) * 0.4 * size, max: 60 * k * size, lines: 2, gap: 0.2 }, { color: headColor(e) });
            t?.draw(f.top + 10 * k);
            footRow(e, { x0: tx, x1: tx + tw, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            const x0 = W * 0.24;
            const hw = (W - x0) / 2;
            SIDES.forEach((side, i) => {
                const hx = x0 + i * hw + 40 * k;
                const pw = hw * 0.34;
                product(e, side, { x: hx, y: f.top, w: pw, h: f.bottom - f.top });
                const sx = hx + pw + 36 * k;
                const sw = x0 + (i + 1) * hw - (i ? W - f.x1 : 40 * k) - sx;
                icon(e, side.icon, sx + 20 * k, f.top + 16 * k, 14 * k, k);
                const list = [heading(e, side, sx + 64 * k, sw - 64 * k, k, { px: 40 * k }), steps(e, side, sx, sw, k, { px: 22 * k, rowH: 44 * k })];
                if (list[1]) list[1].before = 30 * k;
                if (list[0]) list[0].draw(f.top);
                list[1]?.draw(f.top + (list[0]?.h ?? 0) + 34 * k);
            });
            rule(e.ctx, x0 + hw, f.top, x0 + hw, f.bottom, HAIR, Math.max(1, 1.1 * k));
            return;
        }

        // Every other shape: two columns under an optional title.
        const split = W / 2;
        halves(e, split);
        const footTop = f.bottom - footH(e, k, { align: 'center' });
        const top = f.top + (f.tall ? 40 : 0) * k;
        const t = blockItem(e, 'title', e.fields.title, W / 2, e.headline, { maxW: (f.x1 - f.x0) * 0.8 * size, maxH: H * (f.wide ? 0.12 : 0.08) * size, max: (f.sq ? 60 : 76) * k * size, lines: 2, gap: 0.2 }, { align: 'center', color: headColor(e) });
        const colTop = top + (t ? t.h + (f.sq ? 40 : 60) * k : 0);
        rule(e.ctx, split, colTop, split, footTop - (f.sq ? 30 : 50) * k, HAIR, Math.max(1, 1.1 * k));
        const gut = (f.wide ? 70 : f.sq ? 36 : 44) * k;
        const colBottom = footTop - (f.sq ? 36 : 60) * k;
        SIDES.forEach((side, i) => {
            const cx0 = i ? split + gut : f.x0;
            const cx1 = i ? f.x1 : split - gut;
            const cw = cx1 - cx0;
            const r = (f.sq ? 16 : 20) * k;
            const hd = heading(e, side, cx0, cw, k, { px: (f.sq ? 44 : f.wide ? 56 : 54) * k });
            const st = steps(e, side, cx0, cw, k, { px: (f.sq ? 22 : f.tall ? 28 : 26) * k, rowH: (f.sq ? 50 : f.tall ? 76 : 64) * k });
            const iconH = r * 1.6;
            const headBottom = colTop + iconH + 34 * k + (hd?.h ?? 0);
            const stTop = colBottom - (st?.h ?? 0);
            icon(e, side.icon, cx0 + r * 2, colTop + r * 0.8, r, k);
            hd?.draw(colTop + iconH + 34 * k);
            product(e, side, { x: cx0 + cw * 0.08, y: headBottom + (f.sq ? 30 : 50) * k, w: cw * 0.84, h: stTop - (f.sq ? 30 : 50) * k - headBottom - (f.sq ? 30 : 50) * k });
            st?.draw(stTop);
        });
        stack([t], top);
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k, align: 'center' });
    },
};
