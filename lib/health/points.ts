/**
 * Client mirror of the POWR scoring ladder for health-synced activity.
 *
 * ONE table, shared by every client path that prices a native-health session:
 * the live sync (hooks/useHealthSync) and the 7-day history backfill
 * (lib/api/onboardingSync). Until 2026-08-30 the backfill had no scorer at all
 * — it wrote 0-point rows by design — and the live sync kept these functions
 * private, so there was nothing for a second caller to share. Keeping them
 * here, with no React or Supabase imports, is what lets both paths agree
 * without a dependency cycle through lib/api/activity.
 *
 * Mirrors supabase/functions/_shared/points.ts (Terra webhook) and the
 * per-session bound in enforce_point_award_cap; change all three together.
 */

import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { getGymDwellMinutes, getGymUpgradeMinutes } from '@/lib/gymDwellConfig';

/** HIIT's fixed entry gate — the strength lane's lower floor. Mirrors
 *  HIIT_MIN_MINUTES in supabase/functions/_shared/points.ts. */
export const HIIT_MIN_MINUTES = 20;

/**
 * Buckets a provider's workout name into a POWR activity type. Returns null
 * for anything we don't score as a workout — including walks and hikes, which
 * are paid as a daily step tier by the walking sync, never as a session.
 */
export function mapHealthType(name: string): ActivityType | null {
  const n = name.toLowerCase();
  // Running (includes treadmill, jogging)
  if (n.includes('run') || n.includes('jog')) return 'running';
  // Cycling (includes stationary biking, spin)
  if (n.includes('cycl') || n.includes('biking') || n.includes('spin')) return 'cycling';
  // Swimming
  if (n.includes('swim')) return 'swimming';
  // Dance (check before sports to avoid false matches)
  if (n.includes('dance') || n.includes('barre')) return 'dance';
  // Gym / weight training / cardio machines
  if (n.includes('gym') || n.includes('weight') || n.includes('crossfit') || n.includes('calisthenics')
      || n.includes('strength') || n.includes('powerlift') || n.includes('functional fitness')
      || n.includes('bodybuilding') || n.includes('elliptical') || n.includes('rowing')
      || n.includes('stair') || n.includes('core')) return 'gym';
  // HIIT / boot camp / circuit
  if (n.includes('hiit') || n.includes('boot_camp') || n.includes('bootcamp')
      || n.includes('circuit') || n.includes('tabata') || n.includes('f45')) return 'hiit';
  // Yoga / pilates
  if (n.includes('yoga') || n.includes('pilates')) return 'yoga';
  // Sports (ball sports, combat, racquet, etc.)
  if (n.includes('sport') || n.includes('tennis') || n.includes('soccer') || n.includes('basketball')
      || n.includes('handball') || n.includes('volleyball') || n.includes('squash') || n.includes('racquetball')
      || n.includes('fencing') || n.includes('martial') || n.includes('boxing') || n.includes('jiu jitsu')
      || n.includes('kickbox') || n.includes('rugby') || n.includes('football') || n.includes('baseball')
      || n.includes('softball') || n.includes('hockey') || n.includes('cricket') || n.includes('lacrosse')
      || n.includes('golf') || n.includes('pickleball') || n.includes('badminton') || n.includes('table tennis')
      || n.includes('wrestl') || n.includes('surf') || n.includes('climbing') || n.includes('ski')
      || n.includes('snowboard') || n.includes('skat') || n.includes('paddl') || n.includes('gymnastics')) return 'sports';
  // Walking / hiking — handled by walkingSync, not activity sync
  if (n.includes('walk') || n.includes('hik')) return null;
  return null;
}

export function calculateBasePoints(
  type: ActivityType, durationMin: number, distanceM: number | null = null,
): number {
  // Strength lane (gym + hiit): the same 15/20 tiers a geofence check-in pays,
  // off the admin-tunable thresholds — a wearable-tracked session is worth what
  // the same session is worth anywhere else. Mirrors _shared/points.ts, which
  // the Terra webhook uses for the identical calculation server-side.
  if (type === 'gym' || type === 'hiit') {
    const entryMin = type === 'hiit' ? HIIT_MIN_MINUTES : getGymDwellMinutes();
    const upgradeMin = getGymUpgradeMinutes();
    if (durationMin >= upgradeMin && durationMin >= entryMin) return 20;
    if (durationMin >= entryMin) return 15;
    return 0;
  }

  // Cardio scores on the distance/duration ladder, NOT a flat per-session rate.
  // It used to be flat (any run ≥ 15 min paid 10), which was invisible only
  // because the daily cap was also 10. Caps came off on 2026-08-07, so a flat
  // rate would now pay three short jogs more than one long run — see the same
  // ladder and the reasoning in _shared/points.ts.
  const mins = Math.floor(durationMin);
  const dist = distanceM ?? 0;

  switch (type) {
    case 'running':
      if (dist >= 10000 || mins >= 60) return 10;
      if (dist >= 5000  || mins >= 30) return 8;
      if (dist >= 3000  || mins >= 20) return 6;
      if (dist >= 2000  || mins >= 15) return 5;
      return 0;

    case 'cycling':
      if (dist >= 50000 || mins >= 90) return 10;
      if (dist >= 25000 || mins >= 60) return 8;
      if (dist >= 12000 || mins >= 30) return 6;
      if (dist >= 6000  || mins >= 20) return 4;
      return 0;

    case 'swimming':
      if (dist >= 2000 || mins >= 60) return 10;
      if (mins >= 40) return 9;
      if (dist >= 1000 || mins >= 20) return 7;
      if (dist >= 500  || mins >= 15) return 5;
      return 0;

    case 'sports':
      if (mins >= 90) return 10;
      if (mins >= 60) return 8;
      if (mins >= 30) return 6;
      return 0;

    case 'yoga':
      if (mins >= 60) return 6;
      if (mins >= 45) return 5;
      if (mins >= 30) return 4;
      if (mins >= 20) return 3;
      return 0;

    case 'dance':
      if (mins >= 60) return 8;
      if (mins >= 45) return 7;
      if (mins >= 30) return 6;
      if (mins >= 20) return 5;
      return 0;

    default: {
      const config = ACTIVITIES[type];
      if (durationMin < config.minDuration) return 0;
      return 5;
    }
  }
}

export function calculateSleepPoints(hours: number, deepHours?: number, remHours?: number): number {
  let base = 0;
  if (hours >= 8) base = 5;
  else if (hours >= 7) base = 4;
  else if (hours >= 6) base = 3;
  else if (hours >= 5) base = 2;
  else if (hours >= 3) base = 1; // reward anything 3h+ rather than cutting off at 4h

  if (base === 0) return 0;

  // Scale by restorative sleep ratio when stage data is available
  if (deepHours !== undefined && remHours !== undefined) {
    const restorativeRatio = (deepHours + remHours) / hours;
    const multiplier =
      restorativeRatio >= 0.35 ? 1.0 :
      restorativeRatio >= 0.25 ? 0.85 :
      restorativeRatio >= 0.15 ? 0.70 :
      0.60;
    return Math.max(1, Math.round(base * multiplier));
  }

  return base;
}
