// /docs/in-store: Peakform Nutrition taking rewards at its own tills. The
// in-store data lives in fixtures/instore.mjs and is passed in per shot, so
// no other partner screenshot grows an "In Store" menu item.
import INSTORE, { SCAN_TOKEN } from '../fixtures/instore.mjs';
import { REWARD } from '../fixtures/partner-base.mjs';
import { holdStill } from './partner-rewards.mjs';

const scanStorage = { local: { 'powr:scan:token': SCAN_TOKEN } };

export default [
    {
        id: 'partner-instore-reward',
        portal: 'partner',
        path: '/partner/in-store',
        fixtures: INSTORE,
        ready: 'Your shops',
        viewport: { width: 1280, height: 1700 },
        prepare: async (page, h) => {
            await holdStill(page);
            await h.click({ text: REWARD.title, closest: 'button' });
            await h.wait('How does your shop check it?');
            await page.mouse.move(2, 2);
        },
        target: { text: REWARD.title, closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            where: { text: 'Where can members use it?', anchor: 'left', dx: -16 },
            how: { text: 'How does your shop check it?', anchor: 'left', dx: -16 },
            stand: { text: 'Members scan your QR stand first', anchor: 'left', dx: -16 },
            spend: { text: 'Ask staff for the spend', anchor: 'left', dx: -16 },
            shops: { text: 'Which shops?', anchor: 'left', dx: -16 },
            member: { text: 'What the member does', anchor: 'left', dx: -16 },
        },
    },
    {
        id: 'partner-instore-sites',
        portal: 'partner',
        path: '/partner/in-store?tab=sites',
        fixtures: INSTORE,
        ready: 'Market Square',
        viewport: { width: 1280, height: 1500 },
        prepare: holdStill,
        markers: {
            nav: { text: 'In Store', exact: true, closest: 'a', anchor: 'right', dx: -12 },
            add: { text: 'Add a shop', closest: 'button', anchor: 'left', dx: -10 },
            scanned: { text: 'Last scan 12 min ago', anchor: 'left', dx: -12 },
            pin: { text: 'Map pin', nth: 0, anchor: 'tr', dx: 120 },
            stand: { text: 'Print stand', nth: 0, closest: 'a', anchor: 'right', dx: 8 },
            swipes: { text: 'Swipes but no scans yet', anchor: 'left', dx: -12 },
        },
    },
    {
        id: 'partner-instore-staff',
        portal: 'partner',
        path: '/partner/in-store?tab=staff',
        fixtures: INSTORE,
        ready: 'Staff with a scan link',
        viewport: { width: 1280, height: 1300 },
        prepare: async (page, h) => {
            await holdStill(page);
            await h.type('#staff-name', 'Jess');
            await page.select('#staff-site', (await page.$eval('#staff-site option:nth-child(2)', (o) => o.value)));
            await h.click('Make scan link');
            await h.wait('Scan link for Jess');
            // Show the link as staff would get it, with the token masked.
            await page.evaluate(() => {
                const code = [...document.querySelectorAll('code')].find((c) => c.textContent.includes('/scan#k='));
                if (code) code.textContent = 'https://powr.life/scan#k=••••••••••••••••••••••••••••••••';
            });
            await page.mouse.move(2, 2);
        },
        markers: {
            make: { text: 'Make scan link', closest: 'button', anchor: 'left', dx: -10 },
            link: { text: 'Scan link for Jess', anchor: 'left', dx: -14 },
            list: { text: 'Staff with a scan link', anchor: 'left', dx: -14 },
            notOpened: { text: 'Link not opened yet', anchor: 'left', dx: -12 },
        },
    },
    {
        id: 'instore-scan-valid',
        portal: 'none',
        path: '/scan',
        fixtures: INSTORE,
        storage: scanStorage,
        mobile: true,
        ready: 'Camera not working?',
        prepare: async (page, h) => {
            await h.type('#typed-code', 'K7Q4P2');
            await h.click('Check');
            await h.wait('Confirm and apply discount');
            await h.type('#scan-spend', '38.40');
            await page.evaluate(() => document.activeElement?.blur());
        },
        settle: 300,
        markers: {
            who: { text: 'Peakform Nutrition · Sam', anchor: 'bottom', dy: 6 },
            valid: { text: 'VALID', anchor: 'right', dx: 10 },
            closes: { text: 'closes in', anchor: 'right', dx: 6 },
            spend: { text: 'What did they spend?', anchor: 'right', dx: 8 },
            confirm: { text: 'Confirm and apply discount', closest: 'button', anchor: 'right', dx: -16 },
        },
    },
    {
        id: 'instore-kiosk',
        portal: 'none',
        path: '/scan?kiosk=1',
        fixtures: INSTORE,
        storage: scanStorage,
        viewport: { width: 1180, height: 820 },
        ready: 'Got a POWR reward?',
        settle: 600,
        markers: {
            tabs: { text: 'Scan a member', closest: 'button', anchor: 'right', dx: 8 },
            qr: { text: 'Scan here.', anchor: 'right', dx: 10 },
            timer: { text: 'New code in', anchor: 'left', dx: -12 },
            today: { text: 'TODAY AT', anchor: 'left', dx: -12 },
        },
    },
    {
        id: 'partner-redemptions-instore',
        portal: 'partner',
        path: '/partner/redemptions',
        fixtures: INSTORE,
        ready: 'Opened at the till',
        // Tall enough that the section never scrolls inside the portal's frame.
        viewport: { width: 1280, height: 3000 },
        prepare: holdStill,
        target: { text: 'What happened to the', closest: 'section' },
        pad: 16,
        markers: {
            opened: { text: 'Opened at the till', anchor: 'tr', dx: 60 },
            confirmed: { text: 'Confirmed', exact: true, nth: 0, anchor: 'tr', dx: 60 },
            swiped: { text: 'Swiped, not confirmed', nth: 0, anchor: 'tr', dx: 30 },
            spend: { text: 'Spend recorded', anchor: 'tr', dx: 40 },
            bar: { text: 'What happened to the', anchor: 'right', dx: 12 },
            shops: { text: 'By shop', anchor: 'right', dx: 12 },
            latest: { text: 'Latest in store', anchor: 'right', dx: 12 },
        },
    },
];
