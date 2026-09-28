/**
 * LABEL — a UK-style nutrition panel set crisply in ink on a dark card beside
 * the product photo: "Typical values · per 100g · per serving", ruled rows,
 * "of which" rows indented, energy in kJ over kcal. The product name above.
 * Spec-sheet precision; every number is the brand's own, from their pack.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, textWidth, capHeight, wrapLines } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, rows as parseRows, lift, fitPx } from './_parts';

const sub = (label) => /^of which\b/i.test(label);
// "1680 kJ / 402 kcal" sets as two lines, as on a pack.
const lines = (v) => String(v ?? '').split(/\s*\/\s*/).filter(Boolean);

/**
 * The panel, fitted to box (x, y, w, h). anchor 'bottom' | 'top' keeps that
 * edge when the panel comes out shorter than the box. Returns its box.
 */
function panel(e, box, U, { anchor = 'bottom' } = {}) {
    const { ctx } = e;
    const f = e.fields;
    const data = parseRows(f.rows, 12).filter((r) => r[0]);
    const head = String(f.columns ?? '').split(/\s*[|·]\s*/).map((s) => s.trim());
    const pad = 30 * U;
    const wIn = box.w - pad * 2;
    // Height in units of px: title, header, the rows (energy on two lines).
    const units = 2.4 + 2.2 + data.reduce((a, r) => a + (Math.max(lines(r[1]).length, lines(r[2]).length) > 1 ? 2.9 : 1.75), 0);
    let px = Math.min(27 * U, (box.h - pad * 2) / units);
    // Columns: label, then the two value columns, right-aligned.
    const colW = (p) => {
        const c1 = Math.max(textWidth(ctx, head[0] ?? '', TYPE.brandSB, p * 0.82), ...data.map((r) => textWidth(ctx, r[0], TYPE.brandR, p) + (sub(r[0]) ? p * 0.9 : 0)));
        const v = (i) => Math.max(textWidth(ctx, head[i] ?? '', TYPE.brandSB, p * 0.82), ...data.map((r) => Math.max(0, ...lines(r[i]).map((l) => textWidth(ctx, l, TYPE.brandR, p)))));
        return [c1, v(1), v(2)];
    };
    let cw = colW(px);
    const gap = 26 * U;
    const need = cw[0] + cw[1] + cw[2] + gap * 2;
    if (need > wIn) { px *= wIn / need; cw = colW(px); }

    const ph = Math.min(box.h, units * px + pad * 2);
    const py = anchor === 'top' ? box.y : box.y + box.h - ph;
    ctx.fillStyle = 'rgba(14,14,13,0.94)';
    ctx.fillRect(box.x, py, box.w, ph);
    ctx.save();
    ctx.strokeStyle = 'rgba(244,241,234,0.5)';
    ctx.lineWidth = Math.max(1, 1.5 * U);
    ctx.strokeRect(box.x + 0.75 * U, py + 0.75 * U, box.w - 1.5 * U, ph - 1.5 * U);
    ctx.restore();

    const x0 = box.x + pad;
    const x1 = box.x + box.w - pad;
    const c2 = x1 - cw[2] - gap;          // right edge of the per-100g column
    let y = py + pad;
    const heavy = Math.max(2, 4 * U);
    const thin = Math.max(1, 1.2 * U);

    // Title
    const tPx = px * 1.45;
    e.mark('title', drawText(ctx, f.title, TYPE.brandB, fitPx(ctx, f.title, TYPE.brandB, tPx, x1 - x0), x0, y + capHeight(ctx, TYPE.brandB, tPx), { color: INK }));
    y += px * 2.4;
    rule(ctx, x0, y - heavy / 2, x1, y - heavy / 2, INK, heavy);

    // Column header
    const hPx = px * 0.82;
    const hBase = y + px * 1.1 + capHeight(ctx, TYPE.brandSB, hPx) / 2;
    const hb = [
        drawText(ctx, head[0] ?? '', TYPE.brandSB, hPx, x0, hBase, { color: INK }),
        drawText(ctx, head[1] ?? '', TYPE.brandSB, hPx, c2, hBase, { align: 'right', color: INK }),
        drawText(ctx, head[2] ?? '', TYPE.brandSB, hPx, x1, hBase, { align: 'right', color: INK }),
    ].filter(Boolean);
    e.mark('columns', hb.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.h, b.h) })));
    y += px * 2.2;
    rule(ctx, x0, y - thin * 1.5, x1, y - thin * 1.5, INK, thin * 3);

    // Rows
    const top = y;
    const cap = capHeight(ctx, TYPE.brandR, px);
    data.forEach((r, i) => {
        const n = Math.max(lines(r[1]).length, lines(r[2]).length, 1);
        const rh = n > 1 ? px * 2.9 : px * 1.75;
        const base = y + (px * 1.75 + cap) / 2 - px * 0.05;
        const s = sub(r[0]);
        drawText(ctx, r[0], s ? TYPE.brandL : TYPE.brandR, px, x0 + (s ? px * 0.9 : 0), base, { color: s ? SOFT : INK });
        lines(r[1]).forEach((l, k) => drawText(ctx, l, TYPE.brandR, px, c2, base + k * px * 1.15, { align: 'right', color: INK }));
        lines(r[2]).forEach((l, k) => drawText(ctx, l, TYPE.brandSB, px, x1, base + k * px * 1.15, { align: 'right', color: INK }));
        y += rh;
        if (i < data.length - 1) rule(ctx, x0 + (sub(data[i + 1][0]) ? px * 0.9 : 0), y, x1, y, 'rgba(244,241,234,0.28)', thin);
    });
    rule(ctx, x0, y + heavy / 2, x1, y + heavy / 2, INK, heavy);
    e.mark('rows', { x: x0, y: top, w: x1 - x0, h: y - top });
    return { x: box.x, y: py, w: box.w, h: ph };
}

// Product name (and ingredients) in a column; bottom-aligned at `bottom`.
function name(e, x, w, top, bottom, U, { maxH, ingredients = true } = {}) {
    const { ctx } = e;
    const f = e.fields;
    let y = bottom;
    const iPx = 21 * U;
    if (ingredients && String(f.ingredients ?? '').trim()) {
        const il = wrapLines(ctx, f.ingredients, TYPE.brandL, iPx, w, 4);
        const first = y - (il.length - 1) * iPx * 1.35;
        e.mark('ingredients', drawText(ctx, il.join('\n'), TYPE.brandL, iPx, x, first, { color: SOFT, leading: 1.35 }));
        y = first - iPx - 30 * U;
    }
    const kPx = 20 * U;
    const pl = splitLines(f.product).slice(0, 3);
    const block = fitBlock(ctx, pl, e.headline, { maxW: w * (e.look.size ?? 1), maxH: Math.min(maxH, y - top - kPx * 2.4) * (e.look.size ?? 1), gap: 0.18 });
    const bh = block.cap + (pl.length - 1) * block.step;
    const pTop = y - bh - block.px * 0.18;
    e.shade({ x, y: pTop, w, h: bh }, { ceiling: 0.26, max: 0.6 });
    e.mark('product', blockBox(drawBlock(ctx, block, e.headline, x, pTop, { color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) })));
    const kicker = e.caps(f.kicker).trim();
    if (kicker) e.mark('kicker', drawText(ctx, kicker, TYPE.mono, fitPx(ctx, kicker, TYPE.mono, kPx, w, 0.18), x, pTop - kPx * 1.3, { tracking: 0.18, color: lift(e.accent) }));
}

// Banner strip: the name left, the per-serving values as one ruled row.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    ctx.fillStyle = '#0D0D0C';
    ctx.fillRect(0, 0, W, H);
    const split = W * 0.3;
    e.photo({ x: 0, y: 0, w: split, h: H });
    e.fade(split * 0.55, 0, split * 0.45, H, 'right', 0.8);
    const x = safe.l;
    lockup(e, x, safe.t, 26 * tu, { maxW: split - x - 20 * tu });
    const f = e.fields;
    const data = parseRows(f.rows, 12).filter((r) => r[0] && !sub(r[0]));
    const head = String(f.columns ?? '').split(/\s*[|·]\s*/).map((s) => s.trim());
    const bx = split + 30 * tu;
    const bw = W - safe.r - bx;
    const pl = splitLines(f.product).slice(0, 2);
    const block = fitBlock(ctx, pl, e.headline, { maxW: bw * 0.62, maxH: H * 0.24, gap: 0.16 });
    const pTop = safe.t + 4 * tu;
    const pb = drawBlock(ctx, block, e.headline, bx, pTop, { color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) });
    e.mark('product', blockBox(pb));
    const hPx = 17 * tu;
    e.mark('columns', drawText(ctx, e.caps(head[2] ?? ''), TYPE.mono, hPx, W - safe.r, pTop + capHeight(ctx, TYPE.mono, hPx), { align: 'right', tracking: 0.14, color: lift(e.accent) }));
    const cells = data.slice(0, 7);
    const top = H * 0.52;
    const bottom = H - safe.b;
    const cw = bw / Math.max(1, cells.length);
    rule(ctx, bx, top, bx + bw, top, INK, Math.max(2, 3 * tu));
    const lPx = 15 * tu;
    let vPx = 34 * tu;
    cells.forEach((r) => { vPx = Math.min(vPx, fitPx(ctx, lines(r[2])[lines(r[2]).length - 1] ?? '', TYPE.brandSB, vPx, cw - 22 * tu)); });
    cells.forEach((r, i) => {
        const cx = bx + i * cw;
        if (i) rule(ctx, cx, top + 14 * tu, cx, bottom, 'rgba(244,241,234,0.25)', Math.max(1, 1.2 * tu));
        const lx = cx + (i ? 16 * tu : 0);
        drawText(ctx, e.caps(r[0]), TYPE.mono, fitPx(ctx, e.caps(r[0]), TYPE.mono, lPx, cw - 22 * tu, 0.1), lx, top + 22 * tu + lPx, { tracking: 0.1, color: GREY });
        const v = lines(r[2]);
        drawText(ctx, v[v.length - 1] ?? '', TYPE.brandSB, vPx, lx, bottom, { color: INK });
    });
    e.mark('rows', { x: bx, y: top, w: bw, h: bottom - top });
}

export default {
    id: 'nutrition-label',
    name: 'Label',
    category: 'Eat',
    blurb: 'A UK-style nutrition panel, ruled and precise, on a dark card beside the product. For food, drink and supplement brands.',
    refs: 'a UK back-of-pack nutrition table',
    headlineFont: 'brandSB',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'On the label' },
        { key: 'product', label: 'Product', rows: 2, value: 'Northside Whey\nSalted Caramel' },
        { key: 'title', label: 'Panel title', value: 'Nutrition' },
        { key: 'columns', label: 'Column heads', value: 'Typical values | per 100g | per 30g', hint: 'Three parts, split with |.' },
        {
            key: 'rows', label: 'Rows', rows: 9,
            value: 'Energy | 1614 kJ / 382 kcal | 484 kJ / 115 kcal\nFat | 5.9g | 1.8g\nof which saturates | 3.7g | 1.1g\nCarbohydrate | 7.4g | 2.2g\nof which sugars | 5.2g | 1.6g\nFibre | 0.9g | 0.3g\nProtein | 74g | 22g\nSalt | 0.42g | 0.13g',
            hint: 'One per line: name | per 100g | per serving. Start a line with “of which” to indent it. Use / for kJ / kcal.',
        },
        { key: 'ingredients', label: 'Ingredients', rows: 3, value: 'Ingredients: whey protein concentrate (milk), cocoa butter, flavouring, salt, sweetener (sucralose).', hint: 'Leave empty to hide it. Allergens as on your pack.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein powder', fields: {} },
        {
            name: 'Snack bar', fields: {
                kicker: 'New bar', product: 'Northside Bar\nPeanut Crunch', columns: 'Typical values | per 100g | per 55g bar',
                rows: 'Energy | 1650 kJ / 394 kcal | 908 kJ / 217 kcal\nFat | 14g | 7.7g\nof which saturates | 4.6g | 2.5g\nCarbohydrate | 33g | 18g\nof which sugars | 4.2g | 2.3g\nFibre | 12g | 6.6g\nProtein | 36g | 20g\nSalt | 0.5g | 0.28g',
                ingredients: 'Ingredients: milk protein, peanuts (18%), soluble fibre, cocoa butter, salt.',
            },
        },
        {
            name: 'Café dish', fields: {
                kicker: 'Gym kitchen · on the menu', product: 'Chicken, rice\n& greens bowl', columns: 'Typical values | per 100g | per bowl (410g)',
                rows: 'Energy | 540 kJ / 128 kcal | 2214 kJ / 525 kcal\nFat | 3.4g | 14g\nof which saturates | 0.7g | 2.9g\nCarbohydrate | 14g | 57g\nof which sugars | 1.2g | 4.9g\nFibre | 1.9g | 7.8g\nProtein | 10g | 41g\nSalt | 0.3g | 1.2g',
                ingredients: 'Chicken thigh, jasmine rice, tenderstem, edamame (soya), sesame, soy sauce (wheat).',
            },
        },
        {
            name: 'Drink', fields: {
                kicker: 'Ready to drink', product: 'Northside Shake\nCold Brew', columns: 'Typical values | per 100ml | per 330ml',
                rows: 'Energy | 200 kJ / 48 kcal | 660 kJ / 158 kcal\nFat | 0.6g | 2g\nof which saturates | 0.4g | 1.3g\nCarbohydrate | 1.8g | 5.9g\nof which sugars | 1.6g | 5.3g\nProtein | 8.5g | 28g\nSalt | 0.12g | 0.4g',
                ingredients: 'Ingredients: skimmed milk, milk protein, cold brew coffee (2%), stabiliser (gellan gum).',
            },
            style: { accent: '#D9A066' },
        },
    ],
    look: { ...LOOK, target: 0.27 },
    fill: { reward: (r) => ({ ...rewardWords(r), kicker: r.cost ? `Unlock with ${rewardWords(r).points}` : 'On the label' }) },

    draw(e) {
        const { ctx, W, H, u, tu, safe, shape } = e;
        if (shape === 'strip') return strip(e);
        if (shape === 'wide' || shape === 'square') {
            const wide = shape === 'wide';
            const U = wide ? tu : u;
            e.photo({ x: 0, y: 0, w: W, h: H });
            e.fade(0, 0, W * 0.6, H, 'left', 0.7);
            e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.6);
            const pw = W * (wide ? 0.4 : 0.5);
            const px = W - safe.r - pw;
            panel(e, { x: px, y: safe.t, w: pw, h: H - safe.t - safe.b }, U, { anchor: 'top' });
            const x = safe.l + 4 * U;
            const w = px - x - 40 * U;
            lockup(e, x, safe.t, 40 * U, { maxW: w });
            name(e, x, w, safe.t + 120 * U, H - safe.b, U, { maxH: H * 0.28 });
            return;
        }
        const tall = shape === 'tall';
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.45, 'top', 0.75);
        e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.5);
        const x = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        const lk = lockup(e, x, safe.t + 6 * u, 44 * u, { maxW: x1 - x });
        // The card low; name and ingredients above it on the left.
        const cardW = tall ? x1 - x : (x1 - x) * 0.66;
        const cardTop = H * (tall ? 0.46 : 0.4);
        const room = tall && String(e.fields.ingredients ?? '').trim() ? 100 * u : 0;
        const card = panel(e, { x: x1 - cardW, y: cardTop, w: cardW, h: H - safe.b - cardTop - room }, u);
        name(e, x, (x1 - x) * (tall ? 1 : 0.9), lk.y + lk.h + 60 * u, card.y - 44 * u, u, { maxH: H * (tall ? 0.12 : 0.13), ingredients: false });
        // Ingredients sit left of the card on a post, under it on a story.
        const f = e.fields;
        if (String(f.ingredients ?? '').trim()) {
            const iPx = 19 * u;
            if (tall) {
                const il = wrapLines(ctx, f.ingredients, TYPE.brandL, iPx, x1 - x, 2);
                e.mark('ingredients', drawText(ctx, il.join('\n'), TYPE.brandL, iPx, x, card.y + card.h + 44 * u, { color: GREY, leading: 1.35 }));
            } else {
                const iw = card.x - x - 30 * u;
                const il = wrapLines(ctx, f.ingredients, TYPE.brandL, iPx, iw, 9);
                e.shade({ x, y: H - safe.b - il.length * iPx * 1.4, w: iw, h: il.length * iPx * 1.4 }, { ceiling: 0.24, max: 0.6 });
                e.mark('ingredients', drawText(ctx, il.join('\n'), TYPE.brandL, iPx, x, H - safe.b - 6 * u - (il.length - 1) * iPx * 1.4, { color: SOFT, leading: 1.4 }));
            }
        }
    },
};
