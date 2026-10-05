/**
 * SOUNDSCAPE — a sound machine or sleep-sound app's library: the product,
 * then its sounds listed one per row, each with a small drawn waveform whose
 * character comes from the sound's name (rain is fine and restless, ocean
 * swells, a fan is steady, brown noise rolls low and smooth; anything else
 * gets its own shape from the name), one sound lit in the accent with a
 * playhead, and the timer line at the foot. What it plays, never what it does.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, rewardWords } from '../../kit';
import { frame, nightGround, head, title, parseRows, price, small, glow, tint, line, readable, crescent, INK, SOFT, MUTED, HAIR, NIGHT_LOOK, clamp } from './_parts';
import { KINDS } from './moonlit';

const hash = (s) => {
    let h = 2166136261;
    for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
};
// A small seeded generator (mulberry32).
const rng = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The waveform's character: a floor, a slow swell, grain, sparse peaks, smoothing.
function character(name) {
    const t = name.toLowerCase();
    const h = hash(t);
    const r = rng(h);
    let c = { base: 0.3 + r() * 0.3, swell: r() * 0.35, periods: 1 + r() * 4, jitter: 0.1 + r() * 0.4, spikes: r() * 0.15, smooth: r() * 0.7 };
    if (/rain|shower|drizzle|drops/.test(t)) c = { base: 0.42, swell: 0.08, periods: 2, jitter: 0.55, spikes: 0.1, smooth: 0 };
    else if (/white/.test(t)) c = { base: 0.72, swell: 0, periods: 1, jitter: 0.32, spikes: 0, smooth: 0 };
    else if (/pink/.test(t)) c = { base: 0.6, swell: 0.06, periods: 2, jitter: 0.3, spikes: 0, smooth: 0.3 };
    else if (/brown|noise|hum/.test(t)) c = { base: 0.34, swell: 0.42, periods: 2.2, jitter: 0.26, spikes: 0, smooth: 0.82 };
    else if (/fan|air|engine|train|flight|plane/.test(t)) c = { base: 0.52, swell: 0.04, periods: 8, jitter: 0.07, spikes: 0, smooth: 0.45 };
    else if (/ocean|wave|sea|surf|tide|shore/.test(t)) c = { base: 0.1, swell: 0.8, periods: 3, jitter: 0.14, spikes: 0, smooth: 0.55 };
    else if (/thunder|storm/.test(t)) c = { base: 0.28, swell: 0.12, periods: 1.5, jitter: 0.3, spikes: 0.05, smooth: 0.35 };
    else if (/forest|bird|cricket|night|garden|owl/.test(t)) c = { base: 0.1, swell: 0.05, periods: 2, jitter: 0.1, spikes: 0.2, smooth: 0.05 };
    else if (/fire|crackl|hearth/.test(t)) c = { base: 0.28, swell: 0.12, periods: 2, jitter: 0.22, spikes: 0.18, smooth: 0.15 };
    else if (/stream|river|brook|water|fountain/.test(t)) c = { base: 0.44, swell: 0.16, periods: 6, jitter: 0.3, spikes: 0, smooth: 0.4 };
    else if (/heart|pulse|beat/.test(t)) c = { base: 0.12, swell: 0, periods: 1, jitter: 0.04, spikes: 0, smooth: 0, beat: 7 };
    return { ...c, seed: h };
}

/** n bar heights (0–1) for a sound's name — the same name always draws the same wave. */
export function levels(name, n) {
    const c = character(name);
    const r = rng(c.seed ^ 0x9e3779b9);
    const phase = r() * Math.PI * 2;
    let prev = c.base;
    const out = [];
    for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n);
        let v = c.base + c.swell * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * c.periods + phase)) + (r() - 0.5) * c.jitter;
        if (r() < c.spikes) v += 0.3 + r() * 0.45;
        if (c.beat) { const b = (i % c.beat); v += b === 0 ? 0.75 : b === 1 ? 0.45 : 0; }
        v = prev * c.smooth + v * (1 - c.smooth);
        prev = v;
        out.push(clamp(v, 0.05, 1));
    }
    return out;
}

// One waveform strip centred on midY. `play` (0–1) is the playhead on the lit one.
function wave(e, name, x, midY, w, h, k, { on = false, play = 0.38 } = {}) {
    const { ctx } = e;
    const bw = Math.max(1, 3 * k);
    const step = bw + Math.max(1, 2.6 * k);
    const n = Math.max(4, Math.floor(w / step));
    const lv = levels(name, n);
    const lit = readable(e.accent);
    ctx.save();
    lv.forEach((v, i) => {
        const bh = Math.max(bw, v * h);
        const bx = x + i * step;
        ctx.fillStyle = on ? (i / n <= play ? lit : tint(lit, 0.42)) : 'rgba(244,241,234,0.3)';
        ctx.beginPath();
        ctx.roundRect(bx, midY - bh / 2, bw, bh, bw / 2);
        ctx.fill();
    });
    if (on) {
        const px = x + Math.round(n * play) * step - step * 0.3;
        ctx.fillStyle = INK;
        ctx.fillRect(px, midY - h * 0.62, Math.max(1, 1.5 * k), h * 1.24);
        ctx.beginPath();
        ctx.arc(px + Math.max(1, 1.5 * k) / 2, midY - h * 0.62, 3.2 * k, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
    return { x, y: midY - h / 2, w: n * step, h };
}

// The sound list in `box`, `cols` across. Marks 'sounds' (and 'playing' on the lit row).
function library(e, rows, box, k, { cols = 1, px = 30, maxRow = 120 } = {}) {
    const { ctx } = e;
    if (!rows.length) return;
    const pick = String(e.fields.playing ?? '').trim().toLowerCase();
    const per = Math.ceil(rows.length / cols);
    const gapC = 50 * k;
    const cw = (box.w - (cols - 1) * gapC) / cols;
    const rowH = Math.min(maxRow * k, box.h / per);
    const y0 = box.y + (box.h - rowH * per) / 2;
    const lit = readable(e.accent);
    let mb = null;
    const grow = (b) => { if (b) mb = mb ? { x: Math.min(mb.x, b.x), y: Math.min(mb.y, b.y), w: Math.max(mb.x + mb.w, b.x + b.w) - Math.min(mb.x, b.x), h: Math.max(mb.y + mb.h, b.y + b.h) - Math.min(mb.y, b.y) } : b; };
    const dPx = Math.max(9 * k, px * 0.42);
    const namePx = Math.min(px, rowH * (rows.some((r) => r[1]) ? 0.4 : 0.5));
    rows.forEach((r, i) => {
        const c = Math.floor(i / per);
        const x = box.x + c * (cw + gapC);
        const top = y0 + (i % per) * rowH;
        const on = pick && r[0].toLowerCase() === pick;
        ctx.fillStyle = HAIR;
        ctx.fillRect(x, top, cw, Math.max(1, 1.2 * k));
        if (on) {
            ctx.fillStyle = tint(e.accent, 0.07);
            ctx.fillRect(x, top + Math.max(1, 1.2 * k), cw, rowH - Math.max(1, 1.2 * k));
        }
        const mid = top + rowH / 2;
        const nx = x + namePx * 1.5;
        // The number, or a play mark on the lit one.
        if (on) {
            const s = namePx * 0.34;
            ctx.fillStyle = lit;
            ctx.beginPath();
            ctx.moveTo(x + 2 * k, mid - s);
            ctx.lineTo(x + 2 * k + s * 1.6, mid);
            ctx.lineTo(x + 2 * k, mid + s);
            ctx.closePath();
            ctx.fill();
        } else {
            line(e, null, String(i + 1).padStart(2, '0'), TYPE.mono, dPx, x, mid + dPx * 0.36, { tracking: 0.1, color: MUTED });
        }
        const textW = cw * 0.44;
        const hasD = !!r[1];
        const nb = line(e, null, r[0], TYPE.brandL, namePx, nx, hasD ? mid - namePx * 0.08 : mid + namePx * 0.36, { maxW: textW - namePx * 1.5, color: on ? lit : INK });
        grow(nb);
        if (hasD) grow(line(e, null, e.caps(r.slice(1).join(' · ')), TYPE.mono, dPx, nx, mid + namePx * 0.2 + dPx * 1.35, { maxW: textW - namePx * 1.5, tracking: 0.12, color: MUTED }));
        const wx = x + textW + 20 * k;
        const wb = wave(e, r[0], wx, mid, x + cw - wx - 6 * k, Math.min(rowH * 0.46, 56 * k), k, { on });
        grow(wb);
        if (on) e.mark('playing', { x, y: top, w: cw, h: rowH });
    });
    ctx.fillStyle = HAIR;
    for (let c = 0; c < cols; c++) ctx.fillRect(box.x + c * (cw + gapC), y0 + rowH * Math.min(per, rows.length - c * per), cw, Math.max(1, 1.2 * k));
    e.mark('sounds', mb);
}

// A crescent and the timer line on baseline y. Returns its box.
function timer(e, x, y, px, maxW) {
    const t = String(e.fields.timer ?? '').trim();
    if (!t) return null;
    crescent(e.ctx, x + px * 0.45, y - px * 0.36, px * 0.46, readable(e.accent));
    return line(e, 'timer', t, TYPE.brandR, px, x + px * 1.3, y, { maxW: maxW - px * 1.3, color: SOFT });
}

export default {
    id: 'sleep-soundscape',
    name: 'Soundscape',
    category: 'Sleep',
    section: 'Products',
    blurb: 'A sound machine or sleep-sound app: the product and its sound library, each sound with its own drawn waveform, one lit.',
    refs: 'the track list on a hi-fi maker’s product page',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'The sound library' },
        { key: 'name', label: 'Product', rows: 2, value: 'Hush One' },
        { key: 'model', label: 'Model line', value: 'Bedside sound machine · 24 sounds' },
        { key: 'sounds', label: 'Sounds', rows: 6, value: 'Rain — On a tin roof\nBrown noise — Low and even\nFan — Box fan, medium\nOcean — Slow swell\nForest night — Crickets, far off', hint: 'Up to six, one per line: sound — detail (optional). Each draws its own waveform from its name.' },
        { key: 'playing', label: 'Lit sound', value: 'Brown noise', hint: 'The one playing (its name, as above). Empty for none.' },
        { key: 'timer', label: 'Timer line', value: 'Fades out after 60 min' },
        { key: 'price', label: 'Price', value: '£89' },
        { key: 'offer', label: 'Offer (small)', value: 'Or 2,200 POWR points', hint: 'Optional.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Sound machine', fields: {}, look: { kind: 'device' } },
        { name: 'Sleep app', fields: { eyebrow: 'Tonight’s mix', name: 'Hush App', model: 'Sleep sounds · iOS and Android', sounds: 'Heavy rain\nPink noise\nOvernight train\nStream — Shallow, over stones\nFireplace', playing: 'Overnight train', timer: 'Stops after 45 min', price: '£4.99 a month', offer: 'Three months free with POWR points' }, look: { kind: 'box' }, style: { accent: '#9DB8FF' } },
        { name: 'Sleep headphones', fields: { eyebrow: 'Built-in sounds', name: 'Soft Band', model: 'Sleep headphones · Flat 6 mm speakers', sounds: 'White noise\nRain — Light, steady\nOcean — Far out\nBrown noise', playing: 'Ocean', timer: 'Timer from 15 to 120 min', price: '£79', offer: 'Or 1,900 POWR points' }, look: { kind: 'mask' }, style: { accent: '#7FE0C2' } },
        { name: 'Travel', fields: { eyebrow: 'Pocket size', name: 'Hush Mini', model: 'Travel sound machine · USB-C', sounds: 'Fan — Low hum\nWhite noise\nRain\nThunder — Distant', playing: 'Fan', timer: 'Runs all night on one charge', price: '£39', offer: '' }, look: { kind: 'device' }, style: { accent: '#E8A27C' } },
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
        nightGround(e, { glow: { x: 0.72, y: 0.3 }, sink: 0.72 });
        const kind = e.look.kind ?? 'device';
        const hb = head(e, f);
        const rows = parseRows(e.fields.sounds, 6);
        const n = Math.max(1, rows.length);
        const hasOffer = String(e.fields.offer ?? '').trim() !== '';

        if (f.side) {
            const cW = (x1 - x0) * (f.strip ? 0.36 : 0.32);
            const top = hb + (f.strip ? 34 : 70) * k;
            const t = title(e, 'name', f.strip ? String(e.fields.name ?? '').replace(/\s*\n\s*/g, ' ') : e.fields.name, x0, top, { maxW: cW, maxH: (f.strip ? 60 : 150) * k, max: (f.strip ? 52 : 84) * k, lines: f.strip ? 1 : 2 });
            const mPx = (f.strip ? 11 : 15) * k;
            small(e, 'model', x0, t.bottom + mPx * 2.6, mPx, { maxW: cW, color: SOFT });
            const pPx = (f.strip ? 26 : 40) * k;
            const oPx = (f.strip ? 11 : 14) * k;
            const pBase = y1 - (hasOffer ? oPx * 2.4 : 0);
            price(e, 'price', x0, pBase, pPx, { maxW: cW * 0.5 });
            if (hasOffer) small(e, 'offer', x0, y1, oPx, { maxW: cW });
            if (f.strip) {
                const pw = cW * 0.42;
                const px = x0 + cW - pw;
                productShot(e, { x: px, y: t.bottom + mPx * 4, w: pw, h: pBase - pPx - 10 * k - (t.bottom + mPx * 4) }, { kind, sub: '', align: 'right' });
            } else {
                const pTop = t.bottom + mPx * 5;
                const pBot = pBase - pPx - 40 * k;
                glow(e, x0 + cW / 2, (pTop + pBot) / 2, cW * 0.7, 0.08);
                productShot(e, { x: x0, y: pTop, w: cW * 0.86, h: pBot - pTop }, { kind, sub: '' });
            }
            const lx = x0 + cW + (f.strip ? 50 : 90) * k;
            const tPx = (f.strip ? 15 : 22) * k;
            const lTop = hb + (f.strip ? 12 : 40) * k;
            const lBot = y1 - tPx * (f.strip ? 2 : 3.4);
            library(e, rows, { x: lx, y: lTop, w: x1 - lx, h: lBot - lTop }, k, { cols: f.strip && n > 3 ? 2 : 1, px: (f.strip ? 20 : 30) * k, maxRow: f.strip ? 90 : 130 });
            timer(e, lx, y1 - 2 * k, tPx, x1 - lx);
            return;
        }

        // Post, story, square: title left, product right, the library across, the foot.
        const top = hb + (f.tall ? 70 : f.sq ? 36 : 50) * k;
        const pW = (x1 - x0) * (f.sq ? 0.34 : 0.4);
        const zoneH = (f.tall ? 540 : f.sq ? 300 : 360) * k;
        glow(e, x1 - pW / 2, top + zoneH * 0.55, pW * 0.8, 0.09);
        productShot(e, { x: x1 - pW, y: top, w: pW, h: zoneH }, { kind, sub: '' });
        const tW = x1 - x0 - pW - 30 * k;
        const t = title(e, 'name', e.fields.name, x0, top + 20 * k, { maxW: tW, maxH: (f.sq ? 130 : 170) * k, max: (f.tall ? 100 : f.sq ? 76 : 90) * k });
        const mPx = (f.tall ? 17 : 15) * k;
        small(e, 'model', x0, t.bottom + mPx * 3, mPx, { maxW: tW, color: SOFT });

        const pPx = (f.tall ? 46 : f.sq ? 36 : 42) * k;
        const oPx = (f.tall ? 16 : 14) * k;
        const tPx = (f.tall ? 24 : f.sq ? 19 : 22) * k;
        const footH = pPx * 1.2 + (hasOffer ? oPx * 2.4 : 0);
        const lTop = top + zoneH + (f.tall ? 50 : f.sq ? 22 : 34) * k;
        const lBot = y1 - footH - (f.tall ? 50 : 30) * k;
        library(e, rows, { x: x0, y: lTop, w: x1 - x0, h: lBot - lTop }, k, { px: (f.tall ? 32 : f.sq ? 24 : 28) * k, maxRow: f.tall ? 150 : 104 });
        const pBase = y1 - (hasOffer ? oPx * 2.4 : 0);
        const pb = price(e, 'price', x1, pBase, pPx, { align: 'right', maxW: (x1 - x0) * 0.4 });
        if (hasOffer) small(e, 'offer', x1, y1, oPx, { align: 'right', maxW: (x1 - x0) * 0.5 });
        timer(e, x0, pBase, tPx, (pb ? pb.x : x1) - x0 - 30 * k);
    },
};
