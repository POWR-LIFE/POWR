/**
 * FRAME — the photo first: graded full-bleed, with a short caption low on the
 * left (an accent rule, a title, a line of small print), a slide number in
 * the top corner when it's part of a carousel, and the POWR mark. Made for
 * event recaps: a carousel of the night's best shots, or a post per photo.
 */
import { TYPE } from '../fonts';
import { drawText, textWidth } from '../text';

export default {
    id: 'frame',
    name: 'Frame',
    category: 'Brand',
    blurb: 'The photo first — a short caption, a slide number for carousels, the POWR mark.',
    refs: 'a recap carousel',
    headlineFont: 'brandM',
    fields: [
        { key: 'title', label: 'Caption', value: 'Every move counts' },
        { key: 'note', label: 'Small print', value: 'powr.life' },
        { key: 'index', label: 'Slide number', value: '', hint: 'Like “02 / 08” — carousels fill it in. Leave empty to hide it.' },
    ],
    presets: [
        { name: 'Brand line', fields: { title: 'Every move counts', note: 'powr.life' } },
        { name: 'Earned', fields: { title: 'Earned, not given', note: 'powr.life' } },
    ],
    look: {
        mono: 1, target: 0.3, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0.2, angle: 0, focus: 0.6, vignette: 0.45, grain: 0.5, size: 1,
    },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const banner = shape === 'wide' || shape === 'strip';
        const unit = banner ? e.tu : e.u;
        const size = e.look.size ?? 1;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.6);
        e.fade(0, 0, W, H * 0.2, 'top', 0.3);

        const x0 = safe.l;
        const bottom = H - safe.b;
        const logoW = (shape === 'strip' ? 56 : 72) * unit;
        e.logo(e.ink, W - safe.r - logoW, bottom - logoW * 0.72, logoW);

        // Caption, bottom left: rule, title, small print.
        const titlePx = (shape === 'strip' ? 24 : banner ? 30 : 34) * unit * size;
        const notePx = (shape === 'strip' ? 14 : 17) * unit;
        const title = e.caps(e.fields.title).trim();
        const note = e.caps(e.fields.note).trim();
        const maxW = W - safe.l - safe.r - logoW - 40 * unit;
        let y = bottom;
        if (note) {
            e.mark('note', drawText(ctx, note, TYPE.monoR, notePx, x0, y, { tracking: 0.12, color: 'rgba(244,241,234,0.72)' }));
            y -= notePx * 1.9;
        }
        if (title) {
            const px = Math.min(titlePx, (titlePx * maxW) / Math.max(1, textWidth(ctx, title, e.headline, titlePx, 0.12)));
            const box = drawText(ctx, title, e.headline, px, x0, y, { tracking: 0.12, color: e.ink, accent: e.accent });
            e.mark('title', box);
            y = (box?.y ?? y - px) - px * 0.9;
        }
        if (title || note) {
            ctx.fillStyle = e.accent;
            ctx.fillRect(x0, y - 3 * unit, 56 * unit, 3 * unit);
        }

        // Slide number, top right.
        const index = String(e.fields.index ?? '').trim();
        if (index) {
            const px = (shape === 'strip' ? 14 : 18) * unit;
            e.mark('index', drawText(ctx, index, TYPE.monoR, px, W - safe.r, safe.t + px, { align: 'right', tracking: 0.12, color: 'rgba(244,241,234,0.85)' }));
        }
    },
};
