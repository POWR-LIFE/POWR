/**
 * MATERIALS — the fabric up close: a big close-up panel (your macro photo,
 * else the product shot zoomed in where you point, else a drawn knit), the
 * whole product on a small inset card with the zoomed patch framed, then the
 * composition as a split bar with its percentages, the weight and the care
 * line in mono. For activewear and kit brands that make a thing of the cloth.
 */
import { TYPE } from '../../../../fonts';
import { drawText } from '../../../../text';
import { rule } from '../../../../shapes';
import { BRAND_FIELDS, PRODUCT_FIELD, rewardWords, productShot, lockup, isCutout } from '../../kit';
import { GREY, SOFT, HAIR, frame, ground, line, fitPx, makerOf, mono, rrect, cap } from './_parts';

// "78% recycled nylon · 22% elastane" → [{ pct, name }].
function compOf(e) {
    return String(e.fields.composition ?? '')
        .split(/\s*(?:·|\||,|\n)\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const m = s.match(/^(\d+(?:\.\d+)?)\s*%\s*(.*)$/);
            return m ? { pct: parseFloat(m[1]), name: m[2] } : { pct: NaN, name: s };
        })
        .slice(0, 4);
}

const focusOf = (e) => {
    const m = String(e.fields.focus ?? '').trim().match(/^([\d.]+)\s+([\d.]+)$/);
    const c = (v) => Math.min(1, Math.max(0, parseFloat(v)));
    return m ? { x: c(m[1]), y: c(m[2]) } : { x: 0.5, y: 0.55 };
};

// A drawn knit: rows of V stitches in dark greys under a raking light.
function knit(e, r) {
    const { ctx } = e;
    const k = frame(e).k;
    const s = 26 * k;
    ctx.save();
    ctx.fillStyle = '#141413';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.34;
    for (let y = r.y - s; y < r.y + r.h + s; y += s * 0.62) {
        for (let x = r.x - s; x < r.x + r.w + s; x += s) {
            // Light rakes in from the top left: stitches nearer it are paler.
            const t = Math.max(0, 1 - (Math.hypot(x - r.x, y - r.y) / Math.hypot(r.w, r.h)));
            const v = Math.round(34 + 46 * t);
            ctx.strokeStyle = `rgb(${v},${v},${v - 2})`;
            ctx.beginPath();
            ctx.moveTo(x - s * 0.26, y - s * 0.2);
            ctx.lineTo(x, y + s * 0.24);
            ctx.stroke();
            ctx.strokeStyle = `rgb(${v - 10},${v - 10},${v - 12})`;
            ctx.beginPath();
            ctx.moveTo(x + s * 0.26, y - s * 0.2);
            ctx.lineTo(x, y + s * 0.24);
            ctx.stroke();
        }
    }
    const g = ctx.createRadialGradient(r.x + r.w * 0.3, r.y + r.h * 0.25, 0, r.x + r.w * 0.3, r.y + r.h * 0.25, Math.hypot(r.w, r.h) * 0.8);
    g.addColorStop(0, 'rgba(255,250,238,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
}

// The source window a close-up of `img` at `zoom` takes (image px), centred on the focus.
function patch(img, r, zoom, fc) {
    // 1/zoom of the shot's width, at the panel's aspect.
    let sw = img.width / zoom;
    let sh = (sw * r.h) / r.w;
    if (sh > img.height / zoom * 1.6) { sh = img.height / zoom; sw = (sh * r.w) / r.h; }
    sw = Math.min(sw, img.width);
    sh = Math.min(sh, img.height);
    const sx = Math.min(img.width - sw, Math.max(0, fc.x * img.width - sw / 2));
    const sy = Math.min(img.height - sh, Math.max(0, fc.y * img.height - sh / 2));
    return { sx, sy, sw, sh };
}

/**
 * The close-up panel at r. Returns the window used on the product image
 * (for the inset's frame), or null when the panel isn't from the product.
 */
function closeUp(e, r, radius) {
    const { ctx } = e;
    const img = e.asset('product');
    const zoom = parseFloat(e.look.loupe ?? 2) || 2;
    if (e.hasMedia) {
        e.photo(r);
        e.fade(r.x, r.y + r.h * 0.6, r.w, r.h * 0.4, 'bottom', 0.4);
        return null;
    }
    ctx.save();
    rrect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.clip();
    let win = null;
    if (img) {
        ctx.fillStyle = isCutout(img) ? '#171716' : '#111';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        win = patch(img, r, zoom, focusOf(e));
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, win.sx, win.sy, win.sw, win.sh, r.x, r.y, r.w, r.h);
        e.mark('product', r);
    } else {
        knit(e, r);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(244,241,234,0.14)';
    ctx.lineWidth = Math.max(1, 1.4 * frame(e).k);
    rrect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.stroke();
    ctx.restore();
    return win ?? (img ? null : 'mock');
}

// The inset card: the whole product, with the close-up's patch framed on it.
function inset(e, c, win) {
    const { ctx } = e;
    const k = frame(e).k;
    ctx.save();
    rrect(ctx, c.x, c.y, c.w, c.h, 18 * k);
    ctx.fillStyle = 'rgba(14,14,13,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.16)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.stroke();
    ctx.restore();
    const pad = c.w * 0.12;
    const shot = productShot(e, { x: c.x + pad, y: c.y + pad, w: c.w - pad * 2, h: c.h - pad * 2 }, { kind: 'pouch', label: makerOf(e), sub: '', radius: 10 });
    if (!win) return;
    const img = e.asset('product');
    const r = shot.rect;
    let fr;
    if (win === 'mock' || !img) {
        const fc = focusOf(e);
        const s = r.w * 0.3;
        fr = { x: r.x + fc.x * r.w - s / 2, y: r.y + fc.y * r.h - s / 2, w: s, h: s };
    } else if (shot.cutout) {
        fr = { x: r.x + (win.sx / img.width) * r.w, y: r.y + (win.sy / img.height) * r.h, w: (win.sw / img.width) * r.w, h: (win.sh / img.height) * r.h };
    } else {
        return;
    }
    ctx.save();
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = Math.max(1.5, 2 * k);
    ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
    ctx.restore();
}

// Composition: the split bar, then each part's % big and its name under. Returns the bottom.
function composition(e, x0, x1, top, px) {
    const { ctx } = e;
    const k = frame(e).k;
    const parts = compOf(e);
    const labPx = Math.max(12 * k, px * 0.16);
    e.mark('compLabel', mono(e, e.fields.compLabel, x0, top + labPx, labPx, { color: GREY }));
    let y = top + labPx + 18 * k;
    if (!parts.length) return y;
    const total = parts.reduce((a, p) => a + (Number.isFinite(p.pct) ? p.pct : 0), 0);
    const barH = Math.max(6 * k, px * 0.2);
    const fills = [e.ink, e.accent, 'rgba(244,241,234,0.45)', 'rgba(244,241,234,0.25)'];
    if (total > 0) {
        let x = x0;
        const gap = 4 * k;
        parts.forEach((p, i) => {
            const w = ((Number.isFinite(p.pct) ? p.pct : 0) / Math.max(100, total)) * (x1 - x0);
            ctx.fillStyle = fills[i];
            ctx.fillRect(x, y, Math.max(0, w - gap), barH);
            x += w;
        });
        y += barH + 24 * k;
    }
    const colW = (x1 - x0) / parts.length;
    const cp = cap(e, TYPE.brandXL, px);
    parts.forEach((p, i) => {
        const cx = x0 + i * colW;
        const pct = Number.isFinite(p.pct) ? `${p.pct}%` : '';
        if (pct) {
            drawText(ctx, pct, TYPE.brandXL, fitPx(ctx, pct, TYPE.brandXL, px, colW - 20 * k), cx - px * 0.03, y + cp, { color: i === 1 ? e.accent : e.ink, tracking: -0.02 });
        }
        const np = Math.max(14 * k, px * 0.3);
        drawText(ctx, p.name, TYPE.brandR, fitPx(ctx, p.name, TYPE.brandR, np, colW - 20 * k), cx, y + (pct ? cp + np * 1.5 : np), { color: SOFT });
    });
    const bottom = y + cp + Math.max(14 * k, px * 0.3) * 1.5;
    e.mark('composition', { x: x0, y: top, w: x1 - x0, h: bottom - top });
    return bottom;
}

// Weight · care as labelled columns on one line; baseline at `base`.
function specs(e, x0, x1, base, px) {
    const k = frame(e).k;
    const labPx = Math.max(12 * k, px * 0.5);
    const cols = [['weight', 'weightLabel', 0.34], ['care', 'careLabel', 0.66]];
    let x = x0;
    cols.forEach(([key, lab, share]) => {
        const w = (x1 - x0) * share;
        e.mark(lab, mono(e, e.fields[lab], x, base - px * 1.25, labPx, { color: GREY, maxW: w - 20 * k }));
        line(e, key, TYPE.mono, px, x, base, w - 24 * k, { color: e.ink, tracking: 0.06 });
        x += w;
    });
}

export default {
    id: 'move-materials',
    name: 'Materials',
    category: 'Move',
    section: 'Products',
    blurb: 'The fabric up close (your macro photo or the product zoomed in), the product on an inset card, the composition as a split bar, weight and care in mono. For activewear brands.',
    refs: 'a mill’s fabric swatch card',
    headlineFont: 'brandSB',
    photo: 'optional',
    fields: [
        { key: 'eyebrow', label: 'Eyebrow', value: 'Materials' },
        { key: 'name', label: 'Product name', value: 'Studio tight' },
        { key: 'compLabel', label: 'Composition label', value: 'Composition' },
        { key: 'composition', label: 'Composition', value: '78% recycled nylon · 22% elastane', hint: 'Parts split with · — "78% recycled nylon". Up to four.' },
        { key: 'weightLabel', label: 'Weight label', value: 'Weight' },
        { key: 'weight', label: 'Weight', value: '240 g/m²' },
        { key: 'careLabel', label: 'Care label', value: 'Care' },
        { key: 'care', label: 'Care', value: '30° wash · Line dry · No tumble' },
        { key: 'focus', label: 'Close-up point', value: '0.5 0.62', hint: 'Where to zoom on the product shot: across and down (0–1). A photo, if added, is the close-up instead.' },
        PRODUCT_FIELD,
        ...BRAND_FIELDS,
    ],
    presets: [
        { name: 'Leggings', fields: { eyebrow: 'Materials', name: 'Studio tight', composition: '78% recycled nylon · 22% elastane', weight: '240 g/m²', care: '30° wash · Line dry · No tumble' } },
        { name: 'Run tee', fields: { eyebrow: 'The cloth', name: 'Tempo tee', composition: '88% recycled polyester · 12% elastane', weight: '130 g/m²', care: '30° wash · Inside out · Line dry' } },
        { name: 'Hoodie', fields: { eyebrow: 'Heavyweight', name: 'POWR club hoodie', composition: '80% organic cotton · 20% recycled polyester', weight: '420 g/m²', care: '30° wash · Low iron' } },
        { name: 'Trainer upper', fields: { eyebrow: 'Upper', name: 'Tempo runner', composition: '60% recycled polyester · 30% nylon · 10% TPU', weight: '248 g (UK 8)', care: 'Wipe clean · Air dry', focus: '0.4 0.4' } },
    ],
    look: {
        mono: 1, target: 0.26, auto: 0.85, contrast: 0.5, crush: 0.1, fade: 0,
        tint: 'none', motion: 0, angle: 0, focus: 0.7, vignette: 0.35, grain: 0.35, size: 1,
        loupe: '2',
    },
    controls: [
        { key: 'loupe', label: 'Close-up zoom', options: [['2', '2×'], ['3', '3×'], ['4', '4×'], ['6', '6×']] },
    ],
    fill: {
        reward: (r) => ({ ...rewardWords(r) }),
    },

    draw(e) {
        const f = frame(e);
        const { ctx, W, H } = e;
        const { k, tall, sq, wide, strip } = f;
        const x0 = f.x0 + (f.banner ? 0 : 6 * k);
        const x1 = f.x1 - (f.banner ? 0 : 6 * k);
        const y0 = f.y0 + (tall ? 10 : f.banner ? 0 : 4) * k;
        const y1 = f.y1;
        const hair = Math.max(1, 1.2 * k);
        ground(e, { cx: W * 0.5, cy: H * 0.4, r: Math.max(W, H) * 0.6, amount: 0.5, cone: false });

        if (strip || wide) {
            // The close-up takes the left, the data the right column.
            const pw = W * (strip ? 0.36 : 0.5);
            const panel = strip ? { x: 0, y: 0, w: pw, h: H } : { x: x0, y: y0, w: pw - x0, h: y1 - y0 };
            const win = closeUp(e, panel, strip ? 0 : 22 * k);
            const iw = (strip ? pw * 0.3 : panel.w * 0.34);
            inset(e, { x: panel.x + panel.w - iw - (strip ? 20 : 24) * k, y: panel.y + panel.h - iw * 1.25 - (strip ? 20 : 24) * k, w: iw, h: iw * 1.25 }, win);
            const cx = panel.x + panel.w + (strip ? 50 : 60) * k;
            const lh = (strip ? 34 : 46) * k;
            lockup(e, cx, y0, lh, { maxW: (x1 - cx) * 0.55 });
            e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 6 * k, (strip ? 13 : 15) * k, { align: 'right', maxW: (x1 - cx) * 0.4, color: SOFT }));
            const nPx = (strip ? 44 : 60) * k;
            const nb = y0 + lh + (strip ? 30 : 60) * k + cap(e, e.headline, nPx);
            line(e, 'name', e.headline, nPx, cx, nb, x1 - cx, { tracking: -0.02 });
            const sPx = (strip ? 16 : 20) * k;
            if (strip) {
                composition(e, cx, x1, nb + 30 * k, 70 * k);
                return;
            }
            const cb = composition(e, cx, x1, nb + 70 * k, 110 * k);
            const sb = Math.max(y1, cb);
            rule(ctx, cx, sb - sPx * 2.8, x1, sb - sPx * 2.8, HAIR, hair);
            specs(e, cx, x1, sb, sPx);
            return;
        }

        const lh = (sq ? 46 : 54) * k;
        lockup(e, x0, y0, lh, { maxW: (x1 - x0) * 0.5 });
        e.mark('eyebrow', mono(e, e.fields.eyebrow, x1, y0 + lh / 2 + 7 * k, (sq ? 16 : 18) * k, { align: 'right', maxW: (x1 - x0) * 0.42, color: SOFT }));
        const sPx = (tall ? 22 : sq ? 18 : 20) * k;
        const nPx = (tall ? 72 : sq ? 50 : 60) * k;
        const cPx = (tall ? 120 : sq ? 76 : 96) * k;
        // Stack from the bottom: specs, composition, name; the panel takes the rest.
        const compH = 12 * k + 18 * k + cPx * 0.2 + 24 * k + cap(e, TYPE.brandXL, cPx) + cPx * 0.45 + 12 * k;
        const specTop = y1 - sPx * 2.8;
        const compTop = specTop - 50 * k - compH;
        const nameBase = compTop - (sq ? 34 : 44) * k;
        const panelTop = y0 + lh + (sq ? 28 : 36) * k;
        const panel = { x: x0, y: panelTop, w: x1 - x0, h: nameBase - cap(e, e.headline, nPx) - 44 * k - panelTop };
        const win = closeUp(e, panel, 22 * k);
        const iw = Math.min(panel.w * (tall ? 0.32 : 0.28), (panel.h - 48 * k) / 1.25);
        inset(e, { x: panel.x + panel.w - iw - 24 * k, y: panel.y + panel.h - iw * 1.25 - 24 * k, w: iw, h: iw * 1.25 }, win);
        line(e, 'name', e.headline, nPx, x0, nameBase, x1 - x0, { tracking: -0.02 });
        composition(e, x0, x1, compTop, cPx);
        rule(ctx, x0, specTop, x1, specTop, HAIR, hair);
        specs(e, x0, x1, y1, sPx);
    },
};
