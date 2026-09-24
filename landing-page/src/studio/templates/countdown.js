/**
 * COUNTDOWN — a challenge launch: kicker, a huge centred headline with a soft
 * glow, a line, then the day counter ("DAY 1 OF 30") and a three-part footer,
 * over a darkened photo with a faint grid. After the November Challenge post.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox } from '../text';
import { rule } from '../shapes';

// Banner strip: kicker + glowing headline + line on the left, the counter right.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    ctx.fillStyle = 'rgba(8,10,12,0.35)';
    ctx.fillRect(0, 0, W, H);
    const cols = 12;
    for (let i = 1; i < cols; i++) rule(ctx, Math.round((W * i) / cols) + 0.5, 0, Math.round((W * i) / cols) + 0.5, H, 'rgba(244,241,234,0.05)', 1);
    const x0 = safe.l + 8 * tu;
    const kPx = 22 * tu;
    const lines = splitLines(e.caps(e.fields.headline)).slice(0, 2);
    const block = fitBlock(ctx, lines, e.headline, { maxW: W * 0.44 * (e.look.size ?? 1), maxH: H * 0.46 * (e.look.size ?? 1), tracking: -0.02, gap: 0.08 });
    const blockH = block.cap + (lines.length - 1) * block.step;
    const lPx = 20 * tu;
    const total = kPx + 16 * tu + blockH + 20 * tu + lPx;
    const top = (H - total) / 2;
    e.mark('kicker', drawText(ctx, e.caps(e.fields.kicker), TYPE.groteskX, kPx, x0, top + kPx * 0.72, { tracking: -0.01, color: e.ink }));
    ctx.save();
    ctx.shadowColor = 'rgba(244,241,234,0.35)';
    ctx.shadowBlur = 20 * tu;
    const heads = drawBlock(ctx, block, e.headline, x0, top + kPx + 16 * tu, { align: 'left', tracking: -0.02, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
    ctx.restore();
    e.mark('headline', blockBox(heads));
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, lPx, x0, heads[heads.length - 1].baseline + 20 * tu + lPx * 0.72, { color: 'rgba(244,241,234,0.86)' }));
    const day = String(e.fields.day ?? '').trim();
    const of = String(e.fields.of ?? '').trim();
    if (day) {
        const txt = of ? `DAY {${day}} OF ${of}` : `DAY {${day}}`;
        const c = fitBlock(ctx, [txt], TYPE.groteskX, { maxW: W * 0.36, maxH: H * 0.22, tracking: -0.02 });
        const cb = drawBlock(ctx, c, TYPE.groteskX, W - safe.r - 8 * tu, (H - c.cap) / 2, { align: 'right', tracking: -0.02, color: e.ink, accent: e.accent });
        e.mark('day', blockBox(cb));
    }
    e.logo(e.ink, W - safe.r - 52 * tu, safe.t, 52 * tu);
}

export default {
    id: 'countdown',
    name: 'Countdown',
    category: 'Challenges',
    blurb: 'A challenge launch: big centred headline, a day counter, a three-part footer.',
    refs: 'November Challenge',
    headlineFont: 'groteskX',
    fields: [
        { key: 'kicker', label: 'Kicker', value: '30 day gym floor challenge' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Starts\ntoday' },
        { key: 'line', label: 'Line', value: 'Show up. Check in. The streak does the rest.' },
        { key: 'day', label: 'Day', value: '1' },
        { key: 'of', label: 'Out of', value: '30' },
        { key: 'footer', label: 'Footer (three parts)', value: 'Show up · Earn · Repeat', hint: 'Separate the three with · or new lines.' },
    ],
    presets: [
        { name: 'Launch', fields: { kicker: '30 day gym floor challenge', headline: 'Starts\ntoday', day: '1', of: '30' } },
        { name: 'Halfway', fields: { kicker: '30 day gym floor challenge', headline: 'Halfway\nthere', line: 'Fifteen days in. Don’t break it now.', day: '15', of: '30' } },
        { name: 'Final day', fields: { kicker: '30 day gym floor challenge', headline: 'Last\nday', line: 'One more check-in. Then it’s yours.', day: '30', of: '30' } },
    ],
    look: {
        mono: 1, target: 0.2, auto: 0.85, contrast: 0.45, crush: 0.15, fade: 0,
        tint: 'cool', motion: 0.12, angle: 0, focus: 0.6, vignette: 0.6, grain: 0.65, size: 1, counter: 'line',
    },
    controls: [
        { key: 'counter', label: 'Counter', options: [['line', 'Day 1 of 30'], ['big', 'Big number']] },
    ],

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        ctx.fillStyle = 'rgba(8,10,12,0.28)';
        ctx.fillRect(0, 0, W, H);
        e.fade(0, H * 0.55, W, H * 0.45, 'bottom', 0.6);

        // Faint grid, like a monitor overlay.
        const cols = 6;
        const hair = 'rgba(244,241,234,0.055)';
        for (let i = 1; i < cols; i++) rule(ctx, Math.round((W * i) / cols) + 0.5, 0, Math.round((W * i) / cols) + 0.5, H, hair, Math.max(1, u));
        for (let y = W / cols; y < H; y += W / cols) rule(ctx, 0, Math.round(y) + 0.5, W, Math.round(y) + 0.5, hair, Math.max(1, u));

        const logoW = 118 * u;
        e.logo(e.ink, W / 2 - logoW / 2, safe.t + 14 * u, logoW);

        // ── Kicker, headline (glowing), line ───────────────────────────────
        const kPx = (sq ? 32 : 38) * u;
        const kTop = tall ? H * 0.27 : sq ? H * 0.22 : H * 0.25;
        e.mark('kicker', drawText(ctx, e.caps(e.fields.kicker), TYPE.groteskX, kPx, W / 2, kTop + kPx * 0.72, {
            align: 'center', tracking: -0.01, color: e.ink,
        }));

        const size = e.look.size ?? 1;
        const lines = splitLines(e.caps(e.fields.headline)).slice(0, 3);
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: W * 0.9 * size, maxH: H * (tall ? 0.26 : sq ? 0.3 : 0.3) * size, tracking: -0.02, gap: 0.08,
        });
        const hTop = kTop + kPx + 26 * u;
        ctx.save();
        ctx.shadowColor = 'rgba(244,241,234,0.38)';
        ctx.shadowBlur = 26 * u;
        const heads = drawBlock(ctx, block, e.headline, W / 2, hTop, {
            align: 'center', tracking: -0.02, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent,
        });
        ctx.restore();
        e.mark('headline', blockBox(heads));
        const hBottom = heads[heads.length - 1].baseline;

        const lPx = (sq ? 26 : 30) * u;
        const lBase = hBottom + 34 * u + lPx * 0.72;
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, lPx, W / 2, lBase, {
            align: 'center', color: 'rgba(244,241,234,0.86)',
        }));

        // ── Counter ────────────────────────────────────────────────────────
        const day = String(e.fields.day ?? '').trim();
        const of = String(e.fields.of ?? '').trim();
        const footTop = H - safe.b - 40 * u;
        if (day) {
            if (e.look.counter === 'big') {
                const smallPx = (sq ? 24 : 28) * u;
                // Whatever room is left between the line and the footer.
                const room = footTop - 60 * u - smallPx - (lBase + 44 * u + smallPx + 22 * u);
                const nBlock = fitBlock(ctx, [`{${day}}`], TYPE.groteskX, { maxW: W * 0.5, maxH: Math.max(40 * u, Math.min(H * (tall ? 0.16 : 0.18), room)), tracking: -0.04 });
                const nTop = footTop - 60 * u - smallPx - nBlock.cap;
                drawText(ctx, 'DAY', TYPE.groteskX, smallPx, W / 2, nTop - 22 * u, { align: 'center', tracking: 0.2, color: e.ink });
                const nb = drawBlock(ctx, nBlock, TYPE.groteskX, W / 2, nTop, { align: 'center', tracking: -0.04, color: e.accent, accent: e.accent });
                if (of) drawText(ctx, `OF ${of}`, TYPE.groteskX, smallPx, W / 2, nTop + nBlock.cap + 22 * u + smallPx * 0.72, { align: 'center', tracking: 0.2, color: e.ink });
                e.mark('day', blockBox(nb));
            } else {
                const txt = of ? `DAY {${day}} OF ${of}` : `DAY {${day}}`;
                const cBlock = fitBlock(ctx, [txt], TYPE.groteskX, { maxW: W * 0.62, maxH: H * (tall ? 0.07 : 0.085), tracking: -0.02 });
                const cTop = footTop - 70 * u - cBlock.cap;
                const cb = drawBlock(ctx, cBlock, TYPE.groteskX, W / 2, cTop, { align: 'center', tracking: -0.02, color: e.ink, accent: e.accent });
                e.mark('day', blockBox(cb));
            }
        }

        // ── Three-part footer ──────────────────────────────────────────────
        const parts = String(e.fields.footer ?? '').split(/\s*[·•|\n]\s*/).filter(Boolean).slice(0, 3).map((p) => p.toUpperCase());
        const fPx = (sq ? 18 : 20) * u;
        const fBase = H - safe.b - 4 * u;
        const fOpts = { tracking: 0.14, color: 'rgba(244,241,234,0.72)' };
        let fBox = null;
        if (parts.length === 3) {
            const a = drawText(ctx, parts[0], TYPE.brandR, fPx, safe.l + 10 * u, fBase, fOpts);
            const b = drawText(ctx, parts[1], TYPE.brandR, fPx, W / 2, fBase, { ...fOpts, align: 'center' });
            const c = drawText(ctx, parts[2], TYPE.brandR, fPx, W - safe.r - 10 * u, fBase, { ...fOpts, align: 'right' });
            fBox = { x: a.x, y: Math.min(a.y, b.y, c.y), w: c.x + c.w - a.x, h: Math.max(a.h, b.h, c.h) };
        } else if (parts.length) {
            const t = parts.join('   ·   ');
            fBox = drawText(ctx, t, TYPE.brandR, fPx, W / 2, fBase, { ...fOpts, align: 'center' });
        }
        e.mark('footer', fBox);
    },
};
