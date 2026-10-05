/**
 * SHELF LABEL — the product on a lit shelf with a supermarket shelf-edge
 * label clipped under it: name and size, the price big, the unit price per
 * 100g, "or 1,200 POWR points", and a barcode block that is plainly
 * decoration (no digits, not a real code). For brands in shops, gym fridges
 * and cafés with a retail shelf.
 */
import { TYPE } from '../../../../fonts';
import { drawText, capHeight, textWidth, wrapLines } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, backdrop, eyebrow, head, headHeight, para, paraLines, seeded, lift, GREY, INK, fitPx } from './_parts';

const PAPER = '#F4F1EA';
const DARK = '#111111';

// The shelf: a lit top edge and a dark front lip across (x0, x1) at y.
function shelf(e, x0, x1, y, U) {
    const { ctx } = e;
    const top = 16 * U;
    const lip = 34 * U;
    const g = ctx.createLinearGradient(0, y - top, 0, y);
    g.addColorStop(0, '#1d1d1b');
    g.addColorStop(1, '#2c2b28');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - top, x1 - x0, top);
    ctx.fillStyle = '#171716';
    ctx.fillRect(x0, y, x1 - x0, lip);
    ctx.fillStyle = 'rgba(244,241,234,0.22)';
    ctx.fillRect(x0, y, x1 - x0, Math.max(1, 1.4 * U));
    return y + lip;
}

// A decorative barcode: bars of seeded widths, no digits.
function bars(ctx, x, y, w, h, seed, colour) {
    const rnd = seeded(seed);
    ctx.fillStyle = colour;
    let bx = x;
    const unit = w / 95;
    let on = true;
    while (bx < x + w - unit) {
        const k = 1 + Math.floor(rnd() * 3);
        const bw = Math.min(unit * k, x + w - bx);
        if (on) ctx.fillRect(bx, y, bw, h);
        bx += bw;
        on = !on;
    }
}

/** The label's measurements at width w (no drawing). */
function measure(e, w, U, scale) {
    const { ctx } = e;
    const f = e.fields;
    const k = U * scale;
    const pad = 26 * k;
    const band = 14 * k;
    const iw = w - band - pad * 2;
    // Price on the right, at most ~46% of the width.
    const price = String(f.price ?? '').trim();
    const pPx = price ? fitPx(ctx, price, TYPE.brand, 96 * k, iw * 0.46) : 96 * k;
    const pw = price ? textWidth(ctx, price, TYPE.brand, pPx) : 0;
    const nPx = 30 * k;
    const nl = wrapLines(ctx, f.name, TYPE.brandSB, nPx, iw - pw - 28 * k, 3);
    const sPx = 17 * k;
    const size = String(f.size ?? '').trim();
    const unit = String(f.unit ?? '').trim();
    const leftH = nl.length * nPx * 1.15 + (size ? sPx * 2 : 0);
    const rightH = capHeight(ctx, TYPE.brand, pPx) + (unit ? sPx * 2.2 : 0);
    const topH = Math.max(leftH, rightH);
    const footH = 58 * k;
    return { k, pad, band, iw, price, pPx, nPx, nl, sPx, size, unit, topH, footH, h: pad + topH + 26 * k + footH + pad };
}

/**
 * The label card at (x, y) of width w: a colour band down the left edge,
 * name and size, price big on the right, unit price, the points pill and
 * the decorative barcode. Returns its height.
 */
function label(e, x, y, w, U, { scale = 1 } = {}) {
    const { ctx } = e;
    const f = e.fields;
    const { k, pad, band, iw, price, pPx, nPx, nl, sPx, size, unit, topH, footH, h } = measure(e, w, U, scale);
    const ix = x + band + pad;
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = e.accent;
    ctx.fillRect(x, y, band, h);
    // Name + size.
    const nb = nl.length ? drawText(ctx, nl.join('\n'), TYPE.brandSB, nPx, ix, y + pad + capHeight(ctx, TYPE.brandSB, nPx), { color: DARK, leading: 1.15 }) : null;
    if (nb) e.mark('name', nb);
    if (size) e.mark('size', drawText(ctx, e.caps(size), TYPE.mono, sPx, ix, y + pad + nl.length * nPx * 1.15 + sPx * 1.4, { tracking: 0.12, color: 'rgba(17,17,17,0.66)' }));
    // Price + unit price.
    if (price) e.mark('price', drawText(ctx, price, TYPE.brand, pPx, x + w - pad, y + pad + capHeight(ctx, TYPE.brand, pPx), { align: 'right', color: DARK }));
    if (unit) e.mark('unit', drawText(ctx, unit, TYPE.mono, fitPx(ctx, unit, TYPE.mono, sPx, iw * 0.5, 0.04), x + w - pad, y + pad + capHeight(ctx, TYPE.brand, pPx) + sPx * 2, { align: 'right', tracking: 0.04, color: 'rgba(17,17,17,0.66)' }));
    // Foot: a hairline, the barcode left, the points pill right.
    const fy = y + pad + topH + 26 * k;
    ctx.fillStyle = 'rgba(17,17,17,0.18)';
    ctx.fillRect(ix, fy - 13 * k, iw, Math.max(1, 1.2 * k));
    const bw = Math.min(150 * k, iw * 0.34);
    bars(ctx, ix, fy + 6 * k, bw, footH - 12 * k, `${f.name}${price}`, DARK);
    const pts = String(f.points ?? '').trim();
    if (pts) {
        const px = 17 * k;
        const room = iw - bw - 30 * k;
        const tp = fitPx(ctx, pts, TYPE.brandSB, px, room - px * 3.2, 0.02);
        const tw = textWidth(ctx, pts, TYPE.brandSB, tp, 0.02);
        const ph = Math.min(footH - 8 * k, 46 * k);
        const pxw = tw + tp * 3.2;
        const bx = x + w - pad - pxw;
        const by = fy + (footH - ph) / 2;
        ctx.fillStyle = DARK;
        ctx.beginPath();
        ctx.roundRect(bx, by, pxw, ph, ph / 2);
        ctx.fill();
        ctx.fillStyle = lift(e.accent);
        ctx.beginPath();
        ctx.arc(bx + tp * 1.15, by + ph / 2, tp * 0.3, 0, Math.PI * 2);
        ctx.fill();
        e.mark('points', drawText(ctx, pts, TYPE.brandSB, tp, bx + tp * 1.8, by + ph / 2 + capHeight(ctx, TYPE.brandSB, tp) / 2, { tracking: 0.02, color: INK }));
    }
    return h;
}

export default {
    id: 'eat-shelf-label',
    name: 'Shelf Label',
    category: 'Eat',
    section: 'Products',
    blurb: 'The product on a lit shelf, a supermarket shelf-edge label under it: price, price per 100g and the POWR points it costs. For brands on a shelf.',
    refs: 'a UK supermarket shelf-edge label',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Now on the shelf' },
        { key: 'title', label: 'Title', rows: 2, value: 'Find it\nin store.', hint: 'Leave empty to hide it.' },
        { key: 'name', label: 'Product (on the label)', rows: 2, value: 'Northside Whey\nSalted Caramel' },
        { key: 'size', label: 'Size', value: '1kg' },
        { key: 'price', label: 'Price', value: '£29.99' },
        { key: 'unit', label: 'Unit price', value: '£3.00 per 100g', hint: 'As on a UK shelf label: the price per 100g, 100ml or each.' },
        { key: 'points', label: 'Points', value: 'or 3,000 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'where', label: 'Line', value: 'At Northside stores and in the POWR app.', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein tub', fields: {}, look: { kind: 'tub' } },
        { name: 'Gym fridge', fields: { kicker: 'In the gym fridge', title: 'Cold, by\nthe door.', name: 'Northside Shake\nCold Brew', size: '330ml', price: '£2.80', unit: '85p per 100ml', points: 'or 280 POWR points', where: 'At the Northside front desk.' }, look: { kind: 'bottle' }, style: { accent: '#D9A066' } },
        { name: 'Snack', fields: { kicker: 'New on the shelf', title: 'Aisle 4.\nTop shelf.', name: 'Northside Granola\nCacao & Hazelnut', size: '400g', price: '£6.50', unit: '£1.63 per 100g', points: 'or 650 POWR points', where: 'In selected stores from Monday.' }, look: { kind: 'pouch' }, style: { accent: '#E0556B' } },
        { name: 'Supplement', fields: { kicker: 'Supplements aisle', title: 'Look for\nthe black jar.', name: 'Northside Daily\nMagnesium', size: '60 capsules', price: '£14.00', unit: '23p each', points: 'or 1,400 POWR points', where: 'Food supplement. Online and in store.' }, look: { kind: 'jar' }, style: { accent: '#7FE0C2' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['jar', 'Jar'], ['pouch', 'Pouch'], ['box', 'Box'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.cost ? { points: `or ${rewardWords(r).points.replace('points', 'POWR points')}` } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const U = unitOf(e);
        const f = e.fields;
        const kind = e.look.kind ?? 'tub';
        const sub = String(f.name ?? '').split('\n')[1] ?? '';
        ground(e, '#0B0B0A');
        backdrop(e);

        if (shape === 'strip') {
            const shelfY = H - safe.b - 60 * U;
            const pw = H * 0.5;
            const px0 = safe.l + 10 * U;
            glow(e, px0 + pw / 2, shelfY - pw * 0.6, pw * 0.8, { strength: 0.45 });
            shelf(e, 0, W, shelfY, U);
            slot(e, { x: px0, y: safe.t, w: pw, h: shelfY - 16 * U - safe.t }, { kind, sub, stage: 0.8 });
            const lx = px0 + pw + 60 * U;
            const lw = Math.min(560 * U, W * 0.4);
            label(e, lx, Math.max(safe.t, shelfY - 16 * U - measure(e, lw, U, 0.86).h), lw, U, { scale: 0.86 });
            const tx = lx + lw + 60 * U;
            const tw = W - safe.r - tx;
            lockup(e, W - safe.r, safe.t, 26 * U, { align: 'right', maxW: tw });
            eyebrow(e, 'kicker', f.kicker, 16 * U, tx, safe.t + 96 * U, { maxW: tw, color: lift(e.accent) });
            head(e, 'title', f.title, tx, safe.t + 122 * U, { maxW: tw, maxH: shelfY - safe.t - 170 * U, lines: 2 });
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const wide = shape === 'wide';
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: lift(e.accent), maxW: w * 0.36 });
        // Label size first: it sets where the shelf goes.
        const lw = wide ? w * 0.44 : sq ? w * 0.56 : w * 0.72;
        const scale = wide ? 1.05 : sq ? 0.82 : tall ? 1.05 : 1;
        const lh = measure(e, lw, U, scale).h;
        const wl = paraLines(e, f.where, TYPE.brandL, 21 * U, wide || sq ? w * 0.4 : w, 2);
        const whereH = wl ? (wl - 1) * 21 * U * 1.32 + 21 * U + 40 * U : 0;
        const lip = 34 * U;
        let shelfY = H - safe.b - (wide || sq ? 0 : whereH) - lh - lip - 14 * U;
        if (tall) shelfY -= 60 * U;
        const lx = wide || sq ? x + w - lw : x + (w - lw) / 2;
        // Title in the air above the shelf; product standing on it.
        const tTop = lk.y + lk.h + (tall ? 90 : 60) * U;
        const tw = wide || sq ? w * 0.46 : w;
        const th = headHeight(e, f.title, { maxW: tw, maxH: (tall ? 240 : wide ? 250 : 170) * U, lines: 3 });
        head(e, 'title', f.title, x, tTop, { maxW: tw, maxH: (tall ? 240 : wide ? 250 : 170) * U, lines: 3 });
        const pTop = wide || sq ? lk.y + lk.h + 50 * U : tTop + th + (tall ? 80 : 50) * U;
        const pcx = wide || sq ? lx + lw / 2 : W / 2;
        const pw = wide || sq ? lw * 0.9 : w * 0.6;
        const pbox = { x: pcx - pw / 2, y: pTop, w: pw, h: shelfY - 16 * U - pTop };
        glow(e, pcx, pTop + pbox.h * 0.55, Math.max(pw * 0.7, pbox.h * 0.5), { strength: 0.45 });
        shelf(e, 0, W, shelfY, U);
        slot(e, pbox, { kind, sub, stage: 0.9 });
        // The label hangs from the lip.
        label(e, lx, shelfY + lip - 8 * U, lw, U, { scale });
        if (wl) {
            if (wide || sq) para(e, 'where', f.where, TYPE.brandL, 21 * U, x, H - safe.b - (wl - 1) * 21 * U * 1.32, w * 0.4, 2, { color: GREY });
            else para(e, 'where', f.where, TYPE.brandL, 21 * U, W / 2, H - safe.b - (wl - 1) * 21 * U * 1.32, w, 2, { color: GREY, align: 'center' });
        }
    },
};
