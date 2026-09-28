/**
 * HYDRATION — a water tracker: a row of drawn glasses (or bottles), each
 * filled to its level in the accent, the day's total big ("2.4 L") and a
 * day line. Works with no photo. For hydration and electrolyte brands, and
 * gyms with a water station worth talking about.
 */
import { TYPE } from '../../../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines } from '../../../text';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { LOOK, INK, SOFT, GREY, lift, fitPx, alpha, num } from './_parts';

// One vessel's outline as a path in the box (x, y, w, h).
function vessel(ctx, kind, x, y, w, h) {
    ctx.beginPath();
    if (kind === 'bottle') {
        const bw = w * 0.84;
        const bx = x + (w - bw) / 2;
        const neckW = bw * 0.46;
        const nx = x + (w - neckW) / 2;
        const shoulder = y + h * 0.26;
        const r = bw * 0.18;
        ctx.moveTo(nx, y + h * 0.1);
        ctx.lineTo(nx, y + h * 0.16);
        ctx.quadraticCurveTo(bx, y + h * 0.18, bx, shoulder);
        ctx.lineTo(bx, y + h - r);
        ctx.quadraticCurveTo(bx, y + h, bx + r, y + h);
        ctx.lineTo(bx + bw - r, y + h);
        ctx.quadraticCurveTo(bx + bw, y + h, bx + bw, y + h - r);
        ctx.lineTo(bx + bw, shoulder);
        ctx.quadraticCurveTo(bx + bw, y + h * 0.18, nx + neckW, y + h * 0.16);
        ctx.lineTo(nx + neckW, y + h * 0.1);
        ctx.closePath();
    } else {
        // A tumbler: wider at the lip, a thick base.
        const inset = w * 0.12;
        const r = w * 0.08;
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w - inset, y + h - r);
        ctx.quadraticCurveTo(x + w - inset, y + h, x + w - inset - r, y + h);
        ctx.lineTo(x + inset + r, y + h);
        ctx.quadraticCurveTo(x + inset, y + h, x + inset, y + h - r);
        ctx.closePath();
    }
}

// The row: `filled` of `total` (a half fills halfway), left to right.
function row(e, x, y, w, h, U, { kind }) {
    const { ctx } = e;
    const acc = lift(e.accent);
    const total = Math.round(Math.min(12, Math.max(3, num(e.fields.total) || 8)));
    const filled = Math.min(total, Math.max(0, num(e.fields.filled)));
    const gap = Math.min((w / total) * 0.42, 44 * U);
    let gw = (w - gap * (total - 1)) / total;
    let gh = gw * (kind === 'bottle' ? 2.1 : 1.55);
    if (gh > h) { gh = h; gw = gh / (kind === 'bottle' ? 2.1 : 1.55); }
    const rowW = gw * total + gap * (total - 1);
    const x0 = x;
    const lw = Math.max(1.5, 2.6 * U);
    for (let i = 0; i < total; i++) {
        const gx = x0 + i * (gw + gap);
        const gy = y + h - gh;
        const level = Math.min(1, Math.max(0, filled - i));
        if (level > 0) {
            ctx.save();
            vessel(ctx, kind, gx, gy, gw, gh);
            ctx.clip();
            const top = kind === 'bottle' ? gy + gh * 0.2 : gy + gh * 0.1;
            const wy = gy + gh - (gy + gh - top) * level * 0.94;
            ctx.fillStyle = alpha(acc, 0.88);
            ctx.beginPath();
            ctx.moveTo(gx - 2, wy);
            ctx.quadraticCurveTo(gx + gw * 0.25, wy - gh * 0.025, gx + gw * 0.5, wy);
            ctx.quadraticCurveTo(gx + gw * 0.75, wy + gh * 0.025, gx + gw + 2, wy);
            ctx.lineTo(gx + gw + 2, gy + gh + 2);
            ctx.lineTo(gx - 2, gy + gh + 2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.save();
        vessel(ctx, kind, gx, gy, gw, gh);
        ctx.strokeStyle = level > 0 ? alpha(INK, 0.85) : alpha(INK, 0.38);
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.stroke();
        if (kind === 'bottle') {
            // The cap.
            const cw = gw * 0.84 * 0.52;
            ctx.fillStyle = level > 0 ? alpha(INK, 0.85) : alpha(INK, 0.38);
            ctx.fillRect(gx + (gw - cw) / 2, gy, cw, gh * 0.08);
        }
        ctx.restore();
    }
    e.mark('filled', { x: x0, y: y + h - gh, w: rowW, h: gh });
    return { x: x0, y: y + h - gh, w: rowW, h: gh };
}

// The stat: the number huge and light, its unit smaller beside it.
function stat(e, x, top, w, maxH, U) {
    const { ctx } = e;
    const lines = splitLines(e.fields.stat).slice(0, 1);
    const block = fitBlock(ctx, lines, e.headline, { maxW: w * (e.look.size ?? 1), maxH: maxH * (e.look.size ?? 1), tracking: -0.02 });
    e.shade({ x, y: top, w: w * 0.8, h: block.cap }, { ceiling: 0.2, max: 0.72 });
    const b = drawBlock(ctx, block, e.headline, x, top, { tracking: -0.02, color: e.headlineAccent ? lift(e.accent) : INK, accent: lift(e.accent) });
    e.mark('stat', blockBox(b));
    return top + block.cap;
}

function words(e, x, y, w, U, { kPx = 18, lPx = 34, maxLines = 2 } = {}) {
    const { ctx } = e;
    const k = e.caps(e.fields.kicker).trim();
    const lines = wrapLines(ctx, e.fields.line, TYPE.brandL, lPx * U, w, maxLines);
    const kH = k ? kPx * U * 0.75 + 22 * U : 0;
    const lH = lines.length ? lPx * U * 0.75 + (lines.length - 1) * lPx * U * 1.2 : 0;
    e.shade({ x, y, w: w * 0.8, h: kH + lH }, { ceiling: 0.26, max: 0.6 });
    if (k) e.mark('kicker', drawText(ctx, k, TYPE.mono, fitPx(ctx, k, TYPE.mono, kPx * U, w, 0.18), x, y + kPx * U * 0.75, { tracking: 0.18, color: lift(e.accent) }));
    if (lines.length) e.mark('line', drawText(ctx, lines.join('\n'), TYPE.brandL, lPx * U, x, y + kH + lPx * U * 0.75, { color: SOFT, leading: 1.2 }));
    return y + kH + lH;
}

function day(e, x, base, w, U, align = 'left') {
    const t = String(e.fields.day ?? '').trim();
    if (!t) return;
    const px = 18 * U;
    e.mark('day', drawText(e.ctx, e.caps(t), TYPE.mono, fitPx(e.ctx, e.caps(t), TYPE.mono, px, w, 0.18), x, base, { align, tracking: 0.18, color: GREY }));
}

export default {
    id: 'hydration',
    name: 'Hydration',
    category: 'Eat',
    blurb: 'A water tracker: a row of drawn glasses filled in the accent, the day’s litres big. For hydration brands and gyms.',
    refs: 'a habit-tracker widget, set large',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'Water · Today' },
        { key: 'stat', label: 'The number', value: '2.4 L', hint: '{Braces} colour part of it.' },
        { key: 'line', label: 'Line', value: 'Keep the bottle close.' },
        { key: 'filled', label: 'Glasses filled', value: '6', hint: 'Halves work: 5.5 fills the sixth halfway.' },
        { key: 'total', label: 'Glasses in the row', value: '8', hint: '3 to 12.' },
        { key: 'day', label: 'Day line', value: 'Tuesday · 6 of 8 glasses' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Glasses', fields: {} },
        { name: 'Electrolytes', fields: { kicker: 'Northside Hydrate · Training day', stat: '3 of 4', line: 'One sachet a bottle. Lemon & lime.', filled: '3', total: '4', day: 'Long run Sunday · 750ml bottles' }, style: { accent: '#7FD4F0' } },
        { name: 'Gym water station', fields: { kicker: 'The water station · Level 1', stat: '1,860 L', line: 'Refilled on the gym floor this week. No plastic.', filled: '9.5', total: '12', day: 'Filtered, chilled, free · Next to the racks' } },
        { name: 'Half-day check', fields: { kicker: 'Midday check-in', stat: '1.2 L', line: 'Halfway there. Top it up before the session.', filled: '4', total: '8', day: 'Wednesday · 12:30' } },
    ],
    look: { ...LOOK, target: 0.26, tint: 'cool', tintAmount: 0.12, glyph: 'glass' },
    controls: [
        { key: 'glyph', label: 'Glyph', options: [['glass', 'Glasses'], ['bottle', 'Bottles']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { W, H, u, tu, safe, shape } = e;
        const kind = e.look.glyph === 'bottle' ? 'bottle' : 'glass';
        e.photo({ x: 0, y: 0, w: W, h: H });
        if (shape === 'wide' || shape === 'strip') {
            const strip = shape === 'strip';
            const U = strip ? tu * 0.9 : tu;
            e.fade(0, 0, W, H, 'left', 0.8);
            e.fade(0, H * 0.4, W, H * 0.6, 'bottom', 0.7);
            const x = safe.l + 4 * U;
            const colW = W * (strip ? 0.3 : 0.4);
            const lk = lockup(e, x, safe.t, (strip ? 26 : 40) * U, { maxW: colW });
            if (strip) {
                const sb = stat(e, x, lk.y + lk.h + 44 * U, colW, H - safe.b - (lk.y + lk.h + 44 * U) - 50 * U, U);
                day(e, x, Math.max(sb + 40 * U, H - safe.b), colW, U);
                const rx = x + colW + 60 * U;
                words(e, rx, safe.t, W - safe.r - rx, U, { lPx: 28, maxLines: 1 });
                row(e, rx, H * 0.45, W - safe.r - rx, H - safe.b - H * 0.45, U, { kind });
                return;
            }
            const wb = words(e, x, lk.y + lk.h + 60 * U, colW, U);
            stat(e, x, wb + 50 * U, colW, H * 0.3, U);
            day(e, x, H - safe.b, colW, U);
            const rx = x + colW + 90 * U;
            row(e, rx, safe.t + H * 0.12, W - safe.r - rx, H - safe.b - safe.t - H * 0.24, U, { kind });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.fade(0, 0, W, H * 0.4, 'top', 0.7);
        e.fade(0, H * 0.35, W, H * 0.65, 'bottom', 0.9);
        const x = safe.l + 6 * u;
        const w = W - safe.r - 6 * u - x;
        const lk = lockup(e, x, safe.t + 6 * u, 44 * u, { maxW: w });
        const wb = words(e, x, lk.y + lk.h + (tall ? 70 : 50) * u, w * 0.8, u);
        const dayBase = H - safe.b - 6 * u;
        day(e, x, dayBase, w, u);
        const rowH = (tall ? 220 : sq ? 150 : 190) * u;
        const r = row(e, x, dayBase - 44 * u - rowH, w, rowH, u, { kind });
        const sTop = wb + (tall ? 90 : 60) * u;
        stat(e, x, Math.max(sTop, r.y - 80 * u - H * (tall ? 0.15 : 0.19)), w, Math.min(H * (tall ? 0.15 : 0.19), r.y - 80 * u - sTop), u);
    },
};
