// /docs/settings: the Settings page, its Team panel, and Support.
import { BASE_URL } from '../world.mjs';

// Setup links are built from the page's own origin, which in a capture is the
// local dev server. Show the address a brand really sees.
const showLiveOrigin = (page) => page.evaluate((from) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.nodeValue.includes(from)) n.nodeValue = n.nodeValue.split(from).join('https://powr.life');
    }
}, BASE_URL);

// A marker on a CSS-selected element (the nth match), placed by anchor.
const at = (css, anchor, dx = 0, dy = 0, nth = 0) => Object.assign(async (page) => (await page.$$(css))[nth], { anchor, dx, dy });

const TALL = { width: 1440, height: 2600 };
const TEAM_PANEL = { text: 'Invite by email', closest: 'div.overflow-hidden' };

export default [
    {
        // The page as it opens, sidebar and all.
        id: 'partner-settings',
        portal: 'partner',
        path: '/partner/settings',
        ready: 'Team Members',
        viewport: { width: 1440, height: 1000 },
        prepare: showLiveOrigin,
        markers: {
            nav: { text: 'Settings', exact: true, within: 'aside', closest: 'a', anchor: 'right', dx: -18 },
            brand: { text: 'Brand Info', closest: 'div.rounded-3xl', anchor: 'tr', dx: -30, dy: 30 },
            delivery: { text: 'Delivery Method', closest: 'a', anchor: 'tr', dx: -30, dy: 30 },
            team: { text: 'Team', exact: true, within: 'main', closest: 'div.overflow-hidden', anchor: 'tr', dx: -30, dy: 30 },
            help: { text: 'Need a Hand?', closest: 'div[class*="rounded"]', anchor: 'tr', dx: -30, dy: 30 },
        },
    },
    {
        // Change Password, filled in and ready to update.
        id: 'partner-settings-password',
        portal: 'partner',
        path: '/partner/settings',
        ready: 'Team Members',
        viewport: TALL,
        prepare: async (page) => {
            const [current, next, confirm] = await page.$$('form input[type=password]');
            await current.type('peakform-2026');
            await next.type('peakform-autumn-26');
            await confirm.type('peakform-autumn-26');
            await page.evaluate(() => document.activeElement?.blur());
        },
        target: { text: 'Change Password', closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            current: at('form input[type=password]', 'right', -26, 0, 0),
            next: at('form input[type=password]', 'right', -26, 0, 1),
            confirm: at('form input[type=password]', 'right', -26, 0, 2),
            update: { text: 'Update Password', closest: 'button', anchor: 'left', dx: -22 },
        },
    },
    {
        // Team: an address typed ready to send, two open links, three logins,
        // and the pointer over a teammate's row so its Revoke shows.
        id: 'partner-settings-team',
        portal: 'partner',
        path: '/partner/settings',
        ready: 'Team Members',
        viewport: TALL,
        prepare: async (page, h) => {
            await showLiveOrigin(page);
            await h.type('input[placeholder="brand@email.com"]', 'taylor@peakform.example');
            await page.evaluate(() => document.activeElement?.blur());
            await (await h.find({ text: 'jordan@peakform.example', closest: 'div.group' })).hover();
        },
        target: TEAM_PANEL,
        pad: 16,
        markers: {
            invite: { text: 'Send', exact: true, closest: 'button', anchor: 'tr', dx: -8, dy: 8 },
            link: { text: 'Copy a setup link instead', closest: 'button', anchor: 'right', dx: -22 },
            open: { text: 'Open Setup Links', anchor: 'right', dx: 34 },
            you: { text: 'You', exact: true, within: 'main', anchor: 'right', dx: 34 },
            revoke: { text: 'Revoke', nth: 2, closest: 'button', anchor: 'left', dx: -16 },
        },
    },
    {
        // A new ticket written and ready to send.
        id: 'partner-support-form',
        portal: 'partner',
        path: '/partner/support',
        ready: 'Your Tickets',
        viewport: TALL,
        prepare: async (page, h) => {
            // No spell-check squiggles under made-up names.
            await page.evaluate(() => document.querySelectorAll('input, textarea').forEach((e) => { e.spellcheck = false; }));
            await h.click('Account & Team');
            await h.type('form input[type=text]', 'Changing our brand name to Peakform');
            await h.type('form textarea', 'We’re shortening our name to Peakform on our packaging from November. Can our brand name on POWR change to match? Our reward listings can stay as they are.');
            await page.evaluate(() => document.activeElement?.blur());
        },
        target: 'form',
        pad: 16,
        markers: {
            topic: { text: 'Setup & Integration', closest: 'button', anchor: 'tr', dx: -20, dy: 20 },
            subject: at('form input[type=text]', 'right', -26),
            message: at('form textarea', 'br', -26, -26),
            send: { text: 'Send Ticket', closest: 'button', anchor: 'tr', dx: -10, dy: 8 },
        },
    },
    {
        // Your Tickets, with the answered one opened to show POWR's reply.
        id: 'partner-support-tickets',
        portal: 'partner',
        path: '/partner/support',
        ready: 'Adding Casey back to our team',
        viewport: TALL,
        prepare: async (page, h) => {
            await h.click({ text: 'Adding Casey back to our team', closest: 'button' });
        },
        target: { text: 'Your Tickets', closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            awaiting: { text: 'awaiting reply', anchor: 'left', dx: -22 },
            status: { text: 'Open', exact: true, within: 'main', closest: 'span', anchor: 'left', dx: -22 },
            message: { text: 'Your Message', anchor: 'tr', dx: -6, dy: 4 },
            reply: { text: 'POWR Support', exact: true, within: 'main', anchor: 'tr', dx: -14, dy: 4 },
        },
    },
];
