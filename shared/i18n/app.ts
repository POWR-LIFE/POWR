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
import enAffiliate from './en/app/affiliate.json';
import enAuth from './en/app/auth.json';
import enChallenges from './en/app/challenges.json';
import enCommon from './en/app/common.json';
import enDiscover from './en/app/discover.json';
import enEvents from './en/app/events.json';
import enHealth from './en/app/health.json';
import enHelp from './en/app/help.json';
import enHome from './en/app/home.json';
import enInStore from './en/app/inStore.json';
import enNotifications from './en/app/notifications.json';
import enNudges from './en/app/nudges.json';
import enOnboarding from './en/app/onboarding.json';
import enPermissions from './en/app/permissions.json';
import enPoints from './en/app/points.json';
import enProgress from './en/app/progress.json';
import enRewards from './en/app/rewards.json';
import enSeries from './en/app/series.json';
import enSettings from './en/app/settings.json';
import enShare from './en/app/share.json';
import enSocial from './en/app/social.json';
import enSystem from './en/app/system.json';
import esAccount from './es/app/account.json';
import esActivities from './es/app/activities.json';
import esAffiliate from './es/app/affiliate.json';
import esAuth from './es/app/auth.json';
import esChallenges from './es/app/challenges.json';
import esCommon from './es/app/common.json';
import esDiscover from './es/app/discover.json';
import esEvents from './es/app/events.json';
import esHealth from './es/app/health.json';
import esHelp from './es/app/help.json';
import esHome from './es/app/home.json';
import esInStore from './es/app/inStore.json';
import esNotifications from './es/app/notifications.json';
import esNudges from './es/app/nudges.json';
import esOnboarding from './es/app/onboarding.json';
import esPermissions from './es/app/permissions.json';
import esPoints from './es/app/points.json';
import esProgress from './es/app/progress.json';
import esRewards from './es/app/rewards.json';
import esSeries from './es/app/series.json';
import esSettings from './es/app/settings.json';
import esShare from './es/app/share.json';
import esSocial from './es/app/social.json';
import esSystem from './es/app/system.json';
import frAccount from './fr/app/account.json';
import frActivities from './fr/app/activities.json';
import frAffiliate from './fr/app/affiliate.json';
import frAuth from './fr/app/auth.json';
import frChallenges from './fr/app/challenges.json';
import frCommon from './fr/app/common.json';
import frDiscover from './fr/app/discover.json';
import frEvents from './fr/app/events.json';
import frHealth from './fr/app/health.json';
import frHelp from './fr/app/help.json';
import frHome from './fr/app/home.json';
import frInStore from './fr/app/inStore.json';
import frNotifications from './fr/app/notifications.json';
import frNudges from './fr/app/nudges.json';
import frOnboarding from './fr/app/onboarding.json';
import frPermissions from './fr/app/permissions.json';
import frPoints from './fr/app/points.json';
import frProgress from './fr/app/progress.json';
import frRewards from './fr/app/rewards.json';
import frSeries from './fr/app/series.json';
import frSettings from './fr/app/settings.json';
import frShare from './fr/app/share.json';
import frSocial from './fr/app/social.json';
import frSystem from './fr/app/system.json';

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
  'home',
  'nudges',
  'progress',
  'events',
  'discover',
  'system',
  'share',
  'affiliate',
  'notifications',
  'inStore',
  'challenges',
  'series',
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
    home: enHome,
    nudges: enNudges,
    progress: enProgress,
    events: enEvents,
    discover: enDiscover,
    system: enSystem,
    share: enShare,
    affiliate: enAffiliate,
    notifications: enNotifications,
    inStore: enInStore,
    challenges: enChallenges,
    series: enSeries,
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
    home: frHome,
    nudges: frNudges,
    progress: frProgress,
    events: frEvents,
    discover: frDiscover,
    system: frSystem,
    share: frShare,
    affiliate: frAffiliate,
    notifications: frNotifications,
    inStore: frInStore,
    challenges: frChallenges,
    series: frSeries,
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
    home: esHome,
    nudges: esNudges,
    progress: esProgress,
    events: esEvents,
    discover: esDiscover,
    system: esSystem,
    share: esShare,
    affiliate: esAffiliate,
    notifications: esNotifications,
    inStore: esInStore,
    challenges: esChallenges,
    series: esSeries,
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
