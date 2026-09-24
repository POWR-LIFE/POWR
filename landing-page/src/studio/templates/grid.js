/**
 * GRID — black editorial page on a hairline grid: a stacked headline (first
 * line left, the rest right), the photo as an inset, an accent kicker
 * hanging off its left edge and a big footer. After the 21KM Treadmill poster.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox } from '../text';
import { rule } from '../shapes';

// Banners: square-celled grid, the stacked headline (and footer on 16:9)
// down the left, the photo filling the right as the inset.
function banner(e) {
    const { ctx, W, H, safe, shape, tu } = e;
    const strip = shape === 'strip';
    const cell = H / (strip ? 3 : 6);
    const hair = 'rgba(244,241,234,0.075)';
    for (let x = cell; x < W - 1; x += cell) rule(ctx, Math.round(x) + 0.5, 0, Math.round(x) + 0.5, H, hair, 1);
    for (let y = cell; y < H - 1; y += cell) rule(ctx, 0, Math.round(y) + 0.5, W, Math.round(y) + 0.5, hair, 1);
    const m = Math.max(safe.l, cell / 2);
    const top = Math.max(safe.t, strip ? cell * 0.3 : cell / 2);
    const bottom = H - Math.max(safe.b, strip ? cell * 0.3 : cell / 2);
    const photoX = Math.round(W * (strip ? 0.5 : 0.52) / cell) * cell;
    e.photo({ x: photoX, y: top, w: W - m - photoX, h: bottom - top });
    const tracking = -0.035;
    const size = e.look.size ?? 1;
    const colW = photoX - m - 40 * tu;
    const lines = splitLines(e.caps(e.fields.headline)).slice(0, 4);
    const block = fitBlock(ctx, lines, e.headline, { maxW: colW * size, maxH: (strip ? bottom - top : H * 0.44) * size, tracking, gap: 0.2 });
    const heads = drawBlock(ctx, block, e.headline, m, top, { align: 'stagger', x2: photoX - 40 * tu, tracking, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
    e.mark('headline', blockBox(heads));
    const kPx = (strip ? 26 : 40) * tu;
    if (!strip) {
        const flines = splitLines(e.caps(e.fields.footer)).slice(0, 3);
        const fblock = fitBlock(ctx, flines, e.headline, { maxW: colW * 0.9 * size, maxH: H * 0.24 * size, tracking, gap: 0.2 });
        const fH = fblock.cap + (flines.length - 1) * fblock.step;
        e.mark('footer', blockBox(drawBlock(ctx, fblock, e.headline, m, bottom - fH, { align: 'left', tracking, color: e.ink, accent: e.accent })));
        const hb = heads[heads.length - 1].baseline;
        e.mark('kicker', drawText(ctx, e.caps(e.fields.kicker), TYPE.groteskM, kPx, m, hb + (bottom - fH - hb) / 2, { tracking: -0.025, color: e.accent, leading: 1 }));
    }
    e.mark('date', drawText(ctx, e.caps(e.fields.date), TYPE.groteskM, kPx, photoX - 40 * tu, bottom, { align: 'right', tracking: -0.025, color: e.accent }));
    const logoW = (strip ? 48 : 70) * tu;
    e.logo(e.ink, W - m - logoW - 14 * tu, top + 14 * tu, logoW);
}

export default {
    id: 'grid',
    name: 'Grid',
    category: 'Challenges',
    blurb: 'Black page, hairline grid, stacked type, photo as an inset.',
    refs: '21KM Treadmill',
    headlineFont: 'grotesk',
    fields: [
        { key: 'headline', label: 'Headline', rows: 3, value: '30 Day\n_Gym Floor_\nChallenge', hint: 'First line sits left, the rest right. Wrap words in _underscores_ for italic.' },
        { key: 'kicker', label: 'Kicker', rows: 2, value: 'Starts\nMonday' },
        { key: 'footer', label: 'Footer', rows: 2, value: 'The streak\nis yours.' },
        { key: 'date', label: 'Date', value: 'Oct ’26' },
    ],
    look: {
        mono: 1, target: 0.3, auto: 0.9, contrast: 0.6, crush: 0.15, fade: 0,
        tint: 'none', motion: 0.26, angle: 0, focus: 0.6, vignette: 0.25, grain: 0.5, printGrain: 0.055, size: 1,
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';

        // Hairline grid: 8 columns, square cells, from the top-left corner.
        const cell = W / 8;
        const hair = 'rgba(244,241,234,0.075)';
        for (let x = cell; x < W - 1; x += cell) rule(ctx, Math.round(x) + 0.5, 0, Math.round(x) + 0.5, H, hair, Math.max(1, u));
        for (let y = cell; y < H - 1; y += cell) rule(ctx, 0, Math.round(y) + 0.5, W, Math.round(y) + 0.5, hair, Math.max(1, u));

        const m = cell / 2;
        const top = Math.max(safe.t, m);
        const bottom = H - Math.max(safe.b, m);

        const logoW = 132 * u;
        const logoH = e.logo(e.ink, W - m - logoW, top, logoW);

        // Headline: shared size, staggered alignment.
        const size = e.look.size ?? 1;
        const lines = splitLines(e.caps(e.fields.headline)).slice(0, 4);
        const tracking = -0.035;
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: (W - 2 * m) * 0.9 * size,
            maxH: H * (tall ? 0.19 : sq ? 0.25 : 0.245) * size,
            tracking,
            gap: 0.2,
        });
        const headTop = top + logoH + (sq ? 22 : 34) * u;
        const heads = drawBlock(ctx, block, e.headline, m, headTop, {
            align: 'stagger', x2: W - m, tracking,
            color: e.headlineAccent ? e.accent : e.ink, accent: e.accent,
        });
        const headBottom = heads[heads.length - 1].baseline;
        e.mark('headline', blockBox(heads));

        // Footer block, measured first so the photo can take what's between.
        const flines = splitLines(e.caps(e.fields.footer)).slice(0, 3);
        const fblock = fitBlock(ctx, flines, e.headline, {
            maxW: W * 0.7 * size, maxH: H * (tall ? 0.1 : sq ? 0.165 : 0.155) * size, tracking, gap: 0.2,
        });
        const fH = fblock.cap + (flines.length - 1) * fblock.step;
        const footTop = bottom - fH;

        // Photo inset: from the second grid line to the right margin.
        const gap = (tall ? 0.028 : 0.04) * H;
        const rect = { x: cell * 2, y: headBottom + gap, w: W - m - cell * 2, h: footTop - gap - (headBottom + gap) };
        if (rect.h > 40 * u) e.photo(rect);

        // Kicker hangs off the photo's left edge.
        const kPx = (sq ? 40 : 46) * u;
        e.mark('kicker', drawText(ctx, e.caps(e.fields.kicker), TYPE.groteskM, kPx, m + 6 * u, rect.y + rect.h * 0.2 + kPx * 0.75, {
            tracking: -0.025, color: e.accent, leading: 1.0,
        }));

        e.mark('footer', blockBox(drawBlock(ctx, fblock, e.headline, m, footTop, { align: 'left', tracking, color: e.ink, accent: e.accent })));

        // Date sits top-right against the footer's first line.
        const dPx = (sq ? 40 : 46) * u;
        const dCap = dPx * 0.72;
        e.mark('date', drawText(ctx, e.caps(e.fields.date), TYPE.groteskM, dPx, W - m, footTop + dCap, {
            align: 'right', tracking: -0.025, color: e.accent,
        }));
    },
};
