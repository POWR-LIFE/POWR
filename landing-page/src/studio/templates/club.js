/**
 * CLUB — full-bleed photo, one huge condensed headline, two flanking
 * columns, a serif line and a sign-off. After Revs Run Club / After Dark.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, textWidth, blockBox } from '../text';
import { twoLines } from '../words';

// Banner strip: the headline centred, columns either side, sign-off under.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, H * 0.4, W, H * 0.6, 'bottom', 0.7);
    e.logo(e.ink, safe.l, safe.t, 56 * tu);
    const lines = splitLines(e.caps(e.fields.headline)).slice(0, 2);
    const signPx = 32 * tu;
    const block = fitBlock(ctx, lines, e.headline, { maxW: W * 0.42 * (e.look.size ?? 1), maxH: (H - safe.t - safe.b - signPx - 26 * tu) * (e.look.size ?? 1), gap: 0.08 });
    const blockH = block.cap + (lines.length - 1) * block.step;
    const top = (H - (blockH + 22 * tu + signPx * 0.72)) / 2;
    e.shade({ x: W * 0.29, y: top, w: W * 0.42, h: blockH }, { ceiling: 0.34 });
    e.mark('headline', blockBox(drawBlock(ctx, block, e.headline, W / 2, top, { align: 'center', color: e.headlineAccent ? e.accent : e.ink, accent: e.accent })));
    e.mark('signoff', drawText(ctx, e.caps(e.fields.signoff), TYPE.anton, signPx, W / 2, top + blockH + 22 * tu + signPx * 0.72, { align: 'center', tracking: 0.012, color: e.accent }));
    const cpx = 26 * tu;
    const left = e.caps(e.fields.left);
    const right = e.caps(e.fields.right);
    const n = Math.max(splitLines(left).length, splitLines(right).length, 1);
    const cy = H / 2 - ((n - 1) * cpx * 1.04) / 2 + cpx * 0.36;
    e.mark('left', drawText(ctx, left, TYPE.groteskB, cpx, W * 0.14, cy, { align: 'center', tracking: -0.01, color: e.ink, leading: 1.04 }));
    e.mark('right', drawText(ctx, right, TYPE.groteskB, cpx, W * 0.86, cy, { align: 'center', tracking: -0.01, color: e.ink, leading: 1.04 }));
}

export default {
    id: 'club',
    name: 'Club',
    category: 'Events',
    blurb: 'Full-bleed photo, one huge headline, two columns.',
    refs: 'Revs Run Club',
    headlineFont: 'anton',
    fields: [
        { key: 'headline', label: 'Headline', rows: 2, value: 'Friday\nFinals', hint: 'One to three lines. Wrap a word in {braces} to colour it.' },
        { key: 'left', label: 'Left column', rows: 3, value: 'At\nONE LDN\nLondon' },
        { key: 'right', label: 'Right column', rows: 3, value: 'Every\nFriday\n7pm' },
        { key: 'line', label: 'Small line', value: 'Every minute on the gym floor counts.' },
        { key: 'signoff', label: 'Sign-off', value: 'Earned, not given.' },
    ],
    fill: {
        event: (ev) => ({
            headline: twoLines(ev.name, 8),
            left: ev.venue ? ['At', ev.venue, ev.city].filter(Boolean).join('\n') : 'In the\nPOWR\napp',
            right: ev.night ? `${ev.weekdayLong}\n${ev.day} ${ev.month}\n${ev.time12}` : `${ev.rangeFrom}\nto\n${ev.rangeTo}`,
        }),
    },
    look: {
        mono: 1, target: 0.24, auto: 0.9, contrast: 0.55, crush: 0.2, fade: 0,
        tint: 'warm', motion: 0, angle: 0, focus: 0.7, vignette: 0.55, grain: 0.55, size: 1, place: 'auto',
    },
    controls: [
        { key: 'place', label: 'Headline position', options: [['auto', 'Auto'], ['top', 'Top'], ['low', 'Low']] },
    ],

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const focus = e.photo({ x: 0, y: 0, w: W, h: H });

        // Footer geometry first — the low headline stacks on top of it.
        const signPx = (shape === 'square' ? 56 : 66) * u;
        const signBase = H - safe.b - 4 * u;
        const linePx = (shape === 'square' ? 32 : 37) * u;
        const lineBase = signBase - signPx * 0.74 - 30 * u;
        const lineTop = lineBase - linePx * 0.72;

        // Headline — about three-quarters of the width, never more than a
        // third of the height, whatever the font.
        const lines = splitLines(e.caps(e.fields.headline)).slice(0, 3);
        const size = e.look.size ?? 1;
        const maxW = W * 0.76 * size;
        const maxH = H * (shape === 'tall' ? 0.27 : shape === 'square' ? 0.3 : 0.31) * size;
        const block = fitBlock(ctx, lines, e.headline, { maxW, maxH, gap: 0.1 });
        const blockH = block.cap + (lines.length - 1) * block.step;

        const cpx = (shape === 'square' ? 30 : 34) * u;
        const lead = 1.04;
        const left = e.caps(e.fields.left);
        const right = e.caps(e.fields.right);
        const colLines = Math.max(splitLines(left).length, splitLines(right).length, 1);
        const colH = cpx * 0.72 + (colLines - 1) * cpx * lead;

        // Two bands the headline can take. 'auto' picks whichever sits
        // farther from the focal point — the subject, usually a face — so the
        // type frames the athlete instead of covering them.
        const bandGap = (shape === 'tall' ? 0.045 : 0.05) * H;
        const highTop = shape === 'tall' ? safe.t + H * 0.095 : shape === 'square' ? H * 0.2 : H * 0.19;
        const lowTop = lineTop - bandGap - blockH;
        const place = e.look.place === 'top' || e.look.place === 'low'
            ? e.look.place
            : Math.abs(focus.y - (highTop + blockH / 2)) >= Math.abs(focus.y - (lowTop + blockH / 2)) ? 'top' : 'low';

        let top;
        let colTop;
        if (place === 'low') {
            top = lowTop;
            colTop = top - bandGap - colH;
        } else {
            top = highTop;
            colTop = top + blockH + (shape === 'tall' ? 0.07 : 0.06) * H;
        }

        // Light falls off top and bottom so the lockup and footer always read.
        e.fade(0, 0, W, H * 0.24, 'top', 0.5);
        if (place === 'low') e.fade(0, H * 0.42, W, H * 0.58, 'bottom', 0.86);
        else e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.78);

        const logoW = 150 * u;
        e.logo(e.ink, W / 2 - logoW / 2, safe.t + 10 * u, logoW);

        e.shade({ x: W / 2 - maxW / 2, y: top, w: maxW, h: blockH }, { ceiling: 0.34 });
        e.mark('headline', blockBox(drawBlock(ctx, block, e.headline, W / 2, top, {
            align: 'center',
            color: e.headlineAccent ? e.accent : e.ink,
            accent: e.accent,
        })));

        // Columns flank the subject beside the headline.
        const colInset = shape === 'square' ? 0.17 : 0.19;
        const colOpts = { align: 'center', tracking: -0.01, color: e.ink, leading: lead };
        const leftW = textWidth(ctx, left, TYPE.groteskB, cpx, -0.01);
        const rightW = textWidth(ctx, right, TYPE.groteskB, cpx, -0.01);
        e.shade({ x: W * colInset - leftW / 2, y: colTop, w: leftW, h: colH }, { ceiling: 0.36, max: 0.66, spread: 1.2 });
        e.shade({ x: W * (1 - colInset) - rightW / 2, y: colTop, w: rightW, h: colH }, { ceiling: 0.36, max: 0.66, spread: 1.2 });
        e.mark('left', drawText(ctx, left, TYPE.groteskB, cpx, W * colInset, colTop + cpx * 0.72, colOpts));
        e.mark('right', drawText(ctx, right, TYPE.groteskB, cpx, W * (1 - colInset), colTop + cpx * 0.72, colOpts));

        // Footer: serif line, then the sign-off in the headline's voice.
        e.mark('signoff', drawText(ctx, e.caps(e.fields.signoff), TYPE.anton, signPx, W / 2, signBase, {
            align: 'center', tracking: 0.012, color: e.accent,
        }));
        e.mark('line', drawText(ctx, e.fields.line, TYPE.serif, linePx, W / 2, lineBase, {
            align: 'center', color: 'rgba(244,241,234,0.92)',
        }));
    },
};
