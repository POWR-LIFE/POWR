/**
 * STILL LIFE — the product alone on a drawn plinth (a lit stone cylinder or
 * block) in a pool of soft light from above, a lot of room round it, the
 * name small in serif and the price smaller still. The wall behind can
 * carry a glow in the brand's colour, or be the brand's colour. For candles,
 * journals, oils — anything that sells on how it looks.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, DIM, frame, ground, veil, footRow, headColor, glow, mix, framedShot, footH, onAccent,
    lineItem, blockItem, priceItem, stack, stackH, productFill,
} from './_parts';

const STONE = ['#181715', '#3a3631', '#2a2724', '#141312', '#211f1d'];

// A stone plinth whose top face is centred on cx at topY. Returns where the
// product stands (baseY) and the plinth's bottom.
function plinth(e, cx, topY, w, h, form) {
    const { ctx } = e;
    const x = cx - w / 2;
    ctx.save();
    const side = ctx.createLinearGradient(x, 0, x + w, 0);
    [0, 0.28, 0.55, 0.9, 1].forEach((t, i) => side.addColorStop(t, STONE[i]));
    if (form === 'block') {
        const d = w * 0.13;
        const inset = w * 0.07;
        ctx.fillStyle = side;
        ctx.fillRect(x, topY + d, w, h);
        const top = ctx.createLinearGradient(0, topY, 0, topY + d);
        top.addColorStop(0, '#2a2723');
        top.addColorStop(1, '#3d3934');
        ctx.fillStyle = top;
        ctx.beginPath();
        ctx.moveTo(x + inset, topY);
        ctx.lineTo(x + w - inset, topY);
        ctx.lineTo(x + w, topY + d);
        ctx.lineTo(x, topY + d);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,250,235,0.16)';
        ctx.fillRect(x, topY + d, w, Math.max(1, w * 0.004));
        ctx.restore();
        return { baseY: topY + d * 0.62, bottom: topY + d + h };
    }
    const ry = w * 0.085;
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(x, topY + ry);
    ctx.lineTo(x, topY + ry + h);
    ctx.ellipse(cx, topY + ry + h, w / 2, ry, 0, Math.PI, 0, true);
    ctx.lineTo(x + w, topY + ry);
    ctx.closePath();
    ctx.fill();
    const top = ctx.createLinearGradient(0, topY, 0, topY + ry * 2);
    top.addColorStop(0, '#2a2723');
    top.addColorStop(1, '#3f3b36');
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.ellipse(cx, topY + ry, w / 2, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,235,0.18)';
    ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath();
    ctx.ellipse(cx, topY + ry, w / 2, ry, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    return { baseY: topY + ry * 1.1, bottom: topY + ry * 2 + h };
}

// The light: a soft cone falling from above onto the plinth.
function cone(e, cx, y0, y1, w0, w1, alpha) {
    const { ctx } = e;
    ctx.save();
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(255,248,232,0)');
    g.addColorStop(0.5, `rgba(255,248,232,${alpha * 0.5})`);
    g.addColorStop(1, `rgba(255,248,232,${alpha})`);
    ctx.fillStyle = g;
    ctx.filter = `blur(${Math.round(w0 * 0.25)}px)`;
    ctx.beginPath();
    ctx.moveTo(cx - w0 / 2, y0);
    ctx.lineTo(cx + w0 / 2, y0);
    ctx.lineTo(cx + w1 / 2, y1);
    ctx.lineTo(cx - w1 / 2, y1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Wall and floor, the light, the plinth and the product. `stage` is the box
// the whole group may use; the plinth sits on its bottom edge.
function scene(e, st, k) {
    const { ctx, W } = e;
    const form = e.look.plinth ?? 'cylinder';
    const framed = framedShot(e);
    const pw = Math.min(st.w * 0.6, st.h * 0.56);
    const ph = pw * (form === 'block' ? 0.34 : 0.36);
    const cx = st.x + st.w / 2;
    const extra = form === 'block' ? pw * 0.13 : pw * 0.17;
    const topY = st.y + st.h - ph - extra;
    // The floor: the plinth's foot is where the wall meets it.
    const floorY = topY + ph + extra * 0.6;
    const g = ctx.createLinearGradient(0, floorY, 0, floorY + (st.y + st.h - floorY) + 400 * k);
    g.addColorStop(0, 'rgba(8,7,6,0.55)');
    g.addColorStop(1, 'rgba(8,7,6,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, floorY, W, e.H - floorY);
    cone(e, cx, st.y - 200 * k, topY + ph * 0.3, pw * 0.5, pw * 1.5, 0.08);
    glow(e, cx, floorY, pw * 1.1, pw * 0.14, 0.14, '#FFF6E6');
    const p = plinth(e, cx, topY, pw, ph, form);
    // The product: as tall as the room above the plinth allows.
    const room = p.baseY - st.y;
    if (framed) {
        const fw = Math.min(pw * 0.86, room * 0.8);
        const fh = Math.min(room, fw * 1.25);
        productShot(e, { x: cx - fw / 2, y: p.baseY - fh, w: fw, h: fh }, { stage: false, radius: 6 });
    } else {
        // Smaller than the plinth is wide: the space round it is the point.
        const bw = pw * (e.asset('product') ? 0.8 : 0.64);
        const bh = Math.min(room, pw * 1.05);
        productShot(e, { x: cx - bw / 2, y: p.baseY - bh, w: bw, h: bh }, { kind: e.look.kind ?? 'candle', sub: e.fields.sub, stage: true });
    }
    return { floorY, bottom: p.bottom };
}

export default {
    id: 'mind-still-life',
    name: 'Still Life',
    category: 'Mind',
    section: 'Products',
    blurb: 'The product alone on a lit stone plinth, the name small in serif and the price smaller still. A lot of room. For candles, journals and oils.',
    refs: 'a gallery plinth, a museum shop catalogue',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'name', label: 'Product name', rows: 2, value: 'Candle No. 3', hint: '{Braces} colour a word, _underscores_ set italic.' },
        { key: 'sub', label: 'Detail line', value: 'Hand-poured · 220 g', hint: 'What it is. Also printed on the stand-in product.' },
        { key: 'price', label: 'Price', value: '£34' },
        { key: 'points', label: 'Points', value: 'or 3,400 POWR points', hint: 'Leave empty to hide it.' },
        { key: 'footer', label: 'Small print', value: 'Northside · Studio candles' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Candle', fields: { name: 'Candle No. 3', sub: 'Hand-poured · 220 g', price: '£34', points: 'or 3,400 POWR points', footer: 'Northside · Studio candles' } },
        { name: 'Journal', fields: { name: 'The Evening\nJournal', sub: 'A5 · 192 pages · Lay-flat', price: '£28', points: 'or 2,800 POWR points', footer: 'Northside Paper' } },
        { name: 'Oil', fields: { name: 'Room Oil', sub: 'Cedar and fig · 30 ml', price: '£22', points: 'Members first in the POWR app', footer: 'Northside Home' } },
        { name: 'New', fields: { name: '_New_ — Stone', sub: 'Unscented · Concrete vessel', price: '£40', points: '', footer: 'Back in stock Friday' } },
    ],
    look: { ...MIND_LOOK, mono: 0.7, target: 0.18, vignette: 0.6, backdrop: 'glow', plinth: 'cylinder', kind: 'candle' },
    controls: [
        { key: 'backdrop', label: 'Wall', options: [['glow', 'Glow'], ['wall', 'Brand colour'], ['dark', 'Dark']] },
        { key: 'plinth', label: 'Plinth', options: [['cylinder', 'Cylinder'], ['block', 'Block']] },
        { key: 'kind', label: 'Stand-in', options: [['candle', 'Candle'], ['jar', 'Jar'], ['box', 'Box']] },
    ],
    fill: { reward: (r) => productFill(r) },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k, size } = f;
        const back = e.look.backdrop ?? 'glow';
        const wall = back === 'wall' && !e.hasMedia;
        ground(e, wall ? mix(e.accent, '#0D0C0B', 0.12) : '#0E0D0C');
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.5);
        }
        const ink = wall ? onAccent(e.accent) : e.ink;
        const dim = wall ? (ink === '#111111' ? 'rgba(17,17,17,0.62)' : 'rgba(244,241,234,0.62)') : DIM;
        const nameColor = wall ? ink : headColor(e);

        const words = (x, w, align, namePx, maxNameH) => [
            blockItem(e, 'name', e.fields.name, x, e.headline, { maxW: w * size, maxH: maxNameH * size, max: namePx * k * size, lines: 2, gap: 0.2 }, { align, color: nameColor }),
            lineItem(e, 'sub', e.fields.sub, x, { px: 16 * k, spec: TYPE.monoR, maxW: w, align, color: dim, tracking: 0.18, before: 26 * k }),
            priceItem(e, x, { px: 34 * k, maxW: w, align, color: ink, dim, before: 40 * k }),
        ];

        if (f.banner) {
            const sw = W * (f.strip ? 0.3 : 0.4);
            const st = { x: f.x1 - sw - 10 * k, y: f.top + (f.strip ? 0 : 20) * k, w: sw, h: f.bottom - f.top - (f.strip ? 0 : 20) * k };
            if (back === 'glow' && !e.hasMedia) glow(e, st.x + sw / 2, st.y + st.h * 0.45, sw * 0.8, st.h * 0.7, 0.22);
            scene(e, st, k);
            const tw = st.x - f.x0 - 60 * k;
            const footTop = footRow(e, { x0: f.x0, x1: st.x - 40 * k, bottom: f.bottom, k, lockH: f.strip ? 22 : 26, footKey: f.strip ? 'none' : 'footer' });
            const list = words(f.x0, tw, 'left', f.strip ? 70 : 100, (f.bottom - f.top) * (f.strip ? 0.4 : 0.3));
            stack(list, f.top + Math.max(0, (footTop - 30 * k - f.top - stackH(list)) / 2));
            return;
        }

        const footTop = f.bottom - footH(e, k, { align: 'center' });
        const list = words(W / 2, (f.x1 - f.x0) * 0.8, 'center', f.sq ? 60 : 72, H * 0.1);
        const headTop = f.top + (f.tall ? 50 : f.sq ? 10 : 30) * k;
        const headBottom = headTop + stackH(list);
        const st = {
            x: f.x0,
            y: headBottom + (f.sq ? 40 : 70) * k,
            w: f.x1 - f.x0,
            h: footTop - (f.tall ? 110 : f.sq ? 40 : 70) * k - headBottom - (f.sq ? 40 : 70) * k,
        };
        if (back === 'glow' && !e.hasMedia) glow(e, W / 2, st.y + st.h * 0.5, W * 0.46, st.h * 0.62, 0.2);
        scene(e, st, k);
        stack(list, headTop);
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k, align: 'center' });
    },
};
