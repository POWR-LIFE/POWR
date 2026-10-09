// /docs/redemptions: the page as Peakform Nutrition sees it, and a close look
// at Recent Activity with every status.
import { BASE_URL } from '../world.mjs';
import { REDEMPTIONS } from '../fixtures/partner-core.mjs';
import { holdStill } from './partner-rewards.mjs';

// What the page shows for a row (PartnerRedemptions.jsx displayStatus).
const shown = (r) => {
    if (r.status === 'refunded') return 'refunded';
    if (r.redemption_codes?.status === 'used') return 'used';
    if (Date.parse(r.expires_at) < Date.now()) return 'expired';
    return 'claimed';
};

// Newest first, every status: the latest two claims, the two most recently
// confirmed as used, the latest refund, then the two most recent codes whose
// 30 days ran out unused. Real rows from the brand's history, just fewer of them.
const pick = (status, n) => REDEMPTIONS.filter((r) => shown(r) === status).slice(0, n);
const EVERY_STATUS = [...pick('claimed', 2), ...pick('used', 2), ...pick('refunded', 1), ...pick('expired', 2)]
    .sort((a, b) => Date.parse(b.redeemed_at) - Date.parse(a.redeemed_at));

export default [
    {
        id: 'partner-redemptions-page',
        portal: 'partner',
        path: '/partner/redemptions',
        ready: 'Recent Activity',
        viewport: { width: 1280, height: 1150 },
        prepare: holdStill,
        markers: {
            range: { text: 'Last 30 days', closest: 'select', anchor: 'left', dx: -18 },
            total: { text: 'Total', exact: true, closest: 'div.rounded-3xl', anchor: 'tr', dx: -26, dy: 26 },
            avg: { text: 'Daily avg', closest: 'div.rounded-3xl', anchor: 'tr', dx: -26, dy: 26 },
            live: { text: 'Rewards', exact: true, closest: 'div.rounded-3xl', anchor: 'tr', dx: -26, dy: 26 },
            byReward: { text: 'By Reward', closest: 'h3', anchor: 'left', dx: 120 },
            activity: { text: 'Recent Activity', closest: 'h3', anchor: 'left', dx: 165 },
        },
    },
    {
        id: 'partner-redemptions-statuses',
        portal: 'partner',
        path: '/partner/redemptions',
        fixtures: { rest: { redemptions: EVERY_STATUS } },
        ready: 'Recent Activity',
        prepare: async (page, h) => {
            await holdStill(page);
            // The expired codes are over 30 days old.
            await page.select('select', '90');
            await h.wait('Refunded');
            // Copy the newest code, so its tick shows.
            await page.browserContext().overridePermissions(BASE_URL, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
            await h.click({ text: EVERY_STATUS[0].code, closest: 'button' });
            await page.mouse.move(2, 2);
        },
        settle: 100,
        // Tall enough that the card never scrolls inside the portal's frame.
        viewport: { width: 1280, height: 1400 },
        target: { text: 'Recent Activity', closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            code: { text: EVERY_STATUS[0].code, closest: 'button', anchor: 'right', dx: 18 },
            claimed: { text: 'Claimed', nth: 1, anchor: 'left', dx: -60 },
            used: { text: 'Used', nth: 1, anchor: 'left', dx: -60 },
            refunded: { text: 'Refunded', anchor: 'left', dx: -60 },
            expired: { text: 'Expired', nth: 1, anchor: 'left', dx: -60 },
        },
    },
    // First run: nothing created yet and no delivery method chosen.
    {
        id: 'partner-redemptions-empty',
        portal: 'partner',
        path: '/partner/redemptions',
        fixtures: {
            rest: { rewards: [], redemptions: [] },
            fn: { 'manage-partner-api': (b) => (b.action === 'resolve_delivery_method' ? { ok: true, method: null, inferred: false } : { ok: true }) },
        },
        ready: 'No redemptions to report',
        prepare: holdStill,
        target: { text: 'No redemptions to report', closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            why: { text: 'No redemptions to report', anchor: 'center', dx: 150 },
            create: { text: 'Create your first reward', closest: 'a', anchor: 'tl', dx: 4, dy: -2 },
            method: { text: 'Choose delivery method', closest: 'a', anchor: 'tr', dx: -4, dy: -2 },
        },
    },
];
