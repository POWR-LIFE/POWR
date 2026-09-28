/**
 * QUOTE — a member's words (or the brand's own), set big in serif with an
 * oversized opening mark hanging in the margin in the accent, and a quiet
 * attribution under an accent rule. The photo, if there is one, is a band
 * across the top that falls away into the dark. Never a famous name.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight } from '../../../text';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, DIM, GROUND, unitOf, ground, prep, footRow, headColor, label, rewardLine } from './_parts';

// The quote with its hanging mark, and the attribution, from `top`.
function body(e, x, top, qb, k, { hang, markPx }) {
    const { ctx } = e;
    const mCap = capHeight(ctx, TYPE.serif, markPx);
    // The mark's own ink sits above its baseline like a raised comma pair —
    // hang it so its top lines up with the quote's cap-top.
    drawText(ctx, '“', TYPE.serif, markPx, x - hang, top + mCap * 1.02, { color: e.accent });
    const box = qb.draw('quote', x, top, { color: headColor(e) });
    const who = String(e.fields.who ?? '').trim();
    if (!who) return;
    const y = top + qb.h + qb.desc + 46 * k;
    e.ctx.fillStyle = e.accent;
    e.ctx.fillRect(x, y, 36 * k, 2 * k);
    label(e, 'who', who, x, y + 34 * k + capHeight(ctx, TYPE.brandR, 17 * k), { px: 17 * k, maxW: Math.max(box?.w ?? 0, 400 * k), color: DIM });
}

const bodyH = (e, qb, k) => qb.h + qb.desc + (String(e.fields.who ?? '').trim() ? 46 * k + 34 * k + capHeight(e.ctx, TYPE.brandR, 17 * k) : 0);

function banner(e) {
    const { W, H, safe, shape } = e;
    const k = unitOf(e);
    const size = e.look.size ?? 1;
    const strip = shape === 'strip';
    ground(e, GROUND);
    const px0 = W * (strip ? 0.66 : 0.58);
    if (e.hasMedia) {
        e.photo({ x: px0, y: 0, w: W - px0, h: H });
        e.fade(px0, 0, (W - px0) * 0.6, H, 'left', 0.95);
    }
    const x1 = W - safe.r;
    footRow(e, { x0: e.hasMedia ? px0 + 40 * k : safe.l, x1, bottom: H - safe.b, k, lockH: strip ? 22 : 26 });
    const hang = (strip ? 70 : 100) * k;
    const x = safe.l + hang;
    const colW = (e.hasMedia ? px0 : W * 0.78) - x - 40 * k;
    const qb = prep(e, e.fields.quote, e.headline, { maxW: colW * size, maxH: (H - safe.t - safe.b) * (strip ? 0.55 : 0.5) * size, max: (strip ? 64 : 84) * k * size, lines: 4, gap: 0.3 });
    const h = bodyH(e, qb, k);
    body(e, x, safe.t + Math.max(0, (H - safe.t - safe.b - h) / 2), qb, k, { hang, markPx: Math.max(qb.px * 3, 130 * k) });
}

export default {
    id: 'mind-quote',
    name: 'Quote',
    category: 'Mind',
    blurb: 'A member’s words in big serif, an oversized hanging quote mark in the accent, a quiet attribution. Photo optional.',
    refs: 'a magazine pull quote',
    headlineFont: 'serif',
    photo: 'optional',
    fields: [
        { key: 'quote', label: 'Quote', rows: 4, value: 'I came for the streak.\nI stay for the\nquiet _after_.', hint: 'Break the lines yourself. _Underscores_ set italic, {braces} colour a word.' },
        { key: 'who', label: 'Who said it', value: 'A POWR member', hint: 'A member (first name only, with their OK) or your brand — never a famous name.' },
        { key: 'footer', label: 'Small print', value: 'In their words' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Member', fields: { quote: 'I came for the streak.\nI stay for the\nquiet _after_.', who: 'A POWR member', footer: 'In their words' } },
        { name: 'Studio', fields: { quote: 'You don’t have to\nclear your mind.\nJust _sit_ with it.', who: 'Northside Studio', footer: 'Tuesday · Sit with us' } },
        { name: 'Teacher', fields: { quote: 'The breath is\nalways here.\nCome back to _it_.', who: 'Lena, breathwork teacher', footer: 'Northside · Breathwork' } },
        { name: 'POWR', fields: { quote: 'Rest days count.\nThey’re part of\nthe _work_.', who: 'POWR', footer: 'Every move counts' } },
    ],
    look: { ...MIND_LOOK, mono: 0.8, target: 0.24 },
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const size = e.look.size ?? 1;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        ground(e, GROUND);
        let start = safe.t + 90 * k;
        if (e.hasMedia) {
            const band = H * (tall ? 0.42 : sq ? 0.36 : 0.4);
            e.photo({ x: 0, y: 0, w: W, h: band });
            e.fade(0, 0, W, band * 0.3, 'top', 0.35);
            e.fade(0, band * 0.35, W, band * 0.65 + 1, 'bottom', 0.96);
            start = band - (sq ? 10 : 30) * k;
        }
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0: safe.l, x1, bottom: H - safe.b, k });
        const hang = (sq ? 96 : 110) * k;
        const x = safe.l + hang;
        const room = footTop - (sq ? 50 : 70) * k - start;
        const qb = prep(e, e.fields.quote, e.headline, {
            maxW: (x1 - x - 20 * k) * size,
            maxH: room * 0.62 * size,
            max: (sq ? 80 : 96) * k * size,
            lines: 5,
            gap: 0.3,
        });
        const h = bodyH(e, qb, k);
        const top = start + Math.max(0, (room - h) / 2);
        body(e, x, top, qb, k, { hang, markPx: Math.max(qb.px * 3, 160 * k) });
    },
};
