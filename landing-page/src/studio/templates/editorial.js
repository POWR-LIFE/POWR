/**
 * EDITORIAL — the POWR feed look ("Day 1."): a quiet full-bleed photo, light
 * Outfit type low on the frame under a short accent rule, and a status tag
 * top right. Calm where Club is loud.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, lineMetrics, textWidth, blockBox } from '../text';

// Banner strip (3:1, 4:1): the same voice, set left over a fade.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    const centre = e.look.align === 'center';
    e.photo({ x: 0, y: 0, w: W, h: H });
    if (!centre) e.fade(0, 0, W * 0.62, H, 'left', 0.85);
    e.fade(0, H * 0.45, W, H * 0.55, 'bottom', 0.6);
    const x = centre ? W / 2 : safe.l + 6 * tu;
    const align = centre ? 'center' : 'left';
    e.logo(e.ink, safe.l, safe.t, 58 * tu);
    const tag = e.caps(e.fields.tag).trim();
    if (tag) {
        const px = 19 * tu;
        const tw = textWidth(ctx, tag, TYPE.brandSB, px, 0.06);
        const padX = 12 * tu;
        const h = px * 1.6;
        const rx = W - safe.r - tw - padX * 2;
        ctx.fillStyle = e.accent;
        ctx.fillRect(rx, safe.t, tw + padX * 2, h);
        e.mark('tag', drawText(ctx, tag, TYPE.brandSB, px, rx + padX, safe.t + h * 0.5 + px * 0.36, { tracking: 0.06, color: '#111111' }));
    }
    const lines = splitLines(e.fields.headline).slice(0, 2);
    const block = fitBlock(ctx, lines, e.headline, { maxW: W * (centre ? 0.6 : 0.44) * (e.look.size ?? 1), maxH: H * 0.36 * (e.look.size ?? 1), gap: 0.16 });
    const last = block.segs[block.segs.length - 1] ?? [];
    const descent = lineMetrics(ctx, last, e.headline, block.px, 0).descent;
    const blockH = block.cap + (lines.length - 1) * block.step;
    const linePx = 28 * tu;
    const total = blockH + descent + 24 * tu + linePx;
    const top = (H - total) / 2 + 10 * tu;
    const boxes = drawBlock(ctx, block, e.headline, x, top, { align, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
    e.mark('headline', blockBox(boxes));
    ctx.fillStyle = e.accent;
    ctx.fillRect(centre ? W / 2 - 24 * tu : x, top - 26 * tu, 48 * tu, 3 * tu);
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, linePx, x, top + blockH + descent + 24 * tu + linePx * 0.72, { align, color: 'rgba(244,241,234,0.82)' }));
    e.mark('footer', drawText(ctx, e.caps(e.fields.footer), TYPE.brandM, 15 * tu, centre ? W / 2 : W - safe.r, H - safe.b, { align: centre ? 'center' : 'right', tracking: 0.16, color: 'rgba(244,241,234,0.55)' }));
}

export default {
    id: 'editorial',
    name: 'Editorial',
    category: 'Brand',
    blurb: 'Quiet and premium: light type low on the frame, a status tag. The POWR feed look.',
    refs: 'the POWR feed',
    headlineFont: 'brandL',
    fields: [
        { key: 'tag', label: 'Tag (top right)', value: 'Live now', hint: 'Leave empty to hide it.' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Day 1.', hint: 'Sentence case reads calmer. {Braces} colour a word.' },
        { key: 'line', label: 'Line under it', value: 'Every streak starts somewhere.' },
        { key: 'footer', label: 'Footer', value: 'Train · Earn · Repeat' },
    ],
    presets: [
        { name: 'Day 1', fields: { tag: 'Live now', headline: 'Day 1.', line: 'Every streak starts somewhere.', footer: 'Train · Earn · Repeat' } },
        { name: 'Streak', fields: { tag: 'Week 12', headline: 'The streak\nis {yours}.', line: 'Twelve weeks. Not one missed.', footer: 'Earned, not given' } },
        { name: 'Gym floor', fields: { tag: 'New', headline: 'Nobody owns\nthe gym floor.', line: 'Until now.', footer: 'powr.life/app' } },
        { name: 'Reward', fields: { tag: 'Unlocked', headline: '280 points.', line: 'Your next reward is already in the app.', footer: 'Every move counts' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.4, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.6, vignette: 0.5, grain: 0.45, size: 1, align: 'left',
    },
    controls: [
        { key: 'align', label: 'Text position', options: [['left', 'Bottom left'], ['center', 'Centred']] },
    ],

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const centre = e.look.align === 'center';
        e.photo({ x: 0, y: 0, w: W, h: H });

        e.fade(0, 0, W, H * 0.2, 'top', 0.45);
        e.fade(0, H * 0.42, W, H * 0.58, 'bottom', 0.88);

        const x = centre ? W / 2 : safe.l + 8 * u;
        const align = centre ? 'center' : 'left';

        e.logo(e.ink, safe.l + 2 * u, safe.t + 4 * u, 88 * u);

        // Status tag: a solid accent chip, the one loud thing on the frame.
        const tag = e.caps(e.fields.tag).trim();
        if (tag) {
            const px = 21 * u;
            const tw = textWidth(ctx, tag, TYPE.brandSB, px, 0.06);
            const padX = 13 * u;
            const h = px * 1.6;
            const rx = W - safe.r - tw - padX * 2;
            const ry = safe.t + 10 * u;
            ctx.fillStyle = e.accent;
            ctx.fillRect(rx, ry, tw + padX * 2, h);
            e.mark('tag', drawText(ctx, tag, TYPE.brandSB, px, rx + padX, ry + h * 0.5 + px * 0.36, { tracking: 0.06, color: '#111111' }));
        }

        // Built from the bottom up: footer, line, headline, rule.
        const footPx = (sq ? 17 : 18) * u;
        const footBase = H - safe.b - 6 * u;
        e.mark('footer', drawText(ctx, e.caps(e.fields.footer), TYPE.brandM, footPx, x, footBase, {
            align, tracking: 0.16, color: 'rgba(244,241,234,0.55)',
        }));

        const linePx = (sq ? 32 : 36) * u;
        const lineBase = footBase - footPx - 30 * u;
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, linePx, x, lineBase, {
            align, color: 'rgba(244,241,234,0.8)',
        }));

        const size = e.look.size ?? 1;
        const lines = splitLines(e.fields.headline).slice(0, 3);
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: W * (centre ? 0.72 : 0.68) * size,
            maxH: H * (tall ? 0.15 : sq ? 0.24 : 0.2) * size,
            gap: 0.16,
        });
        // Leave room for descenders ("Day") above the line below.
        const last = block.segs[block.segs.length - 1] ?? [];
        const descent = lineMetrics(ctx, last, e.headline, block.px, 0).descent;
        const blockH = block.cap + (lines.length - 1) * block.step;
        const top = lineBase - linePx * 0.72 - 30 * u - descent - blockH;
        const boxes = drawBlock(ctx, block, e.headline, x, top, {
            align, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent,
        });
        e.mark('headline', blockBox(boxes));

        const ruleW = 54 * u;
        const ruleX = centre ? W / 2 - ruleW / 2 : x;
        ctx.fillStyle = e.accent;
        ctx.fillRect(ruleX, top - 36 * u, ruleW, 3.5 * u);
    },
};
