/**
 * RIPPLE — concentric rings spreading out from the photo's focal point (the
 * subject, or wherever the editor's click put it), each fainter than the
 * last, one in the accent. The headline sits in the clear water, on the side
 * of the frame farthest from the centre of the ripple. For sound baths,
 * meditation classes and retreats.
 */
import { TYPE } from '../../../fonts';
import { ring } from '../../../shapes';
import { textWidth } from '../../../text';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, SOFT, unitOf, veil, prep, footRow, headColor, label, rewardLine } from './_parts';

const lineW = (e, px) => textWidth(e.ctx, e.fields.line ?? '', TYPE.serifI, px);

// `clear` (the headline's box) is kept free of rings: they stop short of it.
function rings(e, f, k, clear) {
    const { ctx, W, H } = e;
    ctx.save();
    if (clear) {
        const p = 36 * k;
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.roundRect(clear.x - p, clear.y - p, clear.w + p * 2, clear.h + p * 2, p);
        ctx.clip('evenodd');
    }
    const far = Math.max(Math.hypot(f.x, f.y), Math.hypot(W - f.x, f.y), Math.hypot(f.x, H - f.y), Math.hypot(W - f.x, H - f.y));
    const base = Math.min(W, H) * 0.075;
    const count = e.look.rings === 'few' ? 6 : 11;
    const pick = e.look.rings === 'few' ? 1 : 2;
    for (let i = 0; i < count; i++) {
        const r = base * (i + 1) ** (e.look.rings === 'few' ? 1.35 : 1.22);
        if (r > far) break;
        const t = i / (count - 1);
        const a = 0.46 * (1 - t) ** 1.4 + 0.035;
        ring(ctx, f.x, f.y, r, i === pick ? e.accent : `rgba(244,241,234,${a.toFixed(3)})`, Math.max(1, (i === pick ? 2 : 1.3) * k));
    }
    ctx.restore();
}

export default {
    id: 'ripple',
    name: 'Ripple',
    category: 'Mind',
    blurb: 'Rings spreading out from the photo’s subject, fading as they go; the headline in the clear space away from them. For sound baths and meditation.',
    refs: 'a stone dropped in still water',
    headlineFont: 'brandL',
    fields: [
        { key: 'headline', label: 'Headline', rows: 2, value: 'Let it _settle_.', hint: 'Short. _Underscores_ set italic, {braces} colour a word.' },
        { key: 'line', label: 'Line under it', value: 'Sound bath · Sunday 6pm' },
        { key: 'footer', label: 'Small print', value: 'Mats and blankets provided' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Sound bath', fields: { headline: 'Let it _settle_.', line: 'Sound bath · Sunday 6pm', footer: 'Mats and blankets provided' } },
        { name: 'Meditation', fields: { headline: 'Start from\nthe _middle_.', line: 'Guided sit · Twenty minutes', footer: 'Northside Studio' } },
        { name: 'Retreat', fields: { headline: 'A weekend\nof _quiet_.', line: 'Two days. No schedule to keep.', footer: 'Northside Retreats · October' } },
        { name: 'Recovery', fields: { headline: 'Rest days\ncount _too_.', line: 'Log it. The streak is yours.', footer: 'Every move counts' } },
    ],
    look: { ...MIND_LOOK, mono: 0.7, target: 0.24, rings: 'many' },
    controls: [
        { key: 'rings', label: 'Rings', options: [['many', 'Many, close'], ['few', 'Few, wide']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const banner = shape === 'wide' || shape === 'strip';
        const strip = shape === 'strip';
        const f = e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.12);

        const x0 = safe.l;
        const x1 = W - safe.r;
        const lPx = (strip ? 24 : 32) * k;
        const hasLine = String(e.fields.line ?? '').trim() !== '';
        const lGap = (strip ? 18 : 30) * k;

        if (banner) {
            // The half of the frame away from the ripple's centre.
            const left = f.x >= W * 0.45;
            const cx0 = left ? x0 : W * (strip ? 0.64 : 0.6);
            const cx1 = left ? W * (strip ? 0.36 : 0.4) : x1;
            const footTop = H - safe.b - (strip ? 26 : 30) * k;
            const hb = prep(e, e.fields.headline, e.headline, { maxW: (cx1 - cx0) * 0.95 * size, maxH: (footTop - safe.t) * (strip ? 0.5 : 0.36) * size, max: (strip ? 80 : 110) * k * size, lines: 2 });
            const h = hb.h + hb.desc + (hasLine ? lGap + lPx * 0.72 : 0);
            const top = safe.t + Math.max(0, (footTop - 26 * k - safe.t - h) / 2);
            rings(e, f, k, { x: cx0, y: top, w: Math.max(hb.w, lineW(e, lPx)), h });
            e.fade(left ? 0 : W * 0.45, 0, W * 0.55, H, left ? 'left' : 'right', 0.85);
            footRow(e, { x0: cx0, x1: cx1, bottom: H - safe.b, k, lockH: strip ? 22 : 26 });
            hb.draw('headline', cx0, top, { color: headColor(e) });
            if (hasLine) label(e, 'line', e.fields.line, cx0, top + hb.h + hb.desc + lGap + lPx * 0.72, { px: lPx, maxW: cx1 - cx0, color: SOFT, spec: TYPE.serifI, tracking: 0, upper: false });
            return;
        }

        const tall = shape === 'tall';
        const sq = shape === 'square';
        const hb = prep(e, e.fields.headline, e.headline, { maxW: (x1 - x0) * 0.9 * size, maxH: H * (sq ? 0.2 : tall ? 0.14 : 0.17) * size, max: (sq ? 104 : 120) * k * size, lines: 2 });
        const h = hb.h + hb.desc + (hasLine ? lGap + lPx * 0.72 : 0);
        // The lockup row is drawn last (over the fades); its top, ahead of time.
        const footTop = H - safe.b - 30 * k;
        const highTop = safe.t + (tall ? 60 : 30) * k;
        const lowTop = footTop - (sq ? 50 : 80) * k - h;
        const top = Math.abs(f.y - (highTop + h / 2)) >= Math.abs(f.y - (lowTop + h / 2)) ? highTop : lowTop;
        rings(e, f, k, { x: x0, y: top, w: Math.max(hb.w, lineW(e, lPx)), h });
        if (top === highTop) e.fade(0, 0, W, top + h + H * 0.18, 'top', 0.8);
        e.fade(0, Math.min(top, H * 0.55), W, H - Math.min(top, H * 0.55), 'bottom', top === lowTop ? 0.88 : 0.55);
        footRow(e, { x0, x1, bottom: H - safe.b, k });
        e.shade({ x: x0, y: top, w: (x1 - x0) * 0.8, h }, { ceiling: 0.26, max: 0.5 });
        hb.draw('headline', x0, top, { color: headColor(e) });
        if (hasLine) label(e, 'line', e.fields.line, x0, top + hb.h + hb.desc + lGap + lPx * 0.72, { px: lPx, maxW: x1 - x0, color: SOFT, spec: TYPE.serifI, tracking: 0, upper: false });
    },
};
