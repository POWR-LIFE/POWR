/**
 * SESSION MENU — a studio's sessions as a quiet menu where the length of
 * each is drawn: a hairline bar as long as the session, the minutes in mono
 * at its end, the name in serif and the price to the right. One session
 * carries a "Redeem with POWR points" chip. A photo or product is optional.
 * For wellness studios: breathwork, sound baths, yin, meditation.
 */
import { TYPE } from '../../../../fonts';
import { capHeight, textWidth } from '../../../../text';
import { rule, dot } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, textOn } from '../../kit';
import {
    MIND_LOOK, DIM, SOFT, HAIR, GROUND, frame, ground, footRow, footH, headColor, glow, hasProduct, framedShot, fitPx,
    lineItem, blockItem, paraItem, stack, stackH, pairs, productFill,
} from './_parts';

// "45 min" → 45, "1 h" → 60, "1h 15" → 75, "90" → 90.
function minutes(s) {
    const t = String(s ?? '').toLowerCase();
    const h = t.match(/(\d+(?:\.\d+)?)\s*h/);
    const nums = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (h) return Number(h[1]) * 60 + (nums.length > 1 ? nums[1] : 0);
    return nums[0] ?? 0;
}

const sessions = (e) => pairs(e.fields.sessions, 5).map((p) => (p[0] === '' ? [p[1], '', ''] : p)).map(([name, len = '', price = '']) => ({ name, len, price, min: minutes(len) }));
const pick = (e) => Math.round(Number(String(e.fields.redeem ?? '').replace(/[^\d]/g, ''))) - 1;

// The chip: accent fill, the words in whichever of #111 / ink reads on it.
function chip(e, text, x, y, px, k, align = 'left') {
    const { ctx } = e;
    const t = e.caps(text).trim();
    if (!t) return null;
    const tw = textWidth(ctx, t, TYPE.mono, px, 0.14);
    const padX = px * 0.9;
    const h = px * 2.1;
    const w = tw + padX * 2;
    const x0 = align === 'right' ? x - w : x;
    ctx.save();
    ctx.fillStyle = e.accent;
    ctx.beginPath();
    ctx.roundRect(x0, y, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    lineItem(e, 'marker', t, x0 + padX, { px, spec: TYPE.mono, color: textOn(e.accent), tracking: 0.14, upper: false }).draw(y + (h - capHeight(ctx, TYPE.mono, px)) / 2);
    return { x: x0, y, w, h };
}

// One session, from y, rh tall: name + price on a line, the duration bar under.
function row(e, s, i, x0, x1, y, rh, k, { namePx, maxMin, marked, first }) {
    const { ctx } = e;
    if (first) rule(ctx, x0, y, x1, y, HAIR, Math.max(1, 1.1 * k));
    rule(ctx, x0, y + rh, x1, y + rh, HAIR, Math.max(1, 1.1 * k));
    const pPx = namePx * 0.8;
    const pw = s.price ? textWidth(ctx, s.price, TYPE.brandL, pPx) : 0;
    const nPx = fitPx(ctx, s.name, TYPE.serif, namePx, x1 - x0 - pw - 60 * k);
    const nCap = capHeight(ctx, TYPE.serif, nPx);
    const barY = y + rh * 0.74;
    const base = y + (barY - y) * 0.5 + nCap * 0.5 - 4 * k;
    lineItem(e, null, s.name, x0, { px: nPx, spec: TYPE.serif, color: e.ink, tracking: 0, upper: false }).draw(base - nCap);
    if (s.price) lineItem(e, null, s.price, x1, { px: pPx, spec: TYPE.brandL, color: e.ink, tracking: 0, upper: false, align: 'right' }).draw(base - capHeight(ctx, TYPE.brandL, pPx));
    // The bar: the session's length against the longest on the menu.
    const span = (x1 - x0) * 0.62;
    const len = s.min > 0 ? Math.max(span * 0.08, (span * s.min) / maxMin) : 0;
    const colour = marked ? e.accent : 'rgba(244,241,234,0.7)';
    rule(ctx, x0, barY, x0 + span, barY, 'rgba(244,241,234,0.1)', Math.max(1, 1.2 * k));
    if (len) {
        rule(ctx, x0, barY, x0 + len, barY, colour, Math.max(1.5, 3 * k));
        dot(ctx, x0 + len, barY, 4.5 * k, colour);
    }
    const mPx = Math.min(15 * k, rh * 0.12);
    if (s.len) lineItem(e, null, s.len, x0 + len + 20 * k, { px: mPx, spec: TYPE.monoR, color: DIM, tracking: 0.14 }).draw(barY - capHeight(ctx, TYPE.monoR, mPx) / 2);
    if (marked) chip(e, e.fields.marker, x1, barY - mPx * 1.05, mPx * 0.95, k, 'right');
}

function menu(e, x0, x1, y0, y1, k, { namePx }) {
    const list = sessions(e);
    if (!list.length) return;
    const rh = Math.min((y1 - y0) / list.length, namePx * 3.6);
    const maxMin = Math.max(60, ...list.map((s) => s.min));
    const m = pick(e);
    list.forEach((s, i) => row(e, s, i, x0, x1, y0 + i * rh, rh, k, { namePx: Math.min(namePx, rh * 0.36), maxMin, marked: i === m, first: i === 0 }));
    e.mark('sessions', { x: x0, y: y0, w: x1 - x0, h: rh * list.length });
}

function head(e, x, w, k, { namePx, maxH, note = true }) {
    const size = e.look.size ?? 1;
    return [
        lineItem(e, 'kicker', e.fields.kicker, x, { px: 16 * k, spec: TYPE.monoR, maxW: w, tracking: 0.22 }),
        blockItem(e, 'title', e.fields.title, x, e.headline, { maxW: w * size, maxH: maxH * size, max: namePx * k * size, lines: 2, gap: 0.2 }, { color: headColor(e), before: 24 * k }),
        note ? paraItem(e, 'note', e.fields.note, x, { px: 22 * k, spec: TYPE.brandR, maxW: w, maxLines: 2, color: SOFT, before: 26 * k }) : null,
    ];
}

function product(e, box) {
    if (!hasProduct(e)) return;
    if (framedShot(e)) {
        productShot(e, box, { stage: false, radius: 8 });
        return;
    }
    glow(e, box.x + box.w / 2, box.y + box.h * 0.6, box.w * 0.6, box.h * 0.5, 0.14);
    productShot(e, box, { kind: 'candle' });
}

export default {
    id: 'session-menu',
    name: 'Session Menu',
    category: 'Mind',
    section: 'Products',
    blurb: 'A studio’s sessions with their length drawn as a hairline bar, the name in serif, the price to the right, one marked "Redeem with POWR points". For wellness studios.',
    refs: 'a spa treatment menu',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Sessions · This week' },
        { key: 'title', label: 'Studio', rows: 2, value: 'Northside\nStudio', hint: '{Braces} colour a word.' },
        { key: 'sessions', label: 'Sessions', rows: 5, value: 'Breathwork | 45 min | £18\nSound bath | 60 min | £22\nYin | 75 min | £20', hint: 'One per line: name | length | price. Up to five.' },
        { key: 'redeem', label: 'Redeem with points: which one', value: '2', hint: 'Its number in the list. Leave empty for none.' },
        { key: 'marker', label: 'Chip', value: 'Redeem with POWR points' },
        { key: 'note', label: 'Note', rows: 2, value: 'Mats, blankets and tea are here for you.', hint: 'What’s included. Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Book in the app' },
        { ...PRODUCT_FIELD, hint: 'Optional: a candle, oil or the studio itself. The menu is complete without it.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Studio', fields: { kicker: 'Sessions · This week', title: 'Northside\nStudio', sessions: 'Breathwork | 45 min | £18\nSound bath | 60 min | £22\nYin | 75 min | £20', redeem: '2', marker: 'Redeem with POWR points', note: 'Mats, blankets and tea are here for you.', footer: 'Book in the app' } },
        { name: 'Sound', fields: { kicker: 'Sound baths', title: 'Low Tide', sessions: 'Short bath | 30 min | £12\nFull bath | 60 min | £22\nFull moon | 90 min | £30\nPrivate | 60 min | £85', redeem: '1', marker: 'Or 1,200 POWR points', note: 'Bring socks. We have the rest.', footer: 'Northside · Book in the app' } },
        { name: 'Treatments', fields: { kicker: 'Treatments', title: 'The Quiet\nRoom', sessions: 'Head and shoulders | 30 min | £35\nBack | 45 min | £50\nFull body | 60 min | £65\nFull body | 90 min | £90', redeem: '1', marker: 'Redeem with POWR points', note: 'Oils are unscented unless you ask.', footer: 'Northside Wellness' } },
        { name: 'Drop-in', fields: { kicker: 'Drop in · No booking', title: 'Midday\nSits', sessions: 'Sit | 15 min | Free\nSit and walk | 30 min | £5\nLong sit | 45 min | £8', redeem: '3', marker: 'Members: with points', note: 'Weekdays at 12:30. Come as you are.', footer: 'Northside Studio' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, target: 0.24 },
    fill: { reward: (r) => { const f = productFill(r); return { ...f, marker: f.points || 'Redeem with POWR points' }; } },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k } = f;
        ground(e, GROUND);

        if (f.strip) {
            const pw = e.hasMedia ? W * 0.2 : 0;
            if (e.hasMedia) {
                e.photo({ x: 0, y: 0, w: pw, h: H });
                e.fade(pw * 0.6, 0, pw * 0.4, H, 'right', 0.3);
            }
            const hx = (e.hasMedia ? pw + 56 * k : f.x0);
            const hw = W * 0.24;
            const list = head(e, hx, hw, k, { namePx: 64, maxH: (f.bottom - f.top) * 0.4, note: false });
            stack(list, f.top + 10 * k);
            footRow(e, { x0: hx, x1: hx + hw, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            const mx = hx + hw + 60 * k;
            menu(e, mx, f.x1, f.top + 4 * k, f.bottom, k, { namePx: 38 * k });
            return;
        }

        if (f.wide) {
            const lw = W * 0.38;
            const footTop = f.bottom - footH(e, k);
            if (e.hasMedia) {
                e.photo({ x: 0, y: 0, w: lw, h: H });
                e.fade(0, H * 0.3, lw, H * 0.7, 'bottom', 0.9);
            }
            const tx = f.x0;
            const tw = lw - f.x0 - 50 * k;
            const list = head(e, tx, tw, k, { namePx: 96, maxH: H * 0.22 });
            const h = stackH(list);
            const top = e.hasMedia ? footTop - 60 * k - h : f.top + 20 * k;
            if (e.hasMedia) e.shade({ x: tx, y: top, w: tw, h }, { ceiling: 0.2, max: 0.6 });
            const hb = stack(list, top);
            if (!e.hasMedia) product(e, { x: tx, y: hb + 50 * k, w: tw, h: footTop - 60 * k - hb - 50 * k });
            const mx = lw + 70 * k;
            menu(e, mx, f.x1, f.top + 20 * k, footTop - 50 * k, k, { namePx: 50 * k });
            footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
            return;
        }

        // Post, square, story.
        const footTop = f.bottom - footH(e, k);
        const w = f.x1 - f.x0;
        let top = f.top + (f.tall ? 30 : 0) * k;
        if (e.hasMedia) {
            const band = H * (f.tall ? 0.36 : f.sq ? 0.36 : 0.4);
            e.photo({ x: 0, y: 0, w: W, h: band });
            e.fade(0, 0, W, band * 0.3, 'top', 0.4);
            e.fade(0, band * 0.3, W, band * 0.7 + 1, 'bottom', 0.96);
            top = band - (f.sq ? 150 : 170) * k;
        }
        const withProduct = hasProduct(e);
        const tw = withProduct ? w * 0.6 : w;
        const alone = !withProduct && !e.hasMedia;
        const list = head(e, f.x0, tw, k, { namePx: (f.sq ? 84 : 104) * (alone ? 1.2 : 1), maxH: H * (alone ? 0.2 : 0.16) });
        const n = Math.max(1, sessions(e).length);
        const rowH = (f.tall ? 170 : f.sq ? 118 : 150) * k;
        const menuBottom = footTop - (f.sq ? 40 : 60) * k;
        // Menu only: the whole card sits in the middle of the frame.
        if (!withProduct && !e.hasMedia) {
            const total = stackH(list) + (f.sq ? 60 : 110) * k + n * rowH;
            top = Math.max(top, f.top + (menuBottom - f.top - total) * 0.45);
        }
        const hb = top + stackH(list);
        const menuTop = !withProduct && !e.hasMedia
            ? hb + (f.sq ? 60 : 110) * k
            : Math.max(hb + (f.sq ? 44 : 70) * k, menuBottom - n * rowH);
        if (e.hasMedia) e.shade({ x: f.x0, y: top, w: tw, h: hb - top }, { ceiling: 0.2, max: 0.55 });
        if (withProduct) product(e, { x: f.x0 + tw + 40 * k, y: top, w: w - tw - 40 * k, h: menuTop - 40 * k - top });
        stack(list, top);
        menu(e, f.x0, f.x1, menuTop, Math.min(menuBottom, menuTop + n * rowH), k, { namePx: (f.sq ? 46 : 54) * k });
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
    },
};
