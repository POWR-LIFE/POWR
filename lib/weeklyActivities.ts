/**
 * Shared "smart-swap" for the weekly activity surfaces (home rings + progress
 * radials): if health data detected sessions for an activity outside the
 * user's 3 preferences, swap it in for the preference with the least weekly
 * progress so we always show exactly 3 — and both screens agree on which 3.
 * The displaced preference still earns points; it just loses its slot.
 */

import { ACTIVITIES, type ActivityType } from '@/constants/activities';

export const WEEKLY_SESSION_TARGET = 3;
export const WEEKLY_STEPS_TARGET = 50000;

type WeeklyMetricsLike = {
  totalSteps: number;
  perType: Record<string, number>;
};

/** Canonical weekly progress (0–2, >1 = overachieving) used to rank activities. */
export function weeklyRingPct(type: ActivityType, metrics: WeeklyMetricsLike): number {
  if (type === 'walking') return Math.min(metrics.totalSteps / WEEKLY_STEPS_TARGET, 2);
  return Math.min((metrics.perType[type] ?? 0) / WEEKLY_SESSION_TARGET, 2);
}

export function applyDetectedActivitySwap(
  prefs: ActivityType[],
  metrics: WeeklyMetricsLike,
): {
  /** prefs with the weakest entry replaced by the detected bonus (if any) */
  types: ActivityType[];
  /** activity detected outside the preferences, or null */
  bonusType: ActivityType | null;
  /** the preference the bonus displaced, or null */
  displacedType: ActivityType | null;
} {
  const bonusType = (Object.keys(metrics.perType) as ActivityType[])
    .filter(type =>
      !prefs.includes(type) &&
      (metrics.perType[type] ?? 0) > 0 &&
      // Sessions can carry types with no ring UI (e.g. sleep, which has its
      // own dedicated surface on both screens) — never swap those in.
      !!ACTIVITIES[type] && !ACTIVITIES[type].hideFromPicker,
    )
    .sort((a, b) => weeklyRingPct(b, metrics) - weeklyRingPct(a, metrics))[0] ?? null;

  if (!bonusType || prefs.length === 0) {
    return { types: prefs, bonusType: null, displacedType: null };
  }

  const displacedType = [...prefs].sort(
    (a, b) => weeklyRingPct(a, metrics) - weeklyRingPct(b, metrics),
  )[0];
  return {
    types: prefs.map(t => (t === displacedType ? bonusType : t)),
    bonusType,
    displacedType,
  };
}
