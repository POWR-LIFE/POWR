// /docs/placements: the campaigns list, a live campaign's counts, and the
// three builder stages. Data: fixtures/partner-placements.mjs.
//
// Never the "How placements work" explainer (PlacementExplainer.jsx): it
// names a real brand and describes how the app knows where members are.
//
// The map: Google's own tiles show real shops, gyms and streets (and, on a
// key without billing, a "for development purposes only" wash), so the
// builder shots give the map a tile layer of their own, a made-up stretch of
// Riverton drawn below. Everything on top (the squares, the tools, the
// search box) is the portal's own.
import { MAP } from '../fixtures/partner-placements.mjs';

const base = { portal: 'partner', path: '/partner/placements', ready: 'Town centre lunchtimes', hide: ['.fixed.bottom-6.right-6'] };
const css = (selector, props = {}) => Object.assign((page) => page.$(selector), props);


// ── A made-up town, in the picture's own pixels (fixtures: 768 × 576, the
// squares are 64 px). The park sits under the draft's squares, Market Square
// under the booked ones, and the station side of the river under the ones in
// review. Drawn well past the edges so any framing is covered.
const LAND = '#F2EFE9';
const ROADS = ['M-1200 20 H 2000', 'M630 -1200 V 420', 'M330 330 V 1800', 'M-1200 760 C -200 700, 120 640, 330 560', 'M630 420 C 700 470, 900 480, 2000 470', 'M-60 -1200 V 20', 'M900 20 V 420'];
const TOWN = `
<rect x="-1200" y="-1200" width="3200" height="3000" fill="${LAND}"/>
<g fill="#E7E2D9">
  <rect x="-300" y="-260" width="230" height="220" rx="4"/><rect x="-40" y="-260" width="200" height="220" rx="4"/>
  <rect x="190" y="-260" width="190" height="220" rx="4"/><rect x="410" y="-260" width="180" height="220" rx="4"/>
  <rect x="650" y="-260" width="240" height="220" rx="4"/><rect x="920" y="-260" width="300" height="220" rx="4"/>
  <rect x="920" y="60" width="300" height="340" rx="4"/><rect x="-300" y="60" width="250" height="300" rx="4"/>
  <rect x="-300" y="540" width="250" height="200" rx="4"/><rect x="200" y="560" width="110" height="180" rx="4"/>
  <rect x="360" y="530" width="230" height="210" rx="4"/><rect x="620" y="520" width="260" height="220" rx="4"/>
  <rect x="910" y="500" width="300" height="240" rx="4"/>
</g>
<path d="M140 92 C 210 40, 520 40, 600 70 L 610 330 C 520 372, 260 378, 120 352 C 80 280, 92 150, 140 92 Z" fill="#CDE6C0"/>
<path d="M-1200 470 C -400 420, -100 500, 160 448 S 560 392, 760 430 S 1300 470, 2000 420" fill="none" stroke="#AAD3F2" stroke-width="64" stroke-linecap="round"/>
<g fill="none" stroke-linecap="round">
  <g stroke="#D9D3C7" stroke-width="22">${ROADS.map((d) => `<path d="${d}"/>`).join('')}</g>
  <g stroke="#FFFFFF" stroke-width="16">${ROADS.map((d) => `<path d="${d}"/>`).join('')}</g>
</g>
<rect x="650" y="160" width="240" height="180" rx="6" fill="#EDE6D8" stroke="#DCD3C2" stroke-width="2"/>
<g font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#5F6368" text-anchor="middle" letter-spacing="0.4">
  <text x="250" y="24">Canal Street</text>
  <text x="1080" y="24">Canal Street</text>
  <text transform="translate(634 -120) rotate(90)">Mill Lane</text>
  <text transform="translate(334 660) rotate(90)">Bridge Street</text>
  <text transform="translate(120 690) rotate(-17)">Station Road</text>
  <text x="706" y="334" font-size="10.5" fill="#7A6A4F">Market Square</text>
  <text x="520" y="434" font-style="italic" fill="#4A7FB0">River Wend</text>
  <text x="1160" y="456" font-style="italic" fill="#4A7FB0">River Wend</text>
  <text x="530" y="352" font-size="10.5" fill="#3E7D3A">Riverside Park</text>
</g>`;

// Before the map mounts: catch the Maps script's callback and wrap
// google.maps.Map so it opens on the town's tiles (whatever map type the
// page asks for) and can be framed from here. Only the shots' zoom (16)
// shows the town; any other zoom is plain land.
async function hookMaps(page) {
    await page.evaluate((town, origin, land) => {
        const svg = (inner, box = '') => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" ${box}>${inner}</svg>`)}`;
        const plain = svg(`<rect width="256" height="256" fill="${land}"/>`);
        const hook = () => {
            const { maps } = window.google;
            const Base = maps.Map;
            class DocsMap extends Base {
                constructor(el, opts) {
                    super(el, { ...opts, mapTypeId: 'docs-town' });
                    this.mapTypes.set('docs-town', new maps.ImageMapType({
                        name: 'Map', tileSize: new maps.Size(256, 256), maxZoom: 21, minZoom: 0,
                        getTileUrl: (c, z) => (z === 16 ? svg(town, `viewBox="${c.x * 256 - origin.x} ${c.y * 256 - origin.y} 256 256"`) : plain),
                    }));
                    window.__docsMap = this;
                }
                setMapTypeId() { super.setMapTypeId('docs-town'); }
            }
            maps.Map = DocsMap;
        };
        const append = document.head.appendChild;
        document.head.appendChild = function (el) {
            if (el.tagName === 'SCRIPT' && /maps\.googleapis\.com/.test(el.src)) {
                const cb = new URL(el.src).searchParams.get('callback');
                const ready = window[cb];
                window[cb] = () => { hook(); ready(); };
            }
            return append.call(this, el);
        };
    }, TOWN, MAP.origin16, LAND);
}

// Frame the picture at zoom 16 and wait for the tiles, then tidy what isn't
// the portal's: Google's notice about the key, its attribution (the tiles
// aren't Google's), and the location button (never shown in the guides).
async function frameMap(page, h) {
    await page.waitForFunction(() => window.__docsMap, { timeout: 30000 });
    await page.evaluate((c) => new Promise((done) => {
        const map = window.__docsMap;
        window.google.maps.event.addListenerOnce(map, 'tilesloaded', () => done());
        setTimeout(done, 20000);
        map.setZoom(16);
        map.setCenter(c);
    }), MAP.centre);
    await h.sleep(1500);
    await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) if (/My location/.test(b.textContent)) b.style.display = 'none';
        const gm = document.querySelector('.gm-style');
        if (!gm) return;
        for (const el of gm.querySelectorAll('.gm-style-cc, a[href*="maps.google"], a[href*="google.com/maps"]')) el.style.display = 'none';
        for (const el of gm.querySelectorAll('a, button, span')) if (/^(Terms|Report a map error|Keyboard shortcuts)$/.test(el.textContent.trim())) el.style.display = 'none';
    });
}

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

// Open the draft in the builder and move on to stage `to` (1 Place & time, 2 Audience & review).
async function openDraft(page, h, to) {
    await h.click({ text: 'Continue', exact: true, closest: 'button' });
    await h.wait('Campaign name');
    for (let s = 0; s < to; s++) {
        await h.click('Save & continue');
        await h.wait(['Coverage area', 'Who sees it'][s]);
    }
}

// Marker on the map at a point of the picture (fixtures: 64 px squares).
const MAP_EL = 'div[class*="lg:h-[560px]"]';
const onMap = (col, row) => Object.assign(async (page) => page.$(MAP_EL), {
    anchor: 'tl',
    // The picture is centred on the map, which is a little smaller than it.
    dx: col * 64 - (MAP.size.w - 760) / 2,
    dy: row * 64 - (MAP.size.h - 556) / 2,
});

const OFFER_PINS = {
    stages: { text: 'Place & time', anchor: 'right', dx: 22 },
    name: { text: 'Campaign name', closest: 'label' },
    reward: { text: 'Reward *', closest: 'label' },
    save: { text: 'Save draft', closest: 'button', anchor: 'right', dx: 14 },
    next: { text: 'Save & continue', closest: 'button', anchor: 'tr', dx: -8, dy: 4 },
};
const REVIEW_PINS = {
    summary: { text: 'Campaign summary' },
    hours: { text: 'Only certain hours', closest: 'label' },
    who: { text: 'Who sees it', closest: 'label' },
    cap: { text: 'Show at most', closest: 'label' },
    submit: { text: 'Submit for review', closest: 'button', anchor: 'tr', dx: -8, dy: 4 },
};

const SHOTS = [
    {
        ...base,
        id: 'partner-placements-list',
        viewport: { width: 1280, height: 990 },
        prepare: async (page, h) => {
            // Past the page's fade-in.
            await h.sleep(1500);
        },
        markers: {
            create: { text: 'New Placement', closest: 'button', anchor: 'tr', dx: -12, dy: 6 },
            draft: { text: 'Continue', exact: true, closest: 'button', anchor: 'tr', dx: 2, dy: -2 },
            review: { text: 'POWR is reviewing', anchor: 'tr', dx: 4, dy: -4 },
            revise: { text: 'Revise', exact: true, closest: 'button', anchor: 'tr', dx: 2, dy: -2 },
            live: { text: 'Live', exact: true, anchor: 'tr', dx: 6, dy: -6 },
        },
    },
    {
        ...base,
        id: 'partner-placements-counts',
        viewport: { width: 1280, height: 1100 },
        prepare: async (page, h) => { await h.sleep(1500); },
        target: { text: 'Town centre lunchtimes', closest: 'div[class*="rounded-3xl"]' },
        pad: 14,
        markers: {
            // Above and below in turn, so the four stay apart when the row shrinks on a phone.
            seen: { text: '1284', exact: true, anchor: 'top', dy: -16 },
            visited: { text: '312', exact: true, anchor: 'center', dy: 24 },
            pushed: { text: '27', exact: true, anchor: 'top', dy: -16 },
            redeemed: { text: '19', exact: true, anchor: 'center', dy: 24 },
        },
    },
    {
        ...base,
        id: 'partner-placements-offer',
        viewport: { width: 1440, height: 1300 },
        prepare: async (page, h) => {
            await openDraft(page, h, 0);
            await pinAfterText(h, OFFER_PINS, ['name', 'reward']);
        },
        target: 'form',
        pad: 12,
        markers: OFFER_PINS,
    },
    {
        ...base,
        id: 'partner-placements-map',
        viewport: { width: 1680, height: 1100 },
        prepare: async (page, h) => {
            page.on('console', (m) => { if (m.type() === 'error') console.log('    console:', m.text().slice(0, 200)); });
            await hookMaps(page);
            await openDraft(page, h, 1);
            await frameMap(page, h);
        },
        settle: 1500,
        target: { text: 'Coverage area', closest: 'div.space-y-3' },
        pad: 16,
        markers: {
            tools: { text: 'Pan', exact: true, closest: 'button', anchor: 'bl', dx: 12, dy: 18 },
            search: css('input[placeholder^="Search a place"]', { anchor: 'right', dx: -14 }),
            count: { text: 'squares', anchor: 'left', dx: -22 },
            selected: onMap(4.5, 3.5),
            booked: onMap(11, 4),
            requested: onMap(6, 8),
        },
    },
    {
        ...base,
        id: 'partner-placements-review',
        viewport: { width: 1440, height: 1400 },
        prepare: async (page, h) => {
            await openDraft(page, h, 2);
            await h.click({ text: 'Only certain hours', closest: 'label' });
            const [from, to] = await page.$$('form select');
            await from.select('7');
            await to.select('10');
            await h.click({ text: 'running', exact: true, closest: 'button' });
            await h.click({ text: 'walking', exact: true, closest: 'button' });
            await h.type('input[type="number"]', '2');
            await pinAfterText(h, REVIEW_PINS, ['summary', 'hours', 'who', 'cap']);
        },
        target: 'form',
        pad: 12,
        markers: REVIEW_PINS,
    },
];

// The page only opens with the beta switched on; everywhere else it's off.
const PLACEMENTS_ON = [{ key: 'partner_placements_enabled', value: 'true' }];
export default SHOTS.map((shot) => ({
    ...shot,
    fixtures: { ...shot.fixtures, rest: { ...shot.fixtures?.rest, system_config: PLACEMENTS_ON } },
}));
