/**
 * RECIPE — a cookbook page: the dish photographed across the top, then the
 * title in a serif, prep · cook · serves as three small stats, the
 * ingredients (quantities in the accent) and a short numbered method.
 * Banners carry the title, stats and ingredients only. For cafés, food
 * brands and gyms sharing what's on the plate.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, HAIR, lift, fitPx } from './_parts';

const QTY = /^((?:\d+[\d½¼¾.,/]*|[½¼¾])\s*(?:kg|g|ml|l|tbsp|tsp|cups?|x|×)?\.?)\s+(.*)$/i;

// "150g salmon fillet" → ['150g', 'salmon fillet'].
const qty = (line) => { const m = String(line).trim().match(QTY); return m ? [m[1], m[2]] : ['', String(line).trim()]; };

// Prep · cook · serves: each a small grey label over a value.
function stats(e, x, y, w, U) {
    const { ctx } = e;
    const items = [['prep', 'Prep'], ['cook', 'Cook'], ['serves', 'Serves']].filter(([k]) => String(e.fields[k] ?? '').trim());
    if (!items.length) return 0;
    const lPx = 15 * U;
    let vPx = 30 * U;
    const cw = Math.min(w / items.length, 190 * U);
    items.forEach(([k]) => { vPx = Math.min(vPx, fitPx(ctx, e.fields[k], TYPE.brandM, vPx, cw - 20 * U)); });
    items.forEach(([k, lab], i) => {
        const cx = x + i * cw;
        if (i) rule(ctx, cx - 14 * U, y, cx - 14 * U, y + lPx * 1.6 + vPx, HAIR, Math.max(1, 1.2 * U));
        drawText(ctx, e.caps(lab), TYPE.mono, lPx, cx, y + lPx * 0.75, { tracking: 0.16, color: GREY });
        e.mark(k, drawText(ctx, e.fields[k], TYPE.brandM, vPx, cx, y + lPx * 1.6 + vPx * 0.75, { color: INK }));
    });
    return lPx * 1.6 + vPx;
}

// Ingredients: a ruled list, quantity in the accent. Returns its height at px
// (drawn only when `draw`).
const listOf = (e) => splitLines(e.fields.ingredients).filter((l) => l.trim()).slice(0, 10);

function ingredients(e, x, y, w, px, { draw, list = listOf(e), mark = true }) {
    const { ctx } = e;
    const acc = lift(e.accent);
    const step = px * 1.95;
    if (draw) {
        const qW = Math.max(0, ...list.map((l) => textWidth(ctx, qty(l)[0], TYPE.brandSB, px))) + px * 0.8;
        list.forEach((l, i) => {
            const [q, what] = qty(l);
            const base = y + i * step + px * 1.25;
            if (q) drawText(ctx, q, TYPE.brandSB, px, x, base, { color: acc });
            const tx = x + (qW < w * 0.4 ? qW : 0);
            drawText(ctx, what, TYPE.brandL, fitPx(ctx, what, TYPE.brandL, px, x + w - tx), tx, base, { color: INK });
            rule(ctx, x, y + (i + 1) * step, x + w, y + (i + 1) * step, HAIR, Math.max(1, 1.1 * e.u));
        });
        if (mark) e.mark('ingredients', { x, y, w, h: list.length * step });
    }
    return list.length * step;
}

// Method: numbered steps, each wrapped. Returns its height at px.
function method(e, x, y, w, px, { draw, max = 5 }) {
    const { ctx } = e;
    const acc = lift(e.accent);
    const steps = splitLines(e.fields.method).filter((l) => l.trim()).slice(0, max);
    const nW = textWidth(ctx, '00', TYPE.mono, px * 0.8, 0.08) + px * 0.9;
    let h = 0;
    steps.forEach((s, i) => {
        const lines = wrapLines(ctx, s.replace(/^\d+[.)]\s*/, ''), TYPE.brandL, px, w - nW, 4);
        if (draw) {
            drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, px * 0.8, x, y + h + px * 0.95, { tracking: 0.08, color: acc });
            drawText(ctx, lines.join('\n'), TYPE.brandL, px, x + nW, y + h + px * 0.95, { color: SOFT, leading: 1.36 });
        }
        h += px * 0.95 + (lines.length - 1) * px * 1.36 + px * 1.05;
    });
    if (draw && steps.length) e.mark('method', { x, y, w, h });
    return h;
}

// The title in the headline face, plus a kicker above it.
function title(e, x, y, w, maxH, U) {
    const { ctx } = e;
    const kPx = 17 * U;
    const k = e.caps(e.fields.kicker).trim();
    let top = y;
    if (k) {
        e.mark('kicker', drawText(ctx, k, TYPE.mono, fitPx(ctx, k, TYPE.mono, kPx, w, 0.18), x, y + kPx * 0.75, { tracking: 0.18, color: lift(e.accent) }));
        top += kPx * 0.75 + 22 * U;
    }
    const lines = splitLines(e.fields.title).slice(0, 3);
    const block = fitBlock(ctx, lines, e.headline, { maxW: w * (e.look.size ?? 1), maxH: maxH * (e.look.size ?? 1), gap: 0.2, max: (e.shape === 'wide' ? 140 : 96) * U });
    const boxes = drawBlock(ctx, block, e.headline, x, top, { color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) });
    e.mark('title', blockBox(boxes));
    return boxes[boxes.length - 1].baseline + block.px * 0.2;
}

// Banners: photo left, the words right (title, stats, ingredients in columns).
function banner(e) {
    const { ctx, W, H, tu, safe, shape } = e;
    const strip = shape === 'strip';
    ctx.fillStyle = '#0D0D0C';
    ctx.fillRect(0, 0, W, H);
    const split = W * (strip ? 0.26 : 0.42);
    e.photo({ x: 0, y: 0, w: split, h: H });
    e.fade(0, 0, split, H * 0.3, 'top', 0.45);
    lockup(e, safe.l, safe.t, (strip ? 26 : 38) * tu, { maxW: split - safe.l - 30 * tu });
    const x = split + (strip ? 44 : 64) * tu;
    const x1 = W - safe.r;
    if (strip) {
        const colW = (x1 - x) * 0.42;
        const bottom = title(e, x, safe.t, colW, H * 0.34, tu);
        stats(e, x, bottom + 30 * tu, colW, tu * 0.95);
        const ix = x + colW + 50 * tu;
        const iw = x1 - ix;
        const list = listOf(e).slice(0, 8);
        const per = Math.ceil(list.length / 2);
        const px = Math.min(22 * tu, (H - safe.t - safe.b) / (per * 1.95));
        const half = (iw - 36 * tu) / 2;
        ingredients(e, ix, safe.t, half, px, { draw: true, list: list.slice(0, per), mark: false });
        ingredients(e, ix + half + 36 * tu, safe.t, half, px, { draw: true, list: list.slice(per), mark: false });
        e.mark('ingredients', { x: ix, y: safe.t, w: iw, h: per * px * 1.95 });
        return;
    }
    const bottom = title(e, x, safe.t + 6 * tu, x1 - x, H * 0.3, tu);
    const sy = bottom + 36 * tu;
    const sh = stats(e, x, sy, x1 - x, tu * 1.2);
    const iy = sy + sh + 44 * tu;
    const list = listOf(e);
    const per = Math.ceil(list.length / 2);
    const px = Math.min(36 * tu, (H - safe.b - iy) / (per * 1.95));
    const half = (x1 - x - 44 * tu) / 2;
    ingredients(e, x, iy, half, px, { draw: true, list: list.slice(0, per), mark: false });
    ingredients(e, x + half + 44 * tu, iy, half, px, { draw: true, list: list.slice(per), mark: false });
    e.mark('ingredients', { x, y: iy, w: x1 - x, h: per * px * 1.95 });
}

export default {
    id: 'recipe',
    name: 'Recipe',
    category: 'Eat',
    blurb: 'A cookbook page: the dish, prep · cook · serves, ingredients and a short method. For cafés, food brands and gyms.',
    refs: 'a modern cookbook spread',
    headlineFont: 'serif',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Recipe · Post-session' },
        { key: 'title', label: 'Title', rows: 2, value: 'Salmon, rice\n& greens bowl' },
        { key: 'prep', label: 'Prep', value: '10 min' },
        { key: 'cook', label: 'Cook', value: '15 min' },
        { key: 'serves', label: 'Serves', value: '2' },
        { key: 'ingredients', label: 'Ingredients', rows: 7, value: '2 salmon fillets\n150g jasmine rice\n1 avocado\n100g edamame\n2 tbsp soy sauce\n1 tbsp sesame seeds\n1 lime', hint: 'One per line. A leading quantity (150g, 2 tbsp) sets in the accent.' },
        { key: 'method', label: 'Method', rows: 5, value: 'Cook the rice and leave it to steam, lid on.\nRoast the salmon at 200°C for 12 minutes.\nBlanch the edamame for 2 minutes and drain.\nBuild the bowls, then finish with soy, sesame and lime.', hint: 'One step per line, three to five steps. Numbered for you.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Dinner bowl', fields: {} },
        {
            name: 'Overnight oats', fields: {
                kicker: 'Recipe · Make ahead', title: 'Peanut butter\novernight oats', prep: '5 min', cook: 'None', serves: '1',
                ingredients: '60g rolled oats\n150ml milk\n100g Greek yoghurt\n1 tbsp peanut butter\n1 banana\n1 tsp honey',
                method: 'Stir the oats, milk and yoghurt together in a jar.\nSwirl through the peanut butter and honey.\nCover and chill overnight.\nTop with sliced banana to serve.',
            },
        },
        {
            name: 'Protein shake', fields: {
                kicker: 'Northside · Shake recipe', title: 'Cold brew\nprotein shake', prep: '3 min', cook: 'None', serves: '1',
                ingredients: '1 scoop Northside Whey\n200ml cold brew coffee\n150ml oat milk\n1 frozen banana\n4 ice cubes',
                method: 'Add everything to the blender, liquid first.\nBlend for 45 seconds until smooth.\nPour over ice and drink straight away.',
            },
            style: { accent: '#D9A066' },
        },
        {
            name: 'Gym kitchen', fields: {
                kicker: 'From the gym kitchen', title: 'Chicken & chickpea\ntraybake', prep: '15 min', cook: '35 min', serves: '4',
                ingredients: '8 chicken thighs\n400g chickpeas, drained\n2 red peppers\n1 red onion\n2 tsp smoked paprika\n2 tbsp olive oil\n1 lemon',
                method: 'Heat the oven to 200°C.\nToss everything with the oil and paprika in a large tray.\nRoast for 35 minutes, turning halfway.\nSqueeze over the lemon and serve.',
            },
        },
    ],
    look: { ...LOOK, target: 0.32, vignette: 0.4 },
    fill: { reward: (r) => ({ ...rewardWords(r), kicker: `Recipe · ${r.brand}` }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        ctx.fillStyle = '#0D0D0C';
        ctx.fillRect(0, 0, W, H);
        let photoH = H * (tall ? 0.42 : sq ? 0.34 : 0.4);
        if (tall) {
            // A long recipe takes room from the photo, down to a quarter.
            const x0 = safe.l + 6 * u;
            const wAll = W - safe.r - 6 * u - x0;
            const per = Math.ceil(listOf(e).length / 2);
            const est = 56 * u + H * 0.09 + 34 * u + 70 * u + 56 * u + 33 * u + per * 22 * u * 1.95 + 50 * u + 33 * u + method(e, x0, 0, wAll, 22 * u, { draw: false });
            photoH = Math.max(H * 0.26, Math.min(photoH, H - safe.b - est));
        }
        e.photo({ x: 0, y: 0, w: W, h: photoH });
        e.fade(0, 0, W, photoH * 0.4, 'top', 0.5);
        e.fade(0, photoH * 0.6, W, photoH * 0.4, 'bottom', 0.35);
        const x = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        lockup(e, x, safe.t + 6 * u, 42 * u, { maxW: x1 - x });

        // Title left, stats right of it on a post; stacked on a story.
        const top = photoH + (sq ? 40 : 56) * u;
        const statsW = sq ? 430 * u : 470 * u;
        const beside = !tall;
        const tW = beside ? x1 - x - statsW - 40 * u : x1 - x;
        const tBottom = title(e, x, top, tW, H * (tall ? 0.11 : sq ? 0.1 : 0.12), u);
        let colTop;
        if (beside) {
            const sh = stats(e, x1 - statsW + 30 * u, top + 30 * u, statsW - 30 * u, u);
            colTop = Math.max(tBottom, top + 30 * u + sh) + (sq ? 34 : 46) * u;
        } else {
            const sh = stats(e, x, tBottom + 34 * u, x1 - x, u);
            colTop = tBottom + 34 * u + sh + 56 * u;
        }
        rule(ctx, x, colTop - 22 * u, x1, colTop - 22 * u, 'rgba(244,241,234,0.4)', Math.max(1, 1.5 * u));

        const bottom = H - safe.b;
        const gap = 50 * u;
        const lPx0 = 15 * u;
        if (tall) {
            // A story is narrow and tall: ingredients in two columns, the
            // method full width under them.
            const list = listOf(e);
            const per = Math.ceil(list.length / 2);
            const half = (x1 - x - gap) / 2;
            const head = lPx0 * 2.2;
            const need = (p) => head + per * p * 1.95 + 50 * u + head + method(e, x, 0, x1 - x, p, { draw: false });
            let px = 31 * u;
            while (px > 13 * u && need(px) > bottom - colTop) px *= 0.95;
            drawText(ctx, e.caps('Ingredients'), TYPE.mono, lPx0, x, colTop + lPx0 * 0.75, { tracking: 0.18, color: GREY });
            ingredients(e, x, colTop + head - px * 0.6, half, px, { draw: true, list: list.slice(0, per), mark: false });
            ingredients(e, x + half + gap, colTop + head - px * 0.6, half, px, { draw: true, list: list.slice(per), mark: false });
            e.mark('ingredients', { x, y: colTop + head, w: x1 - x, h: per * px * 1.95 });
            const my = colTop + head + per * px * 1.95 + 50 * u;
            drawText(ctx, e.caps('Method'), TYPE.mono, lPx0, x, my + lPx0 * 0.75, { tracking: 0.18, color: GREY });
            method(e, x, my + head - px * 0.2, x1 - x, px, { draw: true });
            return;
        }
        // Ingredients left, method right — shrunk together until both fit.
        const iw = (x1 - x - gap) * 0.4;
        const mw = x1 - x - gap - iw;
        const mx = x + iw + gap;
        let px = (sq ? 23 : 27) * u;
        const lPx = 15 * u;
        const head = lPx * 2.2;
        while (px > 13 * u && Math.max(ingredients(e, x, 0, iw, px, { draw: false }), method(e, mx, 0, mw, px, { draw: false })) > bottom - colTop - head) px *= 0.94;
        drawText(ctx, e.caps('Ingredients'), TYPE.mono, lPx, x, colTop + lPx * 0.75, { tracking: 0.18, color: GREY });
        drawText(ctx, e.caps('Method'), TYPE.mono, lPx, mx, colTop + lPx * 0.75, { tracking: 0.18, color: GREY });
        ingredients(e, x, colTop + head - px * 0.6, iw, px, { draw: true });
        method(e, mx, colTop + head - px * 0.2, mw, px, { draw: true });
    },
};
