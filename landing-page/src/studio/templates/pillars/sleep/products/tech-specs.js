/**
 * TECH SPECS — a tracker or wearable's spec sheet: the product on a faint
 * drafting grid inside crop marks, a dimension line under it, then the
 * name and price and a table of rows (Battery · Sensors · Weight · Water
 * resistance) in mono with right-aligned values. Numbers only. For sleep
 * trackers, smart rings, bedside devices and white-noise machines.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, rewardWords } from '../../kit';
import { frame, contentBox, nightGround, head, title, parseRows, price, line, label, readable, INK, SOFT, MUTED, HAIR, NIGHT_LOOK } from './_parts';
import { KINDS } from './moonlit';

// Grid, crop marks and the product; the dimension line under it. Returns the product rect.
function plate(e, box, k, { dim = true } = {}) {
    const { ctx } = e;
    const step = 36 * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    const g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, 0, box.x + box.w / 2, box.y + box.h / 2, Math.max(box.w, box.h) * 0.62);
    g.addColorStop(0, 'rgba(244,241,234,0.07)');
    g.addColorStop(1, 'rgba(244,241,234,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    for (let x = box.x + ((box.w / 2) % step); x < box.x + box.w; x += step) { ctx.moveTo(x, box.y); ctx.lineTo(x, box.y + box.h); }
    for (let y = box.y + ((box.h / 2) % step); y < box.y + box.h; y += step) { ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); }
    ctx.stroke();
    const spotG = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h * 0.45, 0, box.x + box.w / 2, box.y + box.h * 0.45, Math.min(box.w, box.h) * 0.5);
    spotG.addColorStop(0, 'rgba(190,205,235,0.09)');
    spotG.addColorStop(1, 'rgba(190,205,235,0)');
    ctx.fillStyle = spotG;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
    // Crop marks.
    const m = 22 * k;
    ctx.save();
    ctx.strokeStyle = 'rgba(244,241,234,0.4)';
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.beginPath();
    [[box.x, box.y, 1, 1], [box.x + box.w, box.y, -1, 1], [box.x, box.y + box.h, 1, -1], [box.x + box.w, box.y + box.h, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.moveTo(x, y + sy * m); ctx.lineTo(x, y); ctx.lineTo(x + sx * m, y);
    });
    ctx.stroke();
    ctx.restore();

    const dimH = dim ? 70 * k : 0;
    const pad = Math.min(box.w, box.h) * 0.1;
    const inner = { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 - dimH };
    const shot = productShot(e, inner, { kind: e.look.kind ?? 'box', sub: '' });
    // A cut-out is measured on what it paints, not its transparent margins.
    const img = e.asset('product');
    let r = shot.rect;
    if (img && shot.cutout && !shot.mock) {
        const cb = contentBox(img);
        r = { x: r.x + cb.x * r.w, y: r.y + cb.y * r.h, w: cb.w * r.w, h: cb.h * r.h };
    }
    const size = String(e.fields.size ?? '').trim();
    if (dim && size) {
        const y = r.y + r.h + 40 * k;
        const t = 8 * k;
        const lit = readable(e.accent);
        ctx.save();
        ctx.strokeStyle = lit;
        ctx.lineWidth = Math.max(1, 1.4 * k);
        ctx.beginPath();
        ctx.moveTo(r.x, y - t); ctx.lineTo(r.x, y + t);
        ctx.moveTo(r.x + r.w, y - t); ctx.lineTo(r.x + r.w, y + t);
        ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y);
        ctx.stroke();
        ctx.restore();
        const px = 15 * k;
        const tw = Math.min(r.w * 0.9, box.w * 0.8);
        ctx.save();
        ctx.font = `500 ${px}px "IBM Plex Mono"`;
        const w = Math.min(tw, ctx.measureText(size).width * 1.12) + 24 * k;
        ctx.fillStyle = '#0c0e13';
        ctx.fillRect(r.x + r.w / 2 - w / 2, y - px, w, px * 2);
        ctx.restore();
        line(e, 'size', size, TYPE.mono, px, r.x + r.w / 2, y + px * 0.36, { align: 'center', maxW: tw, tracking: 0.06, color: lit });
    }
    return r;
}

// The spec table: label left, a dotted run, value right. Returns the bottom.
function table(e, rows, x, y, w, rowH, px, k) {
    const { ctx } = e;
    let box = null;
    const grow = (b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; };
    rows.forEach((r, i) => {
        const top = y + i * rowH;
        ctx.fillStyle = HAIR;
        ctx.fillRect(x, top, w, Math.max(1, 1.2 * k));
        const base = top + rowH / 2 + px * 0.36;
        const lb = label(e, null, r[0], px * 0.82, x, base, { maxW: w * 0.42, color: MUTED });
        const vb = line(e, null, r.slice(1).join(' · '), TYPE.mono, px, x + w, base, { align: 'right', maxW: w * 0.54, color: INK });
        grow(lb);
        grow(vb);
        const a = (lb ? lb.x + lb.w : x) + 14 * k;
        const b = (vb ? vb.x : x + w) - 14 * k;
        if (b > a) {
            ctx.save();
            ctx.fillStyle = 'rgba(244,241,234,0.2)';
            for (let d = a; d < b; d += 7 * k) ctx.fillRect(d, base - px * 0.2, 1.6 * k, 1.6 * k);
            ctx.restore();
        }
    });
    if (rows.length) {
        ctx.fillStyle = HAIR;
        ctx.fillRect(x, y + rows.length * rowH, w, Math.max(1, 1.2 * k));
    }
    e.mark('specs', box);
    return y + rows.length * rowH;
}

export default {
    id: 'sleep-tech-specs',
    name: 'Tech Specs',
    category: 'Sleep',
    section: 'Products',
    blurb: 'A tracker or wearable’s spec sheet: the product on a drafting grid, its dimensions, and mono rows of numbers.',
    refs: 'a hardware maker’s spec page',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Tech specs' },
        { key: 'name', label: 'Product', rows: 2, value: 'Night Band 2' },
        { key: 'model', label: 'Model line', value: 'Sleep tracker · Graphite' },
        { key: 'size', label: 'Dimensions', value: '40 × 34 × 10.7 mm', hint: 'Drawn as a dimension line under the product. Leave empty to drop it.' },
        { key: 'specs', label: 'Specs', rows: 5, value: 'Battery — 7 days\nSensors — HR · SpO2 · Skin temp\nWeight — 26 g\nWater resistance — 5 ATM\nCharging — 80 min to full', hint: 'Up to six, one per line: label — value.' },
        { key: 'price', label: 'Price', value: '£249' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Band', fields: {}, look: { kind: 'box' } },
        { name: 'Ring', fields: { name: 'Night Ring', model: 'Titanium · Sizes 6–13', size: '7.9 × 2.5 mm', specs: 'Battery — Up to 6 days\nSensors — HR · Skin temp · Motion\nWeight — 4 g\nWater resistance — 100 m\nFinish — Brushed titanium', price: '£299' }, look: { kind: 'tin' }, style: { accent: '#9DB8FF' } },
        { name: 'Sound machine', fields: { eyebrow: 'On the nightstand', name: 'Hush One', model: 'Bedside sound machine', size: '110 × 110 × 72 mm', specs: 'Sounds — 24, looped\nSpeaker — 5 W full range\nPower — USB-C · 12 h battery\nTimer — 15 to 120 min\nWeight — 340 g', price: '£89' }, look: { kind: 'device' }, style: { accent: '#7FE0C2' } },
        { name: 'Lamp', fields: { eyebrow: 'Light', name: 'Dusk Lamp', model: 'Sunrise alarm light', size: '180 × 180 × 90 mm', specs: 'Light — 2,700 K to 6,500 K\nSunrise — 10 to 60 min\nBrightness — 20 levels\nPower — Mains · USB-C', price: '£129' }, look: { kind: 'device' }, style: { accent: '#E8A27C' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'box' },
    controls: [{ key: 'kind', label: 'Stand-in', options: KINDS }],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        nightGround(e, { glow: { x: 0.5, y: 0.3 }, sink: 0.74 });
        const hb = head(e, f);
        const rows = parseRows(e.fields.specs, 6);

        if (f.side || f.sq) {
            const pW = (x1 - x0) * (f.strip ? 0.22 : f.sq ? 0.44 : 0.42);
            const top = hb + (f.strip ? 16 : 40) * k;
            plate(e, { x: x0, y: top, w: pW, h: y1 - top }, k, { dim: !f.strip });
            const gx = x0 + pW + (f.strip ? 50 : 70) * k;
            if (f.strip) {
                // Name + price, then the table to the right.
                const nW = (x1 - gx) * 0.36;
                const t = title(e, 'name', e.fields.name, gx, top + 20 * k, { maxW: nW, maxH: 100 * k, max: 56 * k });
                line(e, 'model', e.fields.model, TYPE.brandR, 15 * k, gx, t.bottom + 34 * k, { maxW: nW, color: SOFT });
                price(e, 'price', gx, y1 - 4 * k, 36 * k, { maxW: nW });
                const tx = gx + nW + 50 * k;
                const n = Math.max(1, rows.length);
                const rowH = Math.min(62 * k, (y1 - top) / n);
                table(e, rows, tx, top + (y1 - top - rowH * n) / 2, x1 - tx, rowH, 16 * k, k);
                return;
            }
            const t = title(e, 'name', e.fields.name, gx, top + 20 * k, { maxW: x1 - gx, maxH: (f.sq ? 110 : 150) * k, max: (f.sq ? 70 : 92) * k });
            line(e, 'model', e.fields.model, TYPE.brandR, (f.sq ? 18 : 22) * k, gx, t.bottom + (f.sq ? 44 : 54) * k, { maxW: x1 - gx, color: SOFT });
            const pPx = (f.sq ? 38 : 46) * k;
            price(e, 'price', gx, y1 - 4 * k, pPx, { maxW: x1 - gx });
            const tTop = t.bottom + (f.sq ? 84 : 104) * k;
            const tBot = y1 - pPx - (f.sq ? 40 : 56) * k;
            const n = Math.max(1, rows.length);
            const rowH = Math.min((f.sq ? 62 : 74) * k, (tBot - tTop) / n);
            table(e, rows, gx, tTop, x1 - gx, rowH, (f.sq ? 16 : 19) * k, k);
            return;
        }

        const n = Math.max(1, rows.length);
        const rowH = (f.tall ? 78 : 66) * k;
        const tabH = rowH * n;
        const tabTop = y1 - tabH;
        const nameBase = tabTop - (f.tall ? 64 : 44) * k;
        const nPx = (f.tall ? 80 : 64) * k;
        // Name and price share a band above the table; the model line under the name.
        const mb = line(e, 'model', e.fields.model, TYPE.brandR, (f.tall ? 22 : 19) * k, x0, nameBase, { maxW: (x1 - x0) * 0.6, color: SOFT });
        const nb = (mb ? nameBase - (f.tall ? 42 : 36) * k : nameBase);
        const t = title(e, 'name', e.fields.name.split('\n')[0], x0, nb - nPx * 0.72, { maxW: (x1 - x0) * 0.66, maxH: nPx * 0.72, max: nPx, lines: 1 });
        price(e, 'price', x1, t.bottom, (f.tall ? 54 : 46) * k, { align: 'right', maxW: (x1 - x0) * 0.3 });
        table(e, rows, x0, tabTop, x1 - x0, rowH, (f.tall ? 20 : 18) * k, k);
        const pTop = hb + (f.tall ? 40 : 30) * k;
        const pBot = t.bottom - nPx * 0.72 - (f.tall ? 60 : 40) * k;
        plate(e, { x: x0, y: pTop, w: x1 - x0, h: pBot - pTop }, k);
    },
};
