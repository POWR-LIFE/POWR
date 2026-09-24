/** QR codes drawn straight onto the post (crisp at any export size). */
import { encode } from 'uqr';

const cache = new Map();

/** Draw a QR for `text` as a size×size square at (x, y); returns false if empty. */
export function drawQR(ctx, text, x, y, size, { fg = '#0B0B0B', bg = '#F4F1EA', quiet = 2 } = {}) {
    if (!text) return false;
    if (!cache.has(text)) cache.set(text, encode(text, { ecc: 'M', border: 0 }));
    const { data } = cache.get(text);
    const n = data.length;
    const cell = size / (n + quiet * 2);
    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = fg;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (data[r][c]) {
                // Overlap by a hair so no seams show between modules when scaled.
                ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.35, cell + 0.35);
            }
        }
    }
    ctx.restore();
    return true;
}
