/**
 * GIFT CARD — a gift card drawn in vector, floating over a soft ground: a
 * rounded card in the brand's colour (or matte black, or paper) with the
 * brand's mark, "Gift card" in mono, the value in serif and ripples in one
 * corner; a second card turned behind it. Above, one line in serif italic,
 * "for someone who needs a pause". A framed product shot becomes the card's
 * face; a cut-out sits on it. For studios, apps and wellness shops.
 */
import { TYPE } from '../../../../fonts';
import { capHeight, textWidth } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, hasPartner, brandMark, textOn } from '../../kit';
import {
    MIND_LOOK, SOFT, GROUND, frame, ground, veil, footRow, footH, headColor, glow, mix, hasProduct, framedShot, fitPx,
    lineItem, blockItem, paraItem, stack, stackH, productFill,
} from './_parts';

const RATIO = 1.586;

// The card's face colours for the chosen material.
function material(e) {
    const m = e.look.card ?? 'accent';
    if (framedShot(e)) return { fill: null, ink: '#F4F1EA', dim: 'rgba(244,241,234,0.72)', m: 'photo' };
    if (m === 'paper') return { fill: ['#F1EDE5', '#D9D3C8'], ink: '#141312', dim: 'rgba(20,19,18,0.6)', m };
    if (m === 'dark') return { fill: ['#26231F', '#0F0E0D'], ink: '#F4F1EA', dim: 'rgba(244,241,234,0.6)', m };
    const ink = textOn(e.accent);
    return { fill: [e.accent, mix(e.accent, '#000000', 0.28)], ink, dim: ink === '#111111' ? 'rgba(17,17,17,0.62)' : 'rgba(244,241,234,0.7)', m };
}

function card(e, c, k) {
    const { ctx } = e;
    const r = c.w * 0.055;
    const mat = material(e);
    const pad = c.w * 0.07;
    // The second card, turned behind.
    ctx.save();
    ctx.translate(c.x + c.w / 2 + c.w * 0.05, c.y + c.h / 2 - c.h * 0.08);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#1B1917';
    ctx.strokeStyle = 'rgba(244,241,234,0.16)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    ctx.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, r);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // The face.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, r);
    ctx.clip();
    if (mat.fill) {
        const g = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
        g.addColorStop(0, mat.fill[0]);
        g.addColorStop(1, mat.fill[1]);
        ctx.fillStyle = g;
        ctx.fillRect(c.x, c.y, c.w, c.h);
    }
    ctx.restore();
    if (mat.m === 'photo') {
        productShot(e, c, { stage: false, radius: r / e.u });
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(c.x, c.y, c.w, c.h, r);
        ctx.clip();
        const s = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
        s.addColorStop(0, 'rgba(0,0,0,0.45)');
        s.addColorStop(0.4, 'rgba(0,0,0,0.05)');
        s.addColorStop(0.6, 'rgba(0,0,0,0.1)');
        s.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = s;
        ctx.fillRect(c.x, c.y, c.w, c.h);
        ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, r);
    ctx.clip();
    if (mat.m !== 'photo') {
        // Ripples from the lower-right corner.
        ctx.strokeStyle = mat.ink === '#F4F1EA' ? 'rgba(244,241,234,0.1)' : 'rgba(17,17,17,0.1)';
        ctx.lineWidth = Math.max(1, c.w * 0.003);
        for (let i = 1; i <= 7; i++) {
            ctx.beginPath();
            ctx.arc(c.x + c.w * 0.96, c.y + c.h * 1.02, c.w * 0.09 * i, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Sheen from the top left.
        const sh = ctx.createLinearGradient(c.x, c.y, c.x + c.w * 0.7, c.y + c.h);
        sh.addColorStop(0, 'rgba(255,255,255,0.14)');
        sh.addColorStop(0.45, 'rgba(255,255,255,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(c.x, c.y, c.w, c.h);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, r);
    ctx.stroke();
    ctx.restore();

    // A cut-out sits on the card's right half.
    if (hasProduct(e) && mat.m !== 'photo') {
        // Clear of the label above and the small line below.
        productShot(e, { x: c.x + c.w * 0.52, y: c.y + c.h * 0.24, w: c.w * 0.4, h: c.h * 0.5 }, { stage: false });
    }

    // Words: mark top left, label top right, value bottom left, line bottom right.
    const markH = c.h * 0.1;
    if (hasPartner(e)) {
        brandMark(e, { x: c.x + pad, y: c.y + pad, w: c.w * 0.36, h: markH }, { align: 'left', color: mat.ink });
    } else {
        const t = e.caps(e.fields.cardName).trim();
        if (t) {
            const px = fitPx(ctx, t, TYPE.brandSB, markH * 0.95, c.w * 0.44, 0.24);
            lineItem(e, 'cardName', t, c.x + pad, { px, spec: TYPE.brandSB, color: mat.ink, tracking: 0.24, upper: false }).draw(c.y + pad + (markH - capHeight(ctx, TYPE.brandSB, px)) / 2);
        }
    }
    const lPx = c.h * 0.05;
    lineItem(e, 'cardLabel', e.fields.cardLabel, c.x + c.w - pad, { px: lPx, spec: TYPE.monoR, color: mat.dim, tracking: 0.2, align: 'right', maxW: c.w * 0.4 })
        ?.draw(c.y + pad + (markH - capHeight(ctx, TYPE.monoR, lPx)) / 2);
    const v = String(e.fields.value ?? '').trim();
    if (v) {
        let px = c.h * 0.32;
        const vw = textWidth(ctx, v, TYPE.serif, px);
        if (vw > c.w * 0.5) px *= (c.w * 0.5) / vw;
        lineItem(e, 'value', v, c.x + pad, { px, spec: TYPE.serif, color: mat.ink, tracking: -0.01, upper: false }).draw(c.y + c.h - pad - capHeight(ctx, TYPE.serif, px));
    }
    const line = lineItem(e, 'cardLine', e.fields.cardLine, c.x + c.w - pad, { px: lPx * 0.9, spec: TYPE.monoR, color: mat.dim, tracking: 0.16, align: 'right', maxW: c.w * 0.38 });
    line?.draw(c.y + c.h - pad - line.h);
}

// The card, floating: a soft glow under it and a pool of light below.
function floating(e, c, k) {
    glow(e, c.x + c.w / 2, c.y + c.h / 2, c.w * 0.8, c.h * 0.95, 0.2);
    glow(e, c.x + c.w / 2, c.y + c.h + c.h * 0.2, c.w * 0.42, c.h * 0.05, 0.16, '#FFF6E6');
    card(e, c, k);
}

function words(e, x, w, k, { px, maxH, align = 'left' }) {
    const size = e.look.size ?? 1;
    return [
        blockItem(e, 'line', e.fields.line, x, e.headline, { maxW: w * size, maxH: maxH * size, max: px * size, lines: 3, gap: 0.26 }, { align, color: headColor(e) }),
        paraItem(e, 'sub', e.fields.sub, x, { px: Math.min(28 * k, px * 0.34), spec: TYPE.brandL, maxW: w, maxLines: 3, color: SOFT, align, before: 30 * k }),
    ];
}
const offerItem = (e, x, w, k, align = 'left') => lineItem(e, 'offer', e.fields.offer, x, { px: 22 * k, spec: TYPE.brandR, maxW: w, color: e.ink, tracking: 0, upper: false, align });

export default {
    id: 'mind-gift-card',
    name: 'Gift Card',
    category: 'Mind',
    section: 'Products',
    blurb: 'A drawn gift card floating over a soft ground (the brand’s colour, matte black or paper), the value in serif, and one line in serif italic above it.',
    refs: 'a boutique gift card, photographed on black',
    headlineFont: 'serifI',
    photo: 'optional',
    fields: [
        { key: 'line', label: 'Line', rows: 3, value: 'For someone who\nneeds a pause.', hint: '{Braces} colour a word.' },
        { key: 'sub', label: 'Under it', rows: 2, value: 'Classes, candles and the journal. One card for any of it.' },
        { key: 'value', label: 'Card: value', value: '£50' },
        { key: 'cardName', label: 'Card: name', value: 'Northside', hint: 'Shown when there’s no partner logo or name.' },
        { key: 'cardLabel', label: 'Card: label', value: 'Gift card' },
        { key: 'cardLine', label: 'Card: small line', value: 'Studio · Home · Paper' },
        { key: 'offer', label: 'Offer', value: 'Or 5,000 POWR points in the app', hint: 'Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Sent by email · Valid 12 months' },
        { ...PRODUCT_FIELD, hint: 'Optional. A photo becomes the card’s face; a cut-out sits on the card.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Studio', fields: { line: 'For someone who\nneeds a pause.', sub: 'Classes, candles and the journal. One card for any of it.', value: '£50', cardName: 'Northside', cardLabel: 'Gift card', cardLine: 'Studio · Home · Paper', offer: 'Or 5,000 POWR points in the app', footer: 'Sent by email · Valid 12 months' } },
        { name: 'App gift', fields: { line: 'A year of\n_quiet_, wrapped.', sub: 'Twelve months of Premium, sent to their inbox.', value: '12 mo', cardName: 'Northside', cardLabel: 'Premium', cardLine: 'iPhone · Android', offer: 'Or 4,800 POWR points', footer: 'Redeem in the app' } },
        { name: 'Treatments', fields: { line: 'An hour that’s\nall theirs.', sub: 'Any treatment, any day we’re open.', value: '£65', cardName: 'The Quiet Room', cardLabel: 'Gift card', cardLine: 'Any 60-minute treatment', offer: 'Members: redeem with POWR points', footer: 'Valid 12 months' } },
        { name: 'Class pack', fields: { line: 'Five sessions,\nno plans needed.', sub: 'Breathwork, sound or yin. They choose.', value: '5×', cardName: 'Northside', cardLabel: 'Class pack', cardLine: 'Any session · 6 months', offer: 'Or 8,000 POWR points', footer: 'Book in the app' } },
    ],
    look: { ...MIND_LOOK, mono: 0.7, target: 0.18, card: 'accent' },
    controls: [
        { key: 'card', label: 'Card', options: [['accent', 'Brand colour'], ['dark', 'Matte black'], ['paper', 'Paper']] },
    ],
    fill: {
        reward: (r) => {
            const f = productFill(r);
            return { ...f, offer: f.points, ...(r.value ? { value: `${r.value}${r.unit === 'off' ? ' off' : ''}` } : {}) };
        },
    },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k } = f;
        ground(e, GROUND);
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.55);
        }

        if (f.banner) {
            const ch = (f.bottom - f.top) * (f.strip ? 0.82 : 0.56);
            const cw = Math.min(ch * RATIO, W * (f.strip ? 0.3 : 0.4));
            const c = { x: f.x1 - cw - (f.strip ? 30 : 60) * k, y: 0, w: cw, h: cw / RATIO };
            c.y = (H - c.h) / 2 + (f.strip ? 6 : 20) * k;
            floating(e, c, k);
            const x = f.x0;
            const w = c.x - 110 * k - x;
            const footTop = f.bottom - footH(e, k, { lockH: f.strip ? 22 : 26 });
            const list = [...words(e, x, w, k, { px: (f.strip ? 64 : 100) * k, maxH: (f.bottom - f.top) * (f.strip ? 0.44 : 0.3) }), offerItem(e, x, w, k)];
            if (list[2]) list[2].before = (f.strip ? 26 : 50) * k;
            if (f.strip && list[1]) list[1] = null;
            stack(list, f.top + Math.max(0, (footTop - 30 * k - f.top - stackH(list)) / 2));
            footRow(e, { x0: f.x0, x1: c.x - 80 * k, bottom: f.bottom, k, lockH: f.strip ? 22 : 26, footKey: f.strip ? 'none' : 'footer' });
            return;
        }

        // Post, square, story: the line, the card, the offer.
        const footTop = f.bottom - footH(e, k, { align: 'center' });
        const w = f.x1 - f.x0;
        const top = f.top + (f.tall ? 60 : f.sq ? 10 : 30) * k;
        const list = words(e, W / 2, w * 0.86, k, { px: (f.sq ? 72 : 88) * k, maxH: H * (f.sq ? 0.15 : 0.14), align: 'center' });
        const hb = stack(list, top);
        const offer = offerItem(e, W / 2, w, k, 'center');
        const oy = footTop - (f.sq ? 40 : 64) * k - (offer?.h ?? 0);
        if (offer) offer.draw(oy);
        const room = { y: hb + (f.sq ? 60 : 90) * k, b: oy - (f.sq ? 70 : 110) * k };
        const cw = Math.min(w * (f.sq ? 0.62 : 0.8), ((room.b - room.y) / 1.12) * RATIO);
        const ch = cw / RATIO;
        const c = { x: W / 2 - cw / 2 - cw * 0.02, y: room.y + (room.b - room.y - ch) / 2 + ch * 0.06, w: cw, h: ch };
        floating(e, c, k);
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k, align: 'center' });
    },
};
