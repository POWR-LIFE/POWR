/**
 * APP SCREEN — a phone drawn in vector (thin black bezel, rounded, the
 * island) holding the app: the uploaded screenshot fills the screen, or the
 * photo does, or — with neither — a drawn player screen (breathing rings,
 * the session's name, a progress line). Beside it the app's name in serif,
 * one feature line, the offer and where to get it. For meditation, journal
 * and breathwork apps.
 */
import { TYPE } from '../../../../fonts';
import { drawText, capHeight, textWidth } from '../../../../text';
import { ring, dot } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, DIM, SOFT, HAIR, GROUND, frame, ground, veil, footRow, headColor, glow, hasProduct, framedShot,
    lineItem, blockItem, paraItem, stack, stackH, productFill,
} from './_parts';

const RATIO = 2.05;

// The phone's outline and screen for a phone as big as fits maxW × maxH,
// centred on (cx, cy). The bezel is thick enough (≥ 0.42 × the screen's
// corner radius) that it covers the corners of a rectangle drawn in the screen.
function geom(cx, cy, maxW, maxH) {
    const w = Math.max(10, Math.min(maxW, maxH / RATIO));
    const h = w * RATIO;
    const b = w * 0.032;
    const rIn = b / 0.42;
    const x = cx - w / 2;
    const y = cy - h / 2;
    return { x, y, w, h, b, rIn, R: rIn + b, cx, screen: { x: x + b, y: y + b, w: w - 2 * b, h: h - 2 * b } };
}

// The bezel, the metal edge, the side buttons and the island.
function bezel(e, g) {
    const { ctx } = e;
    const s = g.screen;
    ctx.save();
    ctx.fillStyle = '#060606';
    ctx.beginPath();
    ctx.roundRect(g.x, g.y, g.w, g.h, g.R);
    ctx.roundRect(s.x, s.y, s.w, s.h, g.rIn);
    ctx.fill('evenodd');
    const lw = Math.max(1, g.w * 0.01);
    const m = ctx.createLinearGradient(g.x, g.y, g.x + g.w, g.y + g.h);
    m.addColorStop(0, '#57544f');
    m.addColorStop(0.35, '#23221f');
    m.addColorStop(0.7, '#1b1a18');
    m.addColorStop(1, '#4a4743');
    ctx.strokeStyle = m;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.roundRect(g.x + lw / 2, g.y + lw / 2, g.w - lw, g.h - lw, g.R - lw / 2);
    ctx.stroke();
    const bw = g.w * 0.012;
    ctx.fillStyle = '#2c2a27';
    [[0.17, 0.045], [0.25, 0.085], [0.36, 0.085]].forEach(([t, l]) => {
        ctx.beginPath();
        ctx.roundRect(g.x - bw, g.y + g.h * t, bw + 1, g.h * l, bw * 0.4);
        ctx.fill();
    });
    ctx.beginPath();
    ctx.roundRect(g.x + g.w - 1, g.y + g.h * 0.27, bw + 1, g.h * 0.13, bw * 0.4);
    ctx.fill();
    const iw = g.w * 0.28;
    const ih = g.w * 0.082;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(g.cx - iw / 2, s.y + g.w * 0.03, iw, ih, ih / 2);
    ctx.fill();
    ctx.restore();
}

// A dark screen with a little light in it (the ground for a cut-out or the drawn UI).
function screenGround(e, s, r) {
    const { ctx } = e;
    const g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
    g.addColorStop(0, '#1b1815');
    g.addColorStop(1, '#0a0908');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(s.x, s.y, s.w, s.h, r);
    ctx.fill();
}

// The drawn player: status bar, breathing rings, the session, progress, controls.
function playerUI(e, g) {
    const { ctx } = e;
    const s = g.screen;
    const q = s.w / 100;
    const cx = s.x + s.w / 2;
    screenGround(e, s, g.rIn);
    const rc = s.y + s.h * 0.37;
    glow(e, cx, rc, s.w * 0.55, s.w * 0.55, 0.2);

    // Status bar, level with the island.
    const midY = s.y + g.w * 0.03 + g.w * 0.041;
    const tPx = 4.1 * q;
    drawText(ctx, '9:41', TYPE.brandSB, tPx, s.x + 9 * q, midY + capHeight(ctx, TYPE.brandSB, tPx) / 2, { color: e.ink });
    ctx.save();
    ctx.fillStyle = 'rgba(244,241,234,0.85)';
    const bx = s.x + s.w - 9 * q;
    ctx.strokeStyle = 'rgba(244,241,234,0.6)';
    ctx.lineWidth = Math.max(1, 0.35 * q);
    ctx.beginPath();
    ctx.roundRect(bx - 6.4 * q, midY - 1.5 * q, 6.4 * q, 3 * q, 0.8 * q);
    ctx.stroke();
    ctx.fillRect(bx - 5.8 * q, midY - 0.95 * q, 4 * q, 1.9 * q);
    for (let i = 0; i < 4; i++) {
        const h = (1 + i * 0.55) * q;
        ctx.fillRect(bx - 16 * q + i * 1.5 * q, midY + 1.5 * q - h, 0.95 * q, h);
    }
    ctx.restore();

    // Breathing rings: fainter as they spread, the inner one in the accent.
    const R = 29 * q;
    ring(ctx, cx, rc, R, 'rgba(244,241,234,0.08)', Math.max(1, 0.35 * q));
    ring(ctx, cx, rc, R * 0.8, 'rgba(244,241,234,0.13)', Math.max(1, 0.35 * q));
    ctx.save();
    ctx.globalAlpha = 0.16;
    dot(ctx, cx, rc, R * 0.58, e.accent);
    ctx.restore();
    ring(ctx, cx, rc, R * 0.58, e.accent, Math.max(1, 0.5 * q));
    dot(ctx, cx + R * 0.8 * Math.cos(-0.9), rc + R * 0.8 * Math.sin(-0.9), 1.1 * q, e.accent);

    // The session.
    const title = String(e.fields.screenTitle ?? '').trim();
    const meta = String(e.fields.screenMeta ?? '').trim();
    let y = s.y + s.h * 0.62;
    if (title) {
        let px = 8.4 * q;
        const tw = textWidth(ctx, title, TYPE.serif, px);
        if (tw > s.w * 0.84) px *= (s.w * 0.84) / tw;
        e.mark('screenTitle', drawText(ctx, title, TYPE.serif, px, cx, y, { align: 'center', color: e.ink }));
    }
    if (meta) {
        let px = 3.3 * q;
        const mw = textWidth(ctx, meta.toUpperCase(), TYPE.monoR, px, 0.14);
        if (mw > s.w * 0.84) px *= (s.w * 0.84) / mw;
        y += 7.2 * q;
        e.mark('screenMeta', drawText(ctx, meta.toUpperCase(), TYPE.monoR, px, cx, y, { align: 'center', tracking: 0.14, color: DIM }));
    }

    // Progress.
    const py = s.y + s.h * 0.765;
    const px0 = s.x + 11 * q;
    const px1 = s.x + s.w - 11 * q;
    const at = px0 + (px1 - px0) * 0.36;
    ctx.save();
    ctx.fillStyle = 'rgba(244,241,234,0.16)';
    ctx.fillRect(px0, py - 0.25 * q, px1 - px0, 0.5 * q);
    ctx.fillStyle = e.ink;
    ctx.fillRect(px0, py - 0.25 * q, at - px0, 0.5 * q);
    ctx.restore();
    dot(ctx, at, py, 1.3 * q, e.ink);
    drawText(ctx, '04:12', TYPE.monoR, 2.6 * q, px0, py + 5 * q, { color: DIM });
    drawText(ctx, '–07:48', TYPE.monoR, 2.6 * q, px1, py + 5 * q, { align: 'right', color: DIM });

    // Controls: back 15, pause, forward 15.
    const cy = s.y + s.h * 0.875;
    ring(ctx, cx, cy, 7 * q, 'rgba(244,241,234,0.55)', Math.max(1, 0.4 * q));
    ctx.save();
    ctx.fillStyle = e.ink;
    ctx.fillRect(cx - 2 * q, cy - 2.6 * q, 1.2 * q, 5.2 * q);
    ctx.fillRect(cx + 0.8 * q, cy - 2.6 * q, 1.2 * q, 5.2 * q);
    ctx.restore();
    [-1, 1].forEach((d) => {
        const x = cx + d * 21 * q;
        ctx.save();
        ctx.strokeStyle = 'rgba(244,241,234,0.5)';
        ctx.lineWidth = Math.max(1, 0.4 * q);
        ctx.beginPath();
        ctx.arc(x, cy, 3.6 * q, d < 0 ? -Math.PI * 0.35 : -Math.PI * 0.65, d < 0 ? Math.PI * 1.3 : -Math.PI * 2.3, d > 0);
        ctx.stroke();
        ctx.restore();
        drawText(ctx, '15', TYPE.monoR, 2.3 * q, x, cy + 0.8 * q, { align: 'center', color: 'rgba(244,241,234,0.6)' });
    });
    // Home indicator.
    ctx.save();
    ctx.fillStyle = 'rgba(244,241,234,0.5)';
    ctx.beginPath();
    ctx.roundRect(cx - 17 * q, s.y + s.h - 3.4 * q, 34 * q, 1.1 * q, 0.55 * q);
    ctx.fill();
    ctx.restore();
    e.mark('product', g.screen);
}

/**
 * The phone and what's on it. With a product shot, the photo (if any) has
 * already gone behind everything; without one, the photo fills the screen.
 */
function phone(e, g, k) {
    const s = g.screen;
    glow(e, g.cx, g.y + g.h * 0.45, g.w * 1.25, g.h * 0.62, 0.2);
    if (hasProduct(e)) {
        screenGround(e, s, g.rIn);
        // A rectangle (a screenshot) fills the screen; a cut-out is staged on it.
        if (framedShot(e)) productShot(e, s, { stage: false, radius: 0 });
        else {
            glow(e, g.cx, s.y + s.h * 0.48, s.w * 0.55, s.w * 0.55, 0.22);
            glow(e, g.cx, s.y + s.h * 0.48, s.w * 0.4, s.w * 0.4, 0.1, '#FFF6E6');
            const img = e.asset('product');
            const bh = Math.min(s.h * 0.52, (s.w * 0.76 * img.height) / img.width);
            productShot(e, { x: s.x + s.w * 0.12, y: s.y + s.h * 0.48 - bh / 2, w: s.w * 0.76, h: bh }, { stage: false });
        }
    } else if (e.hasMedia) {
        e.photo(s);
    } else {
        playerUI(e, g);
    }
    bezel(e, g);
    // A hairline round the whole phone keeps its edge off a dark ground.
    e.ctx.save();
    e.ctx.strokeStyle = HAIR;
    e.ctx.lineWidth = Math.max(1, 1.1 * k);
    e.ctx.beginPath();
    e.ctx.roundRect(g.x - 1.5 * k, g.y - 1.5 * k, g.w + 3 * k, g.h + 3 * k, g.R + 1.5 * k);
    e.ctx.stroke();
    e.ctx.restore();
}

// The words: kicker, name, feature, then the offer under a short rule and where to get it.
function words(e, x, w, k, { namePx, featPx, maxNameH, align = 'left', tail = true }) {
    const size = e.look.size ?? 1;
    const offer = String(e.fields.offer ?? '').trim();
    const list = [
        lineItem(e, 'kicker', e.fields.kicker, x, { px: 17 * k, spec: TYPE.monoR, maxW: w, align, tracking: 0.18 }),
        blockItem(e, 'name', e.fields.name, x, e.headline, { maxW: w * size, maxH: maxNameH * size, max: namePx * k * size, lines: 2, gap: 0.18 }, { align, color: headColor(e), before: 26 * k }),
        paraItem(e, 'feature', e.fields.feature, x, { px: featPx, maxW: w, maxLines: 4, color: SOFT, align, before: 30 * k }),
    ];
    if (tail) {
        const o = offer ? paraItem(e, 'offer', offer, x, { px: featPx * 0.78, spec: TYPE.brandR, maxW: w, maxLines: 2, color: e.ink, align, before: 70 * k }) : null;
        if (o) {
            const draw = o.draw;
            o.draw = (y) => {
                e.ctx.fillStyle = e.accent;
                const rx = align === 'center' ? x - 18 * k : x;
                e.ctx.fillRect(rx, y - 26 * k, 36 * k, 2.5 * k);
                return draw(y);
            };
        }
        list.push(o, lineItem(e, 'availability', e.fields.availability, x, { px: 15 * k, spec: TYPE.monoR, maxW: w, align, tracking: 0.14, before: (o ? 26 : 70) * k }));
    }
    return list;
}

export default {
    id: 'mind-app-screen',
    name: 'App Screen',
    category: 'Mind',
    section: 'Products',
    blurb: 'A drawn phone with the app on its screen (your screenshot, the photo, or a drawn player), the app’s name in serif and one feature line. For meditation, journal and breathwork apps.',
    refs: 'an App Store product page, printed',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'The app' },
        { key: 'name', label: 'App name', rows: 2, value: 'Northside', hint: '{Braces} colour a word.' },
        { key: 'feature', label: 'One feature line', rows: 3, value: 'Guided sits from three to thirty minutes, and a timer that stays out of the way.', hint: 'What it has and does. Not what it does for you.' },
        { key: 'offer', label: 'Offer', value: 'A year of Premium for 4,800 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'availability', label: 'Where to get it', value: 'iPhone · Android · Free to download' },
        { key: 'screenTitle', label: 'Screen: session name', value: 'Evening sit', hint: 'Shown on the drawn screen when there’s no screenshot or photo.' },
        { key: 'screenMeta', label: 'Screen: detail', value: '12 min · Guided' },
        { key: 'footer', label: 'Small print', value: 'Unlock it in the POWR app' },
        { ...PRODUCT_FIELD, label: 'Screenshot or product shot', hint: 'A screenshot fills the screen. A cut-out product is set on a dark screen.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Meditation', fields: { kicker: 'The app', name: 'Northside', feature: 'Guided sits from three to thirty minutes, and a timer that stays out of the way.', offer: 'A year of Premium for 4,800 POWR points', availability: 'iPhone · Android · Free to download', screenTitle: 'Evening sit', screenMeta: '12 min · Guided', footer: 'Unlock it in the POWR app' } },
        { name: 'Journal app', fields: { kicker: 'New in the app', name: 'Morning Pages', feature: 'A prompt each morning, a page each night, and every entry kept on your phone.', offer: 'Members first in the POWR app', availability: 'iPhone · iPad', screenTitle: 'Morning page', screenMeta: 'Prompt 12 of 90', footer: 'Northside Journal' } },
        { name: 'Breathwork', fields: { kicker: 'Breathwork', name: 'Breathe', feature: 'Box, 4-7-8 and paced breathing, with a gentle haptic on every count.', offer: 'Six months for 3,000 POWR points', availability: 'iPhone · Android · Apple Watch', screenTitle: 'Box breathing', screenMeta: '4 · 4 · 4 · 4', footer: 'Unlock it in the POWR app' } },
        { name: 'Soundscapes', fields: { kicker: 'Sound', name: 'Low Hum', feature: 'Rain, room tone and open-air recordings, looped without a gap and set to fade out.', offer: 'Members first in the POWR app', availability: 'iPhone · Android · Web', screenTitle: 'Rain on glass', screenMeta: '60 min · Loop', footer: 'Northside Sound' } },
    ],
    look: { ...MIND_LOOK, mono: 0.5, tintAmount: 0.45, target: 0.26, vignette: 0.35 },
    fill: { reward: (r) => { const f = productFill(r); return { ...f, offer: f.points }; } },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k } = f;
        ground(e, GROUND);
        // With a product shot, the photo goes behind the whole post.
        if (hasProduct(e) && e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.45);
            if (f.tall) {
                e.fade(0, 0, W, H * 0.45, 'top', 0.8);
                e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.8);
            } else {
                e.fade(0, 0, W * 0.62, H, 'left', 0.85);
                e.fade(0, H * 0.7, W, H * 0.3, 'bottom', 0.6);
            }
        }

        if (f.tall) {
            const footTop = footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
            const w = f.x1 - f.x0;
            const head = words(e, f.x0, w, k, { namePx: 104, featPx: 32 * k, maxNameH: H * 0.12, tail: false });
            const headBottom = stack(head, f.top + 40 * k);
            const tail = words(e, f.x0, w, k, { namePx: 0, featPx: 32 * k, maxNameH: 0 }).slice(3);
            const tailH = stackH(tail);
            const tailTop = footTop - 50 * k - tailH;
            stack(tail, tailTop);
            const pTop = headBottom + 70 * k;
            const pBottom = tailTop - (tail.some(Boolean) ? 30 : 0) * k;
            const g = geom(W / 2, (pTop + pBottom) / 2, w * 0.7, pBottom - pTop);
            phone(e, g, k);
            return;
        }

        if (f.strip) {
            const g = geom(0, 0, W, f.bottom - f.top + 10 * k);
            const gg = geom(f.x0 + 20 * k + g.w / 2, H / 2, W, f.bottom - f.top + 10 * k);
            phone(e, gg, k);
            const x = gg.x + gg.w + 70 * k;
            const w = f.x1 - x;
            const colW = w * 0.56;
            const head = words(e, x, colW, k, { namePx: 76, featPx: 24 * k, maxNameH: (f.bottom - f.top) * 0.34, tail: false });
            const h = stackH(head);
            stack(head, f.top + Math.max(0, (f.bottom - f.top - h) / 2));
            const tx = x + colW + 60 * k;
            const footTop = footRow(e, { x0: tx, x1: f.x1, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            const tail = words(e, tx, f.x1 - tx, k, { namePx: 0, featPx: 22 * k, maxNameH: 0 }).slice(3);
            if (tail[0]) tail[0].before = 26 * k;
            stack(tail, f.top + Math.max(0, (footTop - 30 * k - f.top - stackH(tail)) / 2));
            return;
        }

        // Post, square, landscape: the words left, the phone right.
        const footTop = footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
        const pTop = f.top + (f.sq ? 0 : 10) * k;
        const pBottom = footTop - (f.sq ? 36 : 50) * k;
        const colR = f.wide ? W * 0.62 : f.x0 + (f.x1 - f.x0) * (f.sq ? 0.54 : 0.5);
        const g0 = geom(0, 0, (f.x1 - colR) * (f.wide ? 0.8 : 1), pBottom - pTop);
        const g = geom(f.wide ? (colR + f.x1) / 2 : f.x1 - g0.w / 2 - 10 * k, (pTop + pBottom) / 2, g0.w, g0.h);
        phone(e, g, k);
        const tw = g.x - 70 * k - f.x0;
        const list = words(e, f.x0, tw, k, { namePx: f.wide ? 120 : f.sq ? 96 : 110, featPx: (f.sq ? 28 : 32) * k, maxNameH: H * (f.wide ? 0.26 : 0.2) });
        const h = stackH(list);
        stack(list, pTop + Math.max(0, (pBottom - pTop - h) / 2));
    },
};
