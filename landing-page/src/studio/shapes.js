/** Rules, callouts and scrims the templates share. */

export function rule(ctx, x1, y1, x2, y2, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
}

export function dot(ctx, x, y, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function ring(ctx, x, y, r, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

/**
 * A black fade, darkest at the `from` edge ('top' | 'bottom' | 'left' |
 * 'right'). Eased stops
 * so it reads as light falling off, not a gradient box.
 */
export function fade(ctx, x, y, w, h, from, alpha) {
    if (alpha <= 0) return;
    const g = from === 'top' ? ctx.createLinearGradient(0, y, 0, y + h)
        : from === 'left' ? ctx.createLinearGradient(x, 0, x + w, 0)
        : from === 'right' ? ctx.createLinearGradient(x + w, 0, x, 0)
        : ctx.createLinearGradient(0, y + h, 0, y);
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        g.addColorStop(t, `rgba(0,0,0,${(alpha * (1 - t) ** 1.7).toFixed(4)})`);
    }
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

/** A soft elliptical shadow centred on (cx, cy). */
export function spot(ctx, cx, cy, rx, ry, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        g.addColorStop(t, `rgba(0,0,0,${(alpha * (1 - t * t) ** 1.5).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** Square-bracket callout: a vertical rule with ticks pointing at `side`. */
export function bracket(ctx, x, y, h, side, tick, color, width) {
    const d = side === 'right' ? tick : -tick;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + d, y + h);
    ctx.stroke();
    ctx.restore();
}
