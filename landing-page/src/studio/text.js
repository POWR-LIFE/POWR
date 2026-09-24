/**
 * Poster typesetting on canvas: tracking, optical (ink) alignment, blocks of
 * display lines fitted to a box, and two bits of inline markup —
 *   _words_  → italic
 *   {words}  → accent colour
 *
 * Tracking is drawn glyph by glyph from prefix widths, so kerning inside the
 * line survives and every browser places glyphs identically (ctx.letterSpacing
 * isn't everywhere yet).
 */

export const fontString = (spec, px, italic = false) =>
    `${italic || spec.style === 'italic' ? 'italic ' : ''}${spec.weight || 400} ${px}px "${spec.family}"`;

/** Split a line into styled runs. */
export function parseLine(raw) {
    const segs = [];
    let cur = { text: '', italic: false, accent: false };
    const push = (next) => {
        if (cur.text) segs.push(cur);
        cur = { text: '', ...next };
    };
    for (const ch of raw) {
        if (ch === '_') push({ italic: !cur.italic, accent: cur.accent });
        else if (ch === '{') push({ italic: cur.italic, accent: true });
        else if (ch === '}') push({ italic: cur.italic, accent: false });
        else cur.text += ch;
    }
    push({});
    return segs;
}

export const splitLines = (text) =>
    String(text ?? '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => l || (i > 0 && i < a.length - 1));

/**
 * Metrics for one line at `px`: `advance` is the pen width (tracking
 * included), `inkL`/`inkR` the painted extent relative to the pen start —
 * aligning on ink keeps a 300 px "W" flush with a margin instead of hanging
 * off it by its side bearing.
 */
// Pen offset of glyph i inside a run: the width up to and including it,
// minus its own width — so the kern with the glyph before it is kept.
const glyphX = (ctx, chars, i) =>
    ctx.measureText(chars.slice(0, i + 1).join('')).width - ctx.measureText(chars[i]).width;

// Measuring is the expensive part of setting type (tracked lines measure every
// prefix), and video re-renders the same words 30 times a second — so
// measurements are memoised by font + text. Fonts are loaded before the first
// render (prepareStudio), so a fallback face can never be cached.
const memo = new Map();
const remember = (key, fn) => {
    let v = memo.get(key);
    if (v === undefined) {
        if (memo.size > 5000) memo.clear();
        v = fn();
        memo.set(key, v);
    }
    return v;
};

// Glyph pen offsets + width of one run, in one font.
const runLayout = (ctx, font, text) => remember(`run|${font}|${text}`, () => {
    ctx.font = font;
    const chars = [...text];
    return { chars, xs: chars.map((_, i) => glyphX(ctx, chars, i)), width: ctx.measureText(text).width };
});

export function lineMetrics(ctx, segs, spec, px, tracking = 0) {
    const key = `lm|${fontString(spec, px)}|${tracking}|${segs.map((g) => `${g.italic ? 'i' : ''}${g.accent ? 'a' : ''}:${g.text}`).join('\u0001')}`;
    return remember(key, () => measureLine(ctx, segs, spec, px, tracking));
}

function measureLine(ctx, segs, spec, px, tracking) {
    const tp = tracking * px;
    let pen = 0;
    let inkL = Infinity;
    let inkR = -Infinity;
    let ascent = 0;
    let descent = 0;
    for (const seg of segs) {
        ctx.font = fontString(spec, px, seg.italic);
        if (tp) {
            const chars = [...seg.text];
            chars.forEach((ch, i) => {
                if (ch === ' ') return;
                const x = pen + glyphX(ctx, chars, i) + i * tp;
                const m = ctx.measureText(ch);
                inkL = Math.min(inkL, x - m.actualBoundingBoxLeft);
                inkR = Math.max(inkR, x + m.actualBoundingBoxRight);
                ascent = Math.max(ascent, m.actualBoundingBoxAscent);
                descent = Math.max(descent, m.actualBoundingBoxDescent);
            });
            pen += ctx.measureText(seg.text).width + tp * chars.length;
        } else {
            const m = ctx.measureText(seg.text);
            if (seg.text.trim()) {
                inkL = Math.min(inkL, pen - m.actualBoundingBoxLeft);
                inkR = Math.max(inkR, pen + m.actualBoundingBoxRight);
            }
            ascent = Math.max(ascent, m.actualBoundingBoxAscent);
            descent = Math.max(descent, m.actualBoundingBoxDescent);
            pen += m.width;
        }
    }
    if (tp && segs.length) pen -= tp; // no tracking after the last glyph
    if (!Number.isFinite(inkL)) { inkL = 0; inkR = pen; }
    return { advance: pen, inkL, inkR, inkW: inkR - inkL, ascent, descent };
}

/** Paint a line with its pen at (x, baseline). */
export function paintLine(ctx, segs, spec, px, x, y, { tracking = 0, color, accent }) {
    const tp = tracking * px;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let pen = x;
    for (const seg of segs) {
        ctx.font = fontString(spec, px, seg.italic);
        ctx.fillStyle = seg.accent && accent ? accent : color;
        if (!tp) {
            ctx.fillText(seg.text, pen, y);
            pen += ctx.measureText(seg.text).width;
            continue;
        }
        const run = runLayout(ctx, ctx.font, seg.text);
        run.chars.forEach((ch, i) => ctx.fillText(ch, pen + run.xs[i] + i * tp, y));
        pen += run.width + tp * run.chars.length;
    }
}

/** Cap height of a face at px — posters align on caps, not on the em box. */
export function capHeight(ctx, spec, px) {
    const font = fontString(spec, px);
    return remember(`cap|${font}`, () => {
        ctx.font = font;
        return ctx.measureText('H').actualBoundingBoxAscent;
    });
}

/**
 * Size a block of lines (one shared size) to fit maxW × maxH. `gap` is the
 * space between lines as a fraction of cap height.
 */
export function fitBlock(ctx, lines, spec, { maxW, maxH = Infinity, tracking = 0, gap = 0.16, max = Infinity }) {
    const ref = 200;
    const segs = lines.map(parseLine);
    const widest = Math.max(1, ...segs.map((s) => lineMetrics(ctx, s, spec, ref, tracking).inkW));
    const cap = capHeight(ctx, spec, ref);
    const n = Math.max(1, lines.length);
    const byW = (ref * maxW) / widest;
    const byH = (ref * maxH) / (cap * (n + (n - 1) * gap));
    const px = Math.min(byW, byH, max);
    return { px, cap: (cap * px) / ref, step: ((cap * px) / ref) * (1 + gap), segs };
}

/**
 * Draw lines whose first cap-top sits at `top`. `align` is 'left' | 'right'
 * | 'center' against x, on ink; 'stagger' puts the first line left at x and
 * the rest right at x2. Returns each line's box.
 */
export function drawBlock(ctx, block, spec, x, top, { align = 'left', x2, tracking = 0, color, accent, perLine }) {
    const boxes = [];
    block.segs.forEach((segs, i) => {
        const m = lineMetrics(ctx, segs, spec, block.px, tracking);
        const baseline = top + block.cap + i * block.step;
        let a = align;
        let ax = x;
        if (align === 'stagger') { a = i === 0 ? 'left' : 'right'; ax = i === 0 ? x : x2; }
        const pen = a === 'left' ? ax - m.inkL : a === 'right' ? ax - m.inkR : ax - (m.inkL + m.inkR) / 2;
        const lineColor = perLine?.[i] ?? color;
        paintLine(ctx, segs, spec, block.px, pen, baseline, { tracking, color: lineColor, accent });
        boxes.push({ x: pen + m.inkL, y: baseline - block.cap, w: m.inkW, h: block.cap, baseline });
    });
    return boxes;
}

/** The smallest box holding both (either may be null). */
export const unionBox = (a, b) => {
    if (!a) return b ?? null;
    if (!b) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * Small text: one size, baseline-stepped, no fitting. Returns the painted
 * ink box (null if nothing was drawn) — the editor outlines it while the
 * field is being edited.
 */
export function drawText(ctx, text, spec, px, x, y, { align = 'left', tracking = 0, color, accent, leading = 1.25, upper = false } = {}) {
    const lines = splitLines(upper ? String(text).toUpperCase() : text);
    let box = null;
    lines.forEach((line, i) => {
        const segs = parseLine(line);
        const m = lineMetrics(ctx, segs, spec, px, tracking);
        const pen = align === 'left' ? x : align === 'right' ? x - m.advance : x - m.advance / 2;
        const baseline = y + i * px * leading;
        paintLine(ctx, segs, spec, px, pen, baseline, { tracking, color, accent });
        if (line.trim()) box = unionBox(box, { x: pen + m.inkL, y: baseline - m.ascent, w: m.inkW, h: m.ascent + m.descent });
    });
    return box;
}

/** Union of the per-line boxes drawBlock returns. */
export const blockBox = (boxes) => boxes.reduce((acc, b) => unionBox(acc, b), null);

/** Width of the widest line of small text. */
export function textWidth(ctx, text, spec, px, tracking = 0) {
    return Math.max(0, ...splitLines(text).map((l) => lineMetrics(ctx, parseLine(l), spec, px, tracking).advance));
}
