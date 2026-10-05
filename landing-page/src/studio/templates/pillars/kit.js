/**
 * Shared by the four pillar libraries — Move · Eat · Mind · Sleep, the same
 * four categories a partner's reward sits in. Every pillar template can be
 * co-branded: a partner logo (or name) beside the POWR mark, filled from
 * their reward in one click.
 */
import { TYPE } from '../../fonts';
import { drawText, textWidth, capHeight } from '../../text';
import { drawContained, inkLuma, tinted } from '../../assets';
import { logo as powrLogo } from '../../logo';
import { thousands } from '../../words';

export const PILLARS = ['Move', 'Eat', 'Mind', 'Sleep'];

/** The partner fields every pillar template carries (append to `fields`). */
export const BRAND_FIELDS = [
    { key: 'logo', label: 'Partner logo', type: 'image', hint: 'Optional. Shown beside the POWR mark. PNG with transparency is best.' },
    { key: 'brand', label: 'Partner name (if there’s no logo)', value: '', hint: 'Leave empty for a POWR-only post.' },
];

/** The partner's logo in the look's colour mode (auto: a dark logo turns white). */
function partnerLogo(e) {
    const img = e.asset('logo');
    if (!img) return null;
    const mode = e.look.logoColor ?? 'auto';
    if (mode === 'white' || (mode === 'auto' && inkLuma(img) < 0.35)) return tinted(img, e.ink);
    if (mode === 'accent') return tinted(img, e.accent);
    return img;
}

/** True when the post carries a partner (a logo or a name). */
export const hasPartner = (e) => !!(e.asset('logo') || String(e.fields.brand ?? '').trim());

/**
 * The partner's mark fitted in `box` — their logo, else their name set heavy.
 * Returns the drawn box, or null when there's no partner.
 */
export function brandMark(e, box, { align = 'center', color } = {}) {
    const { ctx } = e;
    const img = partnerLogo(e);
    if (img) {
        const r = drawContained(ctx, img, box, { align });
        e.mark('logo', r);
        return r;
    }
    const name = e.caps(e.fields.brand).trim();
    if (!name) return null;
    let px = 100;
    const w100 = textWidth(ctx, name, TYPE.heavy, px, 0);
    px = Math.min((px * box.w) / w100, (box.h * 0.9 * px) / capHeight(ctx, TYPE.heavy, px));
    const tw = textWidth(ctx, name, TYPE.heavy, px, 0);
    const cap = capHeight(ctx, TYPE.heavy, px);
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - tw : box.x + (box.w - tw) / 2;
    const y = box.y + (box.h + cap) / 2;
    drawText(ctx, name, TYPE.heavy, px, x, y, { color: color ?? e.ink });
    const r = { x, y: y - cap, w: tw, h: cap };
    e.mark('brand', r);
    return r;
}

/**
 * POWR mark, then — when there's a partner — a thin "×" and their mark, all
 * `h` tall on one line from (x, y) (top edge). `align: 'right'` ends at x,
 * 'center' centres on x. Returns the whole lockup's box.
 */
export function lockup(e, x, y, h, { align = 'left', color, maxW = Infinity } = {}) {
    const { ctx } = e;
    const ink = color ?? e.ink;
    const base = powrLogo(ink);
    const powrW = base ? (h * base.width) / base.height : h * 3.4;
    const partner = hasPartner(e);
    const img = partner ? partnerLogo(e) : null;
    const gap = h * 0.55;
    const xPx = h * 0.42;
    // The partner gets a box as tall as the lockup (a touch taller for a
    // wordmark with no descenders), and as wide as its own aspect wants.
    let pW = 0;
    const pH = h * 1.15;
    if (img) pW = Math.min((pH * img.width) / img.height, h * 6);
    else if (partner) pW = Math.min(textWidth(ctx, e.caps(e.fields.brand).trim(), TYPE.heavy, h * 0.9, 0), h * 6);
    let total = powrW + (partner ? gap * 2 + xPx + pW : 0);
    const s = total > maxW ? maxW / total : 1;
    total *= s;
    const x0 = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    const hh = h * s;
    e.logo(ink, x0, y, powrW * s);
    if (!partner) return { x: x0, y, w: total, h: hh };
    const cx = x0 + (powrW + gap) * s;
    drawText(ctx, '×', TYPE.brandL, xPx * 1.6 * s, cx, y + hh * 0.86, { color: ink });
    const box = { x: cx + (xPx + gap) * s, y: y + hh / 2 - (pH * s) / 2, w: pW * s, h: pH * s };
    brandMark(e, box, { align: 'left', color: ink });
    return { x: x0, y: box.y, w: total, h: box.h };
}

/**
 * The words any pillar template can take from a partner's reward (data.js
 * rewardFacts): brand, their offer line and the points it costs. Spread it
 * into a template's own fill and add what that layout needs.
 */
export function rewardWords(r) {
    return {
        brand: r.brand,
        ...(r.value ? { reward: `${r.value}${r.unit ? ` ${r.unit}` : ''}` } : {}),
        ...(r.offer ? { offer: r.offer } : {}),
        ...(r.cost ? { points: `${thousands(r.cost)} points` } : {}),
    };
}

// ── Products ────────────────────────────────────────────────────────────
//
// Product templates are built around the brand's product shot: a cut-out
// (PNG with transparency, or a JPG on a flat background, which loadAsset keys
// out) is staged on the dark ground under a pool of light; a shot that is
// still a rectangle (a product on a set) is framed as a photo instead, on
// purpose. With no upload, a drawn stand-in product carries the brand's name,
// so the template reads finished in the picker.

/** The product-shot field (append with BRAND_FIELDS). Shared across templates in the editor. */
export const PRODUCT_FIELD = {
    key: 'product', label: 'Product shot', type: 'image',
    hint: 'A cut-out PNG looks best. A photo on plain white or black is cut out for you; anything else is framed as a photo.',
};

const cutCache = new WeakMap();
/** True when the image has real transparency (a cut-out), not just a rectangle. */
export function isCutout(img) {
    if (cutCache.has(img)) return cutCache.get(img);
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = Math.max(1, Math.round((48 * img.height) / img.width));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 16) clear++;
    const out = clear / (d.length / 4) > 0.04;
    cutCache.set(img, out);
    return out;
}

const hexRgb = (hex) => {
    const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lumOf = (hex) => {
    const [r, g, b] = hexRgb(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** #111 or ink — whichever has more contrast on `bg`. */
export const textOn = (bg) => {
    const l = lumOf(bg);
    const onDark = (l + 0.05) / (lumOf('#111111') + 0.05);
    const onInk = (lumOf('#F4F1EA') + 0.05) / (l + 0.05);
    return onDark >= onInk ? '#111111' : '#F4F1EA';
};

/** A soft pool of light on the ground under a product (no drop shadow). */
export function lightPool(e, cx, baseY, w, strength = 1) {
    const { ctx } = e;
    ctx.save();
    const cy = baseY - w * 0.35;
    const r = w * 0.9;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,250,235,${0.16 * strength})`);
    g.addColorStop(0.5, `rgba(255,250,235,${0.06 * strength})`);
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    // Fill the gradient's whole circle: stopping at the base drew a hard edge.
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // The floor: a thin lit ellipse the product stands on.
    const f = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, w * 0.6);
    f.addColorStop(0, `rgba(255,250,235,${0.22 * strength})`);
    f.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = f;
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(1, 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
}

const ASPECT = { tub: 0.86, bottle: 0.34, jar: 0.72, candle: 0.66, box: 0.74, pillow: 1.55, pouch: 0.7, mask: 2.3, device: 1.05, tin: 1.6 };

/**
 * A drawn stand-in product of `kind` (tub · bottle · jar · candle · box ·
 * pillow · pouch · mask · device · tin) fitted bottom-centre in `box`, its label in the accent with
 * `label` on it. Returns the drawn rect.
 */
/** Where a stand-in of `kind` lands in `box` (bottom-aligned), without drawing it. */
export function mockRect(box, kind = 'tub', align = 'center') {
    const ar = ASPECT[kind] ?? 0.8;
    let h = box.h;
    let w = h * ar;
    if (w > box.w) { w = box.w; h = w / ar; }
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
    return { x, y: box.y + box.h - h, w, h };
}

export function mockProduct(e, box, kind = 'tub', { label = '', sub = '', align = 'center' } = {}) {
    const { ctx } = e;
    const { x, y, w, h } = mockRect(box, kind, align);
    const acc = e.accent;
    const cx = x + w / 2;
    // Matte black packaging lit from the upper left: one soft highlight a
    // third of the way across, falling off to the rim.
    const matte = (x0, w0) => {
        const g = ctx.createLinearGradient(x0, 0, x0 + w0, 0);
        // A faint rim on both edges keeps black packaging off a black ground.
        g.addColorStop(0, '#2a2a28');
        g.addColorStop(0.04, '#121212');
        g.addColorStop(0.2, '#262625');
        g.addColorStop(0.33, '#3a3a38');
        g.addColorStop(0.5, '#242423');
        g.addColorStop(0.86, '#101010');
        g.addColorStop(0.97, '#0b0b0b');
        g.addColorStop(1, '#222221');
        return g;
    };
    // An upright cylinder: side, rounded base, lit top face.
    const cylinder = (x0, w0, top, bottom, face = '#2e2e2c') => {
        const ry = w0 * 0.1;
        ctx.fillStyle = matte(x0, w0);
        ctx.beginPath();
        ctx.moveTo(x0, top + ry);
        ctx.lineTo(x0, bottom - ry);
        ctx.ellipse(x0 + w0 / 2, bottom - ry, w0 / 2, ry, 0, Math.PI, 0, true);
        ctx.lineTo(x0 + w0, top + ry);
        ctx.closePath();
        ctx.fill();
        const f = ctx.createLinearGradient(x0, top, x0 + w0, top + ry * 2);
        f.addColorStop(0, face);
        f.addColorStop(1, '#141414');
        ctx.fillStyle = f;
        ctx.beginPath();
        ctx.ellipse(x0 + w0 / 2, top + ry, w0 / 2, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        return ry;
    };
    // The wordmark: brand letterspaced in ink, a short accent rule, a sub line.
    const wordmark = (midY, maxW) => {
        const t = String(label).toUpperCase().trim();
        if (!t) return;
        let px = maxW * 0.16;
        const tw = textWidth(ctx, t, TYPE.brandSB, px, 0.22);
        if (tw > maxW * 0.8) px *= (maxW * 0.8) / tw;
        drawText(ctx, t, TYPE.brandSB, px, cx, midY, { align: 'center', tracking: 0.22, color: '#EDE9E0' });
        ctx.fillStyle = acc;
        ctx.fillRect(cx - maxW * 0.09, midY + px * 0.7, maxW * 0.18, Math.max(1, px * 0.14));
        const st = String(sub).toUpperCase().trim();
        if (st) {
            let sp = px * 0.5;
            const sw = textWidth(ctx, st, TYPE.mono, sp, 0.16);
            if (sw > maxW * 0.8) sp *= (maxW * 0.8) / sw;
            drawText(ctx, st, TYPE.mono, sp, cx, midY + px * 0.7 + sp * 2.2, { align: 'center', tracking: 0.16, color: 'rgba(237,233,224,0.6)' });
        }
    };
    ctx.save();
    switch (kind) {
    case 'tub': case 'jar': {
        const lidH = h * (kind === 'tub' ? 0.14 : 0.17);
        const ry = w * 0.1;
        cylinder(x, w, y + lidH - ry, y + h);
        cylinder(x + w * 0.03, w * 0.94, y, y + lidH + ry * 0.4, '#3a3a38');
        wordmark(y + lidH + (h - lidH) * 0.5, w);
        break;
    }
    case 'bottle': {
        const capW = w * 0.46;
        const capH = h * 0.1;
        cylinder(x, w, y + capH * 1.25, y + h);
        // Shoulder into the neck.
        ctx.fillStyle = matte(x + (w - capW) / 2, capW);
        ctx.fillRect(x + (w - capW) / 2, y + capH * 0.7, capW, capH);
        cylinder(x + (w - capW) / 2, capW, y, y + capH * 0.9, '#3a3a38');
        wordmark(y + h * 0.55, w);
        break;
    }
    case 'candle': {
        // A dark glass tumbler, the wax surface a few mm below the rim, one flame.
        const ry = cylinder(x, w, y + h * 0.1, y + h, '#1b1a18');
        ctx.fillStyle = '#2a2622';
        ctx.beginPath();
        ctx.ellipse(cx, y + h * 0.1 + ry * 1.6, w * 0.44, ry * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        const fl = ctx.createRadialGradient(cx, y + h * 0.05, 0, cx, y + h * 0.05, w * 0.5);
        fl.addColorStop(0, 'rgba(255,200,120,0.35)');
        fl.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = fl;
        ctx.fillRect(cx - w * 0.5, y + h * 0.05 - w * 0.5, w, w);
        ctx.fillStyle = '#FFD89A';
        ctx.beginPath();
        ctx.ellipse(cx, y + h * 0.075, w * 0.03, h * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        wordmark(y + h * 0.6, w);
        break;
    }
    case 'box': case 'pouch': {
        const r = kind === 'pouch' ? w * 0.06 : w * 0.012;
        ctx.fillStyle = matte(x, w);
        ctx.beginPath();
        if (kind === 'pouch') {
            // Sealed top edge, a gusset that swells at the base.
            ctx.roundRect(x + w * 0.02, y, w * 0.96, h * 0.08, r * 0.4);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x + w * 0.02, y + h * 0.07);
            ctx.lineTo(x + w * 0.98, y + h * 0.07);
            ctx.quadraticCurveTo(x + w * 1.02, y + h * 0.6, x + w, y + h);
            ctx.lineTo(x, y + h);
            ctx.quadraticCurveTo(x - w * 0.02, y + h * 0.6, x + w * 0.02, y + h * 0.07);
        } else {
            ctx.roundRect(x, y, w, h, r);
        }
        ctx.fill();
        if (kind === 'box') {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, y, w, h * 0.012);
        }
        wordmark(y + h * 0.48, w);
        break;
    }
    case 'pillow': {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, '#e2ded5');
        g.addColorStop(0.5, '#c4c0b7');
        g.addColorStop(1, '#7a766f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.05, y + h * 0.12);
        ctx.quadraticCurveTo(x + w / 2, y - h * 0.02, x + w * 0.95, y + h * 0.12);
        ctx.quadraticCurveTo(x + w * 1.02, y + h / 2, x + w * 0.95, y + h * 0.9);
        ctx.quadraticCurveTo(x + w / 2, y + h * 1.02, x + w * 0.05, y + h * 0.9);
        ctx.quadraticCurveTo(x - w * 0.02, y + h / 2, x + w * 0.05, y + h * 0.12);
        ctx.fill();
        // A soft crease and a woven label in the accent.
        const c = ctx.createLinearGradient(0, y + h * 0.4, 0, y + h * 0.6);
        c.addColorStop(0, 'rgba(0,0,0,0)');
        c.addColorStop(0.5, 'rgba(0,0,0,0.08)');
        c.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = c;
        ctx.fillRect(x + w * 0.1, y + h * 0.4, w * 0.8, h * 0.2);
        ctx.fillStyle = acc;
        ctx.fillRect(x + w * 0.8, y + h * 0.72, w * 0.07, h * 0.13);
        break;
    }
    case 'mask': {
        // An eye mask seen flat: two soft lobes joined at the bridge, a strap
        // running off both sides, the wordmark on the band.
        const strapY = y + h * 0.42;
        ctx.fillStyle = '#1a1a19';
        ctx.fillRect(x - w * 0.04, strapY - h * 0.05, w * 1.08, h * 0.1);
        ctx.fillStyle = matte(x, w);
        ctx.beginPath();
        ctx.moveTo(x + w * 0.5, y + h * 0.18);
        ctx.bezierCurveTo(x + w * 0.72, y - h * 0.02, x + w * 1.0, y + h * 0.05, x + w * 0.98, y + h * 0.48);
        ctx.bezierCurveTo(x + w * 0.96, y + h * 0.92, x + w * 0.66, y + h * 1.02, x + w * 0.54, y + h * 0.8);
        ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.7, x + w * 0.46, y + h * 0.8);
        ctx.bezierCurveTo(x + w * 0.34, y + h * 1.02, x + w * 0.04, y + h * 0.92, x + w * 0.02, y + h * 0.48);
        ctx.bezierCurveTo(x, y + h * 0.05, x + w * 0.28, y - h * 0.02, x + w * 0.5, y + h * 0.18);
        ctx.fill();
        // A soft seam just inside the edge.
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = Math.max(1, w * 0.006);
        ctx.setLineDash([w * 0.012, w * 0.012]);
        ctx.stroke();
        ctx.setLineDash([]);
        wordmark(y + h * 0.5, w * 0.5);
        break;
    }
    case 'device': {
        // A bedside device (sound machine, sunrise light): a rounded puck with
        // a speaker grille ring and a lit face.
        ctx.fillStyle = matte(x, w);
        ctx.beginPath();
        ctx.roundRect(x, y + h * 0.08, w, h * 0.92, w * 0.22);
        ctx.fill();
        const r = w * 0.3;
        const fy = y + h * 0.46;
        const glow = ctx.createRadialGradient(cx, fy, 0, cx, fy, r * 1.6);
        glow.addColorStop(0, 'rgba(255,214,150,0.28)');
        glow.addColorStop(1, 'rgba(255,214,150,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 1.6, fy - r * 1.6, r * 3.2, r * 3.2);
        ctx.fillStyle = '#0c0c0c';
        ctx.beginPath();
        ctx.arc(cx, fy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r * 0.78, fy + Math.sin(a) * r * 0.78, w * 0.008, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = acc;
        ctx.beginPath();
        ctx.arc(cx, fy, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        wordmark(y + h * 0.9, w * 0.62);
        break;
    }
    case 'tin': {
        // A small round tin (earplugs, balm) seen at an angle: lid and body.
        const ry = cylinder(x, w, y + h * 0.3, y + h, '#2a2a28');
        cylinder(x - w * 0.01, w * 1.02, y, y + h * 0.42 + ry * 0.2, '#3a3a38');
        wordmark(y + h * 0.18 + ry, w * 0.9);
        break;
    }
    default:
        ctx.fillStyle = matte(x, w);
        ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    return { x, y, w, h };
}

/**
 * The product in `box`: the uploaded shot (a cut-out is staged under a pool
 * of light; a rectangle is framed as a photo) or, with none, a stand-in of
 * `kind` labelled `label`. Returns { rect, cutout, mock } and marks 'product'.
 */
export function productShot(e, box, { kind = 'tub', label, sub = '', align = 'center', stage = true, radius = 18 } = {}) {
    const { ctx, u } = e;
    const img = e.asset('product');
    const name = label ?? (String(e.fields.brand ?? '').trim() || 'POWR');
    if (!img) {
        const probe = mockRect(box, kind, align);
        if (stage) lightPool(e, probe.x + probe.w / 2, probe.y + probe.h, Math.max(probe.w, probe.h * 0.5));
        const r = mockProduct(e, box, kind, { label: name, sub, align });
        e.mark('product', r);
        return { rect: r, cutout: true, mock: true };
    }
    if (isCutout(img)) {
        const s = Math.min(box.w / img.width, box.h / img.height);
        const w = img.width * s;
        const h = img.height * s;
        const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
        const y = box.y + box.h - h;
        if (stage) lightPool(e, x + w / 2, y + h, Math.max(w, h * 0.5));
        ctx.save();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
        const r = { x, y, w, h };
        e.mark('product', r);
        return { rect: r, cutout: true, mock: false };
    }
    // A product on a set: cover-crop it into the box, rounded, with a hairline.
    const s = Math.max(box.w / img.width, box.h / img.height);
    const sw = box.w / s;
    const sh = box.h / s;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, radius * u);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, radius * u);
    ctx.stroke();
    ctx.restore();
    e.mark('product', box);
    return { rect: box, cutout: false, mock: false };
}
