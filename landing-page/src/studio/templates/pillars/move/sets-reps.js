/**
 * SETS × REPS — strength notation as the hero: "5 × 5" huge (the × thin and
 * in the accent), the lift and its load on a ruled line under it, and a set
 * tracker — one box per set, filled as they're done. For gyms, strength
 * coaches and gear brands.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, capHeight } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, DIM, HAIR, topRow, mono, unitOf, fitPx, onAccent } from './_parts';

const X = TYPE.brandXL;

const count = (v, lo, hi, dflt) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

// "5 × 5" fitted into maxW × maxH with its left ink at x and cap-top at top.
// Returns the box.
function notation(e, x, top, maxW, maxH, align = 'left', middle = null) {
    const { ctx } = e;
    const a = String(e.fields.sets ?? '').trim() || '5';
    const b = String(e.fields.reps ?? '').trim() || '5';
    const ref = 200;
    const cap = capHeight(ctx, e.headline, ref);
    const wa = textWidth(ctx, a, e.headline, ref, -0.02);
    const wb = textWidth(ctx, b, e.headline, ref, -0.02);
    const xPx = ref * 0.62;
    const wx = textWidth(ctx, '×', X, xPx, 0);
    const gap = ref * 0.1;
    const total = wa + gap + wx + gap + wb;
    const s = Math.min(maxW / total, maxH / cap);
    const px = ref * s;
    const w = total * s;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (middle !== null) top = middle - (cap * s) / 2;
    const base = top + cap * s;
    const col = e.headlineAccent ? e.accent : e.ink;
    drawText(ctx, a, e.headline, px, left, base, { tracking: -0.02, color: col });
    // The × sits on the numbers' mid-height.
    const xCap = capHeight(ctx, X, xPx * s);
    drawText(ctx, '×', X, xPx * s, left + (wa + gap) * s, base - (cap * s) / 2 + xCap * 0.42, { color: e.accent });
    drawText(ctx, b, e.headline, px, left + (wa + gap * 2 + wx) * s, base, { tracking: -0.02, color: col });
    const box = { x: left, y: top, w, h: cap * s };
    e.mark('sets', box);
    e.mark('reps', box);
    return box;
}

// Lift name left, load right, a hairline under. Returns the rule's y.
function liftLine(e, x0, x1, base, px) {
    const { ctx } = e;
    const k = unitOf(e);
    const load = String(e.fields.load ?? '').trim();
    const lw = load ? textWidth(ctx, load, TYPE.brandL, px, 0) : 0;
    const room = x1 - x0 - lw - (load ? 36 * k : 0);
    const lift = String(e.fields.lift ?? '').trim();
    e.mark('lift', drawText(ctx, lift, TYPE.brandSB, fitPx(ctx, lift, TYPE.brandSB, px, room, -0.01), x0, base, { tracking: -0.01, color: e.ink }));
    if (load) e.mark('load', drawText(ctx, load, TYPE.brandL, px, x1, base, { align: 'right', color: e.ink }));
    const y = base + px * 0.45;
    rule(ctx, x0, y, x1, y, HAIR, Math.max(1, 1.4 * k));
    return y;
}

// The set tracker: one square per set (filled = done), numbered, with
// "3 of 5 sets" over it. (x0..x1, box size b, boxes' top at y). Returns the bottom.
function tracker(e, x0, x1, y, b, { labels = true } = {}) {
    const { ctx } = e;
    const k = unitOf(e);
    const sets = count(e.fields.sets, 1, 10, 5);
    const done = count(e.fields.done, 0, sets, 0);
    const gap = Math.min(b * 0.28, 22 * k);
    const size = Math.min(b, (x1 - x0 - gap * (sets - 1)) / sets);
    const nPx = size * 0.34;
    const reps = String(e.fields.reps ?? '').trim();
    for (let i = 0; i < sets; i++) {
        const x = x0 + i * (size + gap);
        if (i < done) {
            ctx.fillStyle = e.accent;
            ctx.fillRect(x, y, size, size);
        } else {
            ctx.save();
            ctx.fillStyle = 'rgba(10,10,10,0.45)';
            ctx.fillRect(x, y, size, size);
            ctx.strokeStyle = DIM;
            ctx.lineWidth = Math.max(1, 2 * k);
            ctx.strokeRect(x + k, y + k, size - 2 * k, size - 2 * k);
            ctx.restore();
        }
        if (reps && nPx > 9 * k) {
            drawText(ctx, reps, TYPE.brandM, nPx, x + size / 2, y + size / 2 + capHeight(ctx, TYPE.brandM, nPx) / 2, { align: 'center', color: i < done ? onAccent(e.accent) : GREY });
        }
        if (labels) drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, Math.max(11 * k, size * 0.17), x, y + size + Math.max(11 * k, size * 0.17) * 1.6, { tracking: 0.1, color: GREY });
    }
    const box = { x: x0, y, w: sets * size + (sets - 1) * gap, h: size };
    e.mark('done', box);
    return y + size + (labels ? Math.max(11 * k, size * 0.17) * 2 : 0);
}

const status = (e) => {
    const sets = count(e.fields.sets, 1, 10, 5);
    const done = count(e.fields.done, 0, sets, 0);
    return done >= sets ? `All ${sets} sets done` : `${done} of ${sets} sets done`;
};

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.66, H, 'left', 0.88);
    e.fade(0, H * 0.4, W, H * 0.6, 'bottom', 0.55);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    topRow(e, x0, strip ? W * 0.3 : x1, y0, (strip ? 42 : 56) * k, { px: (strip ? 14 : 17) * k });
    const heroTop = y0 + (strip ? 70 : 120) * k;
    const heroH = y1 - heroTop - (strip ? 0 : 60 * k);
    const hero = strip
        ? notation(e, x0, heroTop, W * 0.3, heroH)
        : notation(e, x0, 0, W * 0.4, (y1 - y0) * 0.56, 'left', H * 0.54);
    const cx0 = strip ? W * 0.4 : hero.x + hero.w + 100 * k;
    const cx1 = x1;
    const px = (strip ? 40 : 52) * k;
    const mid = strip ? (y0 + y1) / 2 : H * 0.52;
    e.shade({ x: cx0, y: mid - px * 2.2, w: cx1 - cx0, h: px * 2.2 + (strip ? 90 : 150) * k }, { ceiling: 0.24, max: 0.6, spread: 1.05 });
    const note = String(e.fields.note ?? '').trim();
    if (note) e.mark('note', drawText(ctx, note, TYPE.brandR, fitPx(ctx, note, TYPE.brandR, (strip ? 22 : 28) * k, cx1 - cx0), cx0, mid - px * 1.7, { color: SOFT }));
    const ry = liftLine(e, cx0, cx1, mid - px * 0.4, px);
    const trackTop = ry + (strip ? 26 : 50) * k;
    const b = Math.min((strip ? 64 : 92) * k, y1 - trackTop - (strip ? 0 : 60 * k));
    tracker(e, cx0, cx1, trackTop, b, { labels: !strip });
    if (!strip) {
        mono(e, status(e), cx0, trackTop + b + 58 * k, 15 * k, { color: SOFT });
        e.mark('footer', mono(e, e.fields.footer, x0, y1, 16 * k, { tracking: 0.16 }));
    }
}

export default {
    id: 'sets-reps',
    name: 'Sets × Reps',
    category: 'Move',
    blurb: 'Strength notation as the hero: “5 × 5” huge, the lift and its load, a tracker that fills set by set. For gyms, coaches and gear.',
    refs: 'a lifter’s logbook',
    headlineFont: 'shoulders',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Strength · Week 4' },
        { key: 'sets', label: 'Sets', value: '5' },
        { key: 'reps', label: 'Reps', value: '5' },
        { key: 'lift', label: 'Lift', value: 'Back squat' },
        { key: 'load', label: 'Load', value: '100 kg', hint: 'Leave empty to hide it.' },
        { key: 'done', label: 'Sets done', value: '3', hint: 'How many boxes are filled.' },
        { key: 'note', label: 'Note', value: 'Two minutes between sets.' },
        { key: 'footer', label: 'Footer', value: 'Every session counts · powr.life' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Strength day (POWR)', fields: { eyebrow: 'Strength · Week 4', sets: '5', reps: '5', lift: 'Back squat', load: '100 kg', done: '3', note: 'Two minutes between sets.', footer: 'Every session counts · powr.life' } },
        { name: 'Gym programme', fields: { eyebrow: 'Northside · Strength club', sets: '3', reps: '10', lift: 'Romanian deadlift', load: '60 kg', done: '3', note: 'Slow on the way down. Every rep.', footer: 'Mon · Wed · Fri 07:00 · Northside Gym' } },
        { name: 'Coach', fields: { eyebrow: 'Today’s top set', sets: '8', reps: '3', lift: 'Deadlift', load: '140 kg', done: '5', note: 'Same bar speed on the last as the first.', footer: 'Programme by Coach Sam · Week 6' } },
        { name: 'Gear', fields: { eyebrow: 'Built for the rack', sets: '4', reps: '6', lift: 'Bench press', load: '80 kg', done: '0', note: 'The Rack Tee. In store and online now.', footer: 'Northside · Training kit' } },
    ],
    look: {
        mono: 1, target: 0.2, auto: 0.85, contrast: 0.55, crush: 0.18, fade: 0,
        tint: 'warm', tintAmount: 0.4, motion: 0, angle: 0, focus: 0.6, vignette: 0.6, grain: 0.55, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), note: r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''} with ${r.brand}, in the POWR app.` : `Rewards from ${r.brand} in the POWR app.` }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.24, 'top', 0.5);
        e.fade(0, H * 0.3, W, H * 0.7, 'bottom', 0.92);

        topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);

        // Bottom up: footer, tracker (with its status), lift line, the notation.
        const footBase = H - safe.b - 4 * u;
        e.mark('footer', mono(e, e.fields.footer, x0, footBase, (sq ? 15 : 17) * u, { tracking: 0.16 }));
        const b = (tall ? 112 : sq ? 76 : 96) * u;
        const trackTop = footBase - (sq ? 56 : 76) * u - b - Math.max(11 * u, b * 0.17) * 2;
        tracker(e, x0, x1, trackTop, b);
        const stPx = (sq ? 16 : 18) * u;
        const st = mono(e, status(e), x1, trackTop - 22 * u, stPx, { align: 'right', color: SOFT });
        const note = String(e.fields.note ?? '').trim();
        const nPx = (sq ? 24 : 28) * u;
        const nRoom = x1 - x0 - (st ? st.w + 40 * u : 0);
        if (note) e.mark('note', drawText(ctx, note, TYPE.brandR, fitPx(ctx, note, TYPE.brandR, nPx, nRoom), x0, trackTop - 22 * u, { color: SOFT }));

        const px = (tall ? 64 : sq ? 46 : 56) * u;
        const liftBase = trackTop - (sq ? 80 : 110) * u;
        liftLine(e, x0, x1, liftBase, px);
        const heroBottom = liftBase - px * 0.72 - (sq ? 44 : 60) * u;
        const heroH = H * (tall ? 0.24 : sq ? 0.26 : 0.27) * size;
        e.shade({ x: x0, y: heroBottom - heroH, w: x1 - x0, h: heroH }, { ceiling: 0.28, max: 0.55 });
        const cap200 = capHeight(ctx, e.headline, 200);
        // Fit first at full height, then sit its baseline on heroBottom.
        const probeW = x1 - x0;
        const a = String(e.fields.sets ?? '').trim() || '5';
        const bb = String(e.fields.reps ?? '').trim() || '5';
        const natW = (textWidth(ctx, a, e.headline, 200, -0.02) + textWidth(ctx, bb, e.headline, 200, -0.02) + textWidth(ctx, '×', X, 124, 0) + 40) / cap200;
        const h = Math.min(heroH, probeW / natW);
        notation(e, x0 - 4 * u, heroBottom - h, probeW, h);
    },
};
