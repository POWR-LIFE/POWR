// The gym Studio at Northpoint Strength: the week's Trending template, the
// drafts the team has saved, and the packs it has made from shoots. The
// Overview's "Posts for this week" draws from gym-core's numbers and photo.
//
// Saved files (draft previews, pack thumbnails) sit in the private
// studio-packs bucket and load through signed URLs. The mock can only answer
// those with JSON, so a shot that shows them draws the previews in the editor
// first and puts them in place (shots/gym-studio.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reply } from '../mock.mjs';
import { GYM, OWNER } from '../world.mjs';
import { EVENTS, TEAM } from './gym-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../../src');

// Monday of this week (London), as studio_templates.week_start holds it.
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const TODAY = ymd(new Date());
const dow = (new Date(`${TODAY}T12:00:00Z`).getUTCDay() + 6) % 7;
const MONDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - dow * 864e5).toISOString().slice(0, 10);
const weekOf = new Date(`${MONDAY}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('Sept', 'Sep');
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// The trend routine's example blueprint, as the week's one live Trending template.
const FLOOD = JSON.parse(fs.readFileSync(path.join(SRC, 'studio/blueprint/examples/flood.json'), 'utf8'));
export const TRENDING = [{ id: FLOOD.id, name: FLOOD.name, week_start: MONDAY, blueprint: FLOOD }];

// Who saved them: the owner and the head coach (both have portal logins).
export const JORDAN_ID = '6f1d2c3b-0000-4000-8000-00000000b002';
export const STAFF_PROFILES = [
    { id: OWNER.id, display_name: OWNER.name, username: 'sam' },
    { id: JORDAN_ID, display_name: TEAM[0].name, username: 'jordan' },
];

/**
 * The gym's drafts, newest first. `render` says how the shot draws each one's
 * preview in the editor: the template, the event it was filled from (null =
 * this week's board, or none), and the size.
 */
export const DRAFTS = [
    { title: `Gym floor top 5 · week of ${weekOf}`, template_id: 'results', format: 'post', h: 2, by: OWNER.id, render: { template: 'Results' } },
    { title: 'The Northpoint Grind · ticket', template_id: 'ticket', format: 'story', h: 19, by: JORDAN_ID, render: { template: 'Ticket', event: EVENTS.live.id, size: 'Story' } },
    { title: 'Canal Street Showdown results', template_id: 'results', format: 'post', slides: 4, h: 3 * 24 + 5, by: OWNER.id, render: { template: 'Results', event: EVENTS.showdown.id } },
    { title: 'Every move counts.', template_id: FLOOD.id, format: 'post', h: 4 * 24 + 2, by: JORDAN_ID, render: { template: 'Flood' } },
    { title: 'Starts today · 30 day challenge', template_id: 'countdown', format: 'reel', video: true, h: 5 * 24 + 7, by: OWNER.id, render: { template: 'Countdown', size: 'Reel' } },
    { title: 'Day 1.', template_id: 'editorial', format: 'post', h: 6 * 24 + 1, by: OWNER.id, render: { template: 'Editorial' } },
    { title: 'From the first rep to forever.', template_id: 'manifesto', format: 'post', h: 8 * 24 + 3, by: JORDAN_ID, render: { template: 'Manifesto' } },
    { title: 'Deadlift Weekend · club night', template_id: 'club', format: 'post', slides: 2, h: 11 * 24, by: OWNER.id, render: { template: 'Club', event: EVENTS.deadlift.id } },
    { title: 'Earned, not given.', template_id: 'spread', format: 'post', h: 15 * 24 + 4, by: OWNER.id, render: { template: 'Spread' } },
].map((d, i) => {
    const id = `6f1d2c3b-0000-4000-8000-0000000a${String(i + 1).padStart(4, '0')}`;
    return {
        ...d,
        row: {
            id,
            partner_id: GYM.id,
            brand_name: null,
            title: d.title,
            format: d.format,
            slide_count: d.slides ?? 1,
            has_video: !!d.video,
            template_id: d.template_id,
            thumb_path: `gyms/${GYM.id}/drafts/${id}/thumb.jpg`,
            bytes: (d.video ? 38_400_000 : 2_100_000) + i * 310_000,
            created_at: hoursAgo(d.h + 30),
            updated_at: hoursAgo(d.h),
            updated_by: d.by,
        },
    };
});

// Saved packs: the Showdown's "Before" pack from the week it was announced,
// and a brand pack from a summer shoot.
const packId = (n) => `6f1d2c3b-0000-4000-8000-0000000b${String(n).padStart(4, '0')}`;
export const PACKS = [
    {
        id: packId(1), partner_id: GYM.id, title: `${EVENTS.showdown.name} · Before`, phase: 'before', status: 'saved',
        created_at: new Date(Date.parse(EVENTS.showdown.window_start_at) - 6 * 864e5).toISOString(),
        source_count: 18, output_count: 14, bytes: 96_000_000, live_event_id: EVENTS.showdown.id, live_events: { name: EVENTS.showdown.name },
    },
    {
        id: packId(2), partner_id: GYM.id, title: 'Summer open day', phase: 'brand', status: 'saved',
        created_at: hoursAgo(58 * 24), source_count: 26, output_count: 21, bytes: 141_000_000, live_event_id: null, live_events: null,
    },
];
const PACK_FILES = PACKS.flatMap((p) => [1, 2, 3, 4].map((k) => ({
    pack_id: p.id, path: `gyms/${GYM.id}/packs/${p.id}/thumbs/${k}.jpg`, role: 'thumb', meta: {},
})));

export default {
    rpc: {
        studio_live_templates: TRENDING,
    },
    rest: {
        studio_drafts: DRAFTS.map((d) => d.row),
        studio_packs: PACKS,
        studio_pack_files: PACK_FILES,
    },
    http: {
        // createSignedUrls: one signed path per file asked for. Loading one
        // answers 404 (the shot swaps in the real preview).
        '/object/sign/studio-packs': (ctx) => (ctx.method === 'POST' && Array.isArray(ctx.body?.paths)
            ? ctx.body.paths.map((p) => ({ path: p, signedURL: `/object/sign/studio-packs/${p}?token=docs`, error: null }))
            : reply(404, { error: 'not_found' })),
    },
};
