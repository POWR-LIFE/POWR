/**
 * WARM-UP — a numbered movement list, set like a class sheet: 01 Hip openers
 * ········ 2 min, durations right-aligned on leader dots, the total at the
 * head, all on a darkened panel over the photo with a hairline frame. For
 * trainers, classes and programmes.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth, splitLines, fitBlock, drawBlock, blockBox } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, HAIR, topRow, mono, unitOf, fitPx, leader, rowsOf } from './_parts';

// Rows: "Hip openers · 2 min" → { name, time }.
const itemsOf = (e) => rowsOf(e.fields.items).slice(0, 9).map((c) => ({
    name: c.length > 1 ? c.slice(0, -1).join(' ') : c[0],
    time: c.length > 1 ? c[c.length - 1] : '',
}));

// Adds up "2 min", "30 s", "1:30" → "10 min" (or null if any can't be read).
function total(items) {
    let s = 0;
    for (const { time } of items) {
        const t = time.toLowerCase();
        let m;
        if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:min|mins|m)$/))) s += parseFloat(m[1]) * 60;
        else if ((m = t.match(/^(\d+)\s*(?:s|sec|secs)$/))) s += parseInt(m[1], 10);
        else if ((m = t.match(/^(\d+):(\d{2})$/))) s += parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        else return null;
    }
    if (!s) return null;
    return s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s / 60} min`;
}

// The list in x0..x1 from `top`, rows `rowH` apart. Returns the bottom.
function list(e, items, x0, x1, top, rowH, px) {
    const { ctx } = e;
    const k = unitOf(e);
    const nPx = px * 0.62;
    const numW = textWidth(ctx, '00', TYPE.mono, nPx, 0.08) + 26 * k;
    const cap = capHeight(ctx, TYPE.brandR, px);
    items.forEach((it, i) => {
        const base = top + i * rowH + rowH / 2 + cap / 2;
        drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, nPx, x0, base, { tracking: 0.08, color: e.accent });
        const tw = it.time ? textWidth(ctx, it.time, TYPE.brandSB, px, 0) : 0;
        if (it.time) drawText(ctx, it.time, TYPE.brandSB, px, x1, base, { align: 'right', color: e.ink });
        const room = x1 - tw - 30 * k - (x0 + numW);
        const np = fitPx(ctx, it.name, TYPE.brandR, px, room);
        drawText(ctx, it.name, TYPE.brandR, np, x0 + numW, base, { color: e.ink });
        const nw = textWidth(ctx, it.name, TYPE.brandR, np, 0);
        if (it.time) leader(ctx, x0 + numW + nw + 16 * k, x1 - tw - 16 * k, base - 2 * k, Math.max(1, 1.8 * k), 12 * k, 'rgba(244,241,234,0.42)');
        if (i < items.length - 1) rule(ctx, x0, top + (i + 1) * rowH, x1, top + (i + 1) * rowH, 'rgba(244,241,234,0.07)', Math.max(1, k));
    });
    e.mark('items', { x: x0, y: top, w: x1 - x0, h: items.length * rowH });
    return top + items.length * rowH;
}

// The sheet head: title (headline face) left, the total right. Returns its bottom.
function head(e, x0, x1, top, maxH) {
    const { ctx } = e;
    const k = unitOf(e);
    const t = total(itemsOf(e));
    const tot = String(e.fields.total ?? '').trim() || t || '';
    const tPx = maxH * 0.34;
    const tw = tot ? textWidth(ctx, tot, TYPE.brandL, tPx, 0) : 0;
    const lines = splitLines(e.fields.title).slice(0, 2);
    const block = fitBlock(ctx, lines, e.headline, { maxW: x1 - x0 - tw - 50 * k, maxH, gap: 0.12 });
    const bb = blockBox(drawBlock(ctx, block, e.headline, x0, top, { align: 'left', color: e.headlineAccent ? e.accent : e.ink, accent: e.accent }));
    if (bb) e.mark('title', bb);
    const bottom = bb ? bb.y + bb.h : top + maxH;
    if (tot) {
        mono(e, 'Total', x1, bottom - tPx - 16 * k, Math.max(12 * k, tPx * 0.36), { align: 'right', color: GREY });
        e.mark('total', drawText(ctx, tot, TYPE.brandL, tPx, x1, bottom, { align: 'right', color: e.ink }));
    }
    return bottom;
}

// A dark panel with a hairline frame.
function panel(e, x, y, w, h) {
    const { ctx } = e;
    const k = unitOf(e);
    ctx.fillStyle = 'rgba(10,10,10,0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.strokeStyle = HAIR;
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W, H * 0.4, 'top', 0.45);
    const x0 = safe.l;
    const y0 = safe.t;
    const y1 = H - safe.b;
    const items = itemsOf(e).slice(0, strip ? 4 : 7);
    const px0 = W * (strip ? 0.5 : 0.46);
    const pad = (strip ? 26 : 48) * k;
    panel(e, px0, strip ? 0 : y0 - 20 * k, W - safe.r - px0 + (strip ? safe.r : 0), strip ? H : y1 - y0 + 40 * k);
    e.fade(0, 0, px0, H, 'left', 0.55);
    topRow(e, x0, px0 - 50 * k, y0, (strip ? 42 : 56) * k, { px: (strip ? 14 : 16) * k });
    const hTop = strip ? y0 + 70 * k : y0 + (y1 - y0) * 0.36;
    const hH = (strip ? 90 : 150) * k;
    e.shade({ x: x0, y: hTop, w: px0 - x0 - 60 * k, h: hH }, { ceiling: 0.2, max: strip ? 0.8 : 0.62, spread: 1.25 });
    const hb = head(e, x0, px0 - 60 * k, hTop, hH);
    const lPx = (strip ? 20 : 28) * k;
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, px0 - x0 - 60 * k), x0, strip ? y1 : hb + 50 * k + lPx * 0.72, { color: SOFT }));
    if (!strip) e.mark('footer', mono(e, e.fields.footer, x0, y1, 16 * k, { tracking: 0.16 }));
    const lx0 = px0 + pad;
    const lx1 = W - safe.r - pad;
    // The list, centred in the panel.
    const room = strip ? y1 - y0 : y1 - y0 - pad * 1.2;
    const rowH = Math.min((strip ? 90 : 96) * k, room / Math.max(1, items.length));
    const top = (strip ? y0 : y0 + pad * 0.6) + (room - rowH * items.length) / 2;
    list(e, items, lx0, lx1, top, rowH, Math.min((strip ? 28 : 34) * k, rowH * 0.46));
}

export default {
    id: 'warm-up',
    name: 'Warm-up',
    category: 'Move',
    blurb: 'A numbered movement list with durations on leader dots, the total at the head, on a framed dark panel. For trainers, classes and programmes.',
    refs: 'a class sheet on the studio wall',
    headlineFont: 'serifI',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Before every class' },
        { key: 'title', label: 'Title', rows: 2, value: 'Warm-up' },
        { key: 'total', label: 'Total (leave empty to add it up)', value: '' },
        { key: 'items', label: 'Movements', rows: 7, value: 'Hip openers · 2 min\nWorld’s greatest stretch · 2 min\nBand pull-aparts · 1 min\nGoblet squat hold · 2 min\nA-skips · 1 min\nBuild-up strides · 2 min', hint: 'One per line: movement · time (2 min, 30 s, 1:30). Up to nine.' },
        { key: 'line', label: 'Line', value: 'Ten minutes. Then we start.' },
        { key: 'footer', label: 'Footer', value: 'Every session counts · powr.life' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Class warm-up (POWR)', fields: { eyebrow: 'Before every class', title: 'Warm-up', items: 'Hip openers · 2 min\nWorld’s greatest stretch · 2 min\nBand pull-aparts · 1 min\nGoblet squat hold · 2 min\nA-skips · 1 min\nBuild-up strides · 2 min', line: 'Ten minutes. Then we start.', footer: 'Every session counts · powr.life' } },
        { name: 'Gym programme', fields: { eyebrow: 'Northside · Leg day', title: 'Leg day\nprimer', items: 'Bike, easy · 5 min\nCossack squats · 1 min\nGlute bridges · 1 min\nEmpty-bar squats · 2 min\nBox jumps · 1 min', line: 'On the whiteboard by the racks.', footer: 'Northside Gym · Strength floor' } },
        { name: 'Run club', fields: { eyebrow: 'Thursday · Before the reps', title: 'Track\ndrills', items: 'Easy jog · 8 min\nLeg swings · 1 min\nHigh knees · 30 s\nButt kicks · 30 s\nStrides × 4 · 2 min', line: 'Meet at the start line, 18:50.', footer: 'Northside Run Club' } },
        { name: 'Cool-down', fields: { eyebrow: 'After the session', title: 'Cool-down', items: 'Walk it out · 3 min\nChild’s pose · 1 min\nPigeon, each side · 2 min\nCalf stretch · 1 min\nBox breathing · 2 min', line: 'Ten minutes on the way out.', footer: 'Every session counts · powr.life' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.42, crush: 0.12, fade: 0,
        tint: 'cool', tintAmount: 0.3, motion: 0, angle: 0, focus: 0.55, vignette: 0.5, grain: 0.5, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), footer: `${r.brand} · Rewards in the POWR app` }),
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
        e.fade(0, 0, W, H * 0.3, 'top', 0.55);
        e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.6);
        const headBottom = topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);

        const items = itemsOf(e);
        const n = Math.max(1, items.length);
        const footBase = H - safe.b - 4 * u;
        const pad = (sq ? 36 : 48) * u;
        const want = (tall ? 90 : sq ? 58 : 76) * u;
        const headH = (tall ? 150 : sq ? 96 : 130) * u * size;
        // The panel grows up from the footer: list, then the head.
        const panelBottom = footBase - (sq ? 44 : 60) * u;
        const maxPanel = panelBottom - headBottom - (tall ? 200 : sq ? 40 : 110) * u;
        const rowH = Math.max(34 * u, Math.min(want, (maxPanel - pad * 2 - headH - Math.max(pad * 0.9, headH * 0.34)) / n));
        const panelH = pad * 2 + headH + Math.max(pad * 0.9, headH * 0.34) + n * rowH;
        const panelTop = panelBottom - panelH;
        panel(e, x0 - pad * 0.5, panelTop, x1 - x0 + pad, panelH);
        const ix0 = x0 + pad * 0.5;
        const ix1 = x1 - pad * 0.5;
        const hb = head(e, ix0, ix1, panelTop + pad, headH);
        // Clear of the title's descenders ("p").
        const listTop = hb + Math.max(pad * 0.9, headH * 0.34);
        rule(ctx, ix0, listTop - 2 * u, ix1, listTop - 2 * u, 'rgba(244,241,234,0.3)', Math.max(1, 1.4 * u));
        list(e, items, ix0, ix1, listTop, rowH, Math.min((tall ? 36 : sq ? 27 : 32) * u, rowH * 0.46));

        // Under the panel: the line; the footer at the foot.
        const lPx = (sq ? 24 : 28) * u;
        e.mark('footer', mono(e, e.fields.footer, x1, footBase, (sq ? 15 : 17) * u, { tracking: 0.16, align: 'right' }));
        const line = String(e.fields.line ?? '').trim();
        const fw = textWidth(ctx, e.caps(e.fields.footer ?? ''), TYPE.mono, (sq ? 15 : 17) * u, 0.16);
        if (line) e.mark('line', drawText(ctx, line, TYPE.brandR, fitPx(ctx, line, TYPE.brandR, lPx, x1 - x0 - fw - 40 * u), x0, footBase, { color: SOFT }));
    },
};
