// /docs/getting-started
import { BRAND, BRAND_USER, daysFromNow, uid } from '../world.mjs';
import { REWARD } from '../fixtures/partner-base.mjs';
import { INVITE_TOKEN, SETUP_FIXTURES } from '../fixtures/partner-settings.mjs';

// The Overview's phone lists three sample rewards under the brand's own card,
// and RewardAppPreview.jsx gives them real brands' names. They sit below the
// fold of the phone in these shots, but swap them for made-up ones anyway so
// a layout change can never put a real brand in a public guide.
const SAMPLE_SWAPS = [
    ['Notto Pasta', 'Harbour Pasta'], ['NOTTO', 'HARB'],
    ['Calm · Premium', 'Stillwater · Premium'], ['calm', 'still'],
    ['Eight Sleep', 'Duskwell Sleep'], ['eight', 'dusk'],
];
const swapSamples = (page) => page.evaluate((pairs) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        for (const [from, to] of pairs) {
            // Short logo words only as a whole text node; names anywhere.
            if (from.length <= 6 ? n.nodeValue.trim() === from : n.nodeValue.includes(from)) {
                n.nodeValue = n.nodeValue.split(from).join(to);
            }
        }
    }
}, SAMPLE_SWAPS);

// A brand whose first reward POWR approved yesterday. No delivery method has
// been chosen yet, so nothing is live, and a second reward is half-written.
const APPROVED_WAITING = {
    rest: {
        rewards: [{ ...REWARD, active: false, created_at: daysFromNow(-1) }],
        reward_submissions: [
            { id: uid('submission', 21), brand_name: BRAND.name, title: REWARD.title, status: 'approved', partner_feedback: null, created_reward_id: REWARD.id, updated_at: daysFromNow(-1) },
            { id: uid('submission', 22), brand_name: BRAND.name, title: 'Free shaker with any protein tub', status: 'draft', partner_feedback: null, created_reward_id: null, updated_at: daysFromNow(-0.2) },
        ],
        redemptions: [],
        redemption_codes: [],
        reward_brand_integrations: [],
        brand_reward_limits: [],
    },
    fn: {
        'manage-partner-api': (b) => ({
            resolve_delivery_method: { ok: true, method: null, inferred: false },
            list_keys: { ok: true, keys: [] },
            get_integration: { ok: true, integration: null },
        }[b.action] ?? { ok: true }),
    },
};

// A marker on a CSS-selected element (the nth match), placed by anchor.
const at = (css, anchor, dx = 0, dy = 0, nth = 0) => Object.assign(async (page) => (await page.$$(css))[nth], { anchor, dx, dy });

// The Delivery block on the Overview: the section label's parent. (A Because
// figure can be labelled "Delivery" too, so match the section label's style.)
const DELIVERY_BLOCK = async (page) => (await page.evaluateHandle(() => [...document.querySelectorAll('main span')]
    .find((s) => s.textContent.trim() === 'Delivery' && s.className.includes('tracking-[0.4em]'))?.parentElement)).asElement();

export default [
    {
        id: 'partner-sidebar',
        portal: 'partner',
        path: '/partner',
        ready: 'Overview',
        target: 'aside',
        markers: {
            brand: { text: 'Peakform Nutrition', closest: 'div[class*="rounded"]', anchor: 'tr', dx: -14, dy: 14 },
            pages: { text: 'My Rewards', closest: 'a', anchor: 'right', dx: -18 },
            method: { text: 'Promo Codes', closest: 'a', anchor: 'right', dx: -18 },
            support: { text: 'Support', closest: 'a', anchor: 'tr', dx: -6, dy: 2 },
            guides: { text: 'Guides', closest: 'a', anchor: 'tr', dx: -6, dy: 2 },
        },
    },
    {
        id: 'partner-setup',
        portal: 'none',
        path: `/partner/setup/${INVITE_TOKEN}`,
        fixtures: SETUP_FIXTURES,
        ready: 'Partner Portal Setup',
        prepare: async (page, h) => {
            await h.type('input[type=text]', BRAND_USER.name);
            await h.type('input[type=email]', BRAND_USER.email);
            for (const el of await page.$$('input[type=password]')) { await el.click(); await el.type('peakform-2026'); }
            await page.evaluate(() => document.activeElement?.blur());
        },
        target: '.max-w-md',
        pad: 16,
        markers: {
            brand: { text: 'Partner Portal Setup', closest: 'div[class*="rounded-2xl"]', anchor: 'tr', dx: -14, dy: 14 },
            name: at('input[type=text]', 'right', -26),
            email: at('input[type=email]', 'right', -26),
            password: at('input[type=password]', 'right', -26),
            create: at('button[type=submit]', 'right', -26),
        },
    },
    {
        id: 'partner-login',
        portal: 'none',
        path: '/partner/login',
        ready: 'Manage your rewards',
        prepare: async (page, h) => {
            await h.type('input[type=email]', BRAND_USER.email);
            await h.type('input[type=password]', 'peakform-2026');
            await page.evaluate(() => document.activeElement?.blur());
        },
        target: '.max-w-md',
        pad: 16,
        markers: {
            email: at('input[type=email]', 'right', -26),
            password: at('input[type=password]', 'right', -26),
            signin: at('button[type=submit]', 'right', -26),
        },
    },
    {
        // The whole Overview for a healthy brand: everything green.
        id: 'partner-overview',
        portal: 'partner',
        path: '/partner',
        ready: 'Everything’s running',
        viewport: { width: 1280, height: 1000 },
        prepare: swapSamples,
        settle: 1500,
        markers: {
            headline: { text: 'Everything’s running', closest: 'h1', anchor: 'right', dx: 36 },
            because: { text: 'Because', exact: true, within: 'main', anchor: 'right', dx: 40 },
            delivery: { text: 'Delivery', exact: true, within: 'main', anchor: 'right', dx: 40 },  // no "Delivery" figure in this state
            strip: { text: 'Last 30 days', exact: true, within: 'main', anchor: 'right', dx: 40 },
            phone: { text: 'Live in app', exact: true, within: 'main', anchor: 'left', dx: -40 },
        },
    },
    {
        // A needs-you state: approved, but no way to deliver codes yet.
        id: 'partner-overview-verdict',
        portal: 'partner',
        path: '/partner',
        fixtures: APPROVED_WAITING,
        ready: 'Members can’t claim anything',
        prepare: async (page, h) => {
            // Crop to the verdict: the Delivery chain below has its own shot.
            const block = await h.find(DELIVERY_BLOCK);
            await block.evaluate((e) => { e.style.display = 'none'; });
        },
        target: { text: 'checked just now', closest: 'div.min-w-0' },
        pad: 14,
        markers: {
            status: { text: 'checked just now', anchor: 'right', dx: 40 },
            headline: { text: 'Members can’t claim anything', closest: 'h1', anchor: 'right', dx: 30 },
            button: { text: 'Choose delivery method', closest: 'a', anchor: 'right', dx: 26 },
            because: { text: 'Because', exact: true, within: 'main', anchor: 'right', dx: 40 },
            more: { text: 'more thing needs you', anchor: 'right', dx: 40 },
        },
    },
    {
        // The same brand's Delivery chain: one red link, the rest not reached.
        id: 'partner-overview-delivery',
        portal: 'partner',
        path: '/partner',
        fixtures: APPROVED_WAITING,
        ready: 'Members can’t claim anything',
        target: DELIVERY_BLOCK,
        pad: 14,
        markers: {
            listed: { text: 'Listed', exact: true, within: 'main', anchor: 'right', dx: 24 },
            connected: { text: 'Connected', exact: true, within: 'main', anchor: 'right', dx: 24 },
            line: { text: 'Nothing of yours is in the app yet', anchor: 'right', dx: -24 },  // the line is full width; its right end is clear
        },
    },
];
