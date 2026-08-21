/**
 * Challenge category presentation — the label and glyph a category wears
 * wherever it appears. Extracted from useSharedChallenges so the open board
 * renders a category exactly as Home does; two copies would drift the first
 * time a category is added.
 */
import type { IconSpec } from './types';

export const CATEGORY_LABEL: Record<string, string> = {
  gym: 'Gym', walking: 'Walking', running: 'Running', cycling: 'Cycling', multi: 'All',
};

export const CATEGORY_ICON: Record<string, IconSpec> = {
  gym: { lib: 'ion', name: 'barbell' },
  walking: { lib: 'ion', name: 'walk' },
  running: { lib: 'mc', name: 'run' },
  cycling: { lib: 'mc', name: 'bike' },
  multi: { lib: 'ion', name: 'flame' },
};
