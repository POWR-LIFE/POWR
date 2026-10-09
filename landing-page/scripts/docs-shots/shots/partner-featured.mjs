// /docs/whats-on: the What's On page, its calendar, Your Requests and the
// Request a week form. Data: fixtures/partner-featured.mjs.

// A CSS selector with an anchor, for markers no text can pick out.
const css = (selector, props = {}) => Object.assign((page) => page.$(selector), props);


// A pin just after a label's words. Labels are full-width blocks, so the
// runner's anchors can't find where the words end: measure it here and set
// the marker's offset before the runner reads it.
async function pinAfterText(h, markers, keys, gap = 18) {
    for (const key of keys) {
        const el = await h.find(markers[key]);
        const end = await el.evaluate((e) => {
            const r = document.createRange();
            r.selectNodeContents(e);
            return Math.max(...[...r.getClientRects()].map((x) => x.right)) - e.getBoundingClientRect().left;
        });
        Object.assign(markers[key], { anchor: 'left', dx: Math.round(end + gap) });
    }
}

// The calendar opens on this month.
const MONTH = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const CARD = 'div[class*="rounded-3xl"]';

// The quick-fill week the form shot picks: four Mondays on, which is free.
const freeWeek = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 28);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
})();

const FORM_PINS = {
    reward: { text: 'Reward to feature', closest: 'label' },
    dates: { text: 'Until', closest: 'label' },
    quick: { text: 'Quick fill' },
    note: { text: 'Anything we should know?', closest: 'label' },
    send: { text: 'Send Request', closest: 'button', anchor: 'tr', dx: -10, dy: 6 },
};

const base = { portal: 'partner', path: '/partner/featured', ready: 'Your Requests' };

export default [
    {
        ...base,
        id: 'partner-whatson-page',
        markers: {
            request: { text: 'Request A Week', closest: 'button', anchor: 'tr', dx: -14, dy: 8 },
            now: { text: 'Featured Now', closest: CARD, anchor: 'tr', dx: -28, dy: 28 },
            windows: { text: 'Your featured windows', closest: CARD, anchor: 'tr', dx: -28, dy: 28 },
            calendar: { text: MONTH, anchor: 'right', dx: 22 },
        },
    },
    {
        ...base,
        id: 'partner-whatson-calendar',
        viewport: { width: 1280, height: 1400 },
        target: { text: MONTH, closest: CARD },
        pad: 16,
        markers: {
            confirmed: css('div[title="Hushwell Sleep"]', { anchor: 'center', dy: -20 }),
            yours: css('button[title="Peakform Nutrition"]', { anchor: 'tr', dx: -4, dy: 4 }),
            request: css('div[title$="(requested)"]', { anchor: 'center', dy: -20 }),
            today: css('.grid-cols-7 span[class*="bg-[#E8D200]"]', { anchor: 'right', dx: 16 }),
            months: css('button[aria-label="Next month"]', { anchor: 'right', dx: 17 }),
        },
    },
    {
        ...base,
        id: 'partner-whatson-requests',
        viewport: { width: 1280, height: 2300 },
        target: { text: 'Your Requests', closest: CARD },
        pad: 16,
        markers: {
            pending: { text: 'Awaiting review', exact: true, anchor: 'left', dx: -30 },
            withdraw: { text: 'Withdraw', exact: true, anchor: 'top', dy: -12 },
            confirmed: { text: 'Confirmed', exact: true, nth: 0, anchor: 'left', dx: -20 },
            declined: { text: 'That week was taken', closest: 'p', anchor: 'right', dx: -40 },
        },
    },
    {
        ...base,
        id: 'partner-whatson-form',
        prepare: async (page, h) => {
            await h.click('Request A Week');
            await h.wait('Quick fill');
            await h.click({ text: freeWeek, exact: true, closest: 'button' });
            await h.type('textarea', 'Our winter range launches that Monday, and we’re running a bundle all week.');
            await pinAfterText(h, FORM_PINS, ['reward', 'dates', 'quick', 'note']);
        },
        viewport: { width: 1280, height: 1100 },
        target: { text: 'The POWR team confirms every slot', closest: 'div[class*="max-w-xl"]' },
        pad: 14,
        markers: FORM_PINS,
    },
];
