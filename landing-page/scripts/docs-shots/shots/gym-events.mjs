// /docs/gyms/events
import { EVENTS } from '../fixtures/gym-core.mjs';
import { DRAFT, FINALE, FINALE_NIGHT, OPEN_START, PENDING, REJECTED, withEvents } from '../fixtures/gym-events.mjs';
import { GYM, photo } from '../world.mjs';
import { REWARD } from '../fixtures/partner-base.mjs';

const card = (text, extra = {}) => ({ text, closest: 'div.rounded-3xl', ...extra });

// The builder keeps an unfinished new event in sessionStorage; seeding it opens
// the builder on any step with The Northpoint Open filled in.
const OPEN = {
    name: 'The Northpoint Open',
    start_date: OPEN_START,
    duration_days: 7,
    night_start_hour: 19,
    night_hours: 3,
    scoring: 'all',
    activities: [],
    board_size: 20,
    points_preset_key: 'attend_25',
    own_rules: ['The finale night is free for everyone who joined. Bring a friend.'],
    prizes: [
        { label: 'A free month of membership', image_url: null },
        { label: 'Five PT sessions with Jordan', image_url: null },
        { label: 'Peakform Nutrition protein tub', image_url: null },
    ],
    partner_on: true,
    partner_reward_id: REWARD.id,
    partner_had: false,
    logo_url: null,
    logo_only: false,
    promo_headline: 'Seven days, any workout. Then a night at Northpoint.',
    promo_media_url: photo('tunnel.jpg'),
    booking_url: '',
    audience_radius_km: 2,
    pushes: { announce: true, kickoff: true, doors: true, rank_at: '19:00' },
    reveal: { mode: 'manual', at: '', auto: true },
};
const builder = (step, v = OPEN) => ({ session: { [`powr_event_builder:${GYM.id}`]: JSON.stringify({ tplKey: 'finale', v, step }) } });

// The portal's entrance animations (creator-rise) can still be at their first
// frame when a busy machine takes the still: finish them first.
const settle = async (page, h) => { await h.sleep(300); await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* infinite */ } })); };
// "Start over" only shows because the shot seeds the builder (a gym sees it after a reload).
const noStartOver = (page) => page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) if (b.textContent.trim() === 'Start over') b.style.visibility = 'hidden';
});
// A 1px invisible mark at the end of a label, so a pin can sit just after its
// words (labels are full-width blocks, so their own box ends far away).
// Markers then find it as after(key): { text: 'pin-<key>', anchor: 'right', dx }.
// A label starting with ~ matches any element whose own text contains the rest.
const mark = (page, list) => page.evaluate((items) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const [text, key, nth = 0] of items) {
        const hits = [...document.querySelectorAll('body *')].filter((el) => {
            const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
            const r = el.getBoundingClientRect();
            const hit = text.startsWith('~') ? own.includes(norm(text.slice(1))) : own === norm(text);
            return hit && r.width > 0 && r.height > 0;
        });
        const el = hits[nth];
        if (!el) throw new Error(`mark: no label "${text}"`);
        const s = document.createElement('span');
        s.textContent = `pin-${key}`;
        s.style.cssText = 'display:inline-block;width:1px;height:1em;overflow:hidden;color:transparent;vertical-align:middle;letter-spacing:0;margin:0;padding:0';
        el.append(s);
    }
}, list);
const after = (key, dx = 18) => ({ text: `pin-${key}`, anchor: 'right', dx });
// Chrome paints only what's in the window, so a target is centred in a tall
// enough one (with room below the page's end) before the capture crops it.
const center = async (page, h, sel) => {
    await page.evaluate(() => { document.body.style.paddingBottom = '900px'; });
    const el = await h.find(sel);
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await h.sleep(200);
};

// The page's clock, moved to `ms` (the fixtures' dates stay put): reloads with
// Date.now() and new Date() shifted, so time-of-day states show whenever it runs.
const clockAt = async (page, h, ms, ready) => {
    await page.evaluateOnNewDocument((t) => {
        const Real = Date;
        const shift = t - Real.now();
        class Shifted extends Real {
            constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); }
            static now() { return Real.now() + shift; }
        }
        window.Date = Shifted;
    }, ms);
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await h.wait(ready);
};

const LIVE = EVENTS.live.id;
const ev = (id, tab) => `/venue/events/${id}${tab ? `?tab=${tab}` : ''}`;
// The TV link carries the event's private key, and on this machine the origin is localhost.
const maskLinks = (page) => page.evaluate(() => {
    for (const c of document.querySelectorAll('code')) {
        c.textContent = c.textContent.replace(/^https?:\/\/localhost:\d+/, 'https://powr.life').replace(/\?k=.*$/, '?k=••••••••••••');
    }
});
// The Canal Street Showdown with two of its three prizes handed over.
const showdown = withEvents([], {
    [EVENTS.showdown.id]: { prizes: EVENTS.showdown.prizes.map((p) => (p.rank === 3 ? { rank: 3, label: p.label } : p)) },
});

export default [
    // ── The list ──────────────────────────────────────────────────────────
    {
        id: 'gym-events-list',
        portal: 'gym',
        path: '/venue/events',
        fixtures: withEvents([DRAFT]),
        ready: 'On now and coming up',
        viewport: { width: 1280, height: 1000 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['On now and coming up', 'groups']]); },
        markers: {
            groups: after('groups', 28),
            status: { text: 'Live', closest: 'span', anchor: 'right', dx: 26 },
            card: { text: 'Monthly challenge ·', nth: 0, anchor: 'left', dx: 300 },
            again: { text: 'Run again', closest: 'a', anchor: 'left', dx: -28 },
            new: { text: 'New event', closest: 'a', anchor: 'tr', dx: -6, dy: 4 },
        },
    },

    // ── The builder, filled in for The Northpoint Open ────────────────────
    {
        id: 'gym-events-builder-format',
        portal: 'gym',
        path: '/venue/events/new',
        storage: builder(0),
        ready: 'What kind of event?',
        viewport: { width: 1440, height: 1000 },
        prepare: async (page, h) => { await settle(page, h); await noStartOver(page); await center(page, h, { text: 'What kind of event?', closest: 'div.grid' }); },
        target: { text: 'What kind of event?', closest: 'div.grid' },
        pad: 16,
        markers: {
            rail: { text: 'Name, dates, reveal', anchor: 'right', dx: 26 },
            length: { text: '2 weeks to 6 weeks', anchor: 'right', dx: 22 },
            counts: { text: 'Counts sessions at', anchor: 'bl', dx: 12, dy: 26 },
            picked: { text: 'Points week + finale night', closest: 'button', anchor: 'br', dx: -30, dy: -28 },
            next: { text: 'Next: When', closest: 'button', anchor: 'right', dx: 26 },
        },
    },
    {
        id: 'gym-events-builder-when',
        portal: 'gym',
        path: '/venue/events/new',
        storage: builder(1),
        ready: 'Name and dates',
        viewport: { width: 1440, height: 1700 },
        prepare: async (page, h) => {
            await settle(page, h);
            await noStartOver(page);
            await h.wait('Scoring Fri');
            await mark(page, [['Event name', 'name'], ['How long', 'long'], ['Finale night starts', 'night'], ['Revealing the winners', 'reveal']]);
            await center(page, h, { text: 'Name and dates', closest: 'div.grid' });
        },
        target: { text: 'Name and dates', closest: 'div.grid' },
        pad: 16,
        markers: {
            name: after('name', 26),
            long: after('long', 26),
            night: after('night', 26),
            dates: { text: 'The board seals at midnight after the last day', closest: 'div.rounded-2xl', anchor: 'tr', dx: -26, dy: 26 },
            reveal: after('reveal', 26),
            phone: { text: 'On Home', closest: 'button', anchor: 'left', dx: -34 },
        },
    },
    {
        id: 'gym-events-builder-scoring',
        portal: 'gym',
        path: '/venue/events/new',
        storage: builder(2),
        ready: 'What counts',
        viewport: { width: 1279, height: 1700 },
        prepare: async (page, h) => {
            await settle(page, h);
            await h.wait('Any verified workout counts, wherever you train');
            await mark(page, [['Leaderboard', 'board'], ['Finale night bonus', 'bonus'], ['Written for you from your choices', 'rules']]);
            await center(page, h, { text: 'Members score points for verified activity', closest: 'div.rounded-3xl' });
        },
        target: { text: 'Members score points for verified activity', closest: 'div.rounded-3xl' },
        pad: 12,
        markers: {
            choices: { text: 'Every verified workout', closest: 'button', anchor: 'tr', dx: -22, dy: 22 },
            board: after('board'),
            bonus: after('bonus'),
            rules: after('rules'),
            own: { text: 'Add a rule of your own', closest: 'button', anchor: 'right', dx: 16 },
        },
    },
    {
        id: 'gym-events-builder-prizes',
        portal: 'gym',
        path: '/venue/events/new',
        storage: builder(3),
        ready: 'One code for everyone',
        viewport: { width: 1279, height: 1700 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['Optional', 'opt'], ['1st', 'first']]); await center(page, h, { text: '1st place first. You give these out', closest: 'div.rounded-3xl' }); },
        target: { text: '1st place first. You give these out', closest: 'div.rounded-3xl' },
        pad: 12,
        markers: {
            prize: after('first', 16),
            photo: { text: 'Add a photo', closest: 'label', anchor: 'right', dx: 16 },
            more: { text: 'Add a prize', closest: 'button', anchor: 'right', dx: 16 },
            partner: after('opt'),
            brand: { text: 'One code for everyone', closest: 'button', anchor: 'right', dx: 18 },
        },
    },
    {
        // The top of step 5: a window on the page, cut before the notifications.
        id: 'gym-events-builder-look',
        portal: 'gym',
        path: '/venue/events/new',
        storage: builder(4),
        ready: 'Promote it',
        viewport: { width: 1279, height: 1000 },
        prepare: async (page, h) => {
            await settle(page, h);
            await noStartOver(page);
            await h.scrollTo({ text: 'Promote it', closest: 'div.rounded-3xl' });
            await page.evaluate(() => window.scrollBy(0, -28));
            await mark(page, [['Headline', 'headline'], ['Picture or video', 'media'], ['Booking link', 'booking'], ['Who sees it in the app', 'reach']]);
        },
        markers: {
            logo: { text: 'Upload a logo', closest: 'label', anchor: 'right', dx: 30 },
            headline: after('headline', 30),
            media: after('media', 30),
            booking: after('booking', 30),
            reach: after('reach', 30),
        },
    },
    {
        id: 'gym-events-pending',
        portal: 'gym',
        path: ev(PENDING.id),
        fixtures: withEvents([PENDING]),
        ready: 'With POWR for a check',
        viewport: { width: 1280, height: 720 },
        prepare: settle,
        markers: {
            status: { text: 'Waiting for POWR', closest: 'span', anchor: 'left', dx: -28 },
            back: { text: 'Pull it back to edit', closest: 'button', anchor: 'right', dx: 26 },
        },
    },
    {
        id: 'gym-events-changes',
        portal: 'gym',
        path: ev(REJECTED.id),
        fixtures: withEvents([REJECTED]),
        ready: 'POWR asked for a change',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await center(page, h, card('What happens next')); },
        target: card('What happens next'),
        pad: 12,
        markers: {
            note: { text: 'Looks great. One thing', anchor: 'tr', dx: 14, dy: 10 },
            again: { text: 'Send again', closest: 'button', anchor: 'right', dx: 16 },
        },
    },

    // ── Running it: The Northpoint Grind, live ────────────────────────────
    {
        id: 'gym-events-page',
        portal: 'gym',
        path: ev(LIVE),
        fixtures: withEvents(),
        ready: 'Leaderboard',
        viewport: { width: 1280, height: 1100 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['Monthly challenge', 'format'], ['What happens next', 'next'], ['Leaderboard', 'board']]); },
        markers: {
            status: after('format', 28),
            facts: { text: 'prizes', exact: true, anchor: 'right', dx: 26 },
            next: after('next', 28),
            tabs: { text: 'Promote', exact: true, closest: '[role=tab]', anchor: 'right', dx: 26 },
            board: after('board', 28),
        },
    },
    {
        // The Weekend Sprint: twelve in, so the whole list fits.
        id: 'gym-events-people',
        portal: 'gym',
        path: ev(EVENTS.sprint.id, 'people'),
        fixtures: withEvents(),
        ready: 'Who’s in',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await center(page, h, card('Who’s in')); },
        target: card('Who’s in'),
        pad: 12,
        markers: {
            find: { text: 'Everyone', closest: '[role=radiogroup]', up: 1, anchor: 'left', dx: 194 },
            filter: { text: 'Removed', exact: true, closest: 'button', anchor: 'right', dx: 14 },
            export: { text: 'Export', closest: 'button', anchor: 'left', dx: -20 },
            guest: { text: 'Guest', exact: true, nth: 0, closest: 'span', anchor: 'right', dx: 14 },
            remove: { text: 'Remove', exact: true, nth: 0, closest: 'button', anchor: 'left', dx: -20 },
            back: { text: 'Put back', closest: 'button', anchor: 'left', dx: -20 },
        },
    },
    {
        id: 'gym-events-details',
        portal: 'gym',
        path: ev(LIVE, 'details'),
        fixtures: withEvents(),
        ready: 'Partner code for everyone',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['What counts', 'counts'], ['Shown to', 'shown'], ['Prizes', 'prizes'], ['Partner code for everyone', 'partner'], ['Rules', 'rules']]); await center(page, h, card('Board seals', { exact: true })); },
        target: card('Board seals', { exact: true }),
        pad: 12,
        markers: {
            counts: after('counts'),
            shown: after('shown'),
            prizes: after('prizes'),
            partner: after('partner'),
            rules: after('rules'),
            edit: { text: 'Edit words and pictures', closest: 'a', anchor: 'left', dx: -20 },
        },
    },
    {
        id: 'gym-events-pushes',
        portal: 'gym',
        path: ev(LIVE, 'promote'),
        fixtures: withEvents(),
        ready: 'Send today’s standings now',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['~with notifications on. Sent once', 'reach'], ['~to 118 people', 'sent']]); await center(page, h, card('POWR writes them and sends them at the right moment')); },
        target: card('POWR writes them and sends them at the right moment'),
        pad: 12,
        markers: {
            reach: after('reach'),
            sent: after('sent'),
            preview: { text: 'POWR · now', nth: 0, closest: 'div.rounded-2xl', anchor: 'tr', dx: -16, dy: 16 },
            time: { text: 'Daily standings', exact: true, anchor: 'right', dx: 14 },
            now: { text: 'Send today’s standings now', closest: 'button', anchor: 'right', dx: 16 },
        },
    },
    {
        id: 'gym-events-sharing',
        portal: 'gym',
        path: ev(LIVE, 'promote'),
        fixtures: withEvents(),
        ready: 'Screen and sharing',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await maskLinks(page); await mark(page, [['Event board for your TV', 'tv'], ['Page to share with members', 'share']]); await center(page, h, card('Screen and sharing')); },
        target: card('Screen and sharing'),
        pad: 12,
        markers: {
            tv: after('tv'),
            share: after('share'),
            qr: { text: 'Print it for the front desk', closest: 'div.flex-col', anchor: 'top', dx: 110, dy: 14 },
            print: { text: 'Print it for the front desk', closest: 'button', anchor: 'right', dx: 16 },
        },
    },
    {
        id: 'gym-events-content',
        portal: 'gym',
        path: ev(LIVE, 'promote'),
        fixtures: withEvents(),
        ready: 'Make the kit',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await h.sleep(2500); await center(page, h, card('Make the kit')); },
        target: card('Make the kit'),
        pad: 12,
        markers: {
            phase: { text: 'Before', exact: true, closest: 'button', anchor: 'left', dx: -16 },
            add: { text: 'Using the event’s promo picture', anchor: 'right', dx: 16 },
            look: { text: 'Colour', exact: true, closest: 'button', anchor: 'right', dx: 18 },
            posts: { text: 'Countdown', exact: true, anchor: 'right', dx: 16 },
            options: { text: 'Landscape for the TV', closest: 'label', anchor: 'right', dx: 16 },
            kit: { text: 'Make the kit', closest: 'button', anchor: 'left', dx: -16 },
        },
    },

    // ── A finale night: The Riverton Rumble, sealed, doors open tonight ───
    {
        id: 'gym-events-sealed',
        portal: 'gym',
        path: ev(FINALE.id, 'board'),
        fixtures: withEvents([FINALE]),
        ready: 'Only your team sees this until you reveal',
        viewport: { width: 1280, height: 1150 },
        prepare: async (page, h) => { await clockAt(page, h, FINALE_NIGHT, 'Only your team sees this until you reveal'); await settle(page, h); await mark(page, [['Or reveal it automatically at', 'auto'], ['Reveal the winners', 'revealbtn']]); },
        markers: {
            status: { text: 'Board sealed', closest: 'span', anchor: 'left', dx: -28 },
            reveal: after('revealbtn', 66),
            auto: after('auto', 28),
            only: { text: 'Only your team sees this until you reveal', anchor: 'left', dx: -28 },
        },
    },
    {
        id: 'gym-events-door',
        portal: 'gym',
        path: ev(FINALE.id),
        fixtures: withEvents([FINALE]),
        ready: 'Seen by POWR',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await clockAt(page, h, FINALE_NIGHT, 'Seen by POWR'); await settle(page, h); await h.type('input[aria-label="Find someone"]', 'sa'); await h.sleep(300); await center(page, h, card('Seen by POWR')); },
        target: card('Seen by POWR'),
        pad: 12,
        markers: {
            bonus: { text: 'POWR for coming', anchor: 'left', dx: -22 },
            counts: { text: 'Seen by POWR', exact: true, closest: 'div.rounded-2xl', anchor: 'tr', dx: -14, dy: 14 },
            hand: { text: 'By hand', exact: true, closest: 'div.rounded-2xl', anchor: 'tr', dx: -14, dy: 14 },
            find: { text: 'Registered', exact: true, closest: 'div.grid', anchor: 'br', dx: -26, dy: 44 },
            checkin: { text: 'Check in', exact: true, closest: 'button', anchor: 'left', dx: -16 },
        },
    },

    // ── After the reveal: The Canal Street Showdown ───────────────────────
    {
        id: 'gym-events-final',
        portal: 'gym',
        path: ev(EVENTS.showdown.id),
        fixtures: showdown,
        ready: 'Final results',
        viewport: { width: 1280, height: 1100 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['Final results', 'final']]); },
        markers: {
            facts: { text: 'prizes handed over', anchor: 'right', dx: 26 },
            again: { text: 'Run it again', closest: 'button', anchor: 'right', dx: 26 },
            final: after('final', 28),
        },
    },
    {
        id: 'gym-events-prizes',
        portal: 'gym',
        path: ev(EVENTS.showdown.id, 'details'),
        fixtures: showdown,
        ready: 'tick each one',
        viewport: { width: 1280, height: 1400 },
        prepare: async (page, h) => { await settle(page, h); await mark(page, [['Prizes · tick each one when it’s handed over', 'tick']]); await center(page, h, card('Board seals', { exact: true })); },
        target: card('Board seals', { exact: true }),
        pad: 12,
        markers: {
            tick: after('tick'),
            handed: { text: 'handed over', nth: 2, anchor: 'right', dx: 20 },
            open: { text: 'Peakform Nutrition protein tub', closest: 'li', anchor: 'left', dx: -14 },
            wallets: { text: 'since the reveal', anchor: 'right', dx: 14 },
        },
    },
];
