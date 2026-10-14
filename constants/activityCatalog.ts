/**
 * The activity catalog: the *specific* activities a user can pick as their
 * focus (Padel, Boxing, Zumba…), each mapping to one of the coarse scoring
 * buckets in `constants/activities.ts`.
 *
 * Two-layer taxonomy, deliberately:
 * - Buckets stay the machinery — points caps, wearable-detection mapping,
 *   rings and the earn logic all key on `ActivityType` and are untouched.
 * - The catalog is the identity layer — what the user sees and picks. A user
 *   picks "Padel"; we store the pick AND its bucket ('sports'), so every
 *   existing consumer of `activity_preferences` keeps working while UI can
 *   show "Padel".
 *
 * Adding a catalog entry is a one-line change and touches no scoring; adding
 * a BUCKET is a scoring/product decision — don't do it here.
 *
 * Names live in the `activities` catalog (shared/i18n/<lang>/app/activities.json)
 * and resolve when read: `label` is the language on screen, `labelEn` is the
 * English name a selection stores, so profiles.activity_selections never
 * depends on the language the pick was made in.
 */

import i18n from '@/lib/i18n';

import { type ActivityType } from './activities';

export interface CatalogActivity {
    /** Stable lowercase id (hyphens allowed, no spaces). Never rename once shipped. */
    slug: string;
    /** The `activities:catalog.*` key both names below come from. */
    labelKey: string;
    /** Display name, in the language on screen when read. */
    readonly label: string;
    /** English name, whatever the screen shows: what a selection stores. */
    readonly labelEn: string;
    /** The scoring bucket this activity counts as. */
    bucket: ActivityType;
    icon: string;
    iconLib?: 'ionicons' | 'material-community';
    /** Extra search terms (lowercase). */
    keywords?: string[];
    /** Shown in the "popular" strip before the user searches. */
    popular?: boolean;
}

/** Display groups for the picker, in render order. */
export const CATALOG_GROUPS: { key: string; readonly label: string; buckets: ActivityType[] }[] = [
    { key: 'gym',     get label() { return i18n.t('activities:groups.gym'); },     buckets: ['gym'] },
    { key: 'cardio',  get label() { return i18n.t('activities:groups.cardio'); },  buckets: ['walking', 'running', 'cycling', 'swimming'] },
    { key: 'sports',  get label() { return i18n.t('activities:groups.sports'); },  buckets: ['sports'] },
    { key: 'classes', get label() { return i18n.t('activities:groups.classes'); }, buckets: ['hiit'] },
    { key: 'body',    get label() { return i18n.t('activities:groups.body'); },    buckets: ['yoga'] },
    { key: 'dance',   get label() { return i18n.t('activities:groups.dance'); },   buckets: ['dance'] },
];

/** Gives each entry its two names as getters, so neither freezes at load. */
function withNames(entries: Omit<CatalogActivity, 'label' | 'labelEn'>[]): CatalogActivity[] {
    return entries.map(entry => Object.defineProperties(entry, {
        label: { enumerable: true, get: () => i18n.t(entry.labelKey) },
        labelEn: { enumerable: true, get: () => i18n.t(entry.labelKey, { lng: 'en' }) },
    }) as CatalogActivity);
}

export const ACTIVITY_CATALOG: CatalogActivity[] = withNames([
    // ── Gym ───────────────────────────────────────────────────────────────────
    // Gym used to be the "locked slot" (always in every profile, never a pick).
    // Since 2026-08-28 it is an ordinary pick, pre-selected in onboarding — a
    // walk/run/cycle-only user can drop it and stop seeing gym-framed surfaces
    // (see supabase/functions/_shared/activityRelevance.ts).
    { slug: 'gym',            labelKey: 'activities:catalog.gym',              bucket: 'gym',      icon: 'barbell',        iconLib: 'ionicons', popular: true, keywords: ['weights', 'strength', 'lifting', 'check-in', 'geofence'] },
    { slug: 'strength',       labelKey: 'activities:catalog.strength',         bucket: 'gym',      icon: 'dumbbell',       iconLib: 'material-community', keywords: ['weights', 'lifting', 'powerlifting', 'bodybuilding'] },

    // ── Cardio ────────────────────────────────────────────────────────────────
    { slug: 'walking',        labelKey: 'activities:catalog.walking',          bucket: 'walking',  icon: 'walk',           iconLib: 'ionicons', popular: true },
    { slug: 'hiking',         labelKey: 'activities:catalog.hiking',           bucket: 'walking',  icon: 'hiking',         iconLib: 'material-community', keywords: ['walk', 'trail', 'rambling'] },
    { slug: 'running',        labelKey: 'activities:catalog.running',          bucket: 'running',  icon: 'run',            iconLib: 'material-community', popular: true, keywords: ['jog', '5k', 'parkrun'] },
    { slug: 'trail-running',  labelKey: 'activities:catalog.trailRunning',     bucket: 'running',  icon: 'run-fast',       iconLib: 'material-community', keywords: ['ultra', 'fell'] },
    { slug: 'cycling',        labelKey: 'activities:catalog.cycling',          bucket: 'cycling',  icon: 'bike',           iconLib: 'material-community', popular: true, keywords: ['bike', 'road'] },
    { slug: 'spin',           labelKey: 'activities:catalog.spin',             bucket: 'cycling',  icon: 'bike-fast',      iconLib: 'material-community', keywords: ['peloton', 'studio', 'indoor cycling'] },
    { slug: 'mountain-biking',labelKey: 'activities:catalog.mountainBiking',   bucket: 'cycling',  icon: 'bike',           iconLib: 'material-community', keywords: ['mtb', 'downhill'] },
    { slug: 'swimming',       labelKey: 'activities:catalog.swimming',         bucket: 'swimming', icon: 'swim',           iconLib: 'material-community', popular: true, keywords: ['pool', 'laps'] },
    { slug: 'open-water',     labelKey: 'activities:catalog.openWater',        bucket: 'swimming', icon: 'waves',          iconLib: 'material-community', keywords: ['sea', 'wild swimming', 'triathlon'] },

    // ── Sports ────────────────────────────────────────────────────────────────
    { slug: 'football',       labelKey: 'activities:catalog.football',         bucket: 'sports',   icon: 'soccer',         iconLib: 'material-community', popular: true, keywords: ['soccer', '5-a-side', 'futsal'] },
    { slug: 'tennis',         labelKey: 'activities:catalog.tennis',           bucket: 'sports',   icon: 'tennis',         iconLib: 'material-community', popular: true },
    { slug: 'padel',          labelKey: 'activities:catalog.padel',            bucket: 'sports',   icon: 'tennis',         iconLib: 'material-community', keywords: ['paddle'] },
    { slug: 'basketball',     labelKey: 'activities:catalog.basketball',       bucket: 'sports',   icon: 'basketball',     iconLib: 'material-community', keywords: ['hoops'] },
    { slug: 'netball',        labelKey: 'activities:catalog.netball',          bucket: 'sports',   icon: 'basketball',     iconLib: 'material-community' },
    { slug: 'rugby',          labelKey: 'activities:catalog.rugby',            bucket: 'sports',   icon: 'rugby',          iconLib: 'material-community' },
    { slug: 'cricket',        labelKey: 'activities:catalog.cricket',          bucket: 'sports',   icon: 'cricket',        iconLib: 'material-community' },
    { slug: 'golf',           labelKey: 'activities:catalog.golf',             bucket: 'sports',   icon: 'golf',           iconLib: 'material-community' },
    { slug: 'squash',         labelKey: 'activities:catalog.squash',           bucket: 'sports',   icon: 'racquetball',    iconLib: 'material-community' },
    { slug: 'badminton',      labelKey: 'activities:catalog.badminton',        bucket: 'sports',   icon: 'badminton',      iconLib: 'material-community' },
    { slug: 'volleyball',     labelKey: 'activities:catalog.volleyball',       bucket: 'sports',   icon: 'volleyball',     iconLib: 'material-community' },
    { slug: 'hockey',         labelKey: 'activities:catalog.hockey',           bucket: 'sports',   icon: 'hockey-sticks',  iconLib: 'material-community' },
    { slug: 'table-tennis',   labelKey: 'activities:catalog.tableTennis',      bucket: 'sports',   icon: 'table-tennis',   iconLib: 'material-community', keywords: ['ping pong'] },
    { slug: 'climbing',       labelKey: 'activities:catalog.climbing',         bucket: 'sports',   icon: 'carabiner',      iconLib: 'material-community', keywords: ['bouldering', 'wall'] },
    { slug: 'skiing',         labelKey: 'activities:catalog.skiing',           bucket: 'sports',   icon: 'ski',            iconLib: 'material-community', keywords: ['snow'] },
    { slug: 'snowboarding',   labelKey: 'activities:catalog.snowboarding',     bucket: 'sports',   icon: 'snowboard',      iconLib: 'material-community' },
    { slug: 'surfing',        labelKey: 'activities:catalog.surfing',          bucket: 'sports',   icon: 'surfing',        iconLib: 'material-community' },
    { slug: 'skateboarding',  labelKey: 'activities:catalog.skateboarding',    bucket: 'sports',   icon: 'skateboard',     iconLib: 'material-community', keywords: ['skate'] },

    // ── Classes & training ────────────────────────────────────────────────────
    { slug: 'hiit',           labelKey: 'activities:catalog.hiit',             bucket: 'hiit',     icon: 'lightning-bolt', iconLib: 'material-community', popular: true, keywords: ['interval', 'tabata'] },
    { slug: 'crossfit',       labelKey: 'activities:catalog.crossfit',         bucket: 'hiit',     icon: 'weight-lifter',  iconLib: 'material-community', keywords: ['wod', 'functional'] },
    { slug: 'bootcamp',       labelKey: 'activities:catalog.bootcamp',         bucket: 'hiit',     icon: 'whistle',        iconLib: 'material-community', keywords: ['outdoor fitness'] },
    { slug: 'circuits',       labelKey: 'activities:catalog.circuits',         bucket: 'hiit',     icon: 'timer-outline',  iconLib: 'material-community', keywords: ['circuit training', 'conditioning'] },
    { slug: 'boxing',         labelKey: 'activities:catalog.boxing',           bucket: 'hiit',     icon: 'boxing-glove',   iconLib: 'material-community', popular: true, keywords: ['boxercise', 'sparring'] },
    { slug: 'martial-arts',   labelKey: 'activities:catalog.martialArts',      bucket: 'hiit',     icon: 'karate',         iconLib: 'material-community', keywords: ['mma', 'bjj', 'judo', 'karate', 'muay thai', 'taekwondo'] },
    { slug: 'rowing',         labelKey: 'activities:catalog.rowing',           bucket: 'hiit',     icon: 'rowing',         iconLib: 'material-community', keywords: ['erg', 'concept2'] },

    // ── Mind & body ───────────────────────────────────────────────────────────
    { slug: 'yoga',           labelKey: 'activities:catalog.yoga',             bucket: 'yoga',     icon: 'yoga',           iconLib: 'material-community', popular: true },
    { slug: 'pilates',        labelKey: 'activities:catalog.pilates',          bucket: 'yoga',     icon: 'yoga',           iconLib: 'material-community', keywords: ['reformer'] },
    { slug: 'barre',          labelKey: 'activities:catalog.barre',            bucket: 'yoga',     icon: 'shoe-ballet',    iconLib: 'material-community' },
    { slug: 'stretching',     labelKey: 'activities:catalog.stretching',       bucket: 'yoga',     icon: 'arm-flex-outline', iconLib: 'material-community', keywords: ['stretching', 'flexibility', 'recovery'] },

    // ── Dance ─────────────────────────────────────────────────────────────────
    { slug: 'dance',          labelKey: 'activities:catalog.dance',            bucket: 'dance',    icon: 'dance-ballroom', iconLib: 'material-community', popular: true },
    { slug: 'zumba',          labelKey: 'activities:catalog.zumba',            bucket: 'dance',    icon: 'music-note',     iconLib: 'material-community' },
    { slug: 'ballet',         labelKey: 'activities:catalog.ballet',           bucket: 'dance',    icon: 'shoe-ballet',    iconLib: 'material-community' },
]);

export const CATALOG_BY_SLUG: Record<string, CatalogActivity> = Object.fromEntries(
    ACTIVITY_CATALOG.map(a => [a.slug, a]),
);

export const POPULAR_ACTIVITIES = ACTIVITY_CATALOG.filter(a => a.popular);

export function catalogForBucket(bucket: ActivityType): CatalogActivity[] {
    return ACTIVITY_CATALOG.filter(a => a.bucket === bucket);
}

/**
 * The catalog entry whose slug equals the bucket name — used to migrate a
 * legacy bucket-only preference ('sports') into a concrete selection when the
 * user opens the picker. Buckets without a same-name entry (e.g. 'sports')
 * fall back to their first entry.
 */
export function genericEntryForBucket(bucket: ActivityType): CatalogActivity | null {
    return CATALOG_BY_SLUG[bucket] ?? catalogForBucket(bucket)[0] ?? null;
}

/** Lower-cases and drops accents, so "velo" finds Vélo and "natacion" Natación. */
function fold(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Case- and accent-insensitive search over label + keywords + bucket name. The
 * label matches in the language on screen AND in English (keywords are English
 * too), so "course" and "running" both find Running in French.
 */
export function searchCatalog(query: string): CatalogActivity[] {
    const q = fold(query.trim());
    if (!q) return ACTIVITY_CATALOG;
    return ACTIVITY_CATALOG.filter(a =>
        fold(a.label).includes(q) ||
        fold(a.labelEn).includes(q) ||
        a.bucket.includes(q) ||
        (a.keywords ?? []).some(k => k.includes(q)),
    );
}

/**
 * A stored selection: the concrete pick + its scoring bucket, denormalised.
 * `label` is always the English name (persisted to profiles and user_metadata);
 * show one with selectionLabel().
 */
export interface ActivitySelection {
    slug: string;
    label: string;
    bucket: ActivityType;
}

export function toSelection(a: CatalogActivity): ActivitySelection {
    return { slug: a.slug, label: a.labelEn, bucket: a.bucket };
}

/**
 * A selection's name in the language on screen. Stored selections carry the
 * English label, so anything displaying one should read it through here; a slug
 * the catalog no longer has falls back to the stored label.
 */
export function selectionLabel(s: { slug: string; label: string }): string {
    return CATALOG_BY_SLUG[s.slug]?.label ?? s.label;
}
