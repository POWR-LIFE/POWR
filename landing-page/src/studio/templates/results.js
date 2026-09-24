/**
 * RESULTS — a live event's final standings: eyebrow, the event name big, a
 * serif "the results are in", then a ranked table (winner in the accent) over
 * the lower half of a darkened photo. Names are the member's choice of how
 * they appear — first name + initial by default.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, textWidth, capHeight } from '../text';
import { rule } from '../shapes';
import { twoLines, thousands } from '../words';

// "Morgan K. — 1,240" · "Morgan K. | 1,240" · "Morgan K., 1240" · tab-separated
const parseRow = (line) => {
    const m = line.match(/^(.*?)(?:\s+[—–-]\s+|\s*\|\s*|\t|,\s+(?=[\d.,]+\s*(?:pts)?$))(.+)$/);
    return m ? { name: m[1].trim(), score: m[2].trim() } : { name: line.trim(), score: '' };
};

// Banners: eyebrow, title and line on the left; the table on the right.
function banner(e) {
    const { ctx, W, H, safe, shape, tu } = e;
    const strip = shape === 'strip';
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.6, H, 'left', 0.7);
    ctx.fillStyle = 'rgba(8,8,8,0.55)';
    ctx.fillRect(W * 0.44, 0, W * 0.56, H);
    const x0 = safe.l + 6 * tu;
    const ePx = (strip ? 14 : 18) * tu;
    e.mark('eyebrow', drawText(ctx, e.caps(e.fields.eyebrow), TYPE.mono, ePx, x0, safe.t + ePx, { tracking: 0.2, color: e.accent }));
    const tLines = splitLines(e.caps(e.fields.title)).slice(0, 2);
    const tBlock = fitBlock(ctx, tLines, e.headline, { maxW: W * (strip ? 0.3 : 0.36) * (e.look.size ?? 1), maxH: H * (strip ? 0.5 : 0.36) * (e.look.size ?? 1), gap: 0.08 });
    const tTop = safe.t + ePx + (strip ? 18 : 36) * tu;
    const tBoxes = drawBlock(ctx, tBlock, e.headline, x0, tTop, { align: 'left', color: e.ink, accent: e.accent });
    e.mark('title', blockBox(tBoxes));
    const lPx = (strip ? 24 : 40) * tu;
    const tBottom = tBoxes[tBoxes.length - 1].baseline;
    e.mark('line', drawText(ctx, e.fields.line, TYPE.serifI, lPx, x0, tBottom + 16 * tu + lPx * 0.72, { color: 'rgba(244,241,234,0.9)' }));
    if (!strip) e.mark('footer', drawText(ctx, e.caps(e.fields.footer), TYPE.brandM, 16 * tu, x0, H - safe.b, { tracking: 0.16, color: 'rgba(244,241,234,0.55)' }));
    e.logo(e.ink, W - safe.r - (strip ? 48 : 70) * tu, safe.t, (strip ? 48 : 70) * tu);

    const rows = splitLines(e.fields.rows).slice(0, strip ? 3 : 5).map(parseRow).filter((r) => r.name);
    const tx0 = W * 0.48;
    const tx1 = W - safe.r;
    const top = safe.t + (strip ? 44 : 90) * tu;
    const bottom = H - safe.b;
    const rowH = (bottom - top) / Math.max(rows.length, 1);
    const namePx = Math.min(rowH * 0.42, (strip ? 30 : 44) * tu);
    const cap = capHeight(ctx, TYPE.groteskB, namePx);
    let box = null;
    rows.forEach((r, i) => {
        const yTop = top + i * rowH;
        const base = yTop + rowH / 2 + cap / 2;
        const win = i === 0;
        if (win) {
            ctx.fillStyle = e.accent;
            ctx.fillRect(tx0, yTop + rowH * 0.22, 5 * tu, rowH * 0.56);
        }
        drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, namePx * 0.52, tx0 + 24 * tu, base, { tracking: 0.1, color: win ? e.accent : 'rgba(244,241,234,0.5)' });
        const nameX = tx0 + 24 * tu + textWidth(ctx, '00', TYPE.mono, namePx * 0.52, 0.1) + 26 * tu;
        const scoreW = r.score ? textWidth(ctx, r.score.toUpperCase(), TYPE.groteskB, namePx, -0.01) : 0;
        const room = tx1 - scoreW - 26 * tu - nameX;
        const nw = textWidth(ctx, r.name.toUpperCase(), TYPE.groteskB, namePx, -0.01);
        drawText(ctx, r.name.toUpperCase(), TYPE.groteskB, nw > room ? (namePx * room) / nw : namePx, nameX, base, { tracking: -0.01, color: win ? e.accent : e.ink });
        if (r.score) drawText(ctx, r.score.toUpperCase(), TYPE.groteskB, namePx, tx1, base, { align: 'right', tracking: -0.01, color: win ? e.accent : e.ink });
        if (i < rows.length - 1) rule(ctx, tx0, yTop + rowH, tx1, yTop + rowH, 'rgba(244,241,234,0.16)', 1.2 * tu);
        const b = { x: tx0, y: yTop, w: tx1 - tx0, h: rowH };
        box = box ? { ...box, h: b.y + b.h - box.y } : b;
    });
    e.mark('rows', box);
}

export default {
    id: 'results',
    name: 'Results',
    category: 'Events',
    blurb: 'Final standings: the event big, a ranked table, the winner in the accent.',
    refs: 'the event podium',
    headlineFont: 'anton',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Live event · Final standings' },
        { key: 'title', label: 'Event name', rows: 2, value: 'Friday\nFinals' },
        { key: 'line', label: 'Line', value: 'The results are in.' },
        { key: 'rows', label: 'Standings', rows: 5, value: 'Morgan K. — 1,240\nTaylor B. — 1,185\nJordan P. — 1,120\nSam R. — 1,060\nAlex D. — 985', hint: 'One per line: name — points. The first line is the winner. First name + initial unless they’ve said yes to more.' },
        { key: 'footer', label: 'Footer', value: 'Every move counts · powr.life' },
    ],
    // The words an event gives it — the standings only once there are some.
    fill: {
        event: (ev) => ({
            title: twoLines(ev.name, 8),
            eyebrow: ev.board === 'live' ? 'Live event · Standings' : 'Live event · Final standings',
            line: ev.board === 'live' ? 'All to play for.' : 'The results are in.',
            ...(ev.standings?.length ? { rows: ev.standings.map((r) => `${r.name} — ${thousands(r.points)}`).join('\n') } : {}),
        }),
    },
    presets: [
        { name: 'Final', fields: { eyebrow: 'Live event · Final standings', line: 'The results are in.' } },
        { name: 'Halfway', fields: { eyebrow: 'Live event · Halfway', line: 'All to play for.' } },
        { name: 'Weekly', fields: { eyebrow: 'This week · ONE LDN', title: 'Gym\nfloor top 5', line: 'Five check-ins a week will do it.' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.15, fade: 0,
        tint: 'warm', motion: 0.2, angle: 0, focus: 0.6, vignette: 0.5, grain: 0.5, size: 1,
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.4, 'top', 0.55);
        e.fade(0, H * 0.3, W, H * 0.7, 'bottom', 0.94);

        const logoW = 92 * u;
        e.logo(e.ink, x1 - logoW, safe.t + 6 * u, logoW);

        // ── Eyebrow, title, line ───────────────────────────────────────────
        const ePx = (sq ? 17 : 19) * u;
        e.mark('eyebrow', drawText(ctx, e.caps(e.fields.eyebrow), TYPE.mono, ePx, x0, safe.t + 20 * u, { tracking: 0.2, color: e.accent }));

        const size = e.look.size ?? 1;
        const tLines = splitLines(e.caps(e.fields.title)).slice(0, 2);
        const tBlock = fitBlock(ctx, tLines, e.headline, {
            maxW: W * 0.7 * size, maxH: H * (tall ? 0.17 : sq ? 0.24 : 0.2) * size, gap: 0.08,
        });
        const tTop = safe.t + 58 * u;
        const tH = tBlock.cap + (tLines.length - 1) * tBlock.step;
        const lineH = (sq ? 36 : 44) * u * 1.6;
        e.shade({ x: x0, y: tTop, w: W * 0.7, h: tH + lineH }, { ceiling: 0.3, max: 0.7, form: 'top' });
        const tBoxes = drawBlock(ctx, tBlock, e.headline, x0, tTop, { align: 'left', color: e.ink, accent: e.accent });
        e.mark('title', blockBox(tBoxes));
        const tBottom = tBoxes[tBoxes.length - 1].baseline;
        const lPx = (sq ? 36 : 44) * u;
        e.mark('line', drawText(ctx, e.fields.line, TYPE.serifI, lPx, x0, tBottom + 22 * u + lPx * 0.72, { color: 'rgba(244,241,234,0.9)' }));

        // ── Standings table ────────────────────────────────────────────────
        const rows = splitLines(e.fields.rows).slice(0, 5).map(parseRow).filter((r) => r.name);
        const footBase = H - safe.b - 4 * u;
        const tableBottom = footBase - 50 * u;
        const tableTop = Math.max(tBottom + lPx + 70 * u, H * (tall ? 0.42 : sq ? 0.47 : 0.48));
        const rowH = Math.min((tableBottom - tableTop) / Math.max(rows.length, 1), 118 * u);
        const panelTop = tableBottom - rows.length * rowH - 70 * u;
        const g = ctx.createLinearGradient(0, panelTop, 0, panelTop + 110 * u);
        g.addColorStop(0, 'rgba(8,8,8,0)');
        g.addColorStop(1, 'rgba(8,8,8,0.62)');
        ctx.fillStyle = g;
        ctx.fillRect(0, panelTop, W, 110 * u);
        ctx.fillStyle = 'rgba(8,8,8,0.62)';
        ctx.fillRect(0, panelTop + 110 * u, W, H - panelTop - 110 * u);
        const namePx = Math.min(rowH * 0.38, 44 * u);
        const rankPx = namePx * 0.52;
        const cap = capHeight(ctx, TYPE.groteskB, namePx);
        let box = null;
        rows.forEach((r, i) => {
            const yTop = tableBottom - (rows.length - i) * rowH;
            const base = yTop + rowH / 2 + cap / 2;
            const win = i === 0;
            if (win) {
                ctx.fillStyle = e.accent;
                ctx.fillRect(x0, yTop + rowH * 0.2, 5 * u, rowH * 0.6);
            }
            drawText(ctx, String(i + 1).padStart(2, '0'), TYPE.mono, rankPx, x0 + 26 * u, base, { tracking: 0.1, color: win ? e.accent : 'rgba(244,241,234,0.5)' });
            const nameX = x0 + 26 * u + textWidth(ctx, '00', TYPE.mono, rankPx, 0.1) + 30 * u;
            const scoreW = r.score ? textWidth(ctx, r.score.toUpperCase(), TYPE.groteskB, namePx, -0.01) : 0;
            // Shrink a long name rather than let it run into the points.
            const room = x1 - scoreW - 30 * u - nameX;
            const nw = textWidth(ctx, r.name.toUpperCase(), TYPE.groteskB, namePx, -0.01);
            const nPx = nw > room ? (namePx * room) / nw : namePx;
            drawText(ctx, r.name.toUpperCase(), TYPE.groteskB, nPx, nameX, base, { tracking: -0.01, color: win ? e.accent : e.ink });
            if (r.score) drawText(ctx, r.score.toUpperCase(), TYPE.groteskB, namePx, x1, base, { align: 'right', tracking: -0.01, color: win ? e.accent : e.ink });
            rule(ctx, x0, yTop + rowH, x1, yTop + rowH, 'rgba(244,241,234,0.16)', 1.2 * u);
            const b = { x: x0, y: yTop, w: x1 - x0, h: rowH };
            box = box ? { x: x0, y: Math.min(box.y, b.y), w: x1 - x0, h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b;
        });
        e.mark('rows', box);

        e.mark('footer', drawText(ctx, e.caps(e.fields.footer), TYPE.brandM, (sq ? 16 : 18) * u, x0, footBase, {
            tracking: 0.16, color: 'rgba(244,241,234,0.55)',
        }));
    },
};
