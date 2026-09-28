/**
 * SESSION — POWR's own "verified session" card over a full-bleed photo: the
 * earn moment. A rounded card with a hairline border, the activity and a
 * verified tick, the points in the accent at ultra-light weight, then
 * duration · venue · date. Set in the app's card language.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth, splitLines, fitBlock, drawBlock, blockBox } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, HAIR, topRow, mono, unitOf, fitPx, rrect, onAccent, splitUnit } from './_parts';

// The verified badge: an accent disc with a tick, then the word. (x, cy) is
// the disc's left edge and centre line; `align: 'right'` ends at x. Returns the box.
function verified(e, x, cy, r, px, align = 'left') {
    const { ctx } = e;
    const word = e.caps(e.fields.verified ?? '').trim();
    const tw = word ? textWidth(ctx, word, TYPE.mono, px, 0.16) : 0;
    const gap = word ? r * 0.8 : 0;
    const w = r * 2 + gap + tw;
    const left = align === 'right' ? x - w : x;
    ctx.save();
    ctx.fillStyle = e.accent;
    ctx.beginPath();
    ctx.arc(left + r, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = onAccent(e.accent);
    ctx.lineWidth = r * 0.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(left + r * 0.52, cy + r * 0.02);
    ctx.lineTo(left + r * 0.86, cy + r * 0.36);
    ctx.lineTo(left + r * 1.5, cy - r * 0.34);
    ctx.stroke();
    ctx.restore();
    if (word) e.mark('verified', drawText(ctx, word, TYPE.mono, px, left + r * 2 + gap, cy + capHeight(ctx, TYPE.mono, px) / 2, { tracking: 0.16, color: SOFT }));
    return { x: left, y: cy - r, w, h: r * 2 };
}

// "+96" huge and light in the accent, "points" beside it. Returns the box.
function points(e, x, base, px, maxW) {
    const { ctx } = e;
    const [v, un] = splitUnit(e.fields.points);
    const spec = TYPE.brandXL;
    const uPx = px * 0.24;
    const vw = textWidth(ctx, v, spec, px, -0.03);
    const uw = un ? textWidth(ctx, un, TYPE.brandR, uPx, 0) + px * 0.1 : 0;
    const s = vw + uw > maxW ? maxW / (vw + uw) : 1;
    const p = px * s;
    drawText(ctx, v, spec, p, x - p * 0.04, base, { tracking: -0.03, color: e.accent });
    if (un) drawText(ctx, un, TYPE.brandR, uPx * s, x - p * 0.04 + vw * s + p * 0.1, base, { color: SOFT });
    const box = { x, y: base - capHeight(ctx, spec, p), w: (vw + uw) * s, h: capHeight(ctx, spec, p) };
    e.mark('points', box);
    return box;
}

const details = (e) => [['duration', 'Duration'], ['venue', 'Venue'], ['date', 'Date']]
    .map(([k, l]) => [k, l, String(e.fields[k] ?? '').trim()])
    .filter(([, , v]) => v);

// Duration · Venue · Date as labelled columns across x0..x1 from `top`.
function detailRow(e, x0, x1, top, px, labPx) {
    const { ctx } = e;
    const k = unitOf(e);
    const items = details(e);
    if (!items.length) return top;
    // The venue usually needs the most room.
    const weights = items.map(([key]) => (key === 'venue' ? 1.5 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = x0;
    const cap = capHeight(ctx, TYPE.brandR, px);
    items.forEach(([key, lab, v], i) => {
        const w = ((x1 - x0) * weights[i]) / total;
        mono(e, lab, x, top + labPx * 0.75, labPx, { color: GREY, maxW: w - 18 * k });
        e.mark(key, drawText(ctx, v, TYPE.brandR, fitPx(ctx, v, TYPE.brandR, px, w - 22 * k), x, top + labPx + 14 * k + cap, { color: e.ink }));
        x += w;
    });
    return top + labPx + 14 * k + cap;
}

// The card itself at (x, y, w, h). Content is laid out top-down inside it.
function card(e, x, y, w, h, { pad, actPx, bigPx, px, labPx, r }) {
    const { ctx } = e;
    const k = unitOf(e);
    ctx.save();
    rrect(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(14,14,13,0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.16)';
    ctx.lineWidth = Math.max(1, 1.5 * k);
    ctx.stroke();
    ctx.restore();
    const ix0 = x + pad;
    const ix1 = x + w - pad;
    // Row 1: activity left, verified right.
    const rowY = y + pad + actPx * 0.5;
    const badge = verified(e, ix1, rowY, actPx * 0.62, actPx * 0.56, 'right');
    const act = String(e.fields.activity ?? '').trim();
    e.mark('activity', drawText(ctx, act, TYPE.brandSB, fitPx(ctx, act, TYPE.brandSB, actPx, badge.x - ix0 - 30 * k), ix0, rowY + capHeight(ctx, TYPE.brandSB, actPx) / 2, { color: e.ink }));
    // Row 3 (bottom): details. Row 2: the points, centred in what's between.
    const detH = labPx + 14 * k + capHeight(ctx, TYPE.brandR, px);
    const detTop = y + h - pad - detH;
    const ruleY = detTop - pad * 0.7;
    rule(ctx, ix0, ruleY, ix1, ruleY, HAIR, Math.max(1, 1.2 * k));
    detailRow(e, ix0, ix1, detTop, px, labPx);
    const top = rowY + actPx * 0.5;
    const room = ruleY - top;
    const bp = Math.min(bigPx, room * 0.9 / 0.72);
    const cap = capHeight(ctx, TYPE.brandXL, bp);
    points(e, ix0, top + (room + cap) / 2, bp, ix1 - ix0);
}

// The headline over the photo (sentence case, light). Returns its box.
function headline(e, x, top, maxW, maxH, align = 'left', { bottom = false } = {}) {
    const lines = splitLines(e.fields.headline).slice(0, 3);
    if (!lines.length) return null;
    const block = fitBlock(e.ctx, lines, e.headline, { maxW, maxH, gap: 0.18 });
    const h = block.cap + (lines.length - 1) * block.step;
    const t = bottom ? top - h : top;
    e.shade({ x, y: t, w: maxW, h }, { ceiling: 0.24, max: 0.66, spread: 1.15 });
    const box = blockBox(drawBlock(e.ctx, block, e.headline, x, t, { align, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent }));
    e.mark('headline', box);
    return box;
}

function banner(e) {
    const { W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.55, H, 'left', 0.7);
    e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.45);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    const size = e.look.size ?? 1;
    const cardX = W * (strip ? 0.5 : 0.52);
    topRow(e, x0, cardX - 60 * k, y0, (strip ? 42 : 56) * k, { px: (strip ? 14 : 16) * k });
    headline(e, x0, y1, (cardX - x0 - 80 * k) * size, (y1 - y0) * (strip ? 0.5 : 0.36) * size, 'left', { bottom: true });
    const ch = strip ? y1 - y0 : Math.min(y1 - y0, (x1 - cardX) * 0.72);
    card(e, cardX, strip ? y0 : (H - ch) / 2, x1 - cardX, ch, strip
        ? { pad: 30 * k, actPx: 24 * k, bigPx: 150 * k, px: 22 * k, labPx: 12 * k, r: 26 * k }
        : { pad: 48 * k, actPx: 36 * k, bigPx: 260 * k, px: 32 * k, labPx: 15 * k, r: 40 * k });
}

export default {
    id: 'session',
    name: 'Session',
    category: 'Move',
    blurb: 'POWR’s verified-session card over the photo: activity, a verified tick, the points earned, duration, venue and date. The earn moment.',
    refs: 'the POWR app’s session card',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Session verified' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Every session\ncounts.' },
        { key: 'activity', label: 'Activity', value: 'Gym session' },
        { key: 'verified', label: 'Verified label', value: 'Verified', hint: 'Beside the tick. Leave empty for the tick alone.' },
        { key: 'points', label: 'Points', value: '+96 points' },
        { key: 'duration', label: 'Duration', value: '1h 12m' },
        { key: 'venue', label: 'Venue', value: 'Northside Gym' },
        { key: 'date', label: 'Date', value: 'Tue 29 Sep' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Gym session (POWR)', fields: { eyebrow: 'Session verified', headline: 'Every session\ncounts.', activity: 'Gym session', points: '+96 points', duration: '1h 12m', venue: 'Northside Gym', date: 'Tue 29 Sep' } },
        { name: 'Early one', fields: { eyebrow: '06:40 · Before work', headline: 'Earned,\nnot given.', activity: 'Strength', points: '+72 points', duration: '54m', venue: 'Northside Gym', date: 'Mon 05 Oct' } },
        { name: 'Run', fields: { eyebrow: 'Run club', headline: 'Out the door.\nIn the app.', activity: 'Outdoor run', points: '+64 points', duration: '48m', venue: 'Canal path', date: 'Sun 04 Oct' } },
        { name: 'Partner gym', fields: { eyebrow: 'Members earn here', headline: 'Train here.\nEarn here.', activity: 'Gym session', points: '+96 points', duration: '1h 05m', venue: 'Northside, Shoreditch', date: 'Every visit' } },
    ],
    look: {
        mono: 1, target: 0.24, auto: 0.85, contrast: 0.42, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.55, vignette: 0.5, grain: 0.45, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), headline: r.value ? `Train. Earn.\n${r.value}${r.unit ? ` ${r.unit}` : ''} at ${r.brand}.` : 'Every session\ncounts.' }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.24, 'top', 0.5);
        e.fade(0, H * 0.4, W, H * 0.6, 'bottom', 0.7);
        topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);

        const ch = H * (tall ? 0.3 : sq ? 0.42 : 0.38);
        const cy = H - safe.b - ch;
        card(e, x0, cy, x1 - x0, ch, {
            pad: (sq ? 40 : 48) * u, actPx: (sq ? 30 : 36) * u, bigPx: (tall ? 280 : sq ? 190 : 240) * u,
            px: (sq ? 27 : 31) * u, labPx: (sq ? 14 : 15) * u, r: (sq ? 34 : 40) * u,
        });
        headline(e, x0, cy - (sq ? 44 : 60) * u, (x1 - x0) * 0.8 * size, H * (tall ? 0.13 : sq ? 0.16 : 0.15) * size, 'left', { bottom: true });
    },
};
