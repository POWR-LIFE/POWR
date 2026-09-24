/**
 * BLEED — type as big as the frame. Each headline line is set to fill the
 * width between the margins, edge to edge, then bent with a perspective or
 * bulge warp; a small stacked caption answers it low down. Every letter stays
 * whole in every warp and size. After the "Do the work" poster — the look,
 * not the copy.
 */
import { TYPE } from '../fonts';
import { drawText, splitLines, parseLine, lineMetrics, paintLine, capHeight } from '../text';

let sheet = null; // offscreen canvas the headline is set on before it's warped

export default {
    id: 'bleed',
    name: 'Bleed',
    category: 'Brand',
    blurb: 'Type as big as the frame — each line fills the width, edge to edge, and bends in perspective.',
    refs: 'Do the Work',
    headlineFont: 'heavy',
    fields: [
        { key: 'headline', label: 'Headline', rows: 2, value: 'Every\nmove', hint: 'One or two short words per line — each line is sized to fill the width.' },
        { key: 'caption', label: 'Caption', rows: 3, value: 'Counts.\nEarned,\nnot given.' },
        { key: 'credit', label: 'Corner credit', value: 'powr.life ©' },
    ],
    presets: [
        { name: 'Every move', fields: { headline: 'Every\nmove', caption: 'Counts.\nEarned,\nnot given.' } },
        { name: 'Show up', fields: { headline: 'Show\nup', caption: 'The streak\nis yours.' } },
        { name: 'Gym floor', fields: { headline: 'Gym\nfloor', caption: 'Nobody\nowned it.\nUntil now.' } },
    ],
    look: {
        mono: 1, target: 0.3, auto: 0.85, contrast: 0.5, crush: 0.15, fade: 0,
        tint: 'cool', motion: 0.15, angle: 0, focus: 0.7, vignette: 0.35, grain: 0.55, size: 1, warp: 'perspective',
    },
    controls: [
        { key: 'warp', label: 'Type warp', options: [['perspective', 'Perspective'], ['bulge', 'Bulge'], ['none', 'Flat']] },
    ],

    draw(e) {
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.36, 'top', 0.38);
        e.fade(0, H * 0.7, W, H * 0.3, 'bottom', 0.55);

        // ── Headline: each line wider than the frame, stacked tight ────────
        const size = e.look.size ?? 1;
        const banner = shape === 'wide' || shape === 'strip';
        // Banners are wide enough to run the headline as one line.
        const lines = banner
            ? [splitLines(e.caps(e.fields.headline)).join(' ')]
            : splitLines(e.caps(e.fields.headline)).slice(0, 3);
        const spec = e.headline;
        const ref = 200;
        const refCap = capHeight(ctx, spec, ref);
        // Each line fills the width between the margins; a bigger headline
        // size can take it out to the edges, never past them.
        const span = Math.min(W - 16 * u, (W - safe.l - safe.r) * size);
        const set = lines.map((raw) => {
            const segs = parseLine(raw);
            const m = lineMetrics(ctx, segs, spec, ref, -0.01);
            const px = (ref * span) / Math.max(1, m.inkW);
            return { segs, px, cap: (refCap * px) / ref };
        });
        // The warps only stretch the type downwards (anchored at the top), by
        // up to `stretch` — the block is sized so that, warped, it still sits
        // inside its share of the frame and never swallows the photo.
        const warp = e.look.warp ?? 'perspective';
        const scaleAt = (t) => (warp === 'perspective' ? 0.8 + 0.44 * t : warp === 'bulge' ? 0.86 + 0.3 * Math.sin(Math.PI * t) : 1);
        const stretch = warp === 'perspective' ? 1.24 : warp === 'bulge' ? 1.16 : 1;
        const maxBlock = (H * (tall ? 0.38 : sq ? 0.5 : shape === 'strip' ? 0.6 : shape === 'wide' ? 0.44 : 0.48)) / stretch;
        const rawH = set.reduce((s, l) => s + l.cap, 0) + (set.length - 1) * 0.06 * (set[0]?.cap ?? 0);
        const k = rawH > maxBlock ? maxBlock / rawH : 1;
        set.forEach((l) => { l.px *= k; l.cap *= k; });
        const gap = 0.06 * (set[0]?.cap ?? 0);
        const blockH = set.reduce((s, l) => s + l.cap, 0) + (set.length - 1) * gap;

        sheet ??= document.createElement('canvas');
        // Room above the first cap line for round letters' overshoot (O, S, G),
        // and below the last for anything under the baseline.
        const lift = Math.ceil((set[0]?.cap ?? 0) * 0.08);
        const pad = Math.ceil(blockH * 0.12);
        sheet.width = W;
        sheet.height = Math.max(1, Math.ceil(lift + blockH + pad));
        const sctx = sheet.getContext('2d');
        sctx.clearRect(0, 0, sheet.width, sheet.height);
        let yy = lift;
        for (const l of set) {
            const m = lineMetrics(sctx, l.segs, spec, l.px, -0.01);
            paintLine(sctx, l.segs, spec, l.px, W / 2 - (m.inkL + m.inkR) / 2, yy + l.cap, {
                tracking: -0.01, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent,
            });
            yy += l.cap + gap;
        }

        // Warp by redrawing the set type in thin vertical strips, each
        // stretched by the warp's scale at that x (anchored at the top, which
        // sits on the safe margin — the tops of the letters are never cut).
        const top = safe.t;
        const warpedH = blockH * stretch;
        // Over a bright photo, darken from the top — only as much as needed.
        e.shade({ x: 0, y: top, w: W, h: warpedH }, { ceiling: 0.34, max: 0.6, form: 'top' });
        const strip = Math.max(1, Math.round(2 * u));
        for (let x = 0; x < W; x += strip) {
            const sc = scaleAt((x + strip / 2) / W);
            ctx.drawImage(sheet, x, 0, strip, sheet.height, x, top - lift * sc, strip, sheet.height * sc);
        }
        e.mark('headline', { x: (W - span) / 2, y: top, w: span, h: warpedH });

        // ── Caption, credit, lockup ────────────────────────────────────────
        const tu = e.tu;
        const capPx = (sq ? 38 : shape === 'strip' ? 30 : 44) * tu;
        // On a strip the caption runs as one line; elsewhere it stacks.
        const caption = shape === 'strip' ? splitLines(e.caps(e.fields.caption)).join(' ') : e.caps(e.fields.caption);
        const capLines = splitLines(caption);
        const capBase = H - safe.b - 8 * tu - (capLines.length - 1) * capPx * 0.98;
        e.mark('caption', drawText(ctx, caption, TYPE.groteskX, capPx, banner ? W - safe.r : W * 0.42, capBase, {
            align: banner ? 'right' : 'left', tracking: -0.01, color: e.ink, leading: 0.98,
        }));
        const logoW = (shape === 'strip' ? 58 : 76) * tu;
        e.logo(e.ink, safe.l + 4 * tu, H - safe.b - logoW * 0.8, logoW);
        // Credit: bottom right under the stacked caption; beside the logo on banners.
        e.mark('credit', drawText(ctx, e.caps(e.fields.credit), TYPE.groteskB, 14 * tu, banner ? safe.l + logoW + 26 * tu : W - safe.r, H - safe.b - (banner ? 4 : 10) * tu, {
            align: banner ? 'left' : 'right', tracking: 0.04, color: 'rgba(244,241,234,0.78)',
        }));
    },
};
