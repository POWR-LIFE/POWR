/**
 * BOX BREATH — a square traced in a thin line, the four counts of box
 * breathing set along its sides (turned to run with the path), one side and a
 * dot in the accent for where you are in the breath, and the headline held
 * quietly inside the square. For breathwork studios, apps and classes.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, capHeight, splitLines } from '../../../text';
import { dot } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, SOFT, DIM, unitOf, veil, prep, footRow, headColor, fitPx, rewardLine } from './_parts';

const PHASES = { in: 0, hold: 1, out: 2, rest: 3 };

// "In 4 · Hold 4 · Out 4 · Hold 4" → four labels, in path order.
const steps = (s) => String(s ?? '').split(/\s*[·•|\n]\s*/).map((t) => t.trim()).filter(Boolean).slice(0, 4);

// The square from its bottom-left corner, clockwise: up (in), across (hold),
// down (out), back (hold). Labels sit outside each side; the verticals turn.
function square(e, L, T, S, k) {
    const { ctx } = e;
    const R = L + S;
    const B = T + S;
    const phase = PHASES[e.look.phase] ?? 0;
    const corners = [[L, B], [L, T], [R, T], [R, B]];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(244,241,234,0.55)';
    ctx.lineWidth = 1.6 * k;
    ctx.strokeRect(L, T, S, S);
    const [a, b] = [corners[phase], corners[(phase + 1) % 4]];
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
    dot(ctx, b[0], b[1], 7.5 * k, e.accent);

    const labs = steps(e.fields.steps);
    const px = 19 * k;
    const cap = capHeight(ctx, TYPE.brandR, px);
    const off = 20 * k;
    let box = null;
    const add = (r) => { box = box ? { x: Math.min(box.x, r.x), y: Math.min(box.y, r.y), w: Math.max(box.x + box.w, r.x + r.w) - Math.min(box.x, r.x), h: Math.max(box.y + box.h, r.y + r.h) - Math.min(box.y, r.y) } : r; };
    labs.forEach((raw, i) => {
        const t = e.caps(raw);
        const p = fitPx(ctx, t, TYPE.brandR, px, S * 0.8, 0.24);
        const w = textWidth(ctx, t, TYPE.brandR, p, 0.24);
        const color = i === phase ? e.accent : DIM;
        const o = { align: 'center', tracking: 0.24, color };
        ctx.save();
        if (i === 0) {
            ctx.translate(L - off, T + S / 2);
            ctx.rotate(-Math.PI / 2);
            drawText(ctx, t, TYPE.brandR, p, 0, 0, o);
            add({ x: L - off - cap, y: T + S / 2 - w / 2, w: cap, h: w });
        } else if (i === 2) {
            ctx.translate(R + off, T + S / 2);
            ctx.rotate(Math.PI / 2);
            drawText(ctx, t, TYPE.brandR, p, 0, 0, o);
            add({ x: R + off, y: T + S / 2 - w / 2, w: cap, h: w });
        } else if (i === 1) {
            drawText(ctx, t, TYPE.brandR, p, L + S / 2, T - off, o);
            add({ x: L + S / 2 - w / 2, y: T - off - cap, w, h: cap });
        } else {
            drawText(ctx, t, TYPE.brandR, p, L + S / 2, B + off + cap, o);
            add({ x: L + S / 2 - w / 2, y: B + off, w, h: cap });
        }
        ctx.restore();
    });
    e.mark('steps', box);
    return off + cap; // room each label takes outside the square
}

// The headline centred in the square.
function inside(e, L, T, S, k) {
    const size = e.look.size ?? 1;
    const hb = prep(e, e.fields.headline, e.headline, { maxW: S * 0.72 * size, maxH: S * 0.34 * size, max: 92 * k * size, gap: 0.24 });
    if (hb.empty) return;
    const top = T + S / 2 - (hb.h + hb.desc * 0.5) / 2;
    e.shade({ x: L + S * 0.14, y: top, w: S * 0.72, h: hb.h }, { ceiling: 0.26, max: 0.55 });
    hb.draw('headline', L + S / 2, top, { align: 'center', color: headColor(e) });
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const k = unitOf(e);
    const strip = shape === 'strip';
    const size = e.look.size ?? 1;
    e.photo({ x: 0, y: 0, w: W, h: H });
    veil(e, 0.25);
    e.fade(0, 0, W * 0.75, H, 'left', 0.7);
    const room = 20 * k + capHeight(ctx, TYPE.brandR, 19 * k) + 8 * k;
    const S = H - safe.t - safe.b - room * 2;
    const L = safe.l + room;
    const T = safe.t + room;
    square(e, L, T, S, k);
    const x0 = L + S + room + (strip ? 70 : 90) * k;
    const x1 = W - safe.r;
    const bottom = H - safe.b;
    const footTop = footRow(e, { x0, x1, bottom, k, lockH: strip ? 22 : 26 });
    if (strip) {
        // Too small inside: the headline sits beside the square.
        const hb = prep(e, e.fields.headline, e.headline, { maxW: (x1 - x0) * 0.8 * size, maxH: (footTop - safe.t) * 0.5 * size, max: 80 * k, lines: 2 });
        const lp = 26 * k;
        const lines = splitLines(e.fields.line).slice(0, 1);
        const total = hb.h + (lines.length ? hb.desc + 22 * k + lp : 0);
        const top = safe.t + (footTop - 20 * k - safe.t - total) / 2;
        hb.draw('headline', x0, top, { color: headColor(e) });
        if (lines.length) e.mark('line', drawText(ctx, lines[0], TYPE.serifI, fitPx(ctx, lines[0], TYPE.serifI, lp, x1 - x0), x0, top + hb.h + hb.desc + 22 * k + lp * 0.72, { color: SOFT, accent: e.accent }));
        return;
    }
    inside(e, L, T, S, k);
    const lb = prep(e, e.fields.line, TYPE.serifI, { maxW: x1 - x0, maxH: H * 0.3, max: 54 * k * size, lines: 3, gap: 0.5 });
    lb.draw('line', x0, safe.t + (footTop - 30 * k - safe.t - lb.h) / 2, { color: SOFT });
}

export default {
    id: 'box-breath',
    name: 'Box Breath',
    category: 'Mind',
    blurb: 'A square traced in a thin line with the four counts along its sides and the headline inside. For breathwork.',
    refs: 'a box-breathing guide card',
    headlineFont: 'brandL',
    fields: [
        { key: 'headline', label: 'Headline (inside the square)', rows: 2, value: 'Four minutes.\nJust breathe.', hint: 'Short. Two lines at most. {Braces} colour a word.' },
        { key: 'steps', label: 'The four sides', value: 'In 4 · Hold 4 · Out 4 · Hold 4', hint: 'Up the left, across the top, down the right, along the bottom. Separate with ·' },
        { key: 'line', label: 'Line under it', rows: 2, value: 'A breath for the space between things.' },
        { key: 'footer', label: 'Small print', value: 'Breathwork · Tuesdays 7am' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Breathwork class', fields: { headline: 'Four minutes.\nJust breathe.', steps: 'In 4 · Hold 4 · Out 4 · Hold 4', line: 'A breath for the space between things.', footer: 'Breathwork · Tuesdays 7am' } },
        { name: 'Before you start', fields: { headline: 'Before\nthe first set.', steps: 'In 4 · Hold 4 · Out 4 · Hold 4', line: 'Four rounds. Then begin.', footer: 'Every session counts' } },
        { name: 'Desk reset', fields: { headline: 'Between\nmeetings.', steps: 'In 4 · Hold 4 · Out 4 · Hold 4', line: 'Sixteen seconds a round. Try four.', footer: 'Northside · Daily ritual' } },
        { name: 'Slow count', fields: { headline: 'Slow it\n{down}.', steps: 'In 5 · Hold 5 · Out 5 · Hold 5', line: 'Twenty seconds a round.', footer: 'Evening practice' } },
    ],
    look: { ...MIND_LOOK, mono: 0.85, target: 0.2, phase: 'in', text: 'inside' },
    controls: [
        { key: 'text', label: 'Headline', options: [['inside', 'Inside the square'], ['under', 'Under it']] },
        { key: 'phase', label: 'Where you are', options: [['in', 'Breathe in'], ['hold', 'Hold'], ['out', 'Breathe out'], ['rest', 'Hold (empty)']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.22);
        e.fade(0, 0, W, H * 0.25, 'top', 0.45);
        e.fade(0, H * 0.45, W, H * 0.55, 'bottom', 0.8);

        const x0 = safe.l;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k });

        const room = 20 * k + capHeight(ctx, TYPE.brandR, 19 * k) + 10 * k;
        const under = e.look.text === 'under';
        const hb = under
            ? prep(e, e.fields.headline, e.headline, { maxW: (x1 - x0) * 0.8 * size, maxH: H * (sq ? 0.11 : 0.12) * size, max: (sq ? 64 : 76) * k * size, lines: 2, gap: 0.22 })
            : { h: 0, desc: 0, empty: true };
        const lb = prep(e, e.fields.line, TYPE.serifI, { maxW: (x1 - x0) * 0.86, maxH: H * 0.12, max: (sq ? 36 : 42) * k * size, lines: 2, gap: 0.45 });
        const headGap = hb.empty ? 0 : (sq ? 40 : 60) * k;
        const lineGap = lb.empty ? 0 : (hb.empty ? (sq ? 44 : 64) * k : (sq ? 26 : 36) * k);
        const below = headGap + hb.h + hb.desc + lineGap + lb.h;
        const avail = footTop - (sq ? 30 : 50) * k - safe.t - (tall ? 40 * k : 0);
        let S = Math.min(x1 - x0 - room * 2 - 40 * k, W * (sq ? (under ? 0.4 : 0.5) : 0.6), avail - room * 2 - below);
        S = Math.max(S, 120 * k);
        const group = room * 2 + S + below;
        const gTop = safe.t + (tall ? 40 * k : 0) + Math.max(0, (avail - group) / 2);
        const T = gTop + room;
        const L = W / 2 - S / 2;
        square(e, L, T, S, k);
        let y = T + S + room;
        if (under) {
            y += headGap;
            e.shade({ x: W * 0.12, y, w: W * 0.76, h: hb.h }, { ceiling: 0.28, max: 0.55 });
            hb.draw('headline', W / 2, y, { align: 'center', color: headColor(e) });
            y += hb.h + hb.desc;
        } else {
            inside(e, L, T, S, k);
        }
        if (!lb.empty) {
            y += lineGap;
            e.shade({ x: W * 0.15, y, w: W * 0.7, h: lb.h }, { ceiling: 0.3, max: 0.5 });
            lb.draw('line', W / 2, y, { align: 'center', color: SOFT });
        }
    },
};
