// /docs/rewards: My Rewards (both tabs), each step of the Submit a Reward
// form, the reward-limit modal, the phone preview and the private-link form.
//
// Peakform Nutrition's second offer is "£10 off orders over £40" on its
// recovery range. The form shots type it in from a blank "Submit a Reward"
// (never saving, so Review still offers "Submit for Review"); the Submissions
// tab carries the draft that the first save of that offer would leave.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, BRAND_USER, asset, photo, uid } from '../world.mjs';
import { SUBMISSIONS } from '../fixtures/partner-core.mjs';
import { REWARD } from '../fixtures/partner-base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

// My Rewards needs the room: at 1280 the Live Rewards table loses its last
// column behind the phone preview.
const WIDE = { width: 1600, height: 960 };

/** Local time, `d` days ago, at h:m. */
const at = (d, h = 0, m = 0) => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - d);
    t.setHours(h, m, 0, 0);
    return t.toISOString();
};

// ── The new offer ────────────────────────────────────────────────────────────
const OFFER = {
    title: '£10 off orders over £40',
    description: `${BRAND.name} · Recovery range`,
    value: '10',
    detail: 'Get £10 off any order over £40 from the recovery range. New and returning customers.',
    blurb: REWARD.partner_blurb,
    terms: 'One use per member. Minimum spend £40. Cannot be combined with other offers.',
    url: `${BRAND.website}/recovery`,
    stock: '300',
    perMember: '1',
};
const HERO = photo('boxer-light.jpg');

// ── Submissions: the core two, plus a draft and one sent back ────────────────
const BASE = SUBMISSIONS.find((s) => s.status === 'approved');
const DRAFT = {
    ...BASE,
    id: uid('submission', 3),
    status: 'draft',
    target_reward_id: null,
    created_reward_id: null,
    title: OFFER.title,
    description: OFFER.description,
    discount_type: 'fixed_amount',
    discount_value: '10.00',
    // Saved after The Offer: the rest is still to do.
    offer: null,
    partner_blurb: BRAND.name,
    terms: null,
    url: null,
    image_url: null,
    hero_image_url: null,
    code_prefix: null,
    submitted_at: null,
    reviewed_at: null,
    created_at: at(0, 9, 14),
    updated_at: at(0, 9, 14),
};
const SENT_BACK = {
    ...BASE,
    id: uid('submission', 4),
    status: 'rejected',
    target_reward_id: null,
    created_reward_id: null,
    title: 'Free shaker with any order',
    description: `${BRAND.name} · Shaker bottle`,
    discount_type: null,
    discount_value: null,
    value_label: '£12 value',
    offer: 'A free Peakform shaker bottle with your next order.',
    terms: 'One per member. While stocks last.',
    hero_image_url: photo('runner-blur.jpg'),
    partner_feedback: 'Please add a minimum spend to the terms and say which orders qualify.',
    submitted_at: at(12, 15, 8),
    reviewed_at: at(11, 10, 30),
    created_at: at(12, 14, 40),
    updated_at: at(11, 10, 30),
};
const SUBMISSIONS_PLUS = [DRAFT, ...SUBMISSIONS, SENT_BACK];
const withSubmissions = (rows = SUBMISSIONS_PLUS) => ({ rest: { reward_submissions: rows } });

// ── Helpers for prepare() ────────────────────────────────────────────────────
// The phone preview lists three sample rewards under the brand's own, and their
// names are real brands. Swap them for made-up ones wherever they're on screen.
const SAMPLE_NAMES = [
    ['Notto Pasta · Any branch', 'Riverton Pasta · Any branch'], ['NOTTO', 'RIVER'],
    ['Calm · Premium', 'Quiet Hour · Premium'], ['calm', 'quiet'],
    ['Eight Sleep · Any model', 'Moonbay Beds · Any model'], ['eight', 'moon'],
];
export const fictionalSamples = (page) => page.evaluate((pairs) => {
    const map = new Map(pairs);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (map.has(t)) n.textContent = n.textContent.replace(t, map.get(t));
    }
}, SAMPLE_NAMES);

const LEFT = '.lg\\:grid > div';             // the list or form column, beside the phone
const FORM = 'form';

// Uploads go to storage, which the mock answers; the stored file's public URL
// can't be served from it, so the pictures are pointed at the same artwork.
const UPLOAD_OK = { http: { 'object/reward-submissions': { Key: 'reward-submissions/docs', Id: 'docs-upload' } } };
const showUploads = (page) => page.evaluate((logo, hero) => {
    for (const img of document.querySelectorAll('img')) {
        if (img.src.includes('/reward-submissions/logos/')) img.src = logo;
        if (img.src.includes('/reward-submissions/heroes/')) img.src = hero;
    }
}, asset('peakform-logo.svg'), HERO);

// A CSS-selected marker with an anchor: find() calls a function selector.
const at$ = (css, where) => Object.assign((page) => page.$(css), where);

const rail = (h, label) => h.click({ text: label, closest: 'button', within: FORM });

// Another capture run rewriting shots.json makes the dev server reload every
// open page, which would wipe a half-filled form. Refuse to leave instead.
// Chrome only asks before leaving once the page has had a click, so one goes
// on the portal's empty header bar.
export const holdStill = async (page) => {
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.evaluate(() => window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }));
    const { width } = page.viewport();
    await page.mouse.click(width - 60, 30);
    await page.mouse.move(2, 2);
};
const blur = (page) => page.evaluate(() => document.activeElement?.blur());

/** Opens Submit a Reward and types the offer in, up to and including `upTo`. */
async function fill(page, h, upTo) {
    const order = ['offer', 'details', 'delivery', 'imagery'];
    const want = (step) => order.indexOf(step) <= order.indexOf(upTo);
    await holdStill(page);
    await h.click('Submit Reward');
    await h.wait('Build a draft in stages');
    await h.type('input[placeholder="e.g. 30% off your first order"]', OFFER.title);
    await h.type('input[placeholder="e.g. Your Brand · Any product"]', OFFER.description);
    const [valueType] = await page.$$('form select');
    await valueType.select('fixed_amount');
    await h.sleep(200);
    await h.type('form input[type=number]', OFFER.value);
    const selects = await page.$$('form select');
    await selects[1].select('food');
    await h.sleep(200);
    if (want('details')) {
        await rail(h, 'Details');
        await h.type('textarea[placeholder^="e.g. Get 30% off"]', OFFER.detail);
        // About your brand starts as the brand name: replace it.
        await h.type('textarea[placeholder="A short line about who you are."]', OFFER.blurb);
        await h.type('textarea[placeholder^="e.g. One use per member"]', OFFER.terms);
        await h.type('input[placeholder="https://yourbrand.com"]', OFFER.url);
    }
    if (want('delivery')) {
        await rail(h, 'Delivery');
        await h.type('input[placeholder="e.g. TRIBE"]', BRAND.code);
        const [stock, perMember] = await page.$$('form input[placeholder="Unlimited"]');
        await stock.click({ clickCount: 3 }); await stock.type(OFFER.stock);
        await perMember.click({ clickCount: 3 }); await perMember.type(OFFER.perMember);
        await h.sleep(200);
    }
    if (want('imagery')) {
        await rail(h, 'Imagery');
        const [logo, hero] = await page.$$('form input[type=file]');
        await logo.uploadFile(path.join(ROOT, 'scripts/docs-shots/assets/peakform-logo.svg'));
        await h.sleep(800);
        await hero.uploadFile(path.join(ROOT, 'public/studio-samples/boxer-light.jpg'));
        await h.sleep(1200);
        await showUploads(page);
        await h.sleep(600);
    }
    await blur(page);
    await page.mouse.move(2, 2);
}

export default [
    // The page: Live Rewards beside the phone.
    {
        id: 'partner-rewards-page',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: withSubmissions(),
        ready: 'Update in review',
        viewport: WIDE,
        prepare: async (page) => { await holdStill(page); await fictionalSamples(page); },
        settle: 2000,
        markers: {
            tabs: { text: 'Live Rewards', closest: 'div', anchor: 'right', dx: 20 },
            submit: { text: 'Submit Reward', closest: 'button', anchor: 'top', dy: -26 },
            cost: { text: '450 pts', closest: 'td', anchor: 'right', dx: -4 },
            actions: { text: 'Make a post', closest: 'a', anchor: 'top', dy: -26 },
            phone: { text: 'Redeem screen', closest: 'button', anchor: 'right', dx: 18 },
        },
    },
    // Submissions: one of each status.
    {
        id: 'partner-rewards-submissions',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: withSubmissions(),
        ready: 'Update in review',
        viewport: WIDE,
        prepare: async (page, h) => { await holdStill(page); await h.click({ text: 'Submissions', closest: 'button' }); await h.wait('Needs changes'); },
        target: { text: 'Submitted', closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            draft: { text: 'Draft', closest: 'span', anchor: 'right', dx: 20 },
            review: { text: 'Review', closest: 'span', anchor: 'right', dx: 20 },
            update: { text: 'Listing update', closest: 'span', anchor: 'right', dx: 22 },
            approved: { text: 'Approved', closest: 'span', anchor: 'right', dx: 20 },
            changes: { text: 'Needs changes', exact: true, closest: 'span', anchor: 'right', dx: 18 },
            revise: { text: 'Revise', exact: true, closest: 'button', anchor: 'left', dx: -18 },
        },
    },
    // Step 1, typed into a blank form.
    {
        id: 'partner-rewards-step-offer',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: withSubmissions(),
        ready: 'Update in review',
        viewport: { width: 1600, height: 1100 },
        prepare: async (page, h) => { await fill(page, h, 'offer'); },
        target: LEFT,
        pad: 8,
        markers: {
            rail: { text: 'The Offer', closest: 'button', within: FORM, anchor: 'top', dy: -16 },
            title: { text: 'Reward Title', closest: 'label', anchor: 'right', dx: -14 },
            value: { text: 'Value type', closest: 'label', anchor: 'right', dx: -14 },
            sector: { text: 'Sector', closest: 'label', within: FORM, anchor: 'right', dx: -14 },
            kind: { text: 'Reward type', closest: 'label', anchor: 'right', dx: -14 },
            next: { text: 'Save & continue', closest: 'button', anchor: 'tr', dx: -8, dy: 6 },
        },
    },
    // Step 3, a unique code.
    {
        id: 'partner-rewards-step-delivery',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: withSubmissions(),
        ready: 'Update in review',
        viewport: { width: 1600, height: 1100 },
        prepare: async (page, h) => { await fill(page, h, 'delivery'); },
        target: FORM,
        pad: 8,
        markers: {
            unique: { text: 'Unique code', closest: 'button', anchor: 'tr', dx: -16, dy: 16 },
            link: { text: 'Shared link', closest: 'button', anchor: 'tr', dx: -16, dy: 16 },
            name: { text: 'Code name', closest: 'label', anchor: 'right', dx: -14 },
            receive: { text: 'Members receive', closest: 'div', anchor: 'tr', dx: -16, dy: 16 },
            stock: { text: 'Inventory limit', closest: 'label', anchor: 'right', dx: -14 },
            per: { text: 'Claims per member', closest: 'label', anchor: 'right', dx: -14 },
        },
    },
    // Step 4, logo and hero uploaded. Only the step itself, taken narrow: the
    // empty video box is wide, and at 358px or less it also fits a phone.
    {
        id: 'partner-rewards-step-imagery',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: { ...withSubmissions(), ...UPLOAD_OK },
        ready: 'Update in review',
        viewport: { width: 1196, height: 1300 },
        prepare: async (page, h) => { await fill(page, h, 'imagery'); },
        target: 'form section',
        pad: 12,
        markers: {
            logo: at$('form section .grid > div:nth-child(1) .border-dashed', { anchor: 'tr', dx: -14, dy: 14 }),
            hero: at$('form section .grid > div:nth-child(2) .border-dashed', { anchor: 'tr', dx: -14, dy: 14 }),
            video: at$('form section .grid > div:nth-child(3) .border-dashed', { anchor: 'tr', dx: -16, dy: 16 }),
            paste: at$('input[placeholder^="Or paste a direct link"]', { anchor: 'right', dx: -22 }),
        },
    },
    // Step 5, everything in and ready to send.
    {
        id: 'partner-rewards-step-review',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: { ...withSubmissions(), ...UPLOAD_OK },
        ready: 'Update in review',
        viewport: { width: 1600, height: 1400 },
        prepare: async (page, h) => { await fill(page, h, 'imagery'); await rail(h, 'Review'); await fictionalSamples(page); },
        target: FORM,
        pad: 8,
        markers: {
            rail: { text: 'Imagery', closest: 'button', within: FORM, anchor: 'tr', dx: -16, dy: 16 },
            list: { text: 'Delivery', exact: true, closest: 'div', within: 'form section', anchor: 'right', dx: -18 },
            draft: { text: 'Save draft', closest: 'button', anchor: 'left', dx: -12 },
            send: { text: 'Submit for Review', closest: 'button', anchor: 'tr', dx: -8, dy: 6 },
        },
    },
    // At the cap: a second new reward in review makes it 2/2.
    {
        id: 'partner-rewards-limit',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: withSubmissions([DRAFT, ...SUBMISSIONS, { ...SENT_BACK, status: 'pending', partner_feedback: null, reviewed_at: null, submitted_at: at(1, 11, 5), updated_at: at(1, 11, 5) }]),
        ready: 'limit reached',
        viewport: WIDE,
        prepare: async (page, h) => {
            await holdStill(page);
            await h.click('Request More');
            await h.wait('Reward limit reached');
            await h.type('textarea[placeholder^="e.g. We\'d like"]', 'We’d like to add a members-only bundle for the new year.');
        },
        target: { text: 'Reward limit reached', closest: 'div.rounded-3xl' },
        pad: 0,
        markers: {
            cap: { text: 'Reward limit reached', closest: 'h2', anchor: 'right', dx: 18 },
            note: { text: 'Anything we should know?', closest: 'label', anchor: 'right', dx: -14 },
            send: { text: 'Get in touch', exact: true, closest: 'button', anchor: 'tr', dx: -8, dy: 6 },
        },
    },
    // How members see it: the Redeem screen.
    {
        id: 'partner-rewards-preview-redeem',
        portal: 'partner',
        path: '/partner/rewards',
        fixtures: withSubmissions(),
        ready: 'Update in review',
        viewport: WIDE,
        prepare: async (page, h) => { await holdStill(page); await h.click('Redeem screen'); await fictionalSamples(page); },
        target: { text: 'Live preview · true-to-scale', up: 1 },
        pad: 16,
        markers: {
            toggle: { text: 'Redeem screen', closest: 'button', anchor: 'right', dx: 16 },
            code: { text: 'YOUR CODE', anchor: 'right', dx: 60 },
            shop: { text: 'Use code at', anchor: 'tr', dx: 10, dy: -10 },
        },
    },
    // Before a portal login: the private link POWR sends a brand.
    {
        id: 'partner-rewards-invite',
        portal: 'none',
        path: '/partner-reward/docs-invite-peakform',
        fixtures: { fn: { 'partner-reward-submission': (b) => (b.action === 'validate'
            ? { ok: true, context: { brandName: BRAND.name, brandLocked: true, codePrefix: BRAND.code, prefixLocked: true } }
            : { ok: true }) } },
        ready: 'Add your reward to POWR',
        // Down to the offer's first fields; the rest repeats the portal form.
        viewport: { width: 1280, height: 1290 },
        prepare: async (page, h) => {
            await holdStill(page);
            await h.type('input[placeholder="https://yourbrand.com"]', BRAND.website);
            await h.type('input[placeholder="Your name"]', BRAND_USER.name);
            await h.type('input[placeholder="you@brand.com"]', BRAND_USER.email);
            await h.type('input[placeholder="e.g. 30% off your first order"]', REWARD.title);
            await h.type('input[placeholder="e.g. Tribe · Any product"]', REWARD.description);
            const [valueType, sector] = await page.$$('form select');
            await valueType.select('percentage');
            await h.sleep(200);
            await h.type('form input[type=number]', '25');
            await sector.select('food');
            await blur(page);
            await page.mouse.move(2, 2);
            await fictionalSamples(page);
            // Typing scrolled the page; the shot is its top.
            await page.evaluate(() => window.scrollTo(0, 0));
        },
        markers: {
            brand: at$('input[placeholder="e.g. Tribe"]', { anchor: 'right', dx: -22 }),
            email: at$('input[placeholder="you@brand.com"]', { anchor: 'right', dx: -22 }),
            offer: { text: 'The Offer', closest: 'h2', anchor: 'left', dx: 135 },
            preview: { text: 'Redeem screen', closest: 'button', anchor: 'right', dx: 18 },
        },
    },
];
