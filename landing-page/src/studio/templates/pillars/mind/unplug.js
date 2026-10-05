/**
 * UNPLUG — a lock screen with nothing on it: the date, the time set huge and
 * thin, and one notification card that says there are none — a do-not-
 * disturb crescent drawn in vector, "Do not disturb · until 07:00", "0
 * notifications". The headline sits low. For digital-detox and wellness
 * brands, evening rituals, and POWR's rest days.
 */
import { TYPE } from '../../../fonts';
import { capHeight } from '../../../text';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, SOFT, DIM, unitOf, veil, prep, footRow, headColor, label, rewardLine } from './_parts';

// A crescent: the disc less an offset disc (clipped, so nothing is erased).
function moon(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    ctx.arc(cx + r * 0.52, cy - r * 0.38, r * 0.82, 0, Math.PI * 2);
    ctx.clip('evenodd');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// The notification card, w wide, from (x, y). Returns its height.
function card(e, x, y, w, k, measure = false) {
    const { ctx } = e;
    const h = 124 * k;
    if (measure) return h;
    ctx.save();
    ctx.fillStyle = 'rgba(26,24,22,0.72)';
    ctx.strokeStyle = 'rgba(244,241,234,0.14)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 30 * k);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const ir = 30 * k;
    const icx = x + 28 * k + ir;
    const icy = y + h / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(244,241,234,0.08)';
    ctx.beginPath();
    ctx.arc(icx, icy, ir, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    moon(ctx, icx - 1 * k, icy + 1 * k, ir * 0.5, e.accent);
    const tx = icx + ir + 24 * k;
    const tw = x + w - 28 * k - tx;
    const sPx = 26 * k;
    const cPx = 21 * k;
    const sCap = capHeight(ctx, TYPE.brandM, sPx);
    const gap = 16 * k;
    const count = String(e.fields.count ?? '').trim();
    const total = sCap + (count ? gap + capHeight(ctx, TYPE.brandR, cPx) : 0);
    const b1 = icy - total / 2 + sCap;
    label(e, 'status', e.fields.status, tx, b1, { px: sPx, maxW: tw, color: e.ink, spec: TYPE.brandM, tracking: 0, upper: false });
    if (count) label(e, 'count', count, tx, b1 + gap + capHeight(ctx, TYPE.brandR, cPx), { px: cPx, maxW: tw, color: DIM, spec: TYPE.brandR, tracking: 0, upper: false });
    return h;
}

// Date over the big thin clock, centred on cx. Returns the clock's bottom.
function clock(e, cx, top, maxW, maxH, k, align = 'center') {
    const dPx = 22 * k;
    const dCap = capHeight(e.ctx, TYPE.brandR, dPx);
    const hasDate = String(e.fields.date ?? '').trim() !== '';
    if (hasDate) label(e, 'date', e.fields.date, cx, top + dCap, { px: dPx, maxW, align, color: SOFT, spec: TYPE.brandR, tracking: 0.18 });
    const cb = prep(e, e.fields.clock, TYPE.brandXL, { maxW, maxH, lines: 1, tracking: -0.02 });
    const cTop = top + (hasDate ? dCap + 30 * k : 0);
    cb.draw('clock', cx, cTop, { align, color: e.ink });
    return cTop + cb.h;
}

function banner(e) {
    const { W, H, safe, shape } = e;
    const k = unitOf(e);
    const size = e.look.size ?? 1;
    const strip = shape === 'strip';
    e.photo({ x: 0, y: 0, w: W, h: H });
    veil(e, 0.4);
    const x0 = safe.l;
    const x1 = W - safe.r;
    if (strip) {
        const aW = W * 0.26;
        clock(e, x0, safe.t + 10 * k, aW, (H - safe.t - safe.b) * 0.5, k, 'left');
        const cw = W * 0.34;
        const cx = x0 + aW + 60 * k;
        card(e, cx, H / 2 - card(e, 0, 0, 0, k, true) / 2, cw, k);
        const hx = cx + cw + 60 * k;
        const footTop = footRow(e, { x0: hx, x1, bottom: H - safe.b, k, lockH: 22, footKey: 'none' });
        const hb = prep(e, e.fields.headline, e.headline, { maxW: (x1 - hx) * size, maxH: (footTop - safe.t - 40 * k) * size, max: 64 * k, lines: 2 });
        hb.draw('headline', hx, safe.t + Math.max(0, (footTop - 30 * k - safe.t - hb.h) / 2), { color: headColor(e) });
        return;
    }
    const colW = W * 0.4;
    const cx = x0 + 30 * k + colW / 2;
    const ch = card(e, 0, 0, 0, k, true);
    const clockH = H * 0.2;
    const group = 22 * k + 30 * k + clockH + 60 * k + ch;
    const top = (H - group) / 2;
    const cBottom = clock(e, cx, top, colW, clockH, k);
    card(e, cx - colW / 2, cBottom + 60 * k, colW, k);
    const hx = W * 0.56;
    const footTop = footRow(e, { x0: hx, x1, bottom: H - safe.b, k });
    const hb = prep(e, e.fields.headline, e.headline, { maxW: (x1 - hx) * size, maxH: H * 0.3 * size, max: 96 * k * size, lines: 3 });
    hb.draw('headline', hx, safe.t + Math.max(0, (footTop - 40 * k - safe.t - hb.h) / 2), { color: headColor(e) });
}

export default {
    id: 'unplug',
    name: 'Unplug',
    category: 'Mind',
    blurb: 'A quiet lock screen: the time huge and thin, one card with a do-not-disturb moon and “0 notifications”. For digital detox and rest days.',
    refs: 'a phone lock screen at night',
    headlineFont: 'brandL',
    fields: [
        { key: 'date', label: 'Date line', value: 'Sunday evening' },
        { key: 'clock', label: 'Time', value: '21:00', hint: 'Or a window, like 21:00–07:00.' },
        { key: 'status', label: 'Card: first line', value: 'Do not disturb · until 07:00' },
        { key: 'count', label: 'Card: second line', value: '0 notifications' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Screens off.\nEvening on.', hint: '{Braces} colour a word.' },
        { key: 'footer', label: 'Small print', value: 'Nine till seven' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Evening', fields: { date: 'Sunday evening', clock: '21:00', status: 'Do not disturb · until 07:00', count: '0 notifications', headline: 'Screens off.\nEvening on.', footer: 'Nine till seven' } },
        { name: 'Rest day', fields: { date: 'Rest day', clock: '10:00', status: 'Rest day · on', count: 'Nothing to log today', headline: 'Rest is part\nof the plan.', footer: 'The streak is yours' } },
        { name: 'Detox weekend', fields: { date: 'Saturday – Sunday', clock: '48h', status: 'Offline · back Monday', count: '0 notifications', headline: 'Two days,\nno feed.', footer: 'Northside · Offline weekend' } },
        { name: 'Window', fields: { date: 'Every night', clock: '22:00–07:00', status: 'Sleep focus · on', count: 'Calls from favourites only', headline: 'Let the day end.', footer: 'Northside Wellness' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, target: 0.22, tint: 'warm', tintAmount: 0.55 },
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.3);
        e.fade(0, 0, W, H * 0.4, 'top', 0.45);
        e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.8);
        const x0 = safe.l;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k, align: 'center' });

        const top = safe.t + (tall ? 70 : sq ? 10 : 40) * k;
        const cBottom = clock(e, W / 2, top, (x1 - x0) * 0.86, H * (tall ? 0.11 : sq ? 0.15 : 0.13), k);
        const cw = Math.min(x1 - x0, W * (sq ? 0.62 : 0.78));
        card(e, W / 2 - cw / 2, cBottom + (sq ? 40 : 64) * k, cw, k);

        const hb = prep(e, e.fields.headline, e.headline, { maxW: (x1 - x0) * 0.86 * size, maxH: H * (sq ? 0.16 : 0.15) * size, max: (sq ? 76 : 88) * k * size, lines: 3, gap: 0.22 });
        const hTop = footTop - (sq ? 44 : 70) * k - hb.desc - hb.h;
        e.shade({ x: W * 0.1, y: hTop, w: W * 0.8, h: hb.h }, { ceiling: 0.28, max: 0.5 });
        hb.draw('headline', W / 2, hTop, { align: 'center', color: headColor(e) });
    },
};
