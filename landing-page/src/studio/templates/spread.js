/**
 * SPREAD — a magazine page on dark paper: the photo twice, once whole and
 * once as a tight detail laid over its corner, a folio line along the top,
 * a heavy caps headline with a quiet serif line under it, and an oval stamp.
 * One photo does the work of a diptych. Trend drop 01 (Sep 2026): editorial
 * spreads and detail diptychs — always dark here, never the paper white.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines, unionBox, textWidth } from '../text';

const PAPER = '#0E0E0C';
const SOFT = 'rgba(244,241,234,0.62)';

function stamp(e, text, cx, cy, rx) {
    const { ctx } = e;
    const t = String(text ?? '').trim().toUpperCase();
    if (!t) return;
    const ry = rx * 0.52;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-8 * Math.PI) / 180);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,14,12,0.5)';
    ctx.fill();
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = Math.max(1, rx * 0.035);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.9, ry * 0.82, 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, rx * 0.012);
    ctx.stroke();
    let px = ry * 0.5;
    const w = textWidth(ctx, t, TYPE.grotesk, px, 0.1);
    if (w > rx * 1.4) px *= (rx * 1.4) / w;
    const box = drawText(ctx, t, TYPE.grotesk, px, 0, px * 0.36, { align: 'center', tracking: 0.1, color: e.accent });
    ctx.restore();
    // Outline box for the editor, unrotated — near enough to click.
    if (box) e.mark('stamp', { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 });
}

export default {
    id: 'spread',
    name: 'Spread',
    category: 'Brand',
    blurb: 'A magazine page: the photo whole and as a close-up, heavy caps, a quiet serif line, a stamp.',
    refs: 'editorial spreads and detail diptychs (trend drop 01)',
    headlineFont: 'heavy',
    fields: [
        { key: 'folio', label: 'Folio (top left)', value: 'POWR — Issue 39' },
        { key: 'folioRight', label: 'Folio (top right)', value: 'Autumn ’26' },
        { key: 'headline', label: 'Headline', rows: 2, value: 'Earned,\nnot given.', hint: 'Two short lines. {Braces} colour a word.' },
        { key: 'line', label: 'Serif line', rows: 3, value: 'Every session, run, walk and ride counts — and the points are yours to spend.' },
        { key: 'stamp', label: 'Stamp', value: 'Week 39', hint: 'A word or two in the oval. Leave empty to hide it.' },
        { key: 'note', label: 'Small print', value: 'powr.life' },
    ],
    presets: [
        { name: 'Earned', fields: { headline: 'Earned,\nnot given.', line: 'Every session, run, walk and ride counts — and the points are yours to spend.', stamp: 'Week 39' } },
        { name: 'Gym floor', fields: { headline: 'The gym\nfloor.', line: 'Where the streak is kept. One visit at a time.', stamp: 'New' } },
        { name: 'Event', fields: { folio: 'POWR — Live event', folioRight: 'Fri 02 Oct', headline: 'Friday\n{Finals}.', line: 'One night on the gym floor. Every minute counts toward the board.', stamp: 'Live' } },
        { name: 'Member', fields: { folio: 'POWR — Members', headline: 'Show up.\nEvery week.', line: 'Twelve weeks without a miss. That’s the whole secret.', stamp: 'Streak' } },
    ],
    look: {
        mono: 1, target: 0.3, auto: 0.85, contrast: 0.45, crush: 0.08, fade: 0.06,
        tint: 'none', motion: 0, angle: 0, focus: 0.6, vignette: 0.25, grain: 0.6, size: 1,
        detail: 3,
    },
    controls: [
        { key: 'detail', label: 'Close-up', options: [[2, 'Near'], [3, 'Close'], [4.2, 'Very close']] },
    ],

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const wide = shape === 'wide' || shape === 'strip';
        const strip = shape === 'strip';
        const unit = wide ? e.tu : e.u;
        const size = e.look.size ?? 1;
        const detailZoom = Number(e.look.detail) || 3;
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, W, H);

        const iw = W - safe.l - safe.r;
        const folioPx = (strip ? 13 : 16) * unit;
        const folioBase = safe.t + folioPx;
        const folio = String(e.fields.folio ?? '').trim().toUpperCase();
        const folioR = String(e.fields.folioRight ?? '').trim().toUpperCase();
        if (folio) e.mark('folio', drawText(ctx, folio, TYPE.monoR, folioPx, safe.l, folioBase, { tracking: 0.12, color: SOFT }));
        if (folioR) e.mark('folioRight', drawText(ctx, folioR, TYPE.monoR, folioPx, W - safe.r, folioBase, { align: 'right', tracking: 0.12, color: SOFT }));
        const top = folioBase + (strip ? 14 : 26) * unit;
        ctx.fillStyle = 'rgba(244,241,234,0.22)';
        ctx.fillRect(safe.l, top - (strip ? 7 : 12) * unit, iw, Math.max(1, unit));

        const border = (strip ? 5 : 9) * unit;
        const logoW = (strip ? 48 : 64) * unit;
        const bottom = H - safe.b;
        const notePx = (strip ? 13 : 16) * unit;
        const note = String(e.fields.note ?? '').trim().toUpperCase();

        let main;
        let detail;
        let text; // { x, y (headline top), w, maxH, align }
        if (wide) {
            const mw = Math.round(iw * (strip ? 0.36 : 0.5));
            main = { x: safe.l, y: top, w: mw, h: bottom - top };
            const dw = Math.round(iw * (strip ? 0.16 : 0.2));
            detail = { x: safe.l + mw - dw * 0.35, y: bottom - dw * (strip ? 0.9 : 1.25), w: dw, h: dw * (strip ? 0.9 : 1.25) };
            const tx = detail.x + dw + 48 * unit;
            // Banners set the words at the foot of their column, over the small print.
            text = { x: tx, w: W - safe.r - tx, maxH: (bottom - top) * (strip ? 0.42 : 0.34), foot: bottom - notePx * 2.6 };
        } else {
            const tall = shape === 'tall' && H / W > 1.6;
            const mh = Math.round((bottom - top) * (tall ? 0.62 : shape === 'square' ? 0.52 : 0.6));
            main = { x: safe.l, y: top, w: iw, h: mh };
            const dw = Math.round(iw * (shape === 'square' ? 0.3 : 0.36));
            const dh = Math.round(dw * 1.25);
            detail = { x: W - safe.r - dw, y: main.y + mh - dh * 0.42, w: dw, h: dh };
            text = { x: safe.l, y: main.y + mh + 44 * unit, w: iw - dw - 44 * unit, maxH: (bottom - (main.y + mh)) * 0.4 };
        }

        e.photo(main);
        // The close-up: the same photo cropped tight, framed in paper. The
        // frame is a stroke OUTSIDE it, drawn after both photos: live video
        // plays every photo under what's drawn after the first one, so a
        // filled backing would cover the close-up.
        e.photo(detail, {}, { zoom: detailZoom, main: false });
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = border;
        ctx.strokeRect(detail.x - border / 2, detail.y - border / 2, detail.w + border, detail.h + border);

        stamp(e, e.fields.stamp, main.x + (wide ? main.w * 0.24 : main.w * 0.2), main.y + (wide ? main.h * 0.16 : main.h * 0.2), (strip ? 70 : wide ? 110 : 116) * unit);

        // Headline + serif line.
        const lines = splitLines(e.fields.headline).slice(0, 3).map((l) => (e.look.caps === false ? l : l.toUpperCase()));
        const b = fitBlock(ctx, lines, e.headline, { maxW: text.w * size, maxH: text.maxH * size, tracking: -0.01, gap: 0.2 });
        const linePx = (strip ? 20 : 30) * unit;
        const rows = wrapLines(ctx, String(e.fields.line ?? ''), TYPE.serifI, linePx, text.w, strip ? 2 : 3);
        const headH = b.cap + (lines.length - 1) * b.step;
        const textTop = text.foot ? text.foot - (headH + linePx * 1.5 + (rows.length - 1) * linePx * 1.2) : text.y;
        const boxes = drawBlock(ctx, b, e.headline, text.x, textTop, { tracking: -0.01, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
        const head = blockBox(boxes);
        e.mark('headline', head);

        let y = textTop + headH + linePx * 1.5;
        let lbox = null;
        for (const r of rows) {
            lbox = unionBox(lbox, drawText(ctx, r, TYPE.serifI, linePx, text.x, y, { color: 'rgba(244,241,234,0.86)' }));
            y += linePx * 1.2;
        }
        e.mark('line', lbox);

        // Foot: small print left, the mark right.
        if (note) e.mark('note', drawText(ctx, note, TYPE.monoR, notePx, wide ? text.x : safe.l, bottom, { tracking: 0.12, color: SOFT }));
        e.logo(e.ink, W - safe.r - logoW, bottom - logoW * 0.7, logoW);
    },
};
