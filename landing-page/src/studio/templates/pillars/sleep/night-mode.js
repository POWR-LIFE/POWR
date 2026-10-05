/**
 * NIGHT MODE — a still from a film at night: the photo letterboxed between
 * black bars, a thin mono time-code in the top bar, one serif line set low
 * like a subtitle, and a tiny lockup in the bottom bar. Almost nothing on it
 * — the restraint is the point. For any sleep brand's mood post.
 */
import { TYPE } from '../../../fonts';
import { drawText, textWidth, wrapLines, capHeight } from '../../../text';
import { dot } from '../../../shapes';
import { BRAND_FIELDS, lockup, rewardWords } from '../kit';
import { NIGHT_LOOK, MUTED, INK, line } from './_parts';

const BAR = '#060708';

// "● 23:04  SUN 12 OCT" on one baseline from x.
function stamp(e, x, base, px, k, { align = 'left', maxW = Infinity } = {}) {
    const { ctx } = e;
    const time = String(e.fields.time ?? '').trim();
    const date = e.caps(e.fields.date).trim();
    const dotR = px * 0.2;
    const gap = px * 0.9;
    const tw = time ? textWidth(ctx, time, TYPE.monoR, px, 0.12) : 0;
    const dw = date ? textWidth(ctx, date, TYPE.monoR, px * 0.62, 0.2) : 0;
    const total = dotR * 2 + px * 0.6 + tw + (date ? gap + dw : 0);
    const s = total > maxW ? maxW / total : 1;
    const p = px * s;
    let cx = align === 'right' ? x - total * s : x;
    dot(ctx, cx + dotR * s, base - p * 0.36, dotR * s, e.accent);
    cx += (dotR * 2 + px * 0.6) * s;
    if (time) e.mark('time', line(e, null, time, TYPE.monoR, p, cx, base, { tracking: 0.12, color: INK }));
    if (date) e.mark('date', line(e, null, date, TYPE.monoR, p * 0.62, cx + (tw + gap) * s, base, { tracking: 0.2, color: MUTED }));
}

// The subtitle: up to two centred lines ending on `base`.
function subtitle(e, cx, base, px, maxW) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const p = px * size;
    const lines = wrapLines(ctx, e.fields.line, e.headline, p, maxW, 2);
    if (!lines.length) return;
    const lead = 1.22;
    const first = base - (lines.length - 1) * p * lead;
    const w = Math.max(...lines.map((l) => textWidth(ctx, l, e.headline, p, 0)));
    const cap = capHeight(ctx, e.headline, p);
    e.shade({ x: cx - w / 2, y: first - cap, w, h: base - first + cap * 1.3 }, { ceiling: 0.22, max: 0.6, spread: 1.2 });
    e.mark('line', drawText(ctx, lines.join('\n'), e.headline, p, cx, first, { align: 'center', leading: lead, color: e.headlineAccent ? e.accent : INK, accent: e.accent }));
}

export default {
    id: 'night-mode',
    name: 'Night Mode',
    category: 'Sleep',
    blurb: 'A letterboxed night still: a thin time-code, one serif line set like a subtitle, a tiny lockup.',
    refs: 'a film still with its subtitle',
    headlineFont: 'serif',
    fields: [
        { key: 'time', label: 'Time-code', value: '23:04' },
        { key: 'date', label: 'Date (after the time)', value: 'Sun 12 Oct', hint: 'Leave empty for the time alone.' },
        { key: 'line', label: 'Subtitle', rows: 2, value: 'Nothing left to prove tonight.', hint: 'One short line, two at most.' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Late', fields: { time: '23:04', date: 'Sun 12 Oct', line: 'Nothing left to prove tonight.' } },
        { name: 'Bedding', fields: { time: '22:47', date: 'Clean sheets night', line: 'The best part of Sunday.' }, style: { accent: '#C9B79C' } },
        { name: 'Lights out', fields: { time: '22:30', date: '', line: 'Phone down. Lights out.' } },
        { name: 'After the session', fields: { time: '21:58', date: 'Leg day', line: 'Earned, not given. Now rest.' } },
    ],
    look: { ...NIGHT_LOOK, mono: 0.9, target: 0.2, tintAmount: 0.75, vignette: 0.85, grain: 0.7, frame: 'letterbox' },
    controls: [
        { key: 'frame', label: 'Frame', options: [['letterbox', 'Letterbox'], ['full', 'Full bleed']] },
    ],
    fill: { reward: (r) => ({ ...rewardWords(r) }) },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const k = e.tu;
        const x0 = safe.l + 6 * k;
        const x1 = W - safe.r - 6 * k;
        const strip = shape === 'strip';
        const tall = shape === 'tall';
        const wide = shape === 'wide';
        const box = !strip && e.look.frame !== 'full';

        ctx.fillStyle = BAR;
        ctx.fillRect(0, 0, W, H);
        const px = (wide ? 26 : strip ? 18 : 28) * k;
        const subPx = (wide ? 44 : strip ? 30 : tall ? 50 : 44) * k;
        const lh = (wide ? 22 : strip ? 20 : 26) * k;

        if (box) {
            // Bars at least as deep as the safe margins (a story's UI sits in them).
            const barT = tall ? safe.t + 70 * k : Math.max(safe.t + px * 2.4, H * (wide ? 0.12 : 0.13));
            const barB = tall ? safe.b + 90 * k : barT;
            e.photo({ x: 0, y: barT, w: W, h: H - barT - barB });
            const tBase = (tall ? safe.t + (barT - safe.t) / 2 : barT / 2) + px * 0.36;
            stamp(e, x0, tBase, px, k, { maxW: (x1 - x0) * 0.7 });
            const bMid = tall ? H - barB + (barB - safe.b) / 2 : H - barB / 2;
            lockup(e, x1, bMid - lh / 2, lh, { align: 'right', maxW: (x1 - x0) * 0.5 });
            subtitle(e, W / 2, H - barB - (wide ? 50 : 64) * k, subPx, (x1 - x0) * 0.86);
            return;
        }

        e.photo({ x: 0, y: 0, w: W, h: H });
        ctx.fillStyle = 'rgba(6,7,8,0.18)';
        ctx.fillRect(0, 0, W, H);
        e.fade(0, 0, W, H * 0.3, 'top', 0.55);
        e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.6);
        stamp(e, x0, safe.t + px, px, k, { maxW: (x1 - x0) * 0.6 });
        lockup(e, x1, safe.t + px * 0.36 - lh / 2, lh, { align: 'right', maxW: (x1 - x0) * 0.35 });
        subtitle(e, W / 2, H - safe.b - (strip ? 8 : 40) * k, subPx, (x1 - x0) * (strip ? 0.7 : 0.86));
    },
};

