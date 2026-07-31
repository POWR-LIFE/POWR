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
 */

import { type ActivityType } from './activities';

export interface CatalogActivity {
    /** Stable id, snake/kebab-free lowercase. Never rename once shipped. */
    slug: string;
    label: string;
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
export const CATALOG_GROUPS: { key: string; label: string; buckets: ActivityType[] }[] = [
    { key: 'cardio',  label: 'CARDIO',              buckets: ['walking', 'running', 'cycling', 'swimming'] },
    { key: 'sports',  label: 'SPORTS',              buckets: ['sports'] },
    { key: 'classes', label: 'CLASSES & TRAINING',  buckets: ['hiit'] },
    { key: 'body',    label: 'MIND & BODY',         buckets: ['yoga'] },
    { key: 'dance',   label: 'DANCE',               buckets: ['dance'] },
];

export const ACTIVITY_CATALOG: CatalogActivity[] = [
    // ── Cardio ────────────────────────────────────────────────────────────────
    { slug: 'walking',        label: 'Walking',          bucket: 'walking',  icon: 'walk',           iconLib: 'ionicons', popular: true },
    { slug: 'hiking',         label: 'Hiking',           bucket: 'walking',  icon: 'hiking',         iconLib: 'material-community', keywords: ['walk', 'trail', 'rambling'] },
    { slug: 'running',        label: 'Running',          bucket: 'running',  icon: 'run',            iconLib: 'material-community', popular: true, keywords: ['jog', '5k', 'parkrun'] },
    { slug: 'trail-running',  label: 'Trail running',    bucket: 'running',  icon: 'run-fast',       iconLib: 'material-community', keywords: ['ultra', 'fell'] },
    { slug: 'cycling',        label: 'Cycling',          bucket: 'cycling',  icon: 'bike',           iconLib: 'material-community', popular: true, keywords: ['bike', 'road'] },
    { slug: 'spin',           label: 'Spin',             bucket: 'cycling',  icon: 'bike-fast',      iconLib: 'material-community', keywords: ['peloton', 'studio', 'indoor cycling'] },
    { slug: 'mountain-biking',label: 'Mountain biking',  bucket: 'cycling',  icon: 'bike',           iconLib: 'material-community', keywords: ['mtb', 'downhill'] },
    { slug: 'swimming',       label: 'Swimming',         bucket: 'swimming', icon: 'swim',           iconLib: 'material-community', popular: true, keywords: ['pool', 'laps'] },
    { slug: 'open-water',     label: 'Open water',       bucket: 'swimming', icon: 'waves',          iconLib: 'material-community', keywords: ['sea', 'wild swimming', 'triathlon'] },

    // ── Sports ────────────────────────────────────────────────────────────────
    { slug: 'football',       label: 'Football',         bucket: 'sports',   icon: 'soccer',         iconLib: 'material-community', popular: true, keywords: ['soccer', '5-a-side', 'futsal'] },
    { slug: 'tennis',         label: 'Tennis',           bucket: 'sports',   icon: 'tennis',         iconLib: 'material-community', popular: true },
    { slug: 'padel',          label: 'Padel',            bucket: 'sports',   icon: 'tennis',         iconLib: 'material-community', keywords: ['paddle'] },
    { slug: 'basketball',     label: 'Basketball',       bucket: 'sports',   icon: 'basketball',     iconLib: 'material-community', keywords: ['hoops'] },
    { slug: 'netball',        label: 'Netball',          bucket: 'sports',   icon: 'basketball',     iconLib: 'material-community' },
    { slug: 'rugby',          label: 'Rugby',            bucket: 'sports',   icon: 'rugby',          iconLib: 'material-community' },
    { slug: 'cricket',        label: 'Cricket',          bucket: 'sports',   icon: 'cricket',        iconLib: 'material-community' },
    { slug: 'golf',           label: 'Golf',             bucket: 'sports',   icon: 'golf',           iconLib: 'material-community' },
    { slug: 'squash',         label: 'Squash',           bucket: 'sports',   icon: 'racquetball',    iconLib: 'material-community' },
    { slug: 'badminton',      label: 'Badminton',        bucket: 'sports',   icon: 'badminton',      iconLib: 'material-community' },
    { slug: 'volleyball',     label: 'Volleyball',       bucket: 'sports',   icon: 'volleyball',     iconLib: 'material-community' },
    { slug: 'hockey',         label: 'Hockey',           bucket: 'sports',   icon: 'hockey-sticks',  iconLib: 'material-community' },
    { slug: 'table-tennis',   label: 'Table tennis',     bucket: 'sports',   icon: 'table-tennis',   iconLib: 'material-community', keywords: ['ping pong'] },
    { slug: 'climbing',       label: 'Climbing',         bucket: 'sports',   icon: 'carabiner',      iconLib: 'material-community', keywords: ['bouldering', 'wall'] },
    { slug: 'skiing',         label: 'Skiing',           bucket: 'sports',   icon: 'ski',            iconLib: 'material-community', keywords: ['snow'] },
    { slug: 'snowboarding',   label: 'Snowboarding',     bucket: 'sports',   icon: 'snowboard',      iconLib: 'material-community' },
    { slug: 'surfing',        label: 'Surfing',          bucket: 'sports',   icon: 'surfing',        iconLib: 'material-community' },
    { slug: 'skateboarding',  label: 'Skateboarding',    bucket: 'sports',   icon: 'skateboard',     iconLib: 'material-community', keywords: ['skate'] },

    // ── Classes & training ────────────────────────────────────────────────────
    { slug: 'hiit',           label: 'HIIT',             bucket: 'hiit',     icon: 'lightning-bolt', iconLib: 'material-community', popular: true, keywords: ['interval', 'tabata'] },
    { slug: 'crossfit',       label: 'CrossFit',         bucket: 'hiit',     icon: 'weight-lifter',  iconLib: 'material-community', keywords: ['wod', 'functional'] },
    { slug: 'bootcamp',       label: 'Bootcamp',         bucket: 'hiit',     icon: 'whistle',        iconLib: 'material-community', keywords: ['outdoor fitness'] },
    { slug: 'circuits',       label: 'Circuits',         bucket: 'hiit',     icon: 'timer-outline',  iconLib: 'material-community', keywords: ['circuit training', 'conditioning'] },
    { slug: 'boxing',         label: 'Boxing',           bucket: 'hiit',     icon: 'boxing-glove',   iconLib: 'material-community', popular: true, keywords: ['boxercise', 'sparring'] },
    { slug: 'martial-arts',   label: 'Martial arts',     bucket: 'hiit',     icon: 'karate',         iconLib: 'material-community', keywords: ['mma', 'bjj', 'judo', 'karate', 'muay thai', 'taekwondo'] },
    { slug: 'rowing',         label: 'Rowing',           bucket: 'hiit',     icon: 'rowing',         iconLib: 'material-community', keywords: ['erg', 'concept2'] },

    // ── Mind & body ───────────────────────────────────────────────────────────
    { slug: 'yoga',           label: 'Yoga',             bucket: 'yoga',     icon: 'yoga',           iconLib: 'material-community', popular: true },
    { slug: 'pilates',        label: 'Pilates',          bucket: 'yoga',     icon: 'yoga',           iconLib: 'material-community', keywords: ['reformer'] },
    { slug: 'barre',          label: 'Barre',            bucket: 'yoga',     icon: 'shoe-ballet',    iconLib: 'material-community' },
    { slug: 'stretching',     label: 'Mobility',         bucket: 'yoga',     icon: 'arm-flex-outline', iconLib: 'material-community', keywords: ['stretching', 'flexibility', 'recovery'] },

    // ── Dance ─────────────────────────────────────────────────────────────────
    { slug: 'dance',          label: 'Dance',            bucket: 'dance',    icon: 'dance-ballroom', iconLib: 'material-community', popular: true },
    { slug: 'zumba',          label: 'Zumba',            bucket: 'dance',    icon: 'music-note',     iconLib: 'material-community' },
    { slug: 'ballet',         label: 'Ballet',           bucket: 'dance',    icon: 'shoe-ballet',    iconLib: 'material-community' },
];

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

/** Case-insensitive search over label + keywords + bucket name. */
export function searchCatalog(query: string): CatalogActivity[] {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIVITY_CATALOG;
    return ACTIVITY_CATALOG.filter(a =>
        a.label.toLowerCase().includes(q) ||
        a.bucket.includes(q) ||
        (a.keywords ?? []).some(k => k.includes(q)),
    );
}

/** A stored selection: the concrete pick + its scoring bucket, denormalised. */
export interface ActivitySelection {
    slug: string;
    label: string;
    bucket: ActivityType;
}

export function toSelection(a: CatalogActivity): ActivitySelection {
    return { slug: a.slug, label: a.label, bucket: a.bucket };
}
