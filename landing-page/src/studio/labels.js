// The words the Studio's controls show for its fixed option sets: sizes,
// template libraries and groups, colourways, tints, font notes. The source
// files (formats.js, templates/index.js, render.js, grade.js, fonts.js) keep
// their English ids and labels, which the renderer and saved drafts rely on;
// these map those ids to portal keys (studio namespace), translated where
// they're shown. An id with no key here shows the source's own label.
//
// Template names, blurbs, field labels and starting points come from the
// template files themselves and stay English for now.

import { formatLocale } from '../lib/i18n';

export const FORMAT_GROUP = {
    Social: 'studio:formats.groups.social',
    Banners: 'studio:formats.groups.banners',
    Print: 'studio:formats.groups.print',
};
export const FORMAT_GROUP_ALL = {
    Social: 'studio:formats.all.social',
    Banners: 'studio:formats.all.banners',
    Print: 'studio:formats.all.print',
};
export const FORMAT_GROUP_ALL_TITLE = {
    Social: 'studio:formats.allTitle.social',
    Banners: 'studio:formats.allTitle.banners',
    Print: 'studio:formats.allTitle.print',
};
const FORMAT_LABEL = {
    post: 'studio:formats.labels.post',
    portrait: 'studio:formats.labels.portrait',
    square: 'studio:formats.labels.square',
    story: 'studio:formats.labels.story',
    reel: 'studio:formats.labels.reel',
    landscape: 'studio:formats.labels.landscape',
    link: 'studio:formats.labels.link',
    header: 'studio:formats.labels.header',
    cover: 'studio:formats.labels.cover',
};
// Print sizes give a word where the others give a ratio.
const FORMAT_RATIO = {
    a5: 'studio:formats.ratios.a5',
    a4: 'studio:formats.ratios.a4',
    a3: 'studio:formats.ratios.a3',
};
const FORMAT_NOTE = {
    reel: 'studio:formats.notes.reel',
    landscape: 'studio:formats.notes.landscape',
    link: 'studio:formats.notes.link',
    header: 'studio:formats.notes.header',
    cover: 'studio:formats.notes.cover',
};

export const LIBRARY = {
    core: 'studio:libraries.core',
    move: 'studio:libraries.move',
    eat: 'studio:libraries.eat',
    mind: 'studio:libraries.mind',
    sleep: 'studio:libraries.sleep',
};
export const CATEGORY = {
    Trending: 'studio:categories.trending',
    Brand: 'studio:categories.brand',
    Partners: 'studio:categories.partners',
    Events: 'studio:categories.events',
    Challenges: 'studio:categories.challenges',
    Move: 'studio:categories.move',
    Eat: 'studio:categories.eat',
    Mind: 'studio:categories.mind',
    Sleep: 'studio:categories.sleep',
};
export const SECTION = {
    Lifestyle: 'studio:sections.lifestyle',
    Products: 'studio:sections.products',
};
export const COLOURWAY = {
    gold: 'studio:colourways.gold',
    mono: 'studio:colourways.mono',
    signal: 'studio:colourways.signal',
};
export const TINT = {
    none: 'studio:tints.none',
    warm: 'studio:tints.warm',
    cool: 'studio:tints.cool',
    gold: 'studio:tints.gold',
};
export const FONT_NOTE = {
    anton: 'studio:fontNotes.anton',
    shoulders: 'studio:fontNotes.shoulders',
    grotesk: 'studio:fontNotes.grotesk',
    heavy: 'studio:fontNotes.heavy',
    wide: 'studio:fontNotes.wide',
    brandL: 'studio:fontNotes.brandL',
    serif: 'studio:fontNotes.serif',
    serifI: 'studio:fontNotes.serifI',
};

/** The translated word for `id` in `map`, else the source's own (English) label. */
export function pick(t, map, id, fallback) {
    return map[id] ? t(map[id]) : fallback;
}

/** A size's name: Post, Story, A4… */
export function formatLabel(t, f) {
    return pick(t, FORMAT_LABEL, f.id, f.label);
}

/** A size's ratio (4:5), or its word for a print size (flyer). */
export function formatRatio(t, f) {
    return pick(t, FORMAT_RATIO, f.id, f.ratio);
}

/** What a size is for, when formats.js says (Reels: clear of the buttons…). */
export function formatNote(t, f) {
    return f.note ? pick(t, FORMAT_NOTE, f.id, f.note) : null;
}

const decimals = new Map();
/**
 * `n` with exactly `digits` decimals in the reader's number format: "2.5" in
 * English (as toFixed gave), "2,5" in French and Spanish. No thousands
 * separator, as before.
 */
export function decimal(n, digits) {
    const locale = formatLocale();
    const id = `${locale}:${digits}`;
    if (!decimals.has(id)) {
        decimals.set(id, new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }));
    }
    return decimals.get(id).format(Object.is(n, -0) ? 0 : n);
}
