/**
 * NIGHTSTAND — shop the room: a bedroom photo with numbered hotspots on the
 * things in it (placed as fractions across and down the photo), and the
 * matching numbered list with prices beside or below it, on the night
 * ground. For sleep-aid brands selling what sits by the bed: a sound
 * machine, a sunrise lamp, a pillow mist, an eye mask, a tea.
 */
import { TYPE } from '../../../../fonts';
import { BRAND_FIELDS, rewardWords } from '../../kit';
import { frame, head, title, parseRows, line, label, fadeTo, nightRgba, onAccent, INK, SOFT, MUTED, HAIR, clamp } from './_parts';
import { ground } from '../_parts';

// "Name — £140 — 0.30, 0.82" → { name, price, x, y }.
function parseItems(text) {
    return parseRows(text, 4).map((p) => {
        const pos = p.find((s) => /^\s*\d?\.?\d+\s*,\s*\d?\.?\d+\s*$/.test(s));
        const rest = p.filter((s) => s !== pos);
        const [x, y] = pos ? pos.split(',').map(Number) : [NaN, NaN];
        return { name: rest[0] ?? '', price: rest.slice(1).join(' · '), x, y };
    });
}

function spot(e, x, y, n, k, big = false) {
    const { ctx } = e;
    const r = (big ? 19 : 15) * k;
    ctx.save();
    ctx.fillStyle = 'rgba(12,14,19,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.75)';
    ctx.lineWidth = Math.max(1, 1.5 * k);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = e.accent;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = onAccent(e.accent);
    ctx.font = `500 ${r * 0.95}px "IBM Plex Mono"`;
    ctx.textAlign = 'center';
    ctx.fillText(String(n), x, y + r * 0.34);
    ctx.restore();
}

// The list: a number disc, the name, the price right-aligned. `cols` across.
function list(e, items, x, y, w, rowH, k, { cols = 1, px = 30 } = {}) {
    const { ctx } = e;
    const cw = (w - (cols - 1) * 44 * k) / cols;
    let box = null;
    const grow = (b) => { if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; };
    const rows = Math.ceil(items.length / cols);
    items.forEach((it, i) => {
        const c = Math.floor(i / rows);
        const r = i % rows;
        const cx = x + c * (cw + 44 * k);
        const top = y + r * rowH;
        ctx.fillStyle = HAIR;
        ctx.fillRect(cx, top, cw, Math.max(1, 1.2 * k));
        const mid = top + rowH / 2;
        const dr = px * 0.42;
        ctx.save();
        ctx.fillStyle = e.accent;
        ctx.beginPath();
        ctx.arc(cx + dr, mid, dr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = onAccent(e.accent);
        ctx.font = `500 ${dr * 1.05}px "IBM Plex Mono"`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), cx + dr, mid + dr * 0.36);
        ctx.restore();
        const nx = cx + dr * 2 + 20 * k;
        const pb = line(e, null, it.price, TYPE.brandL, px, cx + cw, mid + px * 0.36, { align: 'right', maxW: cw * 0.34, color: SOFT });
        grow(pb);
        grow(line(e, null, it.name, TYPE.brandL, px, nx, mid + px * 0.36, { maxW: (pb ? pb.x : cx + cw) - nx - 18 * k, color: INK }));
    });
    e.mark('items', box);
}

export default {
    id: 'sleep-nightstand',
    name: 'Nightstand',
    category: 'Sleep',
    section: 'Products',
    blurb: 'Shop the bedside: numbered hotspots on the sleep aids in a bedroom photo and the matching list with prices.',
    refs: 'a shop-the-look page in an interiors catalogue',
    headlineFont: 'brandL',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Shop the bedside' },
        { key: 'title', label: 'Title', rows: 2, value: 'The nightstand edit' },
        { key: 'items', label: 'Items', rows: 4, value: 'Sunrise alarm lamp — £129 — 0.46, 0.60\nSound machine — £89 — 0.48, 0.80\nPillow mist, 100 ml — £22 — 0.35, 0.85\nSilk eye mask — £45 — 0.70, 0.66', hint: 'Up to four, one per line: name — price — across, down. Across and down run 0 to 1 over the photo as it shows in this size.' },
        { key: 'note', label: 'Small print', value: 'Members first in the POWR app' },
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Bedside', fields: {} },
        { name: 'Wind-down', fields: { eyebrow: 'Before lights out', title: 'The evening shelf', items: 'Night tea, 20 bags — £9 — 0.46, 0.60\nMagnesium, 60 capsules — £24 — 0.48, 0.80\nPillow mist — £22 — 0.35, 0.85\nSilk eye mask — £45 — 0.70, 0.66', note: 'Or 1,900 POWR points for the set' }, style: { accent: '#D8B98A' } },
        { name: 'Light', fields: { eyebrow: 'Light, after dark', title: 'Warm light only', items: 'Sunrise alarm lamp — £129 — 0.46, 0.60\nAmber-lens glasses — £49 — 0.40, 0.84', note: 'Lamp dims from 2,700 K to off' }, style: { accent: '#E8A27C' } },
        { name: 'Sound', fields: { eyebrow: 'Quiet, by the bed', title: 'Everything for the ears', items: 'Sound machine — £89 — 0.48, 0.80\nSilicone earplugs — £24 — 0.35, 0.85\nSleep headphones — £79 — 0.70, 0.66', note: 'Members first in the POWR app' }, style: { accent: '#7FE0C2' } },
    ],
    look: {
        mono: 0.35, target: 0.22, auto: 0.85, contrast: 0.45, crush: 0.12, fade: 0,
        tint: 'cool', tintAmount: 0.3, motion: 0, angle: 0, focus: 0.6, vignette: 0.5, grain: 0.5, size: 1,
    },
    fill: { reward: (r) => ({ ...rewardWords(r), ...(r.cost ? { note: `Or ${Number(r.cost).toLocaleString('en-GB')} POWR points` } : {}) }) },

    draw(e) {
        const f = frame(e);
        const { k, x0, x1, y1 } = f;
        const { ctx, W, H } = e;
        ground(e, null);
        const items = parseItems(e.fields.items);

        // Photo rect, then the panel it leaves.
        let ph;
        let panel;
        if (f.side || f.sq) {
            const pw = W * (f.strip ? 0.42 : f.sq ? 0.56 : 0.6);
            ph = { x: 0, y: 0, w: pw, h: H };
            panel = { x: pw + (f.strip ? 44 : 64) * k, y: f.y0, w: x1 - pw - (f.strip ? 44 : 64) * k, h: y1 - f.y0 };
        } else {
            const h = H * (f.tall ? 0.6 : 0.58);
            ph = { x: 0, y: 0, w: W, h };
            panel = { x: x0, y: h + (f.tall ? 50 : 44) * k, w: x1 - x0, h: y1 - h - (f.tall ? 50 : 44) * k };
        }
        e.photo(ph);
        if (f.side || f.sq) fadeTo(ctx, ph.x + ph.w * 0.8, 0, ph.w * 0.2, H, 'right', 0.9);
        else fadeTo(ctx, 0, ph.h * 0.78, W, ph.h * 0.22, 'bottom', 0.95);
        e.fade(0, 0, W, H * 0.16, 'top', 0.5);
        ctx.fillStyle = nightRgba(1);
        if (f.side || f.sq) ctx.fillRect(ph.w, 0, W - ph.w, H);
        else ctx.fillRect(0, ph.h, W, H - ph.h);

        // Hotspots over the photo, kept off its edges.
        items.forEach((it, i) => {
            if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) return;
            const m = 40 * k;
            spot(e, clamp(ph.x + it.x * ph.w, ph.x + m, ph.x + ph.w - m), clamp(ph.y + it.y * ph.h, Math.max(ph.y, f.y0) + m + 40 * k, Math.min(ph.y + ph.h, y1) - m), i + 1, k, f.tall);
        });

        // Head over the photo (side layouts: over the panel's top instead).
        if (f.side || f.sq) {
            head(e, { ...f, x0: panel.x }, { eyebrowMax: 0.4 });
        } else {
            head(e, f);
        }

        const n = Math.max(1, items.length);
        const smallPx = (f.strip ? 11 : 14) * k;
        const hasNote = String(e.fields.note ?? '').trim() !== '';
        const listBot = panel.y + panel.h - (hasNote ? smallPx * 3 : 0);
        if (f.strip) {
            const t = title(e, 'title', e.fields.title, panel.x, panel.y + 70 * k, { maxW: panel.w * 0.9, maxH: 60 * k, max: 50 * k, lines: 1 });
            const top = t.bottom + 34 * k;
            const cols = n > 2 ? 2 : 1;
            const rowH = Math.min(70 * k, (listBot - top) / Math.ceil(n / cols));
            list(e, items, panel.x, top, panel.w, rowH, k, { cols, px: 20 * k });
        } else if (f.side || f.sq) {
            const top = panel.y + (f.sq ? 110 : 140) * k;
            const t = title(e, 'title', e.fields.title, panel.x, top, { maxW: panel.w, maxH: (f.sq ? 130 : 170) * k, max: (f.sq ? 64 : 80) * k });
            const lt = t.bottom + (f.sq ? 50 : 70) * k;
            const rowH = Math.min((f.sq ? 86 : 100) * k, (listBot - lt - 20 * k) / n);
            list(e, items, panel.x, Math.max(lt, listBot - 20 * k - rowH * n), panel.w, rowH, k, { px: (f.sq ? 22 : 26) * k });
        } else {
            const t = title(e, 'title', e.fields.title, panel.x, panel.y, { maxW: panel.w * 0.9, maxH: (f.tall ? 64 : 54) * k, max: (f.tall ? 64 : 54) * k, lines: 1 });
            const lt = t.bottom + (f.tall ? 40 : 30) * k;
            const rowH = Math.min((f.tall ? 84 : 76) * k, (listBot - lt - 10 * k) / n);
            list(e, items, panel.x, lt, panel.w, rowH, k, { px: (f.tall ? 28 : 25) * k });
        }
        if (hasNote) label(e, 'note', e.fields.note, smallPx, panel.x, panel.y + panel.h, { maxW: panel.w, color: MUTED });
    },
};
