// /docs/gyms/studio: the week's posts on the Overview, the lightbox, and the
// Studio itself (One post, a pack from a shoot, Drafts).
//
// The Studio lists "Test photos & clips (this machine only)" on a dev server
// (public/studio-samples); a gym never sees that strip, so it's always taken
// out. Photos go in through the real upload input, from those same licensed
// samples (never plate.jpg: a real gym's name is on its wall).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { around, steady, words } from './gym-members.mjs';
import { DRAFTS, STAFF_PROFILES } from '../fixtures/gym-studio.mjs';
import { EVENTS } from '../fixtures/gym-core.mjs';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/studio-samples');
const sample = (f) => path.join(SAMPLES, f);
// The gym's own photo (world.mjs GYM.photo_url).
const GYM_PHOTO = sample('rope.jpg');

// The machine these run on is often busy: give slow steps two minutes, not thirty seconds.
const waitText = (page, text, timeout = 120000) => page.waitForFunction(
    (t) => document.body && document.body.innerText.replace(/\s+/g, ' ').toLowerCase().includes(t.toLowerCase()), { timeout, polling: 500 }, text);

const dropTestStrip = (page) => page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
        if (own.includes('Test photos') && el.parentElement) el.parentElement.style.display = 'none';
    }
});

// The top of a card, down to just under one of its parts: the card's own
// width and top edge, cut below `until` (a { text, exact, closest } part).
const cardTop = (label, until, below = 22) => async (page) => {
    const handle = await page.evaluateHandle((l, u, gap) => {
        const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        const find = (t) => [...document.querySelectorAll('*')].find((el) => own(el) === t && el.getBoundingClientRect().width > 0);
        const card = find(l)?.closest('[class*="rounded-2xl"]');
        const end = find(u)?.closest('button');
        if (!card || !end) return null;
        const a = card.getBoundingClientRect();
        const b = end.getBoundingClientRect();
        const probe = document.createElement('div');
        probe.style.cssText = `position:absolute;left:${a.left + scrollX}px;top:${a.top + scrollY}px;width:${a.width}px;height:${b.bottom + gap - a.top}px;visibility:hidden;pointer-events:none`;
        document.body.appendChild(probe);
        return probe;
    }, label, until, below);
    const el = handle.asElement();
    if (!el) throw new Error(`no card "${label}" with "${until}"`);
    return el;
};

// One post, opened as the Overview's "Make the post" does (?board=week):
// Results, filled from this week's board, over the gym's photo.
async function openResults(page, h) {
    await steady(page);
    await waitText(page, 'filled into Results');
    await dropTestStrip(page);
    const input = await page.$('input[type=file][accept="image/*,video/*"]');
    await input.uploadFile(GYM_PHOTO);
    await waitText(page, 'Replace —');
    await h.sleep(1500);
}

// The preview as a small JPEG: what a saved draft or pack keeps as its picture.
const grab = (page, pick = 'largest') => page.evaluate((how) => {
    const all = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0 && c.getBoundingClientRect().width > 0);
    const list = how === 'largest' ? [all.sort((a, b) => b.width * b.height - a.width * a.height)[0]] : all.filter((c) => c.closest(how));
    return list.filter(Boolean).map((c) => {
        const out = document.createElement('canvas');
        out.width = 400;
        out.height = Math.round((400 * c.height) / c.width);
        out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', 0.86);
    });
}, pick);

// A template in the picker, by name. (A text match on "Flood" also finds its
// one-template group, so it goes by the button itself.)
const tpl = (name) => (page) => page.evaluateHandle((n) => [...document.querySelectorAll('button')]
    .find((b) => b.querySelector('canvas') && b.textContent.trim() === n), name).then((x) => x.asElement());

// A <select> by its first option's words, set the way a person would.
async function choose(page, firstOption, value) {
    const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('select')].find((s) => s.options[0]?.textContent.startsWith(t)), firstOption);
    const el = handle.asElement();
    if (!el) throw new Error(`no select starting “${firstOption}”`);
    await el.select(value);
}

// Lays saved previews over the <img>s the signed URLs couldn't fill.
const putPictures = (page, selector, byText) => page.evaluate((sel, map) => {
    for (const box of document.querySelectorAll(sel)) {
        const key = Object.keys(map).find((t) => box.textContent.includes(t));
        const urls = key ? [].concat(map[key]) : [];
        box.querySelectorAll('img').forEach((img, i) => { if (urls[i % urls.length]) img.src = urls[i % urls.length]; });
    }
}, selector, byText);

export default [
    // ── Overview: the week's posts ──────────────────────────────────────────
    {
        id: 'gym-studio-week',
        portal: 'gym',
        path: '/venue',
        ready: 'Posts for this week',
        viewport: { width: 1280, height: 1600 },
        prepare: async (page, h) => {
            await steady(page);
            await h.scrollTo({ text: 'Posts for this week' });
            // Every thumbnail drawn, then the row lined up on yesterday, so today is second.
            await page.waitForFunction(() => document.querySelectorAll('img[data-thumb]').length >= 7, { timeout: 120000 });
            await page.evaluate(() => {
                const row = document.querySelector('[aria-label="This week’s posts"]');
                const cards = [...(row?.children ?? [])];
                const today = cards.findIndex((c) => /today/i.test(c.textContent));
                const card = cards[Math.max(0, today - 1)];
                if (row && card) row.scrollLeft = card.offsetLeft - row.offsetLeft;
            });
            await h.sleep(600);
        },
        target: { text: 'Posts for this week', closest: '[class*="rounded-"]:not(button)' },
        pad: 16,
        settle: 1200,
        markers: {
            today: { text: 'Today', within: '[aria-label="This week’s posts"]', closest: 'figure', anchor: 'tr', dx: -12, dy: 12 },
            look: { text: 'Mixed', exact: true, closest: '[role=radiogroup]', anchor: 'bottom', dy: 12 },
            all: { text: 'Download all', exact: true, closest: 'button', anchor: 'bottom', dy: 12 },
            one: Object.assign((page) => page.evaluateHandle(() => [...document.querySelectorAll('[aria-label="This week’s posts"] figure')]
                .find((f) => /today/i.test(f.textContent))?.querySelector('figcaption button, figcaption a')).then((x) => x.asElement()), { anchor: 'top', dy: -12 }),
        },
    },
    // The lightbox: today's post at full size, with its size chips.
    {
        id: 'gym-studio-lightbox',
        portal: 'gym',
        path: '/venue',
        ready: 'Posts for this week',
        viewport: { width: 1280, height: 900 },
        prepare: async (page, h) => {
            await steady(page);
            await page.waitForFunction(() => document.querySelectorAll('img[data-thumb]').length >= 7, { timeout: 120000 });
            await page.evaluate(() => {
                const fig = [...document.querySelectorAll('figure')].find((f) => /today/i.test(f.textContent));
                fig?.querySelector('button')?.click();
            });
            await page.waitForSelector('img[data-big]', { timeout: 120000 });
            await h.sleep(800);
        },
        settle: 1500,
        markers: {
            sizes: { text: 'Story', exact: true, closest: '[role=radiogroup]', anchor: 'bottom', dy: 16 },
            caption: { text: 'Copy caption', exact: true, closest: 'button', anchor: 'bottom', dy: 16 },
            download: { text: 'Download Post', exact: true, closest: 'button', anchor: 'bottom', dy: 16 },
            arrows: Object.assign((page) => page.$('button[aria-label="Next post"]'), { anchor: 'top', dy: -14 }),
        },
    },

    // ── The Studio: One post ────────────────────────────────────────────────
    {
        id: 'gym-studio-editor',
        portal: 'gym',
        path: '/venue/studio?board=week',
        ready: 'Template',
        viewport: { width: 1280, height: 960 },
        prepare: openResults,
        settle: 1500,
        markers: {
            modes: { text: 'One post', exact: true, closest: '.inline-flex', anchor: 'right', dx: 28 },
            library: { text: 'Sleep', closest: '[role=tab]', anchor: 'right', dx: 28 },
            draft: { text: 'Save draft', closest: 'button', anchor: 'tr', dx: -16, dy: -16 },
            sizes: { text: 'Print', exact: true, closest: 'button', anchor: 'right', dx: 28 },
            download: { text: 'All social', closest: 'button', anchor: 'right', dx: 28 },
        },
    },
    // Photo, and the fill from the gym board.
    {
        id: 'gym-studio-fill',
        portal: 'gym',
        path: '/venue/studio?board=week',
        ready: 'Template',
        viewport: { width: 1280, height: 3200 },
        prepare: openResults,
        target: around({ text: 'Photo or video', exact: true, closest: '[class*="rounded-2xl"]' }, { text: 'Fill from your gym board', exact: true, closest: '[class*="rounded-2xl"]' }),
        pad: 16,
        settle: 1500,
        markers: {
            photo: words('Replace —', { dx: 16 }),
            zoom: words('Zoom', { exact: true, dx: 20 }),
            event: words('Fill from an event', { exact: true, dx: 14 }),
            fill: words('Fill from your gym board', { exact: true, dx: 14 }),
            note: words('filled into Results', { dx: 14 }),
        },
    },
    // The template picker: Core and the four pillar libraries.
    {
        id: 'gym-studio-templates',
        portal: 'gym',
        path: '/venue/studio?board=week',
        ready: 'Template',
        viewport: { width: 1280, height: 3200 },
        prepare: openResults,
        // Down to the first row of Brand: the libraries, Trending and how the groups read.
        target: cardTop('Template', 'Manifesto'),
        pad: 16,
        settle: 1500,
        markers: {
            libraries: { text: 'Sleep', closest: '[role=tab]', anchor: 'right', dx: 20 },
            trending: words('Trending', { exact: true, dx: 16 }),
            flood: Object.assign(tpl('Flood'), { anchor: 'right', dx: 22 }),
            brand: words('Brand', { exact: true, dx: 14 }),
        },
    },

    // ── Drafts ─────────────────────────────────────────────────────────────
    // Each draft's picture is drawn here first, the way the editor saves it,
    // then the Drafts tab opens on the gym's nine and the last asks to delete.
    {
        id: 'gym-studio-drafts',
        portal: 'gym',
        path: '/venue/studio?board=week',
        fixtures: { rest: { profiles: STAFF_PROFILES } },
        ready: 'Template',
        viewport: { width: 1280, height: 1900 },
        prepare: async (page, h) => {
            await openResults(page, h);
            const pics = {};
            let event = null;
            // Board and plain templates first, then the ones filled from an event.
            const order = [...DRAFTS.filter((d) => !d.render.event), ...DRAFTS.filter((d) => d.render.event)];
            for (const d of order) {
                const r = d.render;
                await h.click(tpl(r.template));
                if (r.event && r.event !== event) {
                    await choose(page, 'Pick an event', r.event);
                    event = r.event;
                    await h.sleep(1500);
                }
                if (r.size) await h.click({ text: r.size, exact: true, closest: 'button' });
                // Until the preview has redrawn as this one (fonts and photo can lag).
                const before = Object.values(pics);
                let pic = null;
                for (let i = 0; i < 20 && (!pic || before.includes(pic)); i++) {
                    await h.sleep(900);
                    [pic] = await grab(page);
                }
                await h.sleep(600);
                [pics[d.title]] = await grab(page);
                if (r.size) await h.click({ text: 'Post', exact: true, closest: 'button' });
            }
            await h.click({ text: 'Drafts', exact: true, closest: 'button' });
            await waitText(page, `${DRAFTS.length} drafts`);
            await page.waitForSelector('ul[aria-label="Drafts"] img', { timeout: 60000 });
            await putPictures(page, 'ul[aria-label="Drafts"] li', pics);
            await page.click(`button[aria-label="Delete ${DRAFTS[DRAFTS.length - 1].title}"]`);
            await h.sleep(600);
        },
        target: Object.assign((page) => page.evaluateHandle(() => document.querySelector('ul[aria-label="Drafts"]').parentElement.parentElement).then((x) => x.asElement())),
        pad: 0,
        settle: 1500,
        markers: {
            tab: { text: 'Drafts', exact: true, closest: '.inline-flex', anchor: 'right', dx: 24 },
            search: Object.assign((page) => page.$('label:has(input[aria-label="Find a draft"])'), { anchor: 'right', dx: 24 }),
            slides: Object.assign((page) => page.$(`button[aria-label="Open ${DRAFTS[2].title}"] span span`), { anchor: 'top', dy: -14 }),
            open: Object.assign((page) => page.$('ul[aria-label="Drafts"] li button.mr-auto'), { anchor: 'right', dx: 22 }),
            rename: Object.assign((page) => page.$(`button[aria-label="Rename ${DRAFTS[0].title}"]`), { anchor: 'top', dy: -14 }),
            confirm: Object.assign((page) => page.$('button[aria-label="Keep it"]'), { anchor: 'right', dx: 22 }),
        },
    },

    // ── A pack from a shoot ─────────────────────────────────────────────────
    // The Showdown's After pack from eleven of the licensed sample photos
    // (runner-blur is a near twin of runner-pan, so one is set aside).
    {
        id: 'gym-studio-pack',
        portal: 'gym',
        path: '/venue/studio?mode=pack',
        ready: 'Saved packs',
        // Wide enough that each post's template name fits beside its buttons.
        viewport: { width: 1600, height: 2000 },
        prepare: async (page, h) => {
            await steady(page);
            await choose(page, 'No event', EVENTS.showdown.id);
            await waitText(page, 'Saved for this event');
            const input = await page.$('input[type=file][accept*="zip"]');
            await input.uploadFile(...['rope.jpg', 'pullup.jpg', 'boxer.jpg', 'boxer-dark.jpg', 'boxer-light.jpg', 'headphones.jpg', 'legs.jpg',
                'runner-pan.jpg', 'runner-blur.jpg', 'crosswalk.jpg', 'tunnel.jpg'].map(sample));
            await page.waitForFunction(() => /\b11 photos\b/.test(document.body.innerText) && document.querySelectorAll('.bg-\\[\\#141413\\] canvas').length >= 4,
                { timeout: 180000, polling: 1000 });
            await h.sleep(4000);
            const shots = await grab(page, '.bg-\\[\\#141413\\]');
            await page.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.src.includes('/thumbs/')), { timeout: 60000 }).catch(() => {});
            await page.evaluate((urls) => {
                [...document.querySelectorAll('img')].filter((i) => i.src.includes('/thumbs/')).forEach((img, k) => { img.src = urls[k % urls.length]; });
            }, shots.slice(0, 4));
            await h.sleep(800);
        },
        target: { text: 'Saved for this event', closest: '.grid' },
        pad: 16,
        settle: 1500,
        markers: {
            event: words('Event', { exact: true, dx: 28 }),
            shoot: words('11 photos', { dx: 28 }),
            pack: words('Pack', { exact: true, dx: 28 }),
            saved: words('Saved for this event', { dx: 28 }),
            make: { text: 'Make pack', closest: 'button', anchor: 'left', dx: -28 },
            swap: Object.assign((page) => page.$('button[aria-label="Another photo"]'), { anchor: 'top', dy: -16 }),
        },
    },
];
export { words };
