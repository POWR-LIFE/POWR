/**
 * PROMPT — a journaling prompt set on a page: a dark card with the date in
 * mono and the prompt's number, the question in serif italic, then faint
 * ruled lines left blank below it — an invitation to write. A margin rule in
 * the accent. For journaling brands, therapists' studios and wellness apps.
 */
import { TYPE } from '../../../fonts';
import { rule } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { MIND_LOOK, DIM, unitOf, veil, prep, footRow, headColor, label, rewardLine } from './_parts';

// The card: header (date · number), a rule, the question, then blank lines.
function card(e, box, k, { compact = false } = {}) {
    const { ctx } = e;
    const size = e.look.size ?? 1;
    const pad = (compact ? 34 : 50) * k;
    ctx.save();
    ctx.fillStyle = 'rgba(21,19,17,0.97)';
    ctx.strokeStyle = 'rgba(244,241,234,0.12)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 6 * k);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const ix0 = box.x + pad;
    const ix1 = box.x + box.w - pad;
    const mPx = (compact ? 14 : 17) * k;
    const hBase = box.y + pad + mPx * 0.72;
    const num = label(e, 'number', e.fields.number, ix1, hBase, { px: mPx, maxW: (ix1 - ix0) * 0.4, align: 'right', color: e.accent, spec: TYPE.monoR, tracking: 0.14 });
    label(e, 'date', e.fields.date, ix0, hBase, { px: mPx, maxW: (ix1 - ix0) - (num ? num.w + 30 * k : 0), color: DIM, spec: TYPE.monoR, tracking: 0.14 });
    const ruleY = hBase + (compact ? 20 : 30) * k;
    rule(ctx, ix0, ruleY, ix1, ruleY, 'rgba(244,241,234,0.22)', Math.max(1, 1.2 * k));

    const qTop = ruleY + (compact ? 30 : 56) * k;
    const qb = prep(e, e.fields.question, e.headline, {
        maxW: (ix1 - ix0) * size,
        maxH: (box.y + box.h - qTop) * (compact ? 0.62 : 0.42) * size,
        max: (compact ? 64 : 92) * k * size,
        lines: 3,
        gap: 0.34,
    });
    qb.draw('question', ix0, qTop, { color: headColor(e) });

    // Blank ruled lines to the foot of the card, a margin rule beside them.
    const g = (compact ? 46 : 64) * k;
    const first = qTop + qb.h + qb.desc + g * (compact ? 0.9 : 1.15);
    const last = box.y + box.h - pad * 0.8;
    let y = first;
    let n = 0;
    while (y <= last + 0.5) {
        rule(ctx, ix0, y, ix1, y, 'rgba(244,241,234,0.15)', Math.max(1, 1.1 * k));
        y += g;
        n += 1;
    }
    if (n) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        rule(ctx, box.x + pad * 0.5, first - g * 0.8, box.x + pad * 0.5, y - g + g * 0.3, e.accent, Math.max(1, 1.4 * k));
        ctx.restore();
    }
}

function banner(e) {
    const { W, H, safe, shape } = e;
    const k = unitOf(e);
    const strip = shape === 'strip';
    e.photo({ x: 0, y: 0, w: W, h: H });
    veil(e, 0.12);
    e.fade(0, H * 0.5, W, H * 0.5, 'bottom', 0.6);
    const cx = W * (strip ? 0.5 : 0.47);
    e.fade(cx - W * 0.2, 0, W * 0.2, H, 'right', 0.6);
    card(e, { x: cx, y: safe.t, w: W - safe.r - cx, h: H - safe.t - safe.b }, k, { compact: strip });
    footRow(e, { x0: safe.l, x1: cx - 50 * k, bottom: H - safe.b, k, lockH: strip ? 22 : 26 });
}

export default {
    id: 'journal-prompt',
    name: 'Prompt',
    category: 'Mind',
    blurb: 'A journaling prompt on a ruled card: the date in mono, the question in serif italic, blank lines to write on.',
    refs: 'a journal page',
    headlineFont: 'serifI',
    fields: [
        { key: 'date', label: 'Date', value: 'Sunday 28 September' },
        { key: 'number', label: 'Prompt number', value: 'No. 12', hint: 'Leave empty to hide it.' },
        { key: 'question', label: 'The prompt', rows: 3, value: 'What would make\ntomorrow feel lighter?', hint: 'A question, one to three lines. {Braces} colour a word.' },
        { key: 'footer', label: 'Small print', value: 'Five minutes · Pen and paper' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Evening page', fields: { date: 'Sunday 28 September', number: 'No. 12', question: 'What would make\ntomorrow feel lighter?', footer: 'Five minutes · Pen and paper' } },
        { name: 'Journal brand', fields: { date: 'Day 01', number: 'Morning pages', question: 'What’s taking up\nthe most room\nin your head?', footer: 'Northside Journals' } },
        { name: 'After training', fields: { date: 'After the session', number: 'Reflect', question: 'What did your body\ndo today that you\ndidn’t expect?', footer: 'Every session counts' } },
        { name: 'Weekly', fields: { date: 'Week 39', number: 'Sunday reset', question: 'What can you\nleave in this week?', footer: 'Write it. Close the book.' } },
    ],
    look: { ...MIND_LOOK, mono: 0.6, tintAmount: 0.55, target: 0.24 },
    fill: { reward: (r) => ({ ...rewardWords(r), footer: rewardLine(r) }) },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { W, H, safe, shape } = e;
        const k = unitOf(e);
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        veil(e, 0.1);
        e.fade(0, 0, W, H * 0.22, 'top', 0.35);
        const top = H * (tall ? 0.4 : sq ? 0.27 : 0.33);
        e.fade(0, top - H * 0.2, W, H - top + H * 0.2, 'bottom', 0.85);
        const x0 = safe.l;
        const x1 = W - safe.r;
        const footTop = footRow(e, { x0, x1, bottom: H - safe.b, k });
        card(e, { x: x0, y: top, w: x1 - x0, h: footTop - (sq ? 34 : 48) * k - top }, k, { compact: sq });
    },
};
