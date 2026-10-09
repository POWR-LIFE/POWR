// /docs/gyms/discounts: Partner discounts (Clash+ and up).
// gym_partner_discounts belongs to gym-core (Peakform only, for the event
// builder). This page needs a fuller shelf, so its shots bring their own:
// six made-up brands covering every badge and every state a card can be in.
import { BRAND, asset, daysFromNow, photo, uid } from '../world.mjs';
import { REWARD } from '../fixtures/partner-base.mjs';

const brand = (n, f) => ({
    reward_id: uid('docs-discount', n),
    title: f.title ?? null,
    label: `${f.brand_name} · ${f.value}`,
    terms: null,
    brand_color: null,
    available: null,
    in_stock: true,
    event_ok: f.kind !== 'link',
    claim: null,
    ...f,
});
const week = (claimedDaysAgo, expiresIn) => {
    const claimed = daysFromNow(-claimedDaysAgo, 10);
    const expires = daysFromNow(expiresIn, 10);
    const next = new Date(Math.min(Date.parse(claimed) + 7 * 864e5, Date.parse(expires))).toISOString();
    return { claimed_at: claimed, expires_at: expires, next_at: next };
};

// The server's order is by brand; the page puts brands with nothing to give last.
export const DISCOUNTS = [
    // Taken two days ago: the gym's code for this week, with the brand's shop.
    brand(1, {
        brand_name: 'Copperline Activewear', kind: 'pool', available: 86, value: '20% off',
        offer: 'Training tops, shorts and leggings. 20% off anything in the shop, kit for your coaches included.',
        terms: 'One use per code. Not valid on gift cards. Expires 30 days after it’s issued.',
        image_url: asset('copperline-logo.svg'), hero_image_url: photo('legs.jpg'),
        claim: { code: 'CPL-4QX9-M27R', url: 'https://copperline.example/discount/CPL-4QX9-M27R', ...week(2, 28) },
    }),
    brand(2, {
        brand_name: 'Driftmoor Recovery', kind: 'link', value: '15% off',
        offer: 'Massage guns, foam rollers and recovery boots, 15% off through the POWR link.',
        terms: 'The discount is applied at checkout when you arrive through the link.',
        image_url: asset('driftmoor-logo.svg'), hero_image_url: photo('runner-blur.jpg'),
    }),
    // Out of codes: the brand tops its pool up.
    brand(3, {
        brand_name: 'Ironleaf Boxing', kind: 'pool', available: 0, in_stock: false, value: '30% off',
        offer: 'Gloves, wraps, pads and bags. 30% off your order.',
        terms: 'One use per code. Excludes made-to-order bags.',
        image_url: asset('ironleaf-logo.svg'), hero_image_url: photo('boxer-light.jpg'),
    }),
    brand(4, {
        brand_name: BRAND.name, kind: 'shared', value: '25% off', title: REWARD.title,
        offer: REWARD.offer, terms: REWARD.terms,
        image_url: BRAND.logo_url, hero_image_url: BRAND.hero_url, brand_color: '#1F6F4A',
        reward_id: REWARD.id,
    }),
    // Last code taken nine days ago: the week is up, but that code still works.
    brand(5, {
        brand_name: 'Brinewell Hydration', kind: 'pool', available: 140, value: '20% off',
        offer: 'Electrolyte tabs and drink mixes for the front desk fridge. 20% off any order.',
        terms: 'One use per code. Expires 30 days after it’s issued.',
        image_url: asset('brinewell-logo.svg'), hero_image_url: photo('crosswalk.jpg'),
        claim: { code: 'BRW-81KD-3TQ5', url: 'https://brinewell.example/discount/BRW-81KD-3TQ5', ...week(9, 21) },
    }),
    // Running low.
    brand(6, {
        brand_name: 'Strideloom', kind: 'pool', available: 12, value: '25% off',
        offer: 'Running shoes and socks. 25% off a pair, any style.',
        terms: 'One use per code. Not valid on sale items.',
        image_url: asset('strideloom-logo.svg'), hero_image_url: photo('runner-pan.jpg'),
    }),
];

const fixtures = { rpc: { gym_partner_discounts: DISCOUNTS } };

// The portal's cards rise in on load; on a busy machine the still can be taken
// mid-rise (or before it starts). Jump every finite animation to its end.
const risen = (page) => page.evaluate(() => new Promise((done) => {
    for (const a of document.getAnimations()) {
        try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* an animation that can't finish stays as it is */ }
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
}));
// Labels are full-width blocks; shrinking them to their text (no visible
// change, the text is left-aligned) lets a pin sit just right of the words.
const fit = (page, texts) => page.evaluate((list) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const t of list) {
        for (const el of document.querySelectorAll('main *')) {
            const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
            if (!own.startsWith(norm(t))) continue;
            el.style.width = 'fit-content';
            if (getComputedStyle(el).textAlign === 'center') { el.style.marginLeft = 'auto'; el.style.marginRight = 'auto'; }
        }
    }
}, texts);
const ready = async (page, h, labels = []) => { await h.wait('Strideloom'); await h.sleep(600); await risen(page); await fit(page, labels); };
const card = (text) => ({ text, closest: 'div.rounded-3xl' });

export default [
    // The page: how it works, then a card per brand. Wide enough for three
    // across, so the first row carries all three badges.
    {
        id: 'gym-discounts-page',
        portal: 'gym',
        path: '/venue/partners',
        ready: 'Partner discounts',
        fixtures,
        viewport: { width: 1600, height: 1192 },
        prepare: (page, h) => ready(page, h, ['How it works', '15% off', 'Your code']),
        markers: {
            how: { text: 'How it works', anchor: 'right', dx: 34 },
            value: { text: '15% off', anchor: 'right', dx: 36 },
            badge: { text: 'Shared code', anchor: 'top', dy: -34 },
            get: { text: 'Get the link', closest: 'button', anchor: 'right', dx: -40 },
            code: { text: 'Your code', exact: true, anchor: 'right', dx: 34 },
        },
    },
    // Every card state: the three badges, running low, none left, last week's code.
    {
        id: 'gym-discounts-cards',
        portal: 'gym',
        path: '/venue/partners',
        ready: 'Partner discounts',
        fixtures,
        viewport: { width: 1600, height: 1900 },
        prepare: (page, h) => ready(page, h, ['Only 12 left · one use, held for your gym', 'No codes left right now. Check back soon.']),
        target: { text: 'Strideloom', closest: 'div.grid' },
        pad: 16,
        markers: {
            pool: { text: 'One-use code', nth: 0, anchor: 'top', dy: -26 },
            link: { text: 'Link', within: 'main', anchor: 'top', dy: -26 },
            shared: { text: 'Shared code', anchor: 'top', dy: -26 },
            low: { text: 'Only 12 left', anchor: 'right', dx: 26 },
            none: { text: 'No codes left right now', anchor: 'right', dx: 26 },
        },
    },
    // The week is up: a new code to take, and last week's still good if unused.
    {
        id: 'gym-discounts-lastcode',
        portal: 'gym',
        path: '/venue/partners',
        ready: 'Partner discounts',
        fixtures,
        viewport: { width: 1600, height: 1900 },
        prepare: (page, h) => ready(page, h, ['One use, held for your gym']),
        target: card('Brinewell Hydration'),
        pad: 16,
        markers: {
            get: { text: 'Get a code', nth: 1, closest: 'button', anchor: 'right', dx: -22 },
            last: { text: 'Your last code', anchor: 'left', dx: -12 },
        },
    },
    // A code the gym took this week: the box, the copy button, the shop.
    {
        id: 'gym-discounts-code',
        portal: 'gym',
        path: '/venue/partners',
        ready: 'Partner discounts',
        fixtures,
        viewport: { width: 1600, height: 1260 },
        prepare: (page, h) => ready(page, h, ['Your code', 'Held for your gym', 'Terms']),
        target: card('Copperline Activewear'),
        pad: 16,
        markers: {
            label: { text: 'Your code', exact: true, anchor: 'right', dx: 16 },
            copy: { text: 'CPL-4QX9-M27R', closest: 'div', anchor: 'tr', dx: 4, dy: -4 },
            week: { text: 'Held for your gym', anchor: 'right', dx: 14 },
            shop: { text: 'Shop at', closest: 'a', anchor: 'right', dx: -22 },
            terms: { text: 'Terms', closest: 'summary', anchor: 'right', dx: 14 },
        },
    },
];
