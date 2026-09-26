/**
 * An event's media kit: every post a gym needs before an event (announce it)
 * or after it (the results and a thank-you), rendered from the photos and
 * clips they drop in, at every size, packed into one ZIP with a folder per
 * size and the captions ready to paste.
 *
 * It is the Studio without the editor: the same templates, renderer, grade,
 * video encoder and PDF writer, run as a batch. Nothing leaves the browser
 * but the download.
 *
 * Plan first (planKit: a list of jobs, so the page can say what it will
 * make), then build (buildKit: renders, encodes, zips, with progress).
 */
import { FORMATS, BLEED_MM } from './formats';
import { prepareStudio, renderPost, fieldDefaults } from './render';
import { templateById } from './templates';
import { loadMedia, isVideoInput } from './media';
import { exportVideo } from './video';
import { pdfFromCanvas } from './pdf';
import { zipFiles } from './zip';
import { twoLines, thousands, wrapParagraphs } from './words';

export const STILL_FORMATS = ['post', 'story', 'square', 'landscape'];
export const CLIP_FORMATS = ['story', 'post'];
/** Clips are cut to this: long enough for a reel, short enough to encode in a minute. */
export const CLIP_SECONDS = 12;
export const MAX_CLIPS = 3;

const FOLDER = {
    post: '01 Post 4x5', story: '02 Story 9x16', square: '03 Square 1x1', landscape: '04 Landscape 16x9',
    print: '05 Print', video: '06 Video',
};

// ── Looks ───────────────────────────────────────────────────────────────
// The Studio's grade turns every photo black-and-white film by default
// (look.mono is 1 unless told otherwise). The kit lets the gym choose, and
// "Mixed" changes the treatment post by post so a feed isn't one photo
// repeated. The colourway decides the type's accent colour.

export const LOOKS = [
    { id: 'mixed',  label: 'Mixed',  blurb: 'film and colour, post by post' },
    { id: 'film',   label: 'Film',   blurb: 'black and white, the house look' },
    { id: 'colour', label: 'Colour', blurb: 'your photos as shot' },
];
export const ACCENTS = [
    { id: 'powr',   label: 'POWR gold',      blurb: 'white type, gold for the key word' },
    { id: 'gold',   label: 'Gold headlines', blurb: 'the whole headline in gold' },
    { id: 'signal', label: 'Red',            blurb: 'a red accent' },
    { id: 'mono',   label: 'No colour',      blurb: 'ink and white only' },
    { id: 'vary',   label: 'Vary',           blurb: 'POWR gold and gold headlines, alternating' },
];
// What "Mixed" cycles through: house film, warm colour, gold duotone, cool colour.
const TREATMENTS = [{}, { mono: 0, tint: 'warm' }, { tint: 'gold' }, { mono: 0, tint: 'cool' }];
// The poster with the QR and the final standings always get the house look.
const FLAGSHIP = new Set(['ticket', 'results']);

/** The look and colourway for the n-th post of a kit. */
export function treatmentFor({ look = 'mixed', accent = 'powr' }, n, template) {
    const flagship = FLAGSHIP.has(template);
    const lk = look === 'film' ? {} : look === 'colour' ? { mono: 0 } : flagship ? {} : TREATMENTS[n % TREATMENTS.length];
    const colourway = accent === 'vary' ? (flagship ? 'powr' : n % 2 ? 'gold' : 'powr') : accent;
    return { look: lk, style: { colourway, headlineFont: '' } };
}

// The templates' starting words name ONE LDN, London as their sample venue.
function forVenue(value, facts) {
    if (typeof value !== 'string' || !facts.venue) return value;
    const v = value.replaceAll('ONE LDN', facts.venue);
    if (facts.city) return v.replaceAll('London', facts.city);
    return v.replaceAll(',\nLondon', '').replaceAll(', London', '').replaceAll('\nLondon', '').replaceAll('London', '');
}

/** A template's words for an event: its defaults at this venue, the event's fill, then `extra`. */
export function wordsFor(templateId, facts, extra = {}) {
    const t = templateById(templateId);
    const base = Object.fromEntries(Object.entries(fieldDefaults(t)).map(([k, v]) => [k, forVenue(v, facts)]));
    const filled = t.fill?.event ? t.fill.event(facts) : {};
    return { ...base, ...filled, ...extra };
}

const noZero = (s) => String(s).replace(/\b0(\d)\b/g, '$1');
const nightLine = (facts) => `${facts.weekday} ${noZero(facts.day)} ${facts.month}, ${facts.time12}`;
/** On a post: "Fri 2 Oct, 7pm" for a night, "3 Oct – 6 Oct" for a window. */
const whenShort = (facts) => (facts.night ? nightLine(facts) : noZero(facts.range));
/** In a caption: the scoring window too when a night ends a longer one. */
const whenLine = (facts) => (facts.night && facts.days > 1 ? `${noZero(facts.range)}, finale ${nightLine(facts)}` : whenShort(facts));

const tag = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** What the words say for the templates that have no event fill of their own. */
const WORDS = {
    countdown: (facts) => ({
        kicker: `${facts.days}-day challenge at ${facts.venue}`,
        headline: `Starts\n${noZero(facts.rangeFrom)}`,
        line: 'Show up. Check in. The streak does the rest.',
        day: '1', of: String(facts.days),
        footer: 'Show up · Earn · Repeat',
    }),
    teaser: (facts) => ({
        tag: 'Coming up',
        headline: twoLines(facts.name, 14),
        line: `${whenShort(facts)} · ${facts.venue}`,
        footer: 'Join in the POWR app',
    }),
    thanks: (facts) => {
        const w = facts.standings?.[0];
        return {
            tag: w ? 'The results are in' : 'Thank you',
            headline: w ? `${w.name} {took it}.` : 'That’s a\nwrap.',
            line: w ? `${thousands(w.points)} POWR. ${facts.name} at ${facts.venue}.` : `${facts.name} at ${facts.venue}. Thanks for showing up.`,
            footer: 'Train · Earn · Repeat',
        };
    },
    recap: (facts) => ({
        headline: twoLines(facts.name, 8),
        caption: `${facts.venue}.\nThanks for\nshowing up.`,
        credit: 'powr.life ©',
    }),
};

/**
 * The posts a kit makes. `assets`: [{ id, file, kind: 'image' | 'video', name }]
 * in the order they were dropped; `leadId` picks the one the lead posts use
 * (the first photo by default). Returns [{ id, label, template, format, kind,
 * folder, file, stem, fields, asset, look, style }]. Every size of one post
 * shares a stem, a look and a style.
 */
export function planKit({ phase, facts, assets = [], leadId = null, options = {} }) {
    const { print = true, clips = true, landscape = true } = options;
    const photos = assets.filter((a) => a.kind === 'image');
    const videos = assets.filter((a) => a.kind === 'video');
    const lead = assets.find((a) => a.id === leadId) ?? photos[0] ?? videos[0] ?? null;
    const stills = STILL_FORMATS.filter((f) => landscape || f !== 'landscape');
    const jobs = [];
    let n = 0;      // numbers the lead posts' files
    let posts = 0;  // counts every post, for the treatment cycle
    const add = (template, fields, asset, kind, format, file, label, stem, tr) => {
        const folder = kind === 'mp4' ? FOLDER.video : kind === 'pdf' ? FOLDER.print : FOLDER[format];
        jobs.push({ id: `${folder}/${file}`, label, template, format, kind, folder, file, stem, fields, asset, look: tr.look, style: tr.style });
    };
    const post = (template, fields, asset, label, stem) => {
        const tr = treatmentFor(options, posts++, template);
        for (const f of stills) add(template, fields, asset, 'png', f, `${stem}.png`, label, stem, tr);
        return tr;
    };
    const lean = (template, fields, asset, label) => post(template, fields, asset, label, `${String(++n).padStart(2, '0')}-${template}`);
    const set = (template, fields, list, stem, label) => {
        list.forEach((asset, i) => post(template, fields, asset, `${label} ${i + 1}`, `${stem}-${String(i + 1).padStart(2, '0')}`));
    };
    const clipJobs = (template, fields, label) => {
        if (!clips) return;
        const tr = treatmentFor(options, 0, template);
        videos.slice(0, MAX_CLIPS).forEach((asset, i) => {
            const stem = `${template}-${String(i + 1).padStart(2, '0')}`;
            for (const f of CLIP_FORMATS) add(template, fields, asset, 'mp4', f, `${stem}-${f}.mp4`, `${label} clip ${i + 1}`, stem, tr);
        });
    };

    if (phase === 'before') {
        lean('ticket', wordsFor('ticket', facts), lead, 'Ticket');
        lean('club', wordsFor('club', facts), lead, 'Club');
        lean('spec', wordsFor('spec', facts), lead, 'Spec');
        if (facts.days >= 14) lean('countdown', wordsFor('countdown', facts, WORDS.countdown(facts)), lead, 'Countdown');
        if (print) add('ticket', wordsFor('ticket', facts), lead, 'pdf', 'a4', 'ticket-a4-poster.pdf', 'A4 poster', 'ticket-a4-poster', treatmentFor(options, 0, 'ticket'));
        set('editorial', wordsFor('editorial', facts, WORDS.teaser(facts)), photos.filter((p) => p !== lead), 'teaser', 'Teaser');
        clipJobs('ticket', wordsFor('ticket', facts), 'Ticket');
    } else {
        const final = facts.board === 'final' && facts.standings?.length > 0;
        if (final) lean('results', wordsFor('results', facts), lead, 'Results');
        lean('editorial', wordsFor('editorial', facts, WORDS.thanks(facts)), lead, 'Thank you');
        set('bleed', wordsFor('bleed', facts, WORDS.recap(facts)), photos, 'recap', 'Recap');
        clipJobs(final ? 'results' : 'editorial', final ? wordsFor('results', facts) : wordsFor('editorial', facts, WORDS.thanks(facts)), final ? 'Results' : 'Thank you');
    }
    return jobs;
}

/** A still: a PNG, or a JPEG where a photo makes PNGs heavy (the week's posts). */
export const isStill = (job) => job.kind === 'png' || job.kind === 'jpg';
const stillType = (job) => (job.kind === 'jpg' ? ['image/jpeg', 0.9] : ['image/png']);

/** One job per post (its Post size), in kit order: what a preview strip shows. */
export const postsOf = (jobs) => jobs.filter((j) => isStill(j) && j.format === 'post');

/** Ready-to-paste words for the posts, one block per kind. */
export function captionsFor(phase, facts) {
    const tags = `#POWR #${tag(facts.venue) || 'gym'} #${tag(facts.name)}`;
    const when = whenLine(facts);
    const blocks = [];
    if (phase === 'before') {
        blocks.push(['Ticket, Club, Spec and the poster',
            `${facts.name} at ${facts.venue}, ${when}. Every verified workout counts, and the board runs itself in the POWR app. Join here: ${facts.joinUrl}\n\n${tags}`]);
        if (facts.days >= 14) blocks.push(['Countdown', `${facts.days} days. One board. Show up, check in, and the streak does the rest. ${facts.name} starts ${noZero(facts.rangeFrom)} at ${facts.venue}. Join in the POWR app: ${facts.joinUrl}\n\n${tags}`]);
        blocks.push(['Teasers', `Coming up: ${facts.name}, ${when} at ${facts.venue}. Get on the board in the POWR app: ${facts.joinUrl}\n\n${tags}`]);
    } else {
        const s = facts.standings ?? [];
        if (facts.board === 'final' && s.length) {
            const podium = s.slice(0, 3).map((r, i) => `${['1st', '2nd', '3rd'][i]} ${r.name} · ${thousands(r.points)} POWR`).join('\n');
            blocks.push(['Results', `The results are in. ${s[0].name} took ${facts.name} at ${facts.venue} with ${thousands(s[0].points)} POWR.\n\n${podium}\n\nThanks to everyone who showed up. Every move counted.\n\n${tags}`]);
        }
        blocks.push(['Thank you and the recap', `That’s a wrap on ${facts.name}. Thanks to everyone who came to ${facts.venue} and put the work in. The next one is already in the POWR app.\n\n${tags}`]);
    }
    return blocks.map(([h, body]) => `${h}\n${'─'.repeat(Math.min(60, h.length + 8))}\n${wrapParagraphs(body, 90)}\n`).join('\n');
}

function readmeFor(phase, facts, jobs) {
    const folders = new Set(jobs.map((j) => j.folder));
    const ABOUT = {
        [FOLDER.post]: 'Instagram and Facebook feed (1080×1350).',
        [FOLDER.story]: 'Stories and Reels covers, TikTok (1080×1920).',
        [FOLDER.square]: 'profile grids and WhatsApp (1080×1080).',
        [FOLDER.landscape]: 'the gym TV, YouTube and the web (1920×1080).',
        [FOLDER.print]: 'A4 with a 3 mm bleed, for the front desk.',
        [FOLDER.video]: `MP4 clips, the first ${CLIP_SECONDS} seconds, no sound.`,
    };
    const lines = [
        `${facts.name} — ${phase === 'before' ? 'before the event' : 'after the event'}`,
        `Made with POWR Studio on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
        '',
        'One folder per size. The same file name in each folder is the same post at that size.',
        ...Object.keys(ABOUT).filter((f) => folders.has(f)).map((f) => `  ${f}: ${ABOUT[f]}`),
        '',
        'captions.txt has the words to paste with each post.',
        'The QR on the Ticket opens the event in the POWR app.',
    ];
    return `${lines.join('\n')}\n`;
}

const seekTo = (v, t) => new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 0.001) { res(); return; }
    v.addEventListener('seeked', () => res(), { once: true });
    v.currentTime = t;
});

/** A loaded asset, from `cache` (a Map by asset id) when it's there. */
export async function mediaFor(asset, cache) {
    if (!asset) return null;
    if (!cache.has(asset.id)) cache.set(asset.id, await loadMedia(asset.file));
    return cache.get(asset.id);
}

/** Let go of a loaded asset (an ImageBitmap or a video element). */
export function releaseMedia(m) {
    if (!m) return;
    if (m.kind === 'video') { m.source.pause?.(); if (m.url?.startsWith('blob:')) URL.revokeObjectURL(m.url); }
    else m.source?.close?.();
}

// A clip's still comes from a frame a little way in, past any fade-up.
const settle = async (media) => { if (media?.kind === 'video') await seekTo(media.source, Math.min(1, media.duration * 0.25)); };

const renderOpts = (job, media) => ({
    template: templateById(job.template), format: job.format, media, fields: job.fields, style: job.style, look: job.look,
    focal: { x: 0.5, y: 0.42 }, zoom: 1, assets: {}, cache: {},
});

/** A small JPEG data URL of one job, for a preview strip. */
export async function renderThumb(job, media, scale = 0.2) {
    await prepareStudio();
    await settle(media);
    const c = document.createElement('canvas');
    renderPost(c, { ...renderOpts(job, media), scale });
    const url = c.toDataURL('image/jpeg', 0.82);
    c.width = 0;
    return url;
}

/** One job at full size, as a PNG blob. */
export async function renderStill(job, media) {
    await prepareStudio();
    await settle(media);
    const c = document.createElement('canvas');
    renderPost(c, { ...renderOpts(job, media), scale: 1 });
    const blob = await new Promise((res) => c.toBlob(res, ...stillType(job)));
    c.width = 0;
    return blob;
}

/**
 * Render every job and pack the ZIP. `onProgress(fraction, job)` as it goes;
 * abort with `signal`. Pass `mediaCache` (a Map) to reuse assets already
 * loaded for previews; it is left as it was. Resolves with { blob, names }.
 */
export async function buildKit({ phase, facts, jobs, onProgress, signal, mediaCache, captions, readme }) {
    await prepareStudio();
    const loaded = mediaCache ?? new Map();
    const files = [];
    // A clip is hundreds of renders where a still is one, so it weighs more in the bar.
    const weightOf = (job) => (job.kind === 'mp4' ? 40 : 1);
    const total = jobs.reduce((sum, j) => sum + weightOf(j), 0) || 1;
    let done = 0;
    const tick = (p, job) => onProgress?.(Math.min(1, (done + p * weightOf(job)) / total), job);
    for (const job of jobs) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        tick(0, job);
        const media = await mediaFor(job.asset, loaded);
        const base = renderOpts(job, media);
        if (job.kind === 'mp4') {
            const blob = await exportVideo({
                ...base, start: 0, end: Math.min(media.duration, CLIP_SECONDS), keepAudio: false, signal,
                onProgress: (p) => tick(p, job),
            });
            files.push({ name: `${job.folder}/${job.file}`, data: blob });
        } else {
            await settle(media);
            const c = document.createElement('canvas');
            const bleed = job.kind === 'pdf' ? Math.round((BLEED_MM / 25.4) * 300) : 0;
            renderPost(c, { ...base, scale: 1, bleed });
            const F = FORMATS[job.format];
            const blob = job.kind === 'pdf'
                ? await pdfFromCanvas(c, { wMm: F.print.wMm, hMm: F.print.hMm, bleedMm: BLEED_MM })
                : await new Promise((res) => c.toBlob(res, ...stillType(job)));
            files.push({ name: `${job.folder}/${job.file}`, data: blob });
            c.width = 0;
        }
        done += weightOf(job);
        tick(0, job);
        await new Promise((r) => setTimeout(r, 0));
    }
    if (!mediaCache) for (const m of loaded.values()) releaseMedia(m);
    files.push({ name: 'captions.txt', data: captions ?? captionsFor(phase, facts) });
    files.push({ name: 'README.txt', data: readme ?? readmeFor(phase, facts, jobs) });
    return { blob: await zipFiles(files), names: files.map((f) => f.name) };
}

/** A dropped File as a kit asset. */
export function assetFrom(file, id) {
    return { id, file, kind: isVideoInput(file) ? 'video' : 'image', name: file.name };
}
