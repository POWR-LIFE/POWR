/**
 * TALLY — the numbers are the headline: the photo on one side, a flat panel
 * on the other with a short headline, a lockup (the POWR mark | a gym or
 * partner) and two to four big stats along its foot, each number over its
 * one-word label. Made for "last week in numbers", an event's totals, a
 * member's streak. Trend drop 01 (Sep 2026): data-as-headline boards.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, textWidth, blockBox, unionBox } from '../text';

const DARK = '#111111';

/** "412 — Check-ins", "412 Check-ins", "8:54 | Pace" → { value, label }. */
export function parseStats(text) {
    return String(text ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map((l) => {
            const m = l.match(/^(\S+)\s*(?:[—–|-]\s*)?(.*)$/);
            return { value: m[1], label: m[2].trim() };
        });
}

export default {
    id: 'tally',
    name: 'Tally',
    category: 'Brand',
    blurb: 'The numbers are the headline: photo on one side, big stats on a flat panel.',
    refs: 'data-as-headline boards (trend drop 01)',
    headlineFont: 'groteskB',
    fields: [
        { key: 'headline', label: 'Headline', rows: 2, value: 'Last week,\nin numbers.', hint: 'Two short lines read best.' },
        { key: 'lockup', label: 'Beside the POWR mark', value: 'ONE LDN', hint: 'A gym or partner name. Leave empty for the mark alone.' },
        { key: 'stats', label: 'Stats', rows: 4, value: '412 — Check-ins\n96 — Members\n18 — New faces', hint: 'One per line: number — label. Two to four; three reads best.' },
        { key: 'tag', label: 'Tag on the photo', value: '21–27 Sep', hint: 'A small chip on the photo. Leave empty to hide it.' },
    ],
    presets: [
        { name: 'Gym week', fields: { headline: 'Last week,\nin numbers.', lockup: 'ONE LDN', stats: '412 — Check-ins\n96 — Members\n18 — New faces', tag: '21–27 Sep' } },
        { name: 'Your week', fields: { headline: 'Your week,\ncounted.', lockup: '', stats: '4 — Sessions\n23,410 — Steps\n640 — Points', tag: 'Week 39' } },
        { name: 'Event night', fields: { headline: 'Friday Finals,\nby the numbers.', lockup: 'ONE LDN', stats: '38 — Athletes\n3 — Hours\n1,240 — Top score', tag: 'Results' } },
        { name: 'Streak', fields: { headline: 'Twelve weeks.\nNot one missed.', lockup: '', stats: '12 — Weeks\n48 — Sessions\n2,880 — Points', tag: '' } },
    ],
    look: {
        mono: 1, target: 0.3, auto: 0.85, contrast: 0.5, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.6, vignette: 0.3, grain: 0.45, size: 1,
        panel: 'accent', side: 'photo', caps: false,
    },
    controls: [
        { key: 'panel', label: 'Panel', options: [['accent', 'Accent'], ['dark', 'Dark']] },
        { key: 'side', label: 'Photo', options: [['photo', 'Photo first'], ['panel', 'Panel first']] },
    ],

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const wide = shape === 'wide' || shape === 'strip';
        const strip = shape === 'strip';
        const unit = wide ? e.tu : e.u;
        const size = e.look.size ?? 1;
        const flip = e.look.side === 'panel';
        const onAccent = e.look.panel !== 'dark';
        const bg = onAccent ? e.accent : DARK;
        const ink = onAccent ? DARK : e.ink;
        const num = onAccent ? DARK : e.accent;

        // Split: photo and panel side by side on banners, stacked otherwise.
        // A story's panel starts at half height so the stats clear the reply bar.
        const frac = wide ? (strip ? 0.58 : 0.5) : shape === 'tall' ? (H / W > 1.6 ? 0.5 : 0.44) : shape === 'square' ? 0.5 : 0.46;
        let photo;
        let panel;
        if (wide) {
            const pw = Math.round(W * frac);
            panel = flip ? { x: W - pw, y: 0, w: pw, h: H } : { x: 0, y: 0, w: pw, h: H };
            photo = flip ? { x: 0, y: 0, w: W - pw, h: H } : { x: pw, y: 0, w: W - pw, h: H };
        } else {
            const ph = Math.round(H * frac);
            panel = flip ? { x: 0, y: 0, w: W, h: ph } : { x: 0, y: H - ph, w: W, h: ph };
            photo = flip ? { x: 0, y: ph, w: W, h: H - ph } : { x: 0, y: 0, w: W, h: H - ph };
        }
        e.photo(photo);
        ctx.fillStyle = bg;
        ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

        // The panel's own inset: the format's safe area where the panel meets
        // the edge of the frame, a gutter where it meets the photo.
        const gutter = (strip ? 28 : 56) * unit;
        const inset = {
            l: panel.x === 0 ? safe.l : panel.x + gutter,
            r: panel.x + panel.w === W ? W - safe.r : panel.x + panel.w - gutter,
            t: panel.y === 0 ? safe.t : panel.y + gutter * 0.9,
            b: panel.y + panel.h === H ? H - safe.b : panel.y + panel.h - gutter * 0.9,
        };
        const iw = inset.r - inset.l;
        const ih = inset.b - inset.t;

        // Headline, top of the panel.
        const lines = splitLines(e.fields.headline).slice(0, 3);
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: iw * (strip ? 0.62 : 0.94) * size,
            maxH: ih * (strip ? 0.42 : wide ? 0.3 : 0.34) * size,
            tracking: -0.02,
            gap: 0.12,
        });
        const boxes = drawBlock(ctx, block, e.headline, inset.l, inset.t, { tracking: -0.02, color: ink, accent: num });
        const head = blockBox(boxes);
        e.mark('headline', head);
        let y = (head ? head.y + head.h : inset.t + block.cap) + 26 * unit;

        // Lockup under it: the mark | a name, like a co-branded sign-off.
        if (!strip) {
            const markW = 64 * unit;
            e.logo(ink, inset.l, y, markW);
            const lock = String(e.fields.lockup ?? '').trim().toUpperCase();
            if (lock) {
                const px = 20 * unit;
                const lx = inset.l + markW + 18 * unit;
                ctx.fillStyle = ink;
                ctx.fillRect(lx, y + 4 * unit, 2 * unit, markW * 0.62);
                e.mark('lockup', drawText(ctx, lock, TYPE.groteskB, px, lx + 18 * unit, y + markW * 0.31 + px * 0.36 + 4 * unit, { tracking: 0.08, color: ink }));
            }
        }

        // The stats along the foot: equal columns, each number over its label,
        // one size for all so the row reads as a row.
        const stats = parseStats(e.fields.stats);
        if (stats.length) {
            const cols = stats.length;
            const colGap = (strip ? 20 : 28) * unit;
            const colW = (iw - colGap * (cols - 1)) / cols;
            // As big as the column allows: the numbers are the headline.
            let px = Math.min((strip ? 0.36 : wide ? 0.26 : 0.3) * ih, 260 * unit) * size;
            for (const s of stats) {
                const vw = textWidth(ctx, s.value, e.headline, px, -0.02);
                if (vw > colW) px *= colW / vw;
            }
            // Labels half the number's size, smaller if a long one needs it.
            let labelPx = px * 0.5;
            for (const s of stats) {
                const lw = textWidth(ctx, s.label, e.headline, labelPx, -0.01);
                if (lw > colW) labelPx *= colW / lw;
            }
            labelPx = Math.max(labelPx, px * 0.3);
            const labelBase = inset.b;
            const numBase = labelBase - labelPx * 1.25;
            let box = null;
            stats.forEach((s, i) => {
                const x = inset.l + i * (colW + colGap);
                box = unionBox(box, drawText(ctx, s.value, e.headline, px, x, numBase, { tracking: -0.02, color: num }));
                box = unionBox(box, drawText(ctx, s.label, e.headline, labelPx, x, labelBase, { tracking: -0.01, color: ink }));
            });
            e.mark('stats', box);
        }

        // A small chip on the photo, in the panel's colour.
        const tag = String(e.fields.tag ?? '').trim();
        if (tag) {
            const px = (strip ? 16 : 20) * unit;
            const tw = textWidth(ctx, tag.toUpperCase(), TYPE.monoR, px, 0.08);
            const padX = 12 * unit;
            const h = px * 1.7;
            const top = photo.y === 0 ? safe.t : photo.y + 28 * unit;
            const right = photo.x + photo.w === W ? W - safe.r : photo.x + photo.w - 28 * unit;
            ctx.fillStyle = bg;
            ctx.fillRect(right - tw - padX * 2, top, tw + padX * 2, h);
            e.mark('tag', drawText(ctx, tag.toUpperCase(), TYPE.monoR, px, right - tw - padX, top + h * 0.5 + px * 0.36, { tracking: 0.08, color: onAccent ? DARK : e.ink }));
        }
        if (strip) e.logo(onAccent ? DARK : e.ink, inset.r - 56 * unit, inset.t, 56 * unit);
    },
};
