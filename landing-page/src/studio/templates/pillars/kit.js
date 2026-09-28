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
