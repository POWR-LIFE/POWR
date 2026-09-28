/**
 * MENU — a café or gym-kitchen menu card: the dish in an arched window, the
 * venue in a serif, then dish ……… price with a line under each, and one dish
 * marked as the one members can redeem with POWR points. Works with no photo
 * too. For cafés, gym kitchens and food partners.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, capHeight, wrapLines } from '../../../text';
import { dot } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, rows, lift, fitPx, alpha } from './_parts';

const GROUND = '#0E0D0C';

// A marked dish ends with * (on its name or price).
const items = (e, max) => rows(e.fields.items, max).filter((r) => r[0]).map(([name = '', price = '', desc = '']) => {
    const marked = /\*\s*$/.test(name) || /\*\s*$/.test(price);
    return { name: name.replace(/\s*\*\s*$/, ''), price: price.replace(/\s*\*\s*$/, ''), desc, marked };
});

function archPath(ctx, x, y, w, h) {
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
}

// The photo inside an arch, the ground laid over the rest, a fine outline.
function arch(e, x, y, w, h, U) {
    const { ctx, W, H } = e;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    if (!e.hasMedia) return false;
    e.photo({ x, y, w, h });
    e.fade(x, y + h * 0.7, w, h * 0.3, 'bottom', 0.35);
    ctx.save();
    ctx.fillStyle = GROUND;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    const r = w / 2;
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + r);
    ctx.arc(x + r, y + r, r, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
    const o = 12 * U;
    ctx.save();
    ctx.strokeStyle = alpha(INK, 0.35);
    ctx.lineWidth = Math.max(1, 1.3 * U);
    archPath(ctx, x - o, y - o, w + o * 2, h + o);
    ctx.stroke();
    ctx.restore();
    return true;
}

// Venue (serif), the menu's name under it (tracked caps). Centred on cx or
// left at x. Returns the bottom.
function masthead(e, x, top, w, U, { align = 'center', venuePx = 64 } = {}) {
    const { ctx } = e;
    const vPx = fitPx(ctx, e.fields.venue, TYPE.serif, venuePx * U * (e.look.size ?? 1), w);
    const cap = capHeight(ctx, TYPE.serif, vPx);
    const ax = align === 'center' ? x + w / 2 : x;
    e.mark('venue', drawText(ctx, e.fields.venue, TYPE.serif, vPx, ax, top + cap, { align, color: INK }));
    const hPx = 16 * U;
    const head = e.caps(e.fields.heading).trim();
    let y = top + cap + vPx * 0.3;
    if (head) {
        const tw = textWidth(ctx, head, TYPE.mono, hPx, 0.3);
        const hy = y + 18 * U + hPx * 0.75;
        e.mark('heading', drawText(ctx, head, TYPE.mono, hPx, ax, hy, { align, tracking: 0.3, color: lift(e.accent) }));
        if (align === 'center') {
            ctx.fillStyle = alpha(INK, 0.3);
            const lw = Math.min(90 * U, (w - tw) / 2 - 24 * U);
            if (lw > 10 * U) {
                ctx.fillRect(ax - tw / 2 - 20 * U - lw, hy - hPx * 0.35, lw, Math.max(1, 1.2 * U));
                ctx.fillRect(ax + tw / 2 + 20 * U, hy - hPx * 0.35, lw, Math.max(1, 1.2 * U));
            }
        }
        y = hy;
    }
    return y;
}

// The list: name ……… price, a line under it. Fitted to (x, top, w, h).
function list(e, x, top, w, h, U, { max = 6, desc = true, maxPx = 40 } = {}) {
    const { ctx } = e;
    const acc = lift(e.accent);
    const dishes = items(e, max);
    if (!dishes.length) return top;
    const height = (px) => dishes.reduce((a, d) => a + px * 1.05 + (desc && d.desc ? px * 0.58 * 1.55 : 0) + px * 0.95, 0) - px * 0.95;
    let px = maxPx * U;
    while (px > 16 * U && height(px) > h) px *= 0.95;
    const y0 = top + Math.max(0, (h - height(px)) / 2);
    let y = y0;
    const pricePx = px * 0.72;
    const dPx = px * 0.58;
    dishes.forEach((d) => {
        const base = y + capHeight(ctx, TYPE.serif, px);
        const pw = textWidth(ctx, d.price, TYPE.brandM, pricePx);
        const markW = d.marked ? px * 0.62 : 0;
        const nameMax = w - pw - markW - px * 1.2;
        const nPx = fitPx(ctx, d.name, TYPE.serif, px, nameMax);
        const nb = drawText(ctx, d.name, TYPE.serif, nPx, x, base, { color: INK });
        let end = nb ? nb.x + nb.w : x;
        if (d.marked) {
            dot(ctx, end + px * 0.4, base - px * 0.24, px * 0.13, acc);
            end += markW;
        }
        drawText(ctx, d.price, TYPE.brandM, pricePx, x + w, base, { align: 'right', color: d.marked ? acc : INK });
        // Leader dots from the name to the price.
        const from = end + px * 0.35;
        const to = x + w - pw - px * 0.35;
        const stepX = px * 0.28;
        for (let lx = to; lx > from; lx -= stepX) dot(ctx, lx, base - px * 0.05, Math.max(0.8, px * 0.028), alpha(INK, 0.45));
        y = base;
        if (desc && d.desc) {
            const line = wrapLines(ctx, d.desc, TYPE.brandL, dPx, w * 0.86, 1)[0] ?? '';
            y += dPx * 1.55;
            drawText(ctx, line, TYPE.brandL, dPx, x, y, { color: GREY });
        }
        y += px * 0.95;
    });
    e.mark('items', { x, y: y0, w, h: y - px * 0.95 - y0 + px * 0.2 });
    return y;
}

// The marker's key and the small print, on one line.
function footer(e, x, base, w, U, align = 'center') {
    const { ctx } = e;
    const acc = lift(e.accent);
    const t = String(e.fields.note ?? '').trim();
    const px = 19 * U;
    const hours = String(e.fields.hours ?? '').trim();
    let y = base;
    if (hours) {
        e.mark('hours', drawText(ctx, e.caps(hours), TYPE.mono, fitPx(ctx, e.caps(hours), TYPE.mono, 15 * U, w, 0.2), align === 'center' ? x + w / 2 : x, y, { align, tracking: 0.2, color: GREY }));
        y -= 15 * U + 20 * U;
    }
    if (t && items(e, 8).some((d) => d.marked)) {
        const tpx = fitPx(ctx, t, TYPE.brandR, px, w - px * 1.2);
        const tw = textWidth(ctx, t, TYPE.brandR, tpx) + tpx * 1.1;
        const sx = align === 'center' ? x + (w - tw) / 2 : x;
        dot(ctx, sx + tpx * 0.3, y - tpx * 0.33, tpx * 0.27, acc);
        e.mark('note', drawText(ctx, t, TYPE.brandR, tpx, sx + tpx * 1.1, y, { color: SOFT }));
        y -= px + 20 * U;
    } else if (t) {
        e.mark('note', drawText(ctx, t, TYPE.brandR, fitPx(ctx, t, TYPE.brandR, px, w), align === 'center' ? x + w / 2 : x, y, { align, color: SOFT }));
        y -= px + 20 * U;
    }
    return y;
}

export default {
    id: 'menu',
    name: 'Menu',
    category: 'Eat',
    blurb: 'A café or gym-kitchen menu: the dish in an arched window, dish ……… price, one marked to redeem with POWR points.',
    refs: 'a neighbourhood restaurant’s card menu',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'venue', label: 'Venue', value: 'The Northside Kitchen' },
        { key: 'heading', label: 'Menu name', value: 'After training' },
        {
            key: 'items', label: 'Dishes', rows: 6,
            value: 'Protein pancakes | £6.50 | Buttermilk, berries, Greek yoghurt, maple\nChicken rice bowl * | £9.50 | Jasmine rice, edamame, sesame, soy\nOvernight oats | £4.50 | Rolled oats, peanut butter, banana\nCold brew shake | £5.00 | Whey, cold brew, oat milk, ice',
            hint: 'Three to six lines: dish | price | a short line. End a dish with * to mark it as the one to redeem with POWR points.',
        },
        { key: 'note', label: 'Marker key', value: 'Redeem with 400 POWR points' },
        { key: 'hours', label: 'Hours', value: 'Open 6am – 9pm · Order at the bar', hint: 'Leave empty to hide it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Gym kitchen', fields: {} },
        {
            name: 'Café', fields: {
                venue: 'Northside Coffee', heading: 'Breakfast · until 11:30',
                items: 'Flat white | £3.40 | Single origin, whole or oat\nSourdough, eggs & greens * | £8.50 | Two poached eggs, spinach, chilli oil\nGranola bowl | £6.00 | Yoghurt, compote, toasted seeds\nBanana bread | £3.20 | Toasted, salted butter',
                note: 'Free with 350 POWR points', hours: 'Mon – Sat · 7am – 4pm',
            },
            style: { accent: '#D9A066' },
        },
        {
            name: 'Juice bar', fields: {
                venue: 'Northside Juice', heading: 'Cold pressed',
                items: 'Green | £4.80 | Apple, cucumber, kale, lemon, ginger\nRoot | £4.80 | Beetroot, carrot, apple, lime\nThe shake * | £5.50 | Banana, whey, oat milk, cinnamon\nCoconut water | £3.00 | Single-origin, nothing added',
                note: '20% off with POWR points', hours: 'At the front desk',
            },
            style: { accent: '#8FD694' },
        },
        {
            name: 'Six dishes', fields: {
                heading: 'Lunch · 12 – 3pm',
                items: 'Salmon & greens | £11.00 | Brown rice, tenderstem, miso\nChicken caesar * | £9.50 | Cos, parmesan, sourdough crumbs\nFalafel wrap | £7.50 | Hummus, pickles, tahini\nSteak & sweet potato | £13.00 | Chimichurri, rocket\nLentil soup | £5.50 | Spiced, with bread\nGreek yoghurt pot | £3.50 | Honey, walnuts',
            },
        },
    ],
    look: { ...LOOK, target: 0.3, vignette: 0.3 },
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            venue: r.brand,
            note: r.cost ? `Redeem with ${rewardWords(r).points}` : 'Redeem with POWR points',
        }),
    },

    draw(e) {
        const { W, H, u, tu, safe, shape } = e;
        const media = e.hasMedia;
        if (shape === 'wide' || shape === 'strip' || shape === 'square') {
            const strip = shape === 'strip';
            const U = strip ? tu * 0.9 : shape === 'wide' ? tu : u;
            const ah = H - safe.t - safe.b - (strip ? 0 : 20 * U);
            const aw = Math.min(ah * (strip ? 0.62 : 0.66), W * 0.34);
            const ax = safe.l + 12 * U;
            const ay = H - safe.b - ah;
            const has = arch(e, ax, ay, aw, ah, U);
            const x = has ? ax + aw + (strip ? 60 : 80) * U : safe.l + 8 * U;
            const x1 = W - safe.r - 8 * U;
            const w = x1 - x;
            lockup(e, x1, safe.t, (strip ? 26 : 38) * U, { align: 'right', maxW: w * 0.45 });
            if (strip) {
                const mb = masthead(e, x, safe.t, w * 0.5, U, { align: 'left', venuePx: 52 });
                list(e, x, mb + 26 * U, w, H - safe.b - mb - 26 * U, U, { max: 4, desc: false, maxPx: 34 });
                return;
            }
            const mb = masthead(e, x, safe.t + 70 * U, w, U, { align: 'left', venuePx: 72 });
            const fb = footer(e, x, H - safe.b, w, U, 'left');
            list(e, x, mb + 44 * U, w, fb - mb - 70 * U, U, { maxPx: shape === 'wide' ? 42 : 36 });
            return;
        }
        const tall = shape === 'tall';
        const x = safe.l + 30 * u;
        const w = W - safe.r - 30 * u - x;
        let top = safe.t + 90 * u;
        if (media) {
            const many = items(e, 6).length > 4;
            const aw = W * (tall ? (many ? 0.34 : 0.5) : many ? 0.3 : 0.36);
            const ah = aw * (tall ? 1.18 : 1.12);
            arch(e, (W - aw) / 2, safe.t + (tall ? 70 : 64) * u, aw, ah, u);
            top = safe.t + (tall ? 70 : 64) * u + ah + (tall ? 70 : 50) * u;
        } else {
            arch(e, 0, 0, 0, 0, u);
        }
        lockup(e, safe.l + 4 * u, safe.t + 6 * u, 38 * u, { maxW: (media ? W * (tall ? 0.25 : 0.32) - 20 * u : W * 0.5) - safe.l });
        const mb = masthead(e, x, top, w, u, { venuePx: media ? (tall ? 72 : 60) : 100 });
        const fb = footer(e, x, H - safe.b - 4 * u, w, u);
        list(e, x, mb + (tall ? 60 : 44) * u, w, fb - mb - 80 * u, u, { maxPx: tall ? 52 : 38 });
    },
};
