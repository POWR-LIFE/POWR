/**
 * MACROS — protein as the hero number: "32g" huge with its word beside it,
 * carbs and fat as two smaller stats, and a thin three-part bar showing the
 * split by weight, then the per-serving line. For protein and sports-
 * nutrition brands. The numbers are the brand's to fill in.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, wrapLines, capHeight, textWidth, lineMetrics, parseLine } from '../../../text';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, alpha, lift, num, fitPx } from './_parts';

// The whole block, bottom-up inside x…x+w, between top and bottom.
function stack(e, { x, w, top, bottom, U, heroMax, productLines = 2 }) {
    const { ctx } = e;
    const acc = lift(e.accent);
    const f = e.fields;

    // Small print, then the serving line.
    let y = bottom;
    const notePx = 15 * U;
    if (String(f.note ?? '').trim()) {
        e.mark('note', drawText(ctx, e.caps(f.note), TYPE.mono, fitPx(ctx, e.caps(f.note), TYPE.mono, notePx, w, 0.14), x, y, { tracking: 0.14, color: GREY }));
        y -= notePx + 22 * U;
    }
    const servPx = 25 * U;
    if (String(f.serving ?? '').trim()) {
        const sp = fitPx(ctx, f.serving, TYPE.brandR, servPx, w);
        e.mark('serving', drawText(ctx, f.serving, TYPE.brandR, sp, x, y, { color: SOFT }));
        y -= servPx * 0.75 + 26 * U;
    }

    // The split bar: protein · carbs · fat by weight, gaps between.
    const vals = [num(f.protein), num(f.carbs), num(f.fat)];
    const total = vals.reduce((a, b) => a + b, 0);
    const colours = [acc, alpha(INK, 0.78), alpha(INK, 0.36)];
    const barH = Math.max(2, 7 * U);
    const barY = y - barH;
    if (total > 0) {
        const gap = 4 * U;
        const live = vals.filter((v) => v > 0).length;
        const room = w - gap * (live - 1);
        let bx = x;
        vals.forEach((v, i) => {
            if (v <= 0) return;
            const sw = Math.max(6 * U, (room * v) / total);
            ctx.fillStyle = colours[i];
            ctx.fillRect(bx, barY, Math.min(sw, x + w - bx), barH);
            bx += sw + gap;
        });
    }
    y = barY - 34 * U;

    // Carbs and fat: "4g carbs", a swatch in the bar's colour before each.
    const statPx = 52 * U;
    const labPx = statPx * 0.5;
    const stats = [['carbs', f.carbs, f.carbsLabel, colours[1]], ['fat', f.fat, f.fatLabel, colours[2]]]
        .filter(([, v]) => String(v ?? '').trim());
    if (stats.length) {
        let sx = x;
        const cap = capHeight(ctx, TYPE.brandSB, statPx);
        stats.forEach(([key, v, lab, col], i) => {
            if (i) {
                ctx.fillStyle = alpha(INK, 0.2);
                ctx.fillRect(sx, y - cap, Math.max(1, 1.5 * U), cap);
                sx += 30 * U;
            }
            const vb = drawText(ctx, String(v).trim(), TYPE.brandSB, statPx, sx, y, { color: INK });
            e.mark(key, vb);
            let lx = vb.x + vb.w + 14 * U;
            ctx.fillStyle = col;
            ctx.fillRect(lx, y - labPx * 0.62, labPx * 0.5, labPx * 0.5);
            lx += labPx * 0.5 + 9 * U;
            const lb = drawText(ctx, String(lab ?? ''), TYPE.brandL, labPx, lx, y, { color: SOFT });
            e.mark(`${key}Label`, lb);
            sx = (lb ? lb.x + lb.w : lx) + 30 * U;
        });
        y -= cap + 40 * U;
    }

    // Product name above the hero: measured first, so the hero gets the rest.
    const prodPx = 34 * U;
    const prod = wrapLines(ctx, f.product, TYPE.brandL, prodPx, w, productLines);
    const prodH = prod.length ? prodPx * 0.75 + (prod.length - 1) * prodPx * 1.2 + 34 * U : 0;

    // The hero: protein, with its word set light beside it at the baseline.
    const hero = String(f.protein ?? '').trim();
    const word = String(f.proteinLabel ?? '').trim();
    const maxH = Math.max(40 * U, Math.min(heroMax, (y - top - prodH) * 0.84));
    let block = fitBlock(ctx, [hero || ' '], e.headline, { maxW: w, maxH: maxH * (e.look.size ?? 1), tracking: -0.02 });
    const wordW = (px) => (word ? textWidth(ctx, word, TYPE.brandL, px * 0.34, 0) + px * 0.1 : 0);
    const heroW = () => lineMetrics(ctx, parseLine(hero || ' '), e.headline, block.px, -0.02).inkW;
    const need = heroW() + wordW(block.px);
    if (need > w) block = fitBlock(ctx, [hero || ' '], e.headline, { maxW: w, maxH, tracking: -0.02, max: (block.px * w) / need });
    // Leave room for a descender ("24g") above the stats row.
    const desc = lineMetrics(ctx, block.segs[0], e.headline, block.px, -0.02).descent;
    y -= Math.max(0, desc - 18 * U);
    const heroTop = y - block.cap;
    const pTop = heroTop - 34 * U - (prod.length - 1) * prodPx * 1.2;
    const wordEnd = heroW() + wordW(block.px);
    e.shade({ x, y: prod.length ? pTop - prodPx : heroTop, w: wordEnd, h: y - (prod.length ? pTop - prodPx : heroTop) }, { ceiling: 0.26, max: 0.6, spread: 1.1 });
    const [hb] = drawBlock(ctx, block, e.headline, x, heroTop, { tracking: -0.02, color: e.headlineAccent ? acc : INK, accent: acc });
    e.mark('protein', hb);
    if (word) {
        e.mark('proteinLabel', drawText(ctx, word, TYPE.brandL, block.px * 0.34, hb.x + hb.w + block.px * 0.1, y, { color: acc }));
    }

    if (prod.length) {
        e.mark('product', drawText(ctx, prod.join('\n'), TYPE.brandL, prodPx, x, pTop, { color: INK, leading: 1.2 }));
    }
    return heroTop;
}

export default {
    id: 'macros',
    name: 'Macros',
    category: 'Eat',
    blurb: 'Protein as the hero number, carbs and fat beside it and a thin bar with the split. For protein and sports-nutrition brands.',
    refs: 'a supplement tub’s front panel',
    headlineFont: 'brand',
    fields: [
        { key: 'product', label: 'Product', value: 'Northside Whey · Salted Caramel' },
        { key: 'protein', label: 'Protein', value: '24g', hint: 'Per serving, as on your label.' },
        { key: 'proteinLabel', label: 'Protein word', value: 'protein' },
        { key: 'carbs', label: 'Carbs', value: '3g' },
        { key: 'carbsLabel', label: 'Carbs word', value: 'carbs' },
        { key: 'fat', label: 'Fat', value: '2g' },
        { key: 'fatLabel', label: 'Fat word', value: 'fat' },
        { key: 'serving', label: 'Serving line', value: 'Per 30g scoop · 121 kcal' },
        { key: 'note', label: 'Small print', value: 'Redeem with POWR points', hint: 'Leave empty to hide it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein powder', fields: { product: 'Northside Whey · Salted Caramel', protein: '24g', carbs: '3g', fat: '2g', serving: 'Per 30g scoop · 121 kcal', note: 'Redeem with POWR points' } },
        { name: 'Protein bar', fields: { product: 'Northside Bar · Peanut Crunch', protein: '20g', carbs: '18g', fat: '8g', serving: 'Per 55g bar · 212 kcal', note: 'New in the rewards' } },
        { name: 'Café bowl', fields: { product: 'The Gym Kitchen Bowl · Chicken, rice, greens', protein: '42g', carbs: '58g', fat: '14g', serving: 'Per bowl · 526 kcal', note: 'At the gym kitchen · £9.50' } },
        { name: 'Plant-based', fields: { product: 'Northside Plant · Chocolate', protein: '21g', carbs: '5g', fat: '3g', serving: 'Per 33g scoop · 128 kcal', note: 'Pea and brown rice protein' }, style: { accent: '#8FD694' } },
    ],
    look: { ...LOOK, target: 0.3 },
    fill: {
        reward: (r) => ({ ...rewardWords(r), note: r.cost ? `Redeem for ${rewardWords(r).points}` : 'Redeem with POWR points' }),
    },

    draw(e) {
        const { ctx, W, H, u, tu, safe, shape } = e;
        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const split = W * (strip ? 0.5 : 0.48);
            ctx.fillStyle = '#0D0D0C';
            ctx.fillRect(0, 0, W, H);
            e.photo({ x: split, y: 0, w: W - split, h: H });
            e.fade(split, 0, (W - split) * 0.35, H, 'left', 0.85);
            const x = safe.l + 4 * tu;
            const w = split - x - 40 * tu;
            const logoH = (strip ? 30 : 40) * tu;
            const lk = lockup(e, x, safe.t, logoH, { maxW: w });
            stack(e, { x, w, top: lk.y + lk.h + (strip ? 26 : 50) * tu, bottom: H - safe.b, U: strip ? tu * 0.85 : tu, heroMax: H * (strip ? 0.5 : 0.3), productLines: strip ? 1 : 2 });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.22, 'top', 0.5);
        e.fade(0, H * (tall ? 0.36 : 0.3), W, H * (tall ? 0.64 : 0.7), 'bottom', 0.94);
        const x = safe.l + 8 * u;
        const w = W - safe.r - 8 * u - x;
        lockup(e, x, safe.t + 6 * u, 46 * u, { maxW: w });
        stack(e, { x, w, top: H * (tall ? 0.42 : sq ? 0.3 : 0.36), bottom: H - safe.b - 6 * u, U: sq ? u * 0.92 : u, heroMax: H * (tall ? 0.15 : sq ? 0.2 : 0.19) });
    },
};
