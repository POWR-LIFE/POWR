/**
 * ROUTE — an abstract route line over the photo: a smooth loop (or an A-to-B
 * line) drawn from the route's name, so the same name always draws the same
 * route. Start and finish dots, kilometre markers along it, an elevation
 * profile, then distance, climb and one more stat. For running and cycling
 * brands and clubs.
 */
import { TYPE } from '../../../fonts';
import { drawText, capHeight, splitLines, fitBlock, drawBlock, blockBox } from '../../../text';
import { rule, dot, ring } from '../../../shapes';
import { BRAND_FIELDS, rewardWords } from '../kit';
import { GREY, SOFT, HAIR, topRow, mono, unitOf, fitPx, seeded, rowsOf } from './_parts';

// The route's points (unit space), smooth and deterministic from the seed.
function path(seedText, loop) {
    const rnd = seeded(seedText);
    const N = 260;
    const pts = [];
    if (loop) {
        // Low harmonics give the loop its shape; a few small high ones give
        // it the kinks of real streets.
        const h = [2, 3, 4, 5, 7, 9, 12].map((k) => ({ k, a: k <= 5 ? (0.06 + rnd() * 0.16) / (k * 0.5) : 0.008 + rnd() * 0.018, p: rnd() * Math.PI * 2 }));
        const sx = 0.72 + rnd() * 0.56;
        for (let i = 0; i < N; i++) {
            const t = (i / N) * Math.PI * 2;
            let r = 1;
            h.forEach(({ k, a, p }) => { r += a * Math.sin(k * t + p); });
            r = Math.max(0.35, r);
            pts.push([Math.cos(t) * r * sx, Math.sin(t) * r]);
        }
    } else {
        const h = [1, 2, 3, 5, 8, 11].map((k) => ({ k, a: k <= 5 ? (0.14 + rnd() * 0.22) / Math.sqrt(k) : 0.01 + rnd() * 0.02, p: rnd() * Math.PI * 2 }));
        const w = [2, 3].map((k) => ({ k, a: 0.03 + rnd() * 0.05, p: rnd() * Math.PI * 2 }));
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            let y = 0;
            let x = t;
            h.forEach(({ k, a, p }) => { y += a * Math.sin(k * Math.PI * t + p); });
            w.forEach(({ k, a, p }) => { x += a * Math.sin(k * Math.PI * t + p) * Math.sin(Math.PI * t); });
            pts.push([x, y]);
        }
    }
    // A slight turn so no two routes sit square to the frame the same way.
    const ang = (rnd() - 0.5) * 1.1;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { pts: pts.map(([x, y]) => [x * c - y * s, x * s + y * c]), rnd };
}

const km = (e) => {
    const m = String(e.fields.distance ?? '').replace(',', '.').match(/[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
};

// Fit the points into `box` (keeping their shape) and draw the route with
// its markers. Returns the drawn box.
function drawRoute(e, box) {
    const { ctx } = e;
    const k = unitOf(e);
    const loop = (e.look.route ?? 'loop') === 'loop';
    const { pts, rnd } = path(`${e.fields.name}|${e.look.route}`, loop);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
    const ox = box.x + (box.w - (maxX - minX) * s) / 2 - minX * s;
    const oy = box.y + (box.h - (maxY - minY) * s) / 2 - minY * s;
    const P = pts.map(([x, y]) => [ox + x * s, oy + y * s]);
    if (loop) P.push(P[0]);

    const trace = () => {
        ctx.beginPath();
        P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 16 * k;
    trace();
    ctx.stroke();
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = 5 * k;
    trace();
    ctx.stroke();
    ctx.restore();

    // Kilometre markers at equal lengths along the line.
    const D = km(e);
    const seg = [0];
    for (let i = 1; i < P.length; i++) seg.push(seg[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = seg[seg.length - 1];
    if (D > 0) {
        const every = D <= 16 ? 1 : D <= 40 ? 5 : D <= 120 ? 10 : 25;
        const mPx = 14 * k;
        let j = 1;
        for (let d = every; d < D - every * 0.4; d += every) {
            const target = (d / D) * L;
            while (j < seg.length - 1 && seg[j] < target) j++;
            const f = (target - seg[j - 1]) / Math.max(1e-6, seg[j] - seg[j - 1]);
            const x = P[j - 1][0] + (P[j][0] - P[j - 1][0]) * f;
            const y = P[j - 1][1] + (P[j][1] - P[j - 1][1]) * f;
            // Outward normal for the label (away from the route's middle).
            const dx = P[j][0] - P[j - 1][0];
            const dy = P[j][1] - P[j - 1][1];
            const len = Math.hypot(dx, dy) || 1;
            let nx = -dy / len;
            let ny = dx / len;
            const mx = box.x + box.w / 2;
            const my = box.y + box.h / 2;
            if ((x - mx) * nx + (y - my) * ny < 0) { nx = -nx; ny = -ny; }
            dot(ctx, x, y, 7 * k, '#0B0B0B');
            ring(ctx, x, y, 7 * k, e.ink, 2.2 * k);
            const lx = x + nx * 24 * k;
            const ly = y + ny * 24 * k;
            drawText(ctx, String(d), TYPE.mono, mPx, lx, ly + mPx * 0.36, { align: nx > 0.35 ? 'left' : nx < -0.35 ? 'right' : 'center', color: SOFT });
        }
    }
    // Start (and finish): an accent ring; a separate finish is a filled dot.
    const [sx, sy] = P[0];
    dot(ctx, sx, sy, 14 * k, '#0B0B0B');
    ring(ctx, sx, sy, 13 * k, e.accent, 4 * k);
    dot(ctx, sx, sy, 4.5 * k, e.ink);
    if (!loop) {
        const [fx, fy] = P[P.length - 1];
        dot(ctx, fx, fy, 14 * k, e.accent);
        dot(ctx, fx, fy, 5 * k, '#0B0B0B');
    }
    const r = rnd();
    return { x: box.x, y: box.y, w: box.w, h: box.h, r };
}

// The elevation profile: a filled line in x0..x1 from base up to h.
function profile(e, x0, x1, base, h) {
    const { ctx } = e;
    const k = unitOf(e);
    const rnd = seeded(`${e.fields.name}|elev`);
    const waves = [1, 2, 3, 6, 11].map((f) => ({ f, a: rnd() / f ** 0.8, p: rnd() * Math.PI * 2 }));
    const n = 120;
    const vals = [];
    for (let i = 0; i <= n; i++) {
        let v = 0;
        waves.forEach(({ f, a, p }) => { v += a * Math.sin(f * Math.PI * (i / n) + p); });
        vals.push(v);
    }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const Y = (v) => base - 2 * k - ((v - lo) / (hi - lo || 1)) * (h - 2 * k);
    const X = (i) => x0 + ((x1 - x0) * i) / n;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, base);
    vals.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
    ctx.lineTo(x1, base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(244,241,234,0.1)';
    ctx.fill();
    ctx.beginPath();
    vals.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = 'rgba(244,241,234,0.62)';
    ctx.lineWidth = 2 * k;
    ctx.stroke();
    ctx.restore();
    rule(ctx, x0, base, x1, base, HAIR, Math.max(1, 1.2 * k));
}

// Distance · Elevation · the extra stat, as labelled columns in x0..x1.
// `vertical` stacks them. Returns the block's bottom.
function stats(e, x0, x1, top, px, labPx, { vertical = false } = {}) {
    const k = unitOf(e);
    const extra = rowsOf(e.fields.extra)[0] ?? [];
    const items = [
        ['distance', 'Distance', e.fields.distance],
        ['elevation', 'Elevation', e.fields.elevation],
        ['extra', extra.length > 1 ? extra[0] : '', extra.length > 1 ? extra.slice(1).join(' ') : extra[0]],
    ].filter(([, , v]) => String(v ?? '').trim());
    const n = items.length;
    const colW = vertical ? x1 - x0 : (x1 - x0) / Math.max(1, n);
    const cap = capHeight(e.ctx, TYPE.brandL, px);
    const rowH = labPx + 14 * k + cap;
    items.forEach(([key, lab, v], i) => {
        const x = vertical ? x0 : x0 + i * colW;
        const y = vertical ? top + i * (rowH + 22 * k) : top;
        if (lab) mono(e, lab, x, y + labPx * 0.75, labPx, { color: GREY, maxW: colW - 20 * k });
        const p = fitPx(e.ctx, String(v), TYPE.brandL, px, colW - 24 * k);
        e.mark(key, drawText(e.ctx, String(v).trim(), TYPE.brandL, p, x, y + labPx + 14 * k + cap, { color: e.ink }));
    });
    return vertical ? top + n * (rowH + 22 * k) : top + rowH;
}

// The route's name, set in the headline face. Returns the block's box.
function title(e, x, top, maxW, maxH) {
    const lines = splitLines(e.fields.name).slice(0, 2);
    if (!lines.length) return { x, y: top, w: 0, h: 0 };
    const block = fitBlock(e.ctx, lines, e.headline, { maxW, maxH, gap: 0.14 });
    const box = blockBox(drawBlock(e.ctx, block, e.headline, x, top, { align: 'left', color: e.headlineAccent ? e.accent : e.ink, accent: e.accent }));
    e.mark('name', box);
    return box;
}

function banner(e) {
    const { ctx, W, H, safe, shape } = e;
    const strip = shape === 'strip';
    const k = unitOf(e);
    e.photo({ x: 0, y: 0, w: W, h: H });
    ctx.fillStyle = 'rgba(8,8,8,0.3)';
    ctx.fillRect(0, 0, W, H);
    e.fade(0, 0, W * 0.6, H, 'left', 0.8);
    const x0 = safe.l;
    const x1 = W - safe.r;
    const y0 = safe.t;
    const y1 = H - safe.b;
    const size = e.look.size ?? 1;
    if (strip) {
        topRow(e, x0, W * 0.36, y0, 42 * k, { px: 14 * k });
        title(e, x0, y0 + 90 * k, W * 0.3 * size, (y1 - y0 - 90 * k) * 0.8 * size);
        drawRoute(e, { x: W * 0.42, y: y0 + 10 * k, w: W * 0.26, h: y1 - y0 - 20 * k });
        stats(e, W * 0.74, x1, y0 + 6 * k, 30 * k, 13 * k, { vertical: true });
        return;
    }
    topRow(e, x0, W * 0.44, y0, 56 * k, { px: 16 * k });
    const t = title(e, x0, y0 + 150 * k, W * 0.38 * size, H * 0.26 * size);
    const lPx = 28 * k;
    const lb = t.y + t.h + 40 * k + lPx * 0.72;
    e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, W * 0.4), x0, lb, { color: SOFT }));
    const profH = 70 * k;
    const statTop = y1 - (17 * k + 14 * k + capHeight(ctx, TYPE.brandL, 54 * k));
    profile(e, x0, W * 0.44, statTop - 50 * k, profH);
    stats(e, x0, W * 0.46, statTop, 54 * k, 17 * k);
    drawRoute(e, { x: W * 0.54, y: y0 + 30 * k, w: x1 - W * 0.54 - 20 * k, h: y1 - y0 - 60 * k });
}

export default {
    id: 'route',
    name: 'Route',
    category: 'Move',
    blurb: 'An abstract route drawn from its name over the photo: start and finish, km markers, the climb, the numbers. For run and ride clubs and brands.',
    refs: 'a club’s route card',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Saturday social · 08:00' },
        { key: 'name', label: 'Route name', rows: 2, value: 'The canal\nloop', hint: 'The route line is drawn from this name: change it for a new shape.' },
        { key: 'line', label: 'Line', value: 'Flat, fast, back for coffee.' },
        { key: 'distance', label: 'Distance', value: '12.4 km', hint: 'Markers every km (every 5 or 10 on long routes).' },
        { key: 'elevation', label: 'Elevation', value: '86 m' },
        { key: 'extra', label: 'One more stat (label · value)', value: 'Meet · Lock gates' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Club run (POWR)', fields: { eyebrow: 'Saturday social · 08:00', name: 'The canal\nloop', line: 'Flat, fast, back for coffee.', distance: '12.4 km', elevation: '86 m', extra: 'Meet · Lock gates' } },
        { name: 'Ride', fields: { eyebrow: 'Sunday club ride', name: 'Three hills\nand home', line: 'Regroup at every summit.', distance: '64 km', elevation: '820 m', extra: 'Pace · 28 km/h' } },
        { name: 'Brand launch', fields: { eyebrow: 'Northside · Trail series', name: 'Ridge\nline', line: 'Run it in the new Ridge shoe.', distance: '18 km', elevation: '540 m', extra: 'Surface · Trail' } },
        { name: 'Race recce', fields: { eyebrow: 'Race-day recce', name: 'City 10K', line: 'Know every corner before the gun.', distance: '10 km', elevation: '42 m', extra: 'Start · 09:00' } },
    ],
    look: {
        mono: 1, target: 0.2, auto: 0.85, contrast: 0.45, crush: 0.14, fade: 0,
        tint: 'cool', tintAmount: 0.5, motion: 0.1, angle: 0, focus: 0.6, vignette: 0.55, grain: 0.5, size: 1,
        route: 'loop',
    },
    controls: [
        { key: 'route', label: 'Route', options: [['loop', 'Loop'], ['line', 'A to B']] },
    ],
    fill: {
        reward: (r) => ({ ...rewardWords(r), line: r.value ? `Finish it: ${r.value}${r.unit ? ` ${r.unit}` : ''} at ${r.brand}.` : `Rewards from ${r.brand} in the POWR app.` }),
    },

    draw(e) {
        if (e.shape === 'wide' || e.shape === 'strip') return banner(e);
        const { ctx, W, H, u, safe, shape } = e;
        const tall = shape === 'tall';
        const sq = shape === 'square';
        const size = e.look.size ?? 1;
        const x0 = safe.l + 6 * u;
        const x1 = W - safe.r - 6 * u;
        e.photo({ x: 0, y: 0, w: W, h: H });
        ctx.fillStyle = 'rgba(8,8,8,0.28)';
        ctx.fillRect(0, 0, W, H);
        e.fade(0, 0, W, H * 0.38, 'top', 0.7);
        e.fade(0, H * 0.55, W, H * 0.45, 'bottom', 0.88);

        const headBottom = topRow(e, x0, x1, safe.t + (tall ? 16 : 4) * u, (sq ? 50 : 58) * u);
        const t = title(e, x0, headBottom + (tall ? 70 : sq ? 36 : 50) * u, (x1 - x0) * (sq ? 0.5 : 0.7) * size, H * (tall ? 0.14 : sq ? 0.15 : 0.16) * size);
        const lPx = (sq ? 25 : 30) * u;
        const lb = t.y + t.h + (sq ? 26 : 34) * u + lPx * 0.72;
        e.mark('line', drawText(ctx, e.fields.line, TYPE.brandR, fitPx(ctx, e.fields.line, TYPE.brandR, lPx, (x1 - x0) * (sq ? 0.46 : 1)), x0, lb, { color: SOFT }));

        // Bottom up: stats, the profile, then the route in what's left.
        const px = (tall ? 60 : sq ? 44 : 52) * u;
        const labPx = (sq ? 15 : 17) * u;
        const statTop = H - safe.b - 4 * u - (labPx + 14 * u + capHeight(ctx, TYPE.brandL, px));
        stats(e, x0, x1, statTop, px, labPx);
        const profH = (tall ? 90 : sq ? 54 : 70) * u;
        const profBase = statTop - (sq ? 30 : 40) * u;
        profile(e, x0, x1, profBase, profH);
        const rBottom = profBase - profH - (sq ? 36 : 60) * u;
        if (sq) {
            // Square: the route stands beside the name.
            const rx = x0 + (x1 - x0) * 0.56;
            const rTop = headBottom + 50 * u;
            const side = Math.min(x1 - rx, rBottom - rTop);
            drawRoute(e, { x: rx + (x1 - rx - side) / 2, y: rTop + (rBottom - rTop - side) / 2, w: side, h: side });
            return;
        }
        const rTop = lb + 70 * u;
        // A square route box, centred (the loop reads as a loop, not a smear).
        const side = Math.min(x1 - x0 - 60 * u, rBottom - rTop);
        drawRoute(e, { x: W / 2 - side / 2, y: rTop + (rBottom - rTop - side) / 2, w: side, h: side });
    },
};
