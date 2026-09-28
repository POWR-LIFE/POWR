/**
 * LAYERS — an ingredient stack, like a layered parfait: the frame cut into
 * bands of the brand's colour (tints and shades of the accent) laid over the
 * photo, each labelled with an ingredient and how much; the band heights
 * follow the quantities. The top band carries the product. Across a banner
 * the layers turn into columns.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, capHeight, fitBlock, drawBlock, splitLines, blockBox } from '../../../text';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, DARK, rows, mix, alpha, luminance, num, fitPx, lift } from './_parts';

const layersOf = (e) => rows(e.fields.layers, 6).filter((r) => r[0]).map(([name = '', q = '']) => ({ name, q, n: num(q) }));

/**
 * Band colours from the accent: the top band (the product, the lockup) is
 * the accent taken almost to black, each layer under it a step clearer, so
 * the frame stays dark and the photo shows through more as the stack goes down. `ink` is the text colour each band needs, judged
 * on the band as it lands over a mid-dark photo.
 */
function palette(e, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
        const k = (i - 1) / Math.max(1, n - 1);
        // Smoked glass: near-black with a breath of the brand colour, so any
        // accent (POWR yellow included) stays dark and premium; the colour
        // itself lives in the rules and the quantities.
        const t = i === 0 ? 0.95 : 0.93 - 0.05 * k;
        const c = mix(e.accent, '#0B0B0B', t);
        const a = i === 0 ? 0.9 : 0.74 - 0.14 * k;
        const seen = luminance(c) * a + 0.08 * (1 - a);
        out.push({ fill: alpha(c, a), ink: seen > 0.3 ? DARK : INK, soft: seen > 0.3 ? 'rgba(17,17,17,0.7)' : 'rgba(244,241,234,0.72)' });
    }
    return out;
}

// Shares of `total` for each layer: by quantity, but never under `min`.
function shares(list, total, min) {
    const sum = list.reduce((a, l) => a + (l.n > 0 ? l.n : 0), 0);
    let s = list.map((l) => (sum > 0 && l.n > 0 ? l.n / sum : 1 / list.length) * total);
    const small = s.map((v) => v < min);
    if (small.some(Boolean)) {
        const fixed = small.filter(Boolean).length * min;
        const rest = s.reduce((a, v, i) => a + (small[i] ? 0 : v), 0);
        s = s.map((v, i) => (small[i] ? min : (v * (total - fixed)) / Math.max(1, rest)));
    }
    return s;
}

export default {
    id: 'layers',
    name: 'Layers',
    category: 'Eat',
    blurb: 'An ingredient stack like a layered parfait: bands in shades of the brand colour, each an ingredient and how much.',
    refs: 'a layered parfait, cut in section',
    headlineFont: 'brandB',
    fields: [
        { key: 'product', label: 'Product (top band)', rows: 2, value: 'The Northside\nParfait' },
        { key: 'note', label: 'Line under it', value: 'Per pot · 318 kcal · 26g protein', hint: 'Leave empty to hide it.' },
        { key: 'layers', label: 'Layers', rows: 5, value: 'Granola | 40g\nBlueberry compote | 60g\nGreek yoghurt | 150g\nNorthside Whey, vanilla | 15g', hint: 'Top to bottom, three to six lines: ingredient | amount. Band heights follow the amounts.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Parfait', fields: {} },
        { name: 'Smoothie', fields: { product: 'Berry\nsmoothie', note: 'Blend, pour, go · 420ml', layers: 'Frozen berries | 120g\nBanana | 1\nOat milk | 250ml\nNorthside Whey | 30g\nChia seeds | 1 tbsp' }, style: { accent: '#B06BD9' } },
        { name: 'Overnight oats', fields: { product: 'Overnight\noats', note: 'Make tonight. Eat tomorrow.', layers: 'Sliced banana | 1\nPeanut butter | 15g\nRolled oats | 60g\nMilk | 150ml' }, style: { accent: '#D9A066' } },
        { name: 'Café pot', fields: { product: 'Mango &\npassion pot', note: 'The gym kitchen · £3.80 · Redeem with POWR points', layers: 'Passion fruit | 20g\nMango | 80g\nCoconut yoghurt | 120g\nToasted oats | 30g' }, style: { accent: '#F2A93B' } },
    ],
    look: { ...LOOK, target: 0.3 },
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, u, tu, safe, shape } = e;
        e.photo({ x: 0, y: 0, w: W, h: H });
        const list = layersOf(e);
        const pal = palette(e, list.length);
        const strip = shape === 'strip';
        const wide = shape === 'wide';
        const U = strip || wide ? tu : u;

        if (strip) {
            // Columns: the product first, then one per layer.
            const headW = W * 0.3;
            ctx.fillStyle = pal[0].fill;
            ctx.fillRect(0, 0, headW, H);
            const ws = shares(list, W - headW, W * 0.13);
            let x = headW;
            let box = null;
            list.forEach((l, i) => {
                const p = pal[i + 1];
                ctx.fillStyle = p.fill;
                ctx.fillRect(x, 0, ws[i], H);
                const tx = x + 22 * U;
                const cw = ws[i] - 40 * U;
                const px = fitPx(ctx, l.name, TYPE.brandSB, 30 * U, cw);
                drawText(ctx, l.name, TYPE.brandSB, px, tx, safe.t + capHeight(ctx, TYPE.brandSB, px), { color: p.ink });
                drawText(ctx, l.q, TYPE.brandL, fitPx(ctx, l.q, TYPE.brandL, 52 * U, cw), tx, H - safe.b, { color: p.ink });
                const b = { x, y: safe.t, w: ws[i], h: H - safe.t - safe.b };
                box = box ? { ...box, w: b.x + b.w - box.x } : b;
                x += ws[i];
            });
            e.mark('layers', box);
            const x0 = safe.l;
            const lk = lockup(e, x0, safe.t, 26 * U, { color: pal[0].ink, maxW: headW - x0 - 20 * U });
            const lines = splitLines(e.fields.product).slice(0, 2);
            const noteOn = String(e.fields.note ?? '').trim();
            const nPx = 17 * U;
            const bottom = H - safe.b - (noteOn ? nPx + 16 * U : 0);
            const block = fitBlock(ctx, lines, e.headline, { maxW: headW - x0 - 30 * U, maxH: bottom - lk.y - lk.h - 30 * U, gap: 0.14 });
            const bh = block.cap + (lines.length - 1) * block.step;
            e.mark('product', blockBox(drawBlock(ctx, block, e.headline, x0, bottom - bh, { color: pal[0].ink })));
            if (noteOn) e.mark('note', drawText(ctx, e.fields.note, TYPE.brandR, fitPx(ctx, e.fields.note, TYPE.brandR, nPx, headW - x0 - 30 * U), x0, H - safe.b, { color: pal[0].soft }));
            return;
        }

        // Bands down the frame. The top band holds the lockup and product;
        // the layers share what's left, the last one running off the foot.
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x0 = safe.l + 6 * U;
        const x1 = W - safe.r - 6 * U;
        const headH = safe.t + H * (tall ? 0.2 : wide ? 0.34 : sq ? 0.3 : 0.28);
        ctx.fillStyle = pal[0].fill;
        ctx.fillRect(0, 0, W, headH);
        const lk = lockup(e, x0, safe.t + 4 * U, (wide ? 36 : 40) * U, { color: pal[0].ink, maxW: x1 - x0 });
        const noteOn = String(e.fields.note ?? '').trim();
        const nPx = 22 * U;
        const pBottom = headH - (noteOn ? nPx + 26 * U : 0) - 30 * U;
        const lines = splitLines(e.fields.product).slice(0, 2);
        const block = fitBlock(ctx, lines, e.headline, { maxW: (x1 - x0) * (wide ? 0.6 : 0.9) * (e.look.size ?? 1), maxH: (pBottom - lk.y - lk.h - 30 * U) * (e.look.size ?? 1), gap: 0.14 });
        const bh = block.cap + (lines.length - 1) * block.step;
        e.mark('product', blockBox(drawBlock(ctx, block, e.headline, x0, pBottom - bh, { color: pal[0].ink })));
        if (noteOn) e.mark('note', drawText(ctx, e.fields.note, TYPE.brandR, fitPx(ctx, e.fields.note, TYPE.brandR, nPx, x1 - x0), x0, headH - 30 * U, { color: pal[0].soft }));

        const bottom = H - safe.b;
        const hs = shares(list, bottom - headH, Math.min(110 * U, (bottom - headH) / Math.max(1, list.length) * 0.6));
        let y = headH;
        let box = null;
        list.forEach((l, i) => {
            const p = pal[i + 1];
            const last = i === list.length - 1;
            const bh2 = hs[i] + (last ? H - bottom : 0);
            ctx.fillStyle = p.fill;
            ctx.fillRect(0, y, W, bh2);
            // Label centred in the band's part inside the safe area.
            const px = Math.min((wide ? 38 : 42) * U, hs[i] * 0.34);
            const cap = capHeight(ctx, TYPE.brandSB, px);
            const base = y + hs[i] / 2 + cap / 2;
            const idx = String(i + 1).padStart(2, '0');
            const iPx = px * 0.46;
            drawText(ctx, idx, TYPE.mono, iPx, x0, base, { tracking: 0.12, color: p.soft });
            const nx = x0 + textWidth(ctx, '00', TYPE.mono, iPx, 0.12) + 26 * U;
            const qW = textWidth(ctx, l.q, TYPE.brandL, px);
            drawText(ctx, l.name, TYPE.brandSB, fitPx(ctx, l.name, TYPE.brandSB, px, x1 - nx - qW - 40 * U), nx, base, { color: p.ink });
            drawText(ctx, l.q, TYPE.brandL, px, x1, base, { align: 'right', color: p.ink === DARK ? DARK : lift(e.accent) });
            ctx.fillStyle = alpha(lift(e.accent), i ? 0.55 : 1);
            ctx.fillRect(0, y, W, Math.max(1, (i ? 1.5 : 3) * U));
            const b = { x: x0, y, w: x1 - x0, h: hs[i] };
            box = box ? { ...box, h: b.y + b.h - box.y } : b;
            y += hs[i];
        });
        e.mark('layers', box);
    },
};
