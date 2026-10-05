/**
 * TODAY'S SPECIAL — a café counter board: a framed slate with "Today's
 * special" in an italic serif, the one product big, a line on what's in it,
 * the price and a "Redeem with POWR points" marker; the product itself
 * stands on the counter in front of the board. A dropped photo becomes the
 * café behind it. For cafés, gym kitchens and food partners with a counter.
 */
import { TYPE } from '../../../../fonts';
import { dot } from '../../../../shapes';
import { drawText, capHeight, textWidth } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, slot, productRect, eyebrow, head, headHeight, para, paraLines, lift, alpha, SOFT, GREY, INK, fitPx } from './_parts';

const SLATE = '#171716';

// The board: slate, an outer frame and a fine inner one, four screws.
function board(e, b, U) {
    const { ctx } = e;
    ctx.fillStyle = e.hasMedia ? 'rgba(23,23,22,0.95)' : SLATE;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 12 * U);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = alpha(INK, 0.42);
    ctx.lineWidth = Math.max(1, 2 * U);
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 12 * U);
    ctx.stroke();
    const i = 16 * U;
    ctx.strokeStyle = alpha(INK, 0.14);
    ctx.lineWidth = Math.max(1, 1.2 * U);
    ctx.strokeRect(b.x + i, b.y + i, b.w - i * 2, b.h - i * 2);
    ctx.restore();
    const s = 8 * U;
    [[b.x + s, b.y + s], [b.x + b.w - s, b.y + s], [b.x + s, b.y + b.h - s], [b.x + b.w - s, b.y + b.h - s]].forEach(([x, y]) => dot(ctx, x, y, 2.4 * U, alpha(INK, 0.4)));
}

// The counter the product stands on: a lit edge and a darker front.
function counter(e, y, U) {
    const { ctx, W, H } = e;
    const g = ctx.createLinearGradient(0, y, 0, H);
    g.addColorStop(0, '#22211e');
    g.addColorStop(1, '#121211');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = 'rgba(244,241,234,0.2)';
    ctx.fillRect(0, y, W, Math.max(1, 1.4 * U));
}

// The marker: an outlined pill with a dot in the accent.
function marker(e, x, y, px, { maxW = Infinity } = {}) {
    const { ctx } = e;
    const t = String(e.fields.marker ?? '').trim();
    if (!t) return null;
    const p = fitPx(ctx, t, TYPE.brandSB, px, maxW - px * 3.4, 0.02);
    const h = p * 2.3;
    const w = textWidth(ctx, t, TYPE.brandSB, p, 0.02) + p * 3.4;
    ctx.save();
    ctx.strokeStyle = lift(e.accent);
    ctx.lineWidth = Math.max(1, p * 0.09);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.stroke();
    ctx.restore();
    dot(ctx, x + p * 1.3, y + h / 2, p * 0.34, lift(e.accent));
    e.mark('marker', drawText(ctx, t, TYPE.brandSB, p, x + p * 2.1, y + h / 2 + capHeight(ctx, TYPE.brandSB, p) / 2, { tracking: 0.02, color: INK }));
    return { x, y, w, h };
}

/**
 * The board's words in (x, top)–bottom, width w: heading, name, line at the
 * top; price and marker at the foot.
 */
function words(e, x, top, bottom, w, U, { hPx = 46, nameH = 200, pricePx = 110, dPx = 26 } = {}) {
    const { ctx } = e;
    const f = e.fields;
    let y = top;
    const heading = String(f.heading ?? '').trim();
    if (heading) {
        const p = fitPx(ctx, heading, TYPE.serifI, hPx * U, w);
        e.mark('heading', drawText(ctx, heading, TYPE.serifI, p, x, y + capHeight(ctx, TYPE.serifI, p), { color: lift(e.accent) }));
        y += capHeight(ctx, TYPE.serifI, p) + 22 * U;
        ctx.fillStyle = alpha(INK, 0.3);
        ctx.fillRect(x, y, 70 * U, Math.max(1, 1.5 * U));
        y += 44 * U;
    }
    // Foot first, so the name knows its room.
    // pricePx 0: the banner sets price and marker in a column of their own.
    const price = pricePx ? String(f.price ?? '').trim() : '';
    const pp = price ? fitPx(ctx, price, TYPE.brandL, pricePx * U, w) : 0;
    const mH = pricePx && String(f.marker ?? '').trim() ? 26 * U * 2.3 : 0;
    const footH = (price ? capHeight(ctx, TYPE.brandL, pp) : 0) + (price && mH ? 30 * U : 0) + mH;
    const dl = paraLines(e, f.desc, TYPE.brandL, dPx * U, w, 3);
    const dh = dl ? (dl - 1) * dPx * U * 1.32 + dPx * U + 28 * U : 0;
    const room = bottom - footH - 50 * U - y - dh;
    const nh = headHeight(e, f.name, { maxW: w, maxH: Math.min(nameH * U, room), lines: 3 });
    const t = head(e, 'name', f.name, x, y, { maxW: w, maxH: Math.min(nameH * U, room), lines: 3 });
    y = t.bottom + (nh ? 28 * U : 0);
    if (dl) para(e, 'desc', f.desc, TYPE.brandL, dPx * U, x, y + dPx * U * 0.8, w, 3, { color: SOFT });
    let fy = bottom - footH;
    if (price) {
        const c = capHeight(ctx, TYPE.brandL, pp);
        e.mark('price', drawText(ctx, price, TYPE.brandL, pp, x, fy + c, { color: INK }));
        fy += c + 30 * U;
    }
    if (pricePx) marker(e, x, fy, 26 * U, { maxW: w });
}

export default {
    id: 'eat-todays-special',
    name: 'Today’s Special',
    category: 'Eat',
    section: 'Products',
    blurb: 'A café counter board featuring one product: name, price, what’s in it and a “Redeem with POWR points” marker, the product on the counter in front.',
    refs: 'a framed café counter board',
    headlineFont: 'brandSB',
    photo: 'optional',
    fields: [
        { key: 'heading', label: 'Heading', value: 'Today’s special' },
        { key: 'name', label: 'Product', rows: 3, value: 'Salted caramel\nprotein shake' },
        { key: 'desc', label: 'What’s in it', rows: 2, value: 'Northside Whey, oat milk, a shot of espresso, ice.', hint: 'Leave empty to hide it.' },
        { key: 'price', label: 'Price', value: '£4.80' },
        { key: 'marker', label: 'Marker', value: 'Redeem with POWR points', hint: 'Leave empty to hide it.' },
        { key: 'venue', label: 'Venue line', value: 'Northside Kitchen · served until 3pm', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Shake', fields: {}, look: { kind: 'bottle' } },
        { name: 'Bowl', fields: { heading: 'On the counter today', name: 'Chicken, rice\n& greens bowl', desc: 'Chicken thigh, jasmine rice, tenderstem, sesame.', price: '£8.50', marker: 'Redeem with POWR points', venue: 'The gym kitchen · from 12' }, look: { kind: 'box' }, style: { accent: '#D9A066' } },
        { name: 'Bake', fields: { heading: 'Fresh this morning', name: 'Oat & date\nflapjack', desc: 'Jumbo oats, dates, peanut butter. Baked here.', price: '£2.90', marker: 'Or 290 POWR points', venue: 'Northside Kitchen · while they last' }, look: { kind: 'pouch' }, style: { accent: '#E0556B' } },
        { name: 'Cold brew', fields: { heading: 'This week only', name: 'Nitro\ncold brew', desc: 'Steeped for 18 hours, poured on nitro.', price: '£3.60', marker: 'Members redeem with POWR points', venue: 'Front desk café · till 8pm' }, look: { kind: 'bottle' }, style: { accent: '#7FE0C2' } },
    ],
    look: { ...LOOK, kind: 'bottle' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['bottle', 'Bottle'], ['jar', 'Jar'], ['pouch', 'Pouch'], ['box', 'Box'], ['tub', 'Tub']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.cost ? { marker: `Or ${rewardWords(r).points.replace('points', 'POWR points')}` } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const U = unitOf(e);
        const f = e.fields;
        const kind = e.look.kind ?? 'bottle';
        const sub = String(f.name ?? '').replace(/\s*\n\s*/g, ' ');
        ground(e);
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            e.ctx.fillStyle = 'rgba(12,12,11,0.45)';
            e.ctx.fillRect(0, 0, W, H);
        }
        const strip = shape === 'strip';
        const wide = shape === 'wide';
        const tall = shape === 'tall';
        const x = safe.l;
        const w = W - safe.l - safe.r;
        const venue = String(f.venue ?? '').trim();
        const vPx = (strip ? 16 : 20) * U;
        const counterY = strip ? H - safe.b - 6 * U : H - safe.b - (venue ? vPx + 34 * U : 20 * U);
        // The lockup sits above the board, except on a banner.
        const lk = strip ? null : lockup(e, x, safe.t, 38 * U, { maxW: w * 0.6 });
        const bTop = strip ? safe.t : lk.y + lk.h + (tall ? 50 : 34) * U;
        // With a photo the board steps left and the café shows beside it.
        const bw = wide ? w * 0.7 : strip ? w * 0.74 : e.hasMedia ? w * 0.7 : w;
        const b = { x, y: bTop, w: bw, h: counterY - 26 * U - bTop };
        board(e, b, U);
        counter(e, counterY, U);
        if (venue) {
            if (strip) eyebrow(e, 'venue', venue, vPx, W - safe.r, safe.t + vPx, { align: 'right', maxW: w - bw - 30 * U, color: GREY });
            else eyebrow(e, 'venue', venue, vPx, x, H - safe.b, { maxW: w * 0.6, color: GREY });
        }
        if (strip) lockup(e, W - safe.r, H - safe.b - 40 * U, 26 * U, { align: 'right', maxW: w - bw - 30 * U });
        // The product on the counter, in front of the board's right edge.
        const ph = b.h * (strip ? 0.9 : tall ? 0.6 : 0.72);
        const pw = strip ? H * 0.5 : wide ? w * 0.34 : w * 0.42;
        const px0 = strip || wide || e.hasMedia ? b.x + b.w - pw * 0.38 : x + w - pw;
        const pbox = { x: px0, y: counterY - ph, w: pw, h: ph };
        const pr = productRect(e, pbox, { kind, frame: 0.78 });
        // The words on the board, clear of the product.
        const pad = (strip ? 34 : 56) * U;
        const tx = b.x + pad;
        const tw = Math.min(b.x + b.w - pad, pr.x - 36 * U) - tx;
        if (strip) {
            const half = tw * 0.56;
            words(e, tx, b.y + pad * 0.9, b.y + b.h - pad * 0.9, half, U, { hPx: 30, nameH: 120, pricePx: 0, dPx: 18 });
            const rx = tx + half + 40 * U;
            const rw = tw - half - 40 * U;
            const price = String(f.price ?? '').trim();
            if (price) {
                const pp = fitPx(e.ctx, price, TYPE.brandL, 96 * U, rw);
                e.mark('price', drawText(e.ctx, price, TYPE.brandL, pp, rx, b.y + b.h / 2 - 8 * U, { color: INK }));
            }
            marker(e, rx, b.y + b.h / 2 + 18 * U, 18 * U, { maxW: rw });
        } else {
            const sq = shape === 'square';
            words(e, tx, b.y + pad, b.y + b.h - pad, tw, U, {
                hPx: tall ? 52 : 46, nameH: tall ? 300 : sq ? 170 : 220, pricePx: tall ? 250 : sq ? 130 : wide ? 170 : 200, dPx: sq ? 24 : 26,
            });
        }
        slot(e, pbox, { kind, sub, frame: 0.78, stage: 0.8 });
    },
};
