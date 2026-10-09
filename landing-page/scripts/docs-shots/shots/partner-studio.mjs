// /docs/studio: the editor filled from Peakform's reward, its template
// libraries, the fill card, the size picker, and the Drafts tab.
// Data: fixtures/partner-studio.mjs.
//
// The editor opens on the Reward voucher and, because the reward is in Eat,
// on the Eat library: the Core tab's event templates (which start with a
// real venue's name as sample words) are never on screen.
import { DRAFTS, STUDIO_REWARDS, TEAMMATES } from '../fixtures/partner-studio.mjs';

const css = (selector, props = {}) => Object.assign((page) => page.$(selector), props);
const CARD = 'div[class*="rounded-2xl"]';
const PREVIEW = 'div[style*="aspect-ratio"] > canvas';


// A pin just after a label's words (full-width blocks hide where the words
// end): measured here, set on the marker before the runner reads it.
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

// The portal's scroll area back to the top.
const toTop = (page) => page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0));

// The editor as a brand first sees it: filled from the reward, with the
// reward's own photo in. This machine's test photos (a dev-only panel, never
// shown to a brand) are taken out of the page; they stay clickable from code.
async function editorReady(page, h) {
    await h.wait('Edit anything after');
    await h.click({ text: 'own photo', closest: 'button' });
    await h.wait('Replace —');
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('div.mt-4')) if (/^Test photos/.test(el.textContent.trim())) el.style.display = 'none';
    });
    await h.sleep(1200);
}

// Each draft's thumbnail, drawn by the editor itself: its template, size and
// photo, then the preview as a JPEG (the store saves the same).
async function drawThumbs(page, h) {
    const thumbs = [];
    for (const { look } of DRAFTS) {
        await page.evaluate((file) => document.querySelector(`button[title^="${file} "]`)?.click(), look.photo);
        await h.wait(`Replace — ${look.photo}`);
        await h.click({ text: look.library, exact: true, closest: 'button' });
        await h.click({ text: look.template, exact: true, closest: 'button' });
        await h.click({ text: look.size[0], exact: true, closest: 'button' });
        await h.click({ text: look.size[1], exact: true, closest: 'button' });
        await h.sleep(900);
        thumbs.push(await page.$eval(PREVIEW, (c) => c.toDataURL('image/jpeg', 0.85)));
    }
    return thumbs;
}

const base = {
    portal: 'partner',
    path: '/partner/studio',
    ready: 'Fill from a reward',
    fixtures: { rest: { rewards: STUDIO_REWARDS } },
    hide: ['.fixed.bottom-6.right-6'],
    settle: 1500,
};

const TEAM_PIN = { text: 'Edited yesterday' };
const LIFESTYLE_PIN = { text: 'Lifestyle', exact: true };
const FILL_PINS = {
    picker: { text: 'Fill from a reward', closest: 'span' },
    refill: css('button[title^="Fill again"]', { anchor: 'tr', dx: 0, dy: -2 }),
    filled: { text: 'templates are filled with', closest: 'p' },
    photo: { text: 'own photo', closest: 'button', anchor: 'right', dx: 18 },
};

export default [
    {
        ...base,
        id: 'partner-studio-page',
        viewport: { width: 1440, height: 1000 },
        prepare: async (page, h) => { await editorReady(page, h); await toTop(page); },
        markers: {
            modes: { text: 'One post', exact: true, closest: 'button', up: 1, anchor: 'right', dx: 18 },
            templates: { text: 'Template', exact: true, closest: CARD, anchor: 'tr', dx: -18, dy: 18 },
            draft: { text: 'Not saved', anchor: 'right', dx: 16 },
            groups: { text: 'Print', exact: true, closest: 'button', anchor: 'right', dx: 22 },
            download: { text: 'Download', exact: true, closest: 'button', anchor: 'top', dy: -12 },
        },
    },
    {
        ...base,
        id: 'partner-studio-templates',
        viewport: { width: 1440, height: 1000 },
        prepare: async (page, h) => {
            await editorReady(page, h);
            await h.click({ text: 'Macros', exact: true, closest: 'button' });
            await h.sleep(1500);
            // The Eat tab holds 20 templates; the shot keeps the top of the
            // panel and fades out, as a crop of the real thing.
            await page.evaluate(() => {
                const label = [...document.querySelectorAll('span')].find((e) => e.textContent.trim() === 'Template');
                const card = label.closest('div[class*="rounded-2xl"]');
                const second = card.querySelectorAll('.grid.grid-cols-3 > button')[5];
                const cut = second.getBoundingClientRect().bottom - card.getBoundingClientRect().top + 28;
                Object.assign(card.style, { height: `${cut}px`, overflow: 'hidden', position: 'relative' });
                const fade = document.createElement('div');
                Object.assign(fade.style, { position: 'absolute', left: 0, right: 0, bottom: 0, height: '72px', background: 'linear-gradient(rgba(255,255,255,0), #fff 85%)', pointerEvents: 'none' });
                card.appendChild(fade);
            });
            await pinAfterText(h, { lifestyle: LIFESTYLE_PIN }, ['lifestyle'], 14);
        },
        target: { text: 'Template', exact: true, closest: CARD },
        // 420 px wide or less: the guide sets it beside its notes.
        pad: 10,
        markers: {
            tabs: { text: 'Core', exact: true, closest: 'button', anchor: 'tr', dx: 2, dy: -2 },
            pillar: { text: 'Eat', exact: true, closest: 'button', anchor: 'tr', dx: 2, dy: -2 },
            lifestyle: LIFESTYLE_PIN,
            chosen: { text: 'Macros', exact: true, closest: 'button', anchor: 'tr', dx: -10, dy: 10 },
            photo: { text: 'Plate', exact: true, closest: 'button', anchor: 'tr', dx: -10, dy: 10 },
        },
    },
    {
        ...base,
        id: 'partner-studio-fill',
        viewport: { width: 1440, height: 1000 },
        prepare: async (page, h) => {
            await editorReady(page, h);
            await pinAfterText(h, FILL_PINS, ['picker', 'filled']);
        },
        target: { text: 'Fill from a reward', closest: CARD },
        pad: 10,
        markers: FILL_PINS,
    },
    {
        ...base,
        id: 'partner-studio-sizes',
        viewport: { width: 1680, height: 1050 },
        prepare: editorReady,
        target: { text: 'Safe zones', closest: 'div[class*="bg-[#141413]"]' },
        pad: 10,
        markers: {
            groups: { text: 'Print', exact: true, closest: 'button', anchor: 'right', dx: 22 },
            sizes: { text: '1080×1350', exact: true, anchor: 'right', dx: 18 },
            safe: { text: 'Safe zones', closest: 'label', anchor: 'left', dx: -22 },
            download: { text: 'Download', exact: true, closest: 'button', anchor: 'top', dy: -12 },
            slide: { text: 'Add slide', closest: 'button', anchor: 'tr', dx: -6, dy: 2 },
        },
    },
    {
        ...base,
        id: 'partner-studio-drafts',
        viewport: { width: 1600, height: 1000 },
        fixtures: { rest: { rewards: STUDIO_REWARDS, profiles: TEAMMATES } },
        prepare: async (page, h) => {
            await editorReady(page, h);
            const thumbs = await drawThumbs(page, h);
            await h.click({ text: 'Drafts', exact: true, closest: 'button' });
            await h.wait('Edited');
            // The stored thumbnails can't come from the mock: put the drawn ones in.
            await page.$$eval('ul[aria-label="Drafts"] li img', async (imgs, list) => {
                await Promise.all(imgs.map((img, i) => { img.loading = 'eager'; img.src = list[i]; return img.decode().catch(() => {}); }));
            }, thumbs);
            await toTop(page);
            await pinAfterText(h, { team: TEAM_PIN }, ['team'], 14);
            await h.sleep(600);
        },
        target: { text: 'Posts for', closest: 'div[class*="max-w-[1400px]"]' },
        pad: 0,
        markers: {
            tab: { text: 'Drafts', exact: true, closest: 'button', anchor: 'right', dx: 16 },
            slides: css('ul[aria-label="Drafts"] li:nth-child(2) span.absolute', { anchor: 'right', dx: 16 }),
            team: TEAM_PIN,
            open: css('ul[aria-label="Drafts"] li:first-child div.mt-auto button', { anchor: 'right', dx: 16 }),
            rename: css('button[aria-label^="Rename"]', { anchor: 'top', dy: -30 }),
        },
    },
];
