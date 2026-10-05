/**
 * SWING TAG — the product with its price tag hanging beside it: a drawn
 * card tag (chamfered top, a punched and ringed hole, the string running
 * up to the product), printed with the maker, the name, size and colour,
 * the price, and an accent band: "or 3,200 POWR points". For kit, footwear
 * and gym merch sold for money or for points.
 */
import { TYPE } from '../../../../fonts';
import { drawText, wrapLines } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup, textOn } from '../../kit';
import { SOFT, frame, ground, backdrop, fitPx, makerOf, mono, cap } from './_parts';
import { thousands } from '../../../../words';

const PAPER = '#EEEAE1';
const PRINT = '#111111';
const PRINT_SOFT = 'rgba(17,17,17,0.56)';
const PRINT_HAIR = 'rgba(17,17,17,0.16)';

const rowsOf = (e) => [['size', 'Size'], ['colour', 'Colour'], ['code', 'Style']]
    .map(([key, label]) => ({ key, label, v: String(e.fields[key] ?? '').trim() }))
    .filter((r) => r.v);

// The tag's outline: chamfered at the hole end.
function tagPath(ctx, x, y, w, h, c, horizontal) {
    ctx.beginPath();
    if (horizontal) {
        ctx.moveTo(x + c, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + c, y + h);
        ctx.lineTo(x, y + h - c);
        ctx.lineTo(x, y + c);
    } else {
        ctx.moveTo(x + c, y);
        ctx.lineTo(x + w - c, y);
        ctx.lineTo(x + w, y + c);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + c);
    }
    ctx.closePath();
}

// The string: from the hole up to `to`, a soft sag.
function string(ctx, from, to, k) {
    ctx.save();
    ctx.strokeStyle = 'rgba(244,241,234,0.72)';
    ctx.lineWidth = Math.max(1.2, 2 * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    const mx = (from.x + to.x) / 2;
    ctx.bezierCurveTo(mx + (to.x - from.x) * 0.1, from.y - Math.abs(to.y - from.y) * 0.1 - 30 * k, mx, to.y + 20 * k, to.x, to.y);
    ctx.stroke();
    ctx.restore();
}

// The accent band with the points line, filling (x, y, w, h).
function band(e, x, y, w, h, pad) {
    const { ctx } = e;
    const t = String(e.fields.points ?? '').trim();
    if (!t) return;
    ctx.fillStyle = e.accent;
    ctx.fillRect(x, y, w, h);
    const px = fitPx(ctx, t, TYPE.brandSB, h * 0.34, w - pad * 2);
    e.mark('points', drawText(ctx, t, TYPE.brandSB, px, x + pad, y + h / 2 + cap(e, TYPE.brandSB, px) / 2, { color: textOn(e.accent) }));
}

/**
 * The tag at (x, y, w, h). Upright: hole at the top; horizontal (banners):
 * hole at the left. Returns the hole's centre (where the string ties on).
 */
function tag(e, x, y, w, h, { horizontal = false } = {}) {
    const { ctx } = e;
    const k = frame(e).k;
    const c = (horizontal ? h : w) * 0.16;
    ctx.save();
    tagPath(ctx, x, y, w, h, c, horizontal);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.clip();
    // A faint grain of card: a light falling off the top.
    const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const s = horizontal ? h : w;
    const hole = horizontal ? { x: x + c * 0.9, y: y + h / 2 } : { x: x + w / 2, y: y + c * 0.95 };
    const hr = s * 0.05;
    const pad = s * 0.1;
    const bandH = (horizontal ? h : w) * 0.2;
    const hair = Math.max(1, 1.3 * k);
    const x0 = horizontal ? x + c * 1.9 : x + pad;
    const x1 = x + w - pad;
    const top = horizontal ? y + pad * 0.9 : hole.y + hr + pad * 0.8;
    // Maker, letterspaced, then the name.
    const mk = makerOf(e).toUpperCase();
    const mPx = fitPx(ctx, mk, TYPE.brandSB, s * 0.06, (horizontal ? (x1 - x0) * 0.45 : x1 - x0), 0.3);
    drawText(ctx, mk, TYPE.brandSB, mPx, x0, top + cap(e, TYPE.brandSB, mPx), { color: PRINT, tracking: 0.3 });
    let yy = top + cap(e, TYPE.brandSB, mPx) + pad * 0.55;
    rule(ctx, x0, yy, horizontal ? x0 + (x1 - x0) * 0.45 : x1, yy, PRINT_HAIR, hair);
    const nameW = horizontal ? (x1 - x0) * 0.45 : x1 - x0;
    const nPx = s * (horizontal ? 0.13 : 0.12);
    const words = String(e.fields.name ?? '').trim();
    const nl = words ? wrapLines(ctx, words, e.headline, nPx, nameW, 2) : [];
    const np = nl.length ? Math.min(nPx, ...nl.map((l) => fitPx(ctx, l, e.headline, nPx, nameW, -0.01))) : nPx;
    yy += pad * 0.5;
    nl.forEach((l, i) => {
        const b = drawText(ctx, l, e.headline, np, x0, yy + cap(e, e.headline, np) + i * np * 1.08, { color: PRINT, tracking: -0.01 });
        e.mark('name', b);
    });
    yy += nl.length ? cap(e, e.headline, np) + (nl.length - 1) * np * 1.08 : 0;
    // Size · colour · style rows.
    const rows = rowsOf(e);
    const rx0 = horizontal ? x0 + (x1 - x0) * 0.52 : x0;
    const rPx = s * 0.05;
    const rowH = rPx * 2.3;
    let ry = horizontal ? top : yy + pad * 0.6;
    rows.forEach((r) => {
        rule(ctx, rx0, ry, x1, ry, PRINT_HAIR, hair);
        const base = ry + rowH / 2 + cap(e, TYPE.mono, rPx * 0.8) / 2;
        drawText(ctx, r.label.toUpperCase(), TYPE.mono, rPx * 0.8, rx0, base, { color: PRINT_SOFT, tracking: 0.16 });
        const vp = fitPx(ctx, r.v, TYPE.brandM, rPx * 1.15, (x1 - rx0) * 0.6);
        e.mark(r.key, drawText(ctx, r.v, TYPE.brandM, vp, x1, ry + rowH / 2 + cap(e, TYPE.brandM, vp) / 2, { align: 'right', color: PRINT }));
        ry += rowH;
    });
    if (rows.length) rule(ctx, rx0, ry, x1, ry, PRINT_HAIR, hair);
    // Price, big, above the band.
    const bandY = y + h - bandH;
    const pr = String(e.fields.price ?? '').trim();
    if (pr) {
        const pw = horizontal ? (x1 - x0) * 0.45 : x1 - x0;
        const room = horizontal ? bandY - yy - pad * 0.5 : bandY - ry - pad * 0.9;
        let px = Math.min(s * 0.3, room / 0.75);
        px = fitPx(ctx, pr, TYPE.brandL, px, pw, -0.03);
        e.mark('price', drawText(ctx, pr, TYPE.brandL, px, x0 - px * 0.03, bandY - pad * 0.55, { color: PRINT, tracking: -0.03 }));
    }
    band(e, x, bandY, w, bandH, horizontal ? c * 1.9 : pad);
    ctx.restore();
    // The hole: punched through to the ground, with a card reinforcement ring.
    ctx.save();
    ctx.fillStyle = '#0B0B0A';
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(17,17,17,0.22)';
    ctx.lineWidth = hr * 0.5;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hr * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    e.mark('tag', { x, y, w, h });
    return hole;
}

export default {
    id: 'move-swing-tag',
    name: 'Swing Tag',
    category: 'Move',
    section: 'Products',
    blurb: 'The product with its price tag hanging beside it: name, size, colour, price and "or 3,200 POWR points" on a drawn card tag. For kit and merch sold for money or points.',
    refs: 'a garment swing tag',
    headlineFont: 'brandB',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'New in' },
        { key: 'name', label: 'Product name', value: 'Studio tight' },
        { key: 'size', label: 'Size', value: 'XS–XL' },
        { key: 'colour', label: 'Colour', value: 'Black' },
        { key: 'code', label: 'Style code', value: 'NS-0412' },
        { key: 'price', label: 'Price', value: '£68' },
        { key: 'points', label: 'Points line', value: 'or 3,200 POWR points' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Leggings', fields: { eyebrow: 'New in', name: 'Studio tight', size: 'XS–XL', colour: 'Black', code: 'NS-0412', price: '£68', points: 'or 3,200 POWR points' } },
        { name: 'Trainer', fields: { eyebrow: 'Run shop', name: 'Tempo runner', size: 'UK 3–13', colour: 'Chalk / Volt', code: 'TR-2207', price: '£125', points: 'or 5,800 POWR points' } },
        { name: 'Gym merch', fields: { eyebrow: 'At the desk', name: 'POWR club hoodie', size: 'S–XL', colour: 'Carbon', code: '', price: '£55', points: 'Members: 2,400 POWR points' } },
        { name: 'Bottle', fields: { eyebrow: 'Kit bag', name: 'Trail bottle', size: '750 ml', colour: 'Steel', code: 'TB-750', price: '£32', points: 'or 1,500 POWR points' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), ...(r.cost ? { points: `or ${thousands(r.cost)} POWR points` } : {}) }),
    },

    draw(e) {
        const f = frame(e);
        const { W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const opts = { kind: 'bottle', label: makerOf(e), sub: e.fields.name };

        if (strip) {
            const pw = W * 0.2;
            ground(e, { cx: x0 + pw / 2, cy: H * 0.55, r: H * 0.8 });
            backdrop(e);
            const pr = productShot(e, { x: x0, y: y0 + 40 * k, w: pw, h: y1 - y0 - 40 * k }, opts).rect;
            lockup(e, x1, y0, 34 * k, { align: 'right', maxW: W * 0.2 });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x0, y0 + 14 * k, 14 * k, { color: SOFT, maxW: pw }));
            const tx = x0 + pw + 140 * k;
            const tw = Math.min(W * 0.5, x1 - W * 0.22 - tx);
            const hole = tag(e, tx, y0 + 50 * k, tw, y1 - y0 - 50 * k, { horizontal: true });
            string(e.ctx, hole, { x: pr.x + pr.w * 0.8, y: pr.y + pr.h * 0.12 }, k);
            return;
        }

        const lh = (sq ? 46 : 54) * k;
        const side = wide ? 0.44 : sq ? 0.5 : 0.52;
        const pBox = { x: x0, y: y0 + lh + (sq ? 40 : 70) * k, w: (x1 - x0) * side, h: 0 };
        pBox.h = y1 - pBox.y;
        const tx = x0 + (x1 - x0) * (side + (wide ? 0.1 : 0.06));
        let tw = x1 - tx;
        let th = tw * 1.72;
        const room = y1 - (y0 + lh + (tall ? 170 : 90) * k);
        if (th > room) { th = room; tw = th / 1.72; }
        const ty = y1 - th - (tall ? 40 : 0) * k;
        ground(e, { cx: pBox.x + pBox.w / 2, cy: pBox.y + pBox.h * 0.6, r: Math.max(pBox.w, pBox.h * 0.6) });
        backdrop(e);
        const pr = productShot(e, pBox, opts).rect;
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, (sq ? 16 : 18) * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        const tagX = x1 - tw;
        const hole = { x: tagX + tw / 2, y: ty + tw * 0.16 * 0.95 };
        string(e.ctx, hole, { x: pr.x + pr.w * 0.86, y: pr.y + Math.min(pr.h * 0.1, 60 * k) }, k);
        tag(e, tagX, ty, tw, th);
    },
};
