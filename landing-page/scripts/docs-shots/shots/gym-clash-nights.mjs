// /docs/gyms/clash-nights: Clash Nights (Clash Pro). Data: fixtures/gym-clash-nights.mjs.
import { PICK, PICK_BACKUP, TAKEN } from '../fixtures/gym-clash-nights.mjs';
import { pkg } from '../fixtures/gym-base.mjs';

// How the calendar names a day in its buttons' labels: "Fri 27 Nov 2026: …".
const dayLabel = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// The portal's cards rise in on load; jump every finite animation to its end
// so a busy machine never takes the still mid-rise.
const risen = (page) => page.evaluate(() => new Promise((done) => {
    for (const a of document.getAnimations()) {
        try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* leave it */ }
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
}));
// Full-width labels shrunk to their words (no visible change), so a pin can
// sit just right of them.
const fit = (page, texts) => page.evaluate((list) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const t of list) {
        for (const el of document.querySelectorAll('main *')) {
            const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
            if (own.startsWith(norm(t))) el.style.width = 'fit-content';
        }
    }
}, texts);
// A pin on an element found by CSS, with an anchor (the runner takes a
// function as a selector and reads the anchor off it).
const css = (selectors, opts = {}) => Object.assign(async (page) => {
    for (const s of [].concat(selectors)) {
        const el = await page.$(s);
        if (el) return el;
    }
    throw new Error(`no element for ${selectors}`);
}, opts);
// The nth element whose text is `text`, inside the card whose label is
// `label` (the same words appear in the quarters strip and the legend).
const inCard = (label, text, opts = {}) => Object.assign(async (page) => {
    const el = (await page.evaluateHandle((l, t, n) => {
        const norm = (x) => (x || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const head = [...document.querySelectorAll('main div')].find((d) => norm(d.innerText) === norm(l) && !d.children.length);
        const box = head?.closest('div.rounded-3xl');
        if (!box) return null;
        const own = (e) => norm([...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '));
        return [...box.querySelectorAll('*')].filter((e) => own(e) === norm(t))[n] ?? null;
    }, label, text, opts.nth ?? 0)).asElement();
    if (!el) throw new Error(`no "${text}" in the ${label} card`);
    return el;
}, opts);
// Form fields are React-controlled: set the value the way a person's input does.
const fill = (page, selector, value) => page.$eval(selector, (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
// British date and time fields (dd/mm/yyyy, 24-hour), as a UK gym sees them.
const british = async (page) => {
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-GB' }).catch(() => {});
};
const ready = async (page, h, labels = []) => { await h.wait('Your nights'); await h.sleep(500); await risen(page); await fit(page, labels); };

const NOTES = 'Around 60 expected. Christmas jumper theme, and the DJ can set up by the rig at the back.';
async function pickAndFill(page, h) {
    await british(page);
    await ready(page, h);
    await page.click(`button[aria-label^="${dayLabel(PICK)}:"]`);
    await h.wait('Ask POWR for this night');
    await fill(page, '#cn-time', '19:30');
    await fill(page, '#cn-backup', PICK_BACKUP);
    await fill(page, '#cn-notes', NOTES);
    await h.sleep(300);
    await risen(page);
    await fit(page, ['Starts at', 'Backup date', 'Anything we should know', 'Your night']);
}

const base = { portal: 'gym', path: '/venue/clash-nights', ready: 'Clash Nights' };
const card = (text) => ({ text, closest: 'div.rounded-3xl' });

export default [
    // The page: the quarters, the calendar beside the form, and your nights.
    {
        ...base,
        id: 'gym-clash-nights-page',
        viewport: { width: 1280, height: 1640 },
        prepare: (page, h) => ready(page, h, ['Pick a night', 'Your nights']),
        markers: {
            quarters: { text: 'Free to book', closest: 'div.rounded-2xl', anchor: 'br', dx: -26, dy: -26 },
            calendar: { text: 'Pick a night', exact: true, anchor: 'right', dx: 28 },
            form: { ...card('Pick a free date on the calendar'), anchor: 'tr', dx: -32, dy: 32 },
            nights: { text: 'Your nights', anchor: 'right', dx: 28 },
        },
    },
    // The quarters strip: each quarter from now to a year out, and its night.
    {
        ...base,
        id: 'gym-clash-nights-quarters',
        viewport: { width: 1280, height: 1000 },
        prepare: (page, h) => ready(page, h, ['How it works']),
        target: card('How it works'),
        pad: 16,
        markers: {
            notice: { text: 'How it works', anchor: 'right', dx: 20 },
            free: { text: 'Free to book', nth: 0, closest: 'div.rounded-2xl', anchor: 'br', dx: -20, dy: -20 },
            confirmed: { text: 'Confirmed', closest: 'div.rounded-2xl', anchor: 'br', dx: -20, dy: -20 },
            asked: { text: 'Asked', exact: true, closest: 'div.rounded-2xl', anchor: 'br', dx: -20, dy: -20 },
        },
    },
    // The calendar: greyed days, a night taken at another gym, the free days.
    {
        ...base,
        id: 'gym-clash-nights-calendar',
        viewport: { width: 1280, height: 1500 },
        prepare: (page, h) => ready(page, h),
        target: { text: 'Pick a night', exact: true, closest: 'div.rounded-3xl' },
        pad: 16,
        markers: {
            month: css('button[aria-label="Next month"]', { anchor: 'tr', dx: 2, dy: -2 }),
            soon: css(['button[aria-label$="Needs 28 days’ notice"]', 'button[aria-label$="More than a year ahead"]'], { anchor: 'tr', dx: -6, dy: 6 }),
            taken: css(`button[aria-label^="${dayLabel(TAKEN[0] ?? PICK)}:"]`, { anchor: 'tr', dx: -6, dy: 6 }),
            free: css(`button[aria-label^="${dayLabel(PICK)}:"]`, { anchor: 'tr', dx: -6, dy: 6 }),
            legend: { text: 'Can’t book', anchor: 'right', dx: 14 },
        },
    },
    // Asking for a night: a date picked, the start time, a backup and notes.
    {
        ...base,
        id: 'gym-clash-nights-form',
        viewport: { width: 1280, height: 1500 },
        prepare: pickAndFill,
        target: card('Ask POWR for this night'),
        pad: 16,
        markers: {
            date: { text: 'Your night', exact: true, anchor: 'right', dx: 16 },
            time: { text: 'Starts at', anchor: 'right', dx: 14 },
            backup: { text: 'Backup date', anchor: 'right', dx: 14 },
            notes: { text: 'Anything we should know', anchor: 'right', dx: 14 },
            send: { text: 'Ask POWR for this night', closest: 'button', anchor: 'right', dx: 14 },
        },
    },
    // Your nights: confirmed with POWR's note, asked and waiting, not possible.
    {
        ...base,
        id: 'gym-clash-nights-yours',
        viewport: { width: 1280, height: 1800 },
        prepare: (page, h) => ready(page, h),
        target: card('Your nights'),
        pad: 16,
        markers: {
            confirmed: inCard('Your nights', 'Confirmed', { anchor: 'right', dx: 20 }),
            note: { text: 'POWR:', nth: 0, closest: 'div', anchor: 'left', dx: -17 },
            asked: inCard('Your nights', 'Asked', { anchor: 'right', dx: 20 }),
            declined: { text: 'Not possible', anchor: 'right', dx: 20 },
            calloff: { text: 'Call off', nth: 0, closest: 'button', anchor: 'left', dx: -20 },
        },
    },
    // On a package without Clash Nights.
    {
        ...base,
        id: 'gym-clash-nights-locked',
        ready: 'See packages',
        viewport: { width: 1280, height: 900 },
        fixtures: { rpc: { gym_package: pkg('clash_plus'), gym_clash_nights: { included: false, package: 'clash_plus', today: '2026-01-01', first_date: '2026-01-29', last_date: '2027-01-01', lead_days: 28, per_year: 4, bookings: [], taken: [] } } },
        prepare: async (page, h) => { await h.sleep(400); await risen(page); },
        target: card('Clash Nights come with Clash Pro'),
        pad: 16,
    },
];
