/**
 * PAUSE — the quietest post in the Studio: almost nothing. One small serif
 * line in the middle of a warm-black frame, a single accent dot, and a tiny
 * sign-off at the foot. A photo, if there is one, sits very dark behind it.
 * For the in-between posts of a wellness feed, and POWR's rest days.
 */
import { dot } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, unitOf, ground, veil, prep, footRow, headColor, rewardLine } from './_parts';

export default {
    id: 'pause',
    name: 'Pause',
    category: 'Mind',
    blurb: 'Almost empty: one small serif line, one accent dot, a tiny sign-off. The quietest post in the Studio.',
    refs: 'a gallery wall label',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'line', label: 'The line', rows: 2, value: 'Pause here.', hint: 'Keep it short. _Underscores_ set a word in italic.' },
        { key: 'footer', label: 'Small print', value: 'Take a minute' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Pause', fields: { line: 'Pause here.', footer: 'Take a minute' } },
        { name: 'Rest day', fields: { line: 'Rest is part of it.', footer: 'Rest day · POWR' } },
        { name: 'Studio', fields: { line: 'Nothing to do.\n_Nowhere to be._', footer: 'Northside · Open studio' } },
        { name: 'Sunday', fields: { line: 'Slow Sunday.', footer: 'See you Monday' } },
    ],
    look: { ...MIND_LOOK, mono: 0.9, target: 0.1, auto: 0.7, contrast: 0.3, fade: 0.05, vignette: 0.7, dot: 'above' },
    controls: [
        { key: 'dot', label: 'Dot', options: [['above', 'Above the line'], ['below', 'Below the line'], ['none', 'No dot']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const strip = shape === 'strip';
        const banner = strip || shape === 'wide';
        ground(e, '#0C0B0A');
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.35);
        }
        const x0 = safe.l;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k, align: 'center', lockH: strip ? 18 : 20 });

        const lb = prep(e, e.fields.line, e.headline, {
            maxW: W * (banner ? 0.5 : 0.66) * size,
            maxH: H * (strip ? 0.3 : banner ? 0.16 : 0.12) * size,
            max: (strip ? 40 : 48) * k * size,
            lines: 3,
            gap: 0.42,
        });
        const where = e.look.dot ?? 'above';
        const gap = (strip ? 26 : 40) * k;
        const dotR = 5 * k;
        // Centre the line (and its dot) on the frame, not on what's left above the footer.
        const group = lb.h + (where === 'none' ? 0 : gap + dotR * 2);
        let top = H / 2 - group / 2 + (where === 'above' ? gap + dotR * 2 : 0);
        top = Math.min(top, footTop - 40 * k - lb.h - (where === 'below' ? gap + dotR * 2 : 0));
        if (e.hasMedia) e.shade({ x: W * 0.2, y: top, w: W * 0.6, h: lb.h }, { ceiling: 0.2, max: 0.5 });
        lb.draw('line', W / 2, top, { align: 'center', color: headColor(e) });
        if (where === 'above') dot(e.ctx, W / 2, top - gap - dotR, dotR, e.accent);
        if (where === 'below') dot(e.ctx, W / 2, top + lb.h + lb.desc + gap + dotR, dotR, e.accent);
    },
};
