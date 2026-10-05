/**
 * Draws a blueprint (schema.js) as a Studio template: the same env, grade,
 * type kit and editor features as the hand-built templates — field outlines,
 * presets, headline-font switch, video — from data. Every blueprint template
 * sits in the picker's "Trending" group.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, blockBox, wrapLines, unionBox, textWidth } from '../text';
import { drawQR } from '../qr';
import { dot } from '../shapes';
import { parseStats } from '../templates/tally';
import { checkBlueprint, FALLBACK } from './schema';

const BASE = { ink: '#F4F1EA', dark: '#111111', paper: '#0E0E0C' };

function colour(token, e, flood) {
    const [name, a] = String(token).split('/');
    const hex = name.startsWith('#') ? name : name === 'accent' ? e.accent : name === 'flood' ? flood : BASE[name] ?? BASE.ink;
    if (a === undefined) return hex;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Number(a)})`;
}

const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawLayout(e, bp, layers) {
    const { ctx, W, H, safe } = e;
    const sw = W - safe.l - safe.r;
    const sh = H - safe.t - safe.b;
    const flood = e.look.flood || bp.swatches[0] || e.accent;
    const frame = ([x, y, w, h]) => ({ x: x * W, y: y * H, w: w * W, h: h * H });
    const inSafe = ([x, y, w, h]) => ({ x: safe.l + x * sw, y: safe.t + y * sh, w: w * sw, h: h * sh });
    // Blocks placed in the safe area bleed wherever they touch its edge.
    const bled = (L) => {
        if (L.space !== 'safe') return frame(L.box);
        const [x, y, w, h] = L.box;
        const r = inSafe(L.box);
        const x0 = x <= 0.001 ? 0 : r.x;
        const y0 = y <= 0.001 ? 0 : r.y;
        const x1 = x + w >= 0.999 ? W : r.x + r.w;
        const y1 = y + h >= 0.999 ? H : r.y + r.h;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const font = (f) => (f === 'headline' ? e.headline : TYPE[f] ?? e.headline);
    const photos = [];
    const blocks = []; // solid fills drawn after a photo: type on them needs no shading
    let first = true;

    // Type over a photo gets the same legibility shading as every template,
    // unless a solid block already sits between it and the photo.
    const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
    const shadeIfOverPhoto = (r) => {
        if (blocks.some((b) => inside(r, b))) return;
        if (photos.some((p) => hits(p, r))) e.shade(r, { ceiling: 0.3, max: 0.62 });
    };

    for (const L of layers) {
        const c = (k) => colour(L[k], e, flood);
        switch (L.type) {
        case 'photo': {
            const r = bled(L);
            e.photo(r, L.flood ? { tintHex: flood, mono: 1 } : {}, { zoom: L.zoom, main: L.main ?? first });
            first = false;
            photos.push(r);
            break;
        }
        case 'fill': {
            const r = bled(L);
            ctx.fillStyle = c('color');
            ctx.fillRect(r.x, r.y, r.w, r.h);
            if (!String(L.color).includes('/')) blocks.push(r);
            break;
        }
        case 'fade': {
            const r = bled(L);
            e.fade(r.x, r.y, r.w, r.h, L.from, L.alpha);
            break;
        }
        case 'stroke': {
            const r = bled(L);
            const lw = L.width * e.u;
            ctx.strokeStyle = c('color');
            ctx.lineWidth = lw;
            ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);
            break;
        }
        case 'rule': {
            const r = inSafe(L.box);
            ctx.fillStyle = c('color');
            ctx.fillRect(r.x, r.y, r.w, Math.max(1, r.h));
            break;
        }
        case 'dots': {
            const r = inSafe(L.box);
            const cw = r.w / Math.max(1, L.cols - 1);
            const ch = L.rows > 1 ? r.h / (L.rows - 1) : 0;
            const rad = Math.min(cw, ch || cw) * L.r * 0.5;
            for (let i = 0; i < L.cols; i++) for (let j = 0; j < L.rows; j++) dot(ctx, r.x + i * cw, r.y + j * ch, rad, c('color'));
            break;
        }
        case 'text': {
            const r = inSafe(L.box);
            const spec = font(L.font);
            const raw = String(e.fields[L.field] ?? '');
            const text = L.case === 'upper' ? raw.toUpperCase() : raw;
            if (!text.trim()) break;
            let lines;
            let max = Infinity;
            if (L.size !== undefined) max = L.size * sh;
            if (L.wrap) {
                // Running text: wrap at the set size, smaller until it fits the box.
                let px = L.size !== undefined ? max : sh * 0.03;
                for (let k = 0; k < 12; k++) {
                    lines = wrapLines(ctx, text, spec, px, r.w, L.maxLines, L.tracking);
                    const h = px * (1 + (lines.length - 1) * 1.28);
                    if (h <= r.h) break;
                    px *= 0.9;
                }
                max = px;
            } else {
                lines = splitLines(text).slice(0, L.maxLines);
            }
            const block = fitBlock(ctx, lines, spec, { maxW: r.w, maxH: r.h, tracking: L.tracking, gap: L.wrap ? 0.55 : L.gap, max });
            const blockH = block.cap + (lines.length - 1) * block.step;
            const top = L.valign === 'bottom' ? r.y + r.h - blockH : L.valign === 'middle' ? r.y + (r.h - blockH) / 2 : r.y;
            const x = L.align === 'right' ? r.x + r.w : L.align === 'center' ? r.x + r.w / 2 : r.x;
            shadeIfOverPhoto({ x: r.x, y: top, w: r.w, h: blockH });
            const boxes = drawBlock(ctx, block, spec, x, top, { align: L.align, tracking: L.tracking, color: c('color'), accent: e.accent });
            e.mark(L.field, blockBox(boxes));
            break;
        }
        case 'stats': {
            const r = inSafe(L.box);
            const stats = parseStats(e.fields[L.field]);
            if (!stats.length) break;
            const spec = font(L.font);
            const gap = r.w * 0.04;
            const colW = (r.w - gap * (stats.length - 1)) / stats.length;
            let px = r.h / (1 + L.labelScale * 1.3);
            for (const s of stats) {
                const vw = textWidth(ctx, s.value, spec, px, -0.02);
                if (vw > colW) px *= colW / vw;
            }
            let lpx = px * L.labelScale;
            for (const s of stats) {
                const lw = textWidth(ctx, s.label, spec, lpx, -0.01);
                if (lw > colW) lpx *= colW / lw;
            }
            const labelBase = r.y + r.h;
            const numBase = labelBase - lpx * 1.25;
            shadeIfOverPhoto(r);
            let box = null;
            stats.forEach((s, i) => {
                const x = r.x + i * (colW + gap);
                box = unionBox(box, drawText(ctx, s.value, spec, px, x, numBase, { tracking: -0.02, color: c('color') }));
                box = unionBox(box, drawText(ctx, s.label, spec, lpx, x, labelBase, { tracking: -0.01, color: c('labelColor') }));
            });
            e.mark(L.field, box);
            break;
        }
        case 'stamp': {
            const r = inSafe(L.box);
            const t = String(e.fields[L.field] ?? '').trim().toUpperCase();
            if (!t) break;
            const rx = r.w / 2;
            const ry = Math.min(r.h / 2, rx * 0.56);
            ctx.save();
            ctx.translate(r.x + rx, r.y + r.h / 2);
            ctx.rotate((L.rotate * Math.PI) / 180);
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(14,14,12,0.45)';
            ctx.fill();
            ctx.strokeStyle = c('color');
            ctx.lineWidth = Math.max(1, rx * 0.035);
            ctx.stroke();
            let px = ry * 0.5;
            const tw = textWidth(ctx, t, TYPE.grotesk, px, 0.1);
            if (tw > rx * 1.4) px *= (rx * 1.4) / tw;
            drawText(ctx, t, TYPE.grotesk, px, 0, px * 0.36, { align: 'center', tracking: 0.1, color: c('color') });
            ctx.restore();
            e.mark(L.field, r);
            break;
        }
        case 'chip': {
            const r = inSafe(L.box);
            const t = String(e.fields[L.field] ?? '').trim().toUpperCase();
            if (!t) break;
            const spec = font(L.font);
            let px = r.h / 1.7;
            const padX = px * 0.6;
            const tw = textWidth(ctx, t, spec, px, 0.08);
            if (tw + padX * 2 > r.w) px *= r.w / (tw + padX * 2);
            const w = textWidth(ctx, t, spec, px, 0.08) + padX * 2;
            const h = px * 1.7;
            const x = L.align === 'right' ? r.x + r.w - w : r.x;
            ctx.fillStyle = c('bg');
            ctx.fillRect(x, r.y, w, h);
            e.mark(L.field, drawText(ctx, t, spec, px, x + padX, r.y + h * 0.5 + px * 0.36, { tracking: 0.08, color: c('color') }));
            break;
        }
        case 'logo': {
            const r = inSafe(L.box);
            // The mark is ~1.39:1; fit it inside the box, top-left.
            const w = Math.min(r.w, r.h * 1.39);
            e.logo(c('color'), r.x, r.y, w);
            break;
        }
        case 'qr': {
            const r = inSafe(L.box);
            const s = Math.min(r.w, r.h);
            drawQR(ctx, String(e.fields[L.field] ?? '').trim(), r.x, r.y, s);
            e.mark(L.field, { x: r.x, y: r.y, w: s, h: s });
            break;
        }
        default: break;
        }
    }
}

/** A blueprint → a Studio template object, or null if it doesn't check out. */
export function compileBlueprint(input, extra = {}) {
    const { ok, blueprint: bp, errors } = checkBlueprint(input);
    if (!ok) {
        console.warn(`Blueprint ${input?.id ?? '?'} rejected:`, errors);
        return null;
    }
    const controls = bp.swatches.length > 1
        ? [{ key: 'flood', label: 'Colour', options: bp.swatches.map((h, i) => [h, `Colour ${i + 1}`]) }]
        : [];
    return {
        id: bp.id,
        name: bp.name,
        category: 'Trending',
        blurb: bp.blurb || `After this week’s trend: ${bp.trend}.`,
        refs: bp.trend ? `the ${bp.trend.toLowerCase()} trend` : 'this week’s trends',
        headlineFont: bp.headlineFont,
        fields: bp.fields,
        presets: bp.presets,
        look: {
            mono: 1, target: 0.28, auto: 0.85, contrast: 0.5, crush: 0.1, fade: 0,
            tint: 'none', motion: 0, angle: 0, focus: 0.6, vignette: 0.35, grain: 0.5, size: 1,
            ...bp.look,
            ...(bp.swatches.length ? { flood: bp.swatches[0] } : {}),
        },
        controls,
        blueprint: bp,
        ...extra,
        draw(e) {
            const layers = bp.layouts[e.shape] ?? bp.layouts[FALLBACK[e.shape]] ?? bp.layouts.post;
            drawLayout(e, bp, layers);
        },
    };
}

