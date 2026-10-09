// /docs/gyms/settings (Settings & team): Settings card by card, the team and
// a fresh setup link, the emails, Help, the gym's page in the app and its
// trainer editor, the join poster and the Package page (prices taken out).
import { pkg } from '../fixtures/gym-base.mjs';

// The portal's cards rise in on load; frozen half-way on a busy machine they
// photograph blank. Reduced motion switches the rise off.
const calm = (page) => page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
/** Runs `then` after calming the page. */
const prep = (then) => async (page, h) => { await calm(page); if (then) await then(page, h); };
/** Scrolls the pane so `selector` sits mid-screen: a crop's padding then never runs off the window. */
const centre = (page, selector) => page.$eval(selector, (e) => e.scrollIntoView({ block: 'center' }));

/** A CSS selector with an anchor, for markers no text can find. */
const css = (selector, anchor, dx = 0, dy = 0) => Object.assign((page) => page.$(selector), { anchor, dx, dy });
/**
 * A pin just after the words `text` (a label or heading that is a full-width
 * block, so its own box ends far from the words): a zero-width mark is put
 * after the text and the pin goes `dx` to its right.
 */
const after = (text, { dx = 18, within = null, exact = true } = {}) => Object.assign((page) => page.evaluateHandle((t, w, ex) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(t);
    const root = w ? document.querySelector(w) : document.body;
    const hits = [...root.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        const txt = norm(el.innerText);
        return r.width > 0 && r.height > 0 && (ex ? txt === want : txt.includes(want));
    });
    const el = hits.filter((x) => !hits.some((o) => o !== x && x.contains(o)))[0];
    if (!el) return null;
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:1em;vertical-align:middle';
    el.appendChild(mark);
    return mark;
}, text, within, exact), { anchor: 'right', dx });

// Toasts ("Setup link copied") would sit over the bottom of a card.
const TOASTS = 'div.fixed.bottom-6.right-6';

/** Drop every price from the Package page: the guides never show what a package costs. */
async function stripPrices(page) {
    const left = await page.evaluate(() => {
        for (const row of document.querySelectorAll('div.mt-5.flex.items-baseline')) {
            row.nextElementSibling?.remove();          // "Always", "or … / year", "Paid upfront…"
            row.remove();                              // the price itself
        }
        for (const li of document.querySelectorAll('li')) if (/£/.test(li.textContent)) li.remove();
        // Nothing unbuilt in a public guide.
        for (const li of document.querySelectorAll('li')) if (/coming this season/i.test(li.textContent)) li.remove();
        return /£|\bper month\b/i.test(document.body.innerText) ? document.body.innerText.match(/.{0,40}£.{0,20}/)?.[0] ?? 'per month' : null;
    });
    if (left) throw new Error(`a price is still on the page: ${left}`);
}

export default [
    {
        id: 'gym-settings-page',
        portal: 'gym',
        path: '/venue/settings',
        ready: 'Save details',
        viewport: { width: 1280, height: 1880 },
        prepare: prep(),
        settle: 1500,
        markers: {
            // Shown at about 0.6 of its size, so the pins sit further off the words.
            details: after('Details', { dx: 36 }),
            hours: after('Opening hours', { dx: 36 }),
            logo: after('Logo', { dx: 36 }),
            photo: after('Photo', { dx: 36 }),
            package: after('Package', { dx: 36, within: 'main' }),
            email: after('Email', { dx: 36, within: '#recap' }),
        },
    },
    {
        id: 'gym-settings-email',
        portal: 'gym',
        path: '/venue/settings',
        ready: 'When someone starts drifting',
        viewport: { width: 1280, height: 1880 },
        prepare: prep((page) => centre(page, '#recap')),
        target: '#recap',
        pad: 16,
        markers: {
            recap: css('#recap label:not(.mt-5) input', 'left', -17),
            drift: css('#recap label.mt-5 input', 'left', -17),
        },
    },
    {
        id: 'gym-settings-team',
        portal: 'gym',
        path: '/venue/settings',
        ready: 'On the team',
        viewport: { width: 1280, height: 1500 },
        prepare: prep(async (page, h) => {
            await h.click('Copy a setup link instead');
            await h.wait('Latest link');
            await centre(page, '#team');
        }),
        hide: [TOASTS],
        target: '#team',
        pad: 16,
        markers: {
            invite: { text: 'Invite', exact: true, closest: 'button', anchor: 'tr', dx: -12, dy: 6 },
            copy: { text: 'Copy a setup link instead', closest: 'button', anchor: 'right', dx: -24 },
            latest: after('Latest link — works once, for 14 days'),
            waiting: { text: 'Waiting to join', anchor: 'right', dx: 18 },
            team: { text: 'On the team', anchor: 'right', dx: 18 },
            remove: { text: 'Remove', exact: true, closest: 'button', anchor: 'top', dy: -6 },
        },
    },
    {
        id: 'gym-settings-help',
        portal: 'gym',
        path: '/venue/settings',
        ready: 'Your requests',
        viewport: { width: 1280, height: 1500 },
        prepare: prep(async (page, h) => {
            await h.click({ text: 'The board on our reception TV stopped updating', closest: 'button' });
            await h.wait('lost its connection overnight');
            await centre(page, '#help');
        }),
        target: '#help',
        pad: 16,
        markers: {
            ask: { text: 'Ask POWR', exact: true, closest: 'button', anchor: 'tr', dx: -12, dy: 6 },
            guides: { text: 'How-to guides', closest: 'a', anchor: 'tr', dx: -12, dy: 6 },
            requests: after('Your requests'),
            status: { text: 'Answered', exact: true, anchor: 'left', dx: -16 },
            reply: { text: 'Thanks Sam', closest: 'div', anchor: 'tr', dx: -16, dy: 16 },
        },
    },
    {
        id: 'gym-app-card',
        portal: 'gym',
        path: '/venue',
        ready: 'Your page is complete',
        viewport: { width: 1280, height: 2330 },
        prepare: prep(),
        settle: 2000,
        target: '#app',
        pad: 16,
        markers: {
            phone: css('#app .gap-hint', 'tr', -40, 150),
            count: after('Your page is complete', { dx: 24 }),
            item: { text: 'Logo', exact: true, within: '#app', closest: 'button', anchor: 'tr', dx: -16, dy: 14 },
            order: css('button[aria-label="Move Kris Adeyemi up"]', 'left', -16),
            hidden: { text: 'Hidden', exact: true, within: '#app', anchor: 'right', dx: 22 },
            add: { text: 'Add someone', closest: 'button', anchor: 'right', dx: 22 },
        },
    },
    {
        id: 'gym-app-trainer',
        portal: 'gym',
        path: '/venue',
        ready: 'Your page is complete',
        viewport: { width: 1280, height: 2600 },
        prepare: prep(async (page, h) => {
            await h.click({ text: 'Jordan Hale', within: '#app ol', closest: 'button' });
            await h.wait('Booking link');
        }),
        settle: 2000,
        target: '#app',
        pad: 16,
        markers: {
            card: { text: 'Edit', exact: true, within: '#app .gap-hint', anchor: 'left', dx: -18 },
            photo: css('#app button[aria-label="Change photo"]', 'tr', -12, 12),
            role: { text: 'Manager', exact: true, within: '#app', closest: 'button', anchor: 'right', dx: 22 },
            specialties: after('Specialties', { dx: 24, within: '#app' }),
            booking: after('Booking link', { dx: 24, within: '#app' }),
            show: after('Show them in the app', { dx: 24, within: '#app' }),
        },
    },
    {
        id: 'gym-poster',
        portal: 'gym',
        path: '/venue/poster',
        ready: 'Download the poster kit',
        viewport: { width: 1280, height: 1100 },
        // The link under the QR reads lat=0.000000&lng=0.000000 for a gym
        // without coordinates (a real bug); it never goes in a guide.
        prepare: prep(async (page) => {
            await page.waitForFunction(() => document.querySelectorAll('img[data-thumb]').length >= 3, { timeout: 30000 }).catch(() => {});
            await page.$$eval('code', (els) => els.forEach((e) => { e.style.display = 'none'; }));
        }),
        settle: 1500,
        markers: {
            sizes: { text: 'Square', exact: true, closest: 'figure', anchor: 'right', dx: 34 },
            kit: { text: 'Download the poster kit', closest: 'button', anchor: 'right', dx: 34 },
            qr: css('div.p-4.bg-white', 'right', 34),
            copy: { text: 'Copy the link', closest: 'button', anchor: 'tr', dx: -16, dy: 8 },
            places: after('Three places it works', { dx: 36 }),
        },
    },
    {
        id: 'gym-package',
        portal: 'gym',
        path: '/venue/package',
        fixtures: { rpc: { gym_package: { ...pkg('trial'), requested: 'pro', requested_at: new Date().toISOString() } } },
        ready: 'Founding Pro',
        viewport: { width: 1440, height: 1480 },
        prepare: prep(stripPrices),
        settle: 1200,
        markers: {
            line: { text: 'Trial ·', closest: 'a', anchor: 'right', dx: -14 },
            // Shown at about half size: pins sit well clear of the words.
            days: after('days left', { dx: 40, within: 'main' }),
            stays: { text: 'What stays:', closest: 'p', anchor: 'left', dx: -34 },
            asked: { text: 'You asked for', closest: 'p', anchor: 'left', dx: -34 },
            founding: { text: 'First 10 gyms', exact: true, closest: 'div.rounded-3xl', anchor: 'top' },
            choose: { text: 'Choose Clash+', exact: true, closest: 'button', anchor: 'tr', dx: -16, dy: 8 },
        },
    },
];
