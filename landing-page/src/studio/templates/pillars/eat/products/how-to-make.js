/**
 * HOW TO MAKE — the three steps on the side of the tub, drawn: a scoop, a
 * glass with its measure, a shaker. Each in a fine ring with its number and
 * a short label; the product stands beside them. Down the page on posts and
 * stories, across on banners. For protein, drinks and supplement brands.
 */
import { TYPE } from '../../../../fonts';
import { ring } from '../../../../shapes';
import { capHeight, wrapLines, drawText } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, lockup, rewardWords } from '../../kit';
import { LOOK } from '../_parts';
import { unitOf, ground, glow, slot, backdrop, eyebrow, head, para, paraLines, rows, lift, alpha, SOFT, GREY, INK, fitPx } from './_parts';

// ── Icons: line drawings in a square of side s at (x, y), ink with the accent

function scoop(ctx, x, y, s, lw, acc) {
    const cx = x + s * 0.4;
    const cy = y + s * 0.52;
    const r = s * 0.27;
    // Powder heaped over the rim.
    ctx.fillStyle = acc;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.96, cy);
    ctx.bezierCurveTo(cx - r * 0.7, cy - r * 0.95, cx + r * 0.7, cy - r * 0.95, cx + r * 0.96, cy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.arc(cx, cy, r, Math.PI, 0, true);
    ctx.lineTo(cx - r, cy);
    ctx.stroke();
    // The handle.
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.9, cy + r * 0.35);
    ctx.lineTo(x + s * 0.95, y + s * 0.3);
    ctx.lineTo(x + s * 0.98, y + s * 0.37);
    ctx.lineTo(cx + r * 0.98, cy + r * 0.62);
    ctx.stroke();
}

function glass(ctx, x, y, s, lw, acc) {
    const top = y + s * 0.14;
    const bot = y + s * 0.88;
    const tw = s * 0.52;
    const bw = s * 0.4;
    const cx = x + s / 2;
    const at = (t) => [cx - (tw + (bw - tw) * t) / 2, cx + (tw + (bw - tw) * t) / 2];
    // Liquid to the measure line.
    const fill = 0.3;
    const [l1, r1] = at(fill);
    ctx.fillStyle = alpha(acc, 0.55);
    ctx.beginPath();
    ctx.moveTo(l1, top + (bot - top) * fill);
    ctx.lineTo(r1, top + (bot - top) * fill);
    ctx.lineTo(cx + bw / 2, bot);
    ctx.lineTo(cx - bw / 2, bot);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, top);
    ctx.lineTo(cx - bw / 2, bot);
    ctx.lineTo(cx + bw / 2, bot);
    ctx.lineTo(cx + tw / 2, top);
    ctx.stroke();
    // Measure ticks on the side.
    [0.3, 0.52, 0.74].forEach((t, i) => {
        const [lx] = at(t);
        const yy = top + (bot - top) * t;
        ctx.beginPath();
        ctx.moveTo(lx + lw * 1.5, yy);
        ctx.lineTo(lx + (i === 0 ? s * 0.13 : s * 0.07), yy);
        ctx.stroke();
    });
}

function shaker(ctx, x, y, s, lw, acc) {
    const cx = x + s / 2;
    const bw = s * 0.36;
    const top = y + s * 0.3;
    const bot = y + s * 0.9;
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2, top, bw, bot - top, lw * 2);
    ctx.stroke();
    // Lid and spout.
    ctx.beginPath();
    ctx.moveTo(cx - bw / 2 - lw, top);
    ctx.lineTo(cx - bw * 0.38, y + s * 0.2);
    ctx.lineTo(cx + bw * 0.38, y + s * 0.2);
    ctx.lineTo(cx + bw / 2 + lw, top);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(cx - bw * 0.12, y + s * 0.1, bw * 0.24, s * 0.1, lw);
    ctx.stroke();
    ctx.fillStyle = alpha(acc, 0.55);
    ctx.fillRect(cx - bw / 2 + lw, top + (bot - top) * 0.38, bw - lw * 2, (bot - top) * 0.62 - lw);
    // Motion either side.
    [-1, 1].forEach((d) => {
        [0.42, 0.6].forEach((t, i) => {
            const xx = cx + d * (bw / 2 + s * (0.1 + i * 0.07));
            ctx.beginPath();
            ctx.moveTo(xx, y + s * t);
            ctx.lineTo(xx, y + s * (t + 0.14));
            ctx.stroke();
        });
    });
}

const ICONS = [scoop, glass, shaker];

// An icon in its ring, centred at (cx, cy) radius r.
function badge(e, i, cx, cy, r, U) {
    const { ctx } = e;
    ctx.fillStyle = '#141413';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ring(ctx, cx, cy, r, alpha(INK, 0.28), Math.max(1, 1.3 * U));
    const s = r * 1.2;
    const lw = Math.max(1.2, r * 0.045);
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ICONS[i % 3](ctx, cx - s / 2, cy - s / 2, s, lw, lift(e.accent));
    ctx.restore();
}

// Step text: number, label, detail; (x, top) top-left. Returns its height.
function stepText(e, i, it, x, top, w, U, { px = 34, align = 'left' } = {}) {
    const { ctx } = e;
    const nPx = 17 * U;
    const lPx = px * U;
    const num = String(i + 1).padStart(2, '0');
    drawText(ctx, num, TYPE.mono, nPx, x, top + capHeight(ctx, TYPE.mono, nPx), { align, tracking: 0.14, color: lift(e.accent) });
    const ls = wrapLines(ctx, it[0], TYPE.brandSB, lPx, w, 2);
    const ly = top + nPx * 1.9 + capHeight(ctx, TYPE.brandSB, lPx);
    const b = drawText(ctx, ls.join('\n'), TYPE.brandSB, lPx, x, ly, { align, color: INK, leading: 1.15 });
    if (b) e.mark('steps', b);
    let h = nPx * 1.9 + capHeight(ctx, TYPE.brandSB, lPx) + (ls.length - 1) * lPx * 1.15;
    const d = String(it[1] ?? '').trim();
    if (d) {
        const dPx = lPx * 0.62;
        const db = drawText(ctx, d, TYPE.brandL, fitPx(ctx, d, TYPE.brandL, dPx, w), x, top + h + dPx * 1.6, { align, color: SOFT });
        if (db) e.mark('steps', db);
        h += dPx * 1.6;
    }
    return h;
}

// Down the page: rings on a dotted spine, text right of them.
function column(e, x, top, bottom, w, U, { r: r0 = 70, px = 34 } = {}) {
    const { ctx } = e;
    const r = r0 * U;
    const steps = rows(e.fields.steps, 3).filter((s) => s[0]);
    if (!steps.length) return;
    const n = steps.length;
    const pitch = Math.min((bottom - top) / n, r * 3.4);
    const y0 = top + ((bottom - top) - pitch * n) / 2 + pitch / 2;
    const cx = x + r;
    ctx.save();
    ctx.strokeStyle = alpha(INK, 0.3);
    ctx.lineWidth = Math.max(1, 1.3 * U);
    ctx.setLineDash([2 * U, 6 * U]);
    ctx.beginPath();
    ctx.moveTo(cx, y0);
    ctx.lineTo(cx, y0 + pitch * (n - 1));
    ctx.stroke();
    ctx.restore();
    steps.forEach((it, i) => {
        const cy = y0 + pitch * i;
        badge(e, i, cx, cy, r, U);
        const tx = x + r * 2 + 34 * U;
        stepText(e, i, it, tx, cy - r * 0.62, w - (tx - x), U, { px });
    });
}

// Across: rings in a row with text under; chevrons between.
function across(e, x, top, w, U, { r: r0 = 70, px = 30 } = {}) {
    const { ctx } = e;
    const r = Math.min(r0 * U, (w / 3 - 60 * U) / 2);
    const steps = rows(e.fields.steps, 3).filter((s) => s[0]);
    const n = steps.length;
    if (!n) return;
    const cw = w / n;
    steps.forEach((it, i) => {
        const cx = x + cw * i + r;
        badge(e, i, cx, top + r, r, U);
        if (i < n - 1) {
            const ax = x + cw * (i + 1) - 30 * U;
            ctx.save();
            ctx.strokeStyle = alpha(INK, 0.45);
            ctx.lineWidth = Math.max(1, 1.6 * U);
            ctx.beginPath();
            ctx.moveTo(cx + r + 24 * U, top + r);
            ctx.lineTo(ax, top + r);
            ctx.moveTo(ax - 9 * U, top + r - 9 * U);
            ctx.lineTo(ax, top + r);
            ctx.lineTo(ax - 9 * U, top + r + 9 * U);
            ctx.stroke();
            ctx.restore();
        }
        stepText(e, i, it, x + cw * i, top + r * 2 + 30 * U, cw - 30 * U, U, { px });
    });
}

function strip(e) {
    const { W, H, safe, tu: U } = e;
    const f = e.fields;
    ground(e);
    backdrop(e);
    const pw = H * 0.55;
    const pbox = { x: safe.l, y: safe.t + 10 * U, w: pw, h: H - safe.t - safe.b - 10 * U };
    glow(e, pbox.x + pw / 2, H * 0.6, pw * 0.7, { strength: 0.55 });
    slot(e, pbox, { kind: e.look.kind ?? 'tub', sub: e.fields.sub });
    const x = pbox.x + pw + 60 * U;
    const w = W - safe.r - x;
    lockup(e, W - safe.r, safe.t, 26 * U, { align: 'right', maxW: w * 0.3 });
    eyebrow(e, 'kicker', f.kicker, 17 * U, x, safe.t + 17 * U, { maxW: w * 0.6, color: lift(e.accent) });
    across(e, x, safe.t + 70 * U, w, U, { r: 62, px: 26 });
}

export default {
    id: 'eat-how-to-make',
    name: 'How to Make',
    category: 'Eat',
    section: 'Products',
    blurb: 'Three drawn steps (scoop, glass, shake) with numbers and short labels, the product standing beside them. For protein, drinks and supplement brands.',
    refs: 'the instructions panel on the side of a tub',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'Kicker', value: 'How to make it' },
        { key: 'title', label: 'Title', rows: 2, value: 'One shake,\nthree steps.' },
        { key: 'steps', label: 'Steps', rows: 3, value: 'One scoop | 30g\nCold milk or water | 300 ml\nShake | 20 seconds', hint: 'Three, one per line: what to do | how much. The icons are a scoop, a glass and a shaker, in that order.' },
        { key: 'sub', label: 'Flavour (on the stand-in)', value: 'Salted Caramel' },
        { key: 'note', label: 'Line', value: 'Makes one 330 ml shake. Northside Whey, in the POWR rewards.', hint: 'Leave empty to hide it.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Protein shake', fields: {}, look: { kind: 'tub' } },
        { name: 'Electrolytes', fields: { kicker: 'Mixing', title: 'Stick, bottle,\nshake.', steps: 'One stick | 5g\nWater | 500 ml\nShake | 10 seconds', sub: 'Yuzu & Lime', note: 'Serve cold. Northside Hydrate, 20 sticks a box.' }, look: { kind: 'box' }, style: { accent: '#C6E86B' } },
        { name: 'Greens powder', fields: { kicker: 'Morning routine', title: 'Before\nthe coffee.', steps: 'One level scoop | 12g\nCold water | 250 ml\nShake | 15 seconds', sub: 'Mint & Lime', note: 'Food supplement. One serving a day.' }, look: { kind: 'pouch' }, style: { accent: '#7FE0C2' } },
        { name: 'Overnight oats', fields: { kicker: 'Make it tonight', title: 'Ready by\nmorning.', steps: 'Two scoops | 80g\nOat milk | 200 ml\nShake, then chill | overnight', sub: 'Cherry Bakewell', note: 'Northside Oats · 10 servings a pouch.' }, look: { kind: 'pouch' }, style: { accent: '#E0556B' } },
    ],
    look: { ...LOOK, kind: 'tub' },
    controls: [
        { key: 'kind', label: 'Stand-in product', options: [['tub', 'Tub'], ['pouch', 'Pouch'], ['box', 'Box'], ['jar', 'Jar'], ['bottle', 'Bottle']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.offer ? { note: r.offer } : {}) }) },

    draw(e) {
        const { W, H, safe, shape } = e;
        if (shape === 'strip') return strip(e);
        const U = unitOf(e);
        const f = e.fields;
        ground(e);
        backdrop(e);
        const kind = e.look.kind ?? 'tub';
        if (shape === 'wide') {
            const pw = W * 0.3;
            const pbox = { x: safe.l, y: safe.t + 110 * U, w: pw, h: H - safe.t - safe.b - 110 * U };
            glow(e, pbox.x + pw / 2, H * 0.6, pw * 0.75, { strength: 0.6 });
            slot(e, pbox, { kind, sub: f.sub });
            lockup(e, safe.l, safe.t, 40 * U, { maxW: pw });
            const x = safe.l + pw + 100 * U;
            const w = W - safe.r - x;
            eyebrow(e, 'kicker', f.kicker, 20 * U, x, safe.t + 20 * U, { maxW: w, color: lift(e.accent) });
            const t = head(e, 'title', f.title, x, safe.t + 60 * U, { maxW: w * 0.8, maxH: 200 * U, lines: 2 });
            const nl = paraLines(e, f.note, TYPE.brandL, 22 * U, w, 2);
            if (nl) para(e, 'note', f.note, TYPE.brandL, 22 * U, x, H - safe.b - (nl - 1) * 22 * U * 1.32, w, 2, { color: GREY });
            across(e, x, t.bottom + 80 * U, w, U, { r: 88, px: 32 });
            return;
        }
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x = safe.l + 4 * U;
        const w = W - safe.r - 4 * U - x;
        const lk = lockup(e, x, safe.t + 4 * U, 40 * U, { maxW: w * 0.6 });
        eyebrow(e, 'kicker', f.kicker, 19 * U, x + w, lk.y + lk.h * 0.5 + 7 * U, { align: 'right', color: lift(e.accent), maxW: w * 0.36 });
        const t = head(e, 'title', f.title, x, lk.y + lk.h + (tall ? 80 : 56) * U, { maxW: w * 0.85, maxH: (tall ? 230 : sq ? 130 : 180) * U, lines: 2 });
        const nl = paraLines(e, f.note, TYPE.brandL, 22 * U, w, 2);
        if (nl) para(e, 'note', f.note, TYPE.brandL, 22 * U, x, H - safe.b - (nl - 1) * 22 * U * 1.32, w, 2, { color: GREY });
        const bottom = H - safe.b - (nl ? (nl - 1) * 22 * U * 1.32 + 22 * U + 40 * U : 0);
        // The product on the right, the steps down the left.
        const pw = w * (sq ? 0.36 : 0.4);
        const top = t.bottom + (tall ? 70 : 50) * U;
        const pbox = { x: x + w - pw, y: top + (bottom - top) * (tall ? 0.3 : 0.18), w: pw, h: (bottom - top) * (tall ? 0.7 : 0.82) };
        glow(e, pbox.x + pw / 2, pbox.y + pbox.h * 0.6, pw * 0.8, { strength: 0.55 });
        slot(e, pbox, { kind, sub: f.sub, frame: 0.72 });
        column(e, x, top, bottom, w - pw - 30 * U, U, { r: sq ? 60 : tall ? 88 : 78, px: sq ? 30 : 36 });
    },
};
