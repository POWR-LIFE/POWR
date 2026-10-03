import { useMemo } from 'react';
import { getLocales, useLocales, type Locale } from 'expo-localization';

/**
 * The member's language, read off the device — never asked for.
 *
 * expo-localization returns the languages the user has ranked in their OS
 * settings, most preferred first. The first entry is the one the phone itself
 * is running in, which is the best answer to "what language does this person
 * read" that we can get without an onboarding question.
 *
 * ⚠ NATIVE MODULE. expo-localization calls requireNativeModule at import time,
 * so a binary built without it throws the moment this file loads — before any
 * try/catch here can run. The fingerprint runtimeVersion (app.config.js) is
 * what keeps that from happening: adding the package moved the fingerprint, so
 * a bundle importing it can only ever be served to a binary that has it. Never
 * hand-port this file onto a pre-localization runtime.
 *
 * Every reader below always returns a value. A locale is a nice-to-have, and
 * nothing that renders text may ever break because the device was vague.
 */

/** What we read when the device gives us nothing usable. */
export const FALLBACK_LANGUAGE = 'en';

export type DeviceLocale = {
  /** Full BCP-47 tag as the device reports it ("en-GB", "zh-Hant-TW"). */
  tag: string;
  /** Lower-case ISO 639 language ("en", "es", "zh"). */
  language: string;
  /** Upper-case ISO 3166-1 region ("GB"), or null when the tag carries none. */
  region: string | null;
  textDirection: 'ltr' | 'rtl';
};

const FALLBACK_LOCALE: DeviceLocale = {
  tag: FALLBACK_LANGUAGE,
  language: FALLBACK_LANGUAGE,
  region: null,
  textDirection: 'ltr',
};

/**
 * Normalise one expo-localization entry. languageCode can be null (the web
 * build, odd private-use tags), so the tag's first subtag backs it up.
 */
function toDeviceLocale(locale: Locale | undefined): DeviceLocale {
  const tag = locale?.languageTag?.trim();
  if (!tag) return FALLBACK_LOCALE;

  const language = (locale?.languageCode ?? tag.split(/[-_]/)[0]).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return FALLBACK_LOCALE;

  const region = locale?.regionCode;
  return {
    tag,
    language,
    region: region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null,
    textDirection: locale?.textDirection === 'rtl' ? 'rtl' : 'ltr',
  };
}

/** The device's primary locale. Safe to call anywhere, including headless wakes. */
export function getDeviceLocale(): DeviceLocale {
  try {
    return toDeviceLocale(getLocales()[0]);
  } catch {
    return FALLBACK_LOCALE;
  }
}

/** Shorthand for the device's primary language ("en"). */
export function getDeviceLanguage(): string {
  return getDeviceLocale().language;
}

/**
 * The device's primary locale, re-rendering if the user changes their language
 * while the app is running. In practice that is Android only: iOS terminates
 * the app on a system language change, so it simply relaunches with the new one.
 */
export function useDeviceLocale(): DeviceLocale {
  const locales = useLocales();
  return useMemo(() => toDeviceLocale(locales[0]), [locales]);
}
