/**
 * Which languages each surface may actually show, and how a detected language
 * resolves to one of them. Catalogs live beside this file
 * (shared/i18n/<language>/app/<namespace>.json) so every surface is translated
 * from one place. See README.md here for how to add a string or a language.
 *
 * ⚠ A language joins a surface's list only when BOTH hold — a half-translated
 * app is worse than English throughout:
 *   1. every screen of that surface renders through keys, and
 *   2. its catalog covers every English key, reviewed by a native speaker.
 * __tests__/appI18n.test.ts fails if a switched-on language misses a key, or a
 * draft is switched on.
 */

import { FALLBACK_LANGUAGE } from '../locale';

/** Languages members see in the app. */
export const APP_LANGUAGES: readonly string[] = ['en', 'fr', 'es'];

/**
 * Languages with a catalog that only translators see — via the translation
 * preview (long-press the version line at the bottom of Settings) — until
 * they're complete and move up to APP_LANGUAGES.
 */
export const APP_DRAFT_LANGUAGES: readonly string[] = [];

/**
 * Each language in its own words. A picker always lists a language the way its
 * speakers write it, so someone who can't read the current UI can still find
 * their own.
 */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
};

/**
 * The region a language formats dates and numbers for when the device's own
 * locale is in a different language. English stays en-GB because that is what
 * every hard-coded format in the app already produces.
 */
const DEFAULT_FORMAT_LOCALE: Readonly<Record<string, string>> = {
  en: 'en-GB',
  fr: 'fr-FR',
  es: 'es-ES',
};

/** The language to render for someone who prefers `preferred`. */
export function resolveLanguage(preferred: string | null | undefined, supported: readonly string[]): string {
  return preferred && supported.includes(preferred) ? preferred : FALLBACK_LANGUAGE;
}

/**
 * The BCP-47 tag to hand Intl for dates and numbers while `language` is on
 * screen. A French phone set to fr-CA formats like Canada; an English phone
 * previewing French formats like France. English is always en-GB, so moving a
 * hard-coded 'en-GB' onto this never changes what English readers see.
 */
export function formatLocaleFor(language: string, deviceTag: string | null | undefined): string {
  if (language === FALLBACK_LANGUAGE) return DEFAULT_FORMAT_LOCALE.en;
  const tag = deviceTag?.trim().replace(/_/g, '-');
  if (tag && tag.split('-')[0].toLowerCase() === language) return tag;
  return DEFAULT_FORMAT_LOCALE[language] ?? language;
}
