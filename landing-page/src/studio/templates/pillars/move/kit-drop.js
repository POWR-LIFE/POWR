/**
 * KIT DROP — a product drop for activewear, set like the label on the box:
 * the brand's mark big, the drop number huge in the corner, then a ruled
 * label with the product, its colourway, the size run (sold-out sizes struck
 * through) and when it lands. For activewear and gear brands.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, wrapLines } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords, hasPartner, brandMark } from '../kit';
import { GREY, SOFT, HAIR, DIM, mono, unitOf, fitPx } from './_parts';
import { logo as powrLogo } from '../../../logo';

// "XS S (M) L ~XL" → [{ s: 'XS', out: false }, …]; brackets or ~ = sold out.
const sizesOf = (e) => String(e.fields.sizes ?? '')
    .split(/[\s,/·|]+/)
    .filter(Boolean)
    .map((t) => ({ s: t.replace(/[()~[\]]/g, ''), out: /^[(~[]/.test(t) }))
    .filter((t) => t.s)
    .slice(0, 9);

// The brand's mark — theirs when there is one, else POWR's — in `box`.
function mainMark(e, box, align = 'left') {
    if (hasPartner(e)) return brandMark(e, box, { align });
    const img = powrLogo(e.ink);
    const w = img ? Math.min(box.w, (box.h * img.width) / img.height) : box.w;
    const x = align === 'right' ? box.x + box.w - w : align === 'center' ? box.x + (box.w - w) / 2 : box.x;
    e.logo(e.ink, x, box.y, w);
    return { x, y: box.y, w, h: img ? (w * img.height) / img.width : box.h };
}

// "DROP" over "03": the number in the headline face. (x1 = right edge.) Returns the box.
function dropNo(e, x1, top, px, labPx, align = 'right') {
    const { ctx } = e;
    const n = String(e.fields.drop ?? '').trim();
    const lab = String(e.fields.dropLabel ?? '').trim();
    if (lab) e.mark('dropLabel', mono(e, lab, x1, top + labPx * 0.75, labPx, { align, color: SOFT, tracking: 0.3 }));
    if (!n) return null;
    const cap = capHeight(ctx, e.headline, px);
    const base = top + (lab ? labPx + 16 * unitOf(e) : 0) + cap;
    const box = drawText(ctx, e.caps(n), e.headline, px, x1, base, { align, color: e.accent, tracking: -0.01 });
    e.mark('drop', box);
    return box;
}

// The size run as boxes across x0..x1 (at most `b` wide each). Returns the box.
function sizeRun(e, x0, x1, top, b) {
    const { ctx } = e;
    const k = unitOf(e);
    const sizes = sizesOf(e);
    if (!sizes.length) return null;
    const gap = Math.min(14 * k, b * 0.16);
    const w = Math.min(b * 1.2, (x1 - x0 - gap * (sizes.length - 1)) / sizes.length);
    const h = b;
    const px = Math.min(h * 0.36, w * 0.34);
    sizes.forEach((t, i) => {
        const x = x0 + i * (w + gap);
        ctx.save();
        ctx.strokeStyle = t.out ? HAIR : 'rgba(244,241,234,0.7)';
        ctx.lineWidth = Math.max(1, 1.6 * k);
        ctx.strokeRect(x + k, top + k, w - 2 * k, h - 2 * k);
        ctx.restore();
        const sp = fitPx(ctx, t.s, TYPE.brandM, px, w * 0.8);
        drawText(ctx, t.s, TYPE.brandM, sp, x + w / 2, top + h / 2 + capHeight(ctx, TYPE.brandM, sp) / 2, { align: 'center', color: t.out ? DIM : e.ink });
        if (t.out) rule(ctx, x + 6 * k, top + h - 6 * k, x + w - 6 * k, top + 6 * k, 'rgba(244,241,234,0.5)', Math.max(1, 1.6 * k));
    });
    const box = { x: x0, y: top, w: sizes.length * w + (sizes.length - 1) * gap, h };
    e.mark('sizes', box);
    return box;
}

// The label: product + colourway, sizes, when. Laid out in x0..x1 from top
// down, `s` scales it. Returns the bottom.
function label(e, x0, x1, top, s) {
    const { ctx } = e;
    const k = unitOf(e);
    const labPx = 15 * k * s;
    const namePx = 58 * k * s;
    const hair = Math.max(1, 1.2 * k);
    // Product (left, big) · colourway (right column).
    const colX = x0 + (x1 - x0) * 0.62;
    mono(e, 'Product', x0, top + labPx * 0.75, labPx);
    mono(e, 'Colourway', colX, top + labPx * 0.75, labPx);
    // With a partner leading, POWR's own mark sits small in the label's corner.
    if (hasPartner(e)) {
        const img = powrLogo(e.ink);
        const lh = labPx * 1.7;
        const lw = img ? (lh * img.width) / img.height : lh * 3;
        e.logo(e.ink, x1 - lw, top + labPx * 0.4 - lh / 2, lw);
    }
    const base = top + labPx + 18 * k * s + capHeight(ctx, TYPE.brandSB, namePx);
    const prod = String(e.fields.product ?? '').trim();
    e.mark('product', drawText(ctx, prod, TYPE.brandSB, fitPx(ctx, prod, TYPE.brandSB, namePx, colX - x0 - 30 * k), x0, base, { color: e.ink, tracking: -0.01 }));
    const cw = String(e.fields.colourway ?? '').trim();
    e.mark('colourway', drawText(ctx, cw, TYPE.brandL, fitPx(ctx, cw, TYPE.brandL, namePx * 0.62, x1 - colX), colX, base, { color: e.ink }));
    rule(ctx, colX - 24 * k, top, colX - 24 * k, base + 10 * k, HAIR, hair);
    let y = base + 30 * k * s;
    rule(ctx, x0, y, x1, y, HAIR, hair);
    // Sizes.
    y += 26 * k * s;
    mono(e, 'Sizes', x0, y + labPx * 0.75, labPx);
    y += labPx + 16 * k * s;
    sizeRun(e, x0, x1, y, 70 * k * s);
    y += 70 * k * s + 30 * k * s;
    rule(ctx, x0, y, x1, y, HAIR, hair);
    // When · line.
    y += 26 * k * s;
    mono(e, 'Drops', x0, y + labPx * 0.75, labPx);
    const wPx = 34 * k * s;
    const wb = y + labPx + 16 * k * s + capHeight(ctx, TYPE.brandR, wPx);
    const when = String(e.fields.when ?? '').trim();
    e.mark('when', drawText(ctx, when, TYPE.brandR, fitPx(ctx, when, TYPE.brandR, wPx, colX - x0 - 30 * k), x0, wb, { color: e.ink }));
    const line = String(e.fields.line ?? '').trim();
    if (line) {
        // The line takes the right-hand column, bottom-aligned with "when".
        const lp = 22 * k * s;
        const lines = wrapLines(ctx, line, TYPE.brandR, lp, x1 - colX, 2);
        e.mark('line', drawText(ctx, lines.join('\n'), TYPE.brandR, lp, colX, wb - (lines.length - 1) * lp * 1.3, { color: GREY, leading: 1.3 }));
    }
    return wb;
}

// Height `label` takes at scale s (kept in step with it).
const labelH = (e, s) => {
    const k = unitOf(e);
    return (15 + 18 + 30 + 26 + 15 + 16 + 70 + 30 + 26 + 15 + 16) * k * s
        + capHeight(e.ctx, TYPE.brandSB, 58 * k * s) + capHeight(e.ctx, TYPE.brandR, 34 * k * s);
};

// POWR's small mark (when the partner leads) at the label's corner.
function powrCorner(e, x1, base, h) {
    if (!hasPartner(e)) return;
    const img = powrLogo(e.ink);
    const w = img ? (h * img.width) / img.height : h * 3;
    e.logo(e.ink, x1 - w, base - h, w);
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    if (strip) {
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W * 0.7, H, 'left', 0.9);
        ctx.fillStyle = 'rgba(10,10,10,0.55)';
        ctx.fillRect(0, 0, W * 0.62, H);
        // Left: the mark over the drop number. Middle: product, sizes, when.
        mainMark(e, { x: x0, y: y0, w: W * 0.17, h: (y1 - y0) * 0.24 });
        dropNo(e, x0, y0 + (y1 - y0) * 0.38, (y1 - y0) * 0.44, 14 * k, 'left');
        const lx = W * 0.27;
        const lx1 = W * 0.6;
        const prod = String(e.fields.product ?? '').trim();
        const pPx = 44 * k;
        e.mark('product', drawText(ctx, prod, TYPE.brandSB, fitPx(ctx, prod, TYPE.brandSB, pPx, lx1 - lx), lx, y0 + pPx * 0.8, { color: e.ink }));
        e.mark('colourway', drawText(ctx, e.fields.colourway, TYPE.brandL, fitPx(ctx, String(e.fields.colourway ?? ''), TYPE.brandL, 26 * k, lx1 - lx), lx, y0 + pPx * 0.8 + 44 * k, { color: SOFT }));
        sizeRun(e, lx, lx1, y0 + (y1 - y0) * 0.5, 54 * k);
        e.mark('when', drawText(ctx, e.fields.when, TYPE.brandR, fitPx(ctx, String(e.fields.when ?? ''), TYPE.brandR, 24 * k, lx1 - lx), lx, y1, { color: e.ink }));
        powrCorner(e, x1, y1, 36 * k);
        return;
    }
    // 16:9: the photo right, the label on a dark panel left.
    const px0 = W * 0.46;
    e.photo({ x: px0, y: 0, w: W - px0, h: H });
    e.fade(px0, 0, W * 0.12, H, 'left', 0.6);
    const lx1 = px0 - 70 * k;
    mainMark(e, { x: x0, y: y0, w: (lx1 - x0) * 0.6, h: 90 * k });
    const s = Math.min(1, (y1 - y0 - 330 * k) / labelH(e, 1));
    const lTop = y1 - labelH(e, s);
    // The drop number fills the room between the mark and the label.
    const dTop = y0 + 90 * k + 40 * k;
    dropNo(e, x0, dTop, Math.max(60 * k, lTop - dTop - 16 * k - 16 * k - 50 * k), 16 * k, 'left');
    label(e, x0, lx1, lTop, s);
}

export default {
    id: 'kit-drop',
    name: 'Kit Drop',
    category: 'Move',
    blurb: 'A product drop set like the label on the box: the brand big, the drop number, colourway, a size run with sold-out sizes struck, when it lands.',
    refs: 'a shoebox label',
    headlineFont: 'anton',
    fields: [
        { key: 'dropLabel', label: 'Drop label', value: 'Drop' },
        { key: 'drop', label: 'Drop number', value: '03' },
        { key: 'product', label: 'Product', value: 'Training tee' },
        { key: 'colourway', label: 'Colourway', value: 'Washed black' },
        { key: 'sizes', label: 'Size run', value: 'XS S (M) L (XL)', hint: 'Split with spaces. Put a size in (brackets) to strike it out as sold out.' },
        { key: 'when', label: 'When it drops', value: 'Thu 01 Oct · 10:00' },
        { key: 'line', label: 'Line', value: 'Members first, in the POWR app.' },
        // A drop is the partner's post: their name leads by default.
        ...BRAND_FIELDS.map((f) => (f.key === 'brand' ? { ...f, hint: 'Their logo or name leads the post — pick their reward above, or type it. Empty for a POWR drop.' } : f)),
    ],
    presets: [
        { name: 'Partner drop', fields: { dropLabel: 'Drop', drop: '03', product: 'Training tee', colourway: 'Washed black', sizes: 'XS S (M) L (XL)', when: 'Thu 01 Oct · 10:00', line: 'Members first, in the POWR app.' } },
        { name: 'POWR merch', fields: { dropLabel: 'Drop', drop: '01', product: 'POWR club hoodie', colourway: 'Carbon', sizes: 'S M L XL', when: 'Unlock with points', line: 'Earned, not given.' } },
        { name: 'Restock', fields: { dropLabel: 'Restock', drop: '02', product: 'Lifting shorts', colourway: 'Stone', sizes: '(XS) S M (L) XL XXL', when: 'Back in · Mon 12 Oct', line: 'Three sizes left last time.' } },
        { name: 'Shoes', fields: { dropLabel: 'Drop', drop: '07', product: 'Tempo trainer', colourway: 'Chalk / Volt', sizes: '6 7 (8) 9 (10) 11 12', when: 'Sat 17 Oct · 09:00', line: 'In store at Northside.' } },
    ],
    look: {
        mono: 1, target: 0.26, auto: 0.85, contrast: 0.42, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.4, grain: 0.4, size: 1,
        logoColor: 'auto',
    },
    controls: [
        { key: 'logoColor', label: 'Logo colour', options: [['auto', 'Auto'], ['original', 'Original'], ['white', 'White'], ['accent', 'Accent']] },
    ],
    fill: {
        reward: (r) => ({ ...rewardWords(r), line: r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''} with points, in the POWR app.` : 'Members first, in the POWR app.' }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.3, 'top', 0.62);

        // The label panel: solid enough to read as a printed label.
        const s = sq ? 0.8 : tall ? 1.08 : 1;
        const lh = labelH(e, s);
        const pad = (sq ? 36 : 48) * u;
        const panelTop = H - safe.b - lh - pad * 1.6 - (tall ? 10 * u : 0);
        e.fade(0, panelTop - H * 0.2, W, H * 0.2, 'bottom', 0.5);
        ctx.fillStyle = 'rgba(12,12,11,0.84)';
        ctx.fillRect(0, panelTop, W, H - panelTop);
        rule(ctx, 0, panelTop, W, panelTop, HAIR, Math.max(1, 1.2 * u));
        label(e, x0, x1, panelTop + pad, s);

        const top = safe.t + (tall ? 16 : 4) * u;
        const markH = (tall ? 120 : sq ? 84 : 104) * u;
        e.shade({ x: x0, y: top, w: W * 0.46, h: markH }, { ceiling: 0.3, max: 0.5 });
        mainMark(e, { x: x0, y: top, w: W * 0.46, h: markH });
        const dPx = (tall ? 190 : sq ? 130 : 170) * u;
        e.shade({ x: x1 - W * 0.25, y: top, w: W * 0.25, h: dPx + 40 * u }, { ceiling: 0.3, max: 0.5 });
        dropNo(e, x1, top, dPx, (sq ? 16 : 18) * u);
    },
};
