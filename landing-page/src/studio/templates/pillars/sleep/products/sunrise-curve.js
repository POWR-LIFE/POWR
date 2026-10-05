/**
 * SUNRISE CURVE — a wake light's programme drawn as a chart of light over
 * the night: a reading level that fades out over the sunset, the lamp off
 * (the long dark middle folded behind an axis break), then the sunrise ramp
 * up to the alarm. The curve's fill runs from warm (2,000 K) to daylight
 * (6,500 K), taking its colours from the kelvin in the labels; lux and kelvin
 * are labelled where the light changes. Times and ratings only.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, rewardWords } from '../../kit';
import { frame, nightGround, head, title, price, small, glow, line, label, readable, crescent, INK, SOFT, MUTED, HAIR, NIGHT_LOOK, clamp, nightRgba } from './_parts';
import { parseClock, parseDur, clock, span, dur, sun } from '../_parts';
import { KINDS } from './moonlit';

/** A colour temperature in kelvin → [r, g, b] (black-body approximation), cooled a touch past 4,000 K to read as daylight on the night ground. */
export function kelvinRgb(K) {
    const t = clamp(K, 1000, 12000) / 100;
    let r;
    let g;
    let b;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
        b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
        r = 329.698727446 * (t - 60) ** -0.1332047592;
        g = 288.1221695283 * (t - 60) ** -0.0755148492;
        b = 255;
    }
    const c = [r, g, b].map((v) => clamp(v, 0, 255));
    const m = clamp((K - 4000) / 2500, 0, 1) * 0.55;
    return c.map((v, i) => Math.round(v * (1 - m) + [206, 222, 255][i] * m));
}
const mins = (m) => (m < 60 ? `${Math.round(m)} min` : dur(m));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const num = (s, re) => {
    const m = String(s ?? '').replace(/,/g, '').match(re);
    return m ? Number(m[1]) : null;
};
const kOf = (s, d) => num(s, /(\d{4,5})\s*k\b/i) ?? d;
const luxOf = (s) => num(s, /(\d+(?:\.\d+)?)\s*lux/i);

// The programme in minutes: two windows either side of the dark, the same scale in each.
function programme(e) {
    const dusk = parseClock(e.fields.dusk) ?? 22 * 60 + 30;
    const alarm = parseClock(e.fields.alarm) ?? 6 * 60 + 45;
    const dl = clamp(parseDur(e.fields.duskLen) ?? 30, 5, 120);
    const al = clamp(parseDur(e.fields.dawnLen) ?? 30, 5, 120);
    const pad = 30;
    const aLen = pad + dl + pad;
    const bLen = pad + al + pad;
    const dark = Math.max(0, span(dusk + dl, alarm - al));
    return { dusk, alarm, dl, al, pad, aLen, bLen, dark };
}

// The chart in `box` (axis, curve, labels under it). Marks 'curve'.
function chart(e, box, k, { compact = false } = {}) {
    const { ctx } = e;
    const p = programme(e);
    const tPx = (compact ? 11 : 14) * k;
    const lPx = (compact ? 11 : 14) * k;
    const under = tPx * (compact ? 2.2 : 2.6) + lPx * (compact ? 2.2 : 2.8);
    const top = box.y + lPx * 3.2;
    const base = box.y + box.h - under;
    const hMax = base - top;
    if (hMax < 20 * k || box.w < 120 * k) return;
    const brk = (compact ? 60 : 90) * k;
    const s = (box.w - brk) / (p.aLen + p.bLen);
    const xA = (m) => box.x + m * s; // minutes into window A
    const xB = (m) => box.x + p.aLen * s + brk + m * s;
    const dLux = luxOf(e.fields.duskLight);
    const pLux = luxOf(e.fields.peak);
    const duskH = hMax * (dLux && pLux ? clamp(dLux / pLux, 0.18, 1) : 0.46);
    const peakH = hMax;
    const kD = kOf(e.fields.duskLight, 2700);
    const kS = kOf(e.fields.dawnLight, 2000);
    const kP = kOf(e.fields.peak, 6500);
    const ease = (t) => t * t * (3 - 2 * t);

    // Sample both windows into one path, along the baseline under the break.
    const pts = [];
    const step = 3;
    for (let m = 0; m <= p.aLen; m += step) {
        const t = clamp((m - p.pad) / p.dl, 0, 1);
        pts.push([xA(m), base - duskH * (1 - ease(t))]);
    }
    for (let m = 0; m <= p.bLen; m += step) {
        const t = clamp((m - p.pad) / p.al, 0, 1);
        pts.push([xB(m), base - peakH * ease(t) ** 1.3]);
    }
    const x0 = box.x;
    const x1 = xB(p.bLen);
    const grad = (a) => {
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        const at = (x) => clamp((x - x0) / (x1 - x0), 0, 1);
        g.addColorStop(0, rgba(kelvinRgb(kD), a));
        g.addColorStop(at(xA(p.pad + p.dl)), rgba(kelvinRgb(kD), a));
        g.addColorStop(at(xB(p.pad)), rgba(kelvinRgb(kS), a));
        g.addColorStop(at(xB(p.pad + p.al)), rgba(kelvinRgb(kP), a));
        g.addColorStop(1, rgba(kelvinRgb(kP), a));
        return g;
    };
    // Faint level lines.
    ctx.save();
    ctx.fillStyle = 'rgba(244,241,234,0.06)';
    for (let i = 1; i <= 4; i++) ctx.fillRect(x0, base - (hMax * i) / 4, x1 - x0, Math.max(1, k));
    ctx.restore();
    // The fill, sunk towards the baseline, then the line.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], base);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(x1, base);
    ctx.closePath();
    ctx.fillStyle = grad(0.4);
    ctx.fill();
    ctx.clip();
    const v = ctx.createLinearGradient(0, top, 0, base);
    v.addColorStop(0, nightRgba(0));
    v.addColorStop(1, nightRgba(0.75));
    ctx.fillStyle = v;
    ctx.fillRect(x0, top, x1 - x0, base - top);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = grad(1);
    ctx.lineWidth = Math.max(1.5, 3 * k);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    // The break: the baseline stops, two slashes, the hours the lamp is off.
    const bx = xA(p.aLen);
    ctx.save();
    ctx.fillStyle = nightRgba(1);
    ctx.fillRect(bx + 1, base - 8 * k, brk - 2, 16 * k);
    ctx.strokeStyle = 'rgba(244,241,234,0.5)';
    ctx.lineWidth = Math.max(1, 1.4 * k);
    for (const dx of [0.38, 0.62]) {
        ctx.beginPath();
        ctx.moveTo(bx + brk * dx - 5 * k, base + 9 * k);
        ctx.lineTo(bx + brk * dx + 5 * k, base - 9 * k);
        ctx.stroke();
    }
    ctx.restore();
    if (p.dark > 0) label(e, null, dur(p.dark), tPx * 0.9, bx + brk / 2, base - 22 * k, { align: 'center', maxW: brk * 1.6, color: MUTED });
    // Axis.
    ctx.fillStyle = 'rgba(244,241,234,0.35)';
    ctx.fillRect(x0, base, bx - x0, Math.max(1, 1.2 * k));
    ctx.fillRect(bx + brk, base, x1 - bx - brk, Math.max(1, 1.2 * k));

    // Moon over the dusk window, sun over the morning.
    const g = Math.min(26 * k, hMax * 0.14);
    crescent(ctx, xA(p.pad + p.dl) + g * 0.6, top + g * 0.2, g * 0.7, 'rgba(244,241,234,0.55)');

    // Where the light changes: dots, and the labels.
    const lit = readable(e.accent);
    const dot = (x, y, c, r = 5) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r * k, 0, Math.PI * 2); ctx.fill(); };
    const dX = xA(p.pad);
    const aX = xB(p.pad + p.al);
    const sX = xB(p.pad);
    dot(dX, base - duskH, rgba(kelvinRgb(kD), 1));
    dot(sX, base, rgba(kelvinRgb(kS), 1), 4);
    // The alarm: a line up to the peak, a dot in the accent, the sun.
    ctx.fillStyle = lit;
    ctx.fillRect(aX - Math.max(1, 1.2 * k) / 2, base - peakH, Math.max(1, 1.2 * k), peakH);
    dot(aX, base - peakH, lit, 6);
    sun(ctx, x1 - g * 0.7, top - lPx * 1.9 - g * 0.1, g * 0.7, 'rgba(244,241,234,0.55)', Math.max(1, 1.6 * k));
    line(e, 'duskLight', e.caps(e.fields.duskLight), TYPE.mono, lPx, x0, base - duskH - lPx * 1.4, { maxW: bx - x0 - 10 * k, tracking: 0.12, color: SOFT });
    line(e, 'dawnLight', e.caps(e.fields.dawnLight), TYPE.mono, lPx, sX - 10 * k, base - lPx * 1.1, { align: 'right', maxW: Math.max(40 * k, sX - bx - brk * 0.2), tracking: 0.12, color: SOFT });
    line(e, 'peak', e.caps(e.fields.peak), TYPE.mono, lPx, aX - 12 * k, base - peakH + lPx * 0.36, { align: 'right', maxW: aX - sX, tracking: 0.12, color: INK });

    // Under the axis: the four times, then the two lengths as brackets.
    let ty = base + tPx * (compact ? 1.9 : 2.2);
    const time = (key, m, x, align, color = MUTED) => line(e, key, clock(m), TYPE.mono, tPx, x, ty, { align, tracking: 0.1, color });
    time('dusk', p.dusk, dX, 'center');
    line(e, null, clock(p.dusk + p.dl), TYPE.mono, tPx, xA(p.pad + p.dl), ty, { align: 'center', tracking: 0.1, color: MUTED });
    line(e, null, clock(p.alarm - p.al), TYPE.mono, tPx, sX, ty, { align: 'center', tracking: 0.1, color: MUTED });
    time('alarm', p.alarm, aX, 'center', lit);
    ctx.fillStyle = HAIR;
    for (const x of [dX, xA(p.pad + p.dl), sX, aX]) ctx.fillRect(x - 0.5, base, 1, tPx * 0.7);
    ty += lPx * (compact ? 2.1 : 2.6);
    const bracket = (xa, xb, text, key) => {
        ctx.save();
        ctx.strokeStyle = 'rgba(244,241,234,0.3)';
        ctx.lineWidth = Math.max(1, 1.2 * k);
        const yy = ty - lPx * 1.5;
        ctx.beginPath();
        ctx.moveTo(xa, yy - 4 * k); ctx.lineTo(xa, yy); ctx.lineTo(xb, yy); ctx.lineTo(xb, yy - 4 * k);
        ctx.stroke();
        ctx.restore();
        label(e, key, text, lPx * 0.9, (xa + xb) / 2, ty, { align: 'center', maxW: Math.max(xb - xa, 60 * k) * 1.6, color: MUTED });
    };
    bracket(dX, xA(p.pad + p.dl), `Sunset ${mins(p.dl)}`, 'duskLen');
    bracket(sX, aX, `Sunrise ${mins(p.al)}`, 'dawnLen');
    e.mark('curve', { x: x0, y: top, w: x1 - x0, h: base - top });
}

export default {
    id: 'sleep-sunrise-curve',
    name: 'Sunrise Curve',
    category: 'Sleep',
    section: 'Products',
    blurb: 'A wake light’s programme as a chart: the sunset fade at bedtime, the sunrise ramp to the alarm, warm to daylight, lux and kelvin labelled.',
    refs: 'a lighting maker’s photometric chart',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Wake light' },
        { key: 'name', label: 'Product', rows: 2, value: 'Dawn Lamp' },
        { key: 'model', label: 'Model line', value: 'Sunrise alarm light · Sunset mode' },
        { key: 'dusk', label: 'Sunset starts', value: '22:30' },
        { key: 'duskLen', label: 'Sunset length', value: '30 min' },
        { key: 'alarm', label: 'Alarm', value: '06:45' },
        { key: 'dawnLen', label: 'Sunrise length', value: '30 min' },
        { key: 'duskLight', label: 'Evening light', value: '150 lux · 2,700 K', hint: 'Lux and kelvin, as rated. The kelvin sets the colour.' },
        { key: 'dawnLight', label: 'Sunrise starts at', value: '2,000 K' },
        { key: 'peak', label: 'At the alarm', value: '300 lux · 6,500 K' },
        { key: 'price', label: 'Price', value: '£129' },
        { key: 'offer', label: 'Offer (small)', value: 'Or 3,000 POWR points', hint: 'Optional.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Wake light', fields: {}, look: { kind: 'device' } },
        { name: 'Early alarm', fields: { eyebrow: 'Set for early', name: 'Dawn Lamp Mini', model: 'Sunrise alarm clock · USB-C', dusk: '21:45', duskLen: '20 min', alarm: '05:30', dawnLen: '40 min', duskLight: '80 lux · 2,200 K', dawnLight: '1,800 K', peak: '250 lux · 5,000 K', price: '£69', offer: '' }, look: { kind: 'device' }, style: { accent: '#E8A27C' } },
        { name: 'Smart bulb', fields: { eyebrow: 'Any lamp you own', name: 'Dawn Bulb', model: 'E27 smart bulb · App schedules', dusk: '22:00', duskLen: '45 min', alarm: '07:00', dawnLen: '30 min', duskLight: '400 lm · 2,700 K', dawnLight: '2,000 K', peak: '806 lm · 6,500 K', price: '£24', offer: 'Or 600 POWR points' }, look: { kind: 'box' }, style: { accent: '#9DB8FF' } },
        { name: 'Weekend', fields: { eyebrow: 'Saturday settings', dusk: '23:30', duskLen: '30 min', alarm: '08:30', dawnLen: '45 min', offer: 'Members first in the POWR app' }, look: { kind: 'device' }, style: { accent: '#7FE0C2' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'device' },
    controls: [{ key: 'kind', label: 'Stand-in', options: KINDS }],
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            offer: [r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''}` : '', r.cost ? `${Number(r.cost).toLocaleString('en-GB')} POWR points` : ''].filter(Boolean).join(' · '),
        }),
    },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        nightGround(e, { glow: { x: 0.75, y: 0.3 }, sink: 0.74 });
        const kind = e.look.kind ?? 'device';
        const hb = head(e, f);
        const hasOffer = String(e.fields.offer ?? '').trim() !== '';

        if (f.side) {
            const cW = (x1 - x0) * (f.strip ? 0.3 : 0.3);
            const top = hb + (f.strip ? 30 : 70) * k;
            const t = title(e, 'name', f.strip ? String(e.fields.name ?? '').replace(/\s*\n\s*/g, ' ') : e.fields.name, x0, top, { maxW: cW, maxH: (f.strip ? 56 : 150) * k, max: (f.strip ? 48 : 84) * k, lines: f.strip ? 1 : 2 });
            const mPx = (f.strip ? 11 : 15) * k;
            small(e, 'model', x0, t.bottom + mPx * 2.6, mPx, { maxW: cW, color: SOFT });
            const pPx = (f.strip ? 26 : 40) * k;
            const oPx = (f.strip ? 11 : 14) * k;
            const pBase = y1 - (hasOffer ? oPx * 2.4 : 0);
            price(e, 'price', x0, pBase, pPx, { maxW: cW * 0.5 });
            if (hasOffer) small(e, 'offer', x0, y1, oPx, { maxW: cW });
            if (f.strip) {
                const pw = cW * 0.4;
                const pTop = t.bottom + mPx * 4;
                productShot(e, { x: x0 + cW - pw, y: pTop, w: pw, h: y1 - pTop }, { kind, sub: '', align: 'right' });
            } else {
                const pTop = t.bottom + mPx * 5;
                const pBot = pBase - pPx - 40 * k;
                glow(e, x0 + cW / 2, (pTop + pBot) / 2, cW * 0.7, 0.08);
                productShot(e, { x: x0, y: pTop, w: cW * 0.8, h: pBot - pTop }, { kind, sub: '' });
            }
            const cx = x0 + cW + (f.strip ? 60 : 100) * k;
            chart(e, { x: cx, y: hb + (f.strip ? 4 : 40) * k, w: x1 - cx, h: y1 - hb - (f.strip ? 4 : 40) * k }, k, { compact: f.strip });
            return;
        }

        const top = hb + (f.tall ? 70 : f.sq ? 36 : 50) * k;
        const pW = (x1 - x0) * (f.sq ? 0.3 : 0.36);
        const zoneH = (f.tall ? 440 : f.sq ? 250 : 320) * k;
        glow(e, x1 - pW / 2, top + zoneH * 0.55, pW * 0.8, 0.09);
        productShot(e, { x: x1 - pW, y: top, w: pW, h: zoneH }, { kind, sub: '' });
        const tW = x1 - x0 - pW - 30 * k;
        const t = title(e, 'name', e.fields.name, x0, top + 20 * k, { maxW: tW, maxH: (f.sq ? 130 : 170) * k, max: (f.tall ? 100 : f.sq ? 76 : 90) * k });
        const mPx = (f.tall ? 17 : 15) * k;
        small(e, 'model', x0, t.bottom + mPx * 3, mPx, { maxW: tW, color: SOFT });
        const pPx = (f.tall ? 46 : f.sq ? 36 : 42) * k;
        const oPx = (f.tall ? 16 : 14) * k;
        const pBase = y1 - (hasOffer ? oPx * 2.4 : 0);
        price(e, 'price', x0, pBase, pPx, { maxW: (x1 - x0) * 0.4 });
        if (hasOffer) small(e, 'offer', x0, y1, oPx, { maxW: (x1 - x0) * 0.6 });
        const cTop = top + zoneH + (f.tall ? 70 : f.sq ? 20 : 40) * k;
        const cBot = pBase - pPx - (f.tall ? 70 : f.sq ? 30 : 44) * k;
        chart(e, { x: x0, y: cTop, w: x1 - x0, h: cBot - cTop }, k, { compact: f.sq });
    },
};
