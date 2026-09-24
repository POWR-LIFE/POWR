/**
 * The POWR lockup (slanted P + "OWR"), trimmed to its ink and recoloured on
 * demand. Served from our own origin so it never taints the export canvas.
 */

const SRC = '/powr-logo-black.png';

let base = null;
const tinted = new Map();

async function loadBase() {
    const img = new Image();
    img.src = SRC;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    const t = document.createElement('canvas');
    t.width = x1 - x0 + 1;
    t.height = y1 - y0 + 1;
    t.getContext('2d').drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
    return t;
}

export async function ensureLogo() {
    if (!base) base = await loadBase();
    return base;
}

/** The lockup in `color` (call ensureLogo() first). */
export function logo(color) {
    if (!base) return null;
    if (!tinted.has(color)) {
        const c = document.createElement('canvas');
        c.width = base.width;
        c.height = base.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(base, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, c.width, c.height);
        tinted.set(color, c);
    }
    return tinted.get(color);
}

/** Draw the lockup `w` wide with its top-left at (x, y); returns its height. */
export function drawLogo(ctx, color, x, y, w) {
    const img = logo(color);
    if (!img) return 0;
    const h = (w * img.height) / img.width;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, w, h);
    return h;
}
