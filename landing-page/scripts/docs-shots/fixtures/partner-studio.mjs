// Studio: this week's Trending template (the repo's own example blueprint,
// "Flood", which carries no names) and Peakform Nutrition's saved drafts.
//
// The editor fills itself from the brand's reward (partner-base.mjs: Eat
// category, 450 points, logo and hero photo), so it needs nothing else here.
// Draft thumbnails live in storage as JPEGs the mock can't serve, so the
// Drafts shot draws real ones in the editor first (see shots/partner-studio.mjs).
import fs from 'node:fs';
import { BRAND, BRAND_USER, thisMonday } from '../world.mjs';
import { reply } from '../mock.mjs';
import { REWARD } from './partner-base.mjs';

const FLOOD = JSON.parse(fs.readFileSync(new URL('../../../src/studio/blueprint/examples/flood.json', import.meta.url), 'utf8'));

// Peakform's logo as a PNG. The Studio can't read an SVG logo (it decodes
// images with createImageBitmap, which won't take SVG in Chrome), so the
// Studio shots give the reward this copy of assets/peakform-logo.svg, as a
// brand's uploaded PNG would be.
export const LOGO_PNG = 'data:image/png;base64,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';
/** The brand's reward as the Studio shots read it (shot-level `rewards`). */
export const STUDIO_REWARDS = [{ ...REWARD, image_url: LOGO_PNG }];

const HOUR = 36e5;
const weekStart = () => {
    const m = thisMonday();
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
};
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const draftId = (n) => `9d7e4b10-0000-4000-8000-${String(n).padStart(12, '0')}`;
const folder = (n) => `brands/peakform-nutrition/drafts/${draftId(n)}`;

// Teammates who saved drafts (as partner-settings.mjs's team).
export const TEAMMATES = [
    { id: BRAND_USER.id, display_name: BRAND_USER.name, username: 'alexm' },
    { id: '6f1d2c3b-0000-4000-8000-00000000c002', display_name: 'Jordan Reyes', username: 'jordanr' },
    { id: '6f1d2c3b-0000-4000-8000-00000000c003', display_name: 'Casey Lin', username: 'caseyl' },
];

// Newest first, as the tab lists them. The shot draws each one's thumbnail
// from `look`: the template, the size and the sample photo.
export const DRAFTS = [
    { n: 1, title: '25% off: autumn launch', format: 'post', template_id: 'reward', slide_count: 1, has_video: false, hours: 2, by: 0, bytes: 1.9e6, look: { library: 'Core', template: 'Reward', size: ['Social', 'Post'], photo: 'headphones.jpg' } },
    { n: 2, title: 'Macros carousel', format: 'post', template_id: 'macros', slide_count: 3, has_video: false, hours: 26, by: 1, bytes: 4.4e6, look: { library: 'Eat', template: 'Macros', size: ['Social', 'Post'], photo: 'legs.jpg' } },
    { n: 3, title: 'Story: post-run fuel', format: 'story', template_id: 'fuel-timing', slide_count: 1, has_video: true, hours: 75, by: 2, bytes: 31.5e6, look: { library: 'Eat', template: 'Fuel Timing', size: ['Social', 'Story'], photo: 'crosswalk.jpg' } },
    { n: 4, title: 'What’s on the plate', format: 'square', template_id: 'plate', slide_count: 1, has_video: false, hours: 130, by: 0, bytes: 1.2e6, look: { library: 'Eat', template: 'Plate', size: ['Social', 'Square'], photo: 'rope.jpg' } },
    { n: 5, title: 'Counter flyer A5', format: 'a5', template_id: 'reward', slide_count: 2, has_video: false, hours: 300, by: 1, bytes: 2.6e6, look: { library: 'Core', template: 'Reward', size: ['Print', 'A5'], photo: 'pullup.jpg' } },
].map((d) => ({
    look: d.look,
    id: draftId(d.n),
    title: d.title,
    format: d.format,
    slide_count: d.slide_count,
    has_video: d.has_video,
    template_id: d.template_id,
    thumb_path: `${folder(d.n)}/thumb.jpg`,
    bytes: Math.round(d.bytes),
    created_at: ago(d.hours + 50),
    updated_at: ago(d.hours),
    updated_by: TEAMMATES[d.by].id,
    brand_name: BRAND.name,
    partner_id: null,
    state: null,
}));

export default {
    rpc: {
        studio_live_templates: [{ blueprint: FLOOD, week_start: weekStart() }],
    },
    rest: {
        studio_drafts: DRAFTS,
    },
    http: {
        // createSignedUrls: a link per thumbnail. Fetching one gets a 404,
        // and the shot puts a drawn thumbnail in its place.
        'object/sign/studio-packs': (ctx) => (ctx.method === 'POST'
            ? (ctx.body?.paths ?? []).map((path) => ({ path, signedURL: `/object/sign/studio-packs/${path}?token=docs`, error: null }))
            : reply(404, { message: 'not found' })),
    },
};
