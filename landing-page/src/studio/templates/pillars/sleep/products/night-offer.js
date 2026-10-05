/**
 * NIGHT OFFER — the product as a POWR reward: the product lit on the night
 * ground, what it is and the offer, "Unlock for 2,500 points", and a row of
 * moons waxing from new to full as the progress (the points so far lit in
 * the accent, the full moon the unlock), "in the POWR app" under it. For a
 * sleep partner launching a reward, or POWR posting it.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, PRODUCT_FIELD, productShot, rewardWords } from '../../kit';
import { thousands } from '../../../../words';
import { frame, nightGround, head, line, label, readable, moon, glow, INK, SOFT, MUTED, NIGHT_LOOK, clamp } from './_parts';
import { KINDS } from './moonlit';

const num = (s) => Number(String(s ?? '').replace(/[^\d.]/g, '')) || 0;

// The moons: new → full across `w`, lit up to the points so far. Marks 'have'.
function moons(e, x, cy, w, R, k) {
    const { ctx } = e;
    const n = clamp(Math.floor(w / (R * 2.9)), 5, 9);
    const gap = (w - n * R * 2) / (n - 1);
    const cost = num(e.fields.points);
    const have = num(e.fields.have);
    const f = cost > 0 ? clamp(have / cost, 0, 1) : 0;
    const lit = readable(e.accent);
    const on = Math.round(f * (n - 1));
    for (let i = 0; i < n; i++) {
        const cx = x + R + i * (R * 2 + gap);
        const phase = 0.04 + (0.46 * i) / (n - 1);
        const done = i <= on && f > 0;
        ctx.save();
        ctx.strokeStyle = done ? lit : 'rgba(244,241,234,0.3)';
        ctx.lineWidth = Math.max(1, 1.3 * k);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        moon(ctx, cx, cy, R, i === n - 1 ? 0.5 : phase, done ? lit : 'rgba(244,241,234,0.14)', done ? 'rgba(244,241,234,0.05)' : null);
    }
    e.mark('have', { x, y: cy - R, w, h: R * 2 });
}

// "Unlock for 2,500 points", the number in the accent. Returns its box.
function unlock(e, x, base, px, { align = 'left', maxW = Infinity } = {}) {
    const pts = String(e.fields.points ?? '').trim();
    if (!pts) return null;
    const lead = String(e.fields.lead ?? '').trim();
    const text = `${lead ? `${lead} ` : ''}{${pts.replace(/[{}]/g, '')}}`;
    const b = line(e, null, text, e.headline, px * (e.look.size ?? 1), x, base, { align, maxW, color: INK });
    e.mark('points', b);
    if (lead) e.mark('lead', b);
    return b;
}

// Product name, then the offer in the accent.
function what(e, x, base, px, { align = 'left', maxW = Infinity } = {}) {
    const name = String(e.fields.name ?? '').trim();
    const reward = String(e.fields.reward ?? '').trim();
    const text = [name, reward ? `{${reward.replace(/[{}]/g, '')}}` : ''].filter(Boolean).join('  ·  ');
    if (!text) return null;
    const b = line(e, null, text, TYPE.brandL, px, x, base, { align, maxW, color: SOFT });
    if (name) e.mark('name', b);
    if (reward) e.mark('reward', b);
    return b;
}

function foot(e, x, x1, base, px, maxW) {
    const have = String(e.fields.have ?? '').trim();
    const cost = num(e.fields.points);
    const soFar = have ? `${thousands(num(have))} of ${thousands(cost)} so far` : '';
    if (soFar) label(e, null, soFar, px, x, base, { maxW: maxW * 0.5, color: MUTED });
    label(e, 'where', e.fields.where, px, x1, base, { align: 'right', maxW: maxW * 0.46, color: readable(e.accent) });
}

export default {
    id: 'sleep-night-offer',
    name: 'Night Offer',
    category: 'Sleep',
    section: 'Products',
    blurb: 'The product as a POWR reward: “Unlock for 2,500 points” and a row of waxing moons as the progress.',
    refs: 'a moon-phase calendar',
    headlineFont: 'brandL',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'POWR reward' },
        { key: 'name', label: 'Product', value: 'Silk Eye Mask' },
        { key: 'reward', label: 'Offer', value: 'Free', hint: 'Shown in the accent after the product, e.g. Free, 20% off.' },
        { key: 'lead', label: 'Before the points', value: 'Unlock for' },
        { key: 'points', label: 'Points', value: '2,500 points' },
        { key: 'have', label: 'Points so far', value: '1,800', hint: 'Lights the moons up to here. Empty for all dark.' },
        { key: 'where', label: 'Where', value: 'In the POWR app' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Free', fields: {}, look: { kind: 'mask' } },
        { name: 'Discount', fields: { name: 'Dawn Lamp, sunrise light', reward: '25% off', points: '1,200 points', have: '1,200' }, look: { kind: 'device' }, style: { accent: '#B9C7E8' } },
        { name: 'Tea', fields: { name: 'Night Tea, 20 bags', reward: 'Free', points: '600 points', have: '150' }, look: { kind: 'pouch' }, style: { accent: '#D8B98A' } },
        { name: 'Members first', fields: { eyebrow: 'Members first', name: 'Night Band 2', reward: '£40 off', lead: 'Unlock for', points: '4,000 points', have: '' }, look: { kind: 'box' }, style: { accent: '#7FE0C2' } },
    ],
    look: { ...NIGHT_LOOK, kind: 'mask' },
    controls: [{ key: 'kind', label: 'Stand-in', options: KINDS }],
    fill: {
        reward: (r) => ({
            ...rewardWords(r),
            ...(r.cost ? { have: thousands(Math.round((r.cost * 0.72) / 10) * 10) } : {}),
        }),
    },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        const { W } = e;
        nightGround(e, { glow: { x: 0.5, y: 0.3 }, sink: 0.7 });
        const kind = e.look.kind ?? 'mask';
        const hb = head(e, f);

        if (f.strip) {
            const pw = (x1 - x0) * 0.2;
            productShot(e, { x: x0, y: hb + 6 * k, w: pw, h: y1 - hb - 6 * k }, { kind });
            const tx = x0 + pw + 50 * k;
            const tW = x1 - tx;
            what(e, tx, hb + 60 * k, 18 * k, { maxW: tW });
            unlock(e, tx, hb + 130 * k, 48 * k, { maxW: tW });
            const R = 20 * k;
            moons(e, tx, y1 - 60 * k, Math.min(tW, R * 2.9 * 9), R, k);
            foot(e, tx, x1, y1, 12 * k, tW);
            return;
        }

        if (f.wide || f.sq) {
            const pw = (x1 - x0) * (f.sq ? 0.42 : 0.44);
            glow(e, x0 + pw / 2, (hb + y1) / 2, pw * 0.7, 0.07);
            productShot(e, { x: x0, y: hb + 40 * k, w: pw, h: y1 - hb - 40 * k }, { kind });
            const tx = x0 + pw + (f.sq ? 50 : 90) * k;
            const tW = x1 - tx;
            const mid = (hb + y1) / 2;
            what(e, tx, mid - (f.sq ? 110 : 140) * k, (f.sq ? 22 : 28) * k, { maxW: tW });
            unlock(e, tx, mid - (f.sq ? 20 : 30) * k, (f.sq ? 60 : 76) * k, { maxW: tW });
            const R = (f.sq ? 20 : 26) * k;
            moons(e, tx, mid + (f.sq ? 80 : 110) * k, tW, R, k);
            foot(e, tx, x1, mid + (f.sq ? 170 : 210) * k, (f.sq ? 13 : 15) * k, tW);
            return;
        }

        // Post and story: the product up top, the offer stacked under it, centred.
        const cx = W / 2;
        const fPx = (f.tall ? 16 : 15) * k;
        const R = (f.tall ? 30 : 27) * k;
        const footBase = y1 - 4 * k;
        const moonY = footBase - fPx * 2.6 - R;
        const uPx = (f.tall ? 74 : 64) * k;
        const uBase = moonY - R - (f.tall ? 64 : 52) * k;
        const wPx = (f.tall ? 28 : 25) * k;
        const wBase = uBase - uPx - (f.tall ? 18 : 14) * k;
        const pTop = hb + (f.tall ? 80 : 50) * k;
        const pBot = wBase - wPx - (f.tall ? 70 : 50) * k;
        glow(e, cx, (pTop + pBot) / 2, (pBot - pTop) * 0.7, 0.07);
        productShot(e, { x: x0 + (x1 - x0) * 0.18, y: pTop, w: (x1 - x0) * 0.64, h: pBot - pTop }, { kind });
        what(e, cx, wBase, wPx, { align: 'center', maxW: x1 - x0 });
        unlock(e, cx, uBase, uPx, { align: 'center', maxW: x1 - x0 });
        moons(e, x0, moonY, x1 - x0, R, k);
        foot(e, x0, x1, footBase, fPx, x1 - x0);
    },
};
