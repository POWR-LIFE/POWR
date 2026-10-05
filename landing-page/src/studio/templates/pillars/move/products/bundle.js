/**
 * BUNDLE — a kit bundle sold as one: the product up top, then what's in it
 * as a ruled list, each piece on a "+" with its own price, and the total at
 * the foot: the bundle price big, the pieces' sum struck through beside it
 * and what it saves in an accent chip (both worked out from the list).
 * For kit and gear brands, and gyms selling a starter pack.
 */
import { TYPE } from '../../../../fonts';
import { drawText, textWidth } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup, textOn } from '../../kit';
import { GREY, SOFT, HAIR, frame, ground, backdrop, line, block, blockHeight, fitPx, makerOf, mono, money, currency, price, rrect, cap } from './_parts';

// "Trail bottle · £32" → { name, cost }. At most 5.
function itemsOf(e) {
    return String(e.fields.items ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            const m = l.match(/^(.*?)\s*(?:·|\||—|–|\s-\s)?\s*([£$€]\s?[\d,.]+)\s*$/);
            return m ? { name: m[1].replace(/[·|—–-]\s*$/, '').trim(), cost: m[2] } : { name: l, cost: '' };
        })
        .slice(0, 5);
}

// The + mark: two accent bars.
function plus(ctx, cx, cy, s, color, w) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - s / 2, cy - w / 2, s, w);
    ctx.fillRect(cx - w / 2, cy - s / 2, w, s);
}

// The list from `top` across x0..x1, rows `rowH` tall. Returns the bottom.
function list(e, items, x0, x1, top, rowH, px) {
    const { ctx } = e;
    const k = frame(e).k;
    const hair = Math.max(1, 1.2 * k);
    const labPx = Math.max(12 * k, px * 0.44);
    e.mark('listLabel', mono(e, e.fields.listLabel, x0, top + labPx, labPx, { color: GREY }));
    if (items.length) mono(e, `${items.length} ${items.length === 1 ? 'piece' : 'pieces'}`, x1, top + labPx, labPx, { align: 'right', color: GREY });
    let y = top + labPx + 20 * k;
    rule(ctx, x0, y, x1, y, HAIR, hair);
    const c = cap(e, TYPE.brandR, px);
    items.forEach((it) => {
        const mid = y + rowH / 2;
        plus(ctx, x0 + px * 0.35, mid, px * 0.6, e.accent, Math.max(1.5, px * 0.09));
        const pw = it.cost ? textWidth(ctx, it.cost, TYPE.brandL, px, 0) : 0;
        const nx = x0 + px * 1.3;
        drawText(ctx, it.name, TYPE.brandR, fitPx(ctx, it.name, TYPE.brandR, px, x1 - nx - pw - 30 * k), nx, mid + c / 2, { color: e.ink });
        if (it.cost) drawText(ctx, it.cost, TYPE.brandL, px, x1, mid + c / 2, { align: 'right', color: SOFT });
        y += rowH;
        rule(ctx, x0, y, x1, y, HAIR, hair);
    });
    if (items.length) e.mark('items', { x: x0, y: top + labPx + 20 * k, w: x1 - x0, h: y - top - labPx - 20 * k });
    return y;
}

// The total: bundle price big, the sum struck through, the saving chip. Baseline at `base`.
function total(e, items, x0, x1, base, px) {
    const { ctx } = e;
    const k = frame(e).k;
    const bundle = money(e.fields.price);
    const sign = currency(e.fields.price || items[0]?.cost);
    const sum = items.reduce((a, it) => a + (Number.isFinite(money(it.cost)) ? money(it.cost) : 0), 0);
    const save = Number.isFinite(bundle) && sum > bundle ? sum - bundle : 0;
    const labPx = Math.max(12 * k, px * 0.16);
    e.mark('totalLabel', mono(e, e.fields.totalLabel, x0, base - cap(e, TYPE.brandL, px) - 22 * k, labPx, { color: GREY }));
    const pb = line(e, 'price', TYPE.brandL, px, x0 - px * 0.04, base, (x1 - x0) * 0.5, { tracking: -0.03 });
    let x = pb ? pb.x + pb.w + px * 0.22 : x0;
    if (save) {
        const was = price(sum, sign);
        const wPx = px * 0.36;
        const wb = drawText(ctx, was, TYPE.brandL, wPx, x, base, { color: GREY });
        if (wb) rule(ctx, wb.x - 3 * k, wb.y + wb.h * 0.55, wb.x + wb.w + 3 * k, wb.y + wb.h * 0.55, GREY, Math.max(1, 2 * k));
        x += (wb?.w ?? 0) + px * 0.2;
        // The saving: an accent chip, right-aligned.
        const t = `SAVE ${price(save, sign)}`;
        const h = Math.max(34 * k, px * 0.42);
        const tp = h * 0.4;
        const w = textWidth(ctx, t, TYPE.mono, tp, 0.14) + h * 1.1;
        if (x1 - w > x) {
            ctx.save();
            rrect(ctx, x1 - w, base - h, w, h, h / 2);
            ctx.fillStyle = e.accent;
            ctx.fill();
            ctx.restore();
            drawText(ctx, t, TYPE.mono, tp, x1 - w + h * 0.55, base - h / 2 + cap(e, TYPE.mono, tp) / 2, { tracking: 0.14, color: textOn(e.accent) });
        }
    }
}

const TITLE = { caps: false, tracking: -0.02, gap: 0.14, maxLines: 3 };

export default {
    id: 'move-bundle',
    name: 'Bundle',
    category: 'Move',
    section: 'Products',
    blurb: 'A kit bundle: the product, what’s in it as a ruled list with + marks and prices, the bundle price with the sum struck through and the saving (worked out for you).',
    refs: 'a store’s bundle card',
    headlineFont: 'brandM',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Kit bundle' },
        { key: 'title', label: 'Title', rows: 2, value: 'The long-run\nbundle' },
        { key: 'listLabel', label: 'List label', value: 'In the bundle' },
        { key: 'items', label: 'What’s in it', rows: 5, value: 'Trail bottle 750 ml · £32\nRun cap · £22\nSocks, three pairs · £18\nKit holdall · £50', hint: 'One per line: the piece · its price. Up to five. The saving is worked out from these.' },
        { key: 'totalLabel', label: 'Total label', value: 'Bundle price' },
        { key: 'price', label: 'Bundle price', value: '£99' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Run bundle', fields: { eyebrow: 'Kit bundle', title: 'The long-run\nbundle', items: 'Trail bottle 750 ml · £32\nRun cap · £22\nSocks, three pairs · £18\nKit holdall · £50', price: '£99' } },
        { name: 'Studio set', fields: { eyebrow: 'Matching set', title: 'Studio set', items: 'Studio tight · £68\nStudio bra · £42\nStudio tee · £35', price: '£125' } },
        { name: 'Gym starter', fields: { eyebrow: 'New members', title: 'Starter pack', items: 'Shaker · £12\nGym towel · £15\nPOWR club tee · £28\nLock + key · £8', price: '£49', totalLabel: 'At the desk' } },
        { name: 'Recovery kit', fields: { eyebrow: 'Kit bundle', title: 'Rest-day kit', items: 'Foam roller · £30\nMassage ball · £12\nSlides · £35', price: '£65' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), ...(r.value ? { eyebrow: `${r.value}${r.unit ? ` ${r.unit}` : ''} with points` } : {}) }),
    },

    draw(e) {
        const f = frame(e);
        const { W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const items = itemsOf(e);
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const opts = { kind: 'box', label: makerOf(e), sub: e.fields.title };

        if (strip) {
            const pw = W * 0.18;
            ground(e, { cx: x0 + pw / 2, cy: H * 0.55, r: H * 0.8 });
            backdrop(e);
            productShot(e, { x: x0, y: y0, w: pw, h: y1 - y0 }, opts);
            const tx = x0 + pw + 50 * k;
            const tw = W * 0.24;
            lockup(e, tx, y0, 34 * k, { maxW: tw });
            block(e, 'title', tx, y1 - 70 * k, tw, (y1 - y0) * 0.45, { ...TITLE, bottom: true, maxLines: 2 });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, tx, y1, 13 * k, { maxW: tw, color: SOFT }));
            const lx = tx + tw + 50 * k;
            const lx1 = W * 0.74;
            const rows = items.slice(0, 4);
            list(e, rows, lx, lx1, y0, (y1 - y0 - 40 * k) / Math.max(3, rows.length), 24 * k);
            total(e, items, lx1 + 50 * k, x1, y1, 84 * k);
            return;
        }

        const side = sq || wide;
        if (side) {
            // Product left, everything else in the right column.
            const pw = (x1 - x0) * (wide ? 0.4 : 0.4);
            ground(e, { cx: x0 + pw / 2, cy: H * 0.55, r: pw });
            backdrop(e);
            productShot(e, { x: x0, y: y0 + 90 * k, w: pw, h: y1 - y0 - 90 * k }, opts);
            lockup(e, x0, y0, (wide ? 48 : 44) * k, { maxW: pw });
            const cx = x0 + pw + (wide ? 90 : 50) * k;
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + 30 * k, 15 * k, { align: 'right', maxW: (x1 - cx) * 0.5, color: SOFT }));
            const tPx = (wide ? 64 : 54) * k;
            const th = blockHeight(e, 'title', x1 - cx, tPx * 2.4, { ...TITLE, max: tPx });
            const tTop = y0 + 70 * k;
            block(e, 'title', cx, tTop, x1 - cx, tPx * 2.4, { ...TITLE, max: tPx });
            const totPx = (wide ? 96 : 84) * k;
            const listTop = tTop + th + 40 * k;
            const listBottom = y1 - totPx - 70 * k;
            const rowH = Math.min(70 * k, (listBottom - listTop - 50 * k) / Math.max(1, items.length));
            list(e, items, cx, x1, listTop, rowH, Math.min(28 * k, rowH * 0.42));
            total(e, items, cx, x1, y1, totPx);
            return;
        }

        // Post and story: title + product side by side up top, list, total.
        const lh = tall ? 54 * k : 52 * k;
        const totPx = (tall ? 130 : 110) * k;
        const rowH = (tall ? 84 : 70) * k;
        const px = (tall ? 34 : 30) * k;
        const listH = 12 * k + 20 * k + items.length * rowH + 20 * k;
        const listTop = y1 - totPx - 70 * k - listH;
        const top = y0 + lh + 40 * k;
        const pw = (x1 - x0) * 0.46;
        const pBox = { x: x1 - pw, y: top, w: pw, h: listTop - top - 40 * k };
        ground(e, { cx: pBox.x + pw / 2, cy: pBox.y + pBox.h * 0.6, r: Math.max(pw, pBox.h * 0.6) });
        backdrop(e);
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, 17 * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        productShot(e, pBox, opts);
        const tPx = (tall ? 92 : 80) * k;
        block(e, 'title', x0, top + 30 * k, x1 - x0 - pw - 30 * k, pBox.h * 0.8, { ...TITLE, max: tPx });
        list(e, items, x0, x1, listTop, rowH, px);
        total(e, items, x0, x1, y1, totPx);
    },
};
