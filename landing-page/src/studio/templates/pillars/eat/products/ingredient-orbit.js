/**
 * INGREDIENT ORBIT — the product at the centre of a fine orbit, its
 * ingredients set around it: a dot on the ring for each, a hairline out to
 * its name and (optionally) how much. The flavour under it all. Across a
 * banner the orbit unrolls into a line. For brands with a short ingredient
 * list they are proud of.
 */
import { TYPE } from '../../../../fonts';
import { rule, dot, ring } from '../../../../shapes';
import { wrapLines, drawText, capHeight } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, backdrop, eyebrow, head, headHeight, para, paraLines, rows, lift, alpha, SOFT, GREY, INK } from './_parts';

// One label: the name (wrapped) and the amount under it, block centred on y.
function label(e, item, x, y, w, U, align, px) {
    const { ctx } = e;
    const ls = wrapLines(ctx, item[0], TYPE.brandR, px, w, 2);
    const aPx = px * 0.72;
    const amt = String(item[1] ?? '').trim();
    const h = (ls.length - 1) * px * 1.2 + capHeight(ctx, TYPE.brandR, px) + (amt ? aPx * 1.7 : 0);
    const top = y - h / 2;
    const cap = capHeight(ctx, TYPE.brandR, px);
    const b = drawText(ctx, ls.join('\n'), TYPE.brandR, px, x, top + cap, { align, color: INK, leading: 1.2 });
    if (b) e.mark('ingredients', b);
    if (amt) {
        const ab = drawText(ctx, e.caps(amt), TYPE.mono, aPx, x, top + cap + (ls.length - 1) * px * 1.2 + aPx * 1.7, { align, tracking: 0.12, color: lift(e.accent) });
        if (ab) e.mark('ingredients', ab);
    }
}

/**
 * The orbit at (cx, cy) radius R: glow, ring, the product inside, and the
 * ingredients split left and right. `reach` is how far labels may run from
 * the centre on each side (to the safe edge).
 */
function orbit(e, cx, cy, R, U, { reach, spread = 52, px = 23 }) {
    const { ctx } = e;
    const items = rows(e.fields.ingredients, 6).filter((r) => r[0]);
    glow(e, cx, cy, R * 1.05, { strength: 0.7 });
    ctx.save();
    ctx.setLineDash([2 * U, 7 * U]);
    ring(ctx, cx, cy, R, alpha(INK, 0.45), Math.max(1, 1.4 * U));
    ctx.restore();
    ring(ctx, cx, cy, R * 0.8, alpha(INK, 0.08), Math.max(1, 1 * U));
    const box = { x: cx - R * 0.62, y: cy - R * 0.66, w: R * 1.24, h: R * 1.3 };
    slot(e, box, { kind: e.look.kind ?? 'tub', sub: String(e.fields.flavour ?? '').replace(/\s*\n\s*/g, ' '), frame: 0.8, valign: 'center', stage: 0.8 });
    const right = items.slice(0, Math.ceil(items.length / 2));
    const left = items.slice(right.length);
    const lead = 34 * U;
    const gap = 16 * U;
    const labelX = R + lead + 22 * U;
    const lw = reach - labelX;
    [[right, 1], [left, -1]].forEach(([side, dir]) => {
        side.forEach((it, k) => {
            const m = side.length;
            const deg = m === 1 ? 0 : -spread + (2 * spread * k) / (m - 1);
            const t = (deg * Math.PI) / 180;
            const dx = Math.cos(t) * dir;
            const dy = Math.sin(t);
            const px0 = cx + dx * R;
            const py0 = cy + dy * R;
            const p1 = { x: cx + dx * (R + lead), y: cy + dy * (R + lead) };
            const lx = cx + dir * labelX;
            ctx.save();
            ctx.strokeStyle = alpha(INK, 0.4);
            ctx.lineWidth = Math.max(1, 1.2 * U);
            ctx.beginPath();
            ctx.moveTo(px0, py0);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(lx - dir * gap, p1.y);
            ctx.stroke();
            ctx.restore();
            dot(ctx, px0, py0, 6 * U, lift(e.accent));
            dot(ctx, px0, py0, 2.4 * U, '#0C0C0B');
            label(e, it, lx, p1.y, lw, U, dir > 0 ? 'left' : 'right', px * U);
        });
    });
}

// Banner strip: the orbit unrolled into a line of dots with the names under.
function strip(e) {
    const { ctx, W, H, safe, tu: U } = e;
    const f = e.fields;
    ground(e);
    backdrop(e);
    const pw = H * 0.62;
    const pbox = { x: safe.l, y: safe.t + 10 * U, w: pw, h: H - safe.t - safe.b - 10 * U };
    glow(e, pbox.x + pw / 2, H * 0.55, pw * 0.7, { strength: 0.6 });
    slot(e, pbox, { kind: e.look.kind ?? 'tub', sub: String(f.flavour ?? '').replace(/\s*\n\s*/g, ' ') });
    const x = pbox.x + pw + 60 * U;
    const w = W - safe.r - x;
    const lk = lockup(e, W - safe.r, safe.t, 26 * U, { align: 'right', maxW: w * 0.3 });
    eyebrow(e, 'name', f.name, 17 * U, x, safe.t + 17 * U, { maxW: w * 0.6, color: lift(e.accent) });
    const t = head(e, 'flavour', f.flavour, x, safe.t + 44 * U, { maxW: w * 0.6, maxH: 90 * U, lines: 1 });
    const items = rows(f.ingredients, 6).filter((r) => r[0]);
    const ly = Math.max(t.bottom + 60 * U, lk.y + lk.h + 60 * U);
    rule(ctx, x, ly, x + w, ly, alpha(INK, 0.35), Math.max(1, 1.2 * U));
    const cw = w / Math.max(1, items.length);
    const px = 21 * U;
    items.forEach((it, i) => {
        const dx = x + cw * i;
        dot(ctx, dx + 6 * U, ly, 6 * U, lift(e.accent));
        dot(ctx, dx + 6 * U, ly, 2.4 * U, '#0C0C0B');
        const ls = wrapLines(ctx, it[0], TYPE.brandR, px, cw - 20 * U, 2);
        const b = drawText(ctx, ls.join('\n'), TYPE.brandR, px, dx, ly + 30 * U + px * 0.8, { color: INK, leading: 1.2 });
        if (b) e.mark('ingredients', b);
        const amt = String(it[1] ?? '').trim();
        if (amt) e.mark('ingredients', drawText(ctx, e.caps(amt), TYPE.mono, px * 0.75, dx, ly + 30 * U + px * 0.8 + (ls.length - 1) * px * 1.2 + px * 1.5, { tracking: 0.12, color: lift(e.accent) }));
    });
    para(e, 'note', f.note, TYPE.brandL, 15 * U, x, H - safe.b, w, 1, { color: GREY });
}

export default {
    id: 'eat-ingredient-orbit',
    name: 'Ingredient Orbit',
    category: 'Eat',
    section: 'Products',
    blurb: 'The product at the centre of a fine orbit, each ingredient on a dot around it with how much. For brands with a short list worth showing.',
    refs: 'a planetarium diagram, for a tub',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'What’s inside' },
        { key: 'name', label: 'Product name', value: 'Northside Whey' },
        { key: 'flavour', label: 'Flavour', rows: 2, value: 'Salted Caramel' },
        {
            key: 'ingredients', label: 'Ingredients', rows: 6,
            value: 'Whey protein (milk) | 82%\nCocoa butter | 6%\nCaramel flavouring\nSea salt | 0.4%\nSucralose',
            hint: 'Up to six, one per line: name | how much (optional). Allergens as on your pack.',
        },
        { key: 'note', label: 'Line', value: 'Allergens: milk. Full ingredients on the pack.', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein', fields: {}, look: { kind: 'tub' } },
        { name: 'Granola', fields: { kicker: 'Six things, baked', name: 'Northside Granola', flavour: 'Cacao & Hazelnut', ingredients: 'Jumbo oats | 52%\nHazelnuts | 14%\nCacao nibs | 8%\nCoconut oil\nMaple syrup\nSea salt', note: 'Contains oats (gluten) and hazelnuts.' }, look: { kind: 'pouch' }, style: { accent: '#D9A066' } },
        { name: 'Nut butter', fields: { kicker: 'Two ingredients', name: 'Northside Kitchen', flavour: 'Smooth Peanut', ingredients: 'Roasted peanuts | 99%\nSea salt | 1%', note: 'Contains peanuts. Stir before spreading.' }, look: { kind: 'jar' }, style: { accent: '#C98A4B' } },
        { name: 'Electrolytes', fields: { kicker: 'In every stick', name: 'Northside Hydrate', flavour: 'Yuzu & Lime', ingredients: 'Sodium citrate\nPotassium chloride\nMagnesium citrate\nYuzu juice powder\nNatural lime flavouring', note: 'Food supplement. One stick to 500 ml water.' }, look: { kind: 'box' }, style: { accent: '#C6E86B' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['jar', 'Jar'], ['pouch', 'Pouch'], ['box', 'Box'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), name: r.brand }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        if (shape === 'strip') return strip(e);
        const U = unitOf(e);
        const f = e.fields;
        ground(e);
        backdrop(e);
        if (shape === 'wide') {
            const x = safe.l;
            const colW = W * 0.26;
            lockup(e, x, safe.t, 40 * U, { maxW: colW });
            const nl = paraLines(e, f.note, TYPE.brandL, 21 * U, colW, 3);
            let y = H - safe.b;
            if (nl) { para(e, 'note', f.note, TYPE.brandL, 21 * U, x, y - (nl - 1) * 21 * U * 1.32, colW, 3, { color: GREY }); y -= (nl - 1) * 21 * U * 1.32 + 21 * U + 40 * U; }
            const fh = headHeight(e, f.flavour, { maxW: colW, maxH: 200 * U, lines: 2 });
            head(e, 'flavour', f.flavour, x, y - fh, { maxW: colW, maxH: 200 * U, lines: 2 });
            eyebrow(e, 'name', f.name, 20 * U, x, y - fh - 28 * U, { maxW: colW, color: lift(e.accent) });
            eyebrow(e, 'kicker', f.kicker, 20 * U, W - safe.r, safe.t + 20 * U, { align: 'right', color: SOFT });
            const cx = W * 0.64;
            const cy = H * 0.52;
            const R = Math.min(H * 0.3, 300 * U);
            orbit(e, cx, cy, R, U, { reach: W - safe.r - cx, spread: 50, px: 29 });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: SOFT, maxW: w * 0.36 });
        // Bottom-up: note, flavour, name.
        const cx = W / 2;
        let y = H - safe.b;
        const nl = paraLines(e, f.note, TYPE.brandL, 21 * U, w, 2);
        if (nl) { para(e, 'note', f.note, TYPE.brandL, 21 * U, cx, y - (nl - 1) * 21 * U * 1.32, w, 2, { color: GREY, align: 'center' }); y -= (nl - 1) * 21 * U * 1.32 + 21 * U + 36 * U; }
        const maxH = (tall ? 150 : sq ? 96 : 140) * U;
        const fh = headHeight(e, f.flavour, { maxW: w, maxH, lines: 2 });
        head(e, 'flavour', f.flavour, cx, y - fh, { maxW: w, maxH, align: 'center', lines: 2 });
        y -= fh + 26 * U;
        eyebrow(e, 'name', f.name, 20 * U, cx, y, { maxW: w, align: 'center', color: lift(e.accent) });
        y -= 20 * U;
        const top = lk.y + lk.h + 40 * U;
        const bottom = y - 40 * U;
        const cy = (top + bottom) / 2;
        const R = Math.min((bottom - top) / 2 - 20 * U, (tall ? 240 : sq ? 190 : 245) * U);
        orbit(e, cx, cy, R, U, { reach: W - safe.r - cx, spread: sq ? 52 : 62, px: sq ? 23 : 26 });
    },
};
