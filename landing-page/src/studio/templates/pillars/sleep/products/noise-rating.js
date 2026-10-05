/**
 * NOISE RATING — earplugs sold on their rating: a vertical decibel ruler
 * with everyday sounds marked at typical levels (for scale only), and the
 * product's rated attenuation drawn beside it as a bracket as long as its
 * SNR, arrow down, the number set big. The tin beside it. The rating as
 * tested, never a promise about the night.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, rewardWords } from '../../kit';
import { frame, nightGround, head, title, parseRows, price, small, glow, tint, line, label, readable, INK, SOFT, MUTED, NIGHT_LOOK, clamp } from './_parts';
import { KINDS } from './moonlit';

const dbOf = (s) => {
    const m = String(s ?? '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
};

// "Rain — 50" → { name, db }.
const parseRefs = (text) => parseRows(text, 6)
    .map((p) => ({ name: p[0], db: dbOf(p.slice(1).join(' ')) }))
    .filter((r) => r.name && Number.isFinite(r.db));

// The ruler, the sounds and the bracket in `box`. Marks 'levels', 'snr'.
function ruler(e, box, k, { compact = false } = {}) {
    const { ctx } = e;
    const refs = parseRefs(e.fields.levels);
    const snr = dbOf(e.fields.snr);
    const pick = String(e.fields.from ?? '').trim().toLowerCase();
    const anchor = refs.find((r) => r.name.toLowerCase() === pick);
    const hi = Math.max(90, Math.ceil((Math.max(0, ...refs.map((r) => r.db)) + 5) / 10) * 10);
    const lo = Math.min(20, Math.floor((Math.min(hi, ...refs.map((r) => r.db)) - 5) / 10) * 10);
    const nPx = (compact ? 11 : 14) * k;
    const top = box.y + nPx * 3.2;
    const bot = box.y + box.h - nPx * 0.8;
    const y = (db) => bot - ((db - lo) / (hi - lo)) * (bot - top);
    const lit = readable(e.accent);
    // Columns: the SNR figure, its bracket, the numbers, the spine, the sounds.
    const figW = box.w * 0.34;
    const bx = box.x + figW + 16 * k;
    const numR = bx + (compact ? 64 : 84) * k;
    const sx = numR + 14 * k;
    const refX = sx + (compact ? 34 : 44) * k;
    // The bracket's band first, so the numbers read over it.
    if (snr && snr > 0) {
        const fromDb = clamp(anchor ? anchor.db : hi, lo + snr, hi);
        ctx.fillStyle = tint(e.accent, 0.12);
        ctx.fillRect(bx + 10 * k, y(fromDb), sx - bx - 10 * k, y(fromDb - snr) - y(fromDb));
    }
    ctx.save();
    // Spine and ticks.
    ctx.fillStyle = 'rgba(244,241,234,0.45)';
    ctx.fillRect(sx, top, Math.max(1, 1.4 * k), bot - top);
    for (let d = lo; d <= hi; d += 5) {
        const major = d % 10 === 0;
        ctx.fillStyle = major ? 'rgba(244,241,234,0.5)' : 'rgba(244,241,234,0.25)';
        ctx.fillRect(sx, y(d) - 0.5, (major ? 18 : 9) * k, Math.max(1, 1.2 * k));
        if (major) line(e, null, String(d), TYPE.monoR, nPx, numR, y(d) + nPx * 0.36, { align: 'right', color: MUTED });
    }
    ctx.restore();
    label(e, 'scale', e.fields.scale, nPx * 0.9, sx, box.y + nPx, { align: 'left', maxW: box.x + box.w - sx, color: MUTED });
    line(e, null, 'dB', TYPE.mono, nPx * 0.9, numR, box.y + nPx, { align: 'right', color: MUTED });

    // The sounds at their typical levels.
    let mb = null;
    const grow = (b) => { if (b) mb = mb ? { x: Math.min(mb.x, b.x), y: Math.min(mb.y, b.y), w: Math.max(mb.x + mb.w, b.x + b.w) - Math.min(mb.x, b.x), h: Math.max(mb.y + mb.h, b.y + b.h) - Math.min(mb.y, b.y) } : b; };
    const rPx = (compact ? 17 : 24) * k;
    const minGap = rPx * 1.25;
    const sorted = [...refs].sort((a, b) => b.db - a.db);
    let lastY = -Infinity;
    sorted.forEach((r) => {
        const ty = Math.max(y(r.db), lastY + minGap);
        lastY = ty;
        const on = anchor === r;
        ctx.save();
        ctx.strokeStyle = on ? lit : 'rgba(244,241,234,0.35)';
        ctx.lineWidth = Math.max(1, 1.2 * k);
        ctx.beginPath();
        ctx.moveTo(sx + 20 * k, y(r.db));
        ctx.lineTo(refX - 10 * k, ty);
        ctx.stroke();
        ctx.fillStyle = on ? lit : INK;
        ctx.beginPath();
        ctx.arc(sx, y(r.db), 3.4 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const room = box.x + box.w - refX;
        const nb = line(e, null, r.name, TYPE.brandL, rPx, refX, ty + rPx * 0.34, { maxW: room * 0.66, color: on ? INK : SOFT });
        grow(nb);
        if (nb) grow(line(e, null, `${r.db} dB`, TYPE.monoR, nPx * 0.9, nb.x + nb.w + 12 * k, ty + rPx * 0.34, { maxW: room - nb.w - 12 * k, color: MUTED }));
    });
    e.mark('levels', mb);

    // The bracket: as long as the SNR, from the chosen sound (or the top) down.
    if (snr && snr > 0) {
        const fromDb = clamp(anchor ? anchor.db : hi, lo + snr, hi);
        const ya = y(fromDb);
        const yb = y(fromDb - snr);
        ctx.save();
        ctx.strokeStyle = lit;
        ctx.lineWidth = Math.max(1.5, 2.4 * k);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const a = 9 * k;
        ctx.beginPath();
        ctx.moveTo(bx + 14 * k, ya);
        ctx.lineTo(bx, ya);
        ctx.lineTo(bx, yb);
        ctx.moveTo(bx - a * 0.7, yb - a);
        ctx.lineTo(bx, yb);
        ctx.lineTo(bx + a * 0.7, yb - a);
        ctx.stroke();
        ctx.setLineDash([4 * k, 5 * k]);
        ctx.lineWidth = Math.max(1, 1.2 * k);
        ctx.beginPath();
        ctx.moveTo(bx, yb);
        ctx.lineTo(sx, yb);
        ctx.moveTo(bx + 14 * k, ya);
        ctx.lineTo(sx, ya);
        ctx.stroke();
        ctx.restore();
        // The figure, centred on the bracket.
        const mid = (ya + yb) / 2;
        const fPx = Math.min((compact ? 64 : 110) * k, (yb - ya) * 0.7, figW * 0.5);
        const fx = bx - 22 * k;
        const nb = line(e, null, String(snr), TYPE.brandL, fPx, fx, mid + fPx * 0.2, { align: 'right', maxW: figW - 24 * k, color: lit });
        const sb = label(e, null, e.fields.snr, nPx * 0.95, fx, mid + fPx * 0.2 + nPx * 2.2, { align: 'right', maxW: figW - 24 * k, color: INK });
        const bs = [nb, sb].filter(Boolean);
        if (bs.length) {
            const x = Math.min(...bs.map((b) => b.x));
            const y0 = Math.min(...bs.map((b) => b.y));
            e.mark('snr', { x, y: y0, w: fx - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 });
        }
    }
}

export default {
    id: 'sleep-noise-rating',
    name: 'Noise Rating',
    category: 'Sleep',
    section: 'Products',
    blurb: 'Earplugs sold on their rating: a decibel ruler with everyday sounds at typical levels, and the SNR drawn as a bracket.',
    refs: 'a sound engineer’s level meter',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Rated to EN 352-2' },
        { key: 'name', label: 'Product', rows: 2, value: 'Night Plugs' },
        { key: 'detail', label: 'Detail', value: 'Soft silicone · 3 sizes · Tin included' },
        { key: 'snr', label: 'Rating', value: 'SNR 29 dB', hint: 'Your tested rating. Its number sets the bracket’s length.' },
        { key: 'levels', label: 'Everyday sounds', rows: 5, value: 'Whisper — 30\nRain — 50\nSnoring — 60\nTraffic — 75', hint: 'Up to six, one per line: sound — typical level in dB. Shown for scale.' },
        { key: 'from', label: 'Bracket starts at', value: 'Traffic', hint: 'One of the sounds above. Empty to start at the top of the scale.' },
        { key: 'scale', label: 'Scale note', value: 'Typical levels, for scale' },
        { key: 'price', label: 'Price', value: '£24' },
        { key: 'offer', label: 'Offer (small)', value: 'Or 600 POWR points', hint: 'Optional.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Silicone', fields: {}, look: { kind: 'tin' } },
        { name: 'Foam', fields: { eyebrow: 'Single use', name: 'Soft Foam\nEarplugs', detail: 'Slow-recovery foam · 20 pairs', snr: 'SNR 35 dB', levels: 'Whisper — 30\nConversation — 60\nSnoring — 65\nBusy street — 80', from: 'Busy street', price: '£6', offer: '' }, look: { kind: 'box' }, style: { accent: '#E8A27C' } },
        { name: 'Wax', fields: { eyebrow: 'Mouldable', name: 'Wax Plugs', detail: 'Cotton and natural wax · 6 pairs', snr: 'SNR 27 dB', levels: 'Clock ticking — 20\nRain — 50\nSnoring — 60\nTrain — 80', from: 'Snoring', price: '£5.50', offer: 'Or 150 POWR points' }, look: { kind: 'tin' }, style: { accent: '#D8C3A5' } },
        { name: 'Travel', fields: { eyebrow: 'In the carry-on', name: 'Night Plugs\nTravel', detail: 'Filter plugs · Case and lanyard', snr: 'SNR 24 dB', levels: 'Whisper — 30\nCabin hum — 70\nAnnouncements — 80', from: 'Cabin hum', price: '£29', offer: 'Members first in the POWR app' }, look: { kind: 'tin' }, style: { accent: '#9DB8FF' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'tin' },
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
        nightGround(e, { glow: { x: 0.3, y: 0.62 }, sink: 0.74 });
        const kind = e.look.kind ?? 'tin';
        const hb = head(e, f);
        const hasOffer = String(e.fields.offer ?? '').trim() !== '';

        const words = (x, top, w, big, { lines = 2, bottom = y1 } = {}) => {
            const t = title(e, 'name', lines === 1 ? String(e.fields.name ?? '').replace(/\s*\n\s*/g, ' ') : e.fields.name, x, top, { maxW: w, maxH: big * 2.3, max: big, lines, gap: 0.24 });
            const dPx = Math.max(12 * k, big * 0.22);
            line(e, 'detail', e.fields.detail, TYPE.brandR, dPx, x, t.bottom + dPx * 2.2, { maxW: w, color: SOFT });
            const pPx = Math.max(24 * k, big * 0.5);
            const oPx = Math.max(11 * k, big * 0.17);
            const pBase = bottom - (hasOffer ? oPx * 2.4 : 0);
            price(e, 'price', x, pBase, pPx, { maxW: w });
            if (hasOffer) small(e, 'offer', x, bottom, oPx, { maxW: w });
            return { top: t.bottom + dPx * 3.6, bot: pBase - pPx * 1.5 };
        };

        if (f.side) {
            const cW = (x1 - x0) * (f.strip ? 0.3 : 0.3);
            words(x0, hb + (f.strip ? 30 : 80) * k, cW, (f.strip ? 46 : 84) * k, { lines: f.strip ? 1 : 2 });
            const px = x0 + cW + (f.strip ? 30 : 50) * k;
            const pw = (x1 - x0) * (f.strip ? 0.18 : 0.24);
            glow(e, px + pw / 2, (hb + y1) / 2, pw * 0.8, 0.08);
            productShot(e, { x: px, y: f.strip ? hb + 30 * k : (hb + y1) / 2 - pw * 0.4, w: pw, h: f.strip ? y1 - hb - 30 * k : pw * 0.9 }, { kind, sub: '' });
            const rx = px + pw + (f.strip ? 30 : 60) * k;
            ruler(e, { x: rx, y: hb + (f.strip ? 4 : 30) * k, w: x1 - rx, h: y1 - hb - (f.strip ? 4 : 30) * k }, k, { compact: f.strip });
            return;
        }

        // Post, story, square: words and product on the left, the ruler on the right.
        const split = f.sq ? 0.42 : 0.44;
        const cW = (x1 - x0) * split;
        const top = hb + (f.tall ? 80 : f.sq ? 40 : 60) * k;
        const w = words(x0, top, cW, (f.tall ? 92 : f.sq ? 68 : 80) * k);
        const room = w.bot - w.top - 30 * k;
        const pH = Math.min(room, cW * 0.8);
        const pY = w.top + 30 * k + (room - pH) * 0.6;
        glow(e, x0 + cW / 2, pY + pH / 2, cW * 0.7, 0.08);
        productShot(e, { x: x0 + cW * 0.06, y: pY, w: cW * 0.82, h: pH }, { kind, sub: '' });
        const rx = x0 + cW + 30 * k;
        ruler(e, { x: rx, y: hb + (f.tall ? 60 : 36) * k, w: x1 - rx, h: y1 - hb - (f.tall ? 60 : 36) * k }, k, { compact: f.sq });
    },
};
