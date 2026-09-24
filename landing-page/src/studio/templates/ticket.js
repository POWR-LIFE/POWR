/**
 * TICKET — an event poster built like a ticket: one giant word running up
 * the left edge, the event lockup and details (date, "(at)", "(time)") down
 * the right, a thin crop-mark frame, and a scannable QR to join in the app.
 * Made for screens and print at the gym as much as for the feed.
 */
import { TYPE } from '../fonts';
import { drawText, splitLines, parseLine, lineMetrics, paintLine, capHeight, textWidth } from '../text';
import { rule } from '../shapes';
import { drawQR } from '../qr';
import { twoLines } from '../words';

// Banners: the big word (up the side on 16:9, flat on a strip), the event
// and its details in a row, the QR on the right.
function banner(e) {
    const { ctx, W, H, safe, shape, tu } = e;
    const strip = shape === 'strip';
    e.photo({ x: 0, y: 0, w: W, h: H });
    e.fade(0, 0, W * 0.45, H, 'left', 0.45);
    const fx0 = safe.l * 0.8;
    const fx1 = W - safe.r * 0.8;
    const fy0 = safe.t * 0.9;
    const fy1 = H - safe.b * 0.9;
    const line = 'rgba(244,241,234,0.35)';
    rule(ctx, fx0, fy0, fx1, fy0, line, tu);
    rule(ctx, fx0, fy1, fx1, fy1, line, tu);
    [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]].forEach(([x, y]) => {
        ctx.fillStyle = 'rgba(244,241,234,0.5)';
        ctx.fillRect(x - 3 * tu, y - 3 * tu, 6 * tu, 6 * tu);
    });
    const segs = parseLine(e.caps(e.fields.side));
    const spec = e.headline;
    const size = e.look.size ?? 1;
    let colRight;
    if (strip) {
        // Flat, left, as big as the strip allows.
        const m200 = lineMetrics(ctx, segs, spec, 200, -0.02);
        const cap200 = capHeight(ctx, spec, 200);
        const px = Math.min((200 * W * 0.3 * size) / Math.max(1, m200.inkW), (200 * (fy1 - fy0) * 0.62 * size) / cap200);
        const m = lineMetrics(ctx, segs, spec, px, -0.02);
        const cap = capHeight(ctx, spec, px);
        const x = fx0 + 20 * tu;
        const base = (fy0 + fy1) / 2 + cap / 2;
        e.shade({ x, y: base - cap, w: m.inkW, h: cap }, { ceiling: 0.3, max: 0.6, form: 'left' });
        paintLine(ctx, segs, spec, px, x - m.inkL, base, { tracking: -0.02, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
        e.mark('side', { x, y: base - cap, w: m.inkW, h: cap });
        colRight = x + m.inkW;
    } else {
        const run = (fy1 - fy0) * 0.94 * size;
        const col = W * 0.14;
        const m200 = lineMetrics(ctx, segs, spec, 200, -0.02);
        const cap200 = capHeight(ctx, spec, 200);
        const px = Math.min((200 * run) / Math.max(1, m200.inkW), (200 * col) / cap200);
        const m = lineMetrics(ctx, segs, spec, px, -0.02);
        const cap = capHeight(ctx, spec, px);
        const baseX = fx0 + 20 * tu + cap;
        e.shade({ x: baseX - cap, y: fy0 + (fy1 - fy0 - m.inkW) / 2, w: cap, h: m.inkW }, { ceiling: 0.3, max: 0.7, form: 'left' });
        ctx.save();
        ctx.translate(baseX, fy1 - (fy1 - fy0 - m.inkW) / 2 + m.inkL);
        ctx.rotate(-Math.PI / 2);
        paintLine(ctx, segs, spec, px, 0, 0, { tracking: -0.02, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
        ctx.restore();
        e.mark('side', { x: baseX - cap, y: fy0 + (fy1 - fy0 - m.inkW) / 2, w: cap, h: m.inkW });
        colRight = baseX;
    }

    // QR, right.
    const qrText = String(e.fields.qr ?? '').trim();
    const q = Math.round((fy1 - fy0) * (strip ? 0.62 : 0.36));
    const qx = fx1 - 24 * tu - q;
    if (qrText) {
        const labPx = (strip ? 14 : 18) * tu;
        const bh = labPx * 1.8;
        const qy = fy1 - 24 * tu - q;
        const lab = e.fields.qrLabel ?? '';
        if (lab) {
            ctx.fillStyle = '#0B0B0B';
            ctx.fillRect(qx, qy - bh, q, bh);
            e.mark('qrLabel', drawText(ctx, lab, TYPE.monoR, labPx, qx + q / 2, qy - bh / 2 + labPx * 0.36, { align: 'center', color: e.ink }));
        }
        drawQR(ctx, qrText, qx, qy, q, { fg: '#0B0B0B', bg: e.ink, quiet: 2 });
        e.mark('qr', { x: qx, y: qy, w: q, h: q });
    }

    // Lockup, then date / (at) / (time) as a row beneath it.
    const lx = colRight + (strip ? 44 : 60) * tu;
    const lkPx = (strip ? 30 : 42) * tu;
    const lk = splitLines(e.fields.lockup);
    let y = fy0 + (strip ? 26 : 50) * tu + lkPx * 0.72;
    lk.forEach((l, i) => {
        drawText(ctx, i === 0 ? l : l.toUpperCase(), i === 0 ? TYPE.brandR : TYPE.groteskX, i === 0 ? lkPx * 0.9 : lkPx, lx, y, { tracking: i === 0 ? 0 : -0.02, color: e.ink });
        y += lkPx * 1.05;
    });
    e.mark('lockup', { x: lx, y: fy0 + (strip ? 26 : 50) * tu, w: qx - lx - 30 * tu, h: lk.length * lkPx * 1.05 });
    const dPx = (strip ? 21 : 30) * tu;
    const labelPx = dPx * 0.72;
    const cols = [['date', null], ['place', '(at)'], ['time', '(time)']].filter(([k]) => String(e.fields[k] ?? '').trim());
    const span = qx - 40 * tu - lx;
    const cw = span / Math.max(cols.length, 1);
    const rowTop = y + (strip ? 10 : 40) * tu;
    cols.forEach(([k, label], i) => {
        const cx = lx + i * cw;
        let yy = rowTop + labelPx;
        drawText(ctx, label ?? '(date)', TYPE.monoR, labelPx, cx, yy, { color: 'rgba(244,241,234,0.72)' });
        yy += dPx * 1.25;
        const text = splitLines(e.fields[k]).join(strip ? ' ' : '\n');
        e.mark(k, drawText(ctx, text, TYPE.brandR, dPx, cx, yy, { color: e.ink, leading: 1.15 }));
    });
    e.logo(e.ink, qx + q - (strip ? 50 : 72) * tu, fy0 + 20 * tu, (strip ? 50 : 72) * tu);
}

export default {
    id: 'ticket',
    name: 'Ticket',
    category: 'Events',
    blurb: 'Event poster: a giant word up the side, the details, and a QR to join in the app.',
    refs: 'Own the Way',
    headlineFont: 'groteskX',
    fields: [
        { key: 'side', label: 'Side word', value: 'Compete _live_', hint: 'Runs up the left edge. _Underscores_ italicise.' },
        { key: 'lockup', label: 'Event', rows: 2, value: 'Road to\nFriday Finals' },
        { key: 'date', label: 'Date', rows: 3, value: 'Fri,\n02 Oct\n2026' },
        { key: 'place', label: '(at)', rows: 2, value: 'ONE LDN,\nLondon' },
        { key: 'time', label: '(time)', value: '19:00' },
        { key: 'qrLabel', label: 'QR label', value: 'Join in the app' },
        { key: 'qr', label: 'QR link', value: 'https://powr.life/app', hint: 'Leave empty to drop the QR.' },
    ],
    // The words an event gives it (see data.js for the event's facts).
    fill: {
        event: (ev) => ({
            // The lockup's first line is the small kicker; the name sets big under it.
            lockup: `Live event\n${twoLines(ev.name, 14)}`,
            date: ev.night ? `${ev.weekday},\n${ev.day} ${ev.month}\n${ev.year}` : `${ev.rangeFrom} –\n${ev.rangeTo}\n${ev.year}`,
            place: ev.venue ? [ev.city ? `${ev.venue},` : ev.venue, ev.city].filter(Boolean).join('\n') : 'In the\nPOWR app',
            time: ev.night ? ev.time24 : `${ev.days} days`,
            qr: ev.joinUrl,
            qrLabel: 'Join in the app',
        }),
    },
    presets: [
        { name: 'Event night', fields: { side: 'Compete _live_', lockup: 'Road to\nFriday Finals', qrLabel: 'Join in the app' } },
        { name: 'Open gym', fields: { side: 'Open _floor_', lockup: 'POWR open\ngym night', qrLabel: 'Book your spot' } },
        { name: 'Launch', fields: { side: 'Now _live_', lockup: 'POWR at\nyour gym', date: 'From\ntoday', place: 'Your gym,\nfloor', time: 'Any time', qrLabel: 'Get the app' } },
    ],
    look: {
        mono: 1, target: 0.3, auto: 0.85, contrast: 0.4, crush: 0.1, fade: 0,
        tint: 'none', motion: 0.4, angle: -8, focus: 0.5, vignette: 0.45, grain: 0.55, size: 1,
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        e.photo({ x: 0, y: 0, w: W, h: H });
        e.fade(0, 0, W, H * 0.3, 'top', 0.35);
        e.fade(0, H * 0.6, W, H * 0.4, 'bottom', 0.5);

        // Thin crop-mark frame.
        const fx0 = safe.l * 0.9;
        const fx1 = W - safe.r * 0.9;
        const fy0 = safe.t * (tall ? 0.9 : 1.1);
        const fy1 = H - safe.b * (tall ? 0.9 : 1.1);
        const line = 'rgba(244,241,234,0.35)';
        rule(ctx, fx0, fy0, fx1, fy0, line, u);
        rule(ctx, fx0, fy0, fx0, fy1, line, u);
        rule(ctx, fx1, fy0, fx1, fy1, line, u);
        [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]].forEach(([x, y]) => {
            ctx.fillStyle = 'rgba(244,241,234,0.5)';
            ctx.fillRect(x - 3 * u, y - 3 * u, 6 * u, 6 * u);
        });

        // ── Side word up the left edge ─────────────────────────────────────
        const segs = parseLine(e.caps(e.fields.side));
        const spec = e.headline;
        const size = e.look.size ?? 1;
        const run = (fy1 - fy0) * 0.96 * size;
        const col = W * (sq ? 0.2 : 0.22);
        const m200 = lineMetrics(ctx, segs, spec, 200, -0.02);
        const cap200 = capHeight(ctx, spec, 200);
        const px = Math.min((200 * run) / Math.max(1, m200.inkW), (200 * col) / cap200);
        const m = lineMetrics(ctx, segs, spec, px, -0.02);
        const cap = capHeight(ctx, spec, px);
        const baseX = fx0 + 18 * u + cap; // rotated: the baseline is the column's right side
        e.shade({ x: baseX - cap, y: fy0 + (fy1 - fy0 - m.inkW) / 2, w: cap, h: m.inkW }, { ceiling: 0.3, max: 0.7, form: 'left' });
        ctx.save();
        ctx.translate(baseX, fy1 - (fy1 - fy0 - m.inkW) / 2 + m.inkL);
        ctx.rotate(-Math.PI / 2);
        paintLine(ctx, segs, spec, px, 0, 0, { tracking: -0.02, color: e.headlineAccent ? e.accent : e.ink, accent: e.accent });
        ctx.restore();
        e.mark('side', { x: baseX - cap, y: fy0 + (fy1 - fy0 - m.inkW) / 2, w: cap, h: m.inkW });

        // ── Lockup + details, right column ─────────────────────────────────
        const rx = fx1 - 24 * u;
        const lx = Math.max(baseX + 40 * u, W * 0.4);
        const lk = splitLines(e.fields.lockup);
        const lkPx = (sq ? 40 : 46) * u;
        let y = fy0 + 44 * u + lkPx * 0.72;
        const lkW = Math.max(0, ...lk.map((l, i) => textWidth(ctx, i === 0 ? l : l.toUpperCase(), i === 0 ? TYPE.brandR : TYPE.groteskX, i === 0 ? lkPx * 0.9 : lkPx)));
        e.shade({ x: lx, y: y - lkPx * 0.8, w: lkW, h: lk.length * lkPx * 1.05 }, { ceiling: 0.3, max: 0.55 });
        let lkBox = null;
        lk.forEach((l, i) => {
            const b = drawText(ctx, i === 0 ? l : l.toUpperCase(), i === 0 ? TYPE.brandR : TYPE.groteskX, i === 0 ? lkPx * 0.9 : lkPx, lx, y, {
                tracking: i === 0 ? 0 : -0.02, color: e.ink,
            });
            if (b) lkBox = lkBox ? { x: lkBox.x, y: lkBox.y, w: Math.max(lkBox.w, b.x + b.w - lkBox.x), h: b.y + b.h - lkBox.y } : b;
            y += lkPx * 1.05;
        });
        e.mark('lockup', lkBox);

        const dPx = (sq ? 30 : 36) * u;
        const lead = 1.18;
        const labelPx = dPx * 0.72;
        y = fy0 + (tall ? 0.3 : sq ? 0.36 : 0.34) * (fy1 - fy0);
        const detail = (key, label) => {
            const text = e.fields[key];
            if (!String(text ?? '').trim()) return;
            // Shade the whole entry (label + text) if the photo behind is bright.
            const n = splitLines(text).length;
            const entryH = (label ? dPx * 1.2 : 0) + n * dPx * lead;
            const entryW = Math.max(textWidth(ctx, text, TYPE.brandR, dPx), label ? textWidth(ctx, label, TYPE.monoR, labelPx) : 0);
            e.shade({ x: rx - entryW, y: y - (label ? labelPx : dPx) * 0.8, w: entryW, h: entryH }, { ceiling: 0.3, max: 0.6, spread: 1.15 });
            if (label) {
                drawText(ctx, label, TYPE.monoR, labelPx, rx, y, { align: 'right', color: 'rgba(244,241,234,0.72)' });
                y += dPx * 1.2;
            }
            e.mark(key, drawText(ctx, text, TYPE.brandR, dPx, rx, y, { align: 'right', color: e.ink, leading: lead }));
            y += splitLines(text).length * dPx * lead + dPx * 0.9;
        };
        detail('date', null);
        detail('place', '(at)');
        detail('time', '(time)');

        // ── QR block, bottom right ─────────────────────────────────────────
        const qrText = String(e.fields.qr ?? '').trim();
        if (qrText) {
            const q = Math.round(W * (sq ? 0.2 : 0.22));
            const qx = rx - q;
            const qy = fy1 - 26 * u - q;
            const lab = e.fields.qrLabel ?? '';
            const labPx = (sq ? 17 : 19) * u;
            if (lab) {
                const bh = labPx * 1.8;
                ctx.fillStyle = '#0B0B0B';
                ctx.fillRect(qx, qy - bh, q, bh);
                e.mark('qrLabel', drawText(ctx, lab, TYPE.monoR, labPx, qx + q / 2, qy - bh / 2 + labPx * 0.36, { align: 'center', color: e.ink }));
            }
            drawQR(ctx, qrText, qx, qy, q, { fg: '#0B0B0B', bg: e.ink, quiet: 2 });
            e.mark('qr', { x: qx, y: qy, w: q, h: q });
        }

        e.logo(e.ink, rx - 84 * u, fy0 + 26 * u, 84 * u);
    },
};
