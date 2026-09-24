/**
 * PARTNER — the Founding Partner series as a template: an outlined category
 * label, a three-line headline with one word in the partner's colour, the
 * reward small print, and the partner's wordmark turned on its side down the
 * right. Works with no photo at all (charcoal), or a photo sunk into the dark.
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, textWidth, blockBox, capHeight } from '../text';
import { drawContained, tinted, inkLuma } from '../assets';
import { rule, dot } from '../shapes';
import { thousands, titleCase } from '../words';

const PRESETS = [
    { name: 'Eat', fields: { label: 'Founding partner — Eat', headline: 'Feed\n{The}\nMove' }, style: { accent: '#1E8FD8' } },
    { name: 'Move', fields: { label: 'Founding partner — Move', headline: 'Sweat\n{Glow}\nRepeat' }, style: { accent: '#E8E23A' } },
    { name: 'Recover', fields: { label: 'Founding partner — Recover', headline: 'Rest\n{Is}\nTraining' }, style: { accent: '#7DD3C0' } },
    { name: 'Wear', fields: { label: 'Founding partner — Wear', headline: 'Built\n{For}\nThe Floor' }, style: { accent: '#F4F1EA' } },
];

// A short brand line as the three-line headline, middle word in colour:
// "Dessert built different" → Dessert / {Built} / Different.
function slogan(text) {
    const words = titleCase(String(text ?? '').replace(/[.!]+$/, '')).split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return null;
    return [words[0], `{${words[1]}}`, words.slice(2).join(' ')].filter(Boolean).join('\n');
}

// The partner's mark in `box` — the uploaded logo, or their name set heavy.
function partnerMark(e, box, turn) {
    const { ctx } = e;
    const logo = e.asset('logo');
    if (logo) {
        const mode = e.look.logoColor === 'auto' ? (inkLuma(logo) < 0.35 ? 'white' : 'original') : e.look.logoColor;
        const img = mode === 'white' ? tinted(logo, e.ink) : mode === 'accent' ? tinted(logo, e.accent) : logo;
        e.mark('logo', drawContained(ctx, img, box, { rotate: turn && logo.width > logo.height * 1.15, align: 'center' }));
        return;
    }
    const name = e.caps(e.fields.partnerName).trim() || 'PARTNER';
    let px = 200;
    const w200 = textWidth(ctx, name, TYPE.heavy, px, -0.01);
    const cap200 = capHeight(ctx, TYPE.heavy, px);
    px = Math.min((px * box.w) / w200, (px * box.h * 0.9) / cap200);
    const tw = textWidth(ctx, name, TYPE.heavy, px, -0.01);
    const cap = capHeight(ctx, TYPE.heavy, px);
    drawText(ctx, name, TYPE.heavy, px, box.x + box.w / 2, box.y + box.h / 2 + cap / 2, { align: 'center', tracking: -0.01, color: e.ink });
    e.mark('partnerName', { x: box.x + box.w / 2 - tw / 2, y: box.y + box.h / 2 - cap / 2, w: tw, h: cap });
}

// Banner strip: label + headline | the reward | the partner's mark.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    ctx.fillStyle = e.hasMedia ? 'rgba(20,20,22,0.6)' : 'rgba(28,28,30,0.35)';
    ctx.fillRect(0, 0, W, H);
    const x0 = safe.l;
    const labPx = 15 * tu;
    const lab = e.caps(e.fields.label);
    const labW = textWidth(ctx, lab, TYPE.brandM, labPx, 0.24);
    const boxH = labPx * 2.2;
    ctx.save();
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = 2 * tu;
    ctx.strokeRect(x0, safe.t, labW + 24 * tu, boxH);
    ctx.restore();
    e.mark('label', drawText(ctx, lab, TYPE.brandM, labPx, x0 + 12 * tu, safe.t + boxH / 2 + labPx * 0.36, { tracking: 0.24, color: e.ink }));
    const lines = splitLines(e.fields.headline).slice(0, 3);
    const block = fitBlock(ctx, lines, e.headline, { maxW: W * 0.24 * (e.look.size ?? 1), maxH: (H - safe.t - boxH - safe.b - 24 * tu) * (e.look.size ?? 1), gap: 0.3 });
    const heads = drawBlock(ctx, block, e.headline, x0, safe.t + boxH + 24 * tu, { align: 'left', color: e.ink, accent: e.accent });
    e.mark('headline', blockBox(heads));
    // Middle column: the reward.
    const mx = W * 0.34;
    const sPx = 19 * tu;
    const grey = 'rgba(244,241,234,0.62)';
    let y = H * 0.3;
    ctx.fillStyle = e.accent;
    ctx.fillRect(mx, y - 30 * tu, W * 0.1, 3 * tu);
    e.mark('info', drawText(ctx, e.fields.info, TYPE.brandR, sPx, mx, y, { tracking: 0.14, color: grey, leading: 1.4 }));
    y += splitLines(e.fields.info).length * sPx * 1.4 + sPx * 0.5;
    e.mark('reward', drawText(ctx, e.caps(e.fields.reward), TYPE.brandB, sPx, mx, y, { tracking: 0.2, color: e.accent }));
    y += sPx * 1.4;
    e.mark('rewardNote', drawText(ctx, e.fields.rewardNote, TYPE.brandR, sPx, mx, y, { tracking: 0.14, color: grey }));
    e.logo(e.ink, mx, H - safe.b - 44 * tu, 60 * tu);
    partnerMark(e, { x: W * 0.58, y: safe.t + 8 * tu, w: W - safe.r - W * 0.58, h: H - safe.t - safe.b - 16 * tu }, false);
}

export default {
    id: 'partner',
    name: 'Partner',
    category: 'Partners',
    blurb: 'A reward drop: category label, three-line headline, the partner’s logo turned down the side.',
    refs: 'Founding Partner',
    headlineFont: 'brandR',
    photo: 'optional', // designed to work on its own charcoal ground
    fields: [
        { key: 'label', label: 'Label', value: 'Founding partner — Eat' },
        { key: 'headline', label: 'Headline', rows: 3, value: 'Feed\n{The}\nMove', hint: '{Braces} put a word in the accent colour — set it to the partner’s.' },
        { key: 'logo', label: 'Partner logo', type: 'image', hint: 'PNG with transparency is best. A logo on plain white or black is cleaned up automatically.' },
        { key: 'partnerName', label: 'Partner name (shown if there’s no logo)', value: 'Partner' },
        { key: 'info', label: 'Small print', rows: 2, value: 'Now in the POWR\nrewards catalogue.' },
        { key: 'reward', label: 'Reward line', value: 'Your reward' },
        { key: 'rewardNote', label: 'Under the reward', value: 'Unlocks in the app.' },
        { key: 'link', label: 'Link line', value: 'powr.life — link in bio' },
        { key: 'cta', label: 'Footer', value: 'Download the app — link in bio' },
    ],
    // The words a reward gives it (see data.js for the reward's facts).
    fill: {
        reward: (r) => {
            // Their description as the headline when it reads like a tagline
            // ("Dessert built different"), not an offer ("Site-wide discount");
            // otherwise the series line for their category.
            const offerish = /\d|%|discount|\boff\b|free|sale|deal|save/i.test(r.description);
            const line = (!offerish && r.description.toLowerCase() !== r.brand.toLowerCase() && slogan(r.description))
                || PRESETS.find((p) => p.name === r.category)?.fields.headline;
            return {
                label: `POWR partner${r.category ? ` — ${r.category}` : ''}`,
                partnerName: r.brand,
                ...(line ? { headline: line } : {}),
                reward: r.value ? `${r.value} ${r.unit}`.trim() : 'Your reward',
                rewardNote: r.cost ? `For ${thousands(r.cost)} points in the app.` : 'Unlocks in the app.',
            };
        },
    },
    presets: PRESETS,
    look: {
        mono: 1, target: 0.12, auto: 0.8, contrast: 0.3, crush: 0.2, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.6, vignette: 0.8, grain: 0.35, printGrain: 0.035, size: 1,
        logoTurn: 'turn', logoColor: 'auto',
    },
    controls: [
        { key: 'logoTurn', label: 'Logo', options: [['turn', 'Turned (reads up)'], ['upright', 'Upright']] },
        { key: 'logoColor', label: 'Logo colour', options: [['auto', 'Auto'], ['original', 'Original'], ['white', 'White'], ['accent', 'Accent']] },
    ],

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const x0 = Math.max(safe.l, W * 0.056);
        const grey = 'rgba(244,241,234,0.62)';

        // The photo (if any) sinks into charcoal; without one this is the
        // series' flat dark ground.
        e.photo({ x: 0, y: 0, w: W, h: H });
        ctx.fillStyle = e.hasMedia ? 'rgba(20,20,22,0.55)' : 'rgba(28,28,30,0.35)';
        ctx.fillRect(0, 0, W, H);

        // ── Outlined label ─────────────────────────────────────────────────
        const labPx = (sq ? 19 : 21) * u;
        const lab = e.caps(e.fields.label);
        const labW = textWidth(ctx, lab, TYPE.brandM, labPx, 0.24);
        const padX = 16 * u;
        const boxH = labPx * 2.3;
        const boxY = safe.t + (tall ? 36 : 22) * u;
        ctx.save();
        ctx.strokeStyle = e.accent;
        ctx.lineWidth = 2.4 * u;
        ctx.strokeRect(x0, boxY, labW + padX * 2, boxH);
        ctx.restore();
        e.mark('label', drawText(ctx, lab, TYPE.brandM, labPx, x0 + padX, boxY + boxH / 2 + labPx * 0.36, { tracking: 0.24, color: e.ink }));

        // ── Headline ───────────────────────────────────────────────────────
        const size = e.look.size ?? 1;
        const lines = splitLines(e.fields.headline).slice(0, 4);
        const block = fitBlock(ctx, lines, e.headline, {
            maxW: W * 0.44 * size,
            maxH: H * (tall ? 0.24 : sq ? 0.3 : 0.28) * size,
            gap: 0.34,
        });
        const headTop = boxY + boxH + H * (tall ? 0.09 : 0.1);
        const heads = drawBlock(ctx, block, e.headline, x0, headTop, { align: 'left', color: e.ink, accent: e.accent });
        e.mark('headline', blockBox(heads));
        const headBottom = heads[heads.length - 1].baseline;

        // ── Rule + small print ─────────────────────────────────────────────
        const ruleY = headBottom + H * (sq ? 0.05 : 0.055);
        ctx.fillStyle = e.accent;
        ctx.fillRect(x0 + 8 * u, ruleY, W * 0.2, 3 * u);

        const sPx = (sq ? 20 : 23) * u;
        const lead = 1.45;
        let y = ruleY + H * (sq ? 0.07 : 0.075);
        const infoBox = drawText(ctx, e.fields.info, TYPE.brandR, sPx, x0 + 8 * u, y, { tracking: 0.16, color: grey, leading: lead });
        e.mark('info', infoBox);
        y += splitLines(e.fields.info).length * sPx * lead + sPx * 0.9;
        e.mark('reward', drawText(ctx, e.caps(e.fields.reward), TYPE.brandB, sPx, x0 + 8 * u, y, { tracking: 0.2, color: e.accent }));
        y += sPx * lead;
        e.mark('rewardNote', drawText(ctx, e.fields.rewardNote, TYPE.brandR, sPx, x0 + 8 * u, y, { tracking: 0.16, color: grey }));
        y += sPx * lead + sPx * 0.9;
        e.mark('link', drawText(ctx, e.fields.link, TYPE.brandR, sPx * 0.95, x0 + 8 * u, y, { tracking: 0.14, color: 'rgba(244,241,234,0.5)' }));

        // ── Partner mark down the right ────────────────────────────────────
        const turn = e.look.logoTurn !== 'upright';
        const boxTop = boxY + (tall ? H * 0.02 : 0);
        const boxRight = Math.min(W * 0.94, W - safe.r);
        const box = { x: W * 0.54, y: boxTop, w: boxRight - W * 0.54, h: H - safe.b - 150 * u - boxTop };
        const logo = e.asset('logo');
        if (logo) {
            // Auto: a dark logo (most arrive black-on-white) goes white on the
            // dark ground; a light or colourful one keeps its own colours.
            const mode = e.look.logoColor === 'auto' ? (inkLuma(logo) < 0.35 ? 'white' : 'original') : e.look.logoColor;
            const img = mode === 'white' ? tinted(logo, e.ink) : mode === 'accent' ? tinted(logo, e.accent) : logo;
            e.mark('logo', drawContained(ctx, img, box, { rotate: turn && logo.width > logo.height * 1.15, align: 'center' }));
        } else {
            // No logo yet: the partner's name, set heavy, stands in.
            const name = e.caps(e.fields.partnerName).trim() || 'PARTNER';
            const long = turn ? box.h : box.w;
            const short = turn ? box.w : box.h;
            let px = 200;
            const w200 = textWidth(ctx, name, TYPE.heavy, px, -0.01);
            const cap200 = capHeight(ctx, TYPE.heavy, px);
            px = Math.min((px * long) / w200, (px * short * 0.9) / cap200);
            const tw = textWidth(ctx, name, TYPE.heavy, px, -0.01);
            const cap = capHeight(ctx, TYPE.heavy, px);
            ctx.save();
            if (turn) {
                const cx = box.x + box.w / 2;
                ctx.translate(cx + cap / 2, box.y + box.h / 2 + tw / 2);
                ctx.rotate(-Math.PI / 2);
                drawText(ctx, name, TYPE.heavy, px, 0, 0, { tracking: -0.01, color: e.ink });
                ctx.restore();
                e.mark('partnerName', { x: cx - cap / 2, y: box.y + box.h / 2 - tw / 2, w: cap, h: tw });
            } else {
                drawText(ctx, name, TYPE.heavy, px, box.x + box.w / 2, box.y + box.h / 2 + cap / 2, { align: 'center', tracking: -0.01, color: e.ink });
                ctx.restore();
                e.mark('partnerName', { x: box.x + box.w / 2 - tw / 2, y: box.y + box.h / 2 - cap / 2, w: tw, h: cap });
            }
        }

        // ── Footer: hairline, POWR, download line ──────────────────────────
        const footY = H - safe.b - 96 * u;
        rule(ctx, x0, footY, W - x0, footY, 'rgba(244,241,234,0.16)', 1.2 * u);
        e.logo(e.ink, x0, footY + 30 * u, 92 * u);
        const ctaPx = (sq ? 17 : 19) * u;
        const cta = e.fields.cta;
        const ctaW = textWidth(ctx, cta, TYPE.brandR, ctaPx, 0.12);
        const ctaBase = footY + 30 * u + 36 * u;
        e.mark('cta', drawText(ctx, cta, TYPE.brandR, ctaPx, W - x0 - ctaW, ctaBase, { tracking: 0.12, color: e.ink }));
        dot(ctx, W - x0 - ctaW - 16 * u, ctaBase - ctaPx * 0.34, 5 * u, '#34D399');
    },
};
