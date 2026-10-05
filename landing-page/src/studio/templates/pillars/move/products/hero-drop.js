/**
 * HERO DROP — the flagship packshot: one product on a lit stage, its name
 * huge and tight underneath, then the price and the details on a hairline,
 * an "Out now" (or a date) chip up top beside the POWR × partner lockup.
 * For activewear, footwear and gear brands launching a product.
 */
import { TYPE } from '../../../../fonts';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup } from '../../kit';
import { SOFT, HAIR, frame, ground, backdrop, chip, line, block, blockHeight, cap, makerOf } from './_parts';

const NAME = { tracking: -0.03, gap: 0.1 };

// Price (light, big) left and the details (mono) right, sharing a baseline at `base`.
function priceRow(e, x0, x1, base, px, { stack = false } = {}) {
    const k = frame(e).k;
    const p = line(e, 'price', TYPE.brandL, px, x0, base, (x1 - x0) * (stack ? 1 : 0.4), { tracking: -0.02 });
    const dx = stack ? x0 : x1;
    const dBase = stack ? base + px * 0.75 : base;
    line(e, 'detail', TYPE.mono, px * 0.34, dx, dBase, stack ? x1 - x0 : (x1 - x0) - (p ? p.w + 40 * k : 0), { align: stack ? 'left' : 'right', color: SOFT, tracking: 0.16, caps: true });
}

function banner(e) {
    const f = frame(e);
    const { W, H } = e;
    const { k, x0, x1, y0, y1 } = f;
    const split = W * (f.strip ? 0.34 : 0.46);
    ground(e, { cx: split * 0.55, cy: H * 0.55, r: H * (f.strip ? 0.9 : 0.62) });
    backdrop(e);
    productShot(e, { x: x0, y: y0 + (f.strip ? 0 : 30 * k), w: split - x0 - 30 * k, h: y1 - y0 - (f.strip ? 0 : 30 * k) }, { kind: 'bottle', sub: e.fields.name });
    const cx = split + 30 * k;
    const lh = (f.strip ? 40 : 52) * k;
    const lk = lockup(e, cx, y0, lh, { maxW: (x1 - cx) * 0.55 });
    chip(e, 'chip', x1, y0 + lh / 2 - (f.strip ? 22 : 28) * k, (f.strip ? 44 : 56) * k, { align: 'right', maxW: (x1 - cx) * 0.4 });
    const pPx = (f.strip ? 50 : 76) * k;
    const bottomH = pPx * (f.strip ? 1 : 1.1);
    const top = lk.y + lk.h + (f.strip ? 26 : 60) * k;
    const nameBottom = y1 - bottomH - (f.strip ? 30 : 56) * k;
    const nh = blockHeight(e, 'name', x1 - cx, nameBottom - top, NAME);
    block(e, 'name', cx, nameBottom - nh, x1 - cx, nameBottom - top, NAME);
    const ry = y1 - bottomH - (f.strip ? 14 : 26) * k;
    rule(e.ctx, cx, ry, x1, ry, HAIR, Math.max(1, 1.2 * k));
    priceRow(e, cx, x1, y1, pPx);
}

export default {
    id: 'move-hero-drop',
    name: 'Hero Drop',
    category: 'Move',
    section: 'Products',
    blurb: 'The flagship packshot: one product on a lit stage, its name huge underneath, the price and an "Out now" chip. For a kit or gear launch.',
    refs: 'a sportswear launch poster',
    headlineFont: 'brand',
    photo: 'optional',
    fields: [
        { key: 'chip', label: 'Chip', value: 'Out now', hint: '"Out now", a date, "Members first"… Empty for none.' },
        { key: 'name', label: 'Product name', rows: 2, value: 'Trail\nbottle' },
        { key: 'price', label: 'Price', value: '£32' },
        { key: 'detail', label: 'Details', value: '750 ml · Brushed steel' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Bottle', fields: { chip: 'Out now', name: 'Trail\nbottle', price: '£32', detail: '750 ml · Brushed steel' } },
        { name: 'Trainer', fields: { chip: 'Sat 17 Oct · 09:00', name: 'Tempo\nrunner', price: '£125', detail: 'Chalk / Volt · UK 3–13' } },
        { name: 'Leggings', fields: { chip: 'Members first', name: 'Studio\ntight', price: '£68', detail: 'Black · XS–XL · 7/8 length' } },
        { name: 'Watch', fields: { chip: 'Out now', name: 'Pace 2', price: '£249', detail: '44 mm · GPS · 12-day battery' } },
    ],
    look: {
        mono: 1, target: 0.24, auto: 0.85, contrast: 0.45, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.5, vignette: 0.5, grain: 0.4, size: 1,
    },
    fill: {
        reward: (r) => ({ ...rewardWords(r), chip: r.value ? `${r.value}${r.unit ? ` ${r.unit}` : ''} with points` : 'Out now' }),
    },

    draw(e) {
        const f = frame(e);
        if (f.banner) return banner(e);
        const { ctx, W } = e;
        const { k, tall, sq } = f;
        const x0 = f.x0 + 6 * k;
        const x1 = f.x1 - 6 * k;
        const y0 = f.y0 + (tall ? 10 : 4) * k;
        const y1 = f.y1;
        const lh = (sq ? 46 : 54) * k;
        // Bottom up: price row, hairline, the name, then the product fills what's left.
        const pPx = (tall ? 84 : sq ? 60 : 72) * k;
        const nameMaxH = e.H * (tall ? 0.2 : sq ? 0.2 : 0.21);
        const ry = y1 - pPx - 30 * k;
        const nh = blockHeight(e, 'name', x1 - x0, nameMaxH, NAME);
        const nameTop = ry - 36 * k - nh;
        const pTop = y0 + lh + (sq ? 30 : 50) * k;
        const pBox = { x: x0 + (x1 - x0) * 0.12, y: pTop, w: (x1 - x0) * 0.76, h: nameTop - (sq ? 30 : 50) * k - pTop };
        ground(e, { cx: W / 2, cy: pBox.y + pBox.h * 0.55, r: Math.max(pBox.h * 0.75, W * 0.5) });
        backdrop(e);
        productShot(e, pBox, { kind: 'bottle', label: makerOf(e), sub: e.fields.name });
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        chip(e, 'chip', x1, y0 + lh / 2 - lh * 0.52, lh * 1.04, { align: 'right', maxW: (x1 - x0) * 0.45 });
        block(e, 'name', x0, nameTop, x1 - x0, nameMaxH, NAME);
        rule(ctx, x0, ry, x1, ry, HAIR, Math.max(1, 1.2 * k));
        priceRow(e, x0, x1, y1 - (pPx - cap(e, TYPE.brandL, pPx)) * 0.2, pPx);
    },
};
