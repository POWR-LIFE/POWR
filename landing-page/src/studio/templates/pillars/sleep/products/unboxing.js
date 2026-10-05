/**
 * UNBOXING — what comes in the box: a rigid presentation box drawn in
 * perspective (lid propped behind with the brand's name pressed into it,
 * an interior lined in the brand's colour), the product rising out of it, and the
 * numbered contents listed beside it ("01 Eye mask · 02 Earplugs · 03
 * Pillow mist"). For wind-down kits, sleep-aid gift sets, trackers and
 * bedside devices.
 */
import { TYPE } from '../../../../fonts';
import { splitLines } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords } from '../../kit';
import { presentationBox } from './_box';
import { frame, nightGround, head, title, price, line, small, readable, INK, SOFT, HAIR, NIGHT_LOOK } from './_parts';
import { KINDS } from './moonlit';

// The box: a rigid presentation box with its lid propped behind (_box.js).
function drawBox(e, box) {
    const name = String(e.fields.brand ?? '').trim() || 'POWR';
    return presentationBox(e, box, Math.min(e.W, e.H) / 1080, { kind: e.look.kind ?? 'pouch', name });
}

// The numbered contents. Returns the bottom.
function contents(e, x, y, w, rowH, px, k, { cols = 1 } = {}) {
    const { ctx } = e;
    const items = splitLines(e.fields.contents).slice(0, 5).map((s) => s.trim()).filter(Boolean);
    const rows = Math.ceil(items.length / cols);
    const cw = (w - (cols - 1) * 40 * k) / cols;
    const lit = readable(e.accent);
    let box = null;
    const grow = (b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; };
    items.forEach((it, i) => {
        const c = Math.floor(i / rows);
        const cx = x + c * (cw + 40 * k);
        const top = y + (i % rows) * rowH;
        ctx.fillStyle = HAIR;
        ctx.fillRect(cx, top, cw, Math.max(1, 1.2 * k));
        const base = top + rowH / 2 + px * 0.36;
        grow(line(e, null, String(i + 1).padStart(2, '0'), TYPE.mono, px * 0.55, cx, base, { tracking: 0.1, color: lit }));
        grow(line(e, null, it, TYPE.brandL, px, cx + px * 1.7, base, { maxW: cw - px * 1.7, color: INK }));
    });
    e.mark('contents', box);
    return y + rows * rowH;
}

export default {
    id: 'sleep-unboxing',
    name: 'Unboxing',
    category: 'Sleep',
    section: 'Products',
    blurb: 'What comes in the box: a rigid presentation box, lid propped behind, the product rising out of it, and the numbered contents.',
    refs: 'the “in the box” panel on a product page',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'In the box' },
        { key: 'name', label: 'Product', rows: 2, value: 'The Wind-Down\nKit' },
        { key: 'contents', label: 'Contents', rows: 5, value: 'Silk eye mask\nFoam earplugs, 3 pairs\nPillow mist, 50 ml\nNight tea, 10 bags\nCotton travel pouch', hint: 'Up to five, one per line. Numbered for you.' },
        { key: 'price', label: 'Price', value: '£48' },
        { key: 'note', label: 'Small print', value: 'Gift-boxed · Plastic-free packaging' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Wind-down kit', fields: {}, look: { kind: 'pouch' } },
        { name: 'Travel kit', fields: { name: 'The Travel\nSleep Kit', contents: 'Contoured eye mask\nSilicone earplugs and tin\nPillow mist, 15 ml\nZip case', price: '£32', note: 'Fits a carry-on liquids bag' }, look: { kind: 'mask' }, style: { accent: '#B9C7E8' } },
        { name: 'Smart ring', fields: { name: 'Night Ring', contents: 'Ring, brushed titanium\nCharging dock\nUSB-C cable\nSizing kit\nQuick start card', price: '£299', note: 'Size first with the kit, then the ring ships' }, look: { kind: 'box' }, style: { accent: '#7FE0C2' } },
        { name: 'Sunrise light', fields: { name: 'Dawn Lamp', contents: 'Sunrise alarm light\nUSB-C cable and plug\nQuick start card', price: '£129', note: 'Sets up in the app in two minutes' }, look: { kind: 'box' }, style: { accent: '#E8A27C' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'pouch' },
    controls: [{ key: 'kind', label: 'Stand-in', options: KINDS }],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        nightGround(e, { glow: { x: 0.35, y: 0.6 }, sink: 0.72 });
        const hb = head(e, f);
        const n = Math.max(1, splitLines(e.fields.contents).filter((s) => s.trim()).slice(0, 5).length);
        const hasNote = String(e.fields.note ?? '').trim() !== '';

        if (f.strip) {
            const aw = (x1 - x0) * 0.28;
            drawBox(e, { x: x0, y: hb + 6 * k, w: aw, h: y1 - hb - 6 * k });
            const tx = x0 + aw + 40 * k;
            const tW = (x1 - tx) * 0.34;
            const t = title(e, 'name', e.fields.name, tx, hb + 30 * k, { maxW: tW, maxH: 100 * k, max: 48 * k });
            price(e, 'price', tx, t.bottom + 50 * k, 26 * k, { maxW: tW, color: SOFT });
            if (hasNote) small(e, 'note', tx, y1, 11 * k, { maxW: tW });
            const lx = tx + tW + 40 * k;
            const cols = n > 3 ? 2 : 1;
            const rowH = Math.min(62 * k, (y1 - hb - 10 * k) / Math.ceil(n / cols));
            contents(e, lx, hb + 10 * k + (y1 - hb - 10 * k - rowH * Math.ceil(n / cols)) / 2, x1 - lx, rowH, 20 * k, k, { cols });
            return;
        }

        if (f.wide || f.sq) {
            const aw = (x1 - x0) * (f.sq ? 0.5 : 0.52);
            const top = hb + 30 * k;
            drawBox(e, { x: x0, y: top, w: aw, h: y1 - top - (hasNote ? 40 * k : 0) });
            if (hasNote) small(e, 'note', x0, y1, (f.sq ? 13 : 15) * k, { maxW: aw });
            const tx = x0 + aw + (f.sq ? 50 : 80) * k;
            const t = title(e, 'name', e.fields.name, tx, top + 30 * k, { maxW: x1 - tx, maxH: (f.sq ? 120 : 160) * k, max: (f.sq ? 62 : 84) * k });
            const pPx = (f.sq ? 32 : 40) * k;
            price(e, 'price', tx, y1 - 4 * k, pPx, { maxW: x1 - tx, color: SOFT });
            const lt = t.bottom + (f.sq ? 50 : 70) * k;
            const rowH = Math.min((f.sq ? 70 : 84) * k, (y1 - pPx - 50 * k - lt) / n);
            contents(e, tx, lt, x1 - tx, rowH, (f.sq ? 24 : 30) * k, k);
            return;
        }

        const top = hb + (f.tall ? 60 : 44) * k;
        const t = title(e, 'name', e.fields.name, x0, top, { maxW: (x1 - x0) * 0.66, maxH: (f.tall ? 170 : 140) * k, max: (f.tall ? 90 : 76) * k });
        price(e, 'price', x1, t.boxes[0].baseline, (f.tall ? 40 : 34) * k, { align: 'right', maxW: (x1 - x0) * 0.3, color: SOFT });
        const noteH = hasNote ? (f.tall ? 50 : 44) * k : 0;
        if (hasNote) small(e, 'note', x0, y1, (f.tall ? 16 : 14) * k, { maxW: x1 - x0 });
        if (f.tall) {
            const rowH = 74 * k;
            const lt = y1 - noteH - rowH * n - 10 * k;
            contents(e, x0, lt, x1 - x0, rowH, 30 * k, k);
            const at = t.bottom + 60 * k;
            drawBox(e, { x: x0, y: at, w: x1 - x0, h: lt - 60 * k - at });
            return;
        }
        // Post: the box across the middle, the contents in two columns under it.
        const cols = n > 3 ? 2 : 1;
        const rowH = 64 * k;
        const lt = y1 - noteH - rowH * Math.ceil(n / cols) - 10 * k;
        contents(e, x0, lt, x1 - x0, rowH, 24 * k, k, { cols });
        const at = t.bottom + 40 * k;
        drawBox(e, { x: x0, y: at, w: x1 - x0, h: lt - 40 * k - at });
    },
};
