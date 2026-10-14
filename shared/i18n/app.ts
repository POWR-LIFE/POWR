/**
 * Every app catalog, by language and namespace. Metro can only bundle static
 * imports, so a new namespace means one import per language here — the
 * appI18n test fails if a JSON file under shared/i18n/<lang>/app/ is missing
 * from this map, so one can't be forgotten.
 *
 * A draft may lack a namespace (or keys inside one): i18next falls back to
 * English for anything missing, and APP_LANGUAGES is what keeps a draft away
 * from members until it's complete.
 */

import enAuth from './en/app/auth.json';
import enCommon from './en/app/common.json';
import enHealth from './en/app/health.json';
import enOnboarding from './en/app/onboarding.json';
import enPermissions from './en/app/permissions.json';
import enSettings from './en/app/settings.json';
import esAuth from './es/app/auth.json';
import esCommon from './es/app/common.json';
import esHealth from './es/app/health.json';
import esOnboarding from './es/app/onboarding.json';
import esPermissions from './es/app/permissions.json';
import esSettings from './es/app/settings.json';
import frAuth from './fr/app/auth.json';
import frCommon from './fr/app/common.json';
import frHealth from './fr/app/health.json';
import frOnboarding from './fr/app/onboarding.json';
import frPermissions from './fr/app/permissions.json';
import frSettings from './fr/app/settings.json';

export const APP_NAMESPACES = ['common', 'settings', 'auth', 'permissions', 'onboarding', 'health'] as const;
export type AppNamespace = (typeof APP_NAMESPACES)[number];

export const APP_RESOURCES = {
  en: { common: enCommon, settings: enSettings, auth: enAuth, permissions: enPermissions, onboarding: enOnboarding, health: enHealth },
  fr: { common: frCommon, settings: frSettings, auth: frAuth, permissions: frPermissions, onboarding: frOnboarding, health: frHealth },
  es: { common: esCommon, settings: esSettings, auth: esAuth, permissions: esPermissions, onboarding: esOnboarding, health: esHealth },
} satisfies Record<string, Partial<Record<AppNamespace, object>>>;

/**
 * i18next options shared by lib/i18n (the app) and jest.setup.js (tests), so a
 * component renders the same text under test as on a phone. The language is
 * the caller's: lib/i18n resolves it, tests use English.
 */
export const APP_I18N_OPTIONS = {
  resources: APP_RESOURCES,
  fallbackLng: 'en',
  ns: [...APP_NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React Native renders text, not HTML
  // A draft's untranslated "" reads as English, never as a blank label.
  returnEmptyString: false,
  initAsync: false, // resources are bundled, so the first render already has them
  react: { useSuspense: false },
} as const;
