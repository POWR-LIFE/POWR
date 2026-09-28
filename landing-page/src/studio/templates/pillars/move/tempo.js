/**
 * TEMPO — lifting tempo as a spec sheet: "3-1-X-1" huge, each figure in its
 * own ruled column with its phase named underneath (eccentric · pause ·
 * concentric · pause), then a timeline bar cut in those proportions over a
 * seconds scale. For coaches, gyms and strength programmes.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, HAIR, topRow, mono, unitOf, fitPx } from './_parts';

// An explosive "X" still takes a moment on the bar.
const X_SECONDS = 0.6;

// "3-1-X-1", "3 1 X 1", "31X1" → four { t: '3', s: 3 }.
function tempoOf(e) {
    const raw = String(e.fields.tempo ?? '').trim().toUpperCase();
    let parts = raw.split(/\s*[-–—.·/\s]\s*/).filter(Boolean);
    if (parts.length === 1 && parts[0].length === 4) parts = parts[0].split('');
    return parts.slice(0, 4).map((t) => ({ t, s: t === 'X' ? X_SECONDS : Math.max(0, parseFloat(t) || 0) }));
}

const phases = (e) => {
    const p = String(e.fields.phases ?? '').split(/\s*[·|,\n]\s*/).map((s) => s.trim());
    return [0, 1, 2, 3].map((i) => p[i] ?? '');
};

const secs = (s) => (Number.isInteger(s) ? `${s}` : s.toFixed(1));

// The four figures in ruled columns across x0..x1, cap-top at `top`, `px`
// tall; phase labels under. Returns the bottom of the labels.
function figures(e, x0, x1, top, px, labPx) {
    const { ctx } = e;
    const k = unitOf(e);
    const tempo = tempoOf(e);
    const n = Math.max(1, tempo.length);
    const cw = (x1 - x0) / n;
    const names = phases(e);
    // One size for all four, fitted to the column.
    let p = px;
    tempo.forEach(({ t }) => { p = Math.min(p, fitPx(ctx, t, e.headline, px, cw * 0.78, -0.02)); });
    const cap = capHeight(ctx, e.headline, p);
    const base = top + cap;
    const labTop = base + 34 * k;
    const bottom = labTop + labPx * 3.6;
    tempo.forEach(({ t, s }, i) => {
        const cx = x0 + cw * i;
        if (i > 0) {
            rule(ctx, cx, top - 10 * k, cx, bottom, HAIR, Math.max(1, 1.2 * k));
            // The hyphen of the notation, small, on the column line.
            ctx.fillStyle = e.accent;
            ctx.fillRect(cx - 9 * k, top + cap / 2 - 2 * k, 18 * k, 4 * k);
        }
        drawText(ctx, t, e.headline, p, cx + cw / 2, base, { align: 'center', tracking: -0.02, color: i === 0 ? e.accent : e.ink });
        const lx = cx + (i === 0 ? 0 : 22 * k);
        const lw = cw - 30 * k;
        drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, labPx, lx, labTop + labPx * 0.75, { tracking: 0.1, color: e.accent });
        if (names[i]) drawText(ctx, e.caps(names[i]), TYPE.mono, fitPx(ctx, e.caps(names[i]), TYPE.mono, labPx, lw, 0.12), lx, labTop + labPx * 2.2, { tracking: 0.12, color: SOFT });
        drawText(ctx, t === 'X' ? 'explosive' : `${secs(s)} s`, TYPE.brandR, labPx * 1.1, lx, labTop + labPx * 3.6, { color: GREY });
    });
    e.mark('tempo', { x: x0, y: top, w: x1 - x0, h: cap });
    e.mark('phases', { x: x0, y: labTop, w: x1 - x0, h: bottom - labTop });
    return bottom;
}

// The timeline bar, cut by the phases, with a seconds scale under. Returns the bottom.
function timeline(e, x0, x1, top, h, labPx) {
    const { ctx } = e;
    const k = unitOf(e);
    const tempo = tempoOf(e);
    const T = tempo.reduce((a, b) => a + b.s, 0);
    if (!T) return top;
    const scale = (x1 - x0) / T;
    let x = x0;
    const hatch = (sx, w) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, top, w, h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(244,241,234,0.45)';
        ctx.lineWidth = Math.max(1, 1.4 * k);
        for (let d = -h; d < w + h; d += 9 * k) {
            ctx.beginPath();
            ctx.moveTo(sx + d, top + h);
            ctx.lineTo(sx + d + h, top);
            ctx.stroke();
        }
        ctx.restore();
    };
    tempo.forEach(({ s }, i) => {
        const w = s * scale;
        if (w <= 0) return;
        const gap = Math.min(4 * k, w * 0.2);
        if (i === 0) {
            ctx.fillStyle = e.accent;
            ctx.fillRect(x, top, w - gap, h);
        } else if (i === 2) {
            ctx.fillStyle = e.ink;
            ctx.fillRect(x, top, w - gap, h);
        } else {
            hatch(x, w - gap);
            ctx.save();
            ctx.strokeStyle = 'rgba(244,241,234,0.45)';
            ctx.lineWidth = Math.max(1, 1.4 * k);
            ctx.strokeRect(x + 0.5 * k, top + 0.5 * k, w - gap - k, h - k);
            ctx.restore();
        }
        x += w;
    });
    // Seconds scale.
    const sy = top + h + 12 * k;
    const whole = Math.floor(T + 1e-6);
    const every = T > 12 ? 2 : 1;
    for (let t = 0; t <= whole; t += every) {
        const tx = x0 + t * scale;
        rule(ctx, tx, sy, tx, sy + 10 * k, 'rgba(244,241,234,0.5)', Math.max(1, 1.2 * k));
        drawText(ctx, `${t}`, TYPE.mono, labPx, tx, sy + 12 * k + labPx, { align: t === 0 ? 'left' : 'center', color: GREY });
    }
    // Time per rep, over the bar's right end.
    mono(e, `${secs(Math.round(T * 10) / 10)} s a rep`, x1, top - 14 * k, labPx, { align: 'right', color: e.accent, tracking: 0.14 });
    return sy + 12 * k + labPx;
}

// Lift name + the prescription ("4 × 8") on one line. Returns the baseline.
function liftRow(e, x0, x1, base, px) {
    const { ctx } = e;
    const k = unitOf(e);
    const rx = String(e.fields.prescription ?? '').trim();
    const rw = rx ? textWidth(ctx, rx, TYPE.brandL, px, 0) : 0;
    const lift = String(e.fields.lift ?? '').trim();
    e.mark('lift', drawText(ctx, lift, TYPE.brandSB, fitPx(ctx, lift, TYPE.brandSB, px, x1 - x0 - rw - 40 * k), x0, base, { color: e.ink, tracking: -0.01 }));
    if (rx) e.mark('prescription', drawText(ctx, rx, TYPE.brandL, px, x1, base, { align: 'right', color: e.ink }));
    return base;
}

function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    ctx.fillStyle = 'rgba(10,10,10,0.55)';
    ctx.fillRect(0, 0, W, H);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    topRow(e, x0, W * 0.5, y0, 42 * tu, { px: 14 * tu });
    const labPx = 13 * tu;
    figures(e, x0, W * 0.5, y0 + 80 * tu, (y1 - y0 - 80 * tu - labPx * 5) * 0.95, labPx);
    const bx0 = W * 0.56;
    liftRow(e, bx0, x1, y0 + 50 * tu, 34 * tu);
    const bTop = y0 + (y1 - y0) * 0.42;
    timeline(e, bx0, x1, bTop, 34 * tu, labPx);
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, 20 * tu, x1 - bx0), bx0, y1, { color: SOFT }));
}

export default {
    id: 'tempo',
    name: 'Tempo',
    category: 'Move',
    blurb: 'Lifting tempo as a spec sheet: “3-1-X-1” huge, each phase named, and a timeline bar cut in those proportions. For coaches and strength programmes.',
    refs: 'a technical spec sheet',
    headlineFont: 'grotesk',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Tempo · Week 3' },
        { key: 'tempo', label: 'Tempo', value: '3-1-X-1', hint: 'Four figures: down, pause, up, pause. X = explosive.' },
        { key: 'phases', label: 'Phase names', value: 'Eccentric · Pause · Concentric · Pause', hint: 'Four, split with ·' },
        { key: 'lift', label: 'Lift', value: 'Romanian deadlift' },
        { key: 'prescription', label: 'Sets × reps', value: '4 × 8' },
        { key: 'line', label: 'Line', value: 'Three seconds down. Own every one.' },
        { key: 'footer', label: 'Footer', value: 'Every session counts · powr.life' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Programme (POWR)', fields: { eyebrow: 'Tempo · Week 3', tempo: '3-1-X-1', lift: 'Romanian deadlift', prescription: '4 × 8', line: 'Three seconds down. Own every one.', footer: 'Every session counts · powr.life' } },
        { name: 'Coach', fields: { eyebrow: 'Coach’s notes · Block 2', tempo: '4-2-1-0', lift: 'Back squat', prescription: '5 × 5', line: 'Slow down, sit, stand. No bounce.', footer: 'Coached by Sam · Northside' } },
        { name: 'Gym floor', fields: { eyebrow: 'Northside · Technique week', tempo: '2-0-X-2', lift: 'Bench press', prescription: '3 × 10', line: 'Tempo cards at every bench this week.', footer: 'Northside Gym · Strength floor' } },
        { name: 'Pause reps', fields: { eyebrow: 'Pause reps', tempo: '3-3-1-1', lift: 'Front squat', prescription: '3 × 6', line: 'Hold the bottom. Count it out loud.', footer: 'Every session counts · powr.life' } },
    ],
    look: {
        mono: 1, target: 0.2, auto: 0.85, contrast: 0.45, crush: 0.14, fade: 0,
        tint: 'cool', tintAmount: 0.4, motion: 0, angle: 0, focus: 0.55, vignette: 0.55, grain: 0.5, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), footer: `${r.brand} · Rewards in the POWR app` }),
    },

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const wide = shape === 'wide';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        // Layout first (bottom up: footer, line, timeline, figures, lift),
        // so the photo can be darkened under exactly what sits on it.
        const footBase = H - safe.b - 4 * u;
        const fPx = (sq ? 15 : 17) * u;
        const lPx = (sq ? 24 : 28) * u;
        const labPx = (sq ? 14 : tall ? 18 : 16) * u;
        const barH = (tall ? 44 : sq ? 30 : 36) * u;
        const scaleH = 24 * u + labPx;
        const barTop = footBase - (sq ? 60 : 90) * u - scaleH - barH;
        const figPx = (tall ? 300 : sq ? 190 : wide ? 250 : 260) * u * size;
        const figH = capHeight(ctx, e.headline, figPx);
        const figTop = barTop - (sq ? 50 : 80) * u - labPx * 3.6 - 34 * u - figH;
        const liftPx = (tall ? 50 : sq ? 36 : 44) * u;
        const liftBase = figTop - (sq ? 44 : 64) * u;

        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.26, 'top', 0.55);
        const darkTop = liftBase - liftPx - 120 * u;
        e.fade(0, darkTop - H * 0.25, W, H * 0.25, 'bottom', 0.55);
        ctx.fillStyle = 'rgba(9,9,9,0.62)';
        ctx.fillRect(0, darkTop, W, H - darkTop);
        e.fade(0, darkTop, W, H - darkTop, 'bottom', 0.6);
        topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);

        e.mark('footer', mono(e, e.fields.footer, x1, footBase, fPx, { tracking: 0.16, align: 'right' }));
        const fw = textWidth(ctx, e.caps(e.fields.footer ?? ''), TYPE.mono, fPx, 0.16);
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, x1 - x0 - fw - 40 * u), x0, footBase, { color: SOFT }));
        timeline(e, x0, x1, barTop, barH, labPx);
        figures(e, x0, x1, figTop, figPx, labPx);
        liftRow(e, x0, x1, liftBase, liftPx);
        rule(ctx, x0, liftBase + liftPx * 0.45, x1, liftBase + liftPx * 0.45, HAIR, Math.max(1, 1.2 * u));
    },
};
