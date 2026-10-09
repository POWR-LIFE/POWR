// /docs/gyms (Getting started): the setup link, signing in, the Overview card
// by card, the phone layout and a locked page.
import settings from '../fixtures/gym-settings.mjs';
import { pkg } from '../fixtures/gym-base.mjs';
import { OWNER } from '../world.mjs';

// The setup and sign-in pages are signed out, so they get no portal fixtures:
// only the logins function the setup page asks.
const signedOut = { fn: { 'manage-gym-staff': settings.fn['manage-gym-staff'] } };

// The portal's cards rise in on load; frozen half-way on a busy machine they
// photograph blank. Reduced motion switches the rise off.
const calm = (page) => page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const prep = (then) => async (page, h) => { await calm(page); if (then) await then(page, h); };

/**
 * A pin just after the words `text` (a label that is a full-width block, so
 * its own box ends far from the words): a zero-width mark goes after the
 * text and the pin sits `dx` to its right.
 */
const after = (text, { dx = 18, within = null } = {}) => Object.assign((page) => page.evaluateHandle((t, w) => {
    const norm = (x) => (x || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const root = w ? document.querySelector(w) : document.body;
    const hits = [...root.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && norm(el.innerText) === norm(t); });
    const el = hits.filter((x) => !hits.some((o) => o !== x && x.contains(o)))[0];
    if (!el) return null;
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:1em;vertical-align:middle';
    el.appendChild(mark);
    return mark;
}, text, within), { anchor: 'right', dx });

const CARD = 'div.rounded-3xl';
/** A CSS selector with an anchor, for markers no text can find. */
const css = (selector, anchor, dx = 0, dy = 0) => Object.assign((page) => page.$(selector), { anchor, dx, dy });
/** The card holding `selector` (for a card whose title text appears elsewhere too). */
const cardOf = (selector, props = {}) => Object.assign((page) => page.evaluateHandle((sel, card) => document.querySelector(sel)?.closest(card), selector, CARD), props);
// Gym Clash's title is also a caption in Posts for this week, so it's found by its table.
const CLASH = 'ol[aria-label^="Gym Clash"]';
/** A pin on a card's top edge, centred. */
const top = (text) => ({ text, exact: true, closest: CARD, anchor: 'top' });
/** A pin on a card's left edge, level with the row holding `text`. */
const edge = (text, closest = 'li', extra = {}) => ({ text, closest, anchor: 'left', dx: -24, ...extra });

// The Overview, loaded once per shot. Tall enough that the whole page fits,
// so a card is never cut off by the scrolling pane.
const overview = (id, more) => ({
    id, portal: 'gym', path: '/venue', ready: 'Worth doing this week',
    viewport: { width: 1280, height: 2330 }, prepare: prep(), settle: 2500, ...more,
});

export default [
    {
        id: 'gym-setup',
        portal: 'none',
        path: '/venue/setup/docs-setup-link',
        fixtures: signedOut,
        ready: 'Set up your access',
        target: '.max-w-md',
        pad: 24,
        markers: {
            role: after('Owner access'),
            existing: { text: 'I use POWR', closest: 'button', anchor: 'tr', dx: -12, dy: 6 },
            fresh: { text: 'New to POWR', closest: 'button', anchor: 'tr', dx: -12, dy: 6 },
            password: { text: '— optional', anchor: 'right', dx: 18 },
            send: { text: 'Email me a sign-in link', closest: 'button', anchor: 'tr', dx: -14, dy: 8 },
        },
    },
    {
        id: 'gym-login',
        portal: 'none',
        path: '/venue/login',
        fixtures: signedOut,
        ready: 'Welcome back',
        prepare: async (page, h) => {
            await h.type('input[type=email]', OWNER.email);
            await h.type('input[type=password]', 'northpoint-docs');
        },
        target: '.max-w-md',
        pad: 24,
        markers: {
            email: after('Email address'),
            password: { text: '— optional', anchor: 'right', dx: 18 },
            signin: { text: 'Sign In', exact: true, closest: 'button', anchor: 'tr', dx: -14, dy: 8 },
            forgot: { text: 'Forgot it?', closest: 'button', anchor: 'right', dx: -20 },
        },
    },
    overview('gym-overview-page', {
        markers: {
            week: top('This week'),
            moves: top('Worth doing this week'),
            posts: { text: 'Posts for this week', closest: CARD, anchor: 'top' },
            app: top('Your gym in the app'),
            people: top('Your people'),
            clash: cardOf(CLASH, { anchor: 'top' }),
            since: cardOf('figure[aria-label="Sessions here each week"]', { anchor: 'top' }),
        },
    }),
    overview('gym-overview-week', {
        target: { text: 'This week', exact: true, closest: CARD },
        pad: 16,
        markers: {
            count: { text: 'sessions ·', anchor: 'right', dx: 18 },
            now: { text: 'in the gym now', closest: 'div', anchor: 'right', dx: 18 },
            story: css('p.leading-snug.shrink-0', 'left', -24),     // the sentence, whatever it says today
            pace: edge('so far', 'figure'),
            days: css('[aria-label^="Sessions each day"]', 'left', -24),
        },
    }),
    overview('gym-overview-moves', {
        target: { text: 'Worth doing this week', exact: true, closest: CARD },
        pad: 16,
        markers: {
            first: edge('regulars are drifting'),
            nudge: { text: 'Nudge', closest: 'button', anchor: 'top', dy: -14 },
            event: edge('is live'),
            league: edge('POWR behind'),
        },
    }),
    overview('gym-overview-people', {
        target: { text: 'Your people', exact: true, closest: CARD },
        pad: 16,
        markers: {
            lead: edge('Leads the board'),
            improved: edge('Most improved'),
            session: edge('Session of the week'),
            streak: edge('Longest streak'),
            fresh: edge('New this week:', 'div'),
            counts: { text: 'members ·', anchor: 'left', dx: -24 },
        },
    }),
    overview('gym-overview-clash', {
        target: cardOf(CLASH),
        pad: 16,
        markers: {
            rank: { text: 'within 10 km', closest: 'div', anchor: 'left', dx: -24 },
            table: { text: 'Northpoint Strength', within: 'ol[aria-label^="Gym Clash"]', closest: 'li', anchor: 'left', dx: -14 },
            gap: { text: 'behind Ironvale Gym · about', closest: 'div', anchor: 'left', dx: -24 },
            effort: { text: 'Per member', closest: 'div', anchor: 'left', dx: -24 },
        },
    }),
    {
        id: 'gym-overview-phone',
        portal: 'gym',
        path: '/venue',
        ready: 'Worth doing this week',
        mobile: true,
        prepare: prep(),
        settle: 2500,
        markers: {
            page: after('Overview', { within: 'header' }),
            account: css('header button[aria-label^="Account"]', 'left', -16),
            tabs: { text: 'Home', exact: true, closest: 'nav', anchor: 'top' },
        },
    },
    {
        id: 'gym-locked',
        portal: 'gym',
        path: '/venue/members',
        fixtures: { rpc: { gym_package: pkg('clash') } },
        ready: 'See packages',
        prepare: prep(),
        settle: 1500,
        markers: {
            line: { text: 'Clash · free', closest: 'a', anchor: 'right', dx: -16 },
            lock: { text: 'Members', exact: true, closest: 'a', anchor: 'right', dx: 12 },
            // Shown at about 0.6 of its size, so the pins sit further off the words.
            comes: { text: 'Clash+ and Clash Pro', anchor: 'right', dx: 36 },
            yours: after('You’re on Clash, the free package.', { dx: 36 }),
            see: { text: 'See packages', closest: 'a', anchor: 'right', dx: 36 },
        },
    },
];
