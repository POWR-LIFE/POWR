/**
 * WEIGHT GUIDE — a weighted blanket sold by its sizing table: body weight
 * to blanket weight, row by row, each blanket weight drawn as a strip of
 * quilted pockets (one per kilo), one row picked out in the brand's colour,
 * the brand's own guidance line under it. With no product shot, a folded
 * quilted blanket is drawn. The brand's guidance, never an effect.
 */
import { TYPE } from '../../../../fonts';
import { textWidth } from '../../../../text';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, lightPool, rewardWords, textOn } from '../../kit';
import { frame, nightGround, head, title, parseRows, price, small, glow, tint, line, label, readable, INK, SOFT, MUTED, HAIR, NIGHT_LOOK } from './_parts';
import { KINDS } from './moonlit';

const kgOf = (s) => {
    const m = String(s ?? '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
};

// A folded quilted blanket, bottom-centred in `box`. Returns its rect.
function blanket(e, box, k) {
    const { ctx } = e;
    const ar = 1.45;
    let h = box.h;
    let w = h * ar;
    if (w > box.w) { w = box.w; h = w / ar; }
    const x = box.x + (box.w - w) / 2;
    const y = box.y + box.h - h;
    lightPool(e, x + w / 2, y + h, w);
    const th = h * 0.4;
    const layers = 3;
    const lh = (h - th) / layers;
    const matte = (y0, y1) => {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, '#3a3a38');
        g.addColorStop(0.35, '#262625');
        g.addColorStop(1, '#101010');
        return g;
    };
    ctx.save();
    // The folds, bottom up, each with rounded ends.
    for (let i = layers - 1; i >= 0; i--) {
        const ly = y + th + i * lh - lh * 0.25;
        const inset = i * w * 0.004;
        ctx.fillStyle = matte(ly, ly + lh * 1.25);
        ctx.beginPath();
        ctx.roundRect(x + inset, ly, w - inset * 2, lh * 1.25, lh * 0.55);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = Math.max(1, k);
        ctx.stroke();
    }
    // The top face: a quilted panel in perspective.
    const TL = [x + w * 0.07, y];
    const TR = [x + w * 0.93, y];
    const BR = [x + w, y + th];
    const BL = [x, y + th];
    const g = ctx.createLinearGradient(0, y, 0, y + th);
    g.addColorStop(0, '#2c2c2a');
    g.addColorStop(1, '#3d3d3a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(TL[0], TL[1]); ctx.lineTo(TR[0], TR[1]); ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    const cols = 7;
    const rows = 3;
    const at = (u, v) => [TL[0] + (TR[0] - TL[0]) * u + (BL[0] - TL[0]) * v + ((BR[0] - BL[0]) - (TR[0] - TL[0])) * u * v, TL[1] + th * v];
    // A soft pocket in each square: lighter in the middle.
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const [cx, cy] = at((c + 0.5) / cols, (r + 0.5) / rows);
            const rad = (w / cols) * 0.5;
            const pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
            pg.addColorStop(0, 'rgba(255,255,255,0.1)');
            pg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = pg;
            ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.beginPath();
    for (let c = 1; c < cols; c++) { const a = at(c / cols, 0); const b = at(c / cols, 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    for (let r = 1; r < rows; r++) { const a = at(0, r / rows); const b = at(1, r / rows); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    ctx.restore();
    // The front edge catches the light.
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + w * 0.02, y + th - Math.max(1, k), w * 0.96, Math.max(1, 1.5 * k));
    // The brand on the top fold, a woven tab in the accent.
    const name = (String(e.fields.brand ?? '').trim() || 'POWR').toUpperCase();
    let px = lh * 0.34;
    const tw = textWidth(ctx, name, TYPE.brandSB, px, 0.22);
    if (tw > w * 0.5) px *= (w * 0.5) / tw;
    const my = y + th + lh * 0.5;
    ctx.restore();
    line(e, null, name, TYPE.brandSB, px, x + w / 2, my + px * 0.36, { align: 'center', tracking: 0.22, color: '#EDE9E0' });
    ctx.save();
    ctx.fillStyle = e.accent;
    ctx.fillRect(x + w * 0.84, y + th + lh * 0.95, w * 0.05, lh * 0.7);
    ctx.restore();
    return { x, y, w, h };
}

// The table in `box`. Marks 'sizes' (and 'pick' on the picked row).
function table(e, box, k, { px = 30, compact = false } = {}) {
    const { ctx } = e;
    const rows = parseRows(e.fields.sizes, 6).map((p) => ({ body: p[0], kg: p.slice(1).join(' · '), n: kgOf(p.slice(1).join(' ')) }));
    if (!rows.length) return;
    const pick = String(e.fields.pick ?? '').trim().toLowerCase();
    const hPx = (compact ? 10 : 13) * k;
    const headH = hPx * 2.6;
    const rowH = Math.min(px * 2.9, (box.h - headH) / rows.length);
    const y0 = box.y + headH + Math.max(0, (box.h - headH - rowH * rows.length) * 0.4);
    const maxN = Math.max(1, ...rows.map((r) => Math.round(r.n ?? 0)));
    const colB = box.x + box.w * 0.34;
    const colR = box.x + box.w;
    const valW = box.w * 0.18;
    const meterW = colR - valW - 24 * k - colB;
    label(e, null, 'Body weight', hPx, box.x, y0 - headH + hPx, { color: MUTED });
    label(e, null, 'Blanket', hPx, colR, y0 - headH + hPx, { align: 'right', color: MUTED });
    let mb = null;
    const grow = (b) => { if (b) mb = mb ? { x: Math.min(mb.x, b.x), y: Math.min(mb.y, b.y), w: Math.max(mb.x + mb.w, b.x + b.w) - Math.min(mb.x, b.x), h: Math.max(mb.y + mb.h, b.y + b.h) - Math.min(mb.y, b.y) } : b; };
    const fpx = Math.min(px, rowH * 0.46);
    rows.forEach((r, i) => {
        const top = y0 + i * rowH;
        const on = pick && (r.body.toLowerCase() === pick || r.kg.toLowerCase() === pick);
        const ink = on ? textOn(e.accent) : INK;
        if (on) {
            ctx.fillStyle = e.accent;
            ctx.beginPath();
            ctx.roundRect(box.x - 14 * k, top + 3 * k, box.w + 28 * k, rowH - 6 * k, 10 * k);
            ctx.fill();
            e.mark('pick', { x: box.x - 14 * k, y: top, w: box.w + 28 * k, h: rowH });
        } else {
            ctx.fillStyle = HAIR;
            ctx.fillRect(box.x, top, box.w, Math.max(1, 1.2 * k));
        }
        const mid = top + rowH / 2;
        grow(line(e, null, r.body, TYPE.brandL, fpx, box.x, mid + fpx * 0.36, { maxW: colB - box.x - 16 * k, color: ink }));
        grow(line(e, null, r.kg, TYPE.brandL, fpx, colR, mid + fpx * 0.36, { align: 'right', maxW: valW, color: ink }));
        // One quilted pocket per kilo.
        const n = Math.max(0, Math.round(r.n ?? 0));
        if (n && meterW > 20 * k) {
            const gap = Math.max(1, 3 * k);
            const sq = Math.min(rowH * 0.38, (meterW - gap * (maxN - 1)) / maxN);
            const sy = mid - sq / 2;
            for (let j = 0; j < n; j++) {
                const sx = colB + j * (sq + gap);
                ctx.beginPath();
                ctx.roundRect(sx, sy, sq, sq, sq * 0.22);
                if (on) {
                    ctx.fillStyle = textOn(e.accent) === INK ? 'rgba(244,241,234,0.9)' : 'rgba(17,17,17,0.82)';
                    ctx.fill();
                } else {
                    ctx.strokeStyle = 'rgba(244,241,234,0.42)';
                    ctx.lineWidth = Math.max(1, 1.3 * k);
                    ctx.stroke();
                }
                ctx.fillStyle = on ? e.accent : tint(readable(e.accent), 0.8);
                ctx.beginPath();
                ctx.arc(sx + sq / 2, sy + sq / 2, sq * 0.13, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });
    ctx.fillStyle = HAIR;
    ctx.fillRect(box.x, y0 + rows.length * rowH, box.w, Math.max(1, 1.2 * k));
    e.mark('sizes', mb);
    return y0 + rows.length * rowH;
}

// The guidance: an accent rule and the brand's own line.
function guide(e, x, y, px, maxW) {
    const t = String(e.fields.guide ?? '').trim();
    if (!t) return null;
    e.ctx.fillStyle = readable(e.accent);
    e.ctx.fillRect(x, y - px * 0.42, px * 1.1, Math.max(1, px * 0.1));
    return line(e, 'guide', t, TYPE.brandR, px, x + px * 1.7, y, { maxW: maxW - px * 1.7, color: SOFT });
}

export default {
    id: 'sleep-weight-guide',
    name: 'Weight Guide',
    category: 'Sleep',
    section: 'Products',
    blurb: 'A weighted blanket’s sizing table: body weight to blanket weight in quilted pockets, one row picked out, the brand’s guidance line.',
    refs: 'the sizing chart on a blanket maker’s swing tag',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Weight guide' },
        { key: 'name', label: 'Product', rows: 2, value: 'The Weighted\nBlanket' },
        { key: 'detail', label: 'Detail', value: 'Glass beads · Cotton cover · 135 × 200 cm' },
        { key: 'sizes', label: 'Sizes', rows: 6, value: 'Under 50 kg — 5 kg\n50–65 kg — 6 kg\n65–80 kg — 7 kg\n80–95 kg — 9 kg\nOver 95 kg — 11 kg', hint: 'Up to six, one per line: body weight — blanket weight. One pocket is drawn per kilo.' },
        { key: 'pick', label: 'Pick out', value: '65–80 kg', hint: 'A row to show in your colour (its body weight or blanket weight, as above). Empty for none.' },
        { key: 'guide', label: 'Guidance line', value: 'Around 10% of body weight — the brand’s own guidance' },
        { key: 'price', label: 'Price', value: 'From £119' },
        { key: 'offer', label: 'Offer (small)', value: 'Or 2,900 POWR points', hint: 'Optional.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Blanket', fields: {}, look: { kind: 'blanket' } },
        { name: 'Knitted', fields: { eyebrow: 'Chunky knit', name: 'Knitted\nWeighted Throw', detail: 'No beads · Hand-knitted cotton · 120 × 180 cm', sizes: '45–60 kg — 5 kg\n60–75 kg — 7 kg\n75–90 kg — 8 kg', pick: '7 kg', price: '£149', offer: '' }, look: { kind: 'blanket' }, style: { accent: '#D8C3A5' } },
        { name: 'Kids', fields: { eyebrow: 'Sized for kids', name: 'Little Weighted\nBlanket', detail: 'Glass beads · Washable cover · 100 × 150 cm', sizes: '20–30 kg — 2 kg\n30–40 kg — 3 kg\n40–50 kg — 4 kg', pick: '30–40 kg', guide: 'Around 10% of body weight — check with the maker for under-fours', price: '£79', offer: 'Or 1,900 POWR points' }, look: { kind: 'blanket' }, style: { accent: '#7FE0C2' } },
        { name: 'Cooling', fields: { eyebrow: 'Summer weight', name: 'Bamboo\nWeighted Blanket', detail: 'Bamboo viscose cover · Glass beads · 150 × 200 cm', sizes: '50–65 kg — 6 kg\n65–80 kg — 8 kg\n80–100 kg — 10 kg\nOver 100 kg — 12 kg', pick: '80–100 kg', price: 'From £139', offer: 'Members first in the POWR app' }, look: { kind: 'blanket' }, style: { accent: '#9DB8FF' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'blanket' },
    controls: [{ key: 'kind', label: 'Stand-in', options: [['blanket', 'Folded blanket'], ...KINDS] }],
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            offer: [r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''}` : '', r.cost ? `${Number(r.cost).toLocaleString('en-GB')} POWR points` : ''].filter(Boolean).join(' · '),
        }),
    },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        nightGround(e, { glow: { x: 0.7, y: 0.3 }, sink: 0.74 });
        const kind = e.look.kind ?? 'blanket';
        const hb = head(e, f);
        const hasOffer = String(e.fields.offer ?? '').trim() !== '';
        const hero = (box, align = 'center') => {
            if (kind === 'blanket' && !e.asset('product')) {
                const r = blanket(e, box, k);
                e.mark('product', r);
                return r;
            }
            return productShot(e, box, { kind: kind === 'blanket' ? 'box' : kind, sub: '', align }).rect;
        };

        if (f.side) {
            const cW = (x1 - x0) * (f.strip ? 0.36 : 0.34);
            const top = hb + (f.strip ? 30 : 70) * k;
            const t = title(e, 'name', f.strip ? String(e.fields.name ?? '').replace(/\s*\n\s*/g, ' ') : e.fields.name, x0, top, { maxW: cW, maxH: (f.strip ? 56 : 150) * k, max: (f.strip ? 46 : 84) * k, lines: f.strip ? 1 : 2, gap: 0.24 });
            const dPx = (f.strip ? 12 : 17) * k;
            line(e, 'detail', e.fields.detail, TYPE.brandR, dPx, x0, t.bottom + dPx * 2.2, { maxW: cW, color: SOFT });
            const pPx = (f.strip ? 26 : 40) * k;
            const oPx = (f.strip ? 11 : 14) * k;
            const pBase = y1 - (hasOffer ? oPx * 2.4 : 0);
            price(e, 'price', x0, pBase, pPx, { maxW: cW * 0.5 });
            if (hasOffer) small(e, 'offer', x0, y1, oPx, { maxW: cW * 0.5 });
            const pTop = t.bottom + dPx * 4;
            if (f.strip) {
                hero({ x: x0 + cW * 0.52, y: pTop, w: cW * 0.46, h: y1 - pTop }, 'right');
            } else {
                const pBot = pBase - pPx - 40 * k;
                glow(e, x0 + cW / 2, (pTop + pBot) / 2, cW * 0.7, 0.08);
                hero({ x: x0, y: pTop, w: cW * 0.9, h: pBot - pTop });
            }
            const tx = x0 + cW + (f.strip ? 60 : 100) * k;
            const gPx = (f.strip ? 13 : 19) * k;
            table(e, { x: tx, y: hb + (f.strip ? 6 : 40) * k, w: x1 - tx, h: y1 - gPx * 3 - hb - (f.strip ? 6 : 40) * k }, k, { px: (f.strip ? 20 : 30) * k, compact: f.strip });
            guide(e, tx, y1, gPx, x1 - tx);
            return;
        }

        const top = hb + (f.tall ? 70 : f.sq ? 36 : 50) * k;
        const pW = (x1 - x0) * (f.sq ? 0.4 : 0.46);
        const zoneH = (f.tall ? 420 : f.sq ? 250 : 320) * k;
        glow(e, x1 - pW / 2, top + zoneH * 0.6, pW * 0.8, 0.09);
        hero({ x: x1 - pW, y: top + 20 * k, w: pW, h: zoneH - 20 * k });
        const tW = x1 - x0 - pW - 30 * k;
        const t = title(e, 'name', e.fields.name, x0, top + 20 * k, { maxW: tW, maxH: (f.sq ? 130 : 170) * k, max: (f.tall ? 96 : f.sq ? 70 : 84) * k, gap: 0.24 });
        const dPx = (f.tall ? 19 : 16) * k;
        line(e, 'detail', e.fields.detail, TYPE.brandR, dPx, x0, t.bottom + dPx * 2.4, { maxW: tW, color: SOFT });
        const pPx = (f.tall ? 46 : f.sq ? 34 : 40) * k;
        const oPx = (f.tall ? 16 : 14) * k;
        const gPx = (f.tall ? 22 : f.sq ? 17 : 19) * k;
        const pBase = y1 - (hasOffer ? oPx * 2.4 : 0);
        price(e, 'price', x0, pBase, pPx, { maxW: (x1 - x0) * 0.5 });
        if (hasOffer) small(e, 'offer', x0, y1, oPx, { maxW: (x1 - x0) * 0.6 });
        const gBase = pBase - pPx - (f.tall ? 50 : f.sq ? 26 : 36) * k;
        guide(e, x0, gBase, gPx, x1 - x0);
        const tTop = top + zoneH + (f.tall ? 60 : f.sq ? 20 : 36) * k;
        table(e, { x: x0, y: tTop, w: x1 - x0, h: gBase - gPx * 2.2 - tTop }, k, { px: (f.tall ? 34 : f.sq ? 24 : 30) * k, compact: f.sq });
    },
};
