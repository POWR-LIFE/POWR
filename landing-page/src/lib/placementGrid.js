// =============================================================
// Placement grid helpers — Web-Mercator slippy-tile math shared by the
// admin RewardPlacements page and the partner PartnerPlacements page.
// Kept framework-free (pure functions + constants) so both the map
// component and the page save logic can import from one place.
// =============================================================

// Activity-preference tokens — must match the mobile app's constants/activities.
export const ACTIVITIES = ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // index = JS getDay() / resolver p_local_dow
export const DEFAULT_CENTER = { lat: 51.5074, lng: -0.1278 };
export const GOLD = '#E8D200';
export const RED = '#ef4444';

// Adaptive grid: cell zoom follows the map zoom (clamped). Big cells when
// zoomed out (cover a city), down to ~19 m cells when zoomed all the way in
// (a single building entrance / corner of a lot). z stays a smallint and the
// resolver's `1 << z` math is safe well past this (2^21 « integer range).
export const Z_MIN = 10;
export const Z_MAX = 21;
export const CELL_CAP = 1500;

// ── Tile math (Web-Mercator slippy tiles) ────────────────────────────────────
export const nAt = (z) => 2 ** z;
export const lngLatToTile = (lat, lng, z) => {
    const n = nAt(z);
    return {
        z,
        x: Math.floor(((lng + 180) / 360) * n),
        y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
    };
};
export const tileNW = (z, x, y) => {
    const n = nAt(z);
    return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lng: (x / n) * 360 - 180 };
};
export const tileBounds = (z, x, y) => {
    const nw = tileNW(z, x, y);
    const se = tileNW(z, x + 1, y + 1);
    return { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
};
export const cellKey = (z, x, y) => `${z},${x},${y}`;
export const parseKey = (k) => { const [z, x, y] = k.split(',').map(Number); return { z, x, y }; };
export const tilesOverlap = (a, b) => {
    if (a.z <= b.z) { const d = b.z - a.z; return (b.x >> d) === a.x && (b.y >> d) === a.y; }
    const d = a.z - b.z; return (a.x >> d) === b.x && (a.y >> d) === b.y;
};
export const boundsIntersect = (A, B) => A.west <= B.east && A.east >= B.west && A.south <= B.north && A.north >= B.south;
export const clampZoom = (z) => Math.max(Z_MIN, Math.min(Z_MAX, Math.round(z)));

// Add cells to a selection while collapsing quadtree overlaps, so no selected
// cell contains another. Overlapping a placement's own cells across zooms is
// harmless to the resolver (presence is an EXISTS) but paints a darker patch,
// inflates the square count, and stores redundant rows — this keeps one
// canonical cell per patch of ground. A finer cell already inside a coarser
// selected cell is dropped; a coarser cell swallows the finer cells it covers.
export function mergeCells(selected, additions) {
    const next = new Set(selected);
    for (const { z, x, y } of additions) {
        const cell = { z, x, y };
        // Skip if a coarser-or-equal selected cell already covers this ground.
        if ([...next].some((k) => { const e = parseKey(k); return e.z <= z && tilesOverlap(e, cell); })) continue;
        // Otherwise drop any finer selected cells this one now contains.
        for (const k of [...next]) { const e = parseKey(k); if (e.z > z && tilesOverlap(cell, e)) next.delete(k); }
        next.add(cellKey(z, x, y));
    }
    return next;
}

// ── Flight window (campaign start/end dates) ─────────────────────────────────
// The form holds plain yyyy-mm-dd strings; the DB wants timestamptz. Start =
// local midnight of the first day, end = local end of the last day (inclusive).
export const startOfDayISO = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
export const endOfDayISO = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : null);
export const isoToDateInput = (iso) => (iso ? iso.slice(0, 10) : '');

// 168-bit weekly mask (day*24 + hour). Empty days = all days; null hours = all hours.
export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export function buildWeekMask(days, hStart, hEnd) {
    const dayset = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
    let hours;
    if (hStart == null || hEnd == null) hours = range(0, 23);
    else if (hStart <= hEnd) hours = range(hStart, hEnd);
    else hours = [...range(hStart, 23), ...range(0, hEnd)];
    const bits = new Array(168).fill('0');
    for (const d of dayset) for (const h of hours) bits[d * 24 + h] = '1';
    return bits.join('');
}
