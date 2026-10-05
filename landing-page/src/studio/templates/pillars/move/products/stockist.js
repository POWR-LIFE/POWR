/**
 * STOCKIST — where to get it: "Now at" set big and light, the product on
 * its stage, then the stockists as a numbered, ruled list (venue left, area
 * right, a pin in the accent). For brands launching at partner gyms, and
 * gyms that sell kit at the desk.
 */
import { TYPE } from '../../../../fonts';
import { drawText, textWidth } from '../../../../text';
import { rule, dot, ring } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { GREY, SOFT, HAIR, frame, ground, backdrop, line, block, blockHeight, fitPx, makerOf, mono, rowsOf, cap } from './_parts';

const venuesOf = (e) => rowsOf(e.fields.venues).map((c) => ({ name: c[0], place: c.slice(1).join(' · ') })).slice(0, 6);

// The list across x0..x1 from `top`, `rowH` a row. Returns the bottom.
function list(e, rows, x0, x1, top, rowH, px) {
    const { ctx } = e;
    const k = frame(e).k;
    const hair = Math.max(1, 1.2 * k);
    rule(ctx, x0, top, x1, top, HAIR, hair);
    const numW = px * 1.5;
    rows.forEach((r, i) => {
        const y = top + i * rowH;
        const mid = y + rowH / 2;
        const c = cap(e, TYPE.brandM, px);
        drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, px * 0.5, x0, mid + px * 0.18, { tracking: 0.1, color: GREY });
        // The pin: a ringed dot in the accent.
        ring(ctx, x0 + numW + px * 0.35, mid, px * 0.3, e.accent, Math.max(1, 1.8 * k));
        dot(ctx, x0 + numW + px * 0.35, mid, px * 0.1, e.accent);
        const nx = x0 + numW + px * 1.1;
        const pp = px * 0.46;
        const placeW = r.place ? Math.min((x1 - nx) * 0.42, textWidth(ctx, e.caps(r.place), TYPE.mono, pp, 0.14)) : 0;
        drawText(ctx, r.name, TYPE.brandM, fitPx(ctx, r.name, TYPE.brandM, px, x1 - nx - placeW - 20 * k), nx, mid + c / 2, { color: e.ink });
        if (r.place) {
            const t = e.caps(r.place);
            drawText(ctx, t, TYPE.mono, fitPx(ctx, t, TYPE.mono, pp, placeW, 0.14), x1, mid + cap(e, TYPE.mono, pp) / 2, { align: 'right', tracking: 0.14, color: SOFT });
        }
        rule(ctx, x0, y + rowH, x1, y + rowH, HAIR, hair);
    });
    const bottom = top + rows.length * rowH;
    if (rows.length) e.mark('venues', { x: x0, y: top, w: x1 - x0, h: bottom - top });
    return bottom;
}

const HEAD = { caps: false, tracking: -0.035, gap: 0.08, maxLines: 2 };

export default {
    id: 'move-stockist',
    name: 'Stockist',
    category: 'Move',
    section: 'Products',
    blurb: '"Now at": the product on its stage and the stockists as a numbered, ruled list with pins. For brands launching at partner gyms, and gyms selling kit.',
    refs: 'a stockist list in a lookbook',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Stockists' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Now at' },
        { key: 'name', label: 'Product name', value: 'Trail bottle · £32' },
        { key: 'venues', label: 'Where', rows: 6, value: 'Northside Gym · Shoreditch\nNorthside Gym · Canary Wharf\nNorthside Gym · King’s Cross\nCanal Yard · Hackney\nNorthside Run Club · Peckham', hint: 'One per line: venue · area. Up to six.' },
        { key: 'note', label: 'Line', value: 'And for points in the POWR app.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Launch at gyms', fields: { eyebrow: 'Stockists', headline: 'Now at', name: 'Trail bottle · £32', venues: 'Northside Gym · Shoreditch\nNorthside Gym · Canary Wharf\nNorthside Gym · King’s Cross\nCanal Yard · Hackney\nNorthside Run Club · Peckham', note: 'And for points in the POWR app.' } },
        { name: 'At the desk', fields: { eyebrow: 'Front desk', headline: 'In the gym\nshop now', name: 'POWR club hoodie · £55', venues: 'Northside · Shoreditch\nNorthside · Canary Wharf\nNorthside · King’s Cross', note: 'Ask at reception.' } },
        { name: 'Pop-up tour', fields: { eyebrow: 'Pop-up tour', headline: 'Try it on', name: 'Tempo runner', venues: 'Sat 03 Oct · London\nSat 10 Oct · Bristol\nSat 17 Oct · Manchester\nSat 24 Oct · Leeds', note: 'Members first in the POWR app.' } },
        { name: 'Cities', fields: { eyebrow: 'Stockists', headline: 'Now in\nsix cities', name: 'Studio tight', venues: 'London · 12 stores\nManchester · 4 stores\nBristol · 3 stores\nLeeds · 2 stores\nGlasgow · 2 stores\nCardiff · 1 store', note: '' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), note: r.value ? `Or ${r.value}${r.unit ? ` ${r.unit}` : ''} with points in the POWR app.` : 'And for points in the POWR app.' }),
    },

    draw(e) {
        const f = frame(e);
        const { W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const rows = venuesOf(e);
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const opts = { kind: 'bottle', label: makerOf(e), sub: String(e.fields.name ?? '').split('·')[0] };

        if (strip) {
            const pw = W * 0.14;
            const px0 = x1 - pw;
            ground(e, { cx: px0 + pw / 2, cy: H * 0.55, r: H * 0.8 });
            backdrop(e);
            productShot(e, { x: px0, y: y0, w: pw, h: y1 - y0 }, opts);
            lockup(e, x0, y0, 34 * k, { maxW: W * 0.2 });
            const hw = W * 0.26;
            block(e, 'headline', x0, y1 - 60 * k, hw, (y1 - y0) * 0.55, { ...HEAD, bottom: true });
            line(e, 'name', TYPE.brandM, 24 * k, x0, y1, hw, { color: SOFT });
            const lx = x0 + hw + 50 * k;
            const lx1 = px0 - 40 * k;
            const half = Math.ceil(rows.length / 2);
            const cols = rows.length > 3 ? [rows.slice(0, half), rows.slice(half)] : [rows];
            const cw = (lx1 - lx - (cols.length - 1) * 40 * k) / cols.length;
            const rowH = (y1 - y0) / Math.max(3, half);
            cols.forEach((c, i) => list(e, c, lx + i * (cw + 40 * k), lx + i * (cw + 40 * k) + cw, y0, rowH, Math.min(26 * k, rowH * 0.36)));
            return;
        }

        if (sq || wide) {
            const pw = (x1 - x0) * (wide ? 0.34 : 0.36);
            const lh = (wide ? 48 : 44) * k;
            ground(e, { cx: x0 + pw / 2, cy: H * 0.58, r: pw });
            backdrop(e);
            productShot(e, { x: x0, y: y0 + lh + 60 * k, w: pw, h: y1 - y0 - lh - 60 * k }, opts);
            lockup(e, x0, y0, lh, { maxW: pw });
            const cx = x0 + pw + (wide ? 90 : 50) * k;
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 6 * k, 15 * k, { align: 'right', maxW: (x1 - cx) * 0.5, color: SOFT }));
            const hMax = (wide ? 150 : 120) * k;
            const hh = blockHeight(e, 'headline', x1 - cx, hMax * 1.9, { ...HEAD, max: hMax });
            const hTop = y0 + lh + 40 * k;
            block(e, 'headline', cx, hTop, x1 - cx, hMax * 1.9, { ...HEAD, max: hMax });
            const nb = hTop + hh + 30 * k + 28 * k;
            line(e, 'name', TYPE.brandM, (wide ? 30 : 26) * k, cx, nb, x1 - cx, { color: SOFT });
            const noteH = String(e.fields.note ?? '').trim() ? 50 * k : 0;
            const lTop = nb + 36 * k;
            const rowH = Math.min(84 * k, (y1 - noteH - lTop) / Math.max(1, rows.length));
            const lb = list(e, rows, cx, x1, lTop, rowH, Math.min(32 * k, rowH * 0.4));
            line(e, 'note', TYPE.brandR, (wide ? 24 : 21) * k, cx, Math.min(y1, lb + 50 * k), x1 - cx, { color: GREY });
            return;
        }

        // Post and story.
        const lh = 54 * k;
        const px = (tall ? 36 : 32) * k;
        const rowH = (tall ? 92 : 78) * k;
        const noteH = String(e.fields.note ?? '').trim() ? 56 * k : 0;
        const lTop = y1 - noteH - rows.length * rowH;
        const top = y0 + lh + (tall ? 70 : 44) * k;
        const hMax = (tall ? 200 : 170) * k;
        const hw = (x1 - x0) * (tall ? 1 : 0.56);
        const hh = blockHeight(e, 'headline', hw, hMax * 1.9, { ...HEAD, max: hMax });
        const pTop = tall ? top + hh + 110 * k : top;
        const pBox = tall
            ? { x: x0 + (x1 - x0) * 0.15, y: pTop, w: (x1 - x0) * 0.7, h: lTop - 50 * k - pTop }
            : { x: x0 + (x1 - x0) * 0.56, y: pTop, w: (x1 - x0) * 0.44, h: lTop - 40 * k - pTop };
        ground(e, { cx: pBox.x + pBox.w / 2, cy: pBox.y + pBox.h * 0.6, r: Math.max(pBox.w, pBox.h * 0.6) });
        backdrop(e);
        productShot(e, pBox, opts);
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, 18 * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        block(e, 'headline', x0, top, hw, hMax * 1.9, { ...HEAD, max: hMax });
        line(e, 'name', TYPE.brandM, (tall ? 34 : 30) * k, x0, top + hh + (tall ? 60 : 56) * k, tall ? x1 - x0 : hw - 20 * k, { color: SOFT });
        list(e, rows, x0, x1, lTop, rowH, px);
        line(e, 'note', TYPE.brandR, (tall ? 28 : 24) * k, x0, y1, x1 - x0, { color: GREY });
    },
};
