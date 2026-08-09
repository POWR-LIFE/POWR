// ---------------------------------------------------------------------------
// Background-chain health: the device grading itself, from the one context that
// can actually see the answer.
//
// THE PROBLEM. Every permission surface we ship asks "are the toggles right?"
// and reads them from the FOREGROUND. That question is the wrong one twice over:
//
//  1. The toggles can read fine while the chain is dead. Battery optimisation,
//     OEM power management and a destroyed fence registration are all invisible
//     to `getBackgroundPermissionsAsync()`. There is no API for any of them —
//     see lib/batteryOptimization.ts, which can only FIRE the intent and infer
//     success from an AppState proxy.
//  2. The foreground read is not even authoritative about itself. Prod, 2026-08-08:
//     `jpowr` wrote profiles.location_permission='always' at 08:26:39Z while that
//     same device's headless context wrote 168 sweep rows carrying
//     perm_bg:'denied', the most recent at 08:21:07Z — five minutes earlier.
//     `powrcto` alternates between 'denied' and 'undetermined' across its own rows.
//
// THE FIX. Stop inferring. The sweep in GeofenceContext already RUNS headless and
// already computes the verdict — it just logged it to the server and threw the
// local copy away. This module keeps that copy, so the foreground can read what
// the background actually found rather than re-asking a question it cannot answer.
//
// ⚠ THE CARDINAL RULE: fire on a RECORDED NEGATIVE OUTCOME, never on SILENCE.
// Silence is not evidence and grading it produces both error modes at once:
//   · False positives — a stationary iOS user with a perfect setup emits nothing
//     for days (measured inter-event gaps of 64h / 27h / 24h on live, healthy
//     accounts), and 20 of 22 active devices are iOS, where fence silence is the
//     documented norm (project_ios_region_crossings_never_deliver).
//   · False negatives — presence is not health either. The single most common
//     background event in production is `sweep{outcome:'no_permission'}` (486 rows
//     in 30 days): the wake ran, and then refused to do anything. A detector that
//     counted rows would score exactly the broken devices as healthy. Telemetry
//     silence has also meant the TELEMETRY died while the chain worked perfectly
//     (lib/gymVisits.ts — every log call timed out at 30s on a backgrounded
//     Android device that was checking in fine beside it).
// Grading the LAST OUTCOME sidesteps all of it: absence proves nothing, so we
// say nothing.
// ---------------------------------------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PermissionFixKind } from '@/components/PermissionFixScreen';

const KEY = '@powr/bg_health';

/** Terminal states of a headless sweep. Mirrors the `outcome` values already
 *  logged to geofence_region_events, so the local record and the server trail
 *  are the same vocabulary and can be reconciled row-for-row. */
export type BackgroundOutcome =
  | 'no_permission'   // ⚠ the wake RAN and then hard-returned: background location is not granted
  | 'session_active'  // a visit is open; the sweep deliberately no-ops
  | 'handoff'         // healthy: got a fix and handed off to the evaluator
  | 'no_fix'          // ran, but the OS location cache was stale (iOS baseline 'off')
  | 'exit_backstop'   // healthy: closed a visit the native exit missed
  | 'error';          // the sweep threw

export interface BackgroundHealth {
  /** Epoch ms the record was written — device clock, only ever compared to itself. */
  at: number;
  outcome: BackgroundOutcome;
  /** Raw permission string the HEADLESS context saw, when the outcome turned on it. */
  permBg?: string | null;
  /**
   * How many CONSECUTIVE sweeps have now ended this same way (1 = first).
   *
   * Exists because some states are only meaningful when they repeat. A single
   * `no_fix` is a stale OS cache and self-heals; three in a row across separate
   * wakes is a device that cannot get a location at all.
   */
  streak?: number;
}

/**
 * Consecutive `no_fix` sweeps before we call the chain broken.
 *
 * Three, because that is the smallest number that cannot be a coincidence of
 * cache staleness, and because iOS's provisional-Always window — the state this
 * exists to catch — produced FOUR in a row on 2026-08-09 before the user was
 * finally asked (10:26:00, 10:26:08, 10:32:04, 10:32:04), alongside an arm
 * carrying `lat: null, lng: null, sentinel_m: null`.
 */
export const NO_FIX_STREAK_BROKEN = 3;

/** Outcomes that prove the background chain is structurally unable to work.
 *
 *  Deliberately just the one. `no_fix` is a stale OS cache and self-heals;
 *  `error` is a transient throw; `session_active` is a correct no-op. Only
 *  `no_permission` is a state the USER can fix and that guarantees zero
 *  passive earning until they do. */
const BROKEN: ReadonlySet<BackgroundOutcome> = new Set<BackgroundOutcome>(['no_permission']);

/**
 * Every outcome `deriveSetupVerdict` can return a non-null verdict for.
 *
 * ⚠ THE ONLY GATE ANY CALLER MAY USE. useSetupHealth deliberately returns before
 * probing the permission API when there is nothing the probe could change, and
 * it used to spell that shortcut as `outcome !== 'no_permission'` — a copy of
 * BROKEN made when BROKEN was the only way in. The `no_fix` streak branch below
 * was then added ABOVE the BROKEN check (it has to fire THROUGH a granted probe),
 * so the hook filtered out every record that branch exists to catch and the whole
 * iOS provisional-Always case was unreachable in the app while its unit tests
 * passed. Gate on this set and the two cannot drift again.
 */
export const FIRES_ON: ReadonlySet<BackgroundOutcome> =
  new Set<BackgroundOutcome>([...BROKEN, 'no_fix']);

/**
 * Persist the outcome of a headless sweep. Never throws: this rides inside a
 * background task whose whole job is elsewhere, and a storage fault must never
 * break the sweep it is observing.
 *
 * ⚠ ONLY CALL THIS FROM A BRANCH THAT ACTUALLY READ THE PERMISSION.
 * The record is last-write-wins and 'no_permission' is the only state that
 * fires, so ANY later write silently retires the banner. Three of the sweep's
 * terminal branches return BEFORE its permission read (GeofenceContext's
 * `if (active)` block: exit_backstop, session_active, and an early throw) and
 * therefore know nothing about the permission — writing from them would erase
 * real evidence with a non-observation.
 *
 * That is not hypothetical. In `location_close_mode='observe'` (the live value)
 * a revoked-permission session is deliberately left OPEN, and a device without
 * the grant can never get the fix needed to close it — so every subsequent wake
 * would hit the `session_active` branch and rewrite it forever, permanently
 * blinding the feature on exactly the devices it exists to catch.
 *
 * Recovery does NOT depend on a later healthy write. `gym-visit-beacon` ships
 * with FLEET_INTERVAL_MIN = 0 ("fleet OFF; only FAST_USER_IDS are pinged"), so
 * for real users there is no periodic sweep to overwrite anything. A user who
 * fixes the permission is cleared by the live foreground probe in
 * deriveSetupVerdict instead — see backgroundGrantedNow.
 */
export async function recordBackgroundHealth(
  outcome: BackgroundOutcome,
  permBg?: string | null,
): Promise<void> {
  try {
    // Carry a consecutive count so repetition can be graded (see NO_FIX_STREAK_BROKEN).
    // A read on a background path, but AsyncStorage-local and already inside the
    // try/catch that guarantees this can never affect the sweep it observes.
    const previous = await readBackgroundHealth();
    const streak = previous?.outcome === outcome ? (previous.streak ?? 1) + 1 : 1;
    const record: BackgroundHealth = { at: Date.now(), outcome, permBg: permBg ?? null, streak };
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Observability only — never let it surface into the sweep's control flow.
  }
}

/** Last recorded headless verdict, or null when nothing has ever been written
 *  (a fresh install, or a build older than this module). Null is INCONCLUSIVE,
 *  never "healthy" and never "broken" — see the cardinal rule above. */
export async function readBackgroundHealth(): Promise<BackgroundHealth | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackgroundHealth>;
    if (typeof parsed?.at !== 'number' || typeof parsed?.outcome !== 'string') return null;
    return {
      at: parsed.at,
      outcome: parsed.outcome as BackgroundOutcome,
      permBg: parsed.permBg ?? null,
      // Records written before streaks existed count as their own first sighting.
      streak: typeof parsed.streak === 'number' && parsed.streak > 0 ? parsed.streak : 1,
    };
  } catch {
    return null;
  }
}

/** Drops the record so a resolved gap cannot re-fire before the next sweep
 *  writes a fresh one. Used the moment the user completes a fix. */
export async function clearBackgroundHealth(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}

// ── Dismissal ────────────────────────────────────────────────────────────────
// Same day-key shape as the health gap banner (lib/health/healthGaps.ts), and
// same reasoning: dismiss-for-the-day, not dismiss-forever. The permission-prime
// sheets cap at 3 dismissals EVER and then go permanently quiet — right for a
// modal that interrupts, wrong for an inline card that only appears while the
// user is provably losing every passive check-in. This one can keep asking
// because it only speaks when it has evidence, and it stops the moment the
// evidence does.

const DISMISS_KEY = '@powr/bg_health_dismissed';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export async function isBackgroundHealthDismissedToday(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DISMISS_KEY)) === todayKey();
  } catch {
    return false;
  }
}

export async function dismissBackgroundHealthToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISS_KEY, todayKey());
  } catch {
    /* non-fatal */
  }
}

export interface VerdictInput {
  /** Last headless record, or null if we have never observed one. */
  health: BackgroundHealth | null;
  /**
   * Live FOREGROUND read of background location, as a plain boolean.
   * Used ONLY to SUPPRESS — never to accuse. The two contexts demonstrably
   * disagree (see the header), and between a foreground read that says
   * "granted" and a headless one that says "denied", the safe action is to stay
   * quiet: a wrongly-silent banner costs one missed nudge, a wrongly-shown one
   * is exactly the nagware this surface was rejected for once already.
   */
  backgroundGrantedNow: boolean | null;
  /**
   * Live FOREGROUND read of FOREGROUND location. Selects WHICH fix to offer, and
   * nothing else — it can never cause or suppress a verdict.
   *
   * ⚠ Without it the banner offers a fix that cannot work. The sweep only ever
   * records `perm_bg`, so 'no_permission' covers two different users: one on
   * While Using who needs upgrading to Always, and one who granted nothing at
   * all. Sending the second to the background request is a dead end —
   * expo-location asks for ACCESS_BACKGROUND_LOCATION alone (LocationModule.kt),
   * and Android 11+ auto-denies that with no dialog when foreground is missing,
   * leaving PermissionFixScreen's Android branch with nothing to do. Measured on
   * both field devices, 2026-08-09, sitting at 'undetermined'.
   */
  foregroundGrantedNow?: boolean | null;
}

/**
 * The single decision this module exists to make: which fix screen, if any, does
 * the background chain's own evidence justify showing?
 *
 * Pure and total so the rules are testable without a device — every guard here
 * is a false-positive class the design brief named, and each returns null.
 */
export function deriveSetupVerdict({
  health,
  backgroundGrantedNow,
  foregroundGrantedNow,
}: VerdictInput): PermissionFixKind | null {
  // Never observed a sweep: a new install, an OTA that has not woken yet, or a
  // healthy iOS device that simply had no reason to run one. Inconclusive.
  if (!health) return null;

  // REPEATED no_fix: the chain ran, and ran, and ran, and never once obtained a
  // location. One is a stale cache; NO_FIX_STREAK_BROKEN in a row is a device that
  // cannot see where it is, which earns exactly as much as a revoked permission.
  //
  // ⚠ DELIBERATELY ABOVE THE backgroundGrantedNow SUPPRESSION, and that is the
  // whole point of this branch. Its headline case is iOS's provisional-Always
  // window, where `getBackgroundPermissionsAsync()` reports GRANTED while Apple
  // quietly withholds the grant until it asks the user later — measured at 24
  // minutes on 2026-08-09, during which the phone reported `always`, swept
  // `no_fix` four times, and armed 20 regions with a null position. Suppressing on
  // the probe would silence us precisely when the probe is the thing that is
  // wrong. Repetition is the evidence here, not the permission read.
  if (health.outcome === 'no_fix' && (health.streak ?? 1) >= NO_FIX_STREAK_BROKEN) {
    return 'location-background';
  }

  // The last thing the background actually did was fine (or was a deliberate
  // no-op). Nothing to report.
  if (!BROKEN.has(health.outcome)) return null;

  // The OS now says background location is granted. Either the user fixed it and
  // no sweep has run since, or the two contexts disagree. Both resolve to silence.
  if (backgroundGrantedNow === true) return null;

  // A headless context tried to do the work and was refused. This is the only
  // path that fires, and it is the highest-confidence signal available anywhere
  // in the app: not a permission we asked about, but a job that was actually
  // attempted and actually failed.
  //
  // Which rung of the ladder to offer is a separate question, decided here and
  // only on an EXPLICIT false: a failed read (null) leaves the verdict where the
  // background evidence put it, exactly as backgroundGrantedNow does above.
  // Asking for Always before While Using is refused by the OS, so a user holding
  // neither has to be sent one rung lower or the fix screen does nothing at all.
  if (foregroundGrantedNow === false) return 'location';

  return 'location-background';
}
