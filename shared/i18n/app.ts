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

import enCommon from './en/app/common.json';
import enSettings from './en/app/settings.json';
import esCommon from './es/app/common.json';
import esSettings from './es/app/settings.json';
import frCommon from './fr/app/common.json';
import frSettings from './fr/app/settings.json';

export const APP_NAMESPACES = ['common', 'settings'] as const;
export type AppNamespace = (typeof APP_NAMESPACES)[number];

export const APP_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
  fr: { common: frCommon, settings: frSettings },
  es: { common: esCommon, settings: esSettings },
} satisfies Record<string, Partial<Record<AppNamespace, object>>>;
