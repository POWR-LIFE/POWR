/**
 * MANIFESTO — a stacked statement top left, then a flow of words stepping
 * down the frame joined by curved arrows (Show up → Check in → Earn →
 * Repeat), over a heavily blurred, grainy photo. After "From the first
 * squat to forever".
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, textWidth } from '../text';

function arrow(ctx, from, to, u, color, kind = 'down') {
    // Down, then round the corner and in towards the next word — an L drawn
    // by hand, finished with an open arrowhead. 'across' is a shallow S for
    // the strip layout.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (kind === 'across') {
        const mx = (from.x + to.x) / 2;
        ctx.bezierCurveTo(mx, from.y, mx, to.y, to.x, to.y);
    } else {
        ctx.bezierCurveTo(from.x, to.y - (to.y - from.y) * 0.1, from.x + (to.x - from.x) * 0.25, to.y, to.x, to.y);
    }
    ctx.stroke();
    const a = 11 * u;
    ctx.beginPath();
    ctx.moveTo(to.x - a, to.y - a * 0.75);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(to.x - a, to.y + a * 0.75);
    ctx.stroke();
    ctx.restore();
}

// Banner strip: statement left, the flow running left to right.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.5, H, 'left', 0.5);
    const x0 = safe.l + 10 * tu;
    const lines = splitLines(e.caps(e.fields.headline)).slice(0, 4);
    const block = fitBlock(ctx, lines, e.headline, { maxW: W * 0.32 * (e.look.size ?? 1), maxH: H * 0.66 * (e.look.size ?? 1), tracking: -0.03, gap: 0.1 });
    const blockH = block.cap + (lines.length - 1) * block.step;
    const heads = drawBlock(ctx, block, e.headline, x0, (H - blockH) / 2, { align: 'left', tracking: -0.03, color: e.ink, accent: e.accent });
    e.mark('headline', blockBox(heads));
    const steps = splitLines(e.caps(e.fields.flow)).slice(0, 5);
    const px = 24 * tu;
    const xs = W * 0.42;
    const xe = W - safe.r - 20 * tu;
    const widths = steps.map((s) => textWidth(ctx, s, TYPE.grotesk, px, 0.01));
    const gapW = steps.length > 1 ? (xe - xs - widths.reduce((a, b) => a + b, 0)) / (steps.length - 1) : 0;
    let x = xs;
    let box = null;
    steps.forEach((s, i) => {
        const y = H / 2 + (i % 2 ? 22 : -22) * tu;
        e.shade({ x, y: y - px * 0.75, w: widths[i], h: px }, { ceiling: 0.3, max: 0.6, spread: 1.3 });
        const b = drawText(ctx, s, TYPE.grotesk, px, x, y, { tracking: 0.01, color: e.ink });
        if (b) box = box ? { x: box.x, y: Math.min(box.y, b.y), w: b.x + b.w - box.x, h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b;
        if (i < steps.length - 1) {
            const ny = H / 2 + ((i + 1) % 2 ? 22 : -22) * tu;
            arrow(ctx, { x: x + widths[i] + 12 * tu, y: y - px * 0.36 }, { x: x + widths[i] + gapW - 12 * tu, y: ny - px * 0.36 }, tu, 'rgba(244,241,234,0.78)', 'across');
        }
        x += widths[i] + gapW;
    });
    e.mark('flow', box);
    e.logo(e.ink, W - safe.r - 56 * tu, safe.t, 56 * tu);
}

export default {
    id: 'manifesto',
    name: 'Manifesto',
    category: 'Brand',
    blurb: 'A stacked statement and a flow of words joined by hand-drawn arrows.',
    refs: 'First Squat',
    headlineFont: 'groteskX',
    fields: [
        { key: 'headline', label: 'Statement', rows: 4, value: 'From the\nfirst rep\nto forever.' },
        { key: 'flow', label: 'Flow (one per line)', rows: 4, value: 'Show up\nCheck in\nEarn\nRepeat', hint: 'Two to five steps read best.' },
    ],
    presets: [
        { name: 'The loop', fields: { headline: 'From the\nfirst rep\nto forever.', flow: 'Show up\nCheck in\nEarn\nRepeat' } },
        { name: 'Body & mind', fields: { headline: 'It was never\njust the\nworkout.', flow: 'Body\nMind\nStreak\nBody' } },
        { name: 'Gym floor', fields: { headline: 'Every\nsession\nleaves a mark.', flow: 'Walk in\nTrain\nVerified\nPaid' } },
    ],
    look: {
        mono: 1, target: 0.24, auto: 0.8, contrast: 0.3, crush: 0.1, fade: 0.02,
        tint: 'none', motion: 0.75, angle: 0, focus: 0.35, vignette: 0.55, grain: 0.85, printGrain: 0.06, size: 1,
    },

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.45, 'top', 0.4);

        const x0 = safe.l + 36 * u;
        const size = e.look.size ?? 1;
        const lines = splitLines(e.caps(e.fields.headline)).slice(0, 6);
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: W * 0.62 * size, maxH: H * (tall ? 0.24 : sq ? 0.3 : 0.3) * size, tracking: -0.03, gap: 0.1,
        });
        const top = safe.t + (tall ? 30 : 46) * u;
        const heads = drawBlock(ctx, block, e.headline, x0, top, { align: 'left', tracking: -0.03, color: e.ink, accent: e.accent });
        e.mark('headline', blockBox(heads));
        const headBottom = heads[heads.length - 1].baseline;

        // ── Flow ───────────────────────────────────────────────────────────
        const steps = splitLines(e.caps(e.fields.flow)).slice(0, 5);
        const px = (sq ? 24 : 27) * u;
        const n = steps.length;
        const yA = headBottom + H * (tall ? 0.1 : sq ? 0.11 : 0.12);
        const yB = H - safe.b - (tall ? 90 : 70) * u;
        const xA = x0 - 4 * u;
        const xB = W * (sq ? 0.66 : 0.64);
        const pts = steps.map((_, i) => {
            const t = n > 1 ? i / (n - 1) : 0;
            return { x: xA + (xB - xA) * t, y: yA + (yB - yA) * t };
        });
        let box = null;
        steps.forEach((s, i) => {
            const sw = textWidth(ctx, s, TYPE.grotesk, px, 0.01);
            e.shade({ x: pts[i].x, y: pts[i].y - px * 0.75, w: sw, h: px }, { ceiling: 0.3, max: 0.6, spread: 1.3 });
        });
        steps.forEach((s, i) => {
            const b = drawText(ctx, s, TYPE.grotesk, px, pts[i].x, pts[i].y, { tracking: 0.01, color: e.ink });
            if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b;
            if (i < n - 1) {
                const w = textWidth(ctx, s, TYPE.grotesk, px, 0.01);
                const from = { x: pts[i].x + Math.min(w * 0.25, 40 * u), y: pts[i].y + 16 * u };
                const to = { x: pts[i + 1].x - 16 * u, y: pts[i + 1].y - px * 0.36 };
                arrow(ctx, from, to, u, 'rgba(244,241,234,0.78)');
            }
        });
        e.mark('flow', box);

        e.logo(e.ink, W - safe.r - 86 * u, H - safe.b - 64 * u, 82 * u);
    },
};
