// What each Gym Clash package unlocks, in the words the gym emails use. The
// rule itself is SQL (_gym_features: level 0 Clash, 1 Clash+, 2 Clash Pro /
// Founding Pro and the free trial); this file mirrors its keys so an email
// can say what a gym keeps, gains or loses. The portal's own copy is
// landing-page/src/pages/venue/packages.jsx. Pure, no imports: Deno and jest
// both take it (__tests__/gym-account-email.test.ts).

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

export const FEATURE_WORDS: Record<GymFeature, { name: string; line: string }> = {
  events: {
    name: 'Your own challenges',
    line: 'Monthly challenges, sprints and finale nights, plus partner discounts for buying prizes',
  },
  insights: {
    name: 'Members and Retention',
    line: 'What your members do, when they come in, and how many are slipping from their usual visits',
  },
  people: {
    name: 'Retention by name',
    line: 'Who’s drifting, the morning email when someone starts, and the one-tap nudge',
  },
  studio: {
    name: 'Studio and event kits',
    line: 'Your photos and clips turned into posts, reels and posters at every size',
  },
};

/** What the free board package always keeps, whatever else switches off. */
export const ALWAYS_ON = 'Your board on the TV, Gym Clash against the gyms near you, and your live ranking';

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
