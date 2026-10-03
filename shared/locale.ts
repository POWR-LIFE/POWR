/**
 * A language tag → the parts POWR cares about, by one set of rules everywhere.
 *
 * The web portals read the tag from the browser (landing-page/src/lib/locale.js);
 * the app reads it from the device (lib/locale.ts). This file is pure — no
 * navigator, no native module — so the same rules apply on every surface and
 * root Jest can test them.
 *
 * Every function always returns a value. A language is a nice-to-have, and
 * nothing that renders text may break because a browser was vague.
 */

/** What we resolve to when nothing usable was offered. */
export const FALLBACK_LANGUAGE = 'en';

export type ParsedLocale = {
  /** BCP-47 tag as offered, underscores normalised to hyphens ("en-GB", "zh-Hant-TW"). */
  tag: string;
  /** Lower-case ISO 639 language ("en", "es", "zh"). */
  language: string;
  /** Upper-case ISO 3166-1 region ("GB"), or null when the tag carries none. */
  region: string | null;
  textDirection: 'ltr' | 'rtl';
};

const FALLBACK_LOCALE: ParsedLocale = {
  tag: FALLBACK_LANGUAGE,
  language: FALLBACK_LANGUAGE,
  region: null,
  textDirection: 'ltr',
};

// Languages whose default script runs right-to-left. Kurdish is deliberately
// absent: Kurmanji ("ku") is Latin; Sorani has its own code ("ckb").
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ps', 'sd', 'ug', 'ur', 'yi']);
// An explicit script subtag beats the language default ("az-Arab", "ku-Arab").
const RTL_SCRIPTS = new Set(['adlm', 'arab', 'hebr', 'nkoo', 'rohg', 'syrc', 'thaa']);

/** Parse one tag. Anything unusable resolves to English, never to a throw. */
export function parseLocaleTag(raw: string | null | undefined): ParsedLocale {
  const tag = typeof raw === 'string' ? raw.trim().replace(/_/g, '-') : '';
  if (!tag) return FALLBACK_LOCALE;

  const [first, ...rest] = tag.split('-');
  const language = first.toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return FALLBACK_LOCALE;

  const script = rest.find(part => /^[A-Za-z]{4}$/.test(part))?.toLowerCase();
  const region = rest.find(part => /^[A-Za-z]{2}$/.test(part))?.toUpperCase() ?? null;
  const rtl = script ? RTL_SCRIPTS.has(script) : RTL_LANGUAGES.has(language);

  return { tag, language, region, textDirection: rtl ? 'rtl' : 'ltr' };
}

/**
 * The first usable tag from a ranked preference list (navigator.languages, or
 * the device's ordered locales), so one junk entry can't knock the user back to
 * English when their second choice was fine.
 */
export function pickLocale(tags: readonly (string | null | undefined)[] | null | undefined): ParsedLocale {
  for (const tag of tags ?? []) {
    const parsed = parseLocaleTag(tag);
    if (parsed !== FALLBACK_LOCALE) return parsed;
  }
  return FALLBACK_LOCALE;
}
