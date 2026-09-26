/**
 * The plan for a pack: which posts, which photo each one gets, and the words.
 *
 * The event and the stage decide the posts (before: announce it; live: the
 * standings; after: results, thanks and a recap carousel). Each post then
 * gets the photo that suits its template best — somewhere calm for its
 * words, a clear subject where the template points at one, motion blur where
 * it loves it — and no photo is used twice until every good one has been.
 * The plan is plain data: the page shows it, the admin changes it, the
 * builder renders it, and it's saved with the pack.
 */
import { templateById } from '../templates';
import { fieldDefaults } from '../render';
import { quality, weakness, hashDistance } from './analyse';

export const PHASES = [
    { id: 'before', label: 'Before', blurb: 'announce it: dates, venue, the join QR, a poster' },
    { id: 'during', label: 'Live', blurb: 'while it runs: the standings and a nudge to join' },
    { id: 'after', label: 'After', blurb: 'results, a thank-you and a recap carousel' },
    { id: 'brand', label: 'No event', blurb: 'brand posts over the best photos' },
];

/** The stage an event is at: its board decides. */
export function phaseFor(facts) {
    if (!facts) return 'brand';
    if (facts.status === 'draft' || facts.status === 'scheduled') return 'before';
    if (facts.status === 'live' || facts.status === 'locked') return 'during';
    return 'after';
}

export const FORMAT_CHOICES = [
    { id: 'post', label: 'Post 4:5' },
    { id: 'story', label: 'Story 9:16' },
    { id: 'square', label: 'Square 1:1' },
    { id: 'landscape', label: 'Landscape 16:9' },
];

export const LOOK_CHOICES = [
    { id: 'film', label: 'Film', blurb: 'black and white, the house look' },
    { id: 'mixed', label: 'Mixed', blurb: 'film and colour, post by post' },
    { id: 'colour', label: 'Colour', blurb: 'the photos as shot' },
];

export const DEFAULT_OPTIONS = {
    formats: ['post', 'story'],
    look: 'film',
    colourway: 'powr',
    poster: true,     // before: the Ticket as an A4 poster PDF
    carousel: true,   // after / no event: a carousel of the best photos
    carouselSize: 8,
    reels: true,      // a Story reel from each clip (up to MAX_REELS)
    extras: false,    // a Frame post for every good photo left over
};

export const MAX_REELS = 3;
export const REEL_SECONDS = 12;

// What each template wants from its photo: a calm band for its words (any of
// '|'), whether motion blur suits it, and whether it can go without a photo.
const NEEDS = {
    editorial: { calm: 'bottom' },
    bleed: { calm: 'top', blur: true },
    manifesto: { calm: 'left' },
    dots: {},
    barcode: { calm: 'bottom', blur: true },
    frame: { calm: 'bottom' },
    partner: { calm: 'left' },
    reward: { calm: 'top' },
    club: { calm: 'top|bottom' },
    spec: { calm: 'left|right' },
    ticket: { calm: 'right' },
    results: { calm: 'bottom' },
    countdown: { calm: 'top' },
    grid: {},
};

const when = (f) => (f.night ? `${f.weekdayLong} ${f.day} ${f.month}` : f.range);
const at = (f) => [f.venue, f.city].filter(Boolean).join(', ');

// The posts for each stage, in the order they're made. `lead` takes the lead
// photo; `skip` drops a post the event can't carry (and says why).
const RECIPES = {
    before: [
        { template: 'ticket', lead: true, poster: true },
        { template: 'club' },
        { template: 'spec' },
        {
            template: 'editorial',
            words: (f) => ({ tag: 'Coming up', headline: `${f.name}.`, line: [when(f), at(f)].filter(Boolean).join(' · '), footer: 'Join in the app' }),
        },
        { template: 'dots', words: (f) => ({ headline: [f.night ? f.weekdayLong : f.rangeFrom, f.night ? f.time12 : `to ${f.rangeTo}`, f.venue || 'POWR'].join('\n') }) },
        {
            template: 'barcode',
            words: (f) => ({
                title: f.name,
                line: [f.night ? `${f.day} ${f.month}` : f.range, f.night ? f.time24 : null, f.venue].filter(Boolean).join(' · '),
                body: 'Join in the POWR app. When it starts, every minute on the gym floor counts.',
            }),
        },
    ],
    during: [
        { template: 'results', lead: true, skip: (f) => (f.board === 'live' && f.standings?.length ? null : 'No standings to show yet') },
        { template: 'editorial', lead: true, words: (f) => ({ tag: 'Live now', headline: 'It’s on.', line: [f.name, f.venue].filter(Boolean).join(' · '), footer: 'Every move counts' }) },
        { template: 'dots', words: () => ({ headline: 'All\nto play\nfor.' }) },
        { template: 'bleed', words: () => ({ headline: 'Still\ntime', caption: 'Join in\nthe app.' }) },
    ],
    after: [
        {
            template: 'results',
            skip: (f) => (f.board === 'sealed' ? 'The board is sealed until the reveal — Results waits for it'
                : f.board === 'final' && f.standings?.length ? null : 'No final standings yet'),
        },
        { template: 'editorial', lead: true, words: (f) => ({ tag: f.name, headline: 'That’s\na wrap.', line: f.venue ? `Thank you to everyone who showed up at ${f.venue}.` : 'Thank you to everyone who showed up.', footer: 'Train · Earn · Repeat' }) },
        {
            template: 'club',
            words: (f) => ({
                headline: 'Thank\nyou',
                left: f.venue ? `${f.venue},\nfor having\nus` : 'For\nshowing\nup',
                right: `${f.name}\n${f.day} ${f.month}`,
                line: 'Every minute on the gym floor counted.',
            }),
        },
        { template: 'bleed' },
        { template: 'dots', words: () => ({ headline: 'See you\nat the\nnext one.' }) },
        {
            template: 'barcode',
            words: (f) => ({
                title: f.name,
                line: [`${f.day} ${f.month}`, f.venue].filter(Boolean).join(' · '),
                body: `Thank you to everyone who showed up${f.venue ? `, and to ${f.venue} for having us` : ''}. Results are in the app.`,
            }),
        },
    ],
    brand: [
        { template: 'editorial', lead: true },
        { template: 'bleed' },
        { template: 'dots' },
        { template: 'barcode' },
        { template: 'manifesto' },
    ],
};

// House film, warm colour, film again, cool colour.
// A template's duotone tint (warm, cool) repaints the whole photo in two
// tones, so a colour look must turn it down (tintAmount) or the colour is lost.
// Colour: the photos as shot. Mixed: house film, then colour with a light
// warm or cool cast, alternating.
const COLOUR = { mono: 0, tintAmount: 0 };
const MIXED = [{}, { mono: -0.1, tint: 'warm', tintAmount: 0.3 }, {}, { mono: -0.1, tint: 'cool', tintAmount: 0.3 }];
// In a mixed pack the QR poster and the standings keep the house look.
const FLAGSHIP = new Set(['ticket', 'results']);

/** The look for the n-th post of a pack. */
export function lookFor(options, n, templateId) {
    if (options.look === 'film') return {};
    if (options.look === 'colour') return COLOUR;
    return FLAGSHIP.has(templateId) ? {} : MIXED[n % MIXED.length];
}

/** A template's words: its defaults, what the event fills in, then the post's own. */
export function wordsFor(templateId, facts, extra = {}) {
    const t = templateById(templateId);
    const filled = facts && t.fill?.event ? t.fill.event(facts) : {};
    return { ...fieldDefaults(t), ...filled, ...extra };
}

/** The photos worth posting, best first, with what each is good for. */
export function rankPhotos(media) {
    return media
        .filter((m) => m.kind === 'photo' && m.analysis?.ok && !m.excluded)
        .map((m) => ({ ...m, q: quality(m.analysis), weak: weakness(m.analysis) }))
        .sort((a, b) => b.q - a.q);
}

/** How well a photo suits a template (higher is better). */
export function fit(photo, templateId) {
    const need = NEEDS[templateId] ?? {};
    const a = photo.analysis;
    let s = photo.q;
    if (need.calm) s *= 0.55 + 0.45 * Math.max(...need.calm.split('|').map((b) => a.calm[b]));
    if (need.blur && a.stats.sharp < 700) s *= 1.15;
    if (a.width / a.height > 1.25) s *= 0.8; // landscape: a 4:5 or 9:16 crop loses most of it
    if (photo.weak) s *= 0.4;
    if (photo.dupOf) s *= 0.2;
    return s;
}

// Looks like a photo already in the pack (another crop or frame of the same shot)?
const SIMILAR = 16;
const echoes = (p, chosen) => chosen.some((q) => hashDistance(p.analysis.hash, q.analysis.hash) <= SIMILAR);

// The best photo for a template, unused ones first, and not one that echoes a photo already used.
function pick(ranked, templateId, used) {
    const fresh = ranked.filter((p) => !used.has(p.id));
    const pool = fresh.length ? fresh : ranked;
    const chosen = ranked.filter((p) => used.has(p.id));
    const score = (p) => fit(p, templateId) * (echoes(p, chosen) ? 0.35 : 1);
    let best = null;
    for (const p of pool) if (!best || score(p) > score(best)) best = p;
    return best;
}

/**
 * The whole pack. `leadId` pins the lead photo; `facts` is the event (with
 * `standings` when its board has any), or null for a brand pack.
 */
export function planPack({ phase, facts, media, options = DEFAULT_OPTIONS, leadId = null }) {
    const o = { ...DEFAULT_OPTIONS, ...options };
    const f = phase === 'brand' ? null : facts;
    const ranked = rankPhotos(media);
    const lead = ranked.find((p) => p.id === leadId) ?? ranked.find((p) => !p.weak && !p.dupOf) ?? ranked[0] ?? null;
    const used = new Set();
    const notes = [];
    let leadTaken = false;
    const posts = [];

    for (const slot of RECIPES[phase] ?? RECIPES.brand) {
        const why = slot.skip && f ? slot.skip(f) : null;
        if (why) { notes.push(why); continue; }
        let photo = null;
        if (slot.lead && !leadTaken && lead) { photo = lead; leadTaken = true; } else photo = pick(ranked, slot.template, used);
        if (photo) used.add(photo.id);
        const n = posts.length;
        posts.push({
            id: `p${n + 1}`,
            templateId: slot.template,
            mediaId: photo?.id ?? null,
            fields: wordsFor(slot.template, f, slot.words && f ? slot.words(f) : {}),
            look: lookFor(o, n, slot.template),
            poster: Boolean(slot.poster && o.poster && phase === 'before'),
        });
    }

    // Recap carousel: a cover, the best photos left, and a closing slide.
    let carousel = null;
    if (o.carousel && (phase === 'after' || phase === 'brand') && ranked.length >= 3) {
        const size = Math.max(3, Math.min(o.carouselSize, 10));
        // Best first, skipping anything that echoes a slide already in (or a post).
        const pool = [];
        const taken = ranked.filter((p) => used.has(p.id));
        const candidates = [...ranked.filter((p) => !used.has(p.id) && !p.dupOf && !p.weak), ...ranked.filter((p) => used.has(p.id) && !p.dupOf)];
        // A shorter carousel beats one that repeats itself.
        for (const p of candidates) {
            if (pool.length >= size) break;
            if (!echoes(p, pool) && (used.has(p.id) || !echoes(p, taken))) pool.push(p);
        }
        const title = f ? f.name : 'Every move counts';
        const note = f ? [`${f.day} ${f.month}`, f.venue].filter(Boolean).join(' · ') : 'powr.life';
        const slides = pool.map((p, i) => ({
            id: `c${i + 1}`,
            templateId: i === pool.length - 1 && pool.length > 2 ? 'dots' : 'frame',
            mediaId: p.id,
            fields: i === pool.length - 1 && pool.length > 2
                ? wordsFor('dots', null, { headline: 'Every\nmove\ncounts.' })
                : wordsFor('frame', null, i === 0 ? { title, note, index: '' } : { title: '', note: '', index: '' }),
        }));
        slides.forEach((s, i) => { if (s.templateId === 'frame') s.fields.index = `${String(i + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`; });
        slides.forEach((s) => used.add(s.mediaId));
        if (slides.length >= 3) carousel = { slides, look: lookFor(o, 0, 'frame') };
        else notes.push('Not enough different photos for a carousel — it needs three that don’t repeat each other.');
    }

    // A Frame post for every good photo still unused.
    if (o.extras) {
        for (const p of ranked.filter((q) => !used.has(q.id) && !q.dupOf && !q.weak)) {
            const n = posts.length;
            posts.push({
                id: `p${n + 1}`,
                templateId: 'frame',
                mediaId: p.id,
                fields: wordsFor('frame', null, f ? { title: f.name, note: [`${f.day} ${f.month}`, f.venue].filter(Boolean).join(' · ') } : {}),
                look: lookFor(o, n, 'frame'),
                poster: false,
            });
            used.add(p.id);
        }
    }

    // A Story reel from each clip: the stage's lead words over its first seconds.
    const clips = media.filter((m) => m.kind === 'clip' && m.analysis?.ok && !m.excluded).slice(0, o.reels ? MAX_REELS : 0);
    const reelTemplate = phase === 'before' ? 'club' : phase === 'during' ? 'editorial' : 'bleed';
    const reelWords = posts.find((p) => p.templateId === reelTemplate)?.fields ?? wordsFor(reelTemplate, f);
    const reels = clips.map((c, i) => ({ id: `r${i + 1}`, templateId: reelTemplate, mediaId: c.id, fields: { ...reelWords }, look: lookFor(o, i, reelTemplate) }));

    return {
        version: 1,
        phase,
        eventId: f?.id ?? null,
        facts: f ? { ...f, standings: undefined } : null,
        options: o,
        leadId: lead?.id ?? null,
        posts,
        carousel,
        reels,
        notes,
    };
}

/** Captions to paste, one per stage. */
export function captionFor(phase, facts) {
    const f = facts;
    if (!f || phase === 'brand') return 'Every move counts.\npowr.life\n\n#POWR';
    if (phase === 'before') {
        return `${f.name} — ${[when(f), f.night ? f.time12 : null].filter(Boolean).join(', ')}${f.venue ? `, ${at(f)}` : ''}.\nJoin in the POWR app: powr.life/app\n\n#POWR`;
    }
    if (phase === 'during') {
        return `${f.name} is live${f.venue ? ` at ${f.venue}` : ''}. Every minute on the gym floor counts.\nThe standings are in the app: powr.life/app\n\n#POWR`;
    }
    return `That’s a wrap on ${f.name}. Thank you to everyone who showed up${f.venue ? `, and to ${f.venue} for having us` : ''}.\nThe results are in the app.\n\n#POWR`;
}

/** The template after this one, for "another template" (cycles through the stage's set). */
export function nextTemplate(templateId, phase) {
    const pool = phase === 'brand' ? ['editorial', 'bleed', 'manifesto', 'dots', 'barcode', 'frame', 'grid']
        : ['club', 'spec', 'ticket', 'editorial', 'dots', 'barcode', 'bleed', 'frame'];
    return pool[(pool.indexOf(templateId) + 1) % pool.length];
}
