/**
 * FLAVOUR DROP — a new flavour launch: the flavour's name set enormous and
 * stacked, every line stretched to the full width, in the brand's colour; a
 * "New" chip, the product photo, and the partner's logo big at the foot.
 * Loud, but premium. For protein, snack and drinks brands.
 */
import { TYPE } from '../../../fonts';
import { drawText, splitLines, parseLine, lineMetrics, paintLine, capHeight, wrapLines } from '../../../text';
import { BRAND_FIELDS, brandMark, hasPartner, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, lift, chip, fitPx } from './_parts';

/**
 * The name: each line sized on its own to fill `w`; if the stack is taller
 * than maxH every line comes down by the same factor. Lines sit left at x,
 * the first cap at top. Returns the stack's box.
 */
function stack(e, x, top, w, maxH, { gap = 0.14 } = {}) {
    const { ctx } = e;
    const spec = e.headline;
    const tracking = -0.01;
    const lines = splitLines(e.caps(e.fields.flavour)).slice(0, 4).filter((l) => l.trim());
    if (!lines.length) return null;
    const ref = 200;
    const capRef = capHeight(ctx, spec, ref);
    const fit = lines.map((l) => {
        const segs = parseLine(l);
        const m = lineMetrics(ctx, segs, spec, ref, tracking);
        return { segs, px: (ref * w) / Math.max(1, m.inkW) };
    });
    const total = fit.reduce((a, f) => a + (capRef * f.px) / ref, 0);
    const gapPx = (i) => (capRef * fit[i].px / ref) * gap;
    const gaps = fit.slice(1).reduce((a, _, i) => a + gapPx(i + 1), 0);
    const s = Math.min(1, maxH / (total + gaps)) * (e.look.size ?? 1);
    const colour = lift(e.accent);
    let y = top;
    let box = null;
    fit.forEach((f, i) => {
        const px = f.px * s;
        const cap = (capRef * px) / ref;
        if (i) y += gapPx(i) * s;
        const m = lineMetrics(ctx, f.segs, spec, px, tracking);
        const b = { x, y, w: m.inkW, h: cap };
        e.shade(b, { ceiling: 0.3, max: 0.5, spread: 1.05 });
        // Headline accent flips it: the name in ink, {braced} words in colour.
        paintLine(ctx, f.segs, spec, px, x - m.inkL, y + cap, { tracking, color: e.headlineAccent ? INK : colour, accent: e.headlineAccent ? colour : INK });
        box = box ? { x, y: box.y, w: Math.max(box.w, b.w), h: y + cap - box.y } : b;
        y += cap;
    });
    e.mark('flavour', box);
    return box;
}

// The foot: the partner's mark big (else the product name), then the line.
function foot(e, x, w, bottom, markH, U, { side = false } = {}) {
    const { ctx } = e;
    const f = e.fields;
    const lPx = 24 * U;
    const detail = String(f.detail ?? '').trim();
    const dl = detail ? wrapLines(ctx, detail, TYPE.brandR, lPx, side ? w * 0.5 : w, 2) : [];
    const prodPx = 20 * U;
    const prod = e.caps(f.product).trim();
    if (side && hasPartner(e)) {
        // Mark left, the words right, all on one band.
        const partner = hasPartner(e);
        const mw = w * 0.4;
        let mb = null;
        if (partner) mb = brandMark(e, { x, y: bottom - markH, w: mw, h: markH }, { align: 'left' });
        const tx = mb ? mb.x + mb.w + 40 * U : x;
        let y = bottom;
        if (dl.length) {
            e.mark('detail', drawText(ctx, dl.join('\n'), TYPE.brandR, lPx, tx, y - (dl.length - 1) * lPx * 1.25, { color: SOFT, leading: 1.25 }));
            y -= dl.length * lPx * 1.25 + 8 * U;
        }
        if (prod) e.mark('product', drawText(ctx, prod, TYPE.mono, fitPx(ctx, prod, TYPE.mono, prodPx, x + w - tx, 0.2), tx, y, { tracking: 0.2, color: GREY }));
        return;
    }
    let y = bottom;
    if (dl.length) {
        e.mark('detail', drawText(ctx, dl.join('\n'), TYPE.brandR, lPx, x, y - (dl.length - 1) * lPx * 1.25, { color: SOFT, leading: 1.25 }));
        y -= (dl.length - 1) * lPx * 1.25 + lPx + 22 * U;
    }
    if (hasPartner(e)) {
        brandMark(e, { x, y: y - markH, w: w * 0.6, h: markH }, { align: 'left' });
        y -= markH + 22 * U;
        if (prod) e.mark('product', drawText(ctx, prod, TYPE.mono, fitPx(ctx, prod, TYPE.mono, prodPx, w, 0.2), x, y, { tracking: 0.2, color: GREY }));
    } else if (prod) {
        const px = fitPx(ctx, prod, TYPE.brandSB, markH * 0.7, w * 0.8, 0.02);
        e.mark('product', drawText(ctx, prod, TYPE.brandSB, px, x, y, { tracking: 0.02, color: INK }));
    }
}

export default {
    id: 'flavour-drop',
    name: 'Flavour Drop',
    category: 'Eat',
    blurb: 'A new flavour launch: the name enormous, stacked edge to edge in the brand’s colour, a “New” chip and the logo big.',
    refs: 'a streetwear drop poster, for a tub',
    headlineFont: 'brand',
    fields: [
        { key: 'chip', label: 'Chip', value: 'New flavour' },
        { key: 'flavour', label: 'Flavour', rows: 3, value: 'Salted\nCaramel', hint: 'One to four lines; each stretches to the full width, so short lines set biggest.' },
        { key: 'product', label: 'Product', value: 'Northside Whey' },
        { key: 'detail', label: 'Line', value: '24g protein per scoop. Out now, and in the POWR rewards.', hint: 'Leave empty to hide it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein powder', fields: {} },
        { name: 'Bar', fields: { chip: 'Just landed', flavour: 'Peanut\nCrunch', product: 'Northside Bar', detail: '20g protein · 212 kcal per bar. In store Monday.' } },
        { name: 'Drink', fields: { chip: 'Summer only', flavour: 'Yuzu\n& Lime', product: 'Northside Electrolytes', detail: 'One sachet to a 750ml bottle. Back until September.' }, style: { accent: '#C6E86B' } },
        { name: 'Café special', fields: { chip: 'This week', flavour: 'Cherry\nBakewell\nOats', product: 'The Northside Kitchen', detail: 'Overnight oats, cherry compote, toasted almonds · £4.50' }, style: { accent: '#E0556B' } },
    ],
    look: { ...LOOK, target: 0.3, vignette: 0.55 },
    fill: { reward: (r) => ({ ...rewardWords(r), product: r.brand }) },

    draw(e) {
        const { W, H, u, tu, safe, shape } = e;
        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const U = strip ? tu * 0.9 : tu;
            e.photo({ x: 0, y: 0, w: W, h: H });
            e.fade(0, 0, W * 0.75, H, 'left', 0.85);
            if (strip) e.fade(W * 0.4, 0, W * 0.6, H, 'right', 0.92);
            const x = safe.l + 4 * U;
            const colW = W * (strip ? 0.36 : 0.46);
            const logoW = (strip ? 48 : 70) * U;
            e.logo(INK, W - safe.r - logoW, safe.t, logoW);
            const c = chip(e, 'chip', e.caps(e.fields.chip), x, safe.t, (strip ? 15 : 18) * U, { tracking: 0.14 });
            const top = safe.t + (c ? c.h : 0) + (strip ? 22 : 40) * U;
            const markH = (strip ? 58 : 80) * U;
            const room = H - safe.b - top - (strip ? 0 : markH + 50 * U);
            stack(e, x, top, colW, room);
            if (strip) {
                const fx = Math.max(x + colW + 70 * U, W * 0.6);
                e.shade({ x: fx, y: H * 0.4, w: W - safe.r - fx, h: H * 0.6 - safe.b }, { ceiling: 0.2, max: 0.7 });
                foot(e, fx, W - safe.r - fx, H - safe.b, markH, U, { side: true });
            } else {
                foot(e, x, W - safe.r - x, H - safe.b, markH, U, { side: true });
            }
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * (tall ? 0.55 : 0.6), 'top', 0.85);
        e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.8);
        const x = safe.l + 4 * u;
        const w = W - safe.r - 4 * u - x;
        const logoW = 84 * u;
        e.logo(INK, x, safe.t + 6 * u, logoW);
        chip(e, 'chip', e.caps(e.fields.chip), x + w, safe.t + 4 * u, 20 * u, { align: 'right', tracking: 0.14 });
        const top = safe.t + (tall ? 120 : 110) * u;
        stack(e, x, top, w, H * (tall ? 0.4 : sq ? 0.4 : 0.44));
        foot(e, x, w, H - safe.b - 4 * u, (tall ? 110 : sq ? 76 : 96) * u, u, { side: sq });
    },
};
