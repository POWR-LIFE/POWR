// /docs/gyms/screens: the Screens page and the two boards themselves.
// The TVs on the page embed the real /gym/… and /league/… pages, fed by
// gym-core's gym-board and gym-league functions (slug northpoint-strength,
// key docs-board-key). The key is only ever in a URL, never on screen.
import core, { BOARD_ROW } from '../fixtures/gym-core.mjs';
import { GYM } from '../world.mjs';

// The portal's cards rise in on load; jump every finite animation to its end.
const risen = (page) => page.evaluate(() => new Promise((done) => {
    for (const a of document.getAnimations()) {
        try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* leave it */ }
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
}));
// Full-width labels shrunk to their words (no visible change), so a pin can sit just right of them.
const fit = (page, texts, root = 'main') => page.evaluate((list, scope) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const t of list) {
        for (const el of document.querySelectorAll(`${scope} *`)) {
            const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
            if (own.startsWith(norm(t))) el.style.width = 'fit-content';
        }
    }
}, texts, root);
// A pin on an element found by CSS (the runner reads the anchor off the function).
const css = (selector, opts = {}) => Object.assign(async (page) => {
    const el = await page.$(selector);
    if (!el) throw new Error(`no element for ${selector}`);
    return el;
}, opts);
// Each TV is an iframe of the real board. Both boards rotate scenes on a
// timer, so each is pinned to one (?scene=, the boards' own option) and the
// still never lands mid-change. Then wait until both have drawn, and jump
// their entrance animations to the end, as the page's own are.
async function boardsLive(page, h, n = 2) {
    await page.$$eval('main iframe', (frames) => frames.forEach((f) => {
        const scene = f.src.includes('/league/') ? 'local' : 'board';
        if (!f.src.includes('scene=')) f.src = `${f.src}&scene=${scene}`;
    }));
    await page.waitForFunction((want) => {
        const frames = [...document.querySelectorAll('main iframe')];
        return frames.length >= want && frames.every((f) => (f.contentWindow?.location?.href ?? '').includes('scene=') && (f.contentDocument?.body?.innerText ?? '').length > 200);
    }, { timeout: 150000, polling: 1000 }, n).catch(() => console.log('    (a TV preview was still loading)'));
    await h.sleep(5000);
    await page.$$eval('main iframe', (frames) => frames.forEach((f) => {
        for (const a of f.contentDocument?.getAnimations?.() ?? []) {
            try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* leave it */ }
        }
    }));
    await h.sleep(600);
}
const ready = async (page, h, labels = []) => { await h.wait('Weekly leaderboard'); await h.sleep(400); await risen(page); await fit(page, labels); };

const base = { portal: 'gym', path: '/venue/screens', ready: 'Your gym on the big screen' };
const row = (screen) => ({ text: screen, exact: true, closest: 'div.grid' });
// Screens as a gym sees them before (or while one is paused), from the summary the page reads.
const summary = (board) => ({ rpc: { gym_portal_summary: { role: 'owner', gym: { id: GYM.id, name: GYM.name }, board } } });

// The big screens, signed out, exactly as a TV opens them.
const tv = (id, path, markers, labels = []) => ({
    id,
    portal: 'none',
    path,
    fixtures: { fn: { 'gym-board': core.fn['gym-board'], 'gym-league': core.fn['gym-league'] } },
    viewport: { width: 1920, height: 1080 },
    ready: 'Northpoint',
    // Gym Clash's map draws real map tiles (open sea, so no place names): let them land.
    prepare: async (page, h) => {
        await h.sleep(4000);
        await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
        await fit(page, labels, 'body');
    },
    quality: 76,
    markers,
});
// Pins on a 1920 wide still sit well clear of the words: the guide shows it at about 40%.
const KEY = `k=${BOARD_ROW.display_token}`;

export default [
    // The page: both TVs live, each with its settings beside it.
    {
        ...base,
        id: 'gym-screens-page',
        viewport: { width: 1280, height: 1360 },
        prepare: async (page, h) => { await ready(page, h); await boardsLive(page, h); },
        markers: {
            tv1: css('iframe[title^="Weekly leaderboard"]', { anchor: 'tr', dx: -30, dy: 30 }),
            settings1: { text: 'Screen 1', exact: true, closest: 'div.rounded-3xl', anchor: 'tr', dx: -32, dy: 32 },
            tv2: css('iframe[title^="Gym Clash"]', { anchor: 'tr', dx: -30, dy: 30 }),
            settings2: { text: 'Screen 2', exact: true, closest: 'div.rounded-3xl', anchor: 'tr', dx: -32, dy: 32 },
        },
    },
    // Screen 1 and its controls: open, copy, pause, viewing distance, board size.
    {
        ...base,
        id: 'gym-screens-leaderboard',
        viewport: { width: 1280, height: 1500 },
        prepare: async (page, h) => { await ready(page, h, ['Viewing distance', 'Board size']); await boardsLive(page, h); },
        target: row('Screen 1'),
        pad: 16,
        markers: {
            live: css('span.h-7.rounded-full', { anchor: 'tr', dx: -4, dy: -2 }),
            preview: { text: 'Sample members', closest: '[role=radiogroup]', anchor: 'tr', dx: 2, dy: -2 },
            actions: { text: 'Copy link', nth: 0, closest: 'button', anchor: 'tr', dx: 2, dy: -2 },
            viewing: { text: 'Viewing distance', anchor: 'right', dx: 24 },
            size: { text: 'Board size', anchor: 'right', dx: 24 },
        },
    },
    // Screen 2: Gym Clash and how far "nearby" reaches.
    {
        ...base,
        id: 'gym-screens-league',
        viewport: { width: 1280, height: 1500 },
        prepare: async (page, h) => { await ready(page, h, ['Nearby means within']); await boardsLive(page, h); },
        target: row('Screen 2'),
        pad: 16,
        markers: {
            tv: css('iframe[title^="Gym Clash"]', { anchor: 'tr', dx: -20, dy: 20 }),
            pause: { text: 'Pause', exact: true, nth: 1, closest: 'button', anchor: 'right', dx: 22 },
            radius: { text: 'Nearby means within', anchor: 'right', dx: 24 },
        },
    },
    // Screen 1 paused: the TV on the page goes dark, the pill says Paused.
    {
        ...base,
        id: 'gym-screens-paused',
        viewport: { width: 1280, height: 1100 },
        fixtures: summary({ ...BOARD_ROW, enabled: false }),
        prepare: async (page, h) => { await ready(page, h); await boardsLive(page, h, 1); },
        target: row('Screen 1'),
        pad: 16,
        markers: {
            tv: css('div.aspect-video', { anchor: 'tr', dx: -20, dy: 20 }),
            pill: css('span.h-7.rounded-full', { anchor: 'tr', dx: -4, dy: -2 }),
            resume: { text: 'Resume', closest: 'button', anchor: 'right', dx: 22 },
        },
    },
    // Before the screens are switched on (the owner's view).
    {
        ...base,
        id: 'gym-screens-off',
        ready: 'Switch on your screens',
        viewport: { width: 1280, height: 1000 },
        fixtures: summary(null),
        prepare: async (page, h) => { await h.sleep(400); await risen(page); await fit(page, ['Your screen link']); },
        target: { text: 'Switch on your screens', closest: 'div.grid' },
        pad: 16,
        markers: {
            tv: { text: 'The weekly leaderboard, live on your TV', closest: 'div.aspect-video', anchor: 'tr', dx: -20, dy: 20 },
            link: { text: 'Your screen link', anchor: 'right', dx: 24 },
            on: { text: 'Switch on the screens', closest: 'button', anchor: 'tr', dx: -14, dy: 0 },
        },
    },
    // Putting it on the TV, and the owner's Make a new link.
    {
        ...base,
        id: 'gym-screens-tv-steps',
        viewport: { width: 1280, height: 1800 },
        prepare: async (page, h) => { await ready(page, h, ['Open the link', 'Go full screen', 'Leave it running']); },
        target: { text: 'Putting it on the TV', closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            open: { text: 'Open the link', anchor: 'right', dx: 22 },
            full: { text: 'Go full screen', anchor: 'right', dx: 22 },
            running: { text: 'Leave it running', anchor: 'right', dx: 22 },
            rotate: { text: 'Make a new link', closest: 'button', anchor: 'tr', dx: -6, dy: -2 },
        },
    },
    // The boards themselves, full size, as a TV opens them.
    tv('gym-tv-board', `/gym/${GYM.slug}?${KEY}&scene=board`, {
        week: { text: 'Resets Monday', up: 1, anchor: 'right', dx: 40 },
        scene: { text: 'Leaderboard', exact: true, anchor: 'right', dx: 44 },
        champion: { text: 'Last week’s champion', anchor: 'right', dx: 44 },
        qr: { text: 'Get on the board', up: 2, anchor: 'left', dx: -40 },
        feed: { text: 'Live feed', anchor: 'left', dx: -60 },
    }, ['Last week’s champion']),
    tv('gym-tv-week', `/gym/${GYM.slug}?${KEY}&scene=community`, {
        days: { text: 'Points by day', anchor: 'right', dx: 44 },
        rank: { text: 'POWR gyms', up: 1, anchor: 'left', dx: -44 },
    }, ['Points by day']),
    tv('gym-tv-clash', `/league/${GYM.slug}?${KEY}&scene=local`, {
        lens: css('.gl-lens', { anchor: 'left', dx: -44 }),
        host: css('.gl-lane.host', { anchor: 'tl', dx: 0, dy: 0 }),
        map: css('.gl-mapwrap', { anchor: 'tl', dx: 44, dy: 44 }),
    }),
    tv('gym-tv-clash-duel', `/league/${GYM.slug}?${KEY}&scene=duel`, {
        gap: { text: 'Gap to close', anchor: 'top', dy: -44 },
        share: { text: 'Share of the week so far', anchor: 'top', dy: -52 },
    }),
];
