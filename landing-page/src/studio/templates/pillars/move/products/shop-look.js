/**
 * SHOP THE LOOK — a lifestyle photo, large, with the product pulled out on
 * an inset card (the cut-out, its name, price and sizes) and the look's
 * number set big and light in the corner. An optional pin marks the piece in
 * the photo and ties it to the card. For activewear and footwear.
 */
import { TYPE } from '../../../../fonts';
import { drawText } from '../../../../text';
import { rule, dot, ring } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { SOFT, HAIR, frame, line, fitPx, rrect, makerOf, mono, cap } from './_parts';

// "Look 04" → ["Look", "04"]; a bare number is the number.
function lookOf(e) {
    const s = String(e.fields.look ?? '').trim();
    const m = s.match(/^(.*?)\s*(\d+)\s*$/);
    return m ? [m[1].trim(), m[2]] : [s, ''];
}

// The look number: its word in mono over the figure. (x, base) is the figure's baseline.
function lookMark(e, x, base, px, align = 'left') {
    const [word, num] = lookOf(e);
    const k = frame(e).k;
    const spec = e.headline;
    let box = null;
    if (num) box = drawText(e.ctx, num, spec, px, x - (align === 'left' ? px * 0.05 : 0), base, { align, tracking: -0.03, color: e.ink });
    const top = num ? base - cap(e, spec, px) - 22 * k : base;
    const w = mono(e, word, x, top, Math.max(13 * k, px * 0.12), { align, color: SOFT, tracking: 0.3 });
    const out = box && w ? { x: Math.min(box.x, w.x), y: w.y, w: Math.max(box.x + box.w, w.x + w.w) - Math.min(box.x, w.x), h: base - w.y } : box ?? w;
    e.mark('look', out);
    return out;
}

// A pin on the photo: where the piece is. Returns its centre or null.
function pin(e, rect) {
    const m = String(e.fields.pin ?? '').trim().match(/^([01]?(?:\.\d+)?)\s+([01]?(?:\.\d+)?)$/);
    if (!m) return null;
    const k = frame(e).k;
    const x = rect.x + Math.min(1, parseFloat(m[1])) * rect.w;
    const y = rect.y + Math.min(1, parseFloat(m[2])) * rect.h;
    ring(e.ctx, x, y, 22 * k, 'rgba(244,241,234,0.85)', Math.max(1, 2 * k));
    dot(e.ctx, x, y, 9 * k, e.accent);
    e.mark('pin', { x: x - 22 * k, y: y - 22 * k, w: 44 * k, h: 44 * k });
    return { x, y };
}

/**
 * The card at (x, y, w, h): the product staged on top, then name + price,
 * details, a hairline and the line. `horizontal` puts the product left.
 */
function card(e, x, y, w, h, { pad, px, horizontal = false }) {
    const { ctx } = e;
    const k = frame(e).k;
    ctx.save();
    rrect(ctx, x, y, w, h, 26 * k);
    ctx.fillStyle = 'rgba(16,16,15,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.14)';
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.stroke();
    ctx.restore();
    const textH = px * 1.1 + px * 0.9 + px * 0.5 + 28 * k + px * 0.55;
    let ix0 = x + pad;
    const ix1 = x + w - pad;
    let ty = y + h - pad - textH;
    let pBox = { x: x + pad, y: y + pad * 0.8, w: w - pad * 2, h: ty - y - pad * 1.4 };
    if (horizontal) {
        pBox = { x: x + pad * 0.6, y: y + pad * 0.6, w: w * 0.36, h: h - pad * 1.2 };
        ix0 = pBox.x + pBox.w + pad * 0.8;
        ty = y + (h - textH) / 2;
    }
    // A lit plinth inside the card for the product to sit on.
    const g = ctx.createRadialGradient(pBox.x + pBox.w / 2, pBox.y + pBox.h * 0.6, 0, pBox.x + pBox.w / 2, pBox.y + pBox.h * 0.6, Math.max(pBox.w, pBox.h) * 0.7);
    g.addColorStop(0, 'rgba(255,250,238,0.08)');
    g.addColorStop(1, 'rgba(255,250,238,0)');
    ctx.fillStyle = g;
    ctx.fillRect(pBox.x, pBox.y, pBox.w, pBox.h);
    productShot(e, pBox, { kind: 'pouch', label: makerOf(e), sub: e.fields.name, radius: 14 });
    const tw = ix1 - ix0;
    const nb = ty + px * 0.8;
    const pr = line(e, 'price', TYPE.brandL, px, ix1, nb, tw * 0.4, { align: 'right', tracking: -0.02 });
    line(e, 'name', TYPE.brandSB, px, ix0, nb, tw - (pr ? pr.w + 24 * k : 0), { tracking: -0.01 });
    line(e, 'detail', TYPE.mono, px * 0.42, ix0, nb + px * 0.9, tw, { color: SOFT, tracking: 0.14, caps: true });
    const ry = nb + px * 0.9 + px * 0.5 + 10 * k;
    rule(ctx, ix0, ry, ix1, ry, HAIR, Math.max(1, 1.2 * k));
    line(e, 'cta', TYPE.brandR, px * 0.52, ix0, ry + 18 * k + px * 0.45, tw, { color: e.ink });
    return { x, y, w, h };
}

// A thin line from the pin to the card's nearest edge.
function tie(e, p, c) {
    if (!p) return;
    const k = frame(e).k;
    const tx = Math.min(Math.max(p.x, c.x), c.x + c.w);
    const ty = Math.min(Math.max(p.y, c.y), c.y + c.h);
    if (Math.hypot(tx - p.x, ty - p.y) < 40 * k) return;
    const d = Math.hypot(tx - p.x, ty - p.y);
    rule(e.ctx, p.x + ((tx - p.x) / d) * 24 * k, p.y + ((ty - p.y) / d) * 24 * k, tx, ty, 'rgba(244,241,234,0.6)', Math.max(1, 1.4 * k));
}

export default {
    id: 'move-shop-look',
    name: 'Shop the Look',
    category: 'Move',
    section: 'Products',
    blurb: 'A lifestyle photo, large, with the product on an inset card (cut-out, name, price, sizes) and the look number big in the corner. For apparel and footwear.',
    refs: 'a lookbook page',
    headlineFont: 'brandXL',
    fields: [
        { key: 'look', label: 'Look', value: 'Look 04' },
        { key: 'name', label: 'Product name', value: 'Studio tight' },
        { key: 'price', label: 'Price', value: '£68' },
        { key: 'detail', label: 'Details', value: 'Black · XS–XL' },
        { key: 'cta', label: 'Line', value: 'Members first in the POWR app.' },
        { key: 'pin', label: 'Pin on the photo', value: '', hint: 'Optional: across and down the photo (0–1), e.g. 0.5 0.6, to mark the piece.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Leggings', fields: { look: 'Look 04', name: 'Studio tight', price: '£68', detail: 'Black · XS–XL', cta: 'Members first in the POWR app.' } },
        { name: 'Run kit', fields: { look: 'Look 11', name: 'Tempo runner', price: '£125', detail: 'Chalk / Volt · UK 3–13', cta: 'Or 3,200 POWR points.' } },
        { name: 'Gym merch', fields: { look: 'Club 02', name: 'POWR club hoodie', price: '£55', detail: 'Carbon · S–XL', cta: 'At the front desk this week.' } },
        { name: 'Gear', fields: { look: 'Look 07', name: 'Kit holdall', price: '£85', detail: '32 L · Black', cta: 'Every session counts.' } },
    ],
    look: {
        mono: 1, target: 0.26, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.55, vignette: 0.45, grain: 0.45, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), cta: r.cost ? `Or ${Number(r.cost).toLocaleString('en-GB')} POWR points.` : 'Members first in the POWR app.' }),
    },

    draw(e) {
        const f = frame(e);
        const { W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;

        if (wide) {
            // The photo left, the card standing in the dark column on the right.
            const pw = W * 0.6;
            const rect = { x: 0, y: 0, w: pw, h: H };
            e.photo(rect);
            e.fade(pw - W * 0.12, 0, W * 0.12, H, 'right', 0.7);
            e.fade(0, 0, pw, H * 0.3, 'top', 0.5);
            e.fade(0, H * 0.55, pw, H * 0.45, 'bottom', 0.6);
            const p = pin(e, rect);
            lockup(e, x0, y0, 50 * k, { maxW: pw * 0.5 });
            lookMark(e, x0, y1, 170 * k);
            const cx = pw + 60 * k;
            const c = card(e, cx, y0, x1 - cx, y1 - y0, { pad: 40 * k, px: 42 * k });
            tie(e, p, c);
            return;
        }
        if (strip) {
            const rect = { x: 0, y: 0, w: W, h: H };
            e.photo(rect);
            e.fade(0, 0, W * 0.45, H, 'left', 0.7);
            e.fade(W * 0.5, 0, W * 0.5, H, 'right', 0.6);
            const p = pin(e, rect);
            lockup(e, x0, y0, 36 * k, { maxW: W * 0.25 });
            lookMark(e, x0, y1, 150 * k);
            const cw = W * 0.36;
            const c = card(e, x1 - cw, y0, cw, y1 - y0, { pad: 26 * k, px: 34 * k, horizontal: true });
            tie(e, p, c);
            return;
        }

        const rect = { x: 0, y: 0, w: W, h: H };
        e.photo(rect);
        e.fade(0, 0, W, H * 0.22, 'top', 0.55);
        e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.7);
        const p = pin(e, rect);
        const lh = (sq ? 46 : 54) * k;
        e.shade({ x: x0, y: y0, w: W * 0.3, h: lh }, { ceiling: 0.3, max: 0.5 });
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        const cw = (x1 - x0) * (tall ? 0.56 : sq ? 0.44 : 0.48);
        const ch = Math.min(H * (tall ? 0.36 : sq ? 0.56 : 0.46), cw * 1.45);
        const c = card(e, x1 - cw, y1 - ch, cw, ch, { pad: (sq ? 28 : 34) * k, px: (tall ? 46 : sq ? 34 : 40) * k });
        tie(e, p, c);
        const lPx = Math.min((tall ? 250 : sq ? 170 : 210) * k, (x1 - cw - x0 - 40 * k) * 0.9);
        const lb = { x: x0, y: y1 - lPx, w: x1 - cw - x0, h: lPx };
        e.shade(lb, { ceiling: 0.26, max: 0.6 });
        const [, num] = lookOf(e);
        lookMark(e, x0, y1, num ? fitPx(e.ctx, num, e.headline, lPx, x1 - cw - x0 - 40 * k, -0.03) : lPx);
    },
};
