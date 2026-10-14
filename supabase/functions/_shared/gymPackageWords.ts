// What each Gym Clash package unlocks, in the words the gym emails use. The
// rule itself is SQL (_gym_features: level 0 Clash, 1 Clash+, 2 Clash Pro /
// Founding Pro and the free trial); this file mirrors its keys so an email
// can say what a gym keeps, gains or loses. The portal's own copy is
// landing-page/src/pages/venue/packages.jsx. The words live in the gym email
// catalog (_shared/i18n/gym/<lang>.ts, features.*): featureWords() and
// alwaysOn() read them in a language, FEATURE_WORDS and ALWAYS_ON are the
// English. Deno and jest both take it (__tests__/gym-account-email.test.ts).

import { tBusiness } from './i18n/index.ts';

export type GymPackage = 'clash' | 'clash_plus' | 'pro' | 'founding';
export type GymFeature = 'events' | 'insights' | 'people' | 'studio';

export const PACKAGE_LABEL: Record<GymPackage, string> = {
  clash: 'Clash',
  clash_plus: 'Clash+',
  pro: 'Clash Pro',
  founding: 'Founding Pro',
};

/** _gym_package_level(): the trial counts as level 2. */
export function packageLevel(pkg: string | null | undefined): number {
  return pkg === 'clash_plus' ? 1 : pkg === 'pro' || pkg === 'founding' ? 2 : 0;
}

export function packageLabel(pkg: string | null | undefined): string {
  return PACKAGE_LABEL[(pkg ?? 'clash') as GymPackage] ?? 'Clash';
}

// _gym_features(): the level each gated part needs. 'boards' (the board, the
// TV screens, Gym Clash, the live ranking) is on for every package.
const NEEDS: Record<GymFeature, number> = { events: 1, insights: 1, people: 2, studio: 2 };
const ORDER: GymFeature[] = ['events', 'insights', 'people', 'studio'];

/** A feature's name and one-line description, in `lang`. */
export function featureWords(feature: GymFeature, lang = 'en'): { name: string; line: string } {
  switch (feature) {
    case 'events':
      return { name: tBusiness(lang, 'gym.features.events.name'), line: tBusiness(lang, 'gym.features.events.line') };
    case 'insights':
      return { name: tBusiness(lang, 'gym.features.insights.name'), line: tBusiness(lang, 'gym.features.insights.line') };
    case 'people':
      return { name: tBusiness(lang, 'gym.features.people.name'), line: tBusiness(lang, 'gym.features.people.line') };
    case 'studio':
      return { name: tBusiness(lang, 'gym.features.studio.name'), line: tBusiness(lang, 'gym.features.studio.line') };
  }
}

/** What the free board package always keeps, whatever else switches off, in `lang`. */
export function alwaysOn(lang = 'en'): string {
  return tBusiness(lang, 'gym.features.alwaysOn');
}

/** The English words, as before. */
export const FEATURE_WORDS: Record<GymFeature, { name: string; line: string }> = {
  events: featureWords('events'),
  insights: featureWords('insights'),
  people: featureWords('people'),
  studio: featureWords('studio'),
};

/** What the free board package always keeps, in English. */
export const ALWAYS_ON = alwaysOn();

/** Features on at `level`, in the order the emails list them. */
export function featuresAt(level: number): GymFeature[] {
  return ORDER.filter((f) => level >= NEEDS[f]);
}

/** On at `from`, off at `to`. */
export function featuresLost(from: number, to: number): GymFeature[] {
  return ORDER.filter((f) => from >= NEEDS[f] && to < NEEDS[f]);
}

/** Keeps the SQL order and drops keys this file doesn't know. */
export function knownFeatures(keys: readonly string[] | null | undefined): GymFeature[] {
  const set = new Set(keys ?? []);
  return ORDER.filter((f) => set.has(f));
}
