/**
 * UNLOCK — the product as a POWR reward: it stands inside a dial that
 * fills with points (open at the foot, ticked like a gauge, the filled arc
 * in the accent), with the points so far over the points it takes, how many
 * to go, and "Unlock it in the POWR app". For partners offering a product
 * for points, and POWR's own merch.
 */
import { TYPE } from '../../../../fonts';
import { drawText, textWidth } from '../../../../text';
import { rule, dot } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { thousands } from '../../../../words';
import { GREY, SOFT, HAIR, frame, ground, backdrop, block, blockHeight, fitPx, makerOf, mono, cap } from './_parts';

const num = (s) => {
    const n = parseFloat(String(s ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : NaN;
};

// Points so far, points needed, and the share (0–1).
function progressOf(e) {
    const have = num(e.fields.have);
    const need = num(e.fields.need);
    const p = Number.isFinite(have) && need > 0 ? Math.max(0, Math.min(1, have / need)) : 0;
    return { have, need, p };
}

const A0 = Math.PI * 0.75; // the dial opens at the foot: 135° to 405°
const SPAN = Math.PI * 1.5;

// The dial centred on (cx, cy), radius r.
function dial(e, cx, cy, r, p) {
    const { ctx } = e;
    const k = frame(e).k;
    const w = Math.max(3 * k, r * 0.035);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(244,241,234,0.14)';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, r, A0, A0 + SPAN);
    ctx.stroke();
    if (p > 0) {
        ctx.strokeStyle = e.accent;
        ctx.beginPath();
        ctx.arc(cx, cy, r, A0, A0 + SPAN * p);
        ctx.stroke();
    }
    // Ticks every 10%, outside the ring.
    for (let i = 0; i <= 10; i++) {
        const a = A0 + (SPAN * i) / 10;
        const r0 = r + w * 1.6;
        const r1 = r0 + (i % 5 === 0 ? w * 2.4 : w * 1.3);
        ctx.strokeStyle = i / 10 <= p + 1e-6 ? 'rgba(244,241,234,0.7)' : 'rgba(244,241,234,0.25)';
        ctx.lineWidth = Math.max(1, w * 0.3);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
    }
    ctx.restore();
    // The marker at the end of the fill.
    const a = A0 + SPAN * p;
    dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, w * 1.6, e.ink);
    dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, w * 0.8, e.accent);
}

// The product inside the dial: standing on the dial's open foot.
function inside(e, cx, cy, r) {
    const foot = cy + Math.sin(A0) * r;
    const h = r * 1.28;
    const w = r * 1.05;
    productShot(e, { x: cx - w / 2, y: foot + r * 0.1 - h, w, h }, { kind: 'bottle', label: makerOf(e), sub: e.fields.name });
}

// "2,450 / 4,000 points" then "1,550 to go". Returns the box.
function figures(e, x, base, px, maxW, align = 'left') {
    const { ctx } = e;
    const k = frame(e).k;
    const { have, need } = progressOf(e);
    const hv = String(e.fields.have ?? '').trim();
    const nd = String(e.fields.need ?? '').trim();
    const unit = String(e.fields.unit ?? '').trim();
    const tail = `${nd ? ` / ${nd}` : ''}${unit ? ` ${unit}` : ''}`;
    const tPx = px * 0.36;
    const w = textWidth(ctx, hv, TYPE.brandL, px, -0.03) + px * 0.12 + textWidth(ctx, tail, TYPE.brandR, tPx, 0);
    const s = w > maxW * 0.7 ? (maxW * 0.7) / w : 1;
    const left = align === 'center' ? x - (w * s) / 2 : x;
    const a = hv ? drawText(ctx, hv, TYPE.brandL, px * s, left - px * s * 0.03, base, { color: e.ink, tracking: -0.03 }) : null;
    const tx = left + (a ? a.w + px * 0.12 * s : 0);
    const b = drawText(ctx, tail.trim() && !hv ? tail.trim() : tail, TYPE.brandR, tPx * s, tx, base, { color: SOFT });
    if (a) e.mark('have', a);
    if (b) e.mark('need', b);
    const togo = Number.isFinite(have) && Number.isFinite(need) ? need - have : NaN;
    const label = Number.isFinite(togo) ? (togo > 0 ? `${thousands(Math.round(togo))} to go` : 'Ready to unlock') : '';
    if (label) e.mark('need', mono(e, label, x + maxW, base, Math.max(12 * k, px * 0.13), { align: 'right', color: e.accent, maxW: Math.max(0, maxW - w * s - 30 * k) }));
    return { x: left, y: base - cap(e, TYPE.brandL, px * s), w: w * s, h: cap(e, TYPE.brandL, px * s) };
}

const CTA = { caps: false, tracking: -0.015, gap: 0.34, maxLines: 2 };

export default {
    id: 'move-unlock',
    name: 'Unlock',
    category: 'Move',
    section: 'Products',
    blurb: 'The product as a POWR reward, standing inside a dial that fills with points: points so far over points needed, how many to go, "Unlock it in the POWR app".',
    refs: 'a gauge on a watch face',
    headlineFont: 'brandM',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'POWR reward' },
        { key: 'name', label: 'Product name', value: 'Trail bottle' },
        { key: 'have', label: 'Points so far', value: '2,450' },
        { key: 'need', label: 'Points it takes', value: '4,000' },
        { key: 'unit', label: 'Unit', value: 'points' },
        { key: 'cta', label: 'Line', rows: 2, value: 'Unlock it in\nthe POWR app.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Bottle', fields: { eyebrow: 'POWR reward', name: 'Trail bottle', have: '2,450', need: '4,000', cta: 'Unlock it in\nthe POWR app.' } },
        { name: 'Almost there', fields: { eyebrow: 'Nearly yours', name: 'Tempo runner', have: '5,300', need: '5,800', cta: 'Unlock it in\nthe POWR app.' } },
        { name: 'Club merch', fields: { eyebrow: 'Club reward', name: 'POWR club hoodie', have: '900', need: '2,400', cta: 'Earned, not given.' } },
        { name: 'Unlocked', fields: { eyebrow: 'Unlocked', name: 'Pace 2 watch', have: '12,000', need: '12,000', cta: 'Every session counts.' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            ...(r.cost ? { need: thousands(r.cost), have: thousands(Math.round(r.cost * 0.6 / 50) * 50) } : {}),
            ...(r.value ? { eyebrow: `${r.value}${r.unit ? ` ${r.unit}` : ''} · POWR reward` } : {}),
        }),
    },

    draw(e) {
        const f = frame(e);
        const { ctx, W } = e;
        const { k, tall, sq, wide, strip } = f;
        const { p } = progressOf(e);
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;

        if (strip || wide) {
            // The dial left, the words right.
            const r = Math.min((y1 - y0) * (strip ? 0.44 : 0.4), (x1 - x0) * (strip ? 0.16 : 0.25));
            const cx = (strip ? x0 + r * 1.2 : x0 + r * 1.25);
            const cy = strip ? (y0 + y1) / 2 + r * 0.08 : (y0 + y1) / 2 + (wide ? 30 : 40) * k;
            ground(e, { cx, cy, r: r * 1.8 });
            backdrop(e);
            dial(e, cx, cy, r, p);
            inside(e, cx, cy, r);
            const tx = cx + r * 1.35 + (strip ? 40 : 50) * k;
            const lh = (strip ? 34 : wide ? 48 : 44) * k;
            lockup(e, strip ? tx : x0, y0, lh, { maxW: (x1 - tx) * 0.5 });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 6 * k, (strip ? 13 : 15) * k, { align: 'right', maxW: (x1 - tx) * 0.45, color: SOFT }));
            const nPx = (strip ? 34 : wide ? 44 : 40) * k;
            const nameTop = strip ? y0 + lh + 26 * k : y0 + (y1 - y0) * 0.22;
            const nm = String(e.fields.name ?? '').trim();
            e.mark('name', drawText(ctx, nm, TYPE.brandSB, fitPx(ctx, nm, TYPE.brandSB, nPx, x1 - tx), tx, nameTop + cap(e, TYPE.brandSB, nPx), { color: e.ink }));
            const fPx = (strip ? 90 : wide ? 150 : 130) * k;
            const fb = nameTop + nPx + 40 * k + cap(e, TYPE.brandL, fPx) + 30 * k;
            figures(e, tx, fb, fPx, x1 - tx);
            if (!strip) {
                rule(ctx, tx, fb + 40 * k, x1, fb + 40 * k, HAIR, Math.max(1, 1.2 * k));
                block(e, 'cta', tx, fb + 80 * k, x1 - tx, y1 - fb - 80 * k, { ...CTA, max: (wide ? 56 : 48) * k });
            } else {
                block(e, 'cta', tx + (x1 - tx) * 0.55, y1, (x1 - tx) * 0.45, (y1 - y0) * 0.4, { ...CTA, max: 36 * k, bottom: true, align: 'left' });
            }
            return;
        }

        // Post and story: the dial centred, the words under it.
        const lh = (sq ? 46 : 54) * k;
        const ctaPx = (tall ? 60 : sq ? 40 : 50) * k;
        const ctaH = blockHeight(e, 'cta', x1 - x0, ctaPx * 2.5, { ...CTA, max: ctaPx });
        const fPx = (tall ? 150 : sq ? 100 : 124) * k;
        const ctaTop = y1 - ctaH;
        const ruleY = ctaTop - 44 * k;
        const fBase = ruleY - 40 * k;
        const top = y0 + lh + (tall ? 90 : sq ? 24 : 40) * k;
        const room = fBase - cap(e, TYPE.brandL, fPx) - 80 * k - top;
        const r = Math.min((x1 - x0) * 0.4, room / 2.15);
        const cx = W / 2;
        const cy = top + r * 1.12;
        ground(e, { cx, cy, r: r * 1.7 });
        backdrop(e);
        dial(e, cx, cy, r, p);
        inside(e, cx, cy, r);
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, 18 * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        // The name under the dial's foot, centred.
        const nm = String(e.fields.name ?? '').trim();
        const nPx = (tall ? 34 : 30) * k;
        const nb = cy + Math.sin(A0) * r + r * 0.1 + (sq ? 36 : 50) * k;
        e.mark('name', drawText(ctx, e.caps(nm), TYPE.mono, fitPx(ctx, e.caps(nm), TYPE.mono, nPx * 0.6, r * 1.6, 0.24), cx, nb, { align: 'center', tracking: 0.24, color: GREY }));
        figures(e, x0, fBase, fPx, x1 - x0);
        rule(ctx, x0, ruleY, x1, ruleY, HAIR, Math.max(1, 1.2 * k));
        block(e, 'cta', x0, ctaTop, x1 - x0, ctaPx * 2.5, { ...CTA, max: ctaPx });
    },
};
