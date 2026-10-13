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

import enAccount from './en/app/account.json';
import enActivities from './en/app/activities.json';
import enAuth from './en/app/auth.json';
import enCommon from './en/app/common.json';
import enHealth from './en/app/health.json';
import enHelp from './en/app/help.json';
import enOnboarding from './en/app/onboarding.json';
import enPermissions from './en/app/permissions.json';
import enPoints from './en/app/points.json';
import enRewards from './en/app/rewards.json';
import enSettings from './en/app/settings.json';
import enSocial from './en/app/social.json';
import esAccount from './es/app/account.json';
import esActivities from './es/app/activities.json';
import esAuth from './es/app/auth.json';
import esCommon from './es/app/common.json';
import esHealth from './es/app/health.json';
import esHelp from './es/app/help.json';
import esOnboarding from './es/app/onboarding.json';
import esPermissions from './es/app/permissions.json';
import esPoints from './es/app/points.json';
import esRewards from './es/app/rewards.json';
import esSettings from './es/app/settings.json';
import esSocial from './es/app/social.json';
import frAccount from './fr/app/account.json';
import frActivities from './fr/app/activities.json';
import frAuth from './fr/app/auth.json';
import frCommon from './fr/app/common.json';
import frHealth from './fr/app/health.json';
import frHelp from './fr/app/help.json';
import frOnboarding from './fr/app/onboarding.json';
import frPermissions from './fr/app/permissions.json';
import frPoints from './fr/app/points.json';
import frRewards from './fr/app/rewards.json';
import frSettings from './fr/app/settings.json';
import frSocial from './fr/app/social.json';

export const APP_NAMESPACES = [
  'common',
  'settings',
  'auth',
  'permissions',
  'onboarding',
  'health',
  'activities',
  'account',
  'help',
  'social',
  'rewards',
  'points',
] as const;
export type AppNamespace = (typeof APP_NAMESPACES)[number];

export const APP_RESOURCES = {
  en: {
    common: enCommon,
    settings: enSettings,
    auth: enAuth,
    permissions: enPermissions,
    onboarding: enOnboarding,
    health: enHealth,
    activities: enActivities,
    account: enAccount,
    help: enHelp,
    social: enSocial,
    rewards: enRewards,
    points: enPoints,
  },
  fr: {
    common: frCommon,
    settings: frSettings,
    auth: frAuth,
    permissions: frPermissions,
    onboarding: frOnboarding,
    health: frHealth,
    activities: frActivities,
    account: frAccount,
    help: frHelp,
    social: frSocial,
    rewards: frRewards,
    points: frPoints,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    auth: esAuth,
    permissions: esPermissions,
    onboarding: esOnboarding,
    health: esHealth,
    activities: esActivities,
    account: esAccount,
    help: esHelp,
    social: esSocial,
    rewards: esRewards,
    points: esPoints,
  },
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
