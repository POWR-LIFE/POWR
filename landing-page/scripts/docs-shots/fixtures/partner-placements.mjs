// Placements: Peakform Nutrition's campaigns, one of each state a brand sees,
// and the squares around the draft that other campaigns hold.
//
//   Riverside weekend mornings  Draft          (opened in the builder shots)
//   Station commute             In review
//   Market square Saturdays     Needs changes  (another brand got the squares first)
//   Half-term family bundle     Scheduled      (starts in 11 days)
//   Town centre lunchtimes      Live, with its four counts
//
// The builder's map is drawn as a made-up town (see the shot file), so the
// squares can sit in a park by a river without any real place showing.
import { BRAND, uid } from '../world.mjs';
import { REWARD } from './partner-base.mjs';

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
/** Local midnight `d` days from today (negative = ago). */
const day = (d, endOfDay = false) => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + d);
    if (endOfDay) t.setHours(23, 59, 59, 999);
    return t;
};

// ── Tile math (as src/lib/placementGrid.js) ───────────────────────────────────
const tileOf = (lat, lng, z) => {
    const n = 2 ** z;
    return {
        x: Math.floor(((lng + 180) / 360) * n),
        y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
    };
};
const tileNW = (z, x, y) => {
    const n = 2 ** z;
    return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lng: (x / n) * 360 - 180 };
};

// The squares the builder shots show, drawn as a picture 12 squares wide
// (zoom-18 squares, 64 px each at the map's zoom 16):
//   # the draft's own squares (gold)
//   r another brand's live campaign, every day: booked whatever the times (red)
//   a another brand's campaign still in review (amber)
const PICTURE = [
    '............',
    '....###.....',
    '...######...',
    '..#######.rr',
    '..#######.rr',
    '...####.....',
    '............',
    '.....aa.....',
    '.....aa.....',
];
// Somewhere in open sea: the shots draw their own made-up town over it (see
// shots/partner-placements.mjs), so no real place can show through.
const ANCHOR = { lat: 0.42, lng: -24.37 };
const Z = 18;
const O = tileOf(ANCHOR.lat, ANCHOR.lng, Z);
const cellsOf = (ch) => PICTURE.flatMap((row, j) => [...row].flatMap((c, i) => (c === ch ? [{ z: Z, x: O.x + i, y: O.y + j }] : [])));
const DRAFT_CELLS = cellsOf('#');
const BOOKED_CELLS = cellsOf('r');
const REQUESTED_CELLS = cellsOf('a');

/** Where the picture sits: its top-left in zoom-16 world pixels, and the map centre. */
export const MAP = (() => {
    const W = PICTURE[0].length;
    const H = PICTURE.length;
    const centre = tileNW(Z + 8, (O.x * 256) + (W * 256) / 2, (O.y * 256) + (H * 256) / 2);
    return { origin16: { x: O.x * 64, y: O.y * 64 }, size: { w: W * 64, h: H * 64 }, centre };
})();

// Peakform's other campaigns sit elsewhere in town; only their counts show.
const elsewhere = (n, seed) => Array.from({ length: n }, (_, i) => ({ z: Z, x: O.x + 40 + seed * 12 + (i % 6), y: O.y + 30 + Math.floor(i / 6) }));

const reward = { title: REWARD.title, brand_name: BRAND.name, image_url: REWARD.image_url };
const row = (n, fields) => ({
    id: uid('placement', n),
    reward_id: REWARD.id,
    review_note: null,
    active_days: null,
    active_hour_start: null,
    active_hour_end: null,
    target_activities: null,
    max_impressions_per_user_per_day: null,
    starts_at: null,
    ends_at: null,
    active: false,
    rewards: reward,
    // The page filters on the joined brand (rewards.brand_name=ilike.…); the
    // mock filters on the row's own keys, so the row carries it flat too.
    'rewards.brand_name': BRAND.name,
    ...fields,
});

export const PLACEMENTS = [
    row(1, {
        campaign_name: 'Riverside weekend mornings', status: 'draft',
        active_days: [0, 6],
        starts_at: iso(day(9)), ends_at: iso(day(65, true)),
        created_at: iso(Date.now() - 1 * DAY),
    }),
    row(2, {
        campaign_name: 'Station commute', status: 'pending_review',
        active_days: [1, 2, 3, 4, 5], active_hour_start: 7, active_hour_end: 9,
        starts_at: iso(day(4)), ends_at: iso(day(60, true)),
        created_at: iso(Date.now() - 3 * DAY),
    }),
    row(3, {
        campaign_name: 'Market square Saturdays', status: 'rejected',
        review_note: 'Another campaign was approved for most of these squares first.',
        active_days: [6], active_hour_start: 9, active_hour_end: 16,
        created_at: iso(Date.now() - 6 * DAY),
    }),
    row(4, {
        campaign_name: 'Half-term family bundle', status: 'live', active: true,
        target_activities: ['walking', 'running'],
        starts_at: iso(day(11)), ends_at: iso(day(17, true)),
        created_at: iso(Date.now() - 12 * DAY),
    }),
    row(5, {
        campaign_name: 'Town centre lunchtimes', status: 'live', active: true,
        active_days: [1, 2, 3, 4, 5], active_hour_start: 11, active_hour_end: 14,
        target_activities: ['gym', 'running'], max_impressions_per_user_per_day: 2,
        starts_at: iso(day(-26)), ends_at: iso(day(34, true)),
        created_at: iso(Date.now() - 27 * DAY),
    }),
];

const CELLS = {
    [PLACEMENTS[0].id]: DRAFT_CELLS,
    [PLACEMENTS[1].id]: elsewhere(18, 0),
    [PLACEMENTS[2].id]: elsewhere(9, 1),
    [PLACEMENTS[3].id]: elsewhere(30, 2),
    [PLACEMENTS[4].id]: elsewhere(24, 3),
};
export const CELL_ROWS = Object.entries(CELLS).flatMap(([placement_id, list]) => list.map((c) => ({ placement_id, ...c })));

// The live campaign's funnel. Its 19 redemptions are among the brand's claims
// in partner-core.mjs (236 all-time).
const STATS = [{ placement_id: PLACEMENTS[4].id, surfaced: 1284, presence: 312, redeemed: 19, notified: 27, reach: 486 }];

export default {
    rest: {
        reward_placements: PLACEMENTS,
        reward_placement_cells: CELL_ROWS,
    },
    rpc: {
        get_placement_cell_counts: ({ p_placement_ids = [] }) => p_placement_ids.map((id) => ({ placement_id: id, cells: (CELLS[id] ?? []).length })),
        get_placement_stats: ({ p_placement_ids = [] }) => STATS.filter((s) => p_placement_ids.includes(s.placement_id)),
        // Squares other campaigns hold around the map: booked (live) and requested (in review).
        get_taken_grid_cells: () => [
            ...BOOKED_CELLS.map((c) => ({ ...c, pending: false })),
            ...REQUESTED_CELLS.map((c) => ({ ...c, pending: true })),
        ],
        set_placement_cells: null,
        submit_reward_placement: null,
    },
};

