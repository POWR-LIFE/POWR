// Pure, dependency-free eligibility rule for the location_permission_lost
// push. NO Deno or React Native APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/locationRegression.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/locationRegression'
//
// WHY THIS EXISTS. always → denied/while_using regressions are recorded
// server-side (location_permission_regressions, 2026-08-09) but until now had
// no consumer that could REACH the user: every in-app recovery surface
// (SetupHealthBanner, LocationPrimeSheet, Discover's fix screen) requires
// opening the app, and this cohort has stopped opening it. Field 2026-08-15: a
// user lost 'always' mid-visit and produced zero gym visits in the five days
// after — with a live push token the whole time. The push exists to get them
// to OPEN the app; the Home surfaces own the actual fix from there.
//
// See project_geofence_realuser_review_20260820.

/** How long a regression must stand before we push about it. Permission state
 *  FLAPS — field-test accounts record always→denied and back several times a
 *  day, and iOS can report transient wrong levels — so a regression only
 *  counts once it has survived a full day with the profile still regressed.
 *  The failure this feature fixes is measured in weeks of silence, not hours. */
export const REGRESSION_GRACE_MS = 24 * 60 * 60 * 1000;

/** User-local send window, inclusive. A setup notice, not an alarm — landing
 *  at 03:00 reads as broken. */
export const NOTICE_HOUR_START = 10;
export const NOTICE_HOUR_END = 20;

export interface RegressionNoticeInputs {
  /** The level the user regressed TO ('denied' | 'while_using'). */
  regressionLevel: string;
  /** When the regression was recorded (ms epoch). */
  regressionAtMs: number;
  /** profiles.location_permission right now. */
  currentLevel: string | null;
  /** Newest push_send_log row for this type, ANY status (ms epoch), or null.
   *  A skipped attempt counts: no_tokens means unreachable (a new token
   *  requires opening the app, where the banner takes over), and
   *  user_preference means muted — neither deserves a 15-minute retry loop. */
  lastAttemptAtMs: number | null;
  /** 0–23 in the user's own timezone. */
  localHour: number;
  nowMs: number;
}

/** One push per regression, ever — inside the grace + daytime window, and only
 *  while the loss is still true. */
export function shouldSendRegressionNotice(i: RegressionNoticeInputs): boolean {
  // Self-healed (or partially changed — a denied→while_using move has its own
  // in-app surface): only push while the recorded loss still describes the
  // profile. Also drops rows whose profile read failed (currentLevel null).
  if (i.currentLevel !== i.regressionLevel) return false;
  if (i.regressionLevel !== 'denied' && i.regressionLevel !== 'while_using') return false;

  if (!Number.isFinite(i.regressionAtMs)) return false;
  if (i.nowMs - i.regressionAtMs < REGRESSION_GRACE_MS) return false;

  // Any attempt since this regression — sent or skipped — closes it forever.
  // A NEW regression (re-grant then lose again) postdates the old attempt and
  // re-arms naturally.
  if (i.lastAttemptAtMs != null && i.lastAttemptAtMs >= i.regressionAtMs) return false;

  return i.localHour >= NOTICE_HOUR_START && i.localHour <= NOTICE_HOUR_END;
}
