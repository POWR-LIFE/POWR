/**
 * TIMETABLE — a gym's class timetable: day · time · class · coach in ruled
 * columns under a light title, one class picked out (a band, an accent
 * edge and a tag), the venue at the foot. Takes three to seven classes; the
 * thin banners show the first few. For gyms and studios.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, textWidth, splitLines, fitBlock, drawBlock, blockBox } from '../../../text';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, HAIR, topRow, mono, unitOf, fitPx, onAccent, rowsOf } from './_parts';

// "*Wed · 19:00 · Engine room · Alex" → { day, time, name, coach, hot }.
const classesOf = (e) => rowsOf(e.fields.rows).slice(0, 7).map((c) => {
    const hot = /^\*/.test(c[0]);
    const [day = '', time = '', name = '', coach = ''] = [c[0].replace(/^\*\s*/, ''), ...c.slice(1)];
    return { day, time, name, coach, hot };
});

// A translucent wash of the accent (any CSS colour the editor gives us).
function wash(ctx, accent, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = accent;
    return () => ctx.restore();
}

// The table in x0..x1 from `top`. Returns the bottom.
function table(e, rows, x0, x1, top, rowH, px, { heads = true } = {}) {
    const { ctx } = e;
    const k = unitOf(e);
    const labPx = Math.max(11 * k, px * 0.42);
    const dayW = Math.max(textWidth(ctx, 'WED', TYPE.brandSB, px * 0.8, 0.06), ...rows.map((r) => textWidth(ctx, e.caps(r.day), TYPE.brandSB, px * 0.8, 0.06)));
    const timeX = x0 + Math.min(dayW, px * 3) + 30 * k;
    const timeW = Math.max(textWidth(ctx, '00:00', TYPE.mono, px * 0.72, 0.04), ...rows.map((r) => textWidth(ctx, r.time, TYPE.mono, px * 0.72, 0.04)));
    const nameX = timeX + Math.min(timeW, px * 4) + 34 * k;
    let y = top;
    if (heads) {
        const hb = y + labPx;
        const hd = String(e.fields.heads ?? '').split(/\s*[·|,]\s*/);
        mono(e, hd[0] ?? 'Day', x0, hb, labPx);
        mono(e, hd[1] ?? 'Time', timeX, hb, labPx);
        mono(e, hd[2] ?? 'Class', nameX, hb, labPx);
        mono(e, hd[3] ?? 'Coach', x1, hb, labPx, { align: 'right' });
        e.mark('heads', { x: x0, y: y, w: x1 - x0, h: labPx });
        y += labPx * 2.2;
        rule(ctx, x0, y, x1, y, 'rgba(244,241,234,0.3)', Math.max(1, 1.4 * k));
    }
    const cap = capHeight(ctx, TYPE.brandM, px);
    const tag = e.caps(e.fields.tag ?? '').trim();
    rows.forEach((r, i) => {
        const yTop = y + i * rowH;
        const base = yTop + rowH / 2 + cap / 2;
        if (r.hot) {
            const done = wash(ctx, e.accent, 0.14);
            ctx.fillRect(x0 - 16 * k, yTop, x1 - x0 + 32 * k, rowH);
            done();
            ctx.fillStyle = e.accent;
            ctx.fillRect(x0 - 16 * k, yTop, 5 * k, rowH);
        }
        drawText(ctx, e.caps(r.day), TYPE.brandSB, fitPx(ctx, e.caps(r.day), TYPE.brandSB, px * 0.8, timeX - x0 - 20 * k, 0.06), x0, base, { tracking: 0.06, color: r.hot ? e.accent : SOFT });
        drawText(ctx, r.time, TYPE.mono, fitPx(ctx, r.time, TYPE.mono, px * 0.72, nameX - timeX - 20 * k, 0.04), timeX, base, { tracking: 0.04, color: r.hot ? e.ink : GREY });
        const cw = r.coach ? textWidth(ctx, r.coach, TYPE.brandR, px * 0.8, 0) : 0;
        if (r.coach) drawText(ctx, r.coach, TYPE.brandR, px * 0.8, x1, base, { align: 'right', color: GREY });
        const room = x1 - cw - 30 * k - nameX;
        // The tag rides after the class name on the picked row.
        let tagW = 0;
        const tPx = px * 0.46;
        if (r.hot && tag) tagW = textWidth(ctx, tag, TYPE.brandSB, tPx, 0.1) + tPx * 1.6;
        const np = fitPx(ctx, r.name, TYPE.brandM, px, room - (tagW ? tagW + 18 * k : 0));
        drawText(ctx, r.name, TYPE.brandM, np, nameX, base, { color: e.ink });
        if (tagW && room - textWidth(ctx, r.name, TYPE.brandM, np, 0) > tagW + 18 * k) {
            const tx = nameX + textWidth(ctx, r.name, TYPE.brandM, np, 0) + 18 * k;
            const th = tPx * 2;
            ctx.fillStyle = e.accent;
            ctx.fillRect(tx, base - cap / 2 - th / 2, tagW, th);
            e.mark('tag', drawText(ctx, tag, TYPE.brandSB, tPx, tx + tPx * 0.8, base - cap / 2 + tPx * 0.36, { tracking: 0.1, color: onAccent(e.accent) }));
        }
        if (i < rows.length - 1 && !r.hot && !rows[i + 1].hot) rule(ctx, x0, yTop + rowH, x1, yTop + rowH, HAIR, Math.max(1, k));
    });
    e.mark('rows', { x: x0, y, w: x1 - x0, h: rows.length * rowH });
    return y + rows.length * rowH;
}

function title(e, x, top, maxW, maxH, bottom = false) {
    const lines = splitLines(e.fields.title).slice(0, 2);
    if (!lines.length) return null;
    const block = fitBlock(e.ctx, lines, e.headline, { maxW, maxH, gap: 0.16 });
    const h = block.cap + (lines.length - 1) * block.step;
    const t = bottom ? top - h : top;
    e.shade({ x, y: t, w: maxW, h }, { ceiling: 0.26, max: 0.55 });
    const box = blockBox(drawBlock(e.ctx, block, e.headline, x, t, { align: 'left', color: e.headlineAccent ? e.accent : e.ink, accent: e.accent }));
    e.mark('title', box);
    return box;
}

function venue(e, x, base, px, maxW, align = 'left') {
    const v = String(e.fields.venue ?? '').trim();
    if (!v) return;
    e.mark('venue', drawText(e.ctx, v, TYPE.brandR, fitPx(e.ctx, v, TYPE.brandR, px, maxW), x, base, { color: SOFT, align }));
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    const size = e.look.size ?? 1;
    const px0 = W * (strip ? 0.4 : 0.4);
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.5, H, 'left', 0.6);
    ctx.fillStyle = 'rgba(11,11,11,0.86)';
    ctx.fillRect(px0, 0, W - px0, H);
    topRow(e, x0, px0 - 40 * k, y0, (strip ? 42 : 56) * k, { px: (strip ? 13 : 16) * k, lockupShare: 0.5 });
    title(e, x0, strip ? y1 - 30 * k : y1 - 60 * k, (px0 - x0 - 50 * k) * size, (y1 - y0) * (strip ? 0.4 : 0.34) * size, true);
    venue(e, x0, y1, (strip ? 16 : 22) * k, px0 - x0 - 40 * k);
    const rows = classesOf(e);
    const shown = strip ? (rows.some((r, i) => r.hot && i >= 3) ? [rows.find((r) => r.hot), ...rows.filter((r) => !r.hot)].slice(0, 3) : rows.slice(0, 3)) : rows;
    const tx0 = px0 + (strip ? 50 : 70) * k;
    const tx1 = x1;
    const headH = strip ? 0 : 40 * k;
    const rowH = Math.min((strip ? 80 : 96) * k, (y1 - y0 - headH) / Math.max(1, shown.length));
    const px = Math.min((strip ? 30 : 34) * k, rowH * 0.42);
    const tH = headH + rowH * shown.length;
    table(e, shown, tx0, tx1, y0 + (y1 - y0 - tH) / 2, rowH, px, { heads: !strip });
}

export default {
    id: 'timetable',
    name: 'Timetable',
    category: 'Move',
    blurb: 'A class timetable: day, time, class and coach in ruled columns, one class picked out, the venue at the foot. For gyms and studios.',
    refs: 'the timetable by the studio door',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Classes · This week' },
        { key: 'title', label: 'Title', rows: 2, value: 'This week at\nNorthside' },
        { key: 'rows', label: 'Classes', rows: 7, value: 'Mon · 07:00 · Strength · Sam\nTue · 18:30 · Spin 45 · Priya\n*Wed · 19:00 · Engine room · Alex\nThu · 07:00 · Mobility · Jo\nSat · 09:00 · Run club · Morgan', hint: 'One per line: day · time · class · coach. Start a line with * to pick it out. Three to seven.' },
        { key: 'tag', label: 'Tag on the picked class', value: 'New' },
        { key: 'heads', label: 'Column heads', value: 'Day · Time · Class · Coach' },
        { key: 'venue', label: 'Venue', value: 'Northside Gym · Canal Yard' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Gym week', fields: { eyebrow: 'Classes · This week', title: 'This week at\nNorthside', rows: 'Mon · 07:00 · Strength · Sam\nTue · 18:30 · Spin 45 · Priya\n*Wed · 19:00 · Engine room · Alex\nThu · 07:00 · Mobility · Jo\nSat · 09:00 · Run club · Morgan', tag: 'New', venue: 'Northside Gym · Canal Yard' } },
        { name: 'Studio day', fields: { eyebrow: 'Saturday · Studio 2', title: 'Saturday\nclasses', rows: '08:00 · 45 min · Yoga flow · Jo\n09:00 · 30 min · Core · Sam\n*10:00 · 45 min · Spin 45 · Priya\n11:15 · 60 min · Pilates · Ana\n12:30 · 30 min · Stretch · Jo\n14:00 · 45 min · Boxing · Alex\n16:00 · 45 min · Barre · Ana', tag: 'Full', heads: 'Time · Length · Class · Coach', venue: 'Book in the app · Northside Studio' } },
        { name: 'POWR nights', fields: { eyebrow: 'Earn at every class', title: 'Every class\ncounts.', rows: 'Mon · 18:00 · Lift club · Sam\n*Wed · 19:00 · Engine room · Alex\nFri · 18:30 · Open gym · Morgan', tag: 'Points', venue: 'Check in with POWR · powr.life' } },
        { name: 'Run club', fields: { eyebrow: 'Northside Run Club', title: 'Weekly\nruns', rows: 'Tue · 18:30 · Track reps · Morgan\n*Thu · 19:00 · Social 5K · Taylor\nSun · 08:30 · Long run · Jordan', tag: 'All paces', venue: 'Meet at the lock gates' } },
    ],
    look: {
        mono: 1, target: 0.22, auto: 0.85, contrast: 0.42, crush: 0.12, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.45, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), venue: `${r.brand} · Rewards in the POWR app` }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        const rows = classesOf(e);
        const n = Math.max(1, rows.length);

        // The table's panel grows up from the foot with the number of classes.
        const footBase = H - safe.b - 4 * u;
        const want = (tall ? 100 : sq ? 64 : 84) * u;
        const headH = (sq ? 16 : 18) * u * 2.2;
        const maxRows = H * (tall ? 0.46 : sq ? 0.5 : 0.52);
        const rowH = Math.max(40 * u, Math.min(want, maxRows / n));
        const px = Math.min((tall ? 38 : sq ? 29 : 34) * u, rowH * 0.42);
        const vPx = (sq ? 22 : 26) * u;
        const tableBottom = footBase - vPx - (sq ? 34 : 50) * u;
        const tableTop = tableBottom - headH - n * rowH;
        const panelTop = tableTop - (sq ? 40 : 60) * u;

        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.24, 'top', 0.5);
        e.fade(0, panelTop - H * 0.3, W, H * 0.3, 'bottom', 0.7);
        ctx.fillStyle = 'rgba(11,11,11,0.86)';
        ctx.fillRect(0, panelTop, W, H - panelTop);
        const hb = topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);
        const room = panelTop - (sq ? 36 : 50) * u - hb - 30 * u;
        title(e, x0, panelTop - (sq ? 36 : 50) * u, (x1 - x0) * 0.8 * size, Math.min(H * (tall ? 0.12 : sq ? 0.14 : 0.13), room) * size, true);
        table(e, rows, x0, x1, tableTop, rowH, px);
        venue(e, x0, footBase, vPx, x1 - x0);
    },
};
