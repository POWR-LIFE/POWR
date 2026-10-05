/**
 * MAKER'S NOTE — a short letter from the people who make the thing: a
 * header like a letterhead (who it's from · where and when), the note in
 * serif italic, then a signature over a hairline with the maker's name and
 * role, and the product beside it. The brand's own words — never a
 * customer's. For candle makers, stationers, small studios and app founders.
 */
import { TYPE } from '../../../../fonts';
import { capHeight } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot } from '../../kit';
import {
    MIND_LOOK, HAIR, GROUND, frame, ground, veil, footRow, footH, headColor, glow, framedShot,
    lineItem, paraItem, productFill,
} from './_parts';

// Letterhead: from (left) · place and date (right), a hairline under.
function letterhead(e, x0, x1, y, k) {
    const px = 15 * k;
    const cap = capHeight(e.ctx, TYPE.monoR, px);
    const r = lineItem(e, 'place', e.fields.place, x1, { px, spec: TYPE.monoR, align: 'right', maxW: (x1 - x0) * 0.45, tracking: 0.2 });
    r?.draw(y);
    lineItem(e, 'kicker', e.fields.kicker, x0, { px, spec: TYPE.monoR, maxW: (x1 - x0) * (r ? 0.5 : 1), tracking: 0.2 })?.draw(y);
    rule(e.ctx, x0, y + cap + 26 * k, x1, y + cap + 26 * k, HAIR, Math.max(1, 1.1 * k));
    return y + cap + 26 * k;
}

// The signature: the name set large in serif italic with a pen stroke
// under it, a hairline, then name and role in mono. Returns a stack piece.
function signature(e, x, w, k, { px = 64 * k } = {}) {
    const { ctx } = e;
    const sign = lineItem(e, 'sign', e.fields.sign, x, { px, spec: TYPE.serifI, maxW: w, color: headColor(e), tracking: 0, upper: false });
    const role = lineItem(e, 'role', e.fields.role, x, { px: 14 * k, spec: TYPE.monoR, maxW: w, tracking: 0.18 });
    const gap = 30 * k;
    const h = (sign?.h ?? 0) + gap + (role ? role.h + 22 * k : 0);
    return {
        h,
        draw: (y) => {
            const b = sign?.draw(y);
            const ly = y + (sign?.h ?? 0) + gap * 0.6;
            if (b) {
                // A loose pen stroke off the end of the name.
                ctx.save();
                ctx.strokeStyle = e.accent;
                ctx.lineWidth = Math.max(1.2, 2 * k);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(b.x + b.w * 0.15, ly - gap * 0.25);
                ctx.bezierCurveTo(b.x + b.w * 0.55, ly - gap * 0.05, b.x + b.w * 0.9, ly - gap * 0.55, b.x + b.w + 24 * k, ly - gap * 0.45);
                ctx.stroke();
                ctx.restore();
            }
            rule(ctx, x, ly + gap * 0.4, x + Math.min(w, 360 * k), ly + gap * 0.4, HAIR, Math.max(1, 1.1 * k));
            role?.draw(ly + gap * 0.4 + 22 * k);
        },
    };
}

function product(e, box) {
    if (framedShot(e)) {
        const w = Math.min(box.w, box.h * 0.8);
        const h = Math.min(box.h, w * 1.25);
        productShot(e, { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h }, { stage: false, radius: 6 });
        return;
    }
    const h = Math.min(box.h, box.w * (e.asset('product') ? 1.3 : 1.05));
    const b = { x: box.x, y: box.y + box.h - h, w: box.w, h };
    glow(e, b.x + b.w / 2, b.y + b.h * 0.62, b.w * 0.55, b.h * 0.5, 0.16);
    productShot(e, b, { kind: e.look.kind ?? 'candle' });
}

const itemLine = (e, x, w, k, align = 'left') => lineItem(e, 'item', e.fields.item, x, { px: 20 * k, spec: TYPE.brandR, maxW: w, color: e.ink, tracking: 0.02, upper: false, align });

export default {
    id: 'makers-note',
    name: 'Maker’s Note',
    category: 'Mind',
    section: 'Products',
    blurb: 'A short letter from the maker in serif italic, signed with a name and role over a hairline, the product beside it. The brand’s own words.',
    refs: 'the card tucked into a handmade parcel',
    headlineFont: 'serifI',
    photo: 'optional',
    fields: [
        { key: 'kicker', label: 'From', value: 'A note from the maker' },
        { key: 'place', label: 'Where and when', value: 'Leeds · Autumn', hint: 'Leave empty to hide it.' },
        { key: 'note', label: 'The note', rows: 5, value: 'We pour every candle by hand, forty at a time, in a small room above the shop. Soy wax, a cotton wick, a glass you’ll want to keep. Light it when the day is done.', hint: 'Your brand’s own words: how it’s made and what’s in it. Never a customer review.' },
        { key: 'sign', label: 'Signature', value: 'Amara', hint: 'A first name reads like a signature.' },
        { key: 'role', label: 'Name and role', value: 'Amara Okafor · Founder' },
        { key: 'item', label: 'Product line', value: 'Candle No. 3 · £34', hint: 'Set under the product.' },
        { key: 'footer', label: 'Small print', value: 'Or 3,400 POWR points' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Candle maker', fields: { kicker: 'A note from the maker', place: 'Leeds · Autumn', note: 'We pour every candle by hand, forty at a time, in a small room above the shop. Soy wax, a cotton wick, a glass you’ll want to keep. Light it when the day is done.', sign: 'Amara', role: 'Amara Okafor · Founder', item: 'Candle No. 3 · £34', footer: 'Or 3,400 POWR points' } },
        { name: 'Stationer', fields: { kicker: 'From the bindery', place: 'Bristol · Batch 14', note: 'Each journal is sewn by hand and pressed for a week so it opens flat on the first page. The paper is heavy enough for ink. The rest is up to you.', sign: 'Tom', role: 'Tom Hale · Bookbinder', item: 'The Evening Journal · £28', footer: 'Members first in the POWR app' } },
        { name: 'App founder', fields: { kicker: 'A note from us', place: 'Version 3.0', note: 'We built the timer we wanted: no streak alarms, no badges, no feed. Pick a length, press start, and the phone stays quiet until the bell.', sign: 'Priya', role: 'Priya Shah · Co-founder', item: 'Northside · Free on iPhone and Android', footer: 'Premium with POWR points' } },
        { name: 'Studio', fields: { kicker: 'From the studio', place: 'Hackney · Since 2019', note: 'Twelve mats, low light, and a teacher who remembers your name. Classes are small on purpose. Come early, stay for tea.', sign: 'Lena', role: 'Lena Voss · Studio owner', item: 'Class pack of five · £60', footer: 'Redeem with POWR points' } },
    ],
    look: { ...MIND_LOOK, mono: 0.65, target: 0.2, kind: 'candle' },
    controls: [
        { key: 'kind', label: 'Stand-in', options: [['candle', 'Candle'], ['jar', 'Jar'], ['box', 'Box']] },
    ],
    fill: { reward: (r) => { const f = productFill(r); return { ...f, footer: f.points }; } },

    draw(e) {
        const { W, H } = e;
        const f = frame(e);
        const { k, size } = f;
        ground(e, GROUND);
        if (e.hasMedia) {
            e.photo({ x: 0, y: 0, w: W, h: H });
            veil(e, 0.66);
        }
        const note = (x, w, px, maxH, maxLines = 8) => paraItem(e, 'note', e.fields.note, x, { px: px * size, spec: e.headline, maxW: w, maxH: maxH * size, maxLines, color: headColor(e), leading: 1.28, min: 0.5 });

        if (f.strip) {
            const pb = { x: f.x0, y: f.top, w: W * 0.14, h: f.bottom - f.top };
            product(e, pb);
            const nx = pb.x + pb.w + 60 * k;
            const sw = W * 0.2;
            const nw = f.x1 - sw - 60 * k - nx;
            const lh = letterhead(e, nx, nx + nw, f.top, k);
            const n = note(nx, nw, 38 * k, f.bottom - lh - 40 * k, 4);
            n?.draw(lh + 34 * k + Math.max(0, (f.bottom - lh - 34 * k - (n?.h ?? 0)) / 2) - 10 * k);
            const sx = f.x1 - sw;
            const sig = signature(e, sx, sw, k, { px: 48 * k });
            const footTop = f.bottom - footH(e, k, { lockH: 22 });
            sig.draw(f.top + Math.max(0, (footTop - 30 * k - f.top - sig.h) / 2));
            footRow(e, { x0: sx, x1: f.x1, bottom: f.bottom, k, lockH: 22, footKey: 'none' });
            return;
        }

        const footTop = f.bottom - footH(e, k);
        if (f.wide) {
            const pw = W * 0.32;
            const x = f.x0 + pw + 90 * k;
            const w = f.x1 - x;
            product(e, { x: f.x0, y: f.top + 40 * k, w: pw, h: footTop - 110 * k - f.top - 40 * k });
            itemLine(e, f.x0 + pw / 2, pw, k, 'center')?.draw(footTop - 70 * k);
            const lh = letterhead(e, x, f.x1, f.top + 10 * k, k);
            const sig = signature(e, x, w * 0.5, k, { px: 60 * k });
            const sy = footTop - 50 * k - sig.h;
            const n = note(x, w * 0.92, 50 * k, sy - 60 * k - lh - 50 * k, 7);
            n?.draw(lh + 50 * k + Math.max(0, (sy - 60 * k - lh - 50 * k - (n?.h ?? 0)) / 2));
            sig.draw(sy);
            footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
            return;
        }

        // Post, square, story.
        const w = f.x1 - f.x0;
        const top = f.top + (f.tall ? 40 : 0) * k;
        const lh = letterhead(e, f.x0, f.x1, top, k);
        const sig = signature(e, f.x0, w * 0.5, k, { px: (f.sq ? 56 : 66) * k });
        const pw = w * (f.sq ? 0.36 : 0.42);
        if (f.tall) {
            const item = itemLine(e, W / 2, w, k, 'center');
            const sy = footTop - 60 * k - sig.h;
            const n = note(f.x0, w, 54 * k, H * 0.3, 9);
            const ny = lh + 70 * k;
            const nb = ny + (n?.h ?? 0);
            n?.draw(ny);
            const iy = sy - 70 * k - (item?.h ?? 0);
            item?.draw(iy);
            product(e, { x: f.x0 + w * 0.2, y: nb + 70 * k, w: w * 0.6, h: iy - 40 * k - nb - 70 * k });
            sig.draw(sy);
        } else {
            const sy = footTop - (f.sq ? 40 : 60) * k - sig.h;
            const n = note(f.x0, w * (f.sq ? 0.6 : 0.92), (f.sq ? 44 : 58) * k, f.sq ? sy - 60 * k - lh - 40 * k : H * 0.36, f.sq ? 8 : 7);
            const ny = lh + (f.sq ? 44 : 60) * k;
            n?.draw(ny);
            const pTop = f.sq ? lh + 60 * k : ny + (n?.h ?? 0) + 50 * k;
            const item = itemLine(e, f.x1 - pw / 2, pw, k, 'center');
            const iy = footTop - (f.sq ? 40 : 60) * k - (item?.h ?? 0);
            item?.draw(iy);
            product(e, { x: f.x1 - pw, y: pTop, w: pw, h: iy - 36 * k - pTop });
            sig.draw(sy);
        }
        footRow(e, { x0: f.x0, x1: f.x1, bottom: f.bottom, k });
    },
};
