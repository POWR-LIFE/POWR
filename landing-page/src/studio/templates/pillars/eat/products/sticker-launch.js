/**
 * STICKER LAUNCH — the launch post: the whole ground in the brand's colour
 * (a studio sweep, darker at the edges), the flavour set big, the product
 * standing on a black band, and a round black "New" sticker slapped on at an
 * angle with the price. Loud, but it holds with any brand colour: the type
 * on the colour turns #111 or ink by the colour's luminance. A dropped
 * photo shows through a round window behind the product.
 */
import { TYPE } from '../../../../fonts';
import { ring } from '../../../../shapes';
import { drawText, capHeight, textWidth } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, slot, productRect, head, para, paraLines, line, lift, alpha, mix, onColour, INK, GREY, fitPx } from './_parts';

const BAND = '#111111';

// The colour sweep: the accent, a lighter spot behind the product, darker
// towards the corners.
function sweep(e, cx, cy, r) {
    const { ctx, W, H } = e;
    ctx.fillStyle = e.accent;
    ctx.fillRect(0, 0, W, H);
    const lit = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    lit.addColorStop(0, 'rgba(255,255,255,0.16)');
    lit.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lit;
    ctx.fillRect(0, 0, W, H);
    const R = Math.hypot(W, H) * 0.62;
    const v = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, R);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
}

// A dropped photo: seen through a round window behind the product (the
// colour is laid over everything else, so it works on video too).
function porthole(e, cx, cy, r) {
    const { ctx, W, H } = e;
    if (!e.hasMedia) return false;
    e.photo({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
    ctx.save();
    ctx.fillStyle = e.accent;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
    return true;
}

// The sticker: a black disc at an angle, the word big and the price under.
function sticker(e, cx, cy, r, U) {
    const { ctx } = e;
    const word = e.caps(e.fields.sticker).trim();
    const price = String(e.fields.price ?? '').trim();
    if (!word && !price) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.21);
    ctx.fillStyle = BAND;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ring(ctx, 0, 0, r * 0.88, alpha(lift(e.accent), 0.7), Math.max(1, 1.6 * U));
    const wPx = word ? fitPx(ctx, word, TYPE.brand, r * 0.56, r * 1.3, 0.02) : 0;
    const pPx = r * 0.22;
    const cw = wPx ? capHeight(ctx, TYPE.brand, wPx) : 0;
    const cp = price ? capHeight(ctx, TYPE.brandL, pPx) : 0;
    const gap = word && price ? r * 0.14 : 0;
    const top = -(cw + gap + cp) / 2;
    if (word) drawText(ctx, word, TYPE.brand, wPx, 0, top + cw, { align: 'center', tracking: 0.02, color: INK });
    if (price) drawText(ctx, price, TYPE.brandL, fitPx(ctx, price, TYPE.brandL, pPx, r * 1.3), 0, top + cw + gap + cp, { align: 'center', color: INK });
    ctx.restore();
    // The editor outlines the upright disc.
    const box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    if (word) e.mark('sticker', box);
    if (price) e.mark('price', box);
}

// The black band along the foot: lockup left, the call to action right.
function band(e, x0, x1, top, bottom, U, { full = true } = {}) {
    const { ctx, W, H } = e;
    ctx.fillStyle = BAND;
    ctx.fillRect(full ? 0 : x0, top, full ? W : x1 - x0, H - top);
    const h = 36 * U;
    const mid = (top + bottom) / 2;
    const cta = String(e.fields.cta ?? '').trim();
    const ctaW = cta ? Math.min(textWidth(ctx, e.caps(cta), TYPE.mono, 18 * U, 0.16), (x1 - x0) * 0.5) : 0;
    const lk = lockup(e, x0, mid - h / 2, h, { maxW: x1 - x0 - ctaW - 40 * U });
    if (cta) line(e, 'cta', e.caps(cta), TYPE.mono, 18 * U, x1, mid + capHeight(ctx, TYPE.mono, 18 * U) / 2, { align: 'right', tracking: 0.16, color: GREY, maxW: x1 - lk.x - lk.w - 40 * U });
}

export default {
    id: 'eat-sticker-launch',
    name: 'Sticker Launch',
    category: 'Eat',
    section: 'Products',
    blurb: 'A launch on a solid ground in the brand’s colour: the flavour big, the product on a black band and a round “New” sticker with the price.',
    refs: 'a supermarket launch sticker on a studio colour sweep',
    headlineFont: 'brand',
    photo: 'optional',
    fields: [
        { key: 'name', label: 'Product name', value: 'Northside Whey' },
        { key: 'flavour', label: 'Flavour', rows: 3, value: 'Salted\nCaramel', hint: 'One to three lines, set big.' },
        { key: 'detail', label: 'Line', rows: 2, value: '24g protein per scoop. 1kg tub, 33 servings.', hint: 'Leave empty to hide it.' },
        { key: 'sticker', label: 'Sticker', value: 'New' },
        { key: 'price', label: 'Price (on the sticker)', value: '£29.99', hint: 'Leave empty for the word alone.' },
        { key: 'cta', label: 'Call to action', value: 'Members first in the POWR app' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein launch', fields: {}, look: { kind: 'tub' } },
        { name: 'Drink', fields: { name: 'Northside Electrolytes', flavour: 'Blood\nOrange', detail: 'One stick to 500 ml water. Box of 20.', sticker: 'Back', price: '£18', cta: 'Unlock it in the POWR app' }, look: { kind: 'box' }, style: { accent: '#E2583E' } },
        { name: 'Bar', fields: { name: 'Northside Bar', flavour: 'Peanut\nCrunch', detail: '20g protein, 212 kcal per 55g bar.', sticker: 'New', price: '£2.50', cta: 'Or 250 POWR points' }, look: { kind: 'pouch' }, style: { accent: '#7FE0C2' } },
        { name: 'Limited', fields: { name: 'Northside Granola', flavour: 'Winter\nSpice', detail: 'Oats, pecans, cinnamon and orange. 400g.', sticker: 'Limited', price: '£6.50', cta: 'Until it’s gone' }, look: { kind: 'pouch' }, style: { accent: '#1E3A8A' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['pouch', 'Pouch'], ['box', 'Box'], ['jar', 'Jar'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), name: r.brand, ...(r.value ? { sticker: `${r.value}${r.unit ? ` ${r.unit}` : ''}`, price: '' } : {}), ...(r.cost ? { cta: `Or ${rewardWords(r).points}` } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const U = unitOf(e);
        const f = e.fields;
        const T = onColour(e.accent);
        const soft = T === INK ? 'rgba(244,241,234,0.82)' : 'rgba(17,17,17,0.78)';
        const kind = e.look.kind ?? 'tub';
        const sub = String(f.flavour ?? '').replace(/\s*\n\s*/g, ' ');
        const headColour = e.headlineAccent ? mix(e.accent, T, 0.75) : T;

        if (shape === 'strip') {
            const panelX = W - safe.r - W * 0.2;
            const pw = H * 0.72;
            const pbox = { x: panelX - pw - 60 * U, y: safe.t, w: pw, h: H - safe.t - safe.b + 8 * U };
            const pr = productRect(e, pbox, { kind });
            sweep(e, pr.x + pr.w / 2, pr.y + pr.h * 0.5, H);
            porthole(e, pr.x + pr.w / 2, pr.y + pr.h * 0.5, H * 0.4);
            e.ctx.fillStyle = BAND;
            e.ctx.fillRect(panelX - 20 * U, 0, W - panelX + 20 * U, H);
            lockup(e, panelX + 20 * U, safe.t, 26 * U, { maxW: W - safe.r - panelX - 20 * U });
            para(e, 'cta', e.caps(f.cta), TYPE.mono, 15 * U, panelX + 20 * U, H - safe.b - 15 * U * 1.3, W - safe.r - panelX - 20 * U, 2, { color: GREY, leading: 1.3 });
            slot(e, pbox, { kind, sub, stage: 0.6 });
            const sr = 62 * U;
            const sx = pr.x + pr.w * 0.1;
            sticker(e, sx, pr.y + pr.h * 0.12, sr, U);
            const x = safe.l;
            const cw = Math.min(pbox.x, sx - sr) - x - 40 * U;
            line(e, 'name', e.caps(f.name), TYPE.mono, 16 * U, x, safe.t + 16 * U, { tracking: 0.18, color: soft, maxW: cw });
            head(e, 'flavour', f.flavour, x, safe.t + 44 * U, { maxW: cw, maxH: H - safe.t - safe.b - 44 * U - 50 * U, lines: 3, color: headColour, gap: 0.1 });
            para(e, 'detail', f.detail, TYPE.brandR, 17 * U, x, H - safe.b, cw, 1, { color: soft });
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const wide = shape === 'wide';
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        const bandH = (wide ? 96 : 104) * U;
        const bandTop = H - safe.b - bandH + 14 * U;
        // Where the product goes: right, standing on the band.
        const side = sq || wide;
        const pTop = side ? safe.t + 30 * U : H * (tall ? 0.36 : 0.34);
        const pbox = side
            ? { x: x + w * (wide ? 0.5 : 0.48), y: pTop, w: w * (wide ? 0.44 : 0.52), h: bandTop - pTop }
            : { x: x + w * 0.34, y: pTop, w: w * 0.66, h: bandTop - pTop };
        const pr = productRect(e, pbox, { kind, frame: 0.8 });
        sweep(e, pr.x + pr.w / 2, pr.y + pr.h * 0.5, Math.max(pr.w, pr.h) * 1.1);
        porthole(e, pr.x + pr.w / 2, pr.y + pr.h * 0.52, Math.max(pr.w, pr.h) * 0.58);
        band(e, x, x + w, bandTop, H - safe.b, U);
        slot(e, pbox, { kind, sub, stage: 0.6 });
        const sr = (tall ? 112 : sq ? 84 : wide ? 96 : 100) * U;
        const sx = pr.x + pr.w * 0.06;
        const sy = pr.y + pr.h * 0.1;
        sticker(e, sx, sy, sr, U);

        // The words: name, the flavour big (clear of the sticker), the line.
        const cw = side ? Math.min(pbox.x, sx - sr) - x - 40 * U : w;
        const nPx = 20 * U;
        line(e, 'name', e.caps(f.name), TYPE.mono, nPx, x, safe.t + nPx + (tall ? 10 : 4) * U, { tracking: 0.18, color: soft, maxW: cw });
        const fTop = safe.t + nPx + 36 * U;
        const dPx = (sq ? 24 : 28) * U;
        const dw = side ? cw : w * 0.3;
        const dl = paraLines(e, f.detail, TYPE.brandR, dPx, dw, side ? 3 : 4);
        const maxH = side ? bandTop - fTop - (dl ? dl * dPx * 1.3 + 50 * U : 30 * U) : Math.min(pTop, sy - sr) - fTop - 40 * U;
        head(e, 'flavour', f.flavour, x, fTop, { maxW: cw, maxH, lines: 3, color: headColour, gap: 0.1 });
        if (dl) para(e, 'detail', f.detail, TYPE.brandR, dPx, x, bandTop - 36 * U - (dl - 1) * dPx * 1.3, dw, side ? 3 : 4, { color: soft, leading: 1.3 });
    },
};
