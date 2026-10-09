// What's On (the featured slot): every brand's confirmed weeks and Peakform
// Nutrition's own requests. Agrees with partner-core.mjs: Peakform's one
// featured week so far is the busy week in its claims, 15 to 9 days ago.
//
// Around it, other brands (all made up, with made-up logos) hold the weeks:
//   15–9 days ago     Peakform (confirmed, past)
//   8 days ago → Mon  Fernvale Bakery (the few days in between)
//   this week         Saltmarsh Swim Co. (Featured Now)
//   next week         Hushwell Sleep
//   in two weeks      free · Peakform has asked for it (awaiting review)
//   in three weeks    Emberly Coffee · Peakform asked too, and was declined
//   in five weeks     Peakform again (confirmed, upcoming)
import { BRAND } from '../world.mjs';
import { REWARD } from './partner-base.mjs';

const DAY = 864e5;
/** Local midnight, `d` days ago. */
const ago = (d) => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - d);
    return t;
};
/** Local midnight on the Monday `w` weeks after this week's. */
const monday = (w) => {
    const t = ago(0);
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + w * 7);
    return t;
};
const iso = (t) => new Date(t).toISOString();
const id = (kind, n) => `5c3f0a2e-0000-4000-8000-${kind}${String(n).padStart(11, '0')}`;

// Made-up brands, each with a simple round mark (no real logo is copied).
const mark = (bg, fg, glyph) => `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="256" fill="${bg}"/>${glyph(fg)}</svg>`,
).toString('base64')}`;
export const OTHER_BRANDS = {
    fernvale: {
        name: 'Fernvale Bakery', title: 'A free sourdough loaf', color: '#4D7C0F',
        logo: mark('#ECFCCB', '#4D7C0F', (c) => `<path d="M256 112c-70 60-96 128-96 176a96 96 0 0 0 192 0c0-48-26-116-96-176z" fill="${c}"/><path d="M256 176v208" stroke="#ECFCCB" stroke-width="18" stroke-linecap="round"/>`),
    },
    saltmarsh: {
        name: 'Saltmarsh Swim Co.', title: '20% off goggles and caps', color: '#0E7490',
        logo: mark('#0E7490', '#E0F7FA', (c) => `<path d="M104 238c38-34 76-34 114 0s76 34 114 0 56-30 76-14M104 310c38-34 76-34 114 0s76 34 114 0 56-30 76-14" fill="none" stroke="${c}" stroke-width="30" stroke-linecap="round"/>`),
    },
    hushwell: {
        name: 'Hushwell Sleep', title: '£15 off a weighted blanket', color: '#1D4ED8',
        logo: mark('#DBEAFE', '#1E3A8A', (c) => `<path d="M300 120a140 140 0 1 0 92 236 120 120 0 0 1-92-236z" fill="${c}"/><circle cx="330" cy="190" r="14" fill="${c}"/>`),
    },
    emberly: {
        name: 'Emberly Coffee', title: 'Any coffee, on us', color: '#EA580C',
        logo: mark('#FFEDD5', '#9A3412', (c) => `<path d="M160 216h176v56a88 88 0 0 1-176 0z" fill="${c}"/><path d="M336 232h24a32 32 0 0 1 0 64h-28" fill="none" stroke="${c}" stroke-width="22"/><path d="M216 120c-14 22 14 34 0 60M264 112c-14 22 14 34 0 60" fill="none" stroke="${c}" stroke-width="16" stroke-linecap="round"/>`),
    },
};

// The embed both tables carry for Peakform's own reward.
const PEAKFORM = { title: REWARD.title, brand_name: BRAND.name, brand_color: null, image_url: REWARD.image_url, partners: null };
const other = (b) => ({ title: b.title, brand_name: b.name, brand_color: b.color, image_url: b.logo, partners: null });

// Peakform's featured week: the claims spike in partner-core.mjs.
const FEATURED = { start: ago(15), end: ago(8) };

export const SCHEDULE = [
    { id: id('a', 1), reward_id: REWARD.id, starts_at: iso(FEATURED.start), ends_at: iso(FEATURED.end), rewards: PEAKFORM },
    { id: id('a', 2), reward_id: id('b', 1), starts_at: iso(FEATURED.end), ends_at: iso(monday(0)), rewards: other(OTHER_BRANDS.fernvale) },
    { id: id('a', 3), reward_id: id('b', 2), starts_at: iso(monday(0)), ends_at: iso(monday(1)), rewards: other(OTHER_BRANDS.saltmarsh) },
    { id: id('a', 4), reward_id: id('b', 3), starts_at: iso(monday(1)), ends_at: iso(monday(2)), rewards: other(OTHER_BRANDS.hushwell) },
    { id: id('a', 5), reward_id: id('b', 4), starts_at: iso(monday(3)), ends_at: iso(monday(4)), rewards: other(OTHER_BRANDS.emberly) },
    { id: id('a', 6), reward_id: REWARD.id, starts_at: iso(monday(5)), ends_at: iso(monday(6)), rewards: PEAKFORM },
];

// Peakform's requests (RLS shows a brand only its own).
export const REQUESTS = [
    {
        id: id('c', 1), reward_id: REWARD.id,
        requested_start: iso(FEATURED.start), requested_end: iso(FEATURED.end),
        note: 'Our autumn range launches that week.', status: 'approved', reviewer_notes: null,
        created_at: iso(ago(29)), rewards: PEAKFORM,
    },
    {
        id: id('c', 2), reward_id: REWARD.id,
        requested_start: iso(monday(3)), requested_end: iso(monday(4)),
        note: 'Half-term: we’re running a family bundle.', status: 'declined',
        reviewer_notes: 'That week was taken before we could confirm your request.',
        created_at: iso(ago(6)), rewards: PEAKFORM,
    },
    {
        id: id('c', 3), reward_id: REWARD.id,
        requested_start: iso(monday(2)), requested_end: iso(monday(3)),
        note: 'Half-term: we’re running a family bundle.', status: 'pending', reviewer_notes: null,
        created_at: iso(ago(2)), rewards: PEAKFORM,
    },
    {
        id: id('c', 4), reward_id: REWARD.id,
        requested_start: iso(monday(5)), requested_end: iso(monday(6)),
        note: 'Our winter range goes on sale.', status: 'approved', reviewer_notes: null,
        created_at: iso(ago(12)), rewards: PEAKFORM,
    },
];

export default {
    rest: {
        featured_reward_schedule: SCHEDULE,
        featured_slot_requests: REQUESTS,
    },
};
