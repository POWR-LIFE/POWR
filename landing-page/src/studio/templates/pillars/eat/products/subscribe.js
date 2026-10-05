/**
 * SUBSCRIBE — a delivery rhythm: "Every 4 weeks" set big over a four-week
 * strip of real dates (this week first), today ringed, the next delivery
 * lit in the accent and the ones after outlined; the product, the price per
 * delivery and the small print the brand writes ("pause any time"). The
 * dates move with the day it's made. For meal-prep, protein and snack
 * brands with a subscription.
 */
import { TYPE } from '../../../../fonts';
import { dot, ring, rule } from '../../../../shapes';
import { drawText, capHeight } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, backdrop, eyebrow, head, headHeight, para, paraLines, rows, num, lift, alpha, onColour, SOFT, GREY, DIM, INK, HAIR, fitPx } from './_parts';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The four weeks from this Monday: 28 days, which are deliveries (the
 * first delivery day after today, "next", then every n weeks) and today.
 */
function weeks(e) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - dow);
    const want = String(e.fields.day ?? '').trim().toLowerCase();
    let dd = DAYS.findIndex((d) => want && d.startsWith(want.slice(0, 3)));
    if (dd < 0) dd = 4;
    // "Every 2 weeks" → 2; "Every week" (no number) → 1.
    const cad = String(e.fields.cadence ?? '');
    const every = Math.max(1, Math.min(4, Math.round(num(cad)) || (/week/i.test(cad) ? 1 : 4)));
    const days = [];
    for (let i = 0; i < 28; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push({ date: d, past: i < dow, today: i === dow });
    }
    // Deliveries: the first delivery day after today, then every n weeks.
    const drops = [];
    for (let i = dow + 1 + ((dd - dow - 1 + 7) % 7); i < 28; i += 7 * every) drops.push(i);
    drops.forEach((i, k) => { days[i].drop = k === 0 ? 'next' : 'later'; });
    return { days, next: days[drops[0]].date };
}

const fmt = (d) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/**
 * The strip: day letters, then four rows of seven dates; or, `line`, all 28
 * in one row with the weeks split by hairlines. Returns its height.
 */
function calendar(e, x, top, w, U, { line = false, px = 26 } = {}) {
    const { ctx } = e;
    const { days } = weeks(e);
    const acc = e.accent;
    const onAcc = onColour(acc);
    const cols = line ? 28 : 7;
    const cw = w / cols;
    const r = Math.min(cw * 0.42, px * U * 1.05);
    const rowH = line ? r * 2.4 : Math.max(r * 2.5, cw * 0.78);
    const lp = Math.min(15 * U, cw * 0.5);
    const headH = line ? 0 : lp * 2.6;
    // Month span over the strip.
    const a = days[0].date;
    const z = days[27].date;
    const span = a.getMonth() === z.getMonth() ? `${MONTHS[a.getMonth()]} ${a.getFullYear()}` : `${MONTHS[a.getMonth()]} – ${MONTHS[z.getMonth()]} ${z.getFullYear()}`;
    if (!line) {
        ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((l, i) => drawText(ctx, l, TYPE.mono, lp, x + cw * (i + 0.5), top + capHeight(ctx, TYPE.mono, lp), { align: 'center', color: DIM }));
        drawText(ctx, e.caps(span), TYPE.mono, lp, x + w, top - lp * 1.6, { align: 'right', tracking: 0.14, color: GREY });
    }
    const np = Math.min(px * U, r * 0.95);
    days.forEach((d, i) => {
        const col = line ? i : i % 7;
        const row = line ? 0 : Math.floor(i / 7);
        const cx = x + cw * (col + 0.5);
        const cy = top + headH + rowH * (row + 0.5);
        let colour = d.past ? DIM : SOFT;
        if (d.drop === 'next') { dot(ctx, cx, cy, r, acc); colour = onAcc; }
        else if (d.drop === 'later') ring(ctx, cx, cy, r - 1 * U, lift(acc), Math.max(1, 1.6 * U));
        if (d.today && d.drop !== 'next') ring(ctx, cx, cy, r - 1 * U, alpha(INK, 0.55), Math.max(1, 1.2 * U));
        drawText(ctx, String(d.date.getDate()), d.drop === 'next' ? TYPE.brandB : TYPE.brandR, np, cx, cy + capHeight(ctx, TYPE.brandR, np) / 2, { align: 'center', color: colour });
        if (line && col % 7 === 0 && col) rule(ctx, x + cw * col, cy - r, x + cw * col, cy + r, HAIR, Math.max(1, 1 * U));
    });
    if (!line) for (let k = 1; k < 4; k++) rule(ctx, x, top + headH + rowH * k, x + w, top + headH + rowH * k, 'rgba(244,241,234,0.08)', Math.max(1, 1 * U));
    const h = headH + rowH * (line ? 1 : 4);
    e.mark('day', { x, y: top, w, h });
    return h;
}
const calendarH = (e, w, U, { line = false, px = 26 } = {}) => {
    const cw = w / (line ? 28 : 7);
    const r = Math.min(cw * 0.42, px * U * 1.05);
    const rowH = line ? r * 2.4 : Math.max(r * 2.5, cw * 0.78);
    return (line ? 0 : Math.min(15 * U, cw * 0.5) * 2.6) + rowH * (line ? 1 : 4);
};

// "Next delivery · Fri 23 Oct" with a dot in the accent.
function nextLine(e, x, y, U, { px = 22, maxW = Infinity } = {}) {
    const { ctx } = e;
    const label = String(e.fields.nextLabel ?? '').trim();
    if (!label) return;
    const t = `${label} · ${fmt(weeks(e).next)}`;
    const p = fitPx(ctx, t, TYPE.brandSB, px * U, maxW - px * U * 1.2);
    dot(ctx, x + p * 0.35, y - capHeight(ctx, TYPE.brandSB, p) / 2, p * 0.3, lift(e.accent));
    e.mark('nextLabel', drawText(ctx, t, TYPE.brandSB, p, x + p * 1.1, y, { color: INK }));
}

// The price per delivery: the amount big, the unit in mono. Returns height.
function price(e, x, top, U, { px = 64, maxW = Infinity } = {}) {
    const { ctx } = e;
    const [amt = '', per = ''] = rows(e.fields.price, 1)[0] ?? [];
    if (!amt) return 0;
    const p = fitPx(ctx, amt, TYPE.brandSB, px * U, maxW);
    const cap = capHeight(ctx, TYPE.brandSB, p);
    const b1 = drawText(ctx, amt, TYPE.brandSB, p, x, top + cap, { color: INK });
    const lab = e.caps(per);
    const b2 = lab.trim() ? drawText(ctx, lab, TYPE.mono, 17 * U, x, top + cap + 17 * U * 1.9, { tracking: 0.16, color: GREY }) : null;
    e.mark('price', b2 ? { x: b1.x, y: b1.y, w: Math.max(b1.w, b2.x + b2.w - b1.x), h: b2.y + b2.h - b1.y } : b1);
    return cap + (b2 ? 17 * U * 1.9 : 0);
}
const priceH = (e, U, px = 64) => (rows(e.fields.price, 1)[0]?.[0] ? capHeight(e.ctx, TYPE.brandSB, px * U) + 17 * U * 1.9 : 0);

export default {
    id: 'eat-subscribe',
    name: 'Subscribe',
    category: 'Eat',
    section: 'Products',
    blurb: 'A delivery rhythm: “Every 4 weeks” over a four-week strip of real dates with the next delivery lit, the product, the price per delivery and the small print.',
    refs: 'a subscription calendar in a meal-prep app',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Subscribe' },
        { key: 'cadence', label: 'Cadence', rows: 2, value: 'Every\n4 weeks', hint: 'The number sets the strip: 1 to 4 weeks between deliveries.' },
        { key: 'day', label: 'Delivery day', value: 'Friday' },
        { key: 'nextLabel', label: 'Next delivery label', value: 'Next delivery', hint: 'The date is added from today. Leave empty to hide it.' },
        { key: 'name', label: 'Product name', value: 'Northside Whey · 1kg' },
        { key: 'price', label: 'Price', value: '£26.99 | a delivery', hint: 'price | unit' },
        { key: 'print', label: 'Small print', rows: 2, value: 'Pause, skip or cancel any time from your account.', hint: 'Your own terms, as you offer them.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein', fields: {}, look: { kind: 'tub' } },
        { name: 'Meal prep', fields: { kicker: 'Meal-prep plan', cadence: 'Every\nweek', day: 'Sunday', name: 'Northside Kitchen · 10 meals', price: '£64 | a week', print: 'Order by Thursday 6pm. Skip any week in the app.' }, look: { kind: 'box' }, style: { accent: '#D9A066' } },
        { name: 'Coffee', fields: { kicker: 'Coffee club', cadence: 'Every\n2 weeks', day: 'Tuesday', name: 'Northside Roasters · 250g', price: '£9.50 | a bag', print: 'Free UK delivery. Change the roast any time.' }, look: { kind: 'pouch' }, style: { accent: '#7FE0C2' } },
        { name: 'Supplements', fields: { kicker: 'Never run out', cadence: 'Every\n4 weeks', day: 'Monday', name: 'Northside Daily · 60 capsules', price: '£12.60 | a jar', print: 'Food supplement. Pause or cancel from your account.' }, look: { kind: 'jar' }, style: { accent: '#E0556B' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['pouch', 'Pouch'], ['box', 'Box'], ['jar', 'Jar'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.offer ? { print: r.offer } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const U = unitOf(e);
        const f = e.fields;
        const kind = e.look.kind ?? 'tub';
        const sub = String(f.name ?? '').split('·')[1]?.trim() ?? '';
        ground(e);
        backdrop(e);

        if (shape === 'strip') {
            const pw = H * 0.5;
            const pbox = { x: safe.l, y: safe.t + 10 * U, w: pw, h: H - safe.t - safe.b - 10 * U };
            glow(e, pbox.x + pw / 2, H * 0.6, pw * 0.75, { strength: 0.5 });
            slot(e, pbox, { kind, sub });
            const x = pbox.x + pw + 50 * U;
            const colW = W * 0.24;
            eyebrow(e, 'kicker', f.kicker, 16 * U, x, safe.t + 16 * U, { maxW: colW, color: lift(e.accent) });
            const cad = String(f.cadence ?? '').replace(/\s*\n\s*/g, ' ');
            head(e, 'cadence', cad, x, safe.t + 44 * U, { maxW: colW, maxH: 70 * U, lines: 1 });
            price(e, x, safe.t + 150 * U, U, { px: 44, maxW: colW });
            para(e, 'print', f.print, TYPE.brandL, 15 * U, x, H - safe.b - 15 * U * 1.3, colW, 2, { color: GREY, leading: 1.3 });
            const cx = x + colW + 60 * U;
            const avail = W - safe.r - cx;
            lockup(e, W - safe.r, safe.t, 26 * U, { align: 'right', maxW: avail * 0.3 });
            // The grid, as wide as the strip's height lets its four rows be.
            const gh = H - safe.t - safe.b;
            const cw = Math.min(avail * 0.62, (gh / (4 * 0.78 + 0.35)) * 7);
            calendar(e, cx, safe.t + (gh - calendarH(e, cw, U, { px: 20 })) / 2, cw, U, { px: 20 });
            const nx = cx + cw + 50 * U;
            eyebrow(e, 'name', f.name, 15 * U, nx, H / 2 - 20 * U, { maxW: W - safe.r - nx, color: GREY });
            nextLine(e, nx, H / 2 + 24 * U, U, { px: 19, maxW: W - safe.r - nx });
            return;
        }

        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        if (shape === 'wide' || shape === 'square') {
            const wide = shape === 'wide';
            const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.4 });
            const pw = w * (wide ? 0.26 : 0.34);
            const pbox = { x, y: lk.y + lk.h + 60 * U, w: pw, h: H - safe.b - (lk.y + lk.h + 60 * U) };
            glow(e, x + pw / 2, pbox.y + pbox.h * 0.6, pw * 0.7, { strength: 0.5 });
            slot(e, pbox, { kind, sub, frame: 0.72 });
            const cx = x + pw + (wide ? 70 : 50) * U;
            const cw = x + w - cx;
            eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: lift(e.accent), maxW: w * 0.4 });
            if (wide) {
                // Words middle, calendar right.
                const mw = cw * 0.42;
                const calX = cx + mw + 70 * U;
                const calW = x + w - calX;
                const top = lk.y + lk.h + 70 * U;
                eyebrow(e, 'name', f.name, 20 * U, cx, top + 20 * U, { maxW: mw, color: GREY });
                const t = head(e, 'cadence', f.cadence, cx, top + 50 * U, { maxW: mw, maxH: 260 * U, lines: 2 });
                price(e, cx, t.bottom + 60 * U, U, { px: 64, maxW: mw });
                const pl = paraLines(e, f.print, TYPE.brandL, 21 * U, mw, 3);
                if (pl) para(e, 'print', f.print, TYPE.brandL, 21 * U, cx, H - safe.b - (pl - 1) * 21 * U * 1.32, mw, 3, { color: GREY });
                const ch = calendarH(e, calW, U, { px: 26 });
                const cTop = top + 60 * U;
                calendar(e, calX, cTop, calW, U, { px: 26 });
                nextLine(e, calX, Math.min(cTop + ch + 60 * U, H - safe.b), U, { px: 24, maxW: calW });
                return;
            }
            // Square: one column right of the product.
            const pl = paraLines(e, f.print, TYPE.brandL, 19 * U, cw, 2);
            let y = H - safe.b;
            if (pl) { para(e, 'print', f.print, TYPE.brandL, 19 * U, cx, y - (pl - 1) * 19 * U * 1.32, cw, 2, { color: GREY }); y -= (pl - 1) * 19 * U * 1.32 + 19 * U + 34 * U; }
            nextLine(e, cx, y, U, { px: 20, maxW: cw });
            y -= 20 * U + 34 * U;
            const ch = calendarH(e, cw, U, { px: 20 });
            calendar(e, cx, y - ch, cw, U, { px: 20 });
            y -= ch + 50 * U;
            const ph = priceH(e, U, 46);
            price(e, cx, y - ph, U, { px: 46, maxW: cw });
            y -= ph + 34 * U;
            const top = lk.y + lk.h + 50 * U;
            const cad = String(f.cadence ?? '');
            const cadMax = Math.min(170 * U, y - top);
            const cadH = headHeight(e, cad, { maxW: cw, maxH: cadMax, lines: 2 });
            head(e, 'cadence', cad, cx, Math.max(top, y - cadH), { maxW: cw, maxH: cadMax, lines: 2 });
            return;
        }

        // Post / story: product and cadence side by side, calendar under.
        const tall = shape === 'tall';
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: lift(e.accent), maxW: w * 0.36 });
        let y = H - safe.b;
        const pl = paraLines(e, f.print, TYPE.brandL, 21 * U, w, 2);
        if (pl) { para(e, 'print', f.print, TYPE.brandL, 21 * U, x, y - (pl - 1) * 21 * U * 1.32, w, 2, { color: GREY }); y -= (pl - 1) * 21 * U * 1.32 + 21 * U + 40 * U; }
        nextLine(e, x, y, U, { px: 24, maxW: w });
        y -= 24 * U + (tall ? 50 : 40) * U;
        const px = tall ? 30 : 26;
        const ch = calendarH(e, w, U, { px });
        calendar(e, x, y - ch, w, U, { px });
        y -= ch + (tall ? 90 : 64) * U;
        const top = lk.y + lk.h + (tall ? 60 : 40) * U;
        const pw = w * 0.42;
        const pbox = { x, y: top, w: pw, h: y - top };
        glow(e, x + pw / 2, top + (y - top) * 0.6, Math.min(pw * 0.7, (y - top) * 0.6), { strength: 0.5 });
        slot(e, pbox, { kind, sub, frame: 0.76 });
        const cx = x + pw + 50 * U;
        const cw = x + w - cx;
        const ph = priceH(e, U, 60);
        price(e, cx, y - ph, U, { px: 60, maxW: cw });
        const room = y - ph - 60 * U - (top + 40 * U);
        const cadH = headHeight(e, f.cadence, { maxW: cw, maxH: Math.min((tall ? 280 : 220) * U, room), lines: 2 });
        const cTop = y - ph - 56 * U - cadH;
        head(e, 'cadence', f.cadence, cx, cTop, { maxW: cw, maxH: Math.min((tall ? 280 : 220) * U, room), lines: 2 });
        eyebrow(e, 'name', f.name, 20 * U, cx, cTop - 30 * U, { maxW: cw, color: GREY });
    },
};
