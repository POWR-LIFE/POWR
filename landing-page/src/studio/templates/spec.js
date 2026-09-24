/**
 * SPEC — the photo annotated like a spec sheet: a bracketed label, leader
 * lines to a callout and to the subject itself, a sideways date, a wide
 * wordmark and a two-column info block. After the "Motion" poster, set dark
 * (POWR is always on dark).
 */
import { TYPE } from '../fonts';
import { fitBlock, drawBlock, drawText, splitLines, lineMetrics, parseLine, textWidth, capHeight } from '../text';
import { rule, dot, ring, bracket } from '../shapes';
import { twoLines } from '../words';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const subPxFor = (sq, u) => (sq ? 25 : 29) * u;

// Banner strip: bracketed label | wordmark with its under-labels | partner.
function strip(e) {
    const { ctx, W, H, safe, tu } = e;
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W, H, 'bottom', 0.45);
    const labelPx = 26 * tu;
    const labelText = `[ ${e.caps(e.fields.label)} ]`;
    const lx = safe.l + 8 * tu;
    const ly = H * 0.42;
    e.mark('label', drawText(ctx, labelText, TYPE.mono, labelPx, lx, ly, { tracking: 0.3, color: e.accent }));
    e.mark('note', drawText(ctx, e.caps(e.fields.note), TYPE.monoR, 13 * tu, lx + labelPx, ly + 28 * tu, { tracking: 0.06, color: e.accent, leading: 1.4 }));
    const wm = fitBlock(ctx, [e.caps(e.fields.headline)], e.headline, { maxW: W * 0.4 * (e.look.size ?? 1), maxH: H * 0.3 * (e.look.size ?? 1), gap: 0 });
    const wmTop = H * 0.3;
    e.shade({ x: W * 0.3, y: wmTop, w: W * 0.4, h: wm.cap }, { ceiling: 0.28, max: 0.55 });
    const [box] = drawBlock(ctx, wm, e.headline, W / 2, wmTop, { align: 'center', color: e.accent, accent: e.accent });
    e.mark('headline', box);
    const subPx = 20 * tu;
    const subBase = box.baseline + 18 * tu + capHeight(ctx, TYPE.wide, subPx);
    e.mark('subLeft', drawText(ctx, e.caps(e.fields.subLeft), TYPE.wide, subPx, box.x, subBase, { tracking: 0.3, color: e.accent }));
    const rw = textWidth(ctx, e.caps(e.fields.subRight), TYPE.wide, subPx, 0.3);
    e.mark('subRight', drawText(ctx, e.caps(e.fields.subRight), TYPE.wide, subPx, box.x + box.w - rw, subBase, { tracking: 0.3, color: e.accent }));
    const partner = e.caps(e.fields.partner).trim();
    if (partner) e.mark('partner', drawText(ctx, partner, TYPE.wide, 26 * tu, W - safe.r - 8 * tu, H * 0.42, { align: 'right', tracking: 0.16, color: e.ink }));
    e.mark('date', drawText(ctx, e.caps(e.fields.date), TYPE.mono, 16 * tu, W - safe.r - 8 * tu, H * 0.42 + 34 * tu, { align: 'right', tracking: 0.26, color: e.accent }));
    e.logo(e.ink, safe.l + 8 * tu, H - safe.b - 40 * tu, 54 * tu);
}

export default {
    id: 'spec',
    name: 'Spec',
    category: 'Events',
    blurb: 'Annotated like a spec sheet: brackets, leader lines, small print.',
    refs: 'Motion',
    headlineFont: 'wide',
    fields: [
        { key: 'label', label: 'Bracket label', value: 'Compete' },
        { key: 'note', label: 'Note under the label', rows: 2, value: '// Every minute on\nthe gym floor counts' },
        { key: 'callout', label: 'Callout', rows: 3, value: '001\nLive event\nFriday // Finals' },
        { key: 'date', label: 'Side date', value: '02.10.2026' },
        { key: 'headline', label: 'Wordmark', value: 'Compete.' },
        { key: 'subLeft', label: 'Under the wordmark, left', value: 'Live' },
        { key: 'subRight', label: 'Under the wordmark, right', value: 'London' },
        { key: 'infoLeft', label: 'Info, left', rows: 3, value: 'POWR and ONE LDN\npresent //\n“Friday Finals”' },
        { key: 'infoRight', label: 'Info, right', rows: 5, value: '* 02.10.2026\nONE LDN, London\n18:30 meet // 19:00 start\n* Join in the app //\npowr.life/app', hint: 'Start a line with * to hang an asterisk.' },
        { key: 'partner', label: 'Partner name', value: 'ONE LDN' },
    ],
    fill: {
        event: (ev) => ({
            callout: `001\nLive event\n${twoLines(ev.name, 6).replace('\n', ' // ')}`,
            date: ev.dots,
            subRight: ev.city || 'Live',
            infoLeft: `POWR${ev.venue ? ` and ${ev.venue}` : ''}\npresent //\n“${ev.name}”`,
            infoRight: [
                `* ${ev.dots}`,
                ev.venue ? `${ev.venue}${ev.city ? `, ${ev.city}` : ''}` : 'In the POWR app',
                ev.night ? `${ev.time24} doors${ev.close24 ? ` // ${ev.close24} close` : ''}` : ev.range,
                '* Join in the app //',
                'powr.life/app',
            ].join('\n'),
            partner: ev.venue,
        }),
    },
    look: {
        mono: 1, target: 0.2, auto: 0.8, contrast: 0.35, crush: 0.1, fade: 0.02,
        tint: 'warm', motion: 0.38, angle: -24, focus: 0.55, vignette: 0.7, grain: 0.65, size: 1,
    },

    draw(e) {
        if (e.shape === 'strip') return strip(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const focus = e.photo({ x: 0, y: 0, w: W, h: H });

        e.fade(0, 0, W, H * 0.22, 'top', 0.5);
        e.fade(0, H * (tall ? 0.56 : 0.58), W, H * (tall ? 0.44 : 0.42), 'bottom', 0.82);

        const logoW = 128 * u;
        e.logo(e.ink, W / 2 - logoW / 2, safe.t + 8 * u, logoW);

        // ── Bracketed label + note ─────────────────────────────────────────
        const labelPx = (sq ? 36 : 40) * u;
        const labelTrack = 0.3;
        const labelText = `[ ${e.caps(e.fields.label)} ]`;
        const labelX = W * 0.14;
        const labelBase = tall ? safe.t + H * 0.13 : sq ? H * 0.235 : H * 0.225;
        const lm = lineMetrics(ctx, parseLine(labelText), TYPE.mono, labelPx, labelTrack);
        const labelCap = capHeight(ctx, TYPE.mono, labelPx);
        e.shade({ x: labelX, y: labelBase - labelCap, w: lm.inkR, h: labelCap + 60 * u }, { ceiling: 0.26, max: 0.55 });
        e.mark('label', drawText(ctx, labelText, TYPE.mono, labelPx, labelX, labelBase, { tracking: labelTrack, color: e.accent }));
        const notePx = 16 * u;
        e.mark('note', drawText(ctx, e.caps(e.fields.note), TYPE.monoR, notePx, labelX + labelPx * 1.05, labelBase + 30 * u, {
            tracking: 0.06, color: e.accent, leading: 1.4,
        }));

        // ── Callout block on the right ─────────────────────────────────────
        const calloutPx = (sq ? 16 : 18) * u;
        const calloutLines = splitLines(e.caps(e.fields.callout)).slice(0, 4);
        const calloutW = textWidth(ctx, calloutLines.join('\n'), TYPE.mono, calloutPx, 0.05);
        // Hug the right margin, but never crowd the label's leader line.
        const calloutX = Math.max(W * 0.6, W - safe.r - 4 * u - calloutW - 14 * u);
        const calloutTop = labelBase + (tall ? 0.03 : 0.045) * H;
        const calloutH = calloutLines.length * calloutPx * 1.32 - calloutPx * 0.32;
        e.shade({ x: calloutX, y: calloutTop, w: calloutW + 14 * u, h: calloutH }, { ceiling: 0.26, max: 0.55 });
        e.mark('callout', drawText(ctx, calloutLines.join('\n'), TYPE.mono, calloutPx, calloutX + 14 * u, calloutTop + calloutPx * 0.78, {
            tracking: 0.05, color: e.accent, leading: 1.32,
        }));
        const bx = calloutX;
        bracket(ctx, bx, calloutTop - 5 * u, calloutH + 10 * u, 'right', 8 * u, e.accent, 2 * u);
        e.mark('callout', { x: bx - u, y: calloutTop - 6 * u, w: 10 * u, h: calloutH + 12 * u });

        // ── Leader lines: label → callout, subject → callout ───────────────
        const lw = 1.6 * u;
        const labelEnd = { x: labelX + lm.inkR + 14 * u, y: labelBase - labelCap / 2 };
        const pinA = { x: bx - 4 * u, y: calloutTop + calloutH * 0.22 };
        const pinB = { x: bx - 4 * u, y: calloutTop + calloutH * 0.78 };
        const subj = {
            x: clamp(focus.x, W * 0.3, W * 0.68),
            y: clamp(focus.y, calloutTop + calloutH + 0.04 * H, H * (tall ? 0.5 : 0.52)),
        };
        rule(ctx, labelEnd.x, labelEnd.y, pinA.x, pinA.y, e.accent, lw);
        rule(ctx, subj.x, subj.y, pinB.x, pinB.y, e.accent, lw);
        dot(ctx, subj.x, subj.y, 5.5 * u, e.accent);
        ring(ctx, subj.x, subj.y, 13 * u, e.accent, 1.3 * u);

        // ── Sideways date down the left edge ───────────────────────────────
        const datePx = (sq ? 26 : 30) * u;
        const dateTrack = 0.26;
        const date = e.caps(e.fields.date);
        const dateW = textWidth(ctx, date, TYPE.mono, datePx, dateTrack);
        const dx = safe.l * 0.55 + datePx * 0.9;
        const dy = H * (tall ? 0.56 : 0.6);
        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(-Math.PI / 2);
        const db = drawText(ctx, date, TYPE.mono, datePx, -dateW / 2, 0, { tracking: dateTrack, color: e.accent });
        ctx.restore();
        // Rotated −90°: local (x, y) lands at (dx + y, dy − x).
        if (db) e.mark('date', { x: dx + db.y, y: dy - db.x - db.w, w: db.h, h: db.w });

        // ── Wordmark with its two under-labels ─────────────────────────────
        const size = e.look.size ?? 1;
        const wm = fitBlock(ctx, [e.caps(e.fields.headline)], e.headline, {
            maxW: W * 0.68 * size, maxH: H * 0.11 * size, gap: 0,
        });
        const wmTop = tall ? H * 0.545 : sq ? H * 0.53 : H * 0.56;
        const wmH = wm.cap + 22 * u + subPxFor(sq, u);
        e.shade({ x: W * 0.16, y: wmTop, w: W * 0.68, h: wmH }, { ceiling: 0.28, max: 0.55 });
        const [wmBox] = drawBlock(ctx, wm, e.headline, W / 2, wmTop, { align: 'center', color: e.accent, accent: e.accent });
        e.mark('headline', wmBox);
        const subPx = subPxFor(sq, u);
        const subBase = wmBox.baseline + 22 * u + capHeight(ctx, TYPE.wide, subPx);
        const subTrack = 0.3;
        e.mark('subLeft', drawText(ctx, e.caps(e.fields.subLeft), TYPE.wide, subPx, wmBox.x, subBase, { tracking: subTrack, color: e.accent }));
        const rightW = textWidth(ctx, e.caps(e.fields.subRight), TYPE.wide, subPx, subTrack);
        e.mark('subRight', drawText(ctx, e.caps(e.fields.subRight), TYPE.wide, subPx, wmBox.x + wmBox.w - rightW, subBase, { tracking: subTrack, color: e.accent }));

        // ── Info block ─────────────────────────────────────────────────────
        const infoPx = (sq ? 18 : 21) * u;
        const lead = 1.3;
        const infoTop = tall ? H * 0.69 : sq ? H * 0.745 : H * 0.745;
        const leftX = W * 0.22;
        const rightX = W * 0.56;
        e.mark('infoLeft', drawText(ctx, e.caps(e.fields.infoLeft), TYPE.groteskB, infoPx, leftX, infoTop + infoPx, {
            tracking: -0.005, color: e.ink, leading: lead,
        }));
        let y = infoTop + infoPx;
        splitLines(e.caps(e.fields.infoRight)).forEach((line, i) => {
            const star = line.startsWith('*');
            if (star && i > 0) y += infoPx * 0.7;
            if (star) e.mark('infoRight', drawText(ctx, '*', TYPE.groteskB, infoPx, rightX - infoPx * 0.85, y, { color: e.ink }));
            e.mark('infoRight', drawText(ctx, star ? line.slice(1).trim() : line, i === 0 || star ? TYPE.groteskB : TYPE.grotesk, infoPx, rightX, y, {
                tracking: -0.005, color: e.ink,
            }));
            y += infoPx * lead;
        });

        // ── Partner mark ───────────────────────────────────────────────────
        const partner = e.caps(e.fields.partner);
        if (partner.trim()) {
            e.mark('partner', drawText(ctx, partner, TYPE.wide, (sq ? 30 : 34) * u, W / 2, H - safe.b - 6 * u, {
                align: 'center', tracking: 0.16, color: e.ink,
            }));
        }
    },
};
