/**
 * DOTS — a quiet grid of small dots over the photo; each word of the headline
 * takes the place of one dot, stepping down the grid. The grid keeps square
 * cells in every size (four columns on a post, more across a banner), and the
 * POWR mark and a line of small print sit on its bottom corners. After the
 * "Connecting the Dots" poster — the look, not the copy.
 */
import { TYPE } from '../fonts';
import { splitLines, parseLine, lineMetrics, paintLine, capHeight, drawText, textWidth, unionBox } from '../text';
import { dot } from '../shapes';
import { logo } from '../logo';

export default {
    id: 'dots',
    name: 'Dots',
    category: 'Brand',
    blurb: 'A grid of small dots over the photo — each word of the headline takes the place of one.',
    refs: 'Connecting the Dots',
    headlineFont: 'grotesk',
    fields: [
        { key: 'headline', label: 'Words', rows: 4, value: 'Every\nmove\ncounts.', hint: 'One word (or a short phrase) per line — each sits on the grid in place of a dot.' },
        { key: 'note', label: 'Small print', value: 'powr.life', hint: 'Bottom-left corner of the grid. Leave empty for a dot.' },
    ],
    presets: [
        { name: 'Every move counts', fields: { headline: 'Every\nmove\ncounts.' } },
        { name: 'Earned, not given', fields: { headline: 'Earned,\nnot\ngiven.' } },
        { name: 'The streak is yours', fields: { headline: 'The\nstreak\nis\nyours.' } },
        { name: 'Gym floor', fields: { headline: 'Nobody\nowns the\ngym floor.\nUntil now.' } },
    ],
    look: {
        mono: 1, target: 0.26, auto: 0.85, contrast: 0.42, crush: 0.12, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.6, vignette: 0.45, grain: 0.45, size: 1,
        path: 'zigzag', dotColor: 'ink',
    },
    controls: [
        { key: 'path', label: 'Words', options: [['zigzag', 'Zigzag'], ['diagonal', 'Diagonal'], ['column', 'One column']] },
        { key: 'dotColor', label: 'Dots', options: [['ink', 'White'], ['accent', 'Accent']] },
    ],

    draw(e) {
        const { ctx, W, H, u, safe, shape } = e;
        const banner = shape === 'wide' || shape === 'strip';
        const unit = banner ? e.tu : u;
        const subject = e.photo({ x: 0, y: 0, w: W, h: H });

        // ── The grid: square cells inside the safe area ────────────────────
        const gx0 = safe.l;
        const gx1 = W - safe.r;
        const gy0 = safe.t;
        const gy1 = H - safe.b;
        let cols;
        let rows;
        if (banner) {
            rows = shape === 'strip' ? 3 : 4;
            cols = Math.max(3, Math.round((gx1 - gx0) / ((gy1 - gy0) / (rows - 1))) + 1);
        } else {
            cols = 4;
            rows = Math.max(3, Math.round((gy1 - gy0) / ((gx1 - gx0) / (cols - 1))) + 1);
        }
        const X = (c) => gx0 + (c * (gx1 - gx0)) / (cols - 1);
        const Y = (r) => gy0 + (r * (gy1 - gy0)) / (rows - 1);

        // ── Words: one per row, centred on a grid point ────────────────────
        let words = splitLines(e.caps(e.fields.headline)).map((w) => w.trim()).filter(Boolean);
        if (words.length > rows) words = [...words.slice(0, rows - 1), words.slice(rows - 1).join(' ')];
        const n = words.length;
        const path = e.look.path ?? 'zigzag';
        // The two columns either side of the middle (the reference steps 2 → 3 → 2 on four).
        const inner = cols % 2 ? [(cols - 3) / 2, (cols + 1) / 2] : [cols / 2 - 1, cols / 2];
        const colOf = (i) => (path === 'column' ? inner[0]
            : path === 'diagonal' ? Math.min(cols - 1, Math.max(0, Math.round((cols - n) / 2) + i))
            : inner[i % 2]);
        // Where the words go: the path as drawn or mirrored, starting on the
        // row above or below the middle. Keep words off the subject (the
        // photo's focal point) and off the bottom row, which the corners use.
        const step = Math.min((gx1 - gx0) / (cols - 1), (gy1 - gy0) / (rows - 1));
        const starts = [...new Set([Math.floor((rows - n) / 2), Math.ceil((rows - n) / 2)])];
        const options = starts.flatMap((r0) => [false, true].map((mirror) => words.map((_, i) => ({
            c: mirror ? cols - 1 - colOf(i) : colOf(i), r: r0 + i,
        }))));
        const score = (spots) => {
            const clear = e.hasMedia ? Math.min(1.5, ...spots.map((p) => Math.hypot(X(p.c) - subject.x, Y(p.r) - subject.y) / step)) : 0;
            return clear - (spots.some((p) => p.r === rows - 1) ? 0.35 : 0);
        };
        const spots = options.reduce((best, o) => (score(o) > score(best) ? o : best), options[0]);

        // One size for every word: the brief's size, or smaller if the widest
        // word wouldn't fit between the margins.
        const spec = e.headline;
        const tracking = 0.01;
        let px = (banner ? 44 : shape === 'tall' ? 50 : shape === 'square' ? 48 : 54) * unit * (e.look.size ?? 1);
        const widest = Math.max(1, ...words.map((w) => textWidth(ctx, w, spec, px, tracking)));
        px = Math.min(px, (px * (gx1 - gx0)) / widest);
        const cap = capHeight(ctx, spec, px);
        const color = e.headlineAccent ? e.accent : e.ink;

        const boxes = [];
        words.forEach((w, i) => {
            const segs = parseLine(w);
            const m = lineMetrics(ctx, segs, spec, px, tracking);
            const cx = X(spots[i].c);
            const cy = Y(spots[i].r);
            // Centre the ink on the dot, then keep it inside the grid.
            let left = cx - m.inkW / 2;
            left = Math.max(gx0, Math.min(left, gx1 - m.inkW));
            const box = { x: left, y: cy - cap / 2, w: m.inkW, h: cap };
            e.shade(box, { ceiling: 0.3, max: 0.55, spread: 1.3 });
            paintLine(ctx, segs, spec, px, left - m.inkL, cy + cap / 2, { tracking, color, accent: e.accent });
            boxes.push(box);
        });
        e.mark('headline', boxes.reduce((a, b) => unionBox(a, b), null));

        // ── Corners: small print bottom-left, the POWR mark bottom-right ───
        const yLast = Y(rows - 1);
        const notePx = (banner ? 15 : 17) * unit;
        const note = e.caps(e.fields.note).trim();
        let noteBox = null;
        if (note) {
            noteBox = drawText(ctx, note, TYPE.mono, notePx, gx0, yLast + capHeight(ctx, TYPE.mono, notePx) / 2, { tracking: 0.12, color: 'rgba(244,241,234,0.8)' });
            e.mark('note', noteBox);
        }
        const mark = logo(e.ink);
        const logoW = (banner ? 58 : 70) * unit;
        const logoH = mark ? (logoW * mark.height) / mark.width : logoW * 0.7;
        const logoBox = { x: gx1 - logoW, y: yLast - logoH / 2, w: logoW, h: logoH };
        e.logo(e.ink, logoBox.x, logoBox.y, logoW);

        // ── The dots: every grid point nothing else is sitting on ──────────
        const dotR = Math.max(1.5, 4.5 * unit);
        const dotColor = e.look.dotColor === 'accent' ? e.accent : 'rgba(244,241,234,0.92)';
        const pad = 18 * unit;
        const taken = [...boxes, noteBox, logoBox].filter(Boolean);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = X(c);
                const y = Y(r);
                if (taken.some((b) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad)) continue;
                dot(ctx, x, y, dotR, dotColor);
            }
        }
    },
};
