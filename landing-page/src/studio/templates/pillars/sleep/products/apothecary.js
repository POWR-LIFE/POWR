/**
 * APOTHECARY — an old chemist's label for an evening tea or supplement: a
 * card with cut-in corners and a double rule, diamonds in the corners, a
 * crescent in the head, the batch number, the name in serif, its contents
 * (weight or count) and a "30 min before bed" timing line. The product
 * stands beside it. Contents and timing only, never a dose or an effect.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, rewardWords } from '../../kit';
import { frame, nightGround, head, title, price, line, label, readable, crescent, small, INK, SOFT, MUTED, NIGHT_LOOK } from './_parts';
import { KINDS } from './moonlit';

// A rect with quarter-circle bites out of each corner.
function bitten(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w, y, r, Math.PI, Math.PI / 2, true);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w, y + h, r, -Math.PI / 2, Math.PI, true);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x, y + h, r, 0, -Math.PI / 2, true);
    ctx.lineTo(x, y + r);
    ctx.arc(x, y, r, Math.PI / 2, 0, true);
    ctx.closePath();
}

function diamond(ctx, cx, cy, s, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.7, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s * 0.7, cy);
    ctx.closePath();
    ctx.fill();
}

// A rule with a diamond in the middle.
function divider(ctx, cx, y, w, s, color, lit) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2, y - 0.6, w / 2 - s * 2, 1.2);
    ctx.fillRect(cx + s * 2, y - 0.6, w / 2 - s * 2, 1.2);
    diamond(ctx, cx, y, s, lit);
}

function card(e, c, k, { compact = false } = {}) {
    const { ctx } = e;
    const lit = readable(e.accent);
    const r = Math.min(c.w, c.h) * (compact ? 0.09 : 0.075);
    ctx.save();
    bitten(ctx, c.x, c.y, c.w, c.h, r);
    ctx.fillStyle = 'rgba(20,23,31,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.32)';
    ctx.lineWidth = Math.max(1, 1.5 * k);
    ctx.stroke();
    const i = Math.max(8 * k, r * 0.34);
    bitten(ctx, c.x + i, c.y + i, c.w - i * 2, c.h - i * 2, r * 0.8);
    ctx.strokeStyle = lit;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Diamonds in the four bites.
    const d = r * 0.2;
    [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].forEach(([x, y]) => {
        diamond(ctx, x + (x > c.x ? -1 : 1) * r * 0.62, y + (y > c.y ? -1 : 1) * r * 0.62, d, lit);
    });
    ctx.restore();

    const cx = c.x + c.w / 2;
    const iw = c.w - i * 2 - r * 1.2;
    if (compact) {
        // Strip: name on the left half, the facts stacked on the right.
        const lx = c.x + i + r * 0.9;
        const mid = c.x + c.w * 0.52;
        label(e, 'batch', e.fields.batch, 12 * k, lx, c.y + i + r * 0.9, { maxW: mid - lx - 20 * k, color: MUTED });
        title(e, 'name', e.fields.name, lx, c.y + c.h * 0.34, { maxW: mid - lx - 30 * k, maxH: c.h * 0.36, max: 56 * k });
        line(e, 'detail', e.fields.detail, TYPE.serifI, 20 * k, lx, c.y + c.h - i - r * 0.7, { maxW: mid - lx - 30 * k, color: SOFT });
        const rx = mid + 20 * k;
        const rW = c.x + c.w - i - r * 0.9 - rx;
        line(e, 'contents', e.caps(e.fields.contents), TYPE.mono, 14 * k, rx, c.y + c.h * 0.34, { maxW: rW, tracking: 0.14, color: INK });
        crescent(ctx, rx + 7 * k, c.y + c.h * 0.52 - 5 * k, 7 * k, lit);
        label(e, 'timing', e.fields.timing, 13 * k, rx + 22 * k, c.y + c.h * 0.52, { maxW: rW - 22 * k, color: lit });
        price(e, 'price', rx, c.y + c.h - i - r * 0.7, 30 * k, { maxW: rW });
        return;
    }
    // Budget in "k" units, scaled to the card's height.
    // Spacing grows with the card's height; small type only a little.
    const s = Math.max(0.6, Math.min(1.8, c.h / (620 * k), c.w / (330 * k)));
    const q = k * s;
    const qt = k * Math.min(s, 1.3);
    let y = c.y + i + r * 0.9 + 22 * q;
    label(e, 'batch', e.fields.batch, 15 * qt, cx, y, { align: 'center', maxW: iw, color: MUTED });
    y += 42 * q;
    // The head ornament: rule, crescent, rule.
    ctx.fillStyle = 'rgba(244,241,234,0.3)';
    ctx.fillRect(cx - iw * 0.3, y, iw * 0.3 - 22 * qt, Math.max(1, 1.2 * k));
    ctx.fillRect(cx + 22 * qt, y, iw * 0.3 - 22 * qt, Math.max(1, 1.2 * k));
    crescent(ctx, cx, y, 11 * qt, lit);
    y += 44 * q;
    const t = title(e, 'name', e.fields.name, cx, y, { maxW: iw * 0.94, maxH: 190 * q, max: 96 * q, align: 'center', gap: 0.12 });
    y = t.bottom + 50 * q;
    line(e, 'detail', e.fields.detail, TYPE.serifI, 28 * qt, cx, y, { align: 'center', maxW: iw * 0.9, color: SOFT });
    const detailY = y;
    // The foot, from the bottom up: price, timing, contents, a divider.
    const hasPrice = String(e.fields.price ?? '').trim() !== '';
    const pb = c.y + c.h - i - r * 0.5 - 18 * qt;
    const tY = hasPrice ? pb - 74 * qt : pb;
    const cY = tY - 46 * qt;
    const dY = cY - 52 * qt;
    if (hasPrice) price(e, 'price', cx, pb, 38 * qt, { align: 'center', maxW: iw * 0.8 });
    line(e, 'contents', e.caps(e.fields.contents), TYPE.mono, 18 * qt, cx, cY, { align: 'center', maxW: iw, tracking: 0.16, color: INK });
    const tim = String(e.fields.timing ?? '').trim();
    if (tim) {
        const px = 16 * qt;
        ctx.font = `500 ${px}px "IBM Plex Mono"`;
        const tw = Math.min(iw - 30 * qt, ctx.measureText(e.caps(tim)).width * 1.2);
        crescent(ctx, cx - tw / 2 - 12 * qt, tY - px * 0.36, px * 0.5, lit);
        label(e, 'timing', tim, px, cx + 10 * qt, tY, { align: 'center', maxW: iw - 40 * qt, color: lit });
    }
    divider(ctx, cx, dY, iw * 0.6, 6 * qt, 'rgba(244,241,234,0.26)', lit);
    // What's left between: an engraved medallion, a crescent and seven stars.
    const gap = dY - detailY - 60 * q;
    const R = Math.min(gap * 0.42, iw * 0.3);
    if (R > 34 * k) {
        const my = detailY + 30 * q + gap / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(244,241,234,0.22)';
        ctx.lineWidth = Math.max(1, 1.2 * k);
        ctx.beginPath();
        ctx.arc(cx, my, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([2 * k, 5 * k]);
        ctx.beginPath();
        ctx.arc(cx, my, R * 0.86, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        crescent(ctx, cx, my, R * 0.42, lit);
        ctx.fillStyle = 'rgba(244,241,234,0.5)';
        for (let j = 0; j < 7; j++) {
            const a = -Math.PI / 2 + ((j - 3) * Math.PI) / 9;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * R * 0.68, my + Math.sin(a) * R * 0.68 + R * 0.05, Math.max(1, R * 0.025), 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

export default {
    id: 'sleep-apothecary',
    name: 'Apothecary',
    category: 'Sleep',
    section: 'Products',
    blurb: 'An old chemist’s label for an evening tea or supplement: batch, serif name, contents, “30 min before bed”; the product beside it.',
    refs: 'a Victorian apothecary label',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'The evening shelf' },
        { key: 'batch', label: 'Batch line', value: 'No. 07 · Batch 2291' },
        { key: 'name', label: 'Product', rows: 2, value: 'Evening\nMagnesium' },
        { key: 'detail', label: 'Detail (serif italic)', value: 'Glycinate, with chamomile' },
        { key: 'contents', label: 'Contents', value: '60 capsules · 90 g', hint: 'Weight or count, as on the pack.' },
        { key: 'timing', label: 'Timing', value: '30 min before bed', hint: 'When, never how much or what it does.' },
        { key: 'price', label: 'Price', value: '£24' },
        { key: 'offer', label: 'Offer (under the product)', value: 'Or 600 POWR points', hint: 'Optional.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Supplement', fields: {}, look: { kind: 'jar' } },
        { name: 'Tea', fields: { batch: 'No. 12 · Harvest 2026', name: 'Night Tea', detail: 'Chamomile, lemon balm, lavender', contents: '20 pyramid bags · 40 g', timing: 'Brew after dinner', price: '£9', offer: '' }, look: { kind: 'pouch' }, style: { accent: '#D8B98A' } },
        { name: 'Bath salts', fields: { batch: 'No. 03 · Batch 118', name: 'Bath\nFlakes', detail: 'Magnesium chloride flakes', contents: '1 kg pouch', timing: 'In the bath, before bed', price: '£14', offer: 'Or 350 POWR points' }, look: { kind: 'pouch' }, style: { accent: '#9DB8FF' } },
        { name: 'Pillow mist', fields: { batch: 'No. 21 · Batch 604', name: 'Pillow\nMist', detail: 'Lavender and vetiver', contents: '100 ml', timing: 'Two sprays at lights out', price: '£22', offer: '' }, look: { kind: 'bottle' }, style: { accent: '#B9A7E8' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'jar' },
    controls: [{ key: 'kind', label: 'Stand-in', options: KINDS }],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.cost ? { offer: `Or ${Number(r.cost).toLocaleString('en-GB')} POWR points` } : {}) }) },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        nightGround(e, { glow: { x: 0.3, y: 0.6 }, sink: 0.72 });
        const kind = e.look.kind ?? 'jar';
        const hb = head(e, f);
        const offerPx = (f.strip ? 11 : 15) * k;
        const hasOffer = String(e.fields.offer ?? '').trim() !== '';

        if (f.strip) {
            const pw = (x1 - x0) * 0.2;
            productShot(e, { x: x0, y: hb + 10 * k, w: pw, h: y1 - hb - 10 * k - (hasOffer ? offerPx * 2.4 : 0) }, { kind });
            if (hasOffer) small(e, 'offer', x0 + pw / 2, y1, offerPx, { align: 'center', maxW: pw * 1.4 });
            const cx = x0 + pw + 50 * k;
            card(e, { x: cx, y: hb + 10 * k, w: x1 - cx, h: y1 - hb - 10 * k }, k, { compact: true });
            return;
        }

        // Product in a column on the left (the top on a story), the label beside it.
        const top = hb + (f.tall ? 50 : 36) * k;
        if (f.tall) {
            const cTop = top + (y1 - top) * 0.36;
            productShot(e, { x: x0, y: top, w: x1 - x0, h: cTop - top - 40 * k }, { kind });
            card(e, { x: x0, y: cTop, w: x1 - x0, h: y1 - cTop - (hasOffer ? offerPx * 3 : 0) }, k);
            if (hasOffer) small(e, 'offer', (x0 + x1) / 2, y1, offerPx, { align: 'center', maxW: x1 - x0 });
            return;
        }
        const pw = (x1 - x0) * (f.wide ? 0.44 : f.sq ? 0.4 : 0.38);
        const gap = (f.wide ? 60 : 36) * k;
        const pBot = y1 - (hasOffer ? offerPx * 2.6 : 0);
        productShot(e, { x: x0, y: top + (f.wide ? 20 : 120) * k, w: pw - gap * 0.3, h: pBot - top - (f.wide ? 20 : 120) * k }, { kind });
        if (hasOffer) small(e, 'offer', x0 + pw / 2, y1, offerPx, { align: 'center', maxW: pw });
        const cW = f.wide ? Math.min(x1 - x0 - pw - gap, (y1 - top) * 0.82) : x1 - x0 - pw - gap;
        card(e, { x: x1 - cW, y: top, w: cW, h: y1 - top }, k);
    },
};
