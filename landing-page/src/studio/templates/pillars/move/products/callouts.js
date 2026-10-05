/**
 * FEATURE CALLOUTS — the product as a spec sheet: numbered leader lines run
 * from points on the product out to its features at either side, crop marks
 * square it up, and a mono line of facts sits underneath. The points are
 * fractions of the product shot, so they follow any upload. For kit and
 * gear with details worth pointing at.
 */
import { TYPE } from '../../../../fonts';
import { drawText, wrapLines } from '../../../../text';
import { rule, dot, ring } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { GREY, SOFT, HAIR, frame, ground, backdrop, line, block, blockHeight, fitPx, makerOf, mono } from './_parts';

// "0.3 0.2 Reflective trims · Front and back" → { fx, fy, label, sub }. At most 5.
function featuresOf(e) {
    return String(e.fields.features ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            const m = l.match(/^([01](?:\.\d+)?|\.\d+)\s+([01](?:\.\d+)?|\.\d+)\s+(.*)$/);
            const [fx, fy, rest] = m ? [parseFloat(m[1]), parseFloat(m[2]), m[3]] : [0.5, NaN, l];
            const [label, ...sub] = rest.split(/\s*·\s*/);
            return { fx: Math.min(1, Math.max(0, fx)), fy, label: label.trim(), sub: sub.join(' · ').trim() };
        })
        .filter((f) => f.label)
        .slice(0, 5)
        .map((f, i, all) => ({ ...f, fy: Number.isFinite(f.fy) ? Math.min(1, Math.max(0, f.fy)) : (i + 0.5) / all.length }));
}

// Crop marks at the four corners of r.
function cropMarks(ctx, r, len, color, w) {
    const c = [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]];
    c.forEach(([x, y, sx, sy]) => {
        rule(ctx, x, y, x + len * sx, y, color, w);
        rule(ctx, x, y, x, y + len * sy, color, w);
    });
}

/**
 * Lay the callouts out: each feature's point on the drawn product, its
 * label in the left or right column at the point's height, nudged apart so
 * none overlap. `cols` = { L: [x0, x1] | null, R: [x0, x1] }.
 */
function callouts(e, feats, rect, cols, top, bottom, { px, gap, oneSide = false }) {
    const { ctx } = e;
    const k = frame(e).k;
    const subPx = px * 0.62;
    const lw = Math.max(1, 1.4 * k);
    const items = feats.map((f, i) => {
        let side = f.fx < 0.42 ? 'L' : f.fx > 0.58 ? 'R' : (i % 2 ? 'R' : 'L');
        if (oneSide || !cols.L) side = 'R';
        const [cx0, cx1] = cols[side];
        const w = cx1 - cx0;
        const lp = fitPx(ctx, f.label, TYPE.brandM, px, w);
        const subs = f.sub ? wrapLines(ctx, f.sub, TYPE.brandR, subPx, w, 2) : [];
        const h = px * 1.45 + lp * 0.75 + subs.length * subPx * 1.3;
        return { ...f, i, side, cx0, cx1, lp, subs, h, px: rect.x + f.fx * rect.w, py: rect.y + f.fy * rect.h };
    });
    // Per side, top to bottom: centre each label on its point, then push apart.
    ['L', 'R'].forEach((s) => {
        const col = items.filter((it) => it.side === s).sort((a, b) => a.py - b.py);
        let y = top;
        col.forEach((it) => {
            it.y = Math.max(y, it.py - it.h / 2);
            y = it.y + it.h + gap;
        });
        // Pull back up if the last one ran past the bottom.
        let over = y - gap - bottom;
        for (let j = col.length - 1; j >= 0 && over > 0; j--) {
            const it = col[j];
            const room = j > 0 ? it.y - (col[j - 1].y + col[j - 1].h + gap) : it.y - top;
            const mv = Math.min(over, Math.max(0, room));
            for (let m = j; m < col.length; m++) col[m].y -= mv;
            over -= mv;
        }
    });
    items.forEach((it) => {
        const left = it.side === 'L';
        const tx = left ? it.cx1 : it.cx0;
        const ly = it.y + px * 0.55;
        // Leader: from the point out to the column edge at the label's first line.
        const edge = left ? it.cx1 + 24 * k : it.cx0 - 24 * k;
        const elbow = left ? Math.min(it.px - 30 * k, edge + 40 * k) : Math.max(it.px + 30 * k, edge - 40 * k);
        ctx.save();
        ctx.strokeStyle = 'rgba(244,241,234,0.55)';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(it.px, it.py);
        ctx.lineTo(elbow, ly);
        ctx.lineTo(edge, ly);
        ctx.stroke();
        ctx.restore();
        ring(ctx, it.px, it.py, 9 * k, e.accent, Math.max(1, 2 * k));
        dot(ctx, it.px, it.py, 3.5 * k, e.accent);
        const num = String(it.i + 1).padStart(2, '0');
        drawText(ctx, num, TYPE.mono, px * 0.5, tx, ly + px * 0.18, { align: left ? 'right' : 'left', tracking: 0.14, color: e.accent });
        drawText(ctx, it.label, TYPE.brandM, it.lp, tx, ly + px * 0.35 + it.lp * 0.95, { align: left ? 'right' : 'left', color: e.ink });
        it.subs.forEach((s, j) => {
            drawText(ctx, s, TYPE.brandR, px * 0.62, tx, ly + px * 0.35 + it.lp * 0.95 + (j + 1) * px * 0.62 * 1.3 + px * 0.12, { align: left ? 'right' : 'left', color: GREY });
        });
        e.mark('features', { x: it.cx0, y: it.y, w: it.cx1 - it.cx0, h: it.h });
    });
}

export default {
    id: 'move-callouts',
    name: 'Feature Callouts',
    category: 'Move',
    section: 'Products',
    blurb: 'The product as a spec sheet: numbered leader lines from points on it to its features at the sides, crop marks, a line of facts. For kit and gear with details to show.',
    refs: 'a technical spec sheet',
    headlineFont: 'brandSB',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Spec sheet · 01' },
        { key: 'name', label: 'Product name', value: 'Trail bottle' },
        {
            key: 'features', label: 'Features', rows: 5,
            value: '0.50 0.04 Loop cap · Carries on one finger\n0.50 0.30 Brushed steel · 18/8 stainless\n0.50 0.78 Double wall · 750 ml\n0.50 0.96 Flat base · Stands on the bench',
            hint: 'One per line: across and down the product (0–1), then the feature · a detail. Up to five.',
        },
        { key: 'facts', label: 'Facts line', value: '750 ml · 380 g · 26 cm · £32' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Bottle', fields: { eyebrow: 'Spec sheet · 01', name: 'Trail bottle', features: '0.50 0.04 Loop cap · Carries on one finger\n0.50 0.30 Brushed steel · 18/8 stainless\n0.50 0.78 Double wall · 750 ml\n0.50 0.96 Flat base · Stands on the bench', facts: '750 ml · 380 g · 26 cm · £32' } },
        { name: 'Leggings', fields: { eyebrow: 'Built for the studio', name: 'Studio tight', features: '0.45 0.43 High waistband · Flat, no drawcord\n0.62 0.52 Side pocket · Fits a phone\n0.40 0.70 Four-way stretch · 78% recycled nylon\n0.58 0.86 7/8 length · Ends above the ankle', facts: 'XS–XL · Black · £68' } },
        { name: 'Watch', fields: { eyebrow: 'Spec sheet · 02', name: 'Pace 2', features: '0.50 0.10 Silicone strap · Pin buckle\n0.90 0.46 Digital crown · Scroll and press\n0.30 0.46 Always-on display · 1.9 in\n0.50 0.88 Water rated · 50 m', facts: '44 mm · 38 g · GPS · £249' } },
        { name: 'Bag', fields: { eyebrow: 'Gym kit', name: 'Kit holdall', features: '0.50 0.10 Grab handle · Padded\n0.20 0.50 Shoe tunnel · Vented\n0.80 0.50 Wet pocket · Taped seams\n0.50 0.92 Base · Wipe-clean', facts: '32 L · 1.1 kg · £85' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), ...(r.value ? { eyebrow: `${r.value}${r.unit ? ` ${r.unit}` : ''} with POWR points` } : {}) }),
    },

    draw(e) {
        const f = frame(e);
        const { ctx, W, H } = e;
        const { k, tall, sq, strip, wide } = f;
        const feats = featuresOf(e);
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const hair = Math.max(1, 1.2 * k);
        const opts = { kind: 'bottle', label: makerOf(e), sub: e.fields.name };

        if (strip) {
            // Name + lockup left, the product, the callouts all to the right.
            const pw = W * 0.2;
            const px0 = W * 0.34;
            ground(e, { cx: px0 + pw / 2, cy: H * 0.55, r: H * 0.8 });
            backdrop(e);
            const pr = productShot(e, { x: px0, y: y0, w: pw, h: y1 - y0 }, opts).rect;
            lockup(e, x0, y0, 36 * k, { maxW: px0 - x0 - 60 * k });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x0, y0 + 36 * k + 44 * k, 14 * k, { maxW: px0 - x0 - 60 * k, color: SOFT }));
            block(e, 'name', x0, y1 - 40 * k, px0 - x0 - 60 * k, (y1 - y0) * 0.4, { bottom: true, caps: false, tracking: -0.02, maxLines: 2 });
            line(e, 'facts', TYPE.mono, 13 * k, x0, y1, px0 - x0 - 60 * k, { color: GREY, tracking: 0.14, caps: true });
            callouts(e, feats, pr, { L: null, R: [px0 + pw + 110 * k, x1] }, y0, y1, { px: 30 * k, gap: 12 * k, oneSide: true });
            return;
        }

        const lh = (sq ? 46 : wide ? 48 : 54) * k;
        const namePx = (tall ? 84 : sq ? 58 : wide ? 64 : 72) * k;
        const nameTop = y0 + lh + (tall ? 70 : sq ? 36 : wide ? 36 : 50) * k;
        const nh = blockHeight(e, 'name', x1 - x0, namePx * 2.2, { caps: false, tracking: -0.02, max: namePx, maxLines: 2 });
        const factsBase = y1;
        const ruleY = factsBase - 40 * k;
        const top = nameTop + nh + (tall ? 90 : sq ? 44 : wide ? 40 : 70) * k;
        const bottom = ruleY - (sq || wide ? 40 : 60) * k;
        const pwFrac = wide ? 0.26 : sq ? 0.3 : 0.34;
        const pw = (x1 - x0) * pwFrac;
        const px0 = (x0 + x1) / 2 - pw / 2;
        ground(e, { cx: W / 2, cy: (top + bottom) / 2, r: Math.max(pw * 1.3, (bottom - top) * 0.7) });
        backdrop(e);
        const shot = productShot(e, { x: px0, y: top, w: pw, h: bottom - top }, opts);
        const pr = shot.rect;
        cropMarks(ctx, { x: px0 - 16 * k, y: top - 16 * k, w: pw + 32 * k, h: bottom - top + 32 * k }, 22 * k, 'rgba(244,241,234,0.35)', hair);
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, (sq ? 15 : 17) * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        block(e, 'name', x0, nameTop, x1 - x0, namePx * 2.2, { caps: false, tracking: -0.02, max: namePx, maxLines: 2 });
        const colGap = 70 * k;
        callouts(e, feats, pr, { L: [x0, px0 - colGap], R: [px0 + pw + colGap, x1] }, top, bottom, { px: (tall ? 34 : sq ? 26 : wide ? 28 : 30) * k, gap: 16 * k });
        rule(ctx, x0, ruleY, x1, ruleY, HAIR, hair);
        line(e, 'facts', TYPE.mono, (sq ? 16 : 18) * k, x0, factsBase, x1 - x0, { color: SOFT, tracking: 0.16, caps: true });
    },
};
