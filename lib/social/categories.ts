/**
 * Challenge category presentation — the label and glyph a category wears
 * wherever it appears. Extracted from useSharedChallenges so the open board
 * renders a category exactly as Home does; two copies would drift the first
 * time a category is added.
 */
import i18n from '@/lib/i18n';

import type { IconSpec } from './types';

// The single-activity categories wear the activity's own name, so a challenge
// chip and the rest of the app always agree in every language.
const CATEGORY_LABEL_KEY: Record<string, string> = {
  gym: 'activities:names.gym',
  walking: 'activities:names.walking',
  running: 'activities:names.running',
  cycling: 'activities:names.cycling',
  multi: 'social:category.all',
};

/** Read at render time, so each label is in the language on screen. */
export const CATEGORY_LABEL: Record<string, string> = Object.defineProperties(
  {},
  Object.fromEntries(
    Object.entries(CATEGORY_LABEL_KEY).map(([category, key]) => [
      category,
      { get: () => i18n.t(key), enumerable: true },
    ]),
  ),
);

export const CATEGORY_ICON: Record<string, IconSpec> = {
  gym: { lib: 'ion', name: 'barbell' },
  walking: { lib: 'ion', name: 'walk' },
  running: { lib: 'mc', name: 'run' },
  cycling: { lib: 'mc', name: 'bike' },
  multi: { lib: 'ion', name: 'flame' },
};
