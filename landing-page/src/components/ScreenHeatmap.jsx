import React, { useEffect, useRef } from 'react';

/**
 * Paints touch density over the app preview.
 *
 * The render is the standard two-pass heatmap, and it is worth knowing why,
 * because the obvious one-pass version looks wrong:
 *
 *   Pass 1 — every point is drawn as a radial gradient in GREYSCALE ALPHA only.
 *            Overlapping blobs accumulate, so density becomes opacity. Drawing
 *            coloured blobs directly instead would let two adjacent medium
 *            points stay medium-coloured however much they overlap, and the
 *            picture would show where people touched but not how much.
 *
 *   Pass 2 — that accumulated alpha is mapped through a ramp. Only here does
 *            anything get a hue, and the hue is a pure function of density,
 *            which is what makes the legend honest.
 *
 * ── On the choice of ramp ───────────────────────────────────────────────────
 *
 * INFERNO is the default and the one to trust. It rises monotonically in
 * lightness from dark purple through orange to near-white, so "hotter" is
 * always "lighter" — the ordering survives being printed in greyscale, and it
 * stays readable with any form of colour blindness because no two steps rely on
 * hue alone to be told apart.
 *
 * CLASSIC is the familiar blue→green→yellow→red of most heatmap tools. It is
 * offered because it is what people expect to see, but it is the weakest of the
 * three as data: its lightness is NOT monotonic (yellow is far lighter than
 * both the green below it and the red above it), so the eye reads a bright band
 * through the middle of the scale that the numbers do not contain, and red/green
 * is the most common colour-blind confusion there is. Fine for a screenshot in
 * a deck, poor for deciding where a button should move.
 *
 * MONO is the single brand hue. The most conservative and the least
 * discriminating — good when the heat must not compete with the UI beneath it.
 */

const RAMPS = {
    // [stop, [r, g, b, a]] — alpha ramps in as well as colour so faint areas
    // stay see-through rather than fogging the screen underneath.
    inferno: {
        label: 'Inferno',
        note: 'Perceptually uniform · colour-blind safe',
        legend: 'linear-gradient(90deg,#F4F4F1 0%,#3B0F70 20%,#8C2981 42%,#DE4968 62%,#FE9F6D 80%,#FCFDBF 100%)',
        stops: [
            [0.00, [0, 0, 0, 0]],
            [0.14, [59, 15, 112, 130]],
            [0.36, [140, 41, 129, 185]],
            [0.58, [222, 73, 104, 210]],
            [0.78, [254, 159, 109, 230]],
            [1.00, [252, 253, 191, 245]],
        ],
    },
    classic: {
        label: 'Classic',
        note: 'Familiar, but uneven lightness & red/green',
        legend: 'linear-gradient(90deg,#F4F4F1 0%,#2C7BB6 22%,#00CCBC 42%,#8BE04E 60%,#FFDD33 78%,#E23B2E 100%)',
        stops: [
            [0.00, [0, 0, 0, 0]],
            [0.18, [44, 123, 182, 140]],
            [0.38, [0, 204, 188, 190]],
            [0.56, [139, 224, 78, 210]],
            [0.76, [255, 221, 51, 230]],
            [1.00, [226, 59, 46, 245]],
        ],
    },
    mono: {
        label: 'Mono',
        note: 'Single brand hue · least intrusive',
        legend: 'linear-gradient(90deg,#F4F4F1 0%,#6F6200 25%,#C4AF00 55%,#E8D200 78%,#FFF6A8 100%)',
        stops: [
            [0.00, [0, 0, 0, 0]],
            [0.18, [111, 98, 0, 150]],
            [0.42, [196, 175, 0, 195]],
            [0.68, [232, 210, 0, 225]],
            [1.00, [255, 246, 168, 242]],
        ],
    },
};

export const HEATMAP_PALETTES = Object.entries(RAMPS).map(([key, r]) => ({
    key, label: r.label, note: r.note, legend: r.legend,
}));

const rampAt = (stops, t) => {
    for (let i = 1; i < stops.length; i++) {
        const [hi, hc] = stops[i];
        if (t <= hi) {
            const [lo, lc] = stops[i - 1];
            const f = hi === lo ? 0 : (t - lo) / (hi - lo);
            return [
                Math.round(lc[0] + (hc[0] - lc[0]) * f),
                Math.round(lc[1] + (hc[1] - lc[1]) * f),
                Math.round(lc[2] + (hc[2] - lc[2]) * f),
                Math.round(lc[3] + (hc[3] - lc[3]) * f),
            ];
        }
    }
    return stops[stops.length - 1][1];
};

export default function ScreenHeatmap({
    points = [],
    width,
    height,
    radius = 26,
    intensity = 1,
    showPoints = false,
    palette = 'inferno',
    canvasRef: externalRef,
}) {
    const innerRef = useRef(null);
    const canvasRef = externalRef || innerRef;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !width || !height) return;

        // Render at device resolution so the blobs are not soft on a retina
        // screen, but keep the CSS box at the layout size.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (points.length === 0) return;

        const r = radius * dpr;
        const stops = (RAMPS[palette] || RAMPS.inferno).stops;

        // ── Pass 1: accumulate density as alpha ──
        for (const p of points) {
            const x = p.x * canvas.width;
            const y = p.y * canvas.height;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            // A single point should be visible but not saturated; overlap is
            // what pushes a region to the top of the ramp.
            g.addColorStop(0, `rgba(0,0,0,${0.34 * intensity})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // ── Pass 2: colourise that alpha through the ramp ──
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3];
            if (a === 0) continue;
            const [rr, gg, bb, aa] = rampAt(stops, Math.min(a / 255, 1));
            d[i] = rr; d[i + 1] = gg; d[i + 2] = bb; d[i + 3] = aa;
        }
        ctx.putImageData(img, 0, 0);

        // Individual touches, for when the question is "how many" rather than
        // "where" — a dense blob and a single hard tap can look alike otherwise.
        if (showPoints) {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            for (const p of points) {
                ctx.beginPath();
                ctx.arc(p.x * canvas.width, p.y * canvas.height, 1.6 * dpr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }, [points, width, height, radius, intensity, showPoints, palette, canvasRef]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{ width, height }}
        />
    );
}
