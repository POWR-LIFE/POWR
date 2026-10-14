// In store: Peakform Nutrition taking rewards at its own tills.
//
// Deliberately NOT named partner-*.mjs: area files merge into every partner
// shot, and in_store_enabled_for_brand → true would add "In Store" to the
// sidebar of every existing partner screenshot. Only shots/partner-instore.mjs
// passes these in, per shot.
//
//   Riverside      scanned 12 minutes ago, Sam on the till
//   Station Road   scanned yesterday, Priya
//   Market Square  swipes only so far: staff haven't opened their link
import { BRAND, PEOPLE, uid } from '../world.mjs';
import { REWARD } from './partner-base.mjs';

const ago = (minutes) => new Date(Date.now() - minutes * 6e4).toISOString();

export const SITES = [
    {
        id: uid('in-store-site', 1), name: 'Riverside', address: '12 Mill Lane, Riverside', lat: 51.7521, lng: -1.2577,
        radius_m: 75, stand_code: 'RIV-01', stand_key: '0000000000000001', active: true,
        last_scan_at: ago(12), last_swipe_at: ago(95),
    },
    {
        id: uid('in-store-site', 2), name: 'Station Road', address: '3 Station Road', lat: 51.7533, lng: -1.2701,
        radius_m: 75, stand_code: 'STA-01', stand_key: '0000000000000002', active: true,
        last_scan_at: ago(60 * 26), last_swipe_at: null,
    },
    {
        id: uid('in-store-site', 3), name: 'Market Square', address: '8 Market Square', lat: 51.7546, lng: -1.2610,
        radius_m: 50, stand_code: 'MAR-01', stand_key: '0000000000000003', active: true,
        last_scan_at: null, last_swipe_at: ago(180),
    },
];

export const STAFF = [
    { id: uid('in-store-staff', 1), name: 'Sam', site_id: SITES[0].id, created_at: ago(60 * 24 * 20), last_seen_at: ago(12), last_scan_at: ago(12) },
    { id: uid('in-store-staff', 2), name: 'Priya', site_id: SITES[1].id, created_at: ago(60 * 24 * 18), last_seen_at: ago(60 * 26), last_scan_at: ago(60 * 26) },
    { id: uid('in-store-staff', 3), name: 'Dan', site_id: SITES[2].id, created_at: ago(60 * 24 * 2), last_seen_at: null, last_scan_at: null },
];

const SHAKER = { id: uid('in-store-reward', 2), title: 'Free shaker with any order', image_url: BRAND.logo_url };
const FIVER = { id: uid('in-store-reward', 3), title: '£5 off at the till', image_url: BRAND.logo_url };

export const OVERVIEW = {
    brand_name: BRAND.name,
    sites: SITES,
    staff: STAFF,
    rewards: [
        { id: REWARD.id, title: REWARD.title, active: true, image_url: REWARD.image_url, integration_type: 'POOL',
          promo_code: null, where: 'both', check: 'staff_scan', requires_stand: false, ask_spend: true,
          window_minutes: 5, barcode_format: 'code128', site_ids: null },
        { ...SHAKER, active: true, integration_type: 'IN_STORE', promo_code: null, where: 'in_store', check: 'look',
          requires_stand: true, ask_spend: false, window_minutes: 5, barcode_format: 'code128', site_ids: null },
        { ...FIVER, active: true, integration_type: 'POOL', promo_code: null, where: 'in_store', check: 'till_barcode',
          requires_stand: false, ask_spend: false, window_minutes: 5, barcode_format: 'ean13', site_ids: null },
    ],
};

const latest = [
    [12, 0, REWARD.title, 'Riverside', 'confirmed', 'Sam', 3840],
    [41, 1, SHAKER.title, 'Market Square', 'swiped', null, null],
    [58, 2, REWARD.title, 'Riverside', 'confirmed', 'Sam', 5120],
    [95, 3, SHAKER.title, 'Riverside', 'swiped', null, null],
    [140, 4, REWARD.title, 'Station Road', 'closed', null, null],
    [60 * 26, 5, REWARD.title, 'Station Road', 'confirmed', 'Priya', 2990],
].map(([m, p, reward, site_name, result, staff_name, spend_pence]) => ({
    at: ago(m), member: PEOPLE[p].name, reward, site_name, result, staff_name, spend_pence,
}));

export const REPORT = {
    brand_name: BRAND.name,
    days: 30,
    totals: { opened: 184, confirmed: 131, swiped: 36, closed: 17, open_now: 0, spend_pence: 512460, spend_visits: 97 },
    by_site: [
        { site_id: SITES[0].id, site_name: 'Riverside', opened: 92, confirmed: 74, swiped: 11, closed: 7, spend_pence: 298150, spend_visits: 55 },
        { site_id: SITES[1].id, site_name: 'Station Road', opened: 58, confirmed: 49, swiped: 4, closed: 5, spend_pence: 187400, spend_visits: 38 },
        { site_id: SITES[2].id, site_name: 'Market Square', opened: 34, confirmed: 8, swiped: 21, closed: 5, spend_pence: 26910, spend_visits: 4 },
    ],
    latest,
    barcode: { issued: 46, used: 39 },
};

// The scan page, signed in through Sam's link. Every key and token in this
// file is a deliberately fake, low-entropy placeholder (the pages are mocked;
// nothing here ever reaches a database), so secret scanners have nothing to flag.
export const SCAN_TOKEN = '00000000000000000000000000000001';
export const SCAN_SESSION = {
    brand_name: BRAND.name,
    staff: { id: STAFF[0].id, name: 'Sam', site_id: SITES[0].id },
    manager: false,
    sites: SITES.map(({ id, name, stand_code }) => ({ id, name, stand_code })),
};
export const TODAY = {
    confirmed: 12,
    spend_pence: 46830,
    latest: [
        [12, 0, REWARD.title, 'confirmed'], [41, 1, SHAKER.title, 'swiped'], [58, 2, REWARD.title, 'confirmed'],
        [95, 3, SHAKER.title, 'swiped'], [140, 4, REWARD.title, 'closed'],
    ].map(([m, p, reward, status]) => ({ at: ago(m), member: PEOPLE[p].name, reward, status })),
};

export default {
    rpc: {
        in_store_enabled_for_brand: true,
        partner_in_store_overview: OVERVIEW,
        partner_in_store_report: REPORT,
        partner_set_reward_in_store: { ok: true, integration_type: 'POOL' },
        partner_create_staff: { id: uid('in-store-staff', 9), token: '00000000000000000000000000000002' },
        in_store_scan_session: () => ({ ...SCAN_SESSION, server_now: new Date().toISOString() }),
        in_store_scan_check: () => ({
            result: 'valid', voucher_id: uid('in-store-voucher', 1), ticket: 'docs-ticket',
            reward_title: REWARD.title, member_label: PEOPLE[6].name,
            opened_at: ago(1), expires_at: new Date(Date.now() + 4 * 6e4 + 12e3).toISOString(),
            swiped: false, ask_spend: true, server_now: new Date().toISOString(),
        }),
        in_store_scan_today: TODAY,
        in_store_kiosk: () => ({
            site_id: SITES[0].id, site_name: 'Riverside', stand_code: 'RIV-01',
            stand_secret: '00000000000000000000000000000003', server_now: new Date().toISOString(),
        }),
    },
};
