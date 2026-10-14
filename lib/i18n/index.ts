// Hermes ships no Intl.PluralRules, and i18next needs it to pick between
// "1 point" and "2 points" (French also says "0 point"). The polyfill only
// installs itself where the engine lacks it, so web and Jest keep their own.
import 'intl-pluralrules';

import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { useSyncExternalStore } from 'react';
import { initReactI18next } from 'react-i18next';
import { AppState } from 'react-native';

import { getDeviceLocale } from '@/lib/locale';
import { APP_DRAFT_LANGUAGES, APP_LANGUAGES, formatLocaleFor, resolveLanguage } from '@/shared/i18n';
import { APP_I18N_OPTIONS } from '@/shared/i18n/app';

/**
 * The app's language — which catalog is on screen, and why.
 *
 * Members never have to choose: POWR follows the phone's language whenever it
 * speaks it (APP_LANGUAGES), and English otherwise. Settings › Language lets
 * someone override that — say an English phone whose owner reads French — and
 * the pick is remembered on the device.
 *
 * Translators see drafts through the translation preview (long-press the
 * version line in Settings). It only widens what the picker offers; members
 * without it can never land on an unfinished language, even on a phone set to
 * one.
 *
 * Keys are always written in full — t('settings:language.title') — so the
 * appI18n test can find every one in the source and prove it exists in English.
 * Never call t() at module level: it would freeze that string in whatever
 * language was on screen when the file loaded.
 *
 * Safe to import from headless tasks: everything below is synchronous except
 * reading the saved pick, and anything composing text on a wake should
 * `await languageReady` first so it doesn't use the phone's language over the
 * member's own choice.
 */

const PREFERENCE_KEY = 'powr:language';
const PREVIEW_KEY = 'powr:language:preview';

export type LanguageState = {
  /** The language on screen right now. */
  language: string;
  /** The member's own pick, or null to follow the phone. */
  preference: string | null;
  /** The phone's language, whether or not POWR speaks it. */
  deviceLanguage: string;
  /** Translation preview: drafts become selectable. */
  preview: boolean;
  /** What Settings › Language offers. */
  available: readonly string[];
};

function compute(preference: string | null, preview: boolean): LanguageState {
  const deviceLanguage = getDeviceLocale().language;
  const available = preview ? [...APP_LANGUAGES, ...APP_DRAFT_LANGUAGES] : APP_LANGUAGES;
  // A pick that's no longer on offer (a draft, after the preview was switched
  // off) is ignored but kept, so turning the preview back on restores it.
  const wanted = preference && available.includes(preference) ? preference : deviceLanguage;
  return { language: resolveLanguage(wanted, available), preference, deviceLanguage, preview, available };
}

let state = compute(null, false);
const listeners = new Set<() => void>();

function commit(next: LanguageState): void {
  const changed =
    next.language !== state.language ||
    next.preference !== state.preference ||
    next.deviceLanguage !== state.deviceLanguage ||
    next.preview !== state.preview;
  state = next;
  if (i18n.language !== next.language) void i18n.changeLanguage(next.language);
  if (changed) listeners.forEach(listener => listener());
}

// This module sits in the static import graph of the headless geofence tasks
// (via AuthContext), so loading it must never throw: a failure here would stop
// those tasks being defined. Worst case is untranslated keys, never a crash.
try {
  i18n.use(initReactI18next).init({ ...APP_I18N_OPTIONS, lng: state.language });
} catch (e) {
  console.warn('[i18n] init failed', e);
}

async function readSaved(): Promise<void> {
  try {
    const [[, preference], [, preview]] = await AsyncStorage.multiGet([PREFERENCE_KEY, PREVIEW_KEY]);
    commit(compute(preference || null, preview === '1'));
  } catch {
    // Storage unreadable: keep following the phone.
  }
}

/** Resolves once the member's saved pick (if any) is on screen. Never rejects. */
export const languageReady: Promise<void> = readSaved();

// Android keeps the app alive across a system language change (iOS restarts
// it), so the phone's language is re-read whenever the app comes back.
try {
  AppState.addEventListener('change', status => {
    if (status === 'active') commit(compute(state.preference, state.preview));
  });
} catch {
  // No AppState (an unusual headless runtime): the phone's language is read at launch only.
}

export function getLanguageState(): LanguageState {
  return state;
}

/** Re-renders when the language, the pick or the preview changes. */
export function useLanguageSettings(): LanguageState {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getLanguageState,
  );
}

/** Pick a language, or null to follow the phone again. */
export async function setLanguagePreference(language: string | null): Promise<void> {
  commit(compute(language, state.preview));
  try {
    if (language) await AsyncStorage.setItem(PREFERENCE_KEY, language);
    else await AsyncStorage.removeItem(PREFERENCE_KEY);
  } catch {
    // Applies for this session; the phone's language returns next launch.
  }
}

export async function setTranslationPreview(on: boolean): Promise<void> {
  commit(compute(state.preference, on));
  try {
    if (on) await AsyncStorage.setItem(PREVIEW_KEY, '1');
    else await AsyncStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Applies for this session only.
  }
}

/**
 * The language this person reads, for anything sent to them — their pick, or
 * the phone's language even when POWR can't show it yet. Pushes and emails
 * resolve it against what they can say; this records the wish.
 */
export function getPreferredLanguage(): string {
  return state.preference ?? state.deviceLanguage;
}

/** The BCP-47 tag Intl should format dates and numbers with right now. */
export function getFormatLocale(): string {
  return formatLocaleFor(state.language, getDeviceLocale().tag);
}

export default i18n;
