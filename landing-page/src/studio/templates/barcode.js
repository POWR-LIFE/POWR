/**
 * BARCODE — a label over the photo: a few condensed words spread edge to edge
 * across the frame, a typewriter line spread the same way under them, a short
 * paragraph, and a barcode standing up beside the text — all in the accent
 * colour. The barcode is a real EAN-13 of the number you give it. After the
 * "No Finish Line" poster — the look, not the copy.
 */
import { TYPE } from '../fonts';
import { splitLines, parseLine, lineMetrics, paintLine, capHeight, drawText, textWidth, wrapLines, unionBox } from '../text';

// EAN-13: each digit's left-hand (L or G) and right-hand (R) patterns; the
// first digit sets which of L/G the next six use.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const G = R.map((p) => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Up to twelve digits → a real EAN-13, check digit added: { digits, bits } (95 modules). */
export function ean13(input) {
    const given = String(input ?? '').replace(/\D/g, '').slice(0, 12);
    if (!given) return null;
    const d = given.padEnd(12, '0');
    const sum = [...d].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
    const digits = d + ((10 - (sum % 10)) % 10);
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (PARITY[+digits[0]][i - 1] === 'L' ? L : G)[+digits[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[+digits[i]];
    return { digits, bits: `${bits}101` };
}

// The bars run across `box` (so the code reads top to bottom), the digits
// stand beside them reading upwards, as on the poster.
function drawBarcode(e, code, box, digitPx) {
    const { ctx } = e;
    const m = box.h / code.bits.length;
    ctx.save();
    ctx.fillStyle = e.accent;
    for (let k = 0; k < code.bits.length;) {
        if (code.bits[k] !== '1') { k++; continue; }
        let j = k;
        while (j < code.bits.length && code.bits[j] === '1') j++;
        ctx.fillRect(box.x, box.y + k * m, box.w, (j - k) * m);
        k = j;
    }
    const tracking = 0.12;
    const px = Math.min(digitPx, (digitPx * box.h) / Math.max(1, textWidth(ctx, code.digits, TYPE.monoR, digitPx, tracking)));
    const cap = capHeight(ctx, TYPE.monoR, px);
    ctx.translate(box.x + box.w + cap * 0.8 + cap, box.y + box.h);
    ctx.rotate(-Math.PI / 2);
    drawText(ctx, code.digits, TYPE.monoR, px, 0, 0, { tracking, color: e.accent });
    ctx.restore();
    e.mark('code', { x: box.x, y: box.y, w: box.w + cap * 1.8, h: box.h });
}

// A row's pieces: lines if it has line breaks, "·"- or "/"-separated
// phrases, otherwise single words.
function piecesOf(text) {
    const t = String(text ?? '').trim();
    const parts = t.includes('\n') ? splitLines(t) : /\s[·|/]\s/.test(t) ? t.split(/\s[·|/]\s/) : t.split(/\s+/);
    return parts.map((s) => s.trim()).filter(Boolean);
}

// Pieces spread edge to edge across [x0, x1] with equal gaps (a lone piece
// centres); shrinks to fit if they'd crowd. Returns the row's ink box.
function spread(e, key, text, spec, px, x0, x1, baseline, { tracking = 0, minGap }) {
    const { ctx } = e;
    const pieces = piecesOf(text);
    if (!pieces.length) return null;
    const measure = (size) => pieces.map((p) => lineMetrics(ctx, parseLine(p), spec, size, tracking));
    let size = px;
    let ms = measure(size);
    const ink = ms.reduce((s, m) => s + m.inkW, 0);
    const room = x1 - x0 - minGap * (pieces.length - 1);
    if (ink > room) {
        size *= room / ink;
        ms = measure(size);
    }
    const total = ms.reduce((s, m) => s + m.inkW, 0);
    const gap = pieces.length > 1 ? (x1 - x0 - total) / (pieces.length - 1) : 0;
    const cap = capHeight(ctx, spec, size);
    let x = pieces.length > 1 ? x0 : (x0 + x1 - total) / 2;
    let box = null;
    pieces.forEach((p, i) => {
        paintLine(ctx, parseLine(p), spec, size, x - ms[i].inkL, baseline, { tracking, color: e.accent, accent: e.accent });
        box = unionBox(box, { x, y: baseline - cap, w: ms[i].inkW, h: cap });
        x += ms[i].inkW + gap;
    });
    e.mark(key, box);
    return box;
}

export default {
    id: 'barcode',
    name: 'Barcode',
    category: 'Brand',
    blurb: 'Three words spread across the frame, a typewriter line and paragraph under them, and a barcode standing beside them — all in the accent colour.',
    refs: 'No Finish Line',
    headlineFont: 'anton',
    fields: [
        { key: 'title', label: 'Title', value: 'Every move counts', hint: 'Its words spread edge to edge. Separate phrases with · to keep words together.' },
        { key: 'line', label: 'Line', value: 'Gym Run Walk Ride', hint: 'Spread the same way, in the typewriter face.' },
        { key: 'body', label: 'Paragraph', rows: 3, value: 'Your last workout earned you nothing. POWR makes sure it counts. Every gym session, run, walk and ride — rewarded.' },
        { key: 'code', label: 'Barcode number', value: '202609250001', hint: 'Up to twelve digits, drawn as a real EAN-13 (the check digit is added). Empty drops the barcode.' },
    ],
    presets: [
        { name: 'Every move counts', fields: { title: 'Every move counts', line: 'Gym Run Walk Ride', body: 'Your last workout earned you nothing. POWR makes sure it counts. Every gym session, run, walk and ride — rewarded.' } },
        { name: 'Earned, not given', fields: { title: 'Earned, not given', line: 'Show up · Check in · Earn · Repeat', body: 'Every session builds toward something real. The streak matters. The effort pays off.' } },
        { name: 'Gym floor', fields: { title: 'The gym floor', line: 'Tracked · Verified · Rewarded', body: 'The gym is the last uncharted territory in fitness rewards. POWR changes that.' } },
    ],
    look: {
        mono: 1, target: 0.4, auto: 0.8, contrast: 0.32, crush: 0, fade: 0.12,
        tint: 'none', motion: 0.6, angle: -10, focus: 0.5, vignette: 0.3, grain: 0.7, size: 1,
    },

    draw(e) {
        const { ctx, W, H, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const wide = shape === 'wide';
        const strip = shape === 'strip';
        const banner = wide || strip;
        const unit = banner ? e.tu : e.u;
        const size = e.look.size ?? 1;
        e.photo({ x: 0, y: 0, w: W, h: H });

        // ── Columns: the text, then the barcode standing at its right ──────
        const code = ean13(e.fields.code);
        const x0 = Math.max(safe.l, W * (banner ? 0.05 : 0.07));
        const xEnd = W - Math.max(safe.r, W * 0.05);
        const digitPx = (strip ? 13 : 15) * unit;
        // Bars about 0.4× as long as the code is tall, so scanners still read it.
        const barW = code ? (banner ? H * (strip ? 0.17 : 0.12) : W * 0.052) : 0;
        const barX = xEnd - digitPx * 1.6 - barW;
        const x1 = code ? barX - (banner ? W * 0.03 : W * 0.035) : xEnd;

        // ── Rows ───────────────────────────────────────────────────────────
        const titleY = H * (tall ? 0.5 : sq ? 0.47 : wide ? 0.42 : strip ? 0.44 : 0.565);
        const lineY = H * (tall ? 0.69 : sq ? 0.72 : wide ? 0.64 : strip ? 0.8 : 0.795);
        const titlePx = (strip ? 70 : wide ? 64 : sq ? 54 : 60) * unit * size;
        const linePx = (strip ? 26 : wide ? 30 : sq ? 29 : 32) * unit;
        const bodyPx = (wide ? 21 : sq ? 17.5 : 19) * unit;
        const bodyLead = 1.62;

        // Soften a bright photo under the type first (measured, only as much as needed).
        const titleCap = capHeight(ctx, e.headline, titlePx);
        e.shade({ x: x0, y: titleY - titleCap, w: x1 - x0, h: titleCap }, { ceiling: 0.42, max: 0.5, spread: 1.1 });
        // On a wide banner the paragraph keeps to the middle of the column, in two lines.
        const bodyLines = strip ? [] : wrapLines(ctx, e.fields.body, TYPE.monoR, bodyPx, (x1 - x0) * (wide ? 0.62 : 1), wide ? 2 : 4, 0.02);
        const bodyFirst = lineY + linePx * 0.35 + bodyPx * 2.1;
        const blockBottom = bodyLines.length ? bodyFirst + (bodyLines.length - 1) * bodyPx * bodyLead + bodyPx * 0.3 : lineY;
        const lineTop = lineY - capHeight(ctx, TYPE.monoR, linePx);
        e.shade({ x: x0, y: lineTop, w: xEnd - x0, h: blockBottom - lineTop }, { ceiling: 0.42, max: 0.5, spread: 1.05 });

        // Title: condensed caps, inset a little from the text column on the left.
        spread(e, 'title', e.caps(e.fields.title), e.headline, titlePx, x0 + (x1 - x0) * (banner ? 0.04 : 0.08), x1, titleY, { tracking: 0.01, minGap: 30 * unit });
        // The typewriter line, edge to edge across the column.
        spread(e, 'line', e.fields.line, TYPE.monoR, linePx, x0, x1, lineY, { tracking: 0.02, minGap: 24 * unit });
        // The paragraph, centred under it.
        if (bodyLines.length) {
            e.mark('body', drawText(ctx, bodyLines.join('\n'), TYPE.monoR, bodyPx, (x0 + x1) / 2, bodyFirst, {
                align: 'center', tracking: 0.02, color: e.accent, leading: bodyLead,
            }));
        }

        // Barcode: from the top of the line to the bottom of the paragraph
        // (from the title to the line on a strip).
        if (code) {
            const top = strip ? titleY - titleCap : lineTop;
            const bottom = Math.max(blockBottom, top + (banner ? H * 0.3 : H * 0.09));
            drawBarcode(e, code, { x: barX, y: top, w: barW, h: bottom - top }, digitPx);
        }

        // The POWR mark, small and quiet, top left.
        const logoW = (strip ? 52 : 64) * unit;
        e.logo(e.ink, x0, safe.t + (tall ? 10 : 4) * unit, logoW);
    },
};
