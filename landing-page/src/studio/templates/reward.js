/**
 * REWARD — the offer itself, set like a voucher: the discount huge, with the
 * number in the partner's colour, what it's on underneath, then a perforated
 * rule and the stub (what it costs in points, where to get it, a QR that
 * opens the rewards in the app). Slide two of a partner carousel, or an A5
 * counter card for the partner's shop. Works on charcoal or over a photo.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, textWidth, capHeight, wrapLines } from '../text';
import { drawContained, tinted, inkLuma } from '../assets';
import { dot } from '../shapes';
import { drawQR } from '../qr';
import { wrap, thousands } from '../words';

const GREY = 'rgba(244,241,234,0.62)';
const SOFT = 'rgba(244,241,234,0.86)';
const PERF = 'rgba(244,241,234,0.42)';

// The tear line: dashes between two accent dots.
function perforation(ctx, x1, y1, x2, y2, accent, w) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const inset = w * 9;
    ctx.save();
    ctx.strokeStyle = PERF;
    ctx.lineWidth = w;
    ctx.setLineDash([w * 4.5, w * 3.5]);
    ctx.beginPath();
    ctx.moveTo(x1 + ux * inset, y1 + uy * inset);
    ctx.lineTo(x2 - ux * inset, y2 - uy * inset);
    ctx.stroke();
    ctx.restore();
    dot(ctx, x1, y1, w * 3.2, accent);
    dot(ctx, x2, y2, w * 3.2, accent);
}

// Outlined label, as on the partner series. Returns its size.
function label(e, x, y, px, pad) {
    const { ctx } = e;
    const lab = e.caps(e.fields.label).trim();
    if (!lab) return { w: 0, h: 0 };
    const w = textWidth(ctx, lab, TYPE.brandM, px, 0.24) + pad * 2;
    const h = px * 2.3;
    ctx.save();
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = px * 0.115;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    e.mark('label', drawText(ctx, lab, TYPE.brandM, px, x + pad, y + h / 2 + px * 0.36, { tracking: 0.24, color: e.ink }));
    return { w, h };
}

// The partner's logo (upright) in `box`, or their name set heavy.
function partnerMark(e, box, align) {
    const { ctx } = e;
    const logo = e.asset('logo');
    if (logo) {
        // Auto: a dark logo goes white on the dark ground; a light or
        // colourful one keeps its own colours.
        const mode = e.look.logoColor === 'auto' ? (inkLuma(logo) < 0.35 ? 'white' : 'original') : e.look.logoColor;
        const img = mode === 'white' ? tinted(logo, e.ink) : mode === 'accent' ? tinted(logo, e.accent) : logo;
        e.mark('logo', drawContained(ctx, img, box, { align }));
        return;
    }
    const name = e.caps(e.fields.brand).trim();
    if (!name) return;
    const w100 = textWidth(ctx, name, TYPE.heavy, 100, -0.01);
    const px = Math.min((100 * box.w) / Math.max(1, w100), (100 * box.h * 0.6) / capHeight(ctx, TYPE.heavy, 100));
    const tw = textWidth(ctx, name, TYPE.heavy, px, -0.01);
    const x = align === 'right' ? box.x + box.w - tw : align === 'left' ? box.x : box.x + (box.w - tw) / 2;
    e.mark('brand', drawText(ctx, name, TYPE.heavy, px, x, box.y + box.h / 2 + capHeight(ctx, TYPE.heavy, px) / 2, { tracking: -0.01, color: e.ink }));
}

// QR with its label bar on top; (x, y) is the QR's own top-left.
function qrBlock(e, x, y, q, labPx) {
    const { ctx } = e;
    const text = String(e.fields.qr ?? '').trim();
    if (!text) return;
    const lab = e.fields.qrLabel ?? '';
    if (lab) {
        const bh = labPx * 1.8;
        ctx.fillStyle = '#0B0B0B';
        ctx.fillRect(x, y - bh, q, bh);
        e.mark('qrLabel', drawText(ctx, lab, TYPE.monoR, labPx, x + q / 2, y - bh / 2 + labPx * 0.36, { align: 'center', color: e.ink }));
    }
    drawQR(ctx, text, x, y, q, { fg: '#0B0B0B', bg: e.ink, quiet: 2 });
    e.mark('qr', { x, y, w: q, h: q });
}

// "(unlock for)" over "220 points". Returns the baseline below it.
function detail(e, key, tag, x, y, tagPx, px, spec) {
    const { ctx } = e;
    if (!String(e.fields[key] ?? '').trim()) return y;
    drawText(ctx, tag, TYPE.monoR, tagPx, x, y, { color: GREY });
    const base = y + px * 1.22;
    e.mark(key, drawText(ctx, e.fields[key], spec, px, x, base, { color: e.ink, leading: 1.15 }));
    return base + (splitLines(e.fields[key]).length - 1) * px * 1.15;
}

const hasQR = (e) => String(e.fields.qr ?? '').trim() !== '';

// ── Banners: offer left, the stub to the right of an upright tear ───────────
function side(e) {
    const { ctx, W, H, safe, shape, tu } = e;
    const strip = shape === 'strip';
    const size = e.look.size ?? 1;
    e.photo({ x: 0, y: 0, w: W, h: H });
    const perfX = W * (strip ? 0.6 : 0.62);
    e.fade(perfX - W * 0.2, 0, W * 0.2, H, 'right', 0.72);
    ctx.fillStyle = 'rgba(12,12,11,0.74)';
    ctx.fillRect(perfX, 0, W - perfX, H);
    e.fade(0, 0, W * 0.5, H, 'left', 0.35);
    const x0 = safe.l;
    const y0 = safe.t;
    const y1 = H - safe.b;
    perforation(ctx, perfX, y0 - 6 * tu, perfX, y1 + 6 * tu, e.accent, 2 * tu);

    // Offer side: the label, then the value and the offer as one group,
    // centred in what's left. The offer re-wraps to the width it has here.
    const lab = label(e, x0, y0, (strip ? 15 : 19) * tu, (strip ? 12 : 14) * tu);
    const colW = perfX - x0 - (strip ? 70 : 90) * tu;
    const offPx = (strip ? 18 : 25) * tu;
    const offLead = 1.3;
    // Banners have room for longer lines than the post's: the offer re-wraps to this width.
    const offLines = wrapLines(ctx, e.fields.offer, TYPE.brandR, offPx, colW * (strip ? 1 : 0.8), strip ? 2 : 3);
    const hasOffer = offLines.length > 0;
    const offGap = (strip ? 18 : 40) * tu;
    const offH = hasOffer ? offGap + offPx * 0.75 + (offLines.length - 1) * offPx * offLead : 0;
    const bandTop = y0 + lab.h + (strip ? 18 : 36) * tu;
    const bandBottom = y1 - (strip ? 0 : 30 * tu);
    const lines = splitLines(e.caps(e.fields.value)).slice(0, 2);
    const block = fitBlock(ctx, lines, e.headline, { maxW: colW * size, maxH: (bandBottom - bandTop - offH) * size, gap: 0.1 });
    const valH = block.cap + (lines.length - 1) * block.step;
    const valTop = bandTop + Math.max(0, (bandBottom - bandTop - valH - offH) / 2);
    const heads = drawBlock(ctx, block, e.headline, x0, valTop, { align: 'left', color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
    e.mark('value', blockBox(heads));
    if (hasOffer) {
        const first = valTop + valH + offGap + offPx * 0.75;
        e.mark('offer', drawText(ctx, offLines.join('\n'), TYPE.brandR, offPx, x0 + 2 * tu, first, { color: SOFT, leading: offLead }));
    }

    // Stub side.
    const sx = perfX + (strip ? 40 : 60) * tu;
    const sx1 = W - safe.r;
    const markH = (y1 - y0) * (strip ? 0.34 : 0.2);
    partnerMark(e, { x: sx, y: y0, w: sx1 - sx, h: markH }, 'left');
    const tagPx = (strip ? 13 : 17) * tu;
    let y = y0 + markH + (strip ? 30 : 64) * tu;
    y = detail(e, 'cost', '(unlock for)', sx, y, tagPx, (strip ? 26 : 38) * tu, TYPE.brandSB);
    if (!strip || y1 - y > 60 * tu) {
        y = detail(e, 'where', '(in)', sx, y + (strip ? 30 : 48) * tu, tagPx, (strip ? 20 : 28) * tu, TYPE.brandR);
    }
    const logoW = (strip ? 52 : 72) * tu;
    if (!strip && hasQR(e)) {
        const q = Math.round(Math.min((y1 - y0) * 0.36, (sx1 - sx) * 0.44));
        qrBlock(e, sx1 - q, y1 - q, q, 15 * tu);
    }
    e.logo(e.ink, strip ? sx1 - logoW : sx, y1 - logoW * 0.72, logoW);
    if (!strip && String(e.fields.terms ?? '').trim()) {
        e.mark('terms', drawText(ctx, e.fields.terms, TYPE.monoR, 14 * tu, x0 + 2 * tu, y1 + safe.b * 0.45, { color: GREY }));
    }
}

export default {
    id: 'reward',
    name: 'Reward',
    category: 'Partners',
    blurb: 'The offer as a voucher: the discount huge, what it’s on, then a tear-off stub with the points cost and a QR to the app’s rewards.',
    refs: 'a voucher stub',
    headlineFont: 'anton',
    photo: 'optional',
    fields: [
        { key: 'label', label: 'Label', value: 'POWR reward' },
        { key: 'logo', label: 'Partner logo', type: 'image', hint: 'PNG with transparency is best. A logo on plain white or black is cleaned up automatically.' },
        { key: 'brand', label: 'Partner name (shown if there’s no logo)', value: 'Partner' },
        { key: 'value', label: 'The offer, big', rows: 2, value: '{20%} off', hint: 'A number and a word. {Braces} put it in the accent colour; a new line stacks it.' },
        { key: 'offer', label: 'What it’s on', rows: 3, value: 'Across the whole range —\nunlocked with the points\nyou earn training.' },
        { key: 'cost', label: '(unlock for)', value: '200 points' },
        { key: 'where', label: '(in)', value: 'The POWR app' },
        { key: 'qrLabel', label: 'QR label', value: 'Scan to unlock' },
        { key: 'qr', label: 'QR link', value: 'https://powr.life/app?to=rewards', hint: 'Opens the rewards in the app. Leave empty to drop the QR.' },
        { key: 'terms', label: 'Small print', value: 'T&Cs apply · While stocks last' },
    ],
    presets: [
        { name: 'Percent off', fields: { value: '{20%} off' } },
        { name: 'Money off', fields: { value: '{£10} off' } },
        { name: 'Free', fields: { value: '{Free}\ncoffee', offer: 'On us, after your\nnext session.' } },
        { name: 'Stacked', fields: { value: '{50%}\noff' } },
    ],
    look: {
        mono: 1, target: 0.2, auto: 0.85, contrast: 0.4, crush: 0.15, fade: 0,
        tint: 'none', motion: 0.15, angle: 0, focus: 0.6, vignette: 0.6, grain: 0.45, printGrain: 0.035, size: 1,
        logoColor: 'auto',
    },
    controls: [
        { key: 'logoColor', label: 'Logo colour', options: [['auto', 'Auto'], ['original', 'Original'], ['white', 'White'], ['accent', 'Accent']] },
    ],

    // The words a reward gives it (see data.js for the reward's facts).
    fill: {
        reward: (r) => ({
            brand: r.brand,
            value: r.value ? `{${r.value}}${r.unit ? ` ${r.unit}` : ''}` : r.brand,
            offer: wrap(r.offer || r.description, 30, 3),
            cost: r.cost ? `${thousands(r.cost)} points` : '',
            terms: r.terms ? wrap(`T&Cs: ${r.terms}`, 64, 1) : 'T&Cs apply',
        }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return side(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = Math.max(safe.l, W * 0.06);
        const x1 = W - x0;

        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.28, 'top', 0.5);

        // The stub: below the tear, on near-black like a torn-off ticket; the
        // light falls off into it from above.
        const stubH = H * (tall ? 0.2 : sq ? 0.27 : 0.25);
        const perfY = H - safe.b - stubH;
        e.fade(0, perfY - H * 0.26, W, H * 0.26, 'bottom', 0.72);
        ctx.fillStyle = 'rgba(12,12,11,0.74)';
        ctx.fillRect(0, perfY, W, H - perfY);

        // ── Top: label left, the partner's mark right ──────────────────────
        const top = safe.t + (tall ? 30 : 16) * u;
        const markH = (tall ? 128 : sq ? 92 : 108) * u;
        const markBox = { x: x1 - W * 0.4, y: top, w: W * 0.4, h: markH };
        e.shade(markBox, { ceiling: 0.3, max: 0.5 });
        partnerMark(e, markBox, 'right');
        const labPx = (sq ? 19 : 21) * u;
        label(e, x0, top + (markH - labPx * 2.3) / 2, labPx, 16 * u);

        // ── The offer, bottom-up from the tear ─────────────────────────────
        const offPx = (sq ? 27 : tall ? 34 : 31) * u;
        const offLead = 1.32;
        const offLines = splitLines(e.fields.offer).slice(0, 3);
        const hasOffer = offLines.join('').trim() !== '';
        const offLast = perfY - (sq ? 46 : 58) * u;
        const offFirst = offLast - (offLines.length - 1) * offPx * offLead;
        const barY = hasOffer ? offFirst - offPx * 0.75 - (sq ? 28 : 36) * u : offLast;
        const valBottom = barY - (sq ? 30 : 38) * u;

        const lines = splitLines(e.caps(e.fields.value)).slice(0, 2);
        const room = valBottom - (top + markH + (sq ? 30 : 50) * u);
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: (x1 - x0) * size,
            maxH: Math.min(H * (tall ? 0.36 : sq ? 0.27 : 0.31), room) * size,
            gap: 0.1,
        });
        const valTop = valBottom - block.cap - (lines.length - 1) * block.step;
        e.shade({ x: x0, y: valTop, w: x1 - x0, h: valBottom - valTop }, { ceiling: 0.28, max: 0.6, spread: 0.9 });
        const heads = drawBlock(ctx, block, e.headline, x0, valTop, { align: 'left', color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
        e.mark('value', blockBox(heads));

        if (hasOffer) {
            ctx.fillStyle = e.accent;
            ctx.fillRect(x0 + 4 * u, barY, W * 0.14, 4 * u);
            e.mark('offer', drawText(ctx, offLines.join('\n'), TYPE.brandR, offPx, x0 + 4 * u, offFirst, { color: SOFT, leading: offLead }));
        }

        // ── The stub ───────────────────────────────────────────────────────
        perforation(ctx, x0, perfY, x1, perfY, e.accent, 2 * u);
        const bottom = H - safe.b;
        const q = Math.round(W * (sq ? 0.17 : tall ? 0.2 : 0.19));
        const qr = hasQR(e);
        if (qr) qrBlock(e, x1 - q, bottom - q, q, (sq ? 15 : 17) * u);
        const tagPx = (sq ? 17 : 19) * u;
        const y = perfY + (sq ? 52 : 64) * u;
        const colW = ((qr ? x1 - q - 40 * u : x1) - x0) / 2;
        detail(e, 'cost', '(unlock for)', x0 + 4 * u, y, tagPx, (sq ? 34 : 40) * u, TYPE.brandSB);
        detail(e, 'where', '(in)', x0 + 4 * u + colW, y, tagPx, (sq ? 27 : 31) * u, TYPE.brandR);

        const logoW = (sq ? 64 : 76) * u;
        e.logo(e.ink, x0 + 4 * u, bottom - logoW * 0.72, logoW);
        if (String(e.fields.terms ?? '').trim()) {
            const tPx = (sq ? 14 : 15) * u;
            const lines2 = splitLines(e.fields.terms).slice(0, 2);
            e.mark('terms', drawText(ctx, lines2.join('\n'), TYPE.monoR, tPx, x0 + 4 * u + logoW + 28 * u, bottom - 4 * u - (lines2.length - 1) * tPx * 1.35, { color: GREY, leading: 1.35 }));
        }
    },
};
