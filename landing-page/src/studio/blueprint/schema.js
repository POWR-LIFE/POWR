/**
 * Blueprint templates — a Studio template written as DATA, not code, so the
 * weekly trend routine can publish one without a deploy. The Studio draws
 * every blueprint with one engine (compile.js); this file only checks and
 * cleans a blueprint, and has no browser code, so the routine runs the SAME
 * check before it stores one (scripts/blueprint-check.mjs).
 *
 * Safe by construction:
 *   - type sits in boxes measured inside the format's safe area, and shrinks
 *     to fit its box — it can't run off the frame or into a reply bar;
 *   - type over a photo is always shaded for legibility;
 *   - type boxes may not overlap each other (checked here, per layout);
 *   - colours are tokens or hex, fonts are the Studio's own kit.
 *
 * A blueprint:
 * {
 *   v: 1, id: 'flood-2026-40' (kebab, unique), name: 'Flood', blurb, trend,
 *   headlineFont: a FONTS key (what the editor's headline-font switch replaces),
 *   fields:  [{ key, label, value, rows?, hint? }]       text only
 *   presets: [{ name, fields: { key: value } }]
 *   look:    grade keys (see LOOK_KEYS) — the photo's grade
 *   swatches: ['#E0115F', …] optional — the trend's colours; the editor offers
 *            them as "Colour" and the token 'flood' follows the choice
 *   layouts: { post: [layer…], wide: [layer…], tall?, square?, strip? }
 *            (tall → post, square → post, strip → wide when missing)
 * }
 *
 * Layers, drawn in order. `box` is [x, y, w, h] as fractions: of the whole
 * frame for photo / fill / fade / stroke (may bleed: −0.2…1.2), of the SAFE
 * AREA for everything that carries type or a mark (0…1). A photo / fill /
 * fade / stroke with `space: 'safe'` is placed in the safe area too, and any
 * edge ON the safe line (0 or 1) bleeds to the frame's edge — so a colour
 * block stays under its type on every size.
 *   photo  { box, zoom?, flood?: true (duotone in the flood colour), main? }
 *   fill   { box, color }                    a flat block
 *   fade   { box, from: top|bottom|left|right, alpha }
 *   stroke { box, color, width }             an outline, width in 1080-px units
 *   text   { field, box, font, color, case?: upper|none, align?: left|center|right,
 *            valign?: top|middle|bottom, tracking?, gap?, maxLines?, size?, wrap? }
 *            no size: the lines fill the box; size (fraction of safe height):
 *            that size, shrunk only if it doesn't fit; wrap: re-wrap to the box
 *   stats  { field, box, font, color, labelColor?, labelScale? }  "412 — Check-ins" lines
 *   stamp  { field, box, color, rotate? }    oval outline with a word, centred in box
 *   chip   { field, box, bg, color, font?, align?: left|right }  solid tag, box = where it may sit
 *   rule   { box, color }                    a thin bar (a fill inside the safe area)
 *   dots   { box, cols, rows, color, r? }    a dot grid
 *   logo   { box, color }                    the POWR mark, fitted in box
 *   qr     { field, box }                    a QR of the field's link
 * Colours: 'accent' | 'ink' | 'dark' | 'paper' | 'flood' | '#rrggbb', each
 * optionally '/0.6' for opacity.
 */

export const FONTS = ['anton', 'grotesk', 'groteskB', 'groteskM', 'groteskX', 'wide', 'heavy', 'shoulders',
    'brand', 'brandB', 'brandSB', 'brandM', 'brandR', 'brandL', 'brandXL', 'mono', 'monoR', 'serif', 'serifI', 'headline'];
export const SHAPES = ['post', 'tall', 'square', 'wide', 'strip'];
export const FALLBACK = { tall: 'post', square: 'post', strip: 'wide', post: 'post', wide: 'wide' };
const FRAME_LAYERS = new Set(['photo', 'fill', 'fade', 'stroke']);
const TYPE_LAYERS = new Set(['text', 'stats', 'stamp', 'chip', 'logo', 'qr']);
const LAYERS = new Set([...FRAME_LAYERS, ...TYPE_LAYERS, 'rule', 'dots']);
export const LOOK_KEYS = {
    mono: [0, 1], target: [0.1, 0.45], auto: [0, 1], contrast: [0, 1], crush: [0, 0.6], fade: [0, 0.5],
    motion: [0, 1], angle: [-90, 90], focus: [0, 1], vignette: [0, 1], grain: [0, 1], tintAmount: [0, 1], exposure: [-1, 1],
};
const TINTS = ['none', 'warm', 'cool', 'gold'];
const HEX = /^#[0-9a-f]{6}$/i;
const COLOR = /^(accent|ink|dark|paper|flood|#[0-9a-f]{6})(\/(0(\.\d+)?|1(\.0+)?))?$/i;

const num = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanBox(b, frame, err, where) {
    if (!Array.isArray(b) || b.length < (frame ? 4 : 3) || b.some((v) => !Number.isFinite(Number(v)))) {
        err(`${where}: box must be [x, y, w, h]`);
        return null;
    }
    const lo = frame ? -0.2 : 0;
    const hi = frame ? 1.2 : 1;
    let [x, y, w, h = w] = b.map(Number);
    x = num(x, lo, hi, 0);
    y = num(y, lo, hi, 0);
    w = num(w, 0, hi - x, 0);
    h = num(h, 0, hi - y, 0);
    if (w <= 0 || h <= 0) err(`${where}: box has no area`);
    return [x, y, w, h];
}

// Contrast, WCAG-style, on the colour tokens (the accent is POWR yellow;
// a gym's own accent is always lifted to read on dark, see data.js).
const TOKEN_HEX = { accent: '#FACC15', ink: '#F4F1EA', dark: '#111111', paper: '#0E0E0C' };
function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
// Every hex a token can be ('flood' is any of the swatches).
const hexesOf = (token, swatches) => {
    const name = String(token).split('/')[0];
    if (name.startsWith('#')) return [name];
    if (name === 'flood') return swatches.length ? swatches : [TOKEN_HEX.accent];
    return [TOKEN_HEX[name] ?? TOKEN_HEX.ink];
};
// A safe-area box in frame terms isn't known without the format, so blocks
// are compared in their own space: frame blocks against type only when the
// block covers the whole frame, safe blocks directly.
const contains = (outer, inner) => inner[0] >= outer[0] - 0.001 && inner[1] >= outer[1] - 0.001
    && inner[0] + inner[2] <= outer[0] + outer[2] + 0.001 && inner[1] + inner[3] <= outer[1] + outer[3] + 0.001;

const overlap = (a, b) => {
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min(a[2] * a[3], b[2] * b[3]);
};

/** Check and clean a blueprint. Returns { ok, errors, blueprint }. */
export function checkBlueprint(input) {
    const errors = [];
    const err = (m) => errors.push(m);
    const bp = input && typeof input === 'object' ? input : {};
    if (bp.v !== 1) err('v must be 1');
    const id = str(bp.id, 60);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) err('id must be kebab-case');
    const name = str(bp.name, 28).trim();
    if (!name) err('name is required');

    const fields = (Array.isArray(bp.fields) ? bp.fields : []).slice(0, 10).map((f, i) => {
        const key = str(f?.key, 24);
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) err(`fields[${i}]: key must be alphanumeric`);
        return {
            key,
            label: str(f?.label, 48) || key,
            value: str(f?.value, 400),
            ...(f?.rows ? { rows: num(f.rows, 1, 6, 1) } : {}),
            ...(f?.hint ? { hint: str(f.hint, 160) } : {}),
        };
    });
    const keys = new Set(fields.map((f) => f.key));
    if (!fields.length) err('at least one field');
    if (keys.size !== fields.length) err('field keys must be unique');

    const presets = (Array.isArray(bp.presets) ? bp.presets : []).slice(0, 6).map((p) => ({
        name: str(p?.name, 32),
        fields: Object.fromEntries(Object.entries(p?.fields ?? {}).filter(([k]) => keys.has(k)).map(([k, v]) => [k, str(v, 400)])),
    })).filter((p) => p.name);

    const look = {};
    for (const [k, [lo, hi]] of Object.entries(LOOK_KEYS)) if (bp.look?.[k] !== undefined) look[k] = num(bp.look[k], lo, hi, lo);
    if (bp.look?.tint !== undefined) look.tint = TINTS.includes(bp.look.tint) ? bp.look.tint : 'none';
    if (bp.look?.motionAuto === false) look.motionAuto = false;

    const swatches = (Array.isArray(bp.swatches) ? bp.swatches : []).filter((h) => HEX.test(h)).slice(0, 6);
    const headlineFont = FONTS.includes(bp.headlineFont) && bp.headlineFont !== 'headline' ? bp.headlineFont : 'anton';

    const layouts = {};
    for (const shape of SHAPES) {
        const raw = bp.layouts?.[shape];
        if (raw === undefined) continue;
        if (!Array.isArray(raw) || !raw.length) { err(`layouts.${shape} must be a list of layers`); continue; }
        const layers = [];
        raw.slice(0, 28).forEach((L, i) => {
            const where = `layouts.${shape}[${i}]`;
            const type = L?.type;
            if (!LAYERS.has(type)) { err(`${where}: unknown layer type ${JSON.stringify(type)}`); return; }
            const safeSpace = L.space === 'safe';
            const box = cleanBox(L.box, FRAME_LAYERS.has(type) && !safeSpace, err, where);
            if (!box) return;
            const out = { type, box };
            if (safeSpace && FRAME_LAYERS.has(type)) out.space = 'safe';
            const color = (k, d) => {
                const c = L[k] ?? d;
                if (!COLOR.test(String(c))) err(`${where}: ${k} ${JSON.stringify(c)} is not a colour`);
                out[k] = String(c);
            };
            if ('field' in L || ['text', 'stats', 'stamp', 'chip', 'qr'].includes(type)) {
                if (!keys.has(L.field)) err(`${where}: field ${JSON.stringify(L.field)} is not one of the fields`);
                out.field = L.field;
            }
            if (['text', 'stats', 'chip'].includes(type)) {
                const f = L.font ?? 'headline';
                if (!FONTS.includes(f)) err(`${where}: font ${JSON.stringify(f)} is not in the kit`);
                out.font = f;
            }
            switch (type) {
            case 'photo':
                out.zoom = num(L.zoom, 1, 5, 1);
                if (L.flood) out.flood = true;
                if (L.main === false) out.main = false;
                break;
            case 'fill': case 'rule': color('color', 'dark'); break;
            case 'fade':
                out.from = ['top', 'bottom', 'left', 'right'].includes(L.from) ? L.from : 'bottom';
                out.alpha = num(L.alpha, 0, 1, 0.6);
                break;
            case 'stroke': color('color', 'ink'); out.width = num(L.width, 1, 40, 3); break;
            case 'text':
                color('color', 'ink');
                out.case = L.case === 'upper' ? 'upper' : 'none';
                out.align = ['left', 'center', 'right'].includes(L.align) ? L.align : 'left';
                out.valign = ['top', 'middle', 'bottom'].includes(L.valign) ? L.valign : 'top';
                out.tracking = num(L.tracking, -0.06, 0.4, 0);
                out.gap = num(L.gap, 0, 0.8, 0.16);
                out.maxLines = num(L.maxLines, 1, 6, 3);
                if (L.size !== undefined) out.size = num(L.size, 0.008, 0.3, 0.03);
                if (L.wrap) out.wrap = true;
                break;
            case 'stats':
                color('color', 'ink');
                color('labelColor', L.color ?? 'ink');
                out.labelScale = num(L.labelScale, 0.25, 0.8, 0.5);
                break;
            case 'stamp': color('color', 'accent'); out.rotate = num(L.rotate, -30, 30, -8); break;
            case 'chip':
                color('bg', 'accent');
                color('color', 'dark');
                out.align = L.align === 'right' ? 'right' : 'left';
                break;
            case 'dots':
                color('color', 'ink/0.5');
                out.cols = Math.round(num(L.cols, 2, 24, 6));
                out.rows = Math.round(num(L.rows, 1, 24, 6));
                out.r = num(L.r, 0.02, 0.4, 0.08);
                break;
            case 'logo': color('color', 'ink'); break;
            default: break;
            }
            layers.push(out);
        });
        // Type may not sit on type.
        const marks = layers.filter((l) => TYPE_LAYERS.has(l.type));
        for (let i = 0; i < marks.length; i++) {
            for (let j = i + 1; j < marks.length; j++) {
                if (overlap(marks[i].box, marks[j].box) > 0.02) err(`layouts.${shape}: ${marks[i].type}(${marks[i].field ?? ''}) overlaps ${marks[j].type}(${marks[j].field ?? ''})`);
            }
        }
        if (!layers.some((l) => l.type === 'logo')) err(`layouts.${shape}: needs the POWR logo`);
        if (!layers.some((l) => l.type === 'text' || l.type === 'stats')) err(`layouts.${shape}: needs some words`);
        // Legibility: what's under each piece of type, and can you read it?
        layers.forEach((t, i) => {
            if (!['text', 'stats'].includes(t.type)) return;
            if (t.box[3] < 0.02) err(`layouts.${shape}: ${t.field} box is too short to read`);
            const under = layers.slice(0, i).reverse().find((l) => (l.type === 'fill' || l.type === 'photo')
                && (l.space === 'safe' || (l.box[0] <= 0 && l.box[1] <= 0 && l.box[2] >= 1 && l.box[3] >= 1)) && contains(l.box, t.box));
            const colours = [t.color, ...(t.labelColor ? [t.labelColor] : [])];
            if (under?.type === 'fill' && !String(under.color).includes('/')) {
                for (const tc of colours) for (const a of hexesOf(tc, swatches)) for (const b of hexesOf(under.color, swatches)) {
                    if (ratio(a, b) < 3) err(`layouts.${shape}: ${t.field} (${tc}) on ${under.color} is hard to read (contrast ${ratio(a, b).toFixed(1)}:1, needs 3)`);
                }
            } else if (under?.type === 'photo' || !under) {
                // On a photo the Studio shades behind the type — so it must be light.
                for (const tc of colours) for (const a of hexesOf(tc, swatches)) {
                    if (lum(a) < 0.35) err(`layouts.${shape}: ${t.field} is dark type on a photo — use ink or a light colour, or put it on a block`);
                }
            }
        });
        // Live video plays every photo UNDER whatever is drawn after the first
        // one, so a block drawn between two photos must not cover the later one.
        const firstPhoto = layers.findIndex((l) => l.type === 'photo');
        layers.forEach((l, i) => {
            if (l.type !== 'photo' || i <= firstPhoto) return;
            for (let k = firstPhoto + 1; k < i; k++) {
                const m = layers[k];
                if (['fill', 'stroke', 'fade'].includes(m.type) && overlap(m.box, l.box) > 0.02) {
                    err(`layouts.${shape}: ${m.type} before photo ${i} covers it on video — draw it after, or as a stroke outside`);
                }
            }
        });
        layouts[shape] = layers;
    }
    if (!layouts.post) err('layouts.post is required');
    if (!layouts.wide) err('layouts.wide is required');
    // A flood photo needs a flood colour.
    const usesFlood = JSON.stringify(layouts).includes('flood');
    if (usesFlood && !swatches.length) err('uses the flood colour but has no swatches');

    return {
        ok: errors.length === 0,
        errors,
        blueprint: {
            v: 1, id, name, blurb: str(bp.blurb, 160), trend: str(bp.trend, 80), headlineFont,
            fields, presets, look, swatches, layouts,
        },
    };
}
