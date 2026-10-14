// The words for the gym portal Overview's pure helpers (shared/gymWeek.ts,
// shared/gymMoves.ts). They take a translator: the portal hands in its own
// i18next t(), so the reader's language wins; anyone else (jest, a caller
// outside the portal) gets englishT, which reads the same English catalog
// i18next does, by the same rules: 'venueHome:a.b' keys, {{placeholders}},
// _one / _other picked by `count`. So the English can't drift from the portal's.

import venueHome from './i18n/en/portal/venueHome.json';

export type Translate = (key: string, values?: Record<string, unknown>) => string;

const CATALOGS: Record<string, unknown> = { venueHome };
const PLURALS = new Intl.PluralRules('en');

function lookup(ns: string, path: string): string | undefined {
  let node: unknown = CATALOGS[ns];
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** i18next's t() over the English venueHome catalog, for callers without one. */
export const englishT: Translate = (key, values = {}) => {
  const at = key.indexOf(':');
  const ns = key.slice(0, at);
  const path = key.slice(at + 1);
  const count = values.count;
  const text = (typeof count === 'number' ? lookup(ns, `${path}_${PLURALS.select(count)}`) : undefined) ?? lookup(ns, path) ?? key;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => (values[name] == null ? '' : String(values[name])));
};

/** Monday first: the weekday ids the catalog's days.* use. */
export const DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** "2nd", "2e", "2.º": the reader's ordinal, by their language's own ordinal rules. */
export function ordinalIn(t: Translate, locale: string, n: number): string {
  return t(`venueHome:ordinal.${new Intl.PluralRules(locale, { type: 'ordinal' }).select(n)}`, { n });
}
