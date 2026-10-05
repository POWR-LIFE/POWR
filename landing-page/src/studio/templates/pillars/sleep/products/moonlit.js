/**
 * MOONLIT — the product alone under a large, very dim moon in the brand's
 * colour: a soft halo, a faint lit crescent and a hairline rim, the product
 * standing on a thin line of floor light. Name, one line of detail, the
 * price, set small and centred. Still and cinematic. For any sleep aid's
 * hero post: an eye mask, a pillow mist, a smart ring, an evening tea.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, isCutout, rewardWords } from '../../kit';
import { frame, nightGround, head, title, price, small, tint, line, SOFT, MUTED, NIGHT_LOOK } from './_parts';

export const KINDS = [['mask', 'Eye mask'], ['device', 'Bedside device'], ['tin', 'Tin'], ['bottle', 'Bottle'], ['jar', 'Jar'], ['pouch', 'Pouch'], ['box', 'Box'], ['candle', 'Candle']];

/** The dim moon behind the product. */
export function moonGlow(e, cx, cy, R, k) {
    const { ctx } = e;
    ctx.save();
    const h = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.9);
    h.addColorStop(0, tint(e.accent, 0.07));
    h.addColorStop(0.4, tint(e.accent, 0.025));
    h.addColorStop(1, tint(e.accent, 0));
    ctx.fillStyle = h;
    ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
    const d = ctx.createRadialGradient(cx + R * 0.35, cy - R * 0.3, 0, cx, cy, R);
    d.addColorStop(0, tint(e.accent, 0.085));
    d.addColorStop(1, tint(e.accent, 0.03));
    ctx.fillStyle = d;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = tint(e.accent, 0.12);
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = tint(e.accent, 0.45);
    ctx.lineWidth = Math.max(1, 2 * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R, -1.15, 1.0);
    ctx.stroke();
    ctx.restore();
}

/** A thin line of floor light across `w` at `y`, the table below it a shade darker. */
export function floor(e, cx, y, w) {
    const { ctx, W, H } = e;
    const t = ctx.createLinearGradient(0, y, 0, H);
    t.addColorStop(0, 'rgba(0,0,0,0.26)');
    t.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = t;
    ctx.fillRect(0, y, W, H - y);
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, 'rgba(244,241,234,0)');
    g.addColorStop(0.5, 'rgba(244,241,234,0.22)');
    g.addColorStop(1, 'rgba(244,241,234,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(cx - w / 2, y, w, Math.max(1, 1.2 * e.tu));
    ctx.restore();
}

// The product box: a cut-out gets the whole box; a framed shot a 4:5 panel inside it.
function slot(e, box) {
    const img = e.asset('product');
    if (!img || isCutout(img)) return box;
    let h = box.h;
    let w = h * 0.8;
    if (w > box.w) { w = box.w; h = w / 0.8; }
    return { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h };
}

export default {
    id: 'sleep-moonlit',
    name: 'Moonlit',
    category: 'Sleep',
    section: 'Products',
    blurb: 'The product alone under a large, dim moon in the brand’s colour: name, one line of detail, the price.',
    refs: 'a night still from a perfume film',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'The night edit' },
        { key: 'name', label: 'Product', rows: 2, value: 'Silk Eye Mask' },
        { key: 'detail', label: 'Detail', value: '22 momme mulberry silk · Adjustable strap', hint: 'Materials and specs, not benefits.' },
        { key: 'price', label: 'Price', value: '£45' },
        { key: 'offer', label: 'Offer (small)', value: 'Or 1,200 POWR points', hint: 'Optional.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Eye mask', fields: {}, look: { kind: 'mask' } },
        { name: 'Pillow mist', fields: { eyebrow: 'Lights low', name: 'Pillow Mist', detail: 'Lavender and vetiver · 100 ml · Glass bottle', price: '£22', offer: 'Or 550 POWR points' }, look: { kind: 'bottle' }, style: { accent: '#B9A7E8' } },
        { name: 'Smart ring', fields: { eyebrow: 'New in', name: 'Night Ring', detail: 'Titanium · 4 g · Up to 6 days’ battery', price: '£299', offer: 'Members first in the POWR app' }, look: { kind: 'box' }, style: { accent: '#9DB8FF' } },
        { name: 'Tea', fields: { eyebrow: 'After dark', name: 'Night Blend', detail: 'Chamomile, lavender, oat straw · 20 bags', price: '£8.50', offer: '' }, look: { kind: 'pouch' }, style: { accent: '#D8B98A' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'mask' },
    controls: [{ key: 'kind', label: 'Stand-in', options: KINDS }],
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            offer: [r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''}` : '', r.cost ? `${Number(r.cost).toLocaleString('en-GB')} POWR points` : ''].filter(Boolean).join(' · '),
        }),
    },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        const { W, H } = e;
        nightGround(e, { glow: null, sink: 0.66 });
        const kind = e.look.kind ?? 'mask';
        const hb = head(e, f);

        if (f.side) {
            // Moon and product on the right, words on the left, centred in height.
            const split = f.strip ? 0.5 : 0.52;
            const mx = x0 + (x1 - x0) * split;
            const R = Math.min((y1 - hb) * (f.strip ? 0.5 : 0.42), (x1 - mx) * 0.42);
            const cx = (mx + x1) / 2 + (f.strip ? 0 : 20 * k);
            const cy = f.strip ? (hb + y1) / 2 - R * 0.1 : hb + (y1 - hb) * 0.44;
            moonGlow(e, cx, cy, R, k);
            const base = f.strip ? y1 : cy + R * 0.95;
            floor(e, cx, base, R * 3.2);
            const pH = f.strip ? base - hb : R * 1.55;
            productShot(e, slot(e, { x: cx - R * 1.1, y: base - pH, w: R * 2.2, h: pH }), { kind, sub: '' });

            const tW = mx - x0 - 40 * k;
            const mid = f.strip ? (hb + y1) / 2 + 20 * k : (hb + y1) / 2;
            const nPx = (f.strip ? 50 : 104) * k;
            const t = title(e, 'name', e.fields.name, x0, mid - nPx * (f.strip ? 0.9 : 1.2), { maxW: tW, maxH: nPx * 2.2, max: nPx });
            let y = t.bottom + (f.strip ? 34 : 56) * k;
            const dPx = (f.strip ? 15 : 22) * k;
            line(e, 'detail', e.fields.detail, TYPE.brandR, dPx, x0, y, { maxW: tW, color: SOFT });
            y += (f.strip ? 44 : 76) * k;
            const pb = price(e, 'price', x0, y, (f.strip ? 30 : 44) * k, { maxW: tW * 0.4 });
            small(e, 'offer', pb ? pb.x + pb.w + 24 * k : x0, y - 2 * k, (f.strip ? 12 : 16) * k, { maxW: tW - (pb ? pb.w + 24 * k : 0), color: MUTED });
            return;
        }

        const cx = W / 2;
        const R = W * (f.tall ? 0.36 : f.sq ? 0.25 : 0.33);
        const cy = f.tall ? H * 0.37 : hb + (H - hb) * (f.sq ? 0.36 : 0.33);
        moonGlow(e, cx, cy, R, k);
        const base = cy + R * 0.92;
        floor(e, cx, base, W * 0.9);
        const pH = R * 1.45;
        productShot(e, slot(e, { x: cx - R * 1.05, y: base - pH, w: R * 2.1, h: pH }), { kind, sub: '' });

        // Words: bottom-up from the safe edge, centred.
        const oPx = (f.tall ? 17 : 15) * k;
        const pPx = (f.tall ? 50 : 44) * k;
        const dPx = (f.tall ? 24 : 21) * k;
        const hasOffer = String(e.fields.offer ?? '').trim() !== '';
        const oBase = y1 - 2 * k;
        const pBase = hasOffer ? oBase - oPx * 2.6 : oBase;
        price(e, 'price', cx, pBase, pPx, { align: 'center', maxW: x1 - x0 });
        if (hasOffer) small(e, 'offer', cx, oBase, oPx, { align: 'center', maxW: x1 - x0, color: MUTED });
        const dBase = pBase - pPx * 1.7;
        line(e, 'detail', e.fields.detail, TYPE.brandR, dPx, cx, dBase, { align: 'center', maxW: (x1 - x0) * 0.9, color: SOFT });
        const room = dBase - dPx * 2.2 - (base + 40 * k);
        const nPx = (f.tall ? 84 : 72) * k;
        const nLines = Math.min(2, String(e.fields.name ?? '').split('\n').length);
        const nH = Math.min(room, nPx * (nLines + (nLines - 1) * 0.16) * 0.72);
        title(e, 'name', e.fields.name, cx, dBase - dPx * 2.2 - nH, { maxW: (x1 - x0) * 0.9, maxH: nH, max: nPx, align: 'center' });
    },
};
