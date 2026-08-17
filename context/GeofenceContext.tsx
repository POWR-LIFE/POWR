import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { ensureFreshSession } from '@/lib/authFresh';
import { recordBackgroundHealth } from '@/lib/backgroundHealth';
import { bgInsert, bgRpc, bgSelect, bgUpdate, readBackgroundAuth } from '@/lib/backgroundRest';
import { noteTask } from '@/lib/crashHandler';
import { detectLocationLoss, type LocationLossReason } from '@/lib/locationPermission';
import { withNetworkTimeout } from '@/lib/networkTimeout';
// Type-only: erased at compile time, so it does NOT pull lib/notifications into a
// headless context. The value import stays dynamic, below, for that reason.
import type { CheckInNotifyResult } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { getGymDwellMinutes, getGymUpgradeMinutes, getLocationCloseMode, primeGymDwellMinutes } from '@/lib/gymDwellConfig';

// ─── Session-completed event bus ─────────────────────────────────────────────
// Fires synchronously in the JS thread when a foreground claim succeeds.
// Allows any hook (e.g. usePoints) to refresh without polling AsyncStorage.

type SessionCompletedListener = () => void;
const _sessionCompletedListeners = new Set<SessionCompletedListener>();

export function onSessionCompleted(listener: SessionCompletedListener): () => void {
  _sessionCompletedListeners.add(listener);
  return () => _sessionCompletedListeners.delete(listener);
}

function _emitSessionCompleted() {
  _sessionCompletedListeners.forEach(l => l());
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
  open: string;   // "HH:MM"
  close: string;  // "HH:MM"
}

export type OpeningHours = Partial<Record<DayKey, DayHours | null>>;

export interface Partner {
  id: string;    // composite UI key: "${dbId}-${locationIndex}"
  dbId: string;  // raw Supabase UUID — use this for all DB operations
  name: string;
  description?: string;
  category: string;
  status: string;
  address: string;
  area: string;
  pts: number;
  distance: string;
  logoText: string;
  logoUrl?: string;
  logoBg: 'dark' | 'black' | 'white';
  logoLight: boolean;
  image1Url?: string;
  image2Url?: string;
  lat: number;
  lng: number;
  geofenceRadius: number;
  openingHours?: OpeningHours;
  isOpenNow: boolean;
}

export interface Trainer {
  id: string;
  partner_id: string;
  name: string;
  photo_url: string | null;
  bio: string | null;
  specialties: string[] | null;
  experience: string | null;
  profile_url: string | null;
  booking_url: string | null;
  active: boolean;
  sort_order: number;
}

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function checkIsOpenNow(openingHours?: OpeningHours): boolean {
  if (!openingHours) return true; // no hours set → assume open
  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  const hours = openingHours[dayKey];
  if (!hours) return false; // explicitly closed today
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const openMins  = oh * 60 + om;
  // Treat 00:00 close as end-of-day (1440) so "open until midnight" works correctly
  const closeMins = (ch === 0 && cm === 0) ? 1440 : ch * 60 + cm;
  return nowMins >= openMins && nowMins < closeMins;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GEOFENCE_TASK_NAME     = 'GEOFENCE_CHECK_IN';
const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';   // foreground-service location stream
const GEOFENCE_REARM_TASK    = 'POWR_GEOFENCE_BOOT_REARM'; // re-arms monitoring after reboot
export const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence'; // also read by lib/otaUpdates.ts to defer restarts mid-visit
const PARTNER_MAP_KEY        = '@powr/partner_map';
const PARTNER_MAP_META_KEY   = '@powr/partner_map_meta';   // { fetchedAt, v } — fetchedAt bump invalidates the in-context parse memo
const ARM_META_KEY           = '@powr/geofence_arm_meta';  // centre + sentinel radius of the currently armed region set
const SESSION_COMPLETED_KEY  = '@powr/session_completed';
const PENDING_CLAIMS_KEY     = '@powr/pending_claims';
// Exit-close outbox. Sibling of PENDING_CLAIMS_KEY and for the same reason: an
// exit happens with the phone pocketed and the screen off, so its network call is
// the one most likely to fail — and closing the visit was previously fire-and-
// forget. See enqueuePendingVisitClose.
const PENDING_VISIT_CLOSES_KEY = '@powr/pending_visit_closes';
// ⚠ TWO KEYS, AND THE DISTINCTION IS LOAD-BEARING.
//
// VISIT_TICK_KEY is the CREDIT floor: recordDwellSession reads it as "the last
// moment the device actually PROVED it was inside" and bills time up to it. Only a
// fix that would pass fixCreditsPresence may move it.
//
// VISIT_TICK_THROTTLE_KEY is just the cross-context rate limiter for the stream
// heartbeat. It answers "is the stream alive?", which is a different question and
// deliberately indifferent to accuracy.
//
// They were ONE key, and heartbeatVisitStream stamped it on a timer with no position
// check at all — so opening the app 334 m from the venue woke the stream, stamped
// "proven inside", and billed the session to that instant: 90.9 min recorded against
// a 71.5 min visit, and the user was told "91 min" (field 2026-08-10).
const VISIT_TICK_KEY          = '@powr/last_visit_tick';        // credit floor — proof of presence
const VISIT_TICK_THROTTLE_KEY = '@powr/last_visit_tick_beat';   // liveness only — never billed
// Consecutive outside readings behind the exit backstop. See EXIT_READINGS_REQUIRED:
// this is the corroboration that replaced the unbounded accuracy term.
const EXIT_STREAK_KEY         = '@powr/exit_readings';
// Running tally of arm-burst EXITs we declined to write a row for. Storage, not
// module state: a headless geofencing context can be torn down between events,
// and a tally that resets per event would report "1" fifty times — which is the
// noise we are removing. See noteSuppressedExit.
const EXIT_NOISE_KEY          = '@powr/exit_noise_tally';

// Last time a sweep stamped proven presence (fix 2026-08-12). Module state, not
// storage: a missed stamp costs one sweep interval of proof, nothing more.
let _lastSweepProvenStampAt = 0;

// ⚠ Mirrors LAST_WAKE_AT_KEY in lib/backgroundNotificationTask.ts and must stay
// equal to it. Duplicated rather than imported for the same reason that module
// documents on DISPLAY_NOTIFICATION_TYPE: neither boot path should drag the
// other's static imports along for one string. __tests__ pin the equality.
export const LAST_WAKE_AT_KEY = '@powr/last_wake_processed_at';

/** Wake silence, while a visit is open, past which the device must assume the
 *  beacon cannot reach it. Wakes arrive ~5-6 min apart for the whole life of an
 *  open visit, so 15 minutes is two-plus consecutive losses — not jitter. */
const WAKE_STARVATION_MS = 15 * 60 * 1000;

// Self-poll throttle (module state — same cost model as _lastSweepProvenStampAt).
let _lastSelfPollAt = 0;
const LAST_STREAM_FIX_KEY    = '@powr/last_stream_fix';   // newest fix the location stream delivered — the wake path's fallback presence proof
const LOCATION_LOSS_KEY      = '@powr/location_loss_pending'; // first unconfirmed sighting of a revoked permission — see finalizeSessionIfLocationRevoked

/** First sighting of a location loss against a specific session. Persisted so the
 *  two observations that a close requires can straddle process death. */
interface LocationLossMarker {
  /** The loss currently being confirmed. A DIFFERENT reason is a different
   *  condition and restarts the window — see finalizeSessionIfLocationRevoked. */
  reason:         LocationLossReason;
  /** Start of the confirmation window for `reason`. Reset when the reason changes. */
  firstSeenAtMs:  number;
  /** Fences the marker to one session, so it can never condemn the next one. */
  entryTimestamp: number;
  /** Start of this unbroken run of losses, of ANY reason — never reset while some
   *  loss persists. Telemetry only; nothing gates on it. It exists to answer the
   *  one question the reason-reset rule raises: can the reason oscillate in the
   *  field, and if so does a genuinely-dead session end up never confirming?
   *  A large loss_total_s next to a small confirmed_after_s is that fingerprint. */
  firstLossAtMs?: number;
  /** How many times the reason changed within this unbroken run. Telemetry only,
   *  and incremented only ON a change, so it costs no extra write per sweep. */
  reasonChanges?: number;
  /** Set once the verdict has been logged, so 'observe' mode emits one row per
   *  decision rather than one per sweep for the rest of the visit. */
  decided?:       boolean;
}

// How long a location loss must PERSIST, across at least two separate
// observations, before it may end a session. Detection latency is free here —
// the close is truncated to the last proven-inside tick, so a verdict reached
// late records exactly the same duration as one reached instantly — which means
// this can be generous without costing the user a single minute. Long enough to
// outlast a cold-launch read or a momentary Services toggle; short enough that
// one sweep cycle normally confirms it.
const LOCATION_LOSS_CONFIRM_MS = 3 * 60 * 1000;

// The in-gym stream heartbeat is a checkpoint, not a firehose: the stream ticks
// every 60 s, but we only need enough resolution to answer "is it alive at all?"
const VISIT_TICK_INTERVAL_MS = 5 * 60 * 1000;
// Synchronous in-context companion to VISIT_TICK_KEY. See heartbeatVisitStream:
// an AsyncStorage-only throttle cannot survive a burst of location callbacks
// because the read and the write straddle an await.
let _lastTickAtMs = 0;

// How long a started claim attempt may go without a persisted outcome before the
// dwell machine assumes it died and re-queues it. Attempts normally settle within
// NETWORK_TIMEOUT_MS; this lease is the backstop for a process killed mid-claim.
const CLAIM_RESULT_GRACE_MS = 2 * 60 * 1000;

// iOS hard-limits an app to 20 monitored regions; Android allows 100 (we use 50).
// One slot is reserved for the travel sentinel; the rest hold the nearest partners.
const MAX_REGIONS         = Platform.OS === 'ios' ? 20 : 50;
const SENTINEL_REGION_ID  = 'POWR_REARM_SENTINEL';
// Sentinel bounds: dense areas re-arm on small moves without thrashing; sparse
// areas still re-arm before the user is unreachably far from every armed circle.
const SENTINEL_MIN_RADIUS_M = 2_000;
const SENTINEL_MAX_RADIUS_M = 50_000;
const REARM_COOLDOWN_MS     = 2 * 60 * 1000;  // storm guard between re-arms
const PARTNER_CACHE_TTL_MS  = 24 * 60 * 60 * 1000;

// Persistent background-location stream. On Android this runs a foreground
// service so arrival/dwell/exit detection survives the app being swiped away or
// fully closed; on iOS it backs up native region monitoring. Balanced accuracy +
// 60 s / 50 m throttling keeps battery reasonable for a passive always-on stream.
// killServiceOnDestroy on every foreground-service config: when the user swipes
// the app away, Android destroys the React runtime but the foreground service
// kept the PROCESS alive — leaving a zombie that natively "handles" every
// location/geofence delivery while the dead JS side executes nothing
// (2026-08-04 field: 8 stream fixes reached TaskService during a walk, zero
// reached JS, no check-in; only a cold start heals). With the service dying on
// swipe, the process dies too, and the next geofence event / FCM wake / job
// relaunches a FRESH headless JS context — the resurrection path that actually
// works. Normal backgrounding (no swipe) keeps the service and stream running.
//
// ⚠ NO deferredUpdatesInterval HERE (removed 2026-08-17). It was 60_000, and on
// Android that is not "batch fixes for a minute" — expo-location's
// shouldReportDeferredLocations compares the newest fix against
// `mLastReportedLocation ?: mDeferredLocations[0]`, and that state lives on the
// CONSUMER INSTANCE. A swiped-away app builds a fresh consumer on every headless
// boot, so the first fix of each boot is its own baseline: `newest - oldest == 0`,
// the interval is never satisfied, and NOTHING reaches JS. A per-broadcast boot
// therefore got exactly one fix, and a process that keeps being rebuilt got none.
// Field 2026-08-17: a 57-minute Android visit ran with the passive stream as its
// only driver and logged `stream_fix_age_s: 2415` at the end — the last stream fix
// had arrived 40 minutes earlier. This is INDEPENDENT of distanceInterval, which
// is left at 50 m deliberately: that one is a battery decision, this one was a bug.
const LOCATION_UPDATE_OPTIONS: Location.LocationTaskOptions = {
  accuracy:                         Location.Accuracy.Balanced,
  timeInterval:                     60_000,
  distanceInterval:                 50,
  pausesUpdatesAutomatically:       false,
  showsBackgroundLocationIndicator: false,
  foregroundService: {
    notificationTitle: 'POWR is tracking your workouts',
    notificationBody:  'Detecting when you arrive at partner gyms.',
    notificationColor: '#facc15',
    killServiceOnDestroy: true,
  },
};

// In-session ("dwell") stream — Android only.
//
// The dwell state machine (advanceActiveSession) is purely TIME-based, but it is
// only ever invoked from a location callback. Both the baseline and approach
// streams set `distanceInterval` (50 m / 10 m), which Android hands to
// FusedLocation as setSmallestDisplacement: it suppresses callbacks entirely
// until the device MOVES that far. A user who checks in and then stands still —
// i.e. every real gym session — therefore receives NO fixes at all, the dwell
// machine never ticks, and the 30-min claim never fires in the background. That
// is the 2026-07-03 / 2026-07-11 / 2026-07-13 field failures: the foreground
// service was alive the whole time, it simply had nothing to deliver, and the
// claim only landed when the app was next opened (t+33, t+36 min).
//
// `distanceInterval: 0` removes the displacement filter so timeInterval alone
// drives delivery — a fix every 60 s regardless of movement. deferredUpdatesInterval
// is deliberately omitted: batching would defer exactly the ticks we need. Cost is
// bounded to the length of a visit; the foreground service is already running.
export const DWELL_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy:                         Location.Accuracy.Balanced,
  timeInterval:                     60_000,
  distanceInterval:                 0,   // ← time-driven: MUST stay 0, see above
  pausesUpdatesAutomatically:       false,
  showsBackgroundLocationIndicator: false,
  foregroundService: {
    notificationTitle: 'POWR is tracking your workouts',
    notificationBody:  "You're checked in — your session is being timed.",
    notificationColor: '#facc15',
    killServiceOnDestroy: true,   // see LOCATION_UPDATE_OPTIONS — zombie prevention
  },
};

// In-session stream — iOS.
//
// NOT a tick source — a LIFELINE. Field 2026-08-13 PM: a swiped iOS app was
// relaunched by the OS region ENTER, checked in cleanly, and was then killed
// again minutes later; every APNs background push after that was accepted by
// Apple and never delivered (force-quit/budget policy — silent pushes are
// best-effort by contract), so the claim chain went dark until the server-side
// settle banked it. An app that is RECEIVING location updates holds iOS's
// continuous-background-location execution state: the process stays alive for
// the visit, deferred APNs wakes flush to it, and the beacon's nudges land.
//
// distanceInterval 25 keeps it quiet while the user is stationary (iOS ignores
// timeInterval; 0 here would be kCLDistanceFilterNone — a continuous firehose).
// Proofs still come from wakes; any fix that does arrive is a bonus tick.
// pausesUpdatesAutomatically MUST stay false — auto-pause suspends the app and
// is precisely the state this stream exists to prevent. Bounded by the visit:
// finalize stands the stream back down to the iOS baseline ('off').
export const IOS_VISIT_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy:                         Location.Accuracy.High,
  distanceInterval:                 25,
  // Optional access: the enum exists on-device; jest's expo-location mocks
  // predate it, and this module must stay importable under all of them.
  activityType:                     Location.ActivityType?.Fitness ?? 3,
  pausesUpdatesAutomatically:       false,
  showsBackgroundLocationIndicator: false,
};

// ─── Approach stream (instant-entry escalation) ─────────────────────────────
// The native OS region is armed at a WIDER "approach" radius than the partner's
// true check-in circle (see armNativeRegions). A 25 m region on iOS fires late
// or not at all (Apple ties reliable region size to device accuracy) and, when
// the app is force-quit, native region monitoring is the ONLY iOS detector — so
// a tight native region trades away speed and reliability. Instead we arm the
// region big enough to wake reliably/early, then, while the user is inside that
// approach ring, run a short-lived HIGH-accuracy location stream so
// evaluateLocationFix can catch the exact 25 m crossing within seconds. The
// stream is the only thing that starts a session + fires "You're in", and it
// only ever does so at the true radius — so a user 120 m out never gets a false
// check-in. On EXIT of the approach ring the stream drops back to baseline.
const APPROACH_RADIUS_M = 120;                 // native trigger radius (the wake ring)
const APPROACH_STATE_KEY = '@powr/approach_state';

// High-accuracy config used only inside an approach ring. 8 s / 10 m is tight
// enough to catch a 25 m crossing at walking pace without the 5 s churn.
const APPROACH_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy:                         Location.Accuracy.High,
  timeInterval:                     8_000,
  distanceInterval:                 10,
  pausesUpdatesAutomatically:       false,
  showsBackgroundLocationIndicator: false,
  foregroundService: {
    notificationTitle: 'POWR is checking you in',
    notificationBody:  "You're near a partner gym — confirming your arrival.",
    notificationColor: '#facc15',
    killServiceOnDestroy: true,   // see LOCATION_UPDATE_OPTIONS — zombie prevention
  },
};

// Baseline the location stream returns to once the approach ring is left. Android
// keeps a passive always-on stream (primary closed-app detector); iOS has no
// persistent stream and goes fully OFF, falling back to native region monitoring.
export type StreamMode = 'off' | 'passive' | 'approach' | 'dwell';
const BASELINE_STREAM_MODE: StreamMode = Platform.OS === 'android' ? 'passive' : 'off';

/** The stream mode a given platform should run for the current visit state.
 *
 * 'dwell' during a session on BOTH platforms since 2026-08-13, with per-platform
 * options (streamOptsFor): Android runs the time-driven tick stream
 * (DWELL_LOCATION_OPTIONS — distanceInterval 0 so a stationary user still ticks);
 * iOS runs the displacement-gated lifeline (IOS_VISIT_LOCATION_OPTIONS — its job
 * is holding background execution so the process survives and wakes deliver, not
 * producing ticks). iOS was 'off' mid-session before, which left native region
 * monitoring as the only detector and a force-quit app unreachable between
 * check-in and exit.
 *
 * Pure so the platform rules are testable without a Platform mock. */
export function visitStreamMode(
  os: string,
  state: { sessionActive: boolean; approaching: boolean },
): StreamMode {
  if (state.sessionActive) return 'dwell';
  if (state.approaching) return 'approach';
  return os === 'android' ? 'passive' : 'off';
}

// A device reboot kills the foreground service (and its banner), but TaskManager
// still reports the location task as "started" across the reboot — so trusting
// hasStartedLocationUpdatesAsync() would skip the restart and the banner would
// never return. We force one stop+start on the first run of each JS process to
// guarantee a live service, then trust the cheap "already streaming" check for
// later (fingerprint-change) restarts within the same process.
let _locationStreamEnsuredThisProcess = false;

/** How long a checked-in visit's stream may go tickless before a foreground
 *  pass declares the service dead and force-restarts it. Dwell mode delivers
 *  every ~60 s by contract (DWELL_LOCATION_OPTIONS), so five missed ticks is a
 *  dead service, not jitter. Only consulted while a visit is OPEN — outside a
 *  visit the passive stream is displacement-gated and legitimately silent. */
const STREAM_SILENCE_RESTART_MS = 5 * 60_000;

// Location-detected EXIT is a backstop for when the native geofence exit never
// fires (closed app). Require the fix to be clearly outside the circle before
// trusting it, so GPS noise can't flap a genuinely-inside session out early.
const LOCATION_EXIT_HYSTERESIS_M = 50;
/** How stale a fix the exit backstop will reason about. See its call site: a
 *  ten-minute cache let a departed user look present for the whole walk out. */
export const EXIT_BACKSTOP_FIX_MAX_AGE_MS = 90 * 1000;
/** How long the backstop's one-shot acquisition may run when the cache is empty
 *  (see its call site). A race bound, not an expectation — Balanced outdoors
 *  answers in 1-5 s; the bound exists for the indoor/Doze case where it might
 *  not answer at all. */
export const EXIT_BACKSTOP_ACQUIRE_TIMEOUT_MS = 10 * 1000;

// Accounts that bypass the one-session-per-day guard during testing
const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

// Proximity checks trigger at exactly the partner's configured radius — no GPS
// accuracy buffer is added, so a 25 m circle means 25 m, not 25 m + the user's
// position uncertainty. Coarse fixes are still rejected outright: Android's first
// fix on app open is often a network/fused position accurate to only a few hundred
// metres, which can't be trusted against a tight radius and would otherwise fire a
// false "You're in" from far away.
// ⚠ EVERY comparison against this gate is `<=`, never `<` (2026-08-13). 100 m is
// Android's MODAL accuracy (Balanced = PRIORITY_BALANCED_POWER_ACCURACY, nominal
// ~100 m), so a strict `<` rejects the single most common fix the platform
// produces. Field 2026-08-13 PM: an in-pocket presence answer at accuracy
// EXACTLY 100 / distance 27 was stamped proven:false, last_proven_at froze at
// the claim, and the 20-min reaper closed a live visit 24 minutes early.
const MAX_FIX_ACCURACY_M = 100;

// ⚠️ DEV OVERRIDES — restore before release
// The upgrade tier threshold is admin-tunable (system_config →
// gym_upgrade_minutes, read via lib/gymDwellConfig, default 40). Functions, not
// consts, for the same reason as minDwellMs below. Dev short-circuit (1 min) kept.
const upgradeMs     = () => (__DEV__ ? 60 * 1000 : getGymUpgradeMinutes() * 60 * 1000);
const prodUpgradeMs = () => getGymUpgradeMinutes() * 60 * 1000;

// The base gym dwell threshold is admin-tunable (system_config →
// min_gym_dwell_minutes, read via lib/gymDwellConfig). These are functions, not
// consts, because the value can change between app launches; each returns the
// last-known cached minutes (default 30). The dev short-circuit (30 s) is kept.
const minDwellMs = () => (__DEV__ ? 30 * 1000 : getGymDwellMinutes() * 60 * 1000);
// Production eligibility minimum — used for pointsPending retry regardless of dev override.
const prodDwellMs = () => getGymDwellMinutes() * 60 * 1000;
// Sanity backstop on a recorded gym dwell — a LOOSE guardrail, not the accuracy
// mechanism. It only bounds the runaway wall-clock a missed/late EXIT used to
// produce (observed up to 31 h); the true length is corrected after the fact,
// off the critical path, against the health store (see lib/health/gymReconcile.ts).
// 12 h matches MAX_SESSION_MS and covers all-day events. Points are unaffected —
// gym tops out at the 40-min tier. Keep in sync with upgrade-gym-tier.
const MAX_GYM_SESSION_SEC = 12 * 60 * 60; // 12 h backstop
const DEV_RADIUS_M: Record<string, number> = __DEV__ ? {
  'POWR Test Gym': 100,
  'Jamie':         100,
} : {};

// ─── Stored geofence shape ────────────────────────────────────────────────────

// Cached per-region partner data, keyed by the composite region id. Geometry is
// persisted (not just name/dbId) so the headless location task can compute
// proximity without React state or a network fetch.
interface PartnerMapEntry {
  name:    string;
  dbId:    string;
  lat?:    number;
  lng?:    number;
  radius?: number;
}

interface StoredGeofence {
  partnerId:        string;
  partnerName:      string;
  regionId?:        string;  // composite native-region identifier; correlates EXIT events
  entryTimestamp:   number;
  latitude?:        number;
  longitude?:       number;
  radius?:          number;
  sessionRecorded?: boolean; // true once session has been written to DB
  pointsPending?:   boolean; // true if session exists but claim was too short — retry on exit
  claimAttemptAt?:  number;  // when the last claim attempt STARTED. Lets the dwell
                             // machine tell "attempt still in flight" from "attempt
                             // died without writing an outcome" and self-heal —
                             // see advanceActiveSession
  sessionId?:       string;  // set after the initial 30-min claim succeeds
  tierUpgraded?:    boolean; // true once the 40-min upgrade has been attempted
  endedAtMs?:       number;  // frozen exit time — used by post-exit retry claims so
                             // the recorded duration stays the true session length
  visitId?:         string;  // server-side beacon record; lets the server wake this
                             // device at the dwell/upgrade thresholds (see lib/gymVisits)
  userId?:          string;  // who this session belongs to. Sign-out did not clear
                             // geofence state and this blob carried no owner, so a
                             // session opened by one account could be finalized —
                             // and its exit-claim outbox replayed — under whoever
                             // signed in next. Two prod sessions (9decdee4 /
                             // bb50a5f3, different users) share raw_gps
                             // entryTimestamp 1785473225472 on one device.
}

// ─── Partner geometry cache (nationwide) ─────────────────────────────────────
// PARTNER_MAP_KEY holds the geometry of EVERY active partner location — not just
// the ones near the last app open — so the headless detectors keep working no
// matter where the user travels with the app closed. ~8k entries is ~1.5 MB of
// AsyncStorage and a few ms of haversines per scan. The meta key carries
// fetchedAt so each JS context (app + headless task) memoizes the parse and only
// re-reads when the cache was actually rewritten.

// Bump to force every device to rewrite its cache on next check, regardless of
// TTL — v2 = the paginated fetch (v1 caches were truncated to 1000 partners).
// v3 = the Stratford-upon-Avon load. A bump is how newly loaded venues become
// earnable before the 24 h TTL lapses; without it a user can stand in a brand
// new partner for up to a day and neither see its pin nor trigger its geofence.
const PARTNER_MAP_VERSION = 3;

interface PartnerMapMeta { fetchedAt: number; v?: number }

let _partnerMapMemo: { fetchedAt: number; map: Record<string, PartnerMapEntry> } | null = null;

async function readPartnerMap(): Promise<Record<string, PartnerMapEntry> | null> {
  try {
    const metaRaw = await AsyncStorage.getItem(PARTNER_MAP_META_KEY);
    const fetchedAt = metaRaw ? ((JSON.parse(metaRaw) as PartnerMapMeta).fetchedAt ?? 0) : 0;
    if (_partnerMapMemo && _partnerMapMemo.fetchedAt === fetchedAt) return _partnerMapMemo.map;
    const raw = await AsyncStorage.getItem(PARTNER_MAP_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, PartnerMapEntry>;
    _partnerMapMemo = { fetchedAt, map };
    return map;
  } catch {
    return null;
  }
}

async function writePartnerMap(map: Record<string, PartnerMapEntry>, opts: { partial?: boolean } = {}): Promise<void> {
  const fetchedAt = Date.now();
  await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify(map));
  // A partial write (nearby-only fallback) is stamped v1 so it is immediately
  // considered stale and upgraded to the full set at the next opportunity,
  // while still being usable for local detection in the meantime.
  await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt, v: opts.partial ? 1 : PARTNER_MAP_VERSION } satisfies PartnerMapMeta));
  _partnerMapMemo = { fetchedAt, map };
}

/** True when the cached partner map is missing, from an older cache format, or
 *  older than the TTL — i.e. it must not be trusted as the full nationwide set. */
async function partnerMapIsStale(): Promise<boolean> {
  try {
    const metaRaw = await AsyncStorage.getItem(PARTNER_MAP_META_KEY);
    if (!metaRaw) return true;
    const meta = JSON.parse(metaRaw) as PartnerMapMeta;
    if ((meta.v ?? 1) !== PARTNER_MAP_VERSION) return true;
    return Date.now() - (meta.fetchedAt ?? 0) > PARTNER_CACHE_TTL_MS;
  } catch {
    return true;
  }
}

/** Fetches geometry-only columns for every active partner and rewrites the
 *  cache. Kept lightweight (id/name/locations) so the payload stays small even
 *  at ~8k partners. PostgREST caps every response at 1000 rows (db-max-rows),
 *  so this pages until a short page — without that, the "nationwide" cache
 *  silently held an arbitrary 1000-partner subset once the dataset outgrew the
 *  cap, and closed-app detection at the missing partners could never fire. */
async function fetchAndCacheAllPartnerGeometry(): Promise<boolean> {
  try {
    const PAGE = 1000;
    const MAX_PAGES = 20; // runaway backstop (~20k locations)
    // First page carries the exact total, so the remaining pages fetch in
    // PARALLEL — sequential paging made a cold cache build take seconds.
    const { data: first, error: firstErr, count } = await supabase
      .from('partners')
      .select('id, name, locations', { count: 'exact' })
      .eq('active', true)
      .order('id', { ascending: true }) // stable page boundaries
      .range(0, PAGE - 1);
    if (firstErr || !first) return false;
    const pages = Math.min(Math.ceil((count ?? first.length) / PAGE), MAX_PAGES);
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
        supabase
          .from('partners')
          .select('id, name, locations')
          .eq('active', true)
          .order('id', { ascending: true })
          .range((i + 1) * PAGE, (i + 2) * PAGE - 1),
      ),
    );
    const data: any[] = [...first];
    for (const r of rest) {
      // A failed page would leave a silently truncated "nationwide" set — the
      // exact bug this pagination exists to prevent. Keep the old cache instead.
      if (r.error || !r.data) return false;
      data.push(...r.data);
    }
    const map: Record<string, PartnerMapEntry> = {};
    data.forEach((p: any) => {
      if (!p.locations) return;
      const locs = Array.isArray(p.locations) ? p.locations : [p.locations];
      locs.forEach((loc: any, idx: number) => {
        if (loc?.lat == null || loc?.lng == null || !isFinite(loc.lat) || !isFinite(loc.lng)) return;
        map[`${p.id}-${idx}`] = {
          name:   p.name,
          dbId:   p.id,
          lat:    loc.lat,
          lng:    loc.lng,
          radius: DEV_RADIUS_M[p.name] ?? loc.radius ?? 100,
        };
      });
    });
    if (Object.keys(map).length === 0) return false;
    await writePartnerMap(map);
    return true;
  } catch {
    return false;
  }
}

// ─── Arm-fix acquisition ──────────────────────────────────────────────────────
// The armed set is only as good as the fix it is centred on, and arming tolerates
// staleness far better than inaccuracy: nearest-N membership shifts over km, so a
// ten-minute-old fix from the right place beats a fresh one from the wrong town.
// 2026-08-04 field failure: the startup arm read Accuracy.Low — "city level",
// served from cell/IP positioning — which placed a stationary user 13 km away.
// Their own gym ranked #65 in a nearest-49 cut, the whole day's watch list
// covered the wrong town, and no later fix could correct it. Every source here is
// therefore screened to ≤ ARM_FIX_MAX_ACCURACY_M, and the one live read is
// bounded so a background caller can never hang on GPS acquisition (the wake-path
// lesson — see runVisitCheck).
const ARM_FIX_MAX_ACCURACY_M = 1_000;
const ARM_FIX_MAX_AGE_MS     = 10 * 60_000;
const ARM_FIX_TIMEOUT_MS     = 8_000;

/** ⚠ `accuracy` and `ageMs` are carried purely so the `armed` row can state them
 *  (2026-08-09). They gate nothing — the screening above already happened, and
 *  widening these tolerances would undo the 08-04 lesson.
 *
 *  Why they exist: the arm row used to record only the centre it chose, so an arm
 *  taken from a legitimately-coarse fix and an arm taken from a broken one looked
 *  identical. On 2026-08-09 an Android arm landed 454 m from the venue and, with
 *  no accuracy on the row, it was read as a fault and nearly "fixed" by forcing
 *  GPS onto this path — which would have added acquisition cost and hang risk to
 *  a function deliberately built to have neither. The fix was fine; a 1 km
 *  tolerance is the documented design. One field on the telemetry settles that
 *  question in a query instead of an inference. */
export interface ArmFix {
  latitude: number;
  longitude: number;
  src: 'stream_cache' | 'last_known' | 'live';
  accuracy: number | null;
  ageMs: number | null;
}

export async function getArmFix(): Promise<ArmFix | null> {
  // 1. The stream's own persisted fix — free, and fresh whenever the stream lives.
  try {
    const raw = await AsyncStorage.getItem(LAST_STREAM_FIX_KEY);
    if (raw) {
      const f = JSON.parse(raw) as { latitude?: number; longitude?: number; accuracy?: number | null; at?: number };
      if (
        typeof f?.latitude === 'number' && typeof f?.longitude === 'number' &&
        Date.now() - (f.at ?? 0) <= ARM_FIX_MAX_AGE_MS &&
        (f.accuracy == null || f.accuracy <= ARM_FIX_MAX_ACCURACY_M)
      ) {
        return {
          latitude: f.latitude,
          longitude: f.longitude,
          src: 'stream_cache',
          accuracy: f.accuracy ?? null,
          ageMs: typeof f.at === 'number' ? Date.now() - f.at : null,
        };
      }
    }
  } catch { /* fall through to the OS sources */ }

  // 2. The OS cache — no acquisition, so it cannot hang. requiredAccuracy screens
  // out exactly the city-level answers that caused the 2026-08-04 phantom arm.
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge:           ARM_FIX_MAX_AGE_MS,
    requiredAccuracy: ARM_FIX_MAX_ACCURACY_M,
  }).catch(() => null);
  if (lastKnown) {
    return {
      latitude: lastKnown.coords.latitude,
      longitude: lastKnown.coords.longitude,
      src: 'last_known',
      accuracy: lastKnown.coords.accuracy ?? null,
      ageMs: typeof lastKnown.timestamp === 'number' ? Date.now() - lastKnown.timestamp : null,
    };
  }

  // 3. A live Balanced read, raced against a bound. The bound is best-effort (RN
  // timers can freeze under Doze), but background callers only reach this branch
  // right after the OS computed a fix to fire a region crossing — so source 2
  // all but always answers first.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ARM_FIX_TIMEOUT_MS); }),
    ]);
    if (fresh && (fresh.coords.accuracy == null || fresh.coords.accuracy <= ARM_FIX_MAX_ACCURACY_M)) {
      return {
        latitude: fresh.coords.latitude,
        longitude: fresh.coords.longitude,
        src: 'live',
        accuracy: fresh.coords.accuracy ?? null,
        ageMs: 0,
      };
    }
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── Native region arming ─────────────────────────────────────────────────────
// Arms the nearest (MAX_REGIONS - 1) partner circles plus one large "sentinel"
// region centred on the user. The sentinel is the travel fix: leaving it means
// the armed set no longer matches the user's surroundings. iOS relaunches the
// terminated app on that exit so we can re-arm around wherever they are now;
// on Android the foreground-service stream calls this on drift. Re-arming is
// network-free — it reads the nationwide geometry cache only — so it fits the
// tight iOS background execution window.

interface ArmMeta {
  centerLat:      number;
  centerLng:      number;
  sentinelRadius: number;
  armedAt:        number;
}

// Signature of the last region set actually handed to the OS (this JS context).
// Guards against back-to-back duplicate arms — see armNativeRegions.
let _lastArmSignature: string | null = null;

// Single-flight chain: concurrent arms SERIALIZE instead of racing. 2026-08-13
// field run: the permission-grant path fired twice ~130 ms apart (returning
// from the settings radio list resolves the awaited request AND fires
// AppState→active), and both calls read running=false / signature=null before
// either had armed — so BOTH reached startGeofencingAsync and the second
// registration cancelled the first's delivery PendingIntent mid-ingest. That is
// the 2026-08-04 failure again, just 700× tighter, and the signature dedupe
// below cannot catch it because the signature is only written AFTER the await.
// Serialised, the second call observes the first's registration + signature and
// dedupes to a no-op.
let _armChain: Promise<void> = Promise.resolve();

async function armNativeRegions(
  fix: Parameters<typeof armNativeRegionsUnserialized>[0],
  opts: Parameters<typeof armNativeRegionsUnserialized>[1] = {},
): Promise<void> {
  const run = _armChain.then(() => armNativeRegionsUnserialized(fix, opts));
  _armChain = run.catch(() => { /* keep the chain alive past a rejected link */ });
  return run;
}

async function armNativeRegionsUnserialized(
  // Provenance is OPTIONAL because most callers hand over raw stream coords that
  // never went through getArmFix — they have no src/accuracy/age to give. Those
  // arms simply log nulls for the three fields rather than forcing every call
  // site to invent them.
  fix: { latitude: number; longitude: number; src?: ArmFix['src']; accuracy?: number | null; ageMs?: number | null } | null,
  // `via` names the calling path in the `armed` row. 2026-08-11: the day's one
  // Android arm logged src/acc/age all-null (call sites used to strip the
  // ArmFix down to bare coords) and nothing said WHICH path armed — the storm
  // investigation had to reconstruct it from timing alone.
  opts: { force?: boolean; freshHandle?: boolean; via?: string } = {},
): Promise<void> {
  // Ship the previous arm's suppressed-exit tally BEFORE this arm fires its own
  // initial-state storm, so each burst gets its own row. First statement in the
  // function on purpose: every early return below (no permission, inside the
  // envelope, same set, background refusal) is still an arm attempt, and draining
  // on all of them is what keeps the tally from ageing in storage.
  await flushSuppressedExitNoise();

  const { status } = await Location.getBackgroundPermissionsAsync()
    .catch(() => ({ status: 'denied' as Location.PermissionStatus }));
  if (status !== 'granted') return;

  // Unless forced (data changed / boot), skip when the fix is still inside the
  // armed envelope, and rate-limit genuine re-arms against event storms.
  if (!opts.force) {
    if (!fix) return;
    try {
      const metaRaw = await AsyncStorage.getItem(ARM_META_KEY);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw) as ArmMeta;
        const moved = haversineMetres(fix.latitude, fix.longitude, meta.centerLat, meta.centerLng);
        if (moved <= meta.sentinelRadius) return;
        if (Date.now() - meta.armedAt < REARM_COOLDOWN_MS) return;
      }
    } catch { /* fall through and arm */ }
  }

  const map = await readPartnerMap();
  if (!map) return;
  const entries = Object.entries(map).filter(([, e]) => e.lat != null && e.lng != null);
  if (entries.length === 0) return;

  let regions: Location.LocationRegion[];
  let meta: ArmMeta | null = null;

  if (fix) {
    const sorted = entries
      .map(([id, e]) => ({ id, e, dist: haversineMetres(fix.latitude, fix.longitude, e.lat!, e.lng!) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, MAX_REGIONS - 1);
    // Sentinel sized just inside the armed envelope: leaving it means the
    // nearest-N membership has likely changed.
    const envelope = sorted[sorted.length - 1]?.dist ?? SENTINEL_MIN_RADIUS_M;
    const sentinelRadius = Math.min(Math.max(envelope * 0.8, SENTINEL_MIN_RADIUS_M), SENTINEL_MAX_RADIUS_M);
    regions = sorted.map(({ id, e }) => ({
      identifier:    id,
      latitude:      e.lat!,
      longitude:     e.lng!,
      // Wake ring: arm at ≥120 m so the OS fires ENTER reliably and early. The
      // true (25 m) check-in radius is confirmed in JS by the approach stream, so
      // the wider native region never triggers a session by itself.
      radius:        Math.max(e.radius ?? 100, APPROACH_RADIUS_M),
      notifyOnEnter: true,
      notifyOnExit:  true,
    }));
    regions.push({
      identifier:    SENTINEL_REGION_ID,
      latitude:      fix.latitude,
      longitude:     fix.longitude,
      radius:        sentinelRadius,
      notifyOnEnter: false,
      notifyOnExit:  true,
    });
    meta = { centerLat: fix.latitude, centerLng: fix.longitude, sentinelRadius, armedAt: Date.now() };
  } else {
    // No fix at all (rare — e.g. boot before any location): arm an arbitrary
    // subset with no sentinel; the first real fix re-arms properly.
    regions = entries.slice(0, MAX_REGIONS).map(([id, e]) => ({
      identifier:    id,
      latitude:      e.lat!,
      longitude:     e.lng!,
      // Wake ring: arm at ≥120 m so the OS fires ENTER reliably and early. The
      // true (25 m) check-in radius is confirmed in JS by the approach stream, so
      // the wider native region never triggers a session by itself.
      radius:        Math.max(e.radius ?? 100, APPROACH_RADIUS_M),
      notifyOnEnter: true,
      notifyOnExit:  true,
    }));
  }

  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false);

    // ⚠ THE ONE RULE THIS FILE IS BUILT AROUND (proven on-device 2026-08-06,
    // build 16, GMS's own log — the first time we could see it):
    //
    //   15:15:03.911 TaskService: Unregistering task 'GEOFENCE_CHECK_IN'
    //   15:15:03.928 TaskService: Registered task   'GEOFENCE_CHECK_IN'
    //   15:15:03.931 Geofencer: registration not active, NOT PERMITTED  ×50
    //
    // That was a HEADLESS wake that never called stopGeofencingAsync.
    // startGeofencingAsync RE-REGISTERS the task internally, and expo's
    // consumer tears the old registration down on didUnregister (removeGeofences
    // + PendingIntent.cancel) before re-adding on didRegister. Google then
    // REFUSES the re-add from a non-foreground process — every fence, every
    // time — while expo's promise still resolves and JS happily logs "Armed 50".
    // So the long-held "start swaps options on the same consumer, one fence
    // generation" model was simply false: EVERY re-arm is remove-then-add, and
    // in the background the add never lands.
    //
    // Therefore a background re-arm of a LIVE registration can only ever
    // destroy it. Refuse outright. Nothing to arm around is a different case:
    // with no registration there is nothing to lose, so an attempt is allowed
    // (boot/headless-restore paths) — it may be refused, but it cannot subtract.
    //
    // The corollary the product has to live with until this is solved natively:
    // fences are (re)built ONLY in the foreground. That is not a policy choice,
    // it is what Google permits on this device class.
    if (running && Platform.OS === 'android' && AppState.currentState !== 'active') {
      console.warn('[Geofence] Re-arm REFUSED — background re-arm can only destroy a live registration.');
      logRegionEvent('arm', 'rearm_skipped', {
        reason: 'background_would_destroy',
        app_state: String(AppState.currentState),
        forced: !!opts.force,
        fresh_handle: !!opts.freshHandle,
        via: opts.via ?? null,
      });
      return;
    }

    // Same-set dedupe: two arms for an identical set buy nothing and cost a full
    // native re-registration. 2026-08-04: the startup flow armed twice 91 s
    // apart; the second registration CANCELLED the first's delivery
    // PendingIntent, dropping its queued initial-trigger events — including the
    // ENTER for the user's own gym. Centre is part of the signature so a real
    // move (new sentinel centre) always re-arms even if the venue set repeats.
    const signature =
      `${fix ? `${fix.latitude.toFixed(3)},${fix.longitude.toFixed(3)}` : 'nofix'}|` +
      [...regions]
        .sort((a, b) => (a.identifier ?? '').localeCompare(b.identifier ?? ''))
        .map(r => `${r.identifier}:${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}:${Math.round(r.radius ?? 0)}:${r.notifyOnEnter ? 1 : 0}${r.notifyOnExit ? 1 : 0}`)
        .join('|');
    // freshHandle callers (the wake self-heal) skip this skip: their entire
    // purpose is a fresh registration with a fresh PendingIntent even when the
    // region set is byte-identical — a mute geofencer looks exactly like an
    // unchanged one from JS. Boot/startup arms must NOT set it (the dedupe is
    // what stops the 2026-08-04 startup double-arm from cancelling its own
    // queued initial-trigger events).
    if (!opts.freshHandle && running && signature === _lastArmSignature) {
      console.log('[Geofence] Arm skipped — region set unchanged.');
      return;
    }

    // Normal production re-arms do NOT stop first. stopGeofencingAsync
    // unregisters the task, tears down the native consumer and cancels its
    // PendingIntent, so in-flight events die with it. startGeofencingAsync on a
    // live task swaps options on the same consumer, which is all a re-centre
    // needs.
    //
    // freshHandle is intentionally different: it repairs a consumer whose
    // PendingIntent is already mute (GMS: "registration not active / not
    // permitted"). But the teardown is FOREGROUND-ONLY — field 2026-08-06,
    // the walk that went silent across the board: GMS silently REFUSES
    // geofence adds from headless contexts on this device class, and expo
    // swallows the async add-failure ("Armed 50" logged, registry ZERO). From
    // a headless wake, stop+start therefore DELETES a registration it can
    // never replace — strictly worse than the mute consumer it meant to heal.
    // Headless wakes keep the non-destructive start-only swap; the
    // fresh-handle teardown runs only where adds are actually accepted: the
    // foreground, which has always been the one context that heals.
    const stopFirst = __DEV__ || (opts.freshHandle && AppState.currentState === 'active');
    if (running && stopFirst) {
      try {
        await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
      } catch (err) {
        if (opts.freshHandle) console.warn('[Geofence] stopGeofencingAsync failed during freshHandle re-arm:', err);
      }
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
    _lastArmSignature = signature;
    if (meta) {
      await AsyncStorage.setItem(ARM_META_KEY, JSON.stringify(meta));
    } else {
      await AsyncStorage.removeItem(ARM_META_KEY).catch(() => {});
    }
    console.log(`[Geofence] Armed ${regions.length} region(s)${fix ? ' around current fix' : ' (no fix — unsorted)'}.`);
    // Server-visible arm fingerprint. 2026-08-04: a phantom-centred arm was only
    // reconstructable from the initial-trigger EXIT burst — this row states the
    // centre outright, so "armed around the wrong place" is one query away.
    logRegionEvent('arm', 'armed', {
      n:          regions.length,
      lat:        fix ? Number(fix.latitude.toFixed(4)) : null,
      lng:        fix ? Number(fix.longitude.toFixed(4)) : null,
      sentinel_m: meta ? Math.round(meta.sentinelRadius) : null,
      // The provenance of the centre, not just the centre. Without these an arm
      // from a coarse-but-legal fix reads exactly like an arm from a broken one
      // — see the ArmFix docstring for the misdiagnosis that cost.
      src:        fix?.src ?? null,
      acc_m:      fix?.accuracy != null ? Math.round(fix.accuracy) : null,
      age_s:      fix?.ageMs != null ? Math.round(fix.ageMs / 1000) : null,
      via:        opts.via ?? null,
    });
  } catch (err) {
    console.warn('[Geofence] Failed to arm native regions:', err);
  }
}

// ─── Approach-stream helpers ────────────────────────────────────────────────

/** (Re)configures the persistent location stream to the given mode. 'approach'
 *  = high accuracy to catch a 25 m crossing; 'passive' = the battery-friendly
 *  always-on Android baseline; 'off' = fully stopped (iOS baseline). Restart is
 *  how expo-location changes accuracy on a running task. Best-effort — a failure
 *  leaves detection working (worst case: the stream stays at its prior mode). */
// Last mode the stream was successfully started in. Module state answers within
// this JS context; the persisted key answers for a context that just booted
// (headless task, cold start) so IT doesn't restart a stream that is already
// running in the mode it wants.
const STREAM_MODE_KEY = '@powr/stream_mode';
let _streamModeInProcess: StreamMode | null = null;

function streamOptsFor(mode: StreamMode | null): Location.LocationTaskOptions {
  // 'dwell' is one MODE with two per-platform jobs: Android ticks a stationary
  // user every 60 s; iOS holds background execution so the process survives the
  // visit (see IOS_VISIT_LOCATION_OPTIONS — quiet by design).
  return mode === 'approach' ? APPROACH_LOCATION_OPTIONS
    :    mode === 'dwell'    ? (Platform.OS === 'ios' ? IOS_VISIT_LOCATION_OPTIONS : DWELL_LOCATION_OPTIONS)
    :                          LOCATION_UPDATE_OPTIONS;
}

async function recordStreamMode(mode: StreamMode): Promise<void> {
  _streamModeInProcess = mode;
  await AsyncStorage.setItem(STREAM_MODE_KEY, mode).catch(() => {});
}

/** What the caller may honestly claim afterwards.
 *
 *  ⚠ THIS USED TO RETURN void, AND THAT IS WHY `approach_stream_on` WAS A LIE
 *  (2026-08-17). Every failure in here — the Android background refusal, a failed
 *  restore, the outer catch — was swallowed, and enterApproach logged
 *  `approach_stream_on` unconditionally afterwards. So "the stream never started"
 *  and "the stream started and then went mute" wrote byte-identical telemetry, and
 *  three separate field runs (08-12 PM, 08-13, 08-17) each burned their one
 *  reproduction deciding which of the two had happened. 08-17: the row was
 *  written at 09:00:03 and ZERO stream fixes followed for 7.5 minutes while the
 *  user walked 74 m → 4 m. `started` is now the truth, and `mode` is the mode
 *  ACTUALLY running when this returns — not the one that was asked for. */
type StreamModeResult = { started: boolean; mode: StreamMode };

// Exported for tests: the same-mode no-op and the restore-on-refused-start are
// regression-pinned directly (__tests__/geofence-arm-fix.test.ts).
export async function setLocationStreamMode(mode: StreamMode): Promise<StreamModeResult> {
  if (Platform.OS === 'web') return { started: false, mode };
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false);
    if (mode === 'off') {
      if (started) await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
      await recordStreamMode('off');
      return { started: false, mode: 'off' };
    }

    // Already running in the requested mode → leave it alone. The switch below
    // is a stop→start, and on Android 12+ the start can be REFUSED from a
    // background context — so a redundant "switch" turns a live stream into no
    // stream. 2026-08-04: the baseline stream died mid-morning on exactly this
    // and stayed dead until app-open, taking drift re-arm and stream check-in
    // with it.
    let current: StreamMode | null = _streamModeInProcess
      ?? ((await AsyncStorage.getItem(STREAM_MODE_KEY).catch(() => null)) as StreamMode | null);
    // On first run after an upgrade STREAM_MODE_KEY may not yet exist while the
    // native stream is already running.  Infer the mode from persisted session /
    // approach state so we avoid an unnecessary stop→start that can trigger the
    // Android 12+ background-start refusal.
    if (current === null && started) {
      const sessionActive = (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY).catch(() => null)) != null;
      const approaching   = (await AsyncStorage.getItem(APPROACH_STATE_KEY).catch(() => null)) != null;
      current = visitStreamMode(Platform.OS, { sessionActive, approaching });
    }
    if (started && current === mode) return { started: true, mode };

    // A LIVE stream is worth more than the right mode. The switch below is a
    // stop→start, and Android 12+ refuses to start a foreground service from the
    // background — including the restore attempt in the catch, which is why the
    // safety net below is not enough on its own. 2026-08-06, the second cause of
    // that night's Android silence, logged verbatim:
    //
    //   stream_start_failed  mode: dwell  restored: FALSE
    //   "Couldn't start the foreground service"
    //
    // That fired at the exact second of gym entry, so the passive→dwell switch
    // traded a working stream for none at all, and Android had no location
    // driver for the rest of the session. Defer instead: the mode we want is
    // recorded, the next foreground pass applies it, and until then the beacon's
    // nudges drive the visit (each takes its own fresh fix, so a coarser stream
    // costs nothing that matters). Same principle as the background re-arm
    // guard — a background context may never destroy live native registrations.
    //
    // The recorded mode is deliberately NOT updated: it must keep describing the
    // stream that is actually running, or the next foreground request for this
    // mode would match it, no-op, and the switch would never happen at all.
    if (started && Platform.OS === 'android' && AppState.currentState !== 'active') {
      logRegionEvent('stream', 'stream_switch_deferred', { from: current, to: mode });
      console.log(`[Geofence] Stream switch ${current} → ${mode} deferred — a background stop→start cannot restart.`);
      // The requested mode is NOT running. Callers that log "stream on" must say
      // so honestly — this is the branch that fired at every 08-17 check-in.
      return { started, mode: current ?? 'passive' };
    }

    // ⚠ NO PRE-EMPTIVE STOP (removed 2026-08-17). This was a stop→start, and the
    // stop is what made a refused start catastrophic rather than merely useless:
    // it destroyed a live, working stream before asking for the new one. It is
    // also unnecessary — startLocationUpdatesAsync on an ALREADY-REGISTERED task
    // updates that task's options rather than erroring, and expo's
    // maybeStartForegroundService early-returns while backgrounded, so no
    // foreground service is stopped or started by this path. Starting straight
    // over the top means the worst case is "the options did not change", never
    // "there is no stream any more". The restore in the catch is kept as belt.
    try {
      await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, streamOptsFor(mode));
      await recordStreamMode(mode);
      return { started: true, mode };
    } catch (err) {
      // The start was refused and the old stream is already stopped — restore it,
      // so "couldn't switch modes" never degrades into "no stream at all".
      let restored = false;
      if (started) {
        restored = await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, streamOptsFor(current))
          .then(() => true)
          .catch(() => false);
      }
      if (!restored) _streamModeInProcess = null;
      // Report it; pollForCheckIn is what actually keeps the check-in working
      // when this fires. `err_class` because the MESSAGE is what varies between
      // OEM builds while the class is what identifies the refusal — 08-17 left us
      // unable to say whether the throw was expo-location's own pre-OS
      // foreground check or a genuine OS rejection, and they need different fixes.
      logRegionEvent('stream', 'stream_start_failed', {
        mode,
        restored,
        err_class: (err as Error)?.constructor?.name ?? typeof err,
        error:     String(err).slice(0, 120),
      });
      console.warn('[Geofence] setLocationStreamMode failed:', mode, err);
      return { started: restored, mode: restored ? (current ?? 'passive') : mode };
    }
  } catch (err) {
    logRegionEvent('stream', 'stream_start_failed', {
      mode,
      err_class: (err as Error)?.constructor?.name ?? typeof err,
      error:     String(err).slice(0, 120),
    });
    console.warn('[Geofence] setLocationStreamMode failed:', mode, err);
  }
  return { started: false, mode };
}

/** Fire-and-forget region telemetry, lazily imported like the rest of the
 *  gymVisits surface so a headless context only pulls it in when it fires. */
function logRegionEvent(
  regionId: string,
  event: 'enter' | 'exit' | 'approach_stream_on' | 'checked_in' | 'stream_start_failed'
    | 'stream_switch_deferred' | 'armed' | 'sentinel_exit' | 'rearm_skipped' | 'sweep'
    | 'visit_stamp_relaxed' | 'visit_stamp_skipped' | 'coarse_rejected' | 'enter_scan'
    | 'location_revoked' | 'active_patch_refused' | 'exit_refuted' | 'visit_stream_ensured'
    | 'exit_noise_suppressed' | 'visit_close_deferred' | 'check_in_announced'
    | 'visit_open_attempt' | 'visit_open_result' | 'wake_step_hung' | 'stream_first_tick',
  detail: Record<string, unknown> = {},
): void {
  void import('@/lib/gymVisits')
    .then(({ logGeofenceRegionEvent }) => logGeofenceRegionEvent(regionId, event, detail))
    .catch(() => { /* telemetry must never break a crossing */ });
}

// ─── Wake-path tracing ────────────────────────────────────────────────────────
// Every await inside a wake is a suspect until proven otherwise, and we have now
// twice inferred the guilty call instead of proving it (2026-08-03, twice). So the
// wake path records a breadcrumb BEFORE each step and a duration after, and ships
// the whole trace to the server on the confirm round-trip — which means the answer
// arrives for iOS too, where there are no device logs to read at all.
//
// The bound is best-effort by nature: RN drives setTimeout off the UI frame clock,
// so under Doze the race itself can fail to fire (field 2026-07-14: a 30 s timeout
// still pending 16 minutes later). That is exactly why the BEFORE breadcrumb
// matters — if the timer never fires, the last breadcrumb still names the call that
// hung. Belt and braces: the bound usually saves the wake, the breadcrumb always
// identifies the culprit.
type WakeTrace = Record<string, number | string>;

async function tracedStep<T>(
  label: string,
  trace: WakeTrace,
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  console.log(`[Geofence] wake-step → ${label}`);
  trace.at = label;                       // survives a freeze: last value = where we died
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(work)
        .catch((err) => { trace[`${label}_err`] = String(err).slice(0, 120); return null; }),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    const ms = Date.now() - startedAt;
    trace[label] = ms;
    if (result === null && ms >= timeoutMs) trace[`${label}_timeout`] = 1;
    console.log(`[Geofence] wake-step ← ${label} (${ms}ms)`);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Actively finds the 25 m crossing after a region ENTER, instead of waiting for
 *  the approach stream to deliver it.
 *
 *  THE BUG THIS FIXES (2026-08-03): the ENTER branch only escalated the location
 *  stream and then waited — so a check-in required that stream to be alive and
 *  delivering. It very often is not. On Android 12+ a foreground-service-backed
 *  stream CANNOT be started from a background context (the OS refuses), and
 *  setLocationStreamMode swallows that failure by design, so the stream silently
 *  stays dead; on iOS the baseline stream is fully off, so everything rides on one
 *  event. Result: neither platform re-checked in while backgrounded, and both only
 *  did so when the app was opened.
 *
 *  A one-shot position read needs NO foreground service and no running task, which
 *  is exactly why it works where the stream does not. The native region fires at
 *  the 120 m wake ring, so the user is typically still walking in — hence a short
 *  series of reads rather than a single one, stopping the moment a session starts.
 *
 *  It cannot check anyone in from 120 m away: every fix goes to
 *  evaluateLocationFix, the same and only authority that starts a session, which
 *  re-applies the true 25 m radius, the accuracy gate and the once-per-day guard.
 *  Bounded in both directions — a fixed attempt count and a per-read timeout — so
 *  it can never become the kind of unbounded wait that froze the wake path. */
// Mutable so tests can drive the poll without real 15 s waits: the geofence task
// AWAITS this (deliberately — that is what keeps the OS holding the task open for
// the walk-in), so a suite that fires an ENTER event would otherwise block for the
// full ~90 s and blow Jest's timeout. Overriding here beats branching on NODE_ENV
// inside the loop, which would mean the code under test is not the code that ships.
export const CHECKIN_POLL = {
  // ⚠ WAS 6 (90 s), sized for "a 120 m walk-in at normal pace". Real approaches are
  // not that tidy. Field 2026-08-09: the ring fired at 109 m, all six passes burned
  // by 11:26:04, and the owner did not cross the 20 m fence until ~11:29 — a
  // measured 3 m 56 s window in which NOTHING was watching. Car parks, lifts,
  // reception, changing rooms all live in that gap.
  //
  // For real users this poll is the ONLY cover: gym-visit-beacon ships
  // FLEET_INTERVAL_MIN = 0, so there is no periodic sweep behind it to catch what
  // it misses. That is what makes the gap unbounded in production rather than
  // merely slow, and why the count doubles rather than nudging.
  //
  // Still bounded in both directions (fixed count × per-read timeout), so it
  // cannot become the unbounded wait that froze the wake path. Passes are cheap:
  // each returns immediately once a session exists.
  attempts:      12,
  intervalMs:    15 * 1000,   // ~3 min of cover
  fixTimeoutMs:   8 * 1000,
};

/**
 * Acquire a fix preferring GPS, without letting that preference cost us a fix.
 *
 * `Accuracy.Balanced` maps to Android's PRIORITY_BALANCED_POWER_ACCURACY, whose
 * NOMINAL accuracy is ~100 m — precisely the value MAX_FIX_ACCURACY_M turns away.
 * Field 2026-08-09: every fix taken while the owner walked in read 350-700 m and
 * every geometric decision was skipped; the same handset read 17-20 m the moment
 * it stood still. Asking for High is what actually engages GPS.
 *
 * ⚠ But High ALONE is not safe. GPS cold-start indoors routinely outruns the wake
 * budget, and "no fix" is strictly worse than "coarse fix" — a coarse fix still
 * advances the time-based dwell, and refusing them once starved it for entire
 * in-gym sessions (07-03 / 07-11). So High gets the first, shorter slice of the
 * budget and Balanced catches whatever it misses.
 */
async function acquireFixPreferHigh(highMs: number, balancedMs: number): Promise<Location.LocationObject | null> {
  const race = async (accuracy: Location.Accuracy, ms: number): Promise<Location.LocationObject | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Location.getCurrentPositionAsync({ accuracy }).catch(() => null),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return (await race(Location.Accuracy.High, highMs)) ?? (await race(Location.Accuracy.Balanced, balancedMs));
}

async function pollForCheckIn(regionId: string): Promise<void> {
  for (let attempt = 0; attempt < CHECKIN_POLL.attempts; attempt++) {
    try {
      // Someone got there first (the stream, or a previous pass) — done.
      if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) return;

      // ⚠ The cache is only a shortcut when it can actually DECIDE. It used to be
      // taken unconditionally, which meant the walk-in was judged on whatever the
      // OS last happened to hold — on 2026-08-09 that was the 500 m network fix
      // the owner had been carrying for the previous half-mile, so all six passes
      // burned against a fix no gate would ever accept. A coarse cached fix now
      // yields to a real acquisition, and is still kept as the fallback.
      const cached = await Location.getLastKnownPositionAsync({ maxAge: 30_000 }).catch(() => null);
      const cachedUsable = !!cached
        && (cached.coords.accuracy == null || cached.coords.accuracy <= MAX_FIX_ACCURACY_M);
      const fix = cachedUsable
        ? cached
        : (await acquireFixPreferHigh(CHECKIN_POLL.fixTimeoutMs - 3_000, 3_000)) ?? cached;
      if (fix) {
        await evaluateLocationFix(fix.coords);
        // Re-check immediately rather than at the top of the next pass: that cost a
        // whole interval of the task's life and one redundant position read every
        // time the poll actually succeeded — which is the common case.
        if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) {
          logRegionEvent(regionId, 'checked_in', { via: 'enter_poll', attempt });
          return;
        }
      }
    } catch (err) {
      console.warn('[Geofence] Check-in poll pass failed:', err);
    }
    if (attempt < CHECKIN_POLL.attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, CHECKIN_POLL.intervalMs));
    }
  }
}

/** Periodic safety net for a MISSED CHECK-IN.
 *
 *  2026-08-03: after a walk-out and walk-back-in, NEITHER platform re-checked in
 *  while backgrounded — both only did so when the app was opened, despite the
 *  regions still being armed (their exits landed server-side). The two candidate
 *  causes need different long-term fixes (Android cannot restart its
 *  foreground-service-backed stream from the background — see the Android 12
 *  restriction; iOS drops its stream to fully off at baseline, so it depends
 *  entirely on the OS delivering region ENTER), but they share one remedy: stop
 *  depending on a single event, and re-check presence on a timer the OS already
 *  services for us.
 *
 *  This cannot fabricate a session: it hands the fix to evaluateLocationFix, the
 *  same and only authority that starts one, which re-applies the true 25 m radius
 *  and the once-per-day guard. A missed check-in is otherwise unrecoverable in the
 *  background — with no visit row the beacon has nothing to nudge, so the silent
 *  wakes we fixed today can never rescue it. */
/** PRESENCE SWEEP ON WAKE (2026-08-06) — entry detection that does not involve
 *  GMS geofences at all.
 *
 *  Why this exists: closed-app ENTRY via native fences has never once succeeded
 *  in the field, and the fence layer is the one part of the chain the device
 *  cannot inspect — `hasStartedGeofencingAsync` reports expo's task registry,
 *  not GMS's fence store, and GMS's accept/refuse verdict is discarded before
 *  it reaches JS. Meanwhile the FCM wake path has hundreds of recorded
 *  successes: a data-only push reaches the swiped app in ~100 ms and JS runs.
 *
 *  So: let the server ask "where are you?" and answer from the OS location
 *  cache. Detection latency becomes the ping interval instead of instant, but
 *  it runs on a primitive that WORKS, and it fails visibly (every ping either
 *  produces a row or does not) instead of failing silently in a layer we
 *  cannot read.
 *
 *  It changes no rules: evaluateLocationFix remains the sole authority that
 *  starts a session, so the 25 m radius, the daily cap, the partner map and
 *  every downstream guard apply unchanged. No fix, no check-in. */
export async function sweepForMissedCheckInFromWake(): Promise<void> {
  await sweepForMissedCheckIn();
}

/** SWEEP TELEMETRY (2026-08-07) — pure observation, no behaviour change.
 *
 *  The sweep's own docstring claims "it fails visibly — every ping either
 *  produces a row or does not". That was false: it emitted NOTHING, so its four
 *  exits were one indistinguishable silence, and 290 accepted `fence_refresh`
 *  pings had produced exactly zero evidence of anything. "The ping never reached
 *  JS", "a session was already stored", "the permission read said no", "the OS
 *  cache was empty" and "the fix was outside every circle" all looked the same.
 *
 *  Two rules this instrumentation follows, both learned the hard way:
 *
 *  1. THE ROW GOES BEFORE THE HANDOFF, NOT IN A `finally`. evaluateLocationFix
 *     reaches setActiveAndNotify, which awaits supabase.auth.getSession() and
 *     openGymVisit — the exact promise this codebase has twice recorded as never
 *     settling (gymVisits.ts:158, backgroundNotificationTask.ts:180). A suspended
 *     frame never reaches its `finally`, so a `finally`-emitted row would go
 *     missing precisely on the failure it exists to catch. Emitting first means a
 *     freeze leaves a 'handoff' row with no 'checked_in' after it — which names
 *     the freeze instead of hiding it.
 *
 *  2. IT GATES NOTHING. Every guard, threshold and early return below is byte-for
 *     -byte the behaviour that shipped; the only additions are logRegionEvent
 *     calls and two read-only helpers. In particular there is no partner-map
 *     gate: readPartnerMap swallows its own errors and returns null, and
 *     evaluateLocationFix does its own independent read — so gating on it here
 *     would trade a wasted scan for a lost check-in AND a lost arm re-target. */
async function sweepForMissedCheckIn(): Promise<void> {
  try {
    const active = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (active) { // already checked in
      // THE PERMISSION BACKSTOP (2026-08-09), and it goes FIRST because it is the
      // cheapest question and the most decisive answer. Note where the sweep's own
      // permission read sits: BELOW this branch, which returns before ever reaching
      // it — so an open session structurally MASKED the one state that makes it
      // unclosable. Every other detector here needs a fix that revoked location can
      // no longer produce, so without this the sweep's exit backstop is silently a
      // no-op exactly when it is needed most.
      if (await finalizeSessionIfLocationRevoked()) return;

      // THE EXIT BACKSTOP (2026-08-08). This used to return unconditionally, which
      // meant the ~5-6 min fence_refresh cadence — the thing that rescues a missed
      // CHECK-IN — was structurally incapable of rescuing a missed CHECK-OUT.
      // Check-in had three detectors and a scheduled backstop; check-out had the
      // native region exit and nothing else. Field 2026-08-08: Android's native
      // exit did not arrive for 13.1 minutes, every fix in the window was coarse
      // (so evaluateLocationFix's geometry never ran either), and the visit was
      // still open 25 minutes after the owner had walked 500 m away.
      //
      // ⚠ GATED ON PAST-UPGRADE, and that gate is not negotiable. Closing a visit
      // early kills the claim AND the bonus — 55 of 100 visits were once destroyed
      // exactly that way (see project_gym_session_day_uniqueness). Past the upgrade
      // there is nothing left to earn, so an early close forfeits nothing; this is
      // the same rationale the server-side reaper is gated on.
      //
      // Only ever acts on an UNAMBIGUOUS fix: trusted accuracy, and outside by more
      // than the exit hysteresis PLUS the fix's own error bar. Anything less and it
      // defers to the detectors that own the decision.
      let handled = false;
      try {
        const a = JSON.parse(active) as StoredGeofence;
        const elapsed = typeof a.entryTimestamp === 'number' ? Date.now() - a.entryTimestamp : 0;
        // ⚠ PROOF AND CLOSURE ARE DIFFERENT RISKS AND NO LONGER SHARE A GATE.
        // Everything below used to sit behind `elapsed >= upgradeMinutes`, which
        // made the sweep's proof stamp — the only repeating sweep-side carrier of
        // presence — unreachable for a visit's first 40 minutes. That is precisely
        // the window the 30-minute claim and the 20-minute unprovable-reaper both
        // live in, so the one branch able to prove a visit was structurally absent
        // from the only stretch where proof decides anything.
        //
        // Field 2026-08-14: an Android visit sat inside the fence answering every
        // wake, with a trusted 20 m fix in the sweep's own hand at +0 min, and was
        // closed at ZERO LENGTH with last_proven_at still NULL — twice — because
        // the code that would have banked that fix was forty minutes away. The
        // handset's dwell stream only ever reported the 100 m fused sentinel, which
        // evaluateLocationFix rightly refuses, so the sweep was the only honest
        // witness available and it had been told not to speak until too late.
        //
        // Closing early forfeits the claim AND the bonus (55 of 100 visits died
        // that way once), so CLOSING stays gated exactly as before. Proving costs
        // nothing and is now allowed from check-in onward.
        const pastUpgrade = elapsed >= getGymUpgradeMinutes() * 60_000;
        if (a.latitude != null && a.longitude != null && a.radius != null) {
          // ⚠ WAS `maxAge: 10 * 60_000`, and that made the backstop argue about
          // where the user was TEN MINUTES AGO. Field 2026-08-10: the user left at
          // 12:41, this branch ran at 12:44:02 and 12:47:11 against cached fixes
          // still placing them 27 m from the centre, and the native GMS exit beat
          // it by five and a half minutes — on the one platform this backstop
          // exists to rescue. The same staleness fed the check-in sweep a 294 s
          // old fix on the walk in.
          //
          // 90 s is one dwell-stream tick plus headroom: fresh enough that a
          // walk-out is visible, loose enough that a stationary phone still has
          // something to answer with. A missing fix is not a decision — the branch
          // simply does nothing, exactly as before.
          let fix = await Location.getLastKnownPositionAsync({ maxAge: EXIT_BACKSTOP_FIX_MAX_AGE_MS }).catch(() => null);
          let fixSrc: 'cache' | 'acquired' | 'acquired_high' | 'cache_after_acquire' = 'cache';
          if (!fix) {
            // ⚠ "A missing fix is not a decision" made this backstop BLIND on the
            // one platform it exists to rescue. Field 2026-08-11: the user walked
            // out at ~09:52, the dwell stream died with them (its newest fix aged
            // to 233 s), and every wake for the next 20 minutes found an empty
            // 90 s cache and did nothing — while the fused provider's cached
            // WiFi/cell pin kept claiming 16 m from centre at 226-1000 m
            // accuracy. A departed Android mints no fixes on its own, so waiting
            // passively meant waiting for the 45-minute reaper.
            //
            // So ASK, once, bounded, and only on this branch: past the upgrade
            // there is nothing left to earn, we are provably awake (this IS a
            // wake), and the race caps a hung acquisition at 10 s instead of the
            // whole sweep — the same hang class getArmFix refuses for the arm
            // path. Balanced, not High: outdoors-walking Balanced reads 20-50 m,
            // decisive against a ~120 m bound, without High's cost profile.
            // A null after the race leaves the branch doing nothing, as before —
            // but no longer silently.
            const acquireFix = (accuracy: Location.Accuracy) => Promise.race([
              Location.getCurrentPositionAsync({ accuracy }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), EXIT_BACKSTOP_ACQUIRE_TIMEOUT_MS)),
            ]).catch(() => null);
            const fixAgeMs = (f: Location.LocationObject | null) =>
              f ? Date.now() - f.timestamp : null;
            const isStale = (f: Location.LocationObject | null) => {
              const age = fixAgeMs(f);
              return age != null && age > EXIT_BACKSTOP_FIX_MAX_AGE_MS;
            };

            let acquired = await acquireFix(Location.Accuracy.Balanced);
            fixSrc = 'acquired';
            if (isStale(acquired)) {
              // ⚠ AN "ACQUIRED" FIX CAN BE A CACHED ONE WEARING A NEW REQUEST.
              // Field 2026-08-11 PM: this branch fired as designed, but Balanced
              // getCurrentPositionAsync let the fused provider answer with the
              // SAME five-minute-old WiFi/cell pin twice in a row — which then
              // voted "inside" for a user long gone. Balanced is allowed to
              // satisfy a request from cache; only its accuracy is a hint, its
              // freshness is not. So the 90 s cache gate applies to ACQUIRED
              // fixes too — a stale answer is no answer.
              //
              // Escalate once to High before giving up: High compels an actual
              // hardware measurement rather than a cache read, and its cost
              // profile is acceptable here precisely because this branch is
              // rare, past-upgrade, and already provably awake. Same 10 s race.
              acquired = await acquireFix(Location.Accuracy.High);
              fixSrc = 'acquired_high';
            }
            if (!acquired || isStale(acquired)) {
              // ⚠ RE-READ THE CACHE AFTER THE RACES, NOT BEFORE THEM ONLY.
              // The cache read at the top of this branch is what got us here — it
              // returned nothing. But up to 20 s of acquisition has run since
              // (Balanced, then High), and a getCurrentPositionAsync that misses
              // OUR 10 s race very often still completes inside the provider and
              // lands in last-known a moment later. Asking again after the races
              // costs one cheap call and catches exactly that: the fix our own
              // request produced, arriving too late to be returned to us.
              //
              // Field 2026-08-14 PM: two of four post-upgrade sweeps ended
              // acquire_timeout with nothing recorded, on a walk-out where the
              // same handset's upgrade nudge had credited presence ninety seconds
              // earlier off a 24.7 s fix. Those passes had no second look.
              //
              // This is NOT a relaxation of the freshness rule. `isStale` still
              // applies, so a WiFi/cell pin older than EXIT_BACKSTOP_FIX_MAX_AGE_MS
              // is rejected here exactly as an acquired one is, and the 08-11 PM
              // failure — a five-minute-old pin voting "inside" for a user long
              // gone — stays impossible. Same bar, one more chance to clear it.
              const lateCache = await Location.getLastKnownPositionAsync({
                maxAge: EXIT_BACKSTOP_FIX_MAX_AGE_MS,
              }).catch(() => null);

              if (lateCache && !isStale(lateCache)) {
                acquired = lateCache;
                fixSrc   = 'cache_after_acquire';
              } else {
                // The starved case, previously invisible — the silence that made
                // the 08-11 twenty-minute open visit unreadable live. A stale
                // survivor lands here too (as acquire_timeout): rejected, not
                // reasoned about — but its age is logged so a cache-serving
                // provider shows up in the field as what it is. The last-known
                // age rides along so "we asked and it was stale too" is
                // distinguishable from "there was nothing to ask for".
                const staleAge = fixAgeMs(acquired);
                const lateCacheAge = fixAgeMs(lateCache);
                // ⚠ ONE LABEL WAS COVERING THREE DIFFERENT BUGS (2026-08-17).
                // `acquire_timeout` was written whether the provider returned
                // NOTHING, returned a fix we then rejected as stale, or returned
                // nothing while last-known held something stale — and those need
                // three different fixes. Field 08-17 logged it five times on one
                // visit with stale_age_s 114/136/177/197/235, and we could not say
                // which of the three we were looking at.
                //
                // `answered` names the slice that produced anything at all;
                // `blocked_by` says why the answer was refused. `late_cache_age_s`
                // was ALREADY being logged here and nobody ever read it.
                const answered = acquired ? 'acquire_stale'
                  : lateCache ? 'late_cache_stale'
                  : 'nothing';
                // ⚠ AND THE OUTCOME NAME WAS A LIE BEFORE THE UPGRADE. This row is
                // hardcoded 'exit_check', but that name means "deciding whether to
                // CLOSE", which is only true past the upgrade. Pre-upgrade this
                // pass exists purely to bank presence, and mislabelling it made
                // 08-17's pre-upgrade starvation read as exit deliberation.
                logRegionEvent(a.regionId ?? 'sweep', 'sweep', {
                  outcome:     pastUpgrade ? 'exit_check' : 'presence_pass',
                  fix_src:     'acquire_timeout',
                  answered,
                  ...(staleAge != null ? { stale_age_s: Math.round(staleAge / 1000) } : {}),
                  ...(lateCacheAge != null ? { late_cache_age_s: Math.round(lateCacheAge / 1000) } : {}),
                  elapsed_min: Math.round(elapsed / 60_000),
                  // THE CLOCK TRIPLE. Every age gate in this system derives from
                  // `Date.now() - fix.timestamp`, and that arithmetic is only
                  // meaningful if the two clocks agree. A handset whose
                  // `location.time` is skewed would produce exactly the readings
                  // above while being perfectly fresh — in which case
                  // MAX_CREDIT_FIX_AGE_MS, EXIT_BACKSTOP_FIX_MAX_AGE_MS and
                  // isStale are ALL poisoned and several fixes are invalid. Three
                  // numbers settle it, and they cost nothing.
                  now_ms:      Date.now(),
                  fix_ts:      (acquired ?? lateCache)?.timestamp ?? null,
                });
                acquired = null;
              }
            }
            fix = acquired;
          }
          const acc = fix?.coords.accuracy ?? null;
          // `<=`, deliberately NOT the `>=` used by evaluateLocationFix's isCoarse.
          // That gate rejects exactly-100 because a wrong answer there INVENTS or
          // destroys a session. Here a wrong answer costs nothing: this branch only
          // runs past the upgrade, where there is nothing left to earn, and it still
          // demands `dist > radius + hysteresis + acc` — so a 100 m fix must place
          // the user 170 m away before it acts. The error bar widens the bound it
          // has to clear, which is its own protection.
          //
          // ⚠ Excluding exactly 100 made this backstop INERT ON ANDROID from the day
          // it shipped. 100 is not a sentinel there, it is the modal reading —
          // Accuracy.Balanced's nominal figure, 5 of 10 samples on 08-07→08-09.
          // Field 2026-08-09: iOS closed itself on acc 42 / dist 197; Android, same
          // code and minutes, returned session_active with no geometry computed and
          // could not close at all.
          // ⚠ THE ACCURACY GATE IS NO LONGER A PRECONDITION, and that is the point.
          // It used to read `acc <= MAX_FIX_ACCURACY_M`, which skipped the geometry
          // entirely on a coarse fix — so a device reporting 900 m could never close,
          // however far it had gone. Field 2026-08-10: Android sat 334 m away and iOS
          // 544 m, both indefinitely, both billing time.
          //
          // A coarse fix is now allowed to argue for an exit; it just cannot win the
          // argument alone. Precision is replaced by CORROBORATION — see
          // EXIT_READINGS_REQUIRED. And the whole branch still only runs past the
          // upgrade, where nothing remains to earn, so the cost of being wrong is a
          // slightly short duration, against inflated durations and phantom earnings
          // for being unable to act at all.
          if (fix) {
            const dist = haversineMetres(fix.coords.latitude, fix.coords.longitude, a.latitude, a.longitude);
            // Bounded: see EXIT_ACCURACY_CREDIT_CAP_M. Unbounded, this term made
            // exit unreachable exactly when the device was least able to judge —
            // 900 m accuracy demanded 970 m of distance, so a phone 334 m away
            // stayed checked in indefinitely (field 2026-08-10).
            const { exitBoundM, EXIT_READINGS_REQUIRED, fixCreditsPresence } = await import('@/lib/health/gymPresence');
            const bound = exitBoundM(a.radius, LOCATION_EXIT_HYSTERESIS_M, acc);
            const trusted = acc == null || acc <= MAX_FIX_ACCURACY_M;

            // ⚠ EXIT STATE IS ONLY TOUCHED PAST THE UPGRADE. Pre-upgrade this pass
            // exists to PROVE, not to judge departure: accumulating a streak here
            // would let readings banked during the earning window fire a close the
            // instant the upgrade threshold ticked over, which is the early-close
            // failure this gate was built to prevent, arriving by a side door.
            let readings = 0;
            if (pastUpgrade) {
              if (dist > bound) {
                readings = Number((await AsyncStorage.getItem(EXIT_STREAK_KEY).catch(() => null)) ?? 0) + 1;
                await AsyncStorage.setItem(EXIT_STREAK_KEY, String(readings)).catch(() => {});
              } else {
                // One reading back inside breaks the run — a departure has to be
                // uninterrupted, or a user pacing near the boundary would accumulate
                // an exit across an entire session.
                await AsyncStorage.removeItem(EXIT_STREAK_KEY).catch(() => {});
              }
            }

            // A trusted fix is decisive by itself; a coarse one must be corroborated.
            if (pastUpgrade && dist > bound && (trusted || readings >= EXIT_READINGS_REQUIRED)) {
              logRegionEvent(a.regionId ?? 'sweep', 'sweep', {
                outcome: 'exit_backstop',
                distance_m: Math.round(dist),
                bound_m: Math.round(bound),
                acc_m: acc != null ? Math.round(acc) : null,
                elapsed_min: Math.round(elapsed / 60_000),
                trusted,
                readings,
                fix_src: fixSrc,
              });
              await AsyncStorage.removeItem(EXIT_STREAK_KEY).catch(() => {});
              // No recordBackgroundHealth here: this branch returns above the
              // sweep's permission read, so it cannot say anything about the
              // permission, and a non-observation must never overwrite a real
              // 'no_permission'. See lib/backgroundHealth.ts.
              await finalizeActiveGeofence();
              handled = true;
            } else {
              // ⚠ THE SILENT CASE IS WHY 2026-08-10 WAS UNREADABLE. This branch
              // used to log NOTHING unless it fired, so three consecutive sweeps
              // during a real walk-out produced `session_active` rows carrying no
              // geometry at all — indistinguishable from "the backstop never ran",
              // "it ran and found us inside", and "it is one reading short". It is
              // the same blind spot that cost the 08-08 run its certainty on
              // evaluateLocationFix, fixed there and not here.
              //
              // The sweep is already ~3 min apart and this only runs past the
              // upgrade, so an unthrottled row costs nothing.
              // Two different questions wear two different names, so the field
              // trail says which one was being asked: past the upgrade this pass
              // is deciding whether to CLOSE ('exit_check'); before it, the close
              // is not on the table and the pass exists purely to bank presence
              // ('presence_pass'). Reading a run is hard enough without one label
              // covering both.
              logRegionEvent(a.regionId ?? 'sweep', 'sweep', {
                outcome:     pastUpgrade ? 'exit_check' : 'presence_pass',
                distance_m:  Math.round(dist),
                bound_m:     Math.round(bound),
                acc_m:       acc != null ? Math.round(acc) : null,
                fix_age_s:   Math.round((Date.now() - fix.timestamp) / 1000),
                elapsed_min: Math.round(elapsed / 60_000),
                trusted,
                readings,
                fix_src:     fixSrc,
              });

              // PROOF STARVATION (field 2026-08-12): this branch is the ONLY
              // repeating post-upgrade path that measures presence — the nonce
              // presence pass had gone quiet and the sweep's trusted 11 m / 4 m
              // reading here never reached last_proven_at, so the reaper's
              // stale-close clamped an honest 73-minute session back to its
              // 09:30 upgrade stamp (4371 s → 2457 s, the #345 shrink, writer
              // №3). When the fix would CREDIT presence — the strict test, same
              // rule the server's v_proven mirrors — spend one confirm
              // round-trip so the proof clock advances. Throttled: sweeps are
              // minutes apart, but an arm-storm must not turn this into a
              // confirm storm.
              const fixAgeMs = Date.now() - fix.timestamp;
              if (Date.now() - _lastSweepProvenStampAt > 4 * 60_000
                  && fixCreditsPresence({
                       fixTrusted: trusted,
                       distanceM:  dist,
                       radiusM:    a.radius ?? null,
                       accuracyM:  acc,
                       fixAgeMs,
                     })) {
                // A missing visit id must not starve the proof clock: Android's
                // background check-in path can still lose the stamp (field
                // 2026-08-12 PM — every sweep carried visit:null all session),
                // and this branch was the only proof carrier. open_gym_visit
                // re-uses the caller's open visit, so resolving here is a
                // no-op server-side; the patch stamps it for every later pass.
                let visitId = a.visitId ?? null;
                if (!visitId && a.partnerId) {
                  try {
                    visitId = await openVisitTraced(
                      'sweep_proven_stamp', a.partnerId, a.regionId, a.entryTimestamp, a.visitId ?? null,
                    );
                    if (visitId) {
                      await patchActiveGeofence(a, { visitId }, 'sweep_proven_stamp');
                      a.visitId = visitId;
                    }
                  } catch { visitId = null; }
                }
                if (visitId) {
                  _lastSweepProvenStampAt = Date.now();
                  const { confirmGymVisit } = await import('@/lib/gymVisits');
                  // ⚠ THE CATCH BELOW CANNOT FIRE ON A FAILED CONFIRM (2026-08-17).
                  // confirmGymVisit catches everything on BOTH transports and
                  // returns { ok: false } — it never rejects. So the `.catch()`
                  // added on 08-14 to end exactly this mystery could only ever
                  // catch the dynamic import, and the return value was thrown
                  // away. Field 08-17: two sweeps held creditable fixes, produced
                  // no confirmed_inside, and wrote NEITHER proven_stamp_failed
                  // NOR proven_stamp_no_visit — three absences that read as a
                  // freeze and are equally consistent with a soft `ok: false`.
                  // Capture the result; the catch stays for the import only.
                  //
                  // fix_age_s, not fix_age_ms: the server's proof gate reads
                  // `fix_age_s` and treats a missing value as acceptable, so
                  // every sweep-originated proof has been bypassing the freshness
                  // check on the one column the exit clamp anchors to.
                  const res = await confirmGymVisit(visitId, true, {
                    stage:       'sweep',
                    distance_m:  Math.round(dist),
                    accuracy_m:  acc != null ? Math.round(acc) : null,
                    fix_trusted: trusted,
                    fix_age_s:   Math.round(fixAgeMs / 1000),
                  }).catch((err) => {
                    // ⚠ THIS CATCH USED TO BE SILENT, and that is what cost the
                    // 2026-08-14 PM run its answer. The sweep held a TRUSTED 25 s
                    // fix at 58 m against a 40 m radius — every upstream gate said
                    // stamp — and `last_proven_at` never moved off the 11:25:03
                    // upgrade. With no row for the failure there was no way to
                    // separate "the confirm threw" from "the block was never
                    // reached", so the walk-out clamp (40.4 min recorded for a
                    // 50-minute visit) could only be explained by guessing.
                    //
                    // A lost stamp is still only one sweep interval of proof. It
                    // must not also be one sweep interval of MYSTERY.
                    //
                    // The throttle is released too: it was armed before the await
                    // on the assumption the stamp lands, so a throw left the proof
                    // clock idle for a further four minutes on top of the one it
                    // just lost. A failure should earn a retry, not a cooldown.
                    _lastSweepProvenStampAt = 0;
                    logRegionEvent(a.regionId ?? 'sweep', 'sweep', {
                      outcome: 'proven_stamp_failed',
                      visit:   visitId,
                      reason:  'import_failed',
                      error:   String((err as Error)?.message ?? err).slice(0, 120),
                    });
                  });
                  // THE FAILURE THAT ACTUALLY HAPPENS. `ok: false` is what a dead
                  // background transport returns — a spent persisted token with
                  // the device ticket deliberately excluded from confirms — and it
                  // reached here as a discarded value. Same treatment as a throw:
                  // name it, and release the four-minute cooldown so the next
                  // sweep re-attempts instead of inheriting a penalty for it.
                  if (res && !res.ok) {
                    _lastSweepProvenStampAt = 0;
                    logRegionEvent(a.regionId ?? 'sweep', 'sweep', {
                      outcome: 'proven_stamp_failed',
                      visit:   visitId,
                      reason:  'not_ok',
                    });
                  }
                } else {
                  // Measured presence with nowhere to record it: the recovery
                  // above could not resolve a visit (no partnerId on the snapshot,
                  // or open_gym_visit itself failed). Previously indistinguishable
                  // from the stamp never being attempted.
                  logRegionEvent(a.regionId ?? 'sweep', 'sweep', {
                    outcome:    'proven_stamp_no_visit',
                    partner_id: a.partnerId ?? null,
                    has_geom:   true,
                  });
                }
              }
            }
          }
        }
      } catch { /* never let the backstop break the sweep's own row */ }
      if (handled) return;

      // Names the blocker: the reconcile is the only thing that can clear this and
      // it ran immediately before us, so `has_geom: false` here is also the reason
      // it declined (its discriminator needs geometry it does not have).
      logRegionEvent('sweep', 'sweep', { outcome: 'session_active', ...describeStoredSession(active) });
      // ⚠ DELIBERATELY NO recordBackgroundHealth. This branch is above the
      // permission read, and in the live 'observe' close mode a session whose
      // permission was revoked is left open on purpose — a device with no grant
      // can never obtain the fix that would close it, so every later wake would
      // land here and rewrite the record indefinitely, hiding the banner
      // forever on precisely the devices it was built for.
      return;
    }
    const { status } = await Location.getBackgroundPermissionsAsync()
      .catch(() => ({ status: 'denied' as Location.PermissionStatus }));
    if (status !== 'granted') {
      // Deliberately still a hard return — a throw reads as denial, and failing
      // open here would start sessions on a "While Using" device that has no
      // mechanism left to close them. The row only makes the refusal visible.
      logRegionEvent('sweep', 'sweep', { outcome: 'no_permission', perm_bg: String(status) });
      // THE ONE VERDICT THE USER CAN ACT ON, and the only one this device can
      // state with certainty: a headless context tried to work and was refused.
      // The foreground cannot reach this conclusion on its own — it demonstrably
      // reads 'always' on devices writing this very row (see lib/backgroundHealth).
      await recordBackgroundHealth('no_permission', String(status));
      return;
    }

    // APPROACH-PENDING ESCALATION (field 2026-08-12 PM). The iOS walk-in: region
    // ENTER fired at 18:38:20, enterApproach stored its state and the approach
    // stream reported itself on — and then the stream produced NOTHING for 6.5
    // minutes while the owner stood inside the fence. The enter-poll froze with
    // the suspended process (attempt 0 at 90 m out, attempt 1 six and a half
    // minutes later, thawed by an app open). Every rescue this sweep could have
    // staged was cache-only — and the freshest thing in the OS cache was the
    // enter scan's own fix, taken while the owner was still 90 m OUT. A wake
    // delivered mid-approach would have sworn the user was outside on the
    // strength of where they USED to be.
    //
    // So: while an approach is pending, a delivered wake is the rescue path for
    // a silent stream, and it must judge the PRESENT. Mirror one pass of
    // pollForCheckIn exactly — a fresh accurate cache may decide; anything
    // stale or coarse earns one bounded real acquisition (same budgets, same
    // High-then-Balanced ladder, hang-capped like every acquisition on a wake).
    // Absent an approach, the path below is byte-for-byte the cheap one that
    // shipped — this runs on the OS's schedule, and an unconditional
    // acquisition per wake is a battery bill with no payer.
    //
    // approach_age_s rides every row it touches: the stream should resolve an
    // approach in seconds, so a large age on a sweep row IS the "stream went
    // silent" conviction the 08-12 PM run had no way to record.
    let approachAgeS: number | null = null;
    try {
      const rawApproach = await AsyncStorage.getItem(APPROACH_STATE_KEY);
      const since = rawApproach ? (JSON.parse(rawApproach) as { since?: number }).since : undefined;
      if (typeof since === 'number') approachAgeS = Math.round((Date.now() - since) / 1000);
    } catch { /* unreadable approach state — the cheap path still covers it */ }

    // Cheap sources only — this runs on the OS's schedule, not in a wake window,
    // but an unbounded acquisition here would hang exactly like the wake path did.
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
    let fix = cached;
    let fixSrc: 'cache' | 'acquired' = 'cache';
    if (approachAgeS != null) {
      const cachedUsable = !!cached
        && (Date.now() - cached.timestamp) <= 30_000
        && (cached.coords.accuracy == null || cached.coords.accuracy <= MAX_FIX_ACCURACY_M);
      if (!cachedUsable) {
        const acquired = await acquireFixPreferHigh(CHECKIN_POLL.fixTimeoutMs - 3_000, 3_000);
        if (acquired) { fix = acquired; fixSrc = 'acquired'; }
      }
    }
    if (!fix) {
      // The prime suspect on iOS: BASELINE_STREAM_MODE is 'off', so with the app
      // swiped nothing feeds the OS cache and it ages past ten minutes.
      logRegionEvent('sweep', 'sweep', {
        outcome: 'no_fix',
        ...(approachAgeS != null ? { approach_age_s: approachAgeS } : {}),
      });
      // Safe to record: only reachable below the `status === 'granted'` gate, so
      // it DOES observe a live grant even though it found no usable fix.
      await recordBackgroundHealth('no_fix', String(status));
      return;
    }

    logRegionEvent('sweep', 'sweep', {
      outcome: 'handoff',
      acc_m:   fix.coords.accuracy != null ? Math.round(fix.coords.accuracy) : null,
      age_s:   Math.round((Date.now() - fix.timestamp) / 1000),
      ...(approachAgeS != null ? { approach_age_s: approachAgeS, fix_src: fixSrc } : {}),
      ...(await nearestPartnerMetres(fix.coords)),
    });
    // Healthy. Recorded like every other branch so a granted permission
    // OVERWRITES a stale 'no_permission' and the banner retires itself on the
    // next sweep — no foreground probe, no dismissal bookkeeping.
    await recordBackgroundHealth('handoff', String(status));

    await evaluateLocationFix(fix.coords);

    // Mirrors pollForCheckIn's row exactly, so "which detector started this
    // session?" is one query across both. Until this lands, every checked_in row
    // in the table is via:'enter_poll' — and that has been unfalsifiable, because
    // a sweep success would not have logged anything either.
    const after = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (after) {
      let regionId = 'sweep';
      try { regionId = (JSON.parse(after) as StoredGeofence).regionId ?? 'sweep'; } catch { /* synthetic id */ }
      logRegionEvent(regionId, 'checked_in', { via: 'sweep' });
    }
  } catch (err) {
    logRegionEvent('sweep', 'sweep', { outcome: 'error', err: String(err).slice(0, 120) });
    // No health write: a throw can happen either side of the permission read,
    // so this branch cannot claim to have observed anything.
    console.warn('[Geofence] Missed check-in sweep failed:', err);
  }
}

/** Names a fix that was too coarse to make a geometric decision.
 *
 *  Both `isCoarse` branches in evaluateLocationFix used to return in silence,
 *  which made "the stream never delivered" and "the stream delivered twelve
 *  fixes and every one was gated" produce byte-identical telemetry. On
 *  2026-08-08 that cost a whole field run's worth of certainty: iOS checked in
 *  2m24s after entering the approach ring, from the SWEEP rather than the
 *  approach stream the design says is "the only thing that starts a session",
 *  and there was no way to tell which of the two had happened.
 *
 *  This is the same blind spot the sweep instrumentation was written to close —
 *  that fix landed on the sweep and not on the function that actually decides
 *  check-ins and check-outs.
 *
 *  Throttled hard (one row per 5 min per reason): a dwell stream ticks every
 *  ~60 s and an approach stream every 8 s, so an unthrottled row here would
 *  bury the table the way stream_tick did. */
let lastCoarseLogAt: Record<string, number> = {};
function logCoarseRejection(
  reason: 'dwell_tick' | 'enter_blocked',
  coords: { latitude: number; longitude: number; accuracy: number | null },
  active: StoredGeofence | null,
): void {
  const now = Date.now();
  if (now - (lastCoarseLogAt[reason] ?? 0) < 5 * 60_000) return;
  lastCoarseLogAt[reason] = now;
  let distance: number | null = null;
  if (active?.latitude != null && active?.longitude != null) {
    distance = Math.round(haversineMetres(coords.latitude, coords.longitude, active.latitude, active.longitude));
  }
  logRegionEvent(active?.regionId ?? 'fix', 'coarse_rejected', {
    reason,
    acc_m: coords.accuracy != null ? Math.round(coords.accuracy) : null,
    distance_m: distance,
    gate_m: MAX_FIX_ACCURACY_M,
  });
}

/** Names an ENTER scan that looked at the cached circles and started nothing.
 *
 *  The scan's two negative outcomes were both silent returns, so "the partner map
 *  was missing" and "the map was fine and you were genuinely outside every circle"
 *  produced identical evidence: none. That is precisely the pair 2026-08-08 could
 *  not distinguish when Android reported a trusted fix 16–17 m from a 25 m fence
 *  and never checked in.
 *
 *  Same throttle discipline as logCoarseRejection — this sits on the location
 *  stream, which ticks every 8 s inside an approach ring. */
let lastEnterScanLogAt: Record<string, number> = {};
function logEnterScan(
  reason: 'map_unavailable' | 'no_match_in_ring',
  coords: { latitude: number; longitude: number; accuracy: number | null },
  nearestM: number | null,
  nearestId: string | null,
  scanned: number,
): void {
  const now = Date.now();
  if (now - (lastEnterScanLogAt[reason] ?? 0) < 5 * 60_000) return;
  lastEnterScanLogAt[reason] = now;
  logRegionEvent(nearestId ?? 'fix', 'enter_scan', {
    reason,
    acc_m: coords.accuracy != null ? Math.round(coords.accuracy) : null,
    nearest_m: nearestM != null ? Math.round(nearestM) : null,
    scanned,
  });
}

/** Read-only description of a stored session, for the sweep's blocked row.
 *  Never throws: a corrupt record must still produce a row. */
function describeStoredSession(raw: string): Record<string, unknown> {
  try {
    const a = JSON.parse(raw) as StoredGeofence;
    return {
      partner:  a.partnerName ?? null,
      age_min:  typeof a.entryTimestamp === 'number' ? Math.round((Date.now() - a.entryTimestamp) / 60_000) : null,
      has_geom: a.latitude != null && a.longitude != null && a.radius != null,
      visit:    a.visitId ?? null,
    };
  } catch {
    return { parse: 'failed' };
  }
}

/** Distance to the nearest cached partner — the one number that separates
 *  "outside every circle" from "inside one and the gate refused it". Cache-only
 *  and memoised (evaluateLocationFix reads the same map moments later), and it
 *  returns nulls rather than throwing so it can never gate the sweep. */
async function nearestPartnerMetres(
  c: { latitude: number; longitude: number },
): Promise<{ nearest_m: number | null; nearest_id: string | null }> {
  try {
    const map = await readPartnerMap();
    if (!map) return { nearest_m: null, nearest_id: null };
    let best: { id: string; m: number } | null = null;
    for (const [regionId, e] of Object.entries(map)) {
      if (e.lat == null || e.lng == null) continue;
      const m = haversineMetres(c.latitude, c.longitude, e.lat, e.lng);
      if (!best || m < best.m) best = { id: regionId, m };
    }
    return best ? { nearest_m: Math.round(best.m), nearest_id: best.id } : { nearest_m: null, nearest_id: null };
  } catch {
    return { nearest_m: null, nearest_id: null };
  }
}

/** Enters the approach ring for a gym: escalate to the high-accuracy stream so
 *  evaluateLocationFix can catch the precise 25 m crossing. No session/notification
 *  is started here — that's evaluateLocationFix's job, at the true radius. */
async function enterApproach(regionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(APPROACH_STATE_KEY, JSON.stringify({ regionId, since: Date.now() }));
  } catch { /* non-fatal */ }
  const res = await setLocationStreamMode('approach');
  // Pairs with the 'enter' row: this one landing means the OS delivered ENTER
  // *and* we got the high-accuracy stream running, so any missing check-in after
  // this point is the stream failing to produce an inside fix — not a missed
  // region event. Two rows, two distinct failure modes, no guessing.
  //
  // ⚠ The claim above was UNVERIFIED until 2026-08-17: setLocationStreamMode
  // returned void and swallowed every failure, so this row asserted a running
  // stream it had no way to know about. It is now the function's own verdict,
  // cross-checked against the OS registry — because `started` says our start call
  // returned and `has_started` says the OS agrees a task is registered, and a
  // disagreement between those two is its own bug worth catching. A row with
  // `started: true` and no `stream_first_tick` behind it now convicts the stream
  // rather than the region event.
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false);
  logRegionEvent(regionId, 'approach_stream_on', {
    started:     res.started,
    running_mode: res.mode,
    has_started: hasStarted,
  });
  console.log(`[Geofence] Approach ring "${regionId}" — stream started=${res.started} mode=${res.mode}.`);
}

/** Leaves the approach ring: clear the flag and return the stream to baseline
 *  (Android passive / iOS off). No-op-cheap when we weren't escalated. An approach
 *  EXIT can arrive while a session is still ACTIVE (GPS jitter on the 120 m ring),
 *  so a live visit keeps the time-driven dwell stream rather than dropping to the
 *  displacement-gated baseline, which would starve the dwell machine. */
async function exitApproach(expectedRegionId?: string): Promise<void> {
  let wasApproaching = false;
  try {
    const raw = await AsyncStorage.getItem(APPROACH_STATE_KEY);
    const approach = raw ? JSON.parse(raw) as { regionId?: string } : null;
    if (expectedRegionId && approach?.regionId && approach.regionId !== expectedRegionId) return;
    wasApproaching = approach != null;
    if (wasApproaching) await AsyncStorage.removeItem(APPROACH_STATE_KEY);
    // Re-arm the one-shot so the NEXT approach gets its own first-tick row. Reset
    // here rather than on entry: enterApproach can be re-delivered by an arm
    // burst (08-17 fired it twice in 26 s), and resetting there would let one
    // approach emit two rows.
    if (wasApproaching) _approachFirstTickEmitted = false;
  } catch { /* non-fatal */ }
  if (wasApproaching) {
    const sessionActive = (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY).catch(() => null)) != null;
    const next = visitStreamMode(Platform.OS, { sessionActive, approaching: false });
    await setLocationStreamMode(next);
    console.log(`[Geofence] Left approach ring — location stream → ${next}.`);
  }
}

// ─── Shared session recording ─────────────────────────────────────────────────
// Called by both the foreground dwell timer and the background exit handler.

// In-flight guard: prevents the SAME dwell session being recorded/claimed twice
// concurrently within this JS context — e.g. the 10 s poll racing the AppState
// 'active' handler, both hitting the "dwell already met" path before either has
// written sessionRecorded. Without it, two claim-points calls slip past the
// (non-atomic) server-side "already claimed" check and the user is awarded twice,
// and a stale write can clobber the stored sessionId so the 40-min upgrade never
// schedules. The DB unique index is the cross-context backstop (the background
// task runs in a separate JS context and can't share this map).
//
// The lock is a LEASE, not a permanent claim. RN drives setTimeout off the UI
// frame clock, so with the app backgrounded/screen off the withNetworkTimeout
// race can simply never fire — a hung request then holds this lock forever and
// every tick's retry bounces off it: the claim livelocks until the next app-open
// (field-caught 2026-07-14, visit 329f4a72). A holder older than the lease is
// therefore presumed dead and the lock is stolen; the loser's write is fenced by
// the stamp check in the finally below, and a zombie request that eventually
// lands is absorbed by the sessions unique index / claim-points idempotency.
const _recordingInFlight = new Map<string, number>();
const STALE_CLAIM_LOCK_MS = 2 * 60 * 1000;
// Inside an FCM wake window the lease shrinks: any attempt started before the
// wake is doomed (its radio window is gone), and the wake's own ~10 s window
// must not be wasted honouring it. See runVisitCheck.
const WAKE_STALE_CLAIM_LOCK_MS = 15 * 1000;

// How old the stream's persisted fix may be before the wake path stops treating
// it as presence proof. Generous next to the 60 s getLastKnownPositionAsync
// window because it is the fallback, not the first choice — but far short of the
// 30-min dwell threshold, so it can never stand in for having actually been here.
const STREAM_FIX_MAX_AGE_MS = 5 * 60 * 1000;
// Hard bound on a from-scratch GPS acquisition inside a wake window. The FCM
// window is ~10 s; anything slower than this has already lost the round-trip.
const FIX_ACQUIRE_TIMEOUT_MS = 8 * 1000;
// Bound for the cheap steps (a storage read, a cached-location read). Any of these
// taking longer than this is not slow, it is hung — and the wake has to move on.
const STEP_TIMEOUT_MS = 3 * 1000;

// Minimum spacing between foreground tier-upgrade attempts. The upgrade branch
// re-runs on the 10 s scheduleDwellTimer poll, and a server-side rejection
// (threshold not reached yet) is permanent until time passes — retrying faster
// than this is pure hammering.
let _lastUpgradeAttemptAt = 0;
const UPGRADE_ATTEMPT_BACKOFF_MS = 60 * 1000;

async function recordDwellSession(activeGeofence: StoredGeofence, staleLockMs: number = STALE_CLAIM_LOCK_MS): Promise<{ outcome: 'claimed' | 'too_short' | 'error' | 'in_flight' | 'relayed'; sessionId?: string; earned?: number; currentStreak?: number }> {
  const lockKey = `${activeGeofence.partnerId}:${activeGeofence.entryTimestamp}`;
  const heldSinceMs = _recordingInFlight.get(lockKey);
  if (heldSinceMs != null && Date.now() - heldSinceMs < staleLockMs) {
    console.log('[Geofence] recordDwellSession already in flight for this session — skipping duplicate.');
    return { outcome: 'in_flight' };
  }
  if (heldSinceMs != null) {
    console.warn('[Geofence] In-flight claim lock is stale — presuming the attempt dead and taking over.');
  }
  const myLockStamp = Date.now();
  _recordingInFlight.set(lockKey, myLockStamp);

  // Use the frozen exit time when present (post-exit retry) so a claim that runs
  // minutes/hours later still records the real session length — not entry→now,
  // which would keep growing and wrongly cross the 40-min tier.
  // A finalized exit carries a frozen endedAtMs. A LIVE session has none, and this
  // used to fall straight through to Date.now() — which is an assumption that the
  // user is still here, not evidence of it. Combined with the NEVER SHRINK rule
  // below, every retry then "extended" the row to the current clock: field
  // 2026-08-07 watched one session go 2400s (exactly 40.0 min) → 3598s (exactly
  // 60.0 min) while its owner stood 400 m away, and it was still climbing. That is
  // where the 12-hour session rows come from — not one bad write, but a duration
  // that tracks wall-clock for as long as the visit fails to close.
  //
  // Bound it by the same evidence the wake reconciler uses: VISIT_TICK_KEY, the
  // last moment the device actually PROVED it was inside (stream heartbeats +
  // confirmed-inside wakes).
  //
  // The eligibility guard is load-bearing, not caution. A stale tick could
  // otherwise clamp a genuine claim below the dwell minimum, and the server would
  // reject it 422 — the exact wedge the NEVER SHRINK comment records from
  // 2026-08-06. So the bound is only applied when it still describes a claimable
  // session; below that we keep the old behaviour and let the claim through.
  let endedAtMs = activeGeofence.endedAtMs ?? Date.now();
  if (activeGeofence.endedAtMs == null) {
    try {
      // ⚠ TWO KEYS, AND THE CEILING IS THE *LIVENESS* ONE — NOT THE CREDIT ONE.
      //
      // This read VISIT_TICK_KEY alone. PR #374 then repurposed that key from an
      // unconditional heartbeat stamp into the CREDIT floor, gated on
      // fixCreditsPresence, and taught finalize to delete it. On Android every fix
      // reports accuracy exactly 100 against a `< 100` test, so from #374 onward
      // the key is stamped NEVER — and with no ceiling this fell through to
      // Date.now() and grew on every retry. Field 2026-08-10: 69 minutes recorded
      // for a 52m49s visit, against 47-for-46.6 the day before #374 shipped.
      //
      // The design note ("stamping it more strictly yields an EARLIER end, i.e.
      // less over-report") is true for STRICTER and inverts at NEVER: zero stamps
      // is not a tight ceiling, it is no ceiling.
      //
      // So the two questions get the two keys they always needed, mirroring
      // last_proven_at vs last_confirmed_at server-side:
      //   • how long could this session plausibly have been live?  → LIVENESS
      //   • how much of it may we bill?                            → CREDIT
      // VISIT_TICK_THROTTLE_KEY is stamped unconditionally by heartbeatVisitStream
      // and is indifferent to accuracy by design, which is exactly what a duration
      // ceiling needs. Credit strictness is untouched: last_proven_at and the
      // server's v_proven still move only on a fix that passes the credit test.
      const [creditRaw, seenRaw] = await Promise.all([
        AsyncStorage.getItem(VISIT_TICK_KEY),
        AsyncStorage.getItem(VISIT_TICK_THROTTLE_KEY),
      ]);
      const credit = Number(creditRaw ?? 0);
      const seen = Number(seenRaw ?? 0);
      const lastEvidence = Math.max(
        Number.isFinite(credit) ? credit : 0,
        Number.isFinite(seen) ? seen : 0,
      );
      if (lastEvidence > activeGeofence.entryTimestamp && lastEvidence < endedAtMs) {
        // The eligibility guard is load-bearing, not caution: clamping below the
        // dwell minimum makes the server reject the claim 422 (the 2026-08-06
        // wedge). Below that we keep the clock and let the claim through.
        if (lastEvidence - activeGeofence.entryTimestamp >= prodDwellMs()) endedAtMs = lastEvidence;
      }
    } catch { /* no evidence to bound by — keep the clock, as before */ }
  }
  let dwellMs = endedAtMs - activeGeofence.entryTimestamp;
  try {
    // Backgrounded, the auth machinery is the enemy. A cold headless runtime
    // always takes authFresh's resync branch (its remembered token is null by
    // definition), and setSession can hang forever with the screen off: on
    // 2026-08-06 this claim froze there, and the zombie-heal retry froze in the
    // identical place six minutes later. Present the persisted token over raw
    // REST instead — same user, same RLS, no auth work (see lib/backgroundRest).
    //
    // Foreground keeps ensureFreshSession because it is the only path allowed to
    // rotate a token (a background rotation revokes the family — the silent-401
    // outage of 2026-08-05).
    //
    // ⚠ "nothing freezes in the foreground" was the old justification for this
    // gate and it is FALSE — 2026-08-09 11:26Z, app open and UI mounted:
    // ensureFreshSession(close_gym_visit) timed out at 30s, then this very
    // branch fired, then the activity_sessions insert timed out at 30s too. The
    // hang is local (no request reached GoTrue in that window, while raw-fetch
    // ticket RPCs kept landing), so backgrounding is not what causes it, and the
    // AppState gate above leaves the foreground as the ONLY transport with no
    // ticket fallback.
    // ⚠ NO LONGER GATED ON AppState, and that is the point. Field 2026-08-10
    // 12:54–12:57Z: the user opened the app AFTER a completed visit, this path
    // took the foreground branch, and ensureFreshSession('record_dwell_session')
    // timed out at 30 s four times in a row (12:54:22, 12:54:52, 12:55:54, and
    // again under flush_pending_claims at 12:56:36). Each partial retry re-wrote
    // ended_at to the wall clock, so a 52m49s visit was recorded as 69 minutes and
    // still climbing — purely because the app was open.
    //
    // The persisted token is a local AsyncStorage read that returns null the
    // moment it is spent, so this cannot bypass rotation: a genuinely stale token
    // still falls through to ensureFreshSession below, which remains the only
    // path allowed to rotate. It just stops a healthy token from being ignored
    // because the UI happens to be mounted.
    //
    // `backgrounded` still exists below and is still AppState-based: it gates the
    // claim RELAY, which is a different question (a client call to
    // /functions/v1/* never arrives from a backgrounded Android app). Only the
    // AUTH read is decoupled here.
    const backgrounded = AppState.currentState !== 'active';
    const bgAuth = await readBackgroundAuth();

    let userId: string;
    if (bgAuth) {
      userId = bgAuth.userId;
    } else {
      const authSession = await ensureFreshSession('record_dwell_session');
      if (!authSession?.user) {
        // Report the state, not a cure. This used to claim "auth unrecoverable
        // until app-open", which printed verbatim while the app WAS open and
        // seconds before auth recovered on its own.
        console.error(`[Geofence] No fresh session — cannot record session (app_state=${AppState.currentState}).`);
        return { outcome: 'error' };
      }
      userId = authSession.user.id;
    }

    // ── A FINISHED VISIT IS A CEILING, NOT A SUGGESTION ─────────────────────
    //
    // Field 2026-08-10: visit 95a96e93 closed at 12:46:33 with the user 6.5 km
    // away, then the app was opened and a FRESH active record was created for
    // that already-closed visit. With no frozen endedAtMs (this record was not
    // born of a finalize) and no VISIT_TICK_KEY (finalize deletes it, see the
    // removeItem below), `endedAtMs` fell straight through to Date.now() and
    // every retry re-wrote it: 3923 s → 4122 s → 4145 s, a 52m49s visit recorded
    // as 69 minutes and still climbing. duration_sec is greatest(...) server-side
    // so none of it could ever be walked back.
    //
    // The visit's own ended_at is the honest ceiling and the server already knows
    // it. One cheap REST read on the persisted token — no auth machinery, the
    // same transport the wake path has always trusted.
    //
    // ⚠ IT CLAMPS, IT DOES NOT REFUSE. A visit closed server-side by the reaper
    // with the claim still outstanding is a LEGITIMATE late claim, and refusing
    // it outright would reinstate the wedge the NEVER SHRINK comment records from
    // 2026-08-06. Only an already-recorded session is skipped outright, because
    // that has nothing left to write.
    if (activeGeofence.visitId && bgAuth) {
      try {
        const { data: visitRows } = await bgSelect<{ ended_at: string | null }>(
          'gym_visits',
          `id=eq.${activeGeofence.visitId}&select=ended_at`,
          bgAuth,
        );
        const closedAt = visitRows?.[0]?.ended_at ? Date.parse(visitRows[0].ended_at) : NaN;
        if (Number.isFinite(closedAt)) {
          if (activeGeofence.sessionRecorded && !activeGeofence.pointsPending) {
            console.log('[Geofence] Visit already closed and session already recorded — nothing to extend.');
            return { outcome: 'in_flight' };
          }
          if (closedAt > activeGeofence.entryTimestamp && closedAt < endedAtMs) {
            console.log(
              `[Geofence] Visit closed at ${new Date(closedAt).toISOString()} — clamping session end ` +
              `(was ${Math.round((endedAtMs - activeGeofence.entryTimestamp) / 60_000)}min, ` +
              `now ${Math.round((closedAt - activeGeofence.entryTimestamp) / 60_000)}min).`,
            );
            endedAtMs = closedAt;
            dwellMs = endedAtMs - activeGeofence.entryTimestamp;
          }
        }
      } catch { /* unreadable — keep the pre-existing bound, never block a claim */ }
    }

    const startedAt   = new Date(activeGeofence.entryTimestamp);
    // Cap the dwell so a late EXIT/dwell detection can't record an impossible
    // (multi-hour/-day) session. ended_at is derived from the capped length so
    // the row stays internally consistent.
    const durationSec = Math.min(Math.round(dwellMs / 1000), MAX_GYM_SESSION_SEC);
    const endedAt     = new Date(activeGeofence.entryTimestamp + durationSec * 1000);

    const { getDeviceId } = await import('@/lib/device');
    const deviceId = await getDeviceId();

    let sessionId: string;

    const sessionRow = {
      user_id:      userId,
      type:         'gym',
      started_at:   startedAt.toISOString(),
      ended_at:     endedAt.toISOString(),
      duration_sec: durationSec,
      verification: 'geofence',
      trust_score:  0.94,
      device_id:    deviceId,
      partner_id:   activeGeofence.partnerId,
      raw_gps:      {
        partnerId:      activeGeofence.partnerId,
        partnerName:    activeGeofence.partnerName,
        entryTimestamp: activeGeofence.entryTimestamp,
      },
    };

    const { data: session, error: sessionError } = bgAuth
      ? await bgInsert<{ id: string }>('activity_sessions', sessionRow, bgAuth)
      : await withNetworkTimeout(supabase
          .from('activity_sessions')
          .insert(sessionRow)
          .select()
          .single(), 'activity_sessions insert');

    if (sessionError) {
      if (sessionError.code === '23505') {
        // Session already exists (recorded when duration was too short) — update to actual elapsed time
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const existing = bgAuth
          ? (await bgSelect<{ id: string; duration_sec: number | null }>(
              'activity_sessions',
              `select=id,duration_sec&user_id=eq.${userId}&type=eq.gym&started_at=gte.${today.toISOString()}`
                + '&order=started_at.desc&limit=1',
              bgAuth,
            )).data?.[0] ?? null
          : (await withNetworkTimeout(supabase
              .from('activity_sessions')
              .select('id, duration_sec')
              .eq('user_id', userId)
              .eq('type', 'gym')
              .gte('started_at', today.toISOString())
              .order('started_at', { ascending: false })
              .limit(1)
              .single(), 'existing-session lookup')).data;

        if (!existing) {
          console.error('[Geofence] 23505 but could not find existing session');
          return { outcome: 'error' };
        }

        // NEVER SHRINK. One gym session per user per UTC day is a unique index,
        // so a second visit and every stale retry all land on this same row —
        // and whoever writes last used to win. On 2026-08-06 that wedged a live
        // 43-minute visit: an exited 29m51s attempt kept retrying with its own
        // frozen (too-short) length, rewriting the row below the eligibility
        // minimum every few minutes, and the server rejected the claim 422 every
        // time. Extending only is both safer and truer — the day's row should
        // describe the longest verified stay, not the most recent writer.
        const existingSec = existing.duration_sec ?? 0;
        if (durationSec > existingSec) {
          const patch = { ended_at: endedAt.toISOString(), duration_sec: durationSec };
          if (bgAuth) {
            await bgUpdate('activity_sessions', `id=eq.${existing.id}`, patch, bgAuth);
          } else {
            await withNetworkTimeout(supabase
              .from('activity_sessions')
              .update(patch)
              .eq('id', existing.id), 'activity_sessions update');
          }
          console.log(`[Geofence] Extended today's session to ${Math.round(durationSec / 60)}min.`);
        } else {
          console.log(`[Geofence] Today's session already records ${Math.round(existingSec / 60)}min — leaving it (this attempt is ${Math.round(durationSec / 60)}min).`);
        }

        sessionId = existing.id;
      } else {
        console.error('[Geofence] Failed to create session:', sessionError);
        return { outcome: 'error' };
      }
    } else {
      if (!session) return { outcome: 'error' };
      sessionId = session.id;
    }

    // BACKGROUND: a client call to /functions/v1/* never arrives from a
    // backgrounded Android app, even though REST requests sent the same second
    // land (six field captures 2026-07-14). Relay the claim through a SECURITY
    // DEFINER RPC on that proven REST path instead — pg_net invokes claim-points
    // server-to-server, immune to Doze. The relay returns before the claim
    // completes, so the caller keeps pointsPending; the next tick's relay answers
    // 'already_claimed' and resolves it. The server marks the visit and sends the
    // "Session recorded" push itself.
    if (backgrounded) {
      const relayArgs = { p_session_id: sessionId, p_visit_id: activeGeofence.visitId ?? null };
      const { data: relay, error: relayError } = bgAuth
        ? await bgRpc<{ status?: string }>('relay_gym_claim', relayArgs, bgAuth)
        : await withNetworkTimeout(supabase.rpc('relay_gym_claim', relayArgs), 'relay_gym_claim rpc');
      if (relayError) {
        console.error('[Geofence] Claim relay failed:', relayError.message);
        return { outcome: 'error' };
      }
      const relayStatus = (relay as { status?: string } | null)?.status;
      if (relayStatus === 'already_claimed') {
        console.log('[Geofence] Relayed claim already landed — surfacing completion to UI.');
        await AsyncStorage.setItem(
          SESSION_COMPLETED_KEY,
          JSON.stringify({ partnerName: activeGeofence.partnerName, durationSec, timestamp: Date.now() }),
        );
        _emitSessionCompleted();
        if (activeGeofence.visitId) {
          try {
            const { markGymVisitProgress } = await import('@/lib/gymVisits');
            await markGymVisitProgress(activeGeofence.visitId, 'claimed', sessionId);
          } catch { /* non-fatal — the server marks relayed claims itself */ }
        }
        return { outcome: 'claimed', sessionId };
      }
      if (relayStatus === 'accepted') {
        console.log('[Geofence] Claim relayed — server is completing it; a later tick verifies.');
        return { outcome: 'relayed', sessionId };
      }
      console.error('[Geofence] Claim relay rejected:', relayStatus ?? 'unknown');
      return { outcome: 'error' };
    }

    // FOREGROUND: call claim-points directly — the rich response drives the
    // within-reach nudge and the local push fallback below.
    // The one call that must NEVER hang: sessionRecorded is already persisted, and
    // until an outcome comes back the state machine can't write pointsPending — a
    // hang here (RN fetch = no timeout) was a silently dropped claim until exit.
    const { data: claimData, error: claimError } = await withNetworkTimeout(
      supabase.functions.invoke('claim-points', { body: { session_id: sessionId } }),
      'claim-points invoke',
    );

    if (claimError) {
      const body = await (claimError as any)?.context?.json?.().catch(() => null);
      if (body?.error === 'Session does not meet eligibility minimum') {
        return { outcome: 'too_short' };
      }
      if (body?.error === 'Session already claimed') {
        // Points were already awarded (e.g. previous claim or duplicate call).
        // Still surface the completion so the UI and usePoints refresh correctly.
        console.log('[Geofence] Session already claimed — surfacing completion to UI.');
        await AsyncStorage.setItem(
          SESSION_COMPLETED_KEY,
          JSON.stringify({ partnerName: activeGeofence.partnerName, durationSec, timestamp: Date.now() }),
        );
        _emitSessionCompleted();
        return { outcome: 'claimed', sessionId };
      }
      console.error('[Geofence] Claim points error:', body ?? claimError.message);
      return { outcome: 'error' };
    }

    // Points successfully claimed — now surface completion to the app
    await AsyncStorage.setItem(
      SESSION_COMPLETED_KEY,
      JSON.stringify({ partnerName: activeGeofence.partnerName, durationSec, timestamp: Date.now() }),
    );

    // Notify all in-process listeners (e.g. usePoints) immediately
    _emitSessionCompleted();

    const earned = (claimData as { earned?: number })?.earned;

    // Schedule (or clear) the spaced-out "Reward within reach" nudge from the
    // latest within-reach state, so it lands as its own moment ~2.5h later
    // instead of buzzing back-to-back with the session-recorded push.
    try {
      const withinReach = (claimData as {
        within_reach?: { points_to_unlock: number; reward_name: string } | null;
      })?.within_reach ?? null;
      const { scheduleRewardWithinReach } = await import('@/lib/notifications');
      await scheduleRewardWithinReach(withinReach);
    } catch (err) {
      console.warn('[Geofence] Failed to schedule within-reach notification:', err);
    }

    let currentStreak: number | undefined;
    try {
      const { data: streakRow } = await withNetworkTimeout(supabase
        .from('user_streaks')
        .select('current_streak')
        .eq('user_id', userId)
        .maybeSingle(), 'user_streaks lookup');
      currentStreak = streakRow?.current_streak ?? undefined;
    } catch { /* non-fatal */ }

    // On-device fallback: claim-points reports push_delivered=false only when the
    // server genuinely couldn't land the "Session recorded" push (no live token /
    // send failed) — NOT when the user muted it. In that case fire the local
    // notification here so the money moment still reaches the user. Absent field
    // (older function) defaults to true → no fallback, so this can never double-buzz.
    const pushDelivered = (claimData as { push_delivered?: boolean })?.push_delivered ?? true;
    if (!pushDelivered) {
      try {
        const { notifySessionCompleted } = await import('@/lib/notifications');
        await notifySessionCompleted(activeGeofence.partnerName, sessionId, earned, currentStreak);
        console.log('[Geofence] Server push undeliverable — fired local session-completed fallback.');
      } catch (err) {
        console.warn('[Geofence] Local session-completed fallback failed:', err);
      }
    }

    // Tell the beacon the claim landed, so the server stops nudging for the dwell
    // stage and starts timing the upgrade one. Records the outcome only — it cannot
    // award anything.
    if (activeGeofence.visitId) {
      try {
        const { markGymVisitProgress } = await import('@/lib/gymVisits');
        await markGymVisitProgress(activeGeofence.visitId, 'claimed', sessionId);
      } catch { /* non-fatal */ }
    }

    console.log(`[Geofence] Points claimed after ${Math.round(dwellMs / 60000)}min dwell.`, claimData);
    return { outcome: 'claimed', sessionId, earned, currentStreak };
  } catch (err) {
    console.error('[Geofence] recordDwellSession failed:', err);
    return { outcome: 'error' };
  } finally {
    // Fenced release: only the current lease holder may free the lock. A zombie
    // attempt whose lock was stolen must not release the thief's lease.
    if (_recordingInFlight.get(lockKey) === myLockStamp) {
      _recordingInFlight.delete(lockKey);
    }
  }
}

// ─── Failed-claim retry queue ───────────────────────────────────────────────
// When a session is claimed after the user has already exited a gym (background
// EXIT event) and the network/auth call fails, the claim is parked here instead
// of being lost. Each entry carries a frozen endedAtMs so the recorded duration
// stays the true session length no matter how much later the retry runs. This
// queue only retries the base claim — it never re-enters the dwell/tier-upgrade
// state machine, so there are no phantom tier upgrades for a user who has left.

const PENDING_CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function enqueuePendingClaim(entry: StoredGeofence): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CLAIMS_KEY);
    const queue: StoredGeofence[] = raw ? JSON.parse(raw) : [];
    const existing = queue.find(
      q => q.entryTimestamp === entry.entryTimestamp && q.partnerId === entry.partnerId,
    );
    if (existing) {
      // Already queued — e.g. an in-gym auth failure queued it, and now the EXIT
      // re-queues with the true exit time. Keep the LATEST endedAtMs so the eventual
      // retry records the full session length, not the duration at first failure.
      if ((entry.endedAtMs ?? 0) > (existing.endedAtMs ?? 0)) {
        existing.endedAtMs = entry.endedAtMs;
      }
    } else {
      queue.push(entry);
    }
    await AsyncStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(queue));
    console.log('[Geofence] Queued failed claim for retry.');
    return true;
  } catch (err) {
    console.warn('[Geofence] enqueuePendingClaim failed:', err);
    return false;
  }
}

async function removePendingClaim(entry: StoredGeofence): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CLAIMS_KEY);
    if (!raw) return;
    const queue: StoredGeofence[] = JSON.parse(raw);
    const remaining = queue.filter(
      candidate => candidate.entryTimestamp !== entry.entryTimestamp || candidate.partnerId !== entry.partnerId,
    );
    if (remaining.length) {
      await AsyncStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(remaining));
    } else {
      await AsyncStorage.removeItem(PENDING_CLAIMS_KEY);
    }
  } catch (err) {
    console.warn('[Geofence] removePendingClaim failed:', err);
  }
}

// ─── Exit-close outbox ───────────────────────────────────────────────────────
//
// A visit can ONLY be closed by the device that opened it, and finalizeActive-
// Geofence deletes ACTIVE_GEOFENCE_KEY before it calls closeGymVisit. That made
// the close a single fire-and-forget shot at the least reliable moment in the
// session — pocketed phone, screen off, an hour-old token — with the local record
// already gone. When it failed the visit was orphaned: server open, client blind,
// re-opening the app powerless (reconcileActiveSessionFromWake returns at its
// first line with no active session). Field 2026-08-07: exactly that, and it had
// to be closed by hand.
//
// So the close gets the same treatment the claim already had: a durable outbox,
// retried on every flush. The claim outbox proved the pattern — this is the same
// idea applied to the other half of the exit.
type PendingVisitClose = { visitId: string; endedAtMs: number; userId?: string; queuedAtMs: number };

// Past this a close is pointless: the 12h abandon cron has owned the row for
// hours and re-closing it would only rewrite history with a worse timestamp.
const PENDING_CLOSE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

async function enqueuePendingVisitClose(entry: PendingVisitClose): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_VISIT_CLOSES_KEY);
    const queue: PendingVisitClose[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(queue)) throw new Error('corrupt');
    // Idempotent by visit: a retry loop must not grow the queue without bound.
    if (queue.some(e => e.visitId === entry.visitId)) return;
    queue.push(entry);
    await AsyncStorage.setItem(PENDING_VISIT_CLOSES_KEY, JSON.stringify(queue));
    console.log(`[Geofence] Visit ${entry.visitId} close queued for retry.`);
  } catch {
    // Best-effort: losing the retry is no worse than the old behaviour, and the
    // server-side reaper closes it as a backstop.
    try { await AsyncStorage.setItem(PENDING_VISIT_CLOSES_KEY, JSON.stringify([entry])); } catch { /* give up */ }
  }
}

/** Removes one visit's entry after its close landed. Companion to the
 *  queue-first ordering in finalizeActiveGeofenceInner (2026-08-12). */
async function dequeuePendingVisitClose(visitId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_VISIT_CLOSES_KEY);
    const queue: PendingVisitClose[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(queue) || !queue.length) return;
    const remaining = queue.filter(e => e.visitId !== visitId);
    if (remaining.length) await AsyncStorage.setItem(PENDING_VISIT_CLOSES_KEY, JSON.stringify(remaining));
    else await AsyncStorage.removeItem(PENDING_VISIT_CLOSES_KEY);
  } catch { /* a leftover entry is harmless — the flush's closeGymVisit is idempotent */ }
}

async function flushPendingVisitCloses(): Promise<void> {
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(PENDING_VISIT_CLOSES_KEY); } catch { return; }
  if (!raw) return;

  let queue: PendingVisitClose[];
  try { queue = JSON.parse(raw); } catch {
    await AsyncStorage.removeItem(PENDING_VISIT_CLOSES_KEY).catch(() => {});
    return;
  }
  // Same non-array trap as flushPendingClaims: "null" parses fine and .length
  // then throws outside the catch, aborting the caller's whole event.
  if (!Array.isArray(queue)) {
    await AsyncStorage.removeItem(PENDING_VISIT_CLOSES_KEY).catch(() => {});
    return;
  }
  if (!queue.length) return;

  const { closeGymVisit } = await import('@/lib/gymVisits');

  // Ownership fence: avoid replaying a prior account's queued close under a
  // different login. Storage first, machinery only on a spent token — the exact
  // fix flushPendingClaims got on 2026-08-11 (see the note there); this is the
  // same fence in the closes twin, and it runs from the same wake tasks.
  //
  // ⚠ FOREGROUND-ONLY FALLBACK (2026-08-17). The comment above claimed parity
  // with flushPendingClaims and did not have it: the claims twin gained an
  // `AppState.currentState === 'active'` guard on 2026-08-12 and this one never
  // did. A walk-out is BY DEFINITION a pocketed phone at the end of a long
  // session, which is exactly when the persisted token is spent — so this branch
  // fired on every real exit and spent the wake's budget inside the auth
  // machinery, ahead of a closeGymVisit that carries the device ticket and would
  // have worked. Field 2026-08-17: OS exit at 09:58:23, local state finalized,
  // and the server visit still open 11 minutes later when the reaper took it —
  // 16.6 minutes of a 56.6-minute workout lost, and the user told "40 min".
  //
  // Backgrounded, leave currentUserId null: the ownership fence below already
  // treats unknown as proceed, so a close still lands on its ORIGINAL instant.
  let currentUserId: string | null = (await readBackgroundAuth())?.userId ?? null;
  if (!currentUserId && AppState.currentState === 'active') {
    try {
      const { data: { user } } = await withNetworkTimeout(supabase.auth.getUser(), 'auth.getUser');
      currentUserId = user?.id ?? null;
    } catch { /* offline — treat ownership as unknown */ }
  }

  // Tracked as ids, not as a rebuilt array — see the merge-on-write below.
  const resolved = new Set<string>();
  const dropped = new Set<string>();
  for (const entry of queue) {
    const queuedAgeS = Math.round((Date.now() - entry.queuedAtMs) / 1000);
    if (Date.now() - entry.queuedAtMs > PENDING_CLOSE_MAX_AGE_MS) {
      console.log('[Geofence] Dropping stale pending visit close (>12h) — the abandon cron owns it.');
      dropped.add(entry.visitId);
      continue;
    }
    if (entry.userId && currentUserId && entry.userId !== currentUserId) {
      console.log('[Geofence] Pending visit close belongs to another account — leaving it queued.');
      continue;
    }
    // endedAtMs is the ORIGINAL exit instant, never now(): a retry hours later
    // must still record when the user actually left, or the retry itself becomes
    // the duration-inflation bug it exists to prevent.
    const ok = await closeGymVisit(entry.visitId, entry.endedAtMs).catch(() => false);
    if (ok) {
      console.log(`[Geofence] Pending visit close resolved (${entry.visitId}).`);
      resolved.add(entry.visitId);
    } else {
      // A queued close could previously fail on every wake for an hour and write
      // NOTHING — the same silence that made the 08-14 and 08-17 walk-outs
      // unreadable. One row per failed entry per drain: `queued_age_s` is the
      // number that says "this has been stuck", which no other row can express.
      logRegionEvent('outbox', 'visit_close_deferred', {
        reason:       'drain_failed',
        visit:        entry.visitId,
        queued_age_s: queuedAgeS,
        app_state:    AppState.currentState,
        had_token:    !!currentUserId,
      });
    }
  }

  try {
    // ⚠ MERGE ON WRITE (2026-08-17). This used to write a locally rebuilt array
    // over the key wholesale, which loses both ways once two passes overlap: an
    // entry enqueued DURING this drain is erased, and an entry another pass just
    // resolved is resurrected. Re-read and subtract only what THIS pass settled.
    const rawNow = await AsyncStorage.getItem(PENDING_VISIT_CLOSES_KEY);
    const fresh: PendingVisitClose[] = rawNow ? JSON.parse(rawNow) : [];
    const merged = (Array.isArray(fresh) ? fresh : [])
      .filter(e => !resolved.has(e.visitId) && !dropped.has(e.visitId));
    if (merged.length) await AsyncStorage.setItem(PENDING_VISIT_CLOSES_KEY, JSON.stringify(merged));
    else await AsyncStorage.removeItem(PENDING_VISIT_CLOSES_KEY);
  } catch { /* next flush retries */ }
}

/** Drain both durable outboxes from a server wake (2026-08-12).
 *
 *  The queues were only flushed by native geofence events, the boot task and
 *  app-opens — none of which a stationary, swiped-away phone reliably produces.
 *  Field: Android finalized its exit at 15:08, the close RPC failed, and the
 *  queued close then waited NINE minutes for a native exit event to provide a
 *  flush trigger, while four perfectly good wakes came and went. The wake IS
 *  the reliable recurring execution (~5-6 min); it is where the drain belongs.
 *
 *  Fire-and-forget from the wake task — never awaited on the wake's critical
 *  path, single-flighted so overlapping wakes can't double-drain. */
// ⚠ A LATCH MUST NOT OUTLIVE ITS PASS (2026-08-17). This was a bare boolean
// cleared only in `finally`, so a flush that never settled — the freeze this
// whole file routes around — silenced the drain for the entire life of the JS
// context. Every later wake returned at the first line, and the queued close sat
// there until the reaper. Same shape, same fix as ensureFreshSession's lock
// (lib/authFresh.ts:107-156): store WHEN the holder took it, let a successor
// take it once the deadline passes, and release holder-only so a revived
// zombie pass cannot free a lock it no longer owns.
let _outboxFlushStartedAt = 0;
const OUTBOX_FLUSH_DEADLINE_MS = 60_000;
export async function flushPendingOutboxesFromWake(): Promise<void> {
  const heldForMs = _outboxFlushStartedAt ? Date.now() - _outboxFlushStartedAt : 0;
  if (_outboxFlushStartedAt && heldForMs < OUTBOX_FLUSH_DEADLINE_MS) {
    // A suppressed drain used to be indistinguishable from a drain that ran and
    // found nothing. It is the reason "the outbox never retried" could not be
    // told from "the outbox retried and failed".
    logRegionEvent('outbox', 'visit_close_deferred', {
      reason:      'latch_held',
      latch_age_s: Math.round(heldForMs / 1000),
    });
    return;
  }
  const mine = Date.now();
  _outboxFlushStartedAt = mine;
  try {
    await drainOutboxesBounded('wake');
  } catch { /* both flushes already contain their own retries */ }
  finally { if (_outboxFlushStartedAt === mine) _outboxFlushStartedAt = 0; }
}

/** How long either outbox may hold a caller's event before we move on. Short:
 *  these are best-effort drains standing in front of the work the event actually
 *  exists to do (a check-in evaluation, a boot re-arm, a sweep). */
const OUTBOX_DRAIN_BOUND_MS = 10_000;

/** Drains both outboxes, bounding EACH one separately, and never rejecting.
 *
 *  ⚠ WHY SEPARATELY (2026-08-17). The three task executors called
 *  `await flushPendingVisitCloses(); await flushPendingClaims();` bare, ahead of
 *  their real work. So either flush hanging cost the event everything behind it —
 *  the location tick's evaluateLocationFix, the boot task's re-arm, the sweep. One
 *  shared race would be no better: the closes flush could eat the whole budget and
 *  leave the claims flush nothing. One bad outbox entry must cost one outbox
 *  entry, never the executor.
 *
 *  ⚠ AND THIS IS BELT, NOT BRACES. RN dispatches setTimeout off the UI frame
 *  clock, so this bound can itself freeze while the process is suspended (see
 *  lib/networkTimeout.ts — a 30 s race still pending 16 minutes later). It rescues
 *  the ordinary hang; the durable outbox plus the next wake rescue the rest. */
async function drainOutboxesBounded(label: string): Promise<void> {
  const bound = (work: Promise<void>, name: string): Promise<void> => new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[Geofence] Outbox drain ${name} exceeded ${OUTBOX_DRAIN_BOUND_MS / 1000}s — moving on.`);
      resolve();
    }, OUTBOX_DRAIN_BOUND_MS);
    work.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); },
    );
  });
  await bound(flushPendingVisitCloses(), `${label}_closes`);
  await bound(flushPendingClaims(), `${label}_claims`);
}

async function flushPendingClaims(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(PENDING_CLAIMS_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let queue: StoredGeofence[];
  try {
    queue = JSON.parse(raw);
  } catch {
    await AsyncStorage.removeItem(PENDING_CLAIMS_KEY).catch(() => {});
    return;
  }
  // JSON.parse can SUCCEED with a non-array (the literal "null" parses fine) —
  // `.length` on that throws outside the catch above and aborts the caller's
  // whole event (2026-08-05 crash-hunt finding #4). Treat it like corruption.
  if (!Array.isArray(queue)) {
    await AsyncStorage.removeItem(PENDING_CLAIMS_KEY).catch(() => {});
    return;
  }
  if (!queue.length) return;

  // There is real work. The replay itself (recordDwellSession) reads the
  // persisted identity unconditionally since 2026-08-10, so what this pass
  // actually needs is (a) a userId for the ownership fence below and (b) a
  // live-enough token for the RPCs — and a valid STORED token satisfies both.
  //
  // ⚠ Read storage first, machinery only on a spent token. ensureFreshSession
  // serializes on the auth client's internal lock, and field 2026-08-11 logged
  // THIS call site timing out at 30 s (auth_stale, reason flush_pending_claims)
  // behind a wedged lock while the stored token was perfectly valid — the same
  // jam that ate the morning's background check-in. A spent token is the one
  // case storage cannot fix, and the one case that still earns the lock: it is
  // the only legitimate rotator.
  //
  // Whose queue is this? The outbox is replayed on login, so without an owner
  // check an entry banked by the previous account is claimed by whoever signs
  // in next — a real cross-account credit path. Entries written before the
  // userId field existed stay claimable by the current user (old behaviour,
  // safe for a device that has only ever had one account); ownership unknown
  // (offline, no token) also falls through unchanged.
  let currentUserId: string | null = (await readBackgroundAuth())?.userId ?? null;
  // ⚠ HEADLESS ROTATION BAN (2026-08-12). The spent-token branch below is the
  // call site that logged `auth.setSession timed out after 30s` this afternoon —
  // and a rotation that dies MID-WRITE is the leading suspect for the day's two
  // full iOS session destructions (storage cleared, new session never lands,
  // user finds Get Started). Rotation now happens in the FOREGROUND only, where
  // the keychain is unlocked and a jam is visible. Backgrounded with a spent
  // token: leave the queue for the next foreground pass — claims are durable
  // and hours-late claims are still honest (endedAtMs is the original instant).
  if (!currentUserId && AppState.currentState === 'active') {
    await ensureFreshSession('flush_pending_claims');
    try {
      const { data: { user } } = await withNetworkTimeout(supabase.auth.getUser(), 'auth.getUser');
      currentUserId = user?.id ?? null;
    } catch { /* offline — fall through and treat ownership as unknown */ }
  }

  const remaining: StoredGeofence[] = [];
  for (const entry of queue) {
    // Drop entries too old to be meaningful (also avoids odd tier math).
    if (entry.endedAtMs && Date.now() - entry.endedAtMs > PENDING_CLAIM_MAX_AGE_MS) {
      console.log('[Geofence] Dropping stale pending claim (>24h).');
      continue;
    }
    if (entry.userId && currentUserId && entry.userId !== currentUserId) {
      // Not ours to claim. Keep it: the rightful owner may sign back in on this
      // device, and dropping it would silently destroy a real unclaimed session.
      console.log('[Geofence] Pending claim belongs to another account — leaving it queued.');
      remaining.push(entry);
      continue;
    }
    const { outcome } = await recordDwellSession(entry);
    if (outcome === 'error' || outcome === 'in_flight') {
      // error: transient (offline/auth) — retry next flush.
      // in_flight: another caller is already recording this exact session — keep
      // the entry so it's reconsidered once that call has released the lock.
      remaining.push(entry);
    } else {
      // 'claimed' fired the server push; 'too_short' is terminal. Either way, drop it.
      console.log(`[Geofence] Pending claim resolved (${outcome}).`);
    }
  }

  try {
    if (remaining.length) {
      await AsyncStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(remaining));
    } else {
      await AsyncStorage.removeItem(PENDING_CLAIMS_KEY);
    }
  } catch { /* non-fatal */ }
}

// ─── Gym tier upgrade ─────────────────────────────────────────────────────────
// Called when a session crosses the 40-min threshold. Awards the delta between
// what was claimed at the 30-min tier and the 40-min tier target.

// Fallback resolver for the upgrade path: if the stored sessionId was lost (e.g.
// an older build, or a partial write), find today's geofence gym session in the
// DB so the 40-min upgrade can still fire. upgradeGymTier is idempotent server
// side, so a redundant call is harmless.
async function resolveTodayGymSessionId(): Promise<string | undefined> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Reachable from the exit path, which is background by definition — so the
    // stored identity answers first, and while it holds, the lookup itself rides
    // the raw transport too: a supabase-js query would re-enter the jammed auth
    // lock via fetchWithAuth → getSession, the very thing being routed around.
    const bgAuth = await readBackgroundAuth();
    if (bgAuth) {
      const { data } = await bgSelect<{ id: string }>(
        'activity_sessions',
        `select=id&user_id=eq.${bgAuth.userId}&type=eq.gym&verification=eq.geofence`
          + `&started_at=gte.${encodeURIComponent(today.toISOString())}&order=started_at.desc&limit=1`,
        bgAuth,
      );
      return data?.[0]?.id ?? undefined;
    }

    const { data: { user } } = await withNetworkTimeout(supabase.auth.getUser(), 'auth.getUser');
    if (!user) return undefined;
    const { data } = await withNetworkTimeout(supabase
      .from('activity_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'gym')
      .eq('verification', 'geofence')
      .gte('started_at', today.toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(), 'today-session lookup');
    return data?.id ?? undefined;
  } catch {
    return undefined;
  }
}

async function upgradeGymTier(sessionId: string, partnerName?: string, visitId?: string): Promise<boolean> {
  try {
    // BACKGROUND: same as the claim — a functions.invoke never arrives from a
    // backgrounded Android app, so relay via the REST path and let pg_net call
    // upgrade-gym-tier server-to-server. 'accepted' returns false on purpose:
    // the next tick's relay answers 'already_done' and finalizes the state.
    //
    // Storage first, machinery only on a spent token: this ran on wake paths
    // (the exit claim, the location-task tick) yet awaited ensureFreshSession
    // and then rode supabase-js — both of which serialize on the auth client's
    // lock, which jams headless (field 2026-08-08 iOS: auth_stale, reason
    // upgrade_gym_tier, locked-keychain read). While the stored token holds,
    // the relay rides the raw transport; a spent token falls through to the
    // machinery, which is the only legitimate rotator and is idempotent to
    // retry on the next poll if it cannot complete here.
    if (AppState.currentState !== 'active') {
      const bgAuth = await readBackgroundAuth();
      let relay: unknown;
      if (bgAuth) {
        const { data, error: relayError } = await bgRpc(
          'relay_gym_upgrade', { p_session_id: sessionId, p_visit_id: visitId ?? null }, bgAuth,
        );
        if (relayError) {
          console.warn('[Geofence] Upgrade relay failed:', relayError.message);
          return false;
        }
        relay = data;
      } else {
        const authSession = await ensureFreshSession('upgrade_gym_tier');
        if (!authSession) {
          console.warn('[Geofence] Tier upgrade: no valid session — will retry on next poll.');
          return false;
        }
        const { data, error: relayError } = await withNetworkTimeout(
          supabase.rpc('relay_gym_upgrade', { p_session_id: sessionId, p_visit_id: visitId ?? null }),
          'relay_gym_upgrade rpc',
        );
        if (relayError) {
          console.warn('[Geofence] Upgrade relay failed:', relayError.message);
          return false;
        }
        relay = data;
      }
      const relayStatus = (relay as { status?: string } | null)?.status;
      if (relayStatus === 'already_done') {
        if (visitId) {
          try {
            const { markGymVisitProgress } = await import('@/lib/gymVisits');
            await markGymVisitProgress(visitId, 'upgraded', sessionId);
          } catch { /* non-fatal — the server marks relayed upgrades itself */ }
        }
        _emitSessionCompleted();
        return true;
      }
      if (relayStatus === 'accepted') {
        console.log('[Geofence] Upgrade relayed — server is completing it; a later tick verifies.');
        return false;
      }
      console.warn('[Geofence] Upgrade relay rejected:', relayStatus ?? 'unknown');
      return false;
    }

    // FOREGROUND: the machinery is fine here — a hang is survivable, and the
    // invoke below needs a genuinely fresh access token for its header.
    // ensureFreshSession resyncs this runtime to the latest persisted token pair
    // before any refresh, which is what actually prevents the family-revocation
    // race the old comment here worried about (see lib/authFresh.ts, 2026-08-05).
    const authSession = await ensureFreshSession('upgrade_gym_tier');
    if (!authSession) {
      console.warn('[Geofence] Tier upgrade: no valid session — will retry on next poll.');
      return false;
    }

    const { data: upgradeData, error: fnError } = await withNetworkTimeout(
      supabase.functions.invoke('upgrade-gym-tier', {
        body: { session_id: sessionId },
        headers: { Authorization: `Bearer ${authSession.access_token}` },
      }),
      'upgrade-gym-tier invoke',
    );
    if (fnError) {
      console.warn('[Geofence] Tier upgrade failed:', fnError.message);
      return false;
    }
    console.log('[Geofence] Gym session upgraded to 40-min tier.', upgradeData);

    // The upgrade landed — stop the beacon nudging for it. Like the claim, this is
    // recorded only after the points actually moved.
    if (visitId) {
      try {
        const { markGymVisitProgress } = await import('@/lib/gymVisits');
        await markGymVisitProgress(visitId, 'upgraded', sessionId);
      } catch { /* non-fatal */ }
    }

    // On-device fallback: fire the "Bonus unlocked" notification locally when the
    // server reports it couldn't deliver the push (no live token / send failed) and
    // there was an actual delta to award. Missing push_delivered (no-op upgrade or
    // older function) defaults to true → no fallback, so this never double-buzzes.
    const ud = upgradeData as { push_delivered?: boolean; earned?: number; delta?: number } | null;
    const delta = ud?.earned ?? ud?.delta ?? 0;
    if (ud?.push_delivered === false && delta > 0) {
      try {
        const { notifySessionUpgraded } = await import('@/lib/notifications');
        await notifySessionUpgraded(partnerName ?? '', sessionId, delta);
        console.log('[Geofence] Server push undeliverable — fired local session-upgraded fallback.');
      } catch (err) {
        console.warn('[Geofence] Local session-upgraded fallback failed:', err);
      }
    }

    _emitSessionCompleted();
    return true;
  } catch (err) {
    console.warn('[Geofence] upgradeGymTier error:', err);
    return false;
  }
}

// ─── Shared check-in / claim helpers ─────────────────────────────────────────
// Used by both the native geofence task and the foreground-service location task
// so the two detection paths run through one claim/record/upgrade code path.

/** Writes active-geofence state and fires the "You're in" notification for a
 *  newly-entered circle. No-ops if a session is already active. A gym already
 *  logged today does NOT block the check-in — the session still records and
 *  the server caps the points; the day-cap check runs async below, purely to
 *  withdraw the iOS mark banners whose copy promises points that won't bank.
 *  `regionId` is the composite UI key so the notification cooldown dedups
 *  against the native ENTER path for the same gym. */
async function setActiveAndNotify(regionId: string, entry: PartnerMapEntry): Promise<void> {
  if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) return;
  const entryTimestamp = Date.now();

  // Stamp the owner so a session can never be finalized — or its exit-claim
  // replayed — under a different account after a sign-out/switch. Best-effort:
  // check-in can race auth (field 2026-07-14), and an unowned record behaves
  // exactly as it did before rather than blocking a real check-in.
  //
  // ⚠ NEVER supabase.auth.getSession() here — this runs on wake paths. Field
  // 2026-08-11: three sweeps handed trusted fixes (27 m against a 40 m radius)
  // to this function and each one vanished at the getSession await — no banner,
  // no visit, no error row, three handoff rows with nothing after them. The
  // auth client's internal lock had jammed in the headless process, every
  // caller queued behind it forever, and the device could not check in until a
  // cold start. The storage read returns the same persisted identity without
  // entering that machinery; null (no session / spent token) leaves the record
  // unowned — the same best-effort outcome the old catch produced.
  const ownerId = (await readBackgroundAuth())?.userId;

  await AsyncStorage.setItem(
    ACTIVE_GEOFENCE_KEY,
    JSON.stringify({
      partnerId:      entry.dbId,
      partnerName:    entry.name,
      regionId,
      entryTimestamp,
      latitude:       entry.lat,
      longitude:      entry.lng,
      radius:         entry.radius,
      userId:         ownerId,
    }),
  );
  console.log(`[Geofence] Location task: entered "${entry.name}".`);

  // Android: switch to time-driven ticks for the visit. Without this the
  // displacement filter (50 m baseline / 10 m approach) delivers NO fixes to a
  // stationary user, so the dwell machine never advances and the 30-min claim
  // never fires in the background. See DWELL_LOCATION_OPTIONS.
  //
  // iOS is deliberately left ALONE here: it has no dwell mode, and re-issuing its
  // baseline ('off') would tear down the approach stream that detects the 25 m
  // exit. iOS keeps claiming on the region EXIT, exactly as before.
  const checkedInMode = visitStreamMode(Platform.OS, { sessionActive: true, approaching: true });
  if (checkedInMode === 'dwell') await setLocationStreamMode('dwell');

  // Open the server-side beacon. We are provably awake right now (we just fired
  // "You're in"), which is exactly why the check-in is the one moment we can be
  // sure of. From here the SERVER holds the dwell/upgrade timers and wakes us with
  // a silent push — because a stationary phone gets no location callbacks and
  // therefore cannot wake itself. Best-effort: no beacon just means no nudges, and
  // the exit path still claims.
  // LOCAL UX FIRST, NETWORK LAST — the ordering is load-bearing. On 2026-08-05
  // the iOS return re-entry's frozen background network meant openGymVisit
  // never resolved a visit id, and everything gated behind it silently
  // vanished — including the purely-local session-mark banners. Banners and
  // marks now happen before the first network touch and depend on nothing.
  // ⚠ A REASON, NOT A BOOLEAN (2026-08-17). notifyCheckInAvailable used to return
  // `true` both when it drew the banner AND when its 30-minute cooldown suppressed
  // it, so "the visit opened and nobody told the user" was unobservable — the one
  // question the check-in path most needs to be able to answer. The `checked_in`
  // row now carries the verdict, including the throw.
  let notifyResult: CheckInNotifyResult | 'threw' = 'threw';
  try {
    const { notifyCheckInAvailable } = await import('@/lib/notifications');
    notifyResult = await notifyCheckInAvailable(entry.name, regionId);
  } catch (err) {
    // The old comment here promised "server announce will cover (android)". That
    // pass was DELETED on 2026-08-07 once both platforms' headless local banners
    // were confirmed working, so nothing covers this — which is precisely why the
    // verdict has to reach the server as data instead of as a reassuring comment.
    console.warn('[Geofence] check-in banner threw — nothing else will announce this check-in:', err);
  }
  // Its own row rather than a field on `checked_in`: that row is written by the
  // two callers that DETECT the arrival (enter_poll and sweep), well before this
  // point, and a second row wearing the same name would read as a second check-in.
  // `announced_at` cannot answer this — the client skips that mark whenever it is
  // backgrounded without a usable token, i.e. on every headless check-in, which is
  // why 08-17's Android banner could only be confirmed by the tester's own eyes.
  logRegionEvent(regionId, 'check_in_announced', { notified: notifyResult });

  // The pre-scheduled iOS 30/40-minute banners are GONE (2026-08-07). They
  // existed because iOS could not be relied on to wake at a threshold — a
  // premise disproved on 08-07, when a force-quit iPhone answered an APNs nudge
  // and claimed in TWO SECONDS. What they did instead was fire on a timer and
  // announce "30 min session banked" whether or not the user was still there
  // and whether or not anything had actually been banked, then land alongside
  // the real server push: the field run produced THREE "Session recorded"
  // banners on one iPhone for one session. Keeping them would have meant
  // building cancellation that races the very push it is trying not to
  // duplicate. The server's notification is the true one, and it is now the
  // only one. (This also retires the whole day-cap withdrawal dance that
  // existed solely to un-say a banner these had already promised.)

  // Only now the network: open the server-side visit beacon.
  let visitId: string | null = null;
  try {
    visitId = await openVisitTraced('check_in', entry.dbId, regionId, entryTimestamp, null);
    if (visitId) {
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const active = raw ? JSON.parse(raw) as StoredGeofence : null;
      // Stamp the visit onto the stored session — never onto a DIFFERENT PLACE.
      //
      // This used to demand `active.entryTimestamp === entryTimestamp` exactly,
      // and on Android that equality failed silently on every single check-in:
      // field 2026-08-08, `visit: null` in every sweep row for a 60-minute
      // session, and a `VISIT reused` on every wake because the client had to
      // re-resolve the visit from the server each time it woke.
      //
      // Losing the id is not cosmetic — it is load-bearing four ways over:
      //   1. finalizeActiveGeofence's close is gated on it, so the visit never closes;
      //   2. so is the #364 durable-close outbox, so it never even queues a retry;
      //   3. markGymVisitProgress is gated on it, so claim/upgrade never mark;
      //   4. and with no id the client re-resolves via openGymVisit on every wake —
      //      so the moment anything closes the visit server-side (the REAPER does
      //      exactly this, 45 min after upgrade) the next wake opens a DUPLICATE
      //      visit with a stale started_at, which the beacon then nudges. Observed
      //      live on 2026-08-08.
      //
      // The guard's real job is to not attach this visit to a session at some
      // OTHER partner, and regionId says that directly. A timestamp mismatch at
      // the same region means a concurrent check-in path rewrote the record
      // (iOS fired `sweep` and `enter_poll` 3 ms apart that same run) — and
      // open_gym_visit reuses the user's open visit anyway, so the id we hold IS
      // that session's visit. `!active.visitId` keeps it strictly additive: an
      // already-stamped session is never overwritten.
      const sameSession = active?.entryTimestamp === entryTimestamp;
      const stampable = active && active.regionId === regionId && !active.visitId;
      if (stampable) {
        // MERGE, DON'T OVERWRITE (2026-08-17). `active` was parsed before the
        // awaited openGymVisit above, so writing `{ ...active }` publishes a
        // pre-network snapshot over whatever landed meanwhile — the exact shape
        // of both 2026-08-11 bugs. patchActiveGeofence merges onto what is stored
        // NOW and refuses a finalized or re-regioned record, and its refusal
        // surfaces as `active_patch_refused` instead of vanishing.
        await patchActiveGeofence(active, { visitId }, 'check_in_stamp');
        // Name the relaxed path so we learn how often the strict guard was wrong,
        // rather than inferring it from `visit: null` months later.
        if (!sameSession) {
          logRegionEvent(regionId, 'visit_stamp_relaxed', {
            stored_entry: active.entryTimestamp ?? null,
            opened_entry: entryTimestamp,
          });
        }
      } else if (active && !active.visitId) {
        // Region changed under us — genuinely must not stamp. Previously silent.
        logRegionEvent(regionId, 'visit_stamp_skipped', {
          reason: 'region_mismatch',
          stored_region: active.regionId ?? null,
        });
      }
      // ⚠ MARK ONLY WHAT WE ACTUALLY DREW (2026-08-17). This was `if (checkInShown)`
      // on a boolean that also read true for a cooldown-suppressed banner, so
      // `announced_at` could be stamped for a check-in the user was never told
      // about. That is not merely cosmetic: the server announce pass deleted on
      // 08-07 left instructions to "fix the mark first" before it is ever
      // restored, because a mark that lies is exactly what made it duplicate.
      // Nothing double-announces today, so the strict test costs nothing now and
      // makes announced_at true.
      if (notifyResult === 'shown') {
        // Local banner displayed — tell the beacon not to double-announce.
        //
        // This is a RACE against the server's 90-second grace window, and a
        // background check-in has no business entering the auth machinery to
        // win it. Field, 2026-08-07 08:54: this fired through supabase-js on a
        // phone whose auth calls were timing out after 30 s, the mark never
        // landed inside the window, and the user got BOTH banners — the local
        // "You're in" and the server's "You're in at POWR".
        //
        // Fire-and-forget is still correct (the banner is already on screen, and
        // the wake's round-trip belongs to the confirm) — but it has to go out
        // over the transport that lands in milliseconds rather than one that can
        // outlive the window it is racing.
        void (async () => {
          try {
            // Backgrounded with no usable token, SKIP rather than fall back:
            // the fallback is the very transport that can outlive the 90 s
            // window, so attempting it cannot win the race and can only burn
            // the wake. Losing the mark costs one duplicate banner; the server
            // fallback is doing its job at that point.
            const backgrounded = AppState.currentState !== 'active';
            const auth = backgrounded ? await readBackgroundAuth() : null;
            if (auth) {
              const { error } = await bgRpc('mark_gym_visit_announced', { p_visit_id: visitId }, auth);
              if (error) console.warn('[Geofence] announce mark failed:', error.message);
              return;
            }
            // Backgrounded with no usable token: SKIP rather than fall back. The
            // fallback is the very transport that can outlive the 90 s window,
            // so attempting it cannot win the race — it can only burn the wake.
            // Losing the mark costs one duplicate banner, which is precisely
            // what the server fallback exists to provide.
            if (backgrounded) return;
            const { supabase } = await import('@/lib/supabase');
            const { error } = await supabase.rpc('mark_gym_visit_announced', { p_visit_id: visitId });
            if (error) console.warn('[Geofence] announce mark failed:', error.message);
          } catch (rpcErr) {
            console.warn('[Geofence] announce mark RPC threw:', rpcErr);
          }
        })();
      }
    }
  } catch (err) {
    console.warn('[Geofence] Visit beacon failed to open:', err);
  }

}

/** Runs the exit claim/upgrade path after finalizeActiveGeofence has persisted
 * an eligible exit to the durable queue. The frozen exit time ensures a later
 * retry records the real session length rather than entry-to-retry time. */
async function recordExitAndClaim(claimEntry: StoredGeofence): Promise<'resolved' | 'retry'> {
  const exitMs = claimEntry.endedAtMs ?? Date.now();
  const activeGeofence = claimEntry;

  // Session already recorded AND claimed (e.g. by the foreground/location dwell path).
  if (activeGeofence.sessionRecorded && !activeGeofence.pointsPending) {
    const dwellMs = exitMs - activeGeofence.entryTimestamp;
    if (dwellMs >= prodUpgradeMs() && !activeGeofence.tierUpgraded) {
      // Crossed the 40-min tier. Use the stored sessionId, or recover it from the
      // DB if it was lost — the upgrade is the user's bonus and must not depend on
      // fragile local state. upgradeGymTier is idempotent, so re-calling is safe.
      const sid = activeGeofence.sessionId ?? await resolveTodayGymSessionId();
      if (sid) {
        console.log('[Geofence] Exit: session crossed 40-min tier — upgrading.');
        await upgradeGymTier(sid, activeGeofence.partnerName, activeGeofence.visitId);
      } else {
        console.warn('[Geofence] Exit: 40-min tier reached but no sessionId resolvable — skipping upgrade.');
      }
    } else if (activeGeofence.sessionId) {
      console.log('[Geofence] Exit: session already recorded — skipping.');
    } else {
      // sessionRecorded but no sessionId: a claim succeeded without persisting the id.
      // Retry on exit; if it still fails, queue it so it's never lost. A relayed
      // outcome is queued too: the server is completing it, and the flush's next
      // relay answers 'already_claimed' and dequeues — never trust an unproven claim.
      console.log('[Geofence] Exit: recorded session has no sessionId — retrying on exit.');
      const { outcome } = await recordDwellSession(claimEntry);
      if (outcome === 'error' || outcome === 'relayed') await enqueuePendingClaim(claimEntry);
    }
    return 'resolved';
  }

  const dwellMs = exitMs - activeGeofence.entryTimestamp;
  if (dwellMs < minDwellMs()) {
    console.log(`[Geofence] Dwell ${Math.round(dwellMs / 60000)}min < threshold — no points.`);
    return 'resolved';
  }

  const { outcome: exitOutcome } = await recordDwellSession(claimEntry);
  if (exitOutcome === 'error' || exitOutcome === 'in_flight' || exitOutcome === 'relayed') {
    // The durable exit record stays queued until a transient failure, a
    // concurrent claim, or a server-side relayed claim has conclusively
    // resolved, so none of them can lose a valid session between separate
    // foreground/headless JS contexts. For 'relayed' the next flush's relay
    // answers 'already_claimed' and dequeues.
    console.log('[Geofence] Exit claim unresolved — retained for retry.');
    return 'retry';
  }
  // 'claimed' → claim-points fires the single "Session recorded" push (source of
  // truth). 'too_short' cannot normally occur here (dwell >= minDwellMs()).
  return 'resolved';
}

/** May the id we just resolved be stamped onto the session currently in storage?
 *
 *  ONE rule for all three late-open paths (check-in, wake, stream tick), because
 *  they had three different rules and two of them were wrong. The guard's real
 *  job is to never attach a visit to a session at some OTHER partner, and
 *  regionId says that directly; an entryTimestamp mismatch at the same region
 *  means a concurrent check-in path rewrote the record, and open_gym_visit reuses
 *  the user's live visit anyway, so the id we hold IS that session's visit.
 *
 *  Strictly additive: an already-stamped session is never overwritten.
 *
 *  ⚠ Losing the stamp is not cosmetic. An unstamped session sends the client back
 *  to openGymVisit on every wake, and the moment anything closes that visit
 *  server-side (an exit, the 45-minute reaper) the next resolve asks for a visit
 *  at a started_at the server has already ended. Field 2026-08-08 and again
 *  2026-08-10, that minted a duplicate backdated visit which the beacon then
 *  nudged for hours. The server refuses to mint it now
 *  (20260810121000_open_gym_visit_reject_closed_replay.sql); this keeps the
 *  client from asking in the first place. */
function stampVisitOnActive(
  current: StoredGeofence | null,
  opened: StoredGeofence,
  visitId: string,
  source: 'wake_late_open' | 'stream_late_open',
): current is StoredGeofence {
  if (!current || current.visitId) return false;
  if (current.regionId !== opened.regionId) {
    logRegionEvent(opened.regionId ?? 'exit', 'visit_stamp_skipped', {
      reason: 'region_mismatch',
      source,
      stored_region: current.regionId ?? null,
    });
    return false;
  }
  if (current.entryTimestamp !== opened.entryTimestamp) {
    // Name the relaxed path so we learn how often the strict guard was wrong,
    // rather than inferring it from `visit: null` months later.
    logRegionEvent(opened.regionId ?? 'exit', 'visit_stamp_relaxed', {
      source,
      stored_entry: current.entryTimestamp ?? null,
      opened_entry: opened.entryTimestamp,
      visit_id: visitId,
    });
  }
  return true;
}

/** Finalizes the active visit exactly once. Eligible exits are first written to
 * the durable retry queue, then the active key is removed. This ordering keeps
 * a headless task interruption from losing both the live session and its claim.
 * A native EXIT may only end its matching active region. */
export async function finalizeActiveGeofence(expectedRegionId?: string, endedAtOverrideMs?: number): Promise<boolean> {
  // Re-entrancy lease, taken SYNCHRONOUSLY before the first await.
  //
  // The `if (!raw) return true` gate below is not a mutex: ACTIVE_GEOFENCE_KEY is
  // read at the top and only removed ~30 lines later, and `await getItem` alone
  // yields the microtask queue — so every concurrent invocation (the headless
  // location task fires one per fix, and foreground + headless contexts both run
  // it) sails through. Visit 54b70cb6 logged 31 `exit` rows in 1.4 s with
  // client-stamped ended_at spanning 21 ms, and 194 `upgraded` rows in 10.1 s —
  // 70% of every upgrade event in the table. Beyond the noise, the resulting RPC
  // backlog delayed the NEXT visit's open_gym_visit by ~70 s.
  //
  // Must be in-memory and synchronous: an AsyncStorage lock has the identical
  // read-then-write race it is trying to prevent — VISIT_TICK_KEY proves that
  // (451 of 1,044 stream_tick rows are redundant burst rows). Mirrors
  // _recordingInFlight, including stealing a lease older than the stale window so
  // a hung request can never livelock the exit.
  const heldSince = _finalizeInFlight;
  if (heldSince != null && Date.now() - heldSince < STALE_CLAIM_LOCK_MS) {
    console.log('[Geofence] finalizeActiveGeofence already in flight — skipping duplicate exit.');
    return false;
  }
  if (heldSince != null) {
    console.warn('[Geofence] finalize lease is stale — presuming the attempt dead and taking over.');
  }
  const myFinalizeStamp = Date.now();
  _finalizeInFlight = myFinalizeStamp;
  try {
    return await finalizeActiveGeofenceInner(expectedRegionId, endedAtOverrideMs);
  } finally {
    // Fenced: only the holder clears, so a stolen-from zombie can't release the
    // lease out from under whoever took it over.
    if (_finalizeInFlight === myFinalizeStamp) _finalizeInFlight = null;
  }
}

let _finalizeInFlight: number | null = null;

/** Tears down per-account geofence state at sign-out.
 *
 *  Neither AuthContext's SIGNED_OUT branch nor signOut() cleared any of this, and
 *  StoredGeofence carried no owner — so an active session and, more seriously, the
 *  exit-claim outbox survived an account switch and were replayed under whoever
 *  signed in next (flushPendingClaims had only a 24 h age cut). Two prod sessions
 *  belonging to different users share one raw_gps entryTimestamp on one device.
 *
 *  ⚠ The active session is CLEARED, but the pending-claim outbox is deliberately
 *  NOT. Those entries are finished gym sessions that have not been paid yet —
 *  deleting them destroys real points, and signing out is not a forfeit. Instead
 *  every unstamped entry is backfilled with the departing user's id, so the
 *  ownership fence in flushPendingClaims can keep them for that account and hand
 *  them back when they sign in again. That closes the same cross-account hole
 *  without the data loss.
 *
 *  Closes the beacon first so the server stops waking a device whose session is
 *  over. That RPC needs auth, so call this BEFORE the token is gone where possible;
 *  it is best-effort either way, and the 12 h backstop still closes the visit. */
export async function clearGeofenceStateOnSignOut(departingUserId?: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    const active: StoredGeofence | null = raw ? JSON.parse(raw) : null;
    if (active?.visitId) {
      const { closeGymVisit } = await import('@/lib/gymVisits');
      await closeGymVisit(active.visitId, Date.now()).catch(() => {});
    }
  } catch { /* best-effort */ }

  // Stand the dwell stream down too — otherwise a signed-out device keeps burning
  // battery on time-driven location updates for a session nobody owns.
  try {
    await setLocationStreamMode(visitStreamMode(Platform.OS, { sessionActive: false, approaching: false }));
  } catch { /* non-fatal */ }

  await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY).catch(() => {});
  await AsyncStorage.removeItem(VISIT_TICK_KEY).catch(() => {});
  await AsyncStorage.removeItem(VISIT_TICK_THROTTLE_KEY).catch(() => {});
  await AsyncStorage.removeItem(LOCATION_LOSS_KEY).catch(() => {});
  _lastTickAtMs = 0;

  // Backfill ownership on anything banked before the stamp existed (or before the
  // check-in could resolve a session), so it can never be replayed by the next
  // account to sign in on this device.
  if (departingUserId) {
    try {
      const rawQueue = await AsyncStorage.getItem(PENDING_CLAIMS_KEY);
      if (rawQueue) {
        const queue = JSON.parse(rawQueue) as StoredGeofence[];
        if (Array.isArray(queue) && queue.some(e => !e.userId)) {
          const owned = queue.map(e => (e.userId ? e : { ...e, userId: departingUserId }));
          await AsyncStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(owned));
        }
      }
    } catch { /* non-fatal — the age cut still bounds exposure */ }
  }

  console.log('[Geofence] Cleared active session on sign-out; pending claims kept for their owner.');
}

async function finalizeActiveGeofenceInner(expectedRegionId?: string, endedAtOverrideMs?: number): Promise<boolean> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  } catch {
    return false;
  }
  if (!raw) return true;

  let active: StoredGeofence;
  try {
    active = JSON.parse(raw) as StoredGeofence;
  } catch {
    console.warn('[Geofence] Invalid active session state — preserving it for recovery.');
    return false;
  }

  if (expectedRegionId && active.regionId && active.regionId !== expectedRegionId) {
    console.log(`[Geofence] Exit for "${expectedRegionId}" ignored — active session is "${active.regionId}".`);
    return false;
  }

  // The override is the wake reconciler's honesty bound: a zombie session
  // (missed walk-out EXIT, discovered by a later fix showing us outside) ends
  // at the last PROVEN-inside moment, not at discovery time — a claim must
  // never count minutes nobody witnessed.
  const endedAtMs = Math.max(active.entryTimestamp, Math.min((endedAtOverrideMs != null && Number.isFinite(endedAtOverrideMs)) ? endedAtOverrideMs : Date.now(), Date.now()));
  const claimEntry: StoredGeofence = { ...active, endedAtMs };
  const needsClaim = (!active.sessionRecorded || active.pointsPending)
    && endedAtMs - active.entryTimestamp >= minDwellMs();

  if (needsClaim && !(await enqueuePendingClaim(claimEntry))) {
    // Do not clear the only recovery record when AsyncStorage cannot durably
    // write the exit outbox entry.
    return false;
  }

  try {
    await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
    // The credit floor and its liveness throttle belong to the visit that just
    // ended. Leaving them behind lets a stale "proven inside" moment outlive the
    // session it described; harmless while the next entryTimestamp is newer
    // (recordDwellSession takes the max), but it is state with no owner.
    await AsyncStorage.removeItem(VISIT_TICK_KEY).catch(() => {});
    await AsyncStorage.removeItem(VISIT_TICK_THROTTLE_KEY).catch(() => {});
    await AsyncStorage.removeItem(EXIT_STREAK_KEY).catch(() => {});
    // The check-in banner's cooldown belongs to the visit that just ended too —
    // otherwise a spurious check-in can silently eat the REAL one's notification
    // for the next half hour. See clearCheckInCooldown for the field case.
    if (active.regionId) {
      try {
        const { clearCheckInCooldown } = await import('@/lib/notifications');
        await clearCheckInCooldown(active.regionId);
      } catch { /* cosmetic — never let it cost the finalize */ }
    }
    _lastTickAtMs = 0;
  } catch {
    return false;
  }

  // Visit over — stand the dwell stream down (Android). Still inside the approach
  // ring (a location-detected EXIT can land before the native ring fires) → keep
  // the approach stream; otherwise back to the battery-friendly baseline. Leaving
  // the time-driven stream running would burn battery for the rest of the day.
  try {
    const approaching = (await AsyncStorage.getItem(APPROACH_STATE_KEY)) != null;
    await setLocationStreamMode(visitStreamMode(Platform.OS, { sessionActive: false, approaching }));
  } catch { /* non-fatal — worst case the stream stays in its prior mode */ }

  // iOS: withdraw un-earned session-mark banners FIRST — before ANY network,
  // and NEVER gated on visitId. Both gates bit on 2026-08-05 night: sessions
  // whose frozen-network entry had no visit id could never cancel, and even
  // with an id the cancel sat behind closeGymVisit's round-trip, which iOS's
  // relaunch window can cut short. Boundary wobble (exit→enter cycles) then
  // ACCUMULATED banner pairs — an 8-notification storm on one phone. Local
  // honesty must not wait on the network.
  // Nothing to cancel any more: the pre-scheduled marks were deleted on
  // 2026-08-07 (see setActiveAndNotify). Every banner the user sees for a
  // session now comes from the server, after the points actually landed, so
  // there is no local promise left that an early exit could turn into a lie.

  // Close the beacon so the server stops waking a device that has already left.
  //
  // ACTIVE_GEOFENCE_KEY is already gone by this point, so this is the last moment
  // anything on the device knows the visit exists. A silent failure here is what
  // orphans it — permanently, since re-opening the app finds no session to
  // finalize. Queue the retry instead of dropping it on the floor.
  // NEVER gated on visitId alone. Field 2026-08-08: Android reached this point
  // with visitId null on a real 60-minute session, and BOTH the close and the
  // retry queue below sat inside `if (active.visitId)` — so the visit was not
  // closed, was not queued, and could only ever be ended by the server reaper.
  // #364 fixed the case where closeGymVisit FAILS; it did not cover the case
  // where the id was never stamped, so such a visit never reached the outbox
  // built to save it. The stamp itself is fixed in setActiveAndNotify, but this
  // path must not depend on that having worked.
  let visitId = active.visitId ?? null;
  if (!visitId) {
    // The server can still tell us which visit this is — open_gym_visit returns
    // the user's existing OPEN visit rather than creating a second one, which is
    // exactly the resolve the client has been doing on every wake anyway.
    try {
      visitId = await openVisitTraced(
        'close_recovery', active.partnerId, active.regionId, active.entryTimestamp, active.visitId ?? null,
      );
    } catch { /* offline — fall through to the queue below */ }
    logRegionEvent(active.regionId ?? 'exit', 'visit_stamp_skipped', {
      reason: 'missing_at_close',
      recovered: !!visitId,
    });
  }

  if (visitId) {
    // CRASH-SAFE ORDER (field 2026-08-12): queue FIRST, attempt second, dequeue
    // on success. The old order — attempt, queue only on a RETURNED failure —
    // lost the close entirely when the process died mid-call: iOS suspends a
    // wake moments after its confirm round-trip, and the 15:06 outside verdict's
    // finalize deleted local state and then evaporated, leaving the visit open
    // with no record anywhere that a close was owed. The queue write is pure
    // storage (survives suspension); a duplicate flush of an already-closed
    // visit is absorbed server-side.
    await enqueuePendingVisitClose({
      visitId,
      endedAtMs,
      userId: active.userId,
      queuedAtMs: Date.now(),
    });
    let closed = false;
    let closeErr: string | null = null;
    try {
      const { closeGymVisit } = await import('@/lib/gymVisits');
      // ⚠ BOUNDED (2026-08-17). Unbounded, this await is the finalize path's
      // single point of failure: a close that never settles takes the whole exit
      // handler with it, and everything after this line — the dequeue, the
      // deferred row, the claim — never runs. A timeout converts a silent freeze
      // into a `reason: 'timeout'` row plus an entry that is still queued, which
      // is exactly the state the outbox exists to own. The entry was written to
      // the outbox BEFORE this attempt (queue first, attempt second), so nothing
      // is lost by giving up early.
      closed = await withNetworkTimeout(closeGymVisit(visitId, endedAtMs), 'close_gym_visit');
    } catch (err) {
      // stays queued for the next flush — but no longer stays SECRET
      closeErr = String((err as Error)?.message ?? err).slice(0, 120);
    }
    if (closed) {
      await dequeuePendingVisitClose(visitId);
    } else {
      // ⚠ A CLOSE THAT DOES NOT LAND IS THE MOST EXPENSIVE SILENCE IN THE SYSTEM,
      // and until now it left no trace at all. Field 2026-08-14 PM, Android: the
      // OS delivered a real region exit at 11:35:14, this function ran to
      // completion (the next sweeps report `handoff`, so local state was cleared),
      // and the server visit stayed OPEN until the reaper closed it at 11:47 —
      // stamping ended_at back at the 11:25 upgrade. The user walked out of a
      // 50.6-minute visit, was credited 40.0 minutes, and was told "Session
      // complete" twelve minutes after leaving. iOS was told in nine seconds.
      //
      // Three different faults produce that outcome and the trail could not tell
      // them apart: closeGymVisit THREW, it returned false, or the outbox took
      // the entry and never drained. They need different fixes — a retry, a
      // server-side look, and a flush trigger respectively — so name which one.
      //
      // Deliberately not a throw and not a retry here: the entry is already in
      // the crash-safe outbox above, and the flush is the right owner of the
      // retry. This row exists so the NEXT run is readable.
      logRegionEvent(active.regionId ?? 'exit', 'visit_close_deferred', {
        visit:       visitId,
        reason:      closeErr ?? 'returned_false',
        ended_at_ms: endedAtMs,
        queued:      true,
      });
    }
  }

  if (!needsClaim) {
    // SAY WHICH CLAUSE FAILED. needsClaim has two, and this line used to blame
    // the dwell for both — so on 2026-08-16 it printed "33min < threshold" with
    // the threshold at 30, sending the triage after a config bug that did not
    // exist while the real cause (an already-recorded session) went unnamed.
    const dwellMin = Math.round((endedAtMs - active.entryTimestamp) / 60000);
    const tooShort = endedAtMs - active.entryTimestamp < minDwellMs();
    console.log(
      tooShort
        ? `[Geofence] Dwell ${dwellMin}min < ${Math.round(minDwellMs() / 60000)}min threshold — no points.`
        : `[Geofence] Dwell ${dwellMin}min is creditable, but nothing to claim `
          + `(sessionRecorded=${active.sessionRecorded}, pointsPending=${active.pointsPending}) — no points.`,
    );
    return true;
  }

  const outcome = await recordExitAndClaim(claimEntry);
  if (outcome === 'resolved') await removePendingClaim(claimEntry);
  return true;
}

/** Handles a beacon wake-up: the server has told us a threshold has passed and is
 *  asking whether this device is still at the gym.
 *
 *  THIS is where the location gate lives, and it is the only thing that can unlock a
 *  credit. We take a FRESH fix and check it against the same radius that checked the
 *  user in. Inside → run the normal dwell machine (which claims at the dwell
 *  threshold and upgrades at the 40-min one, both via the usual server functions, so
 *  every existing eligibility rule and idempotency guard still applies). Outside →
 *  the user has left and we simply finalize the visit with the true duration.
 *
 *  The server cannot award anything on its own: if this never runs (device offline,
 *  iOS app force-quit — Apple does not deliver background pushes to a user-terminated
 *  app), nothing is credited here and the existing EXIT path claims later, exactly as
 *  it does today. No fix, no credit. */
/** ANDROID FENCE RE-ARM ON WAKE — now a DELIBERATE NO-OP while backgrounded.
 *
 *  History worth keeping, because it cost a week: this began (2026-08-05) as a
 *  self-heal for the mute-geofencer pattern — registry populated, crossings
 *  never delivered — on the theory that a fresh registration from a live
 *  process would repair the dead PendingIntent. It could not. Build 16's
 *  patched expo-location finally let GMS speak (2026-08-06): every headless
 *  re-arm is answered with "registration not active, registration not
 *  permitted" ×50, because startGeofencingAsync re-registers the task, expo's
 *  consumer removes the old fences first, and Google refuses the re-add
 *  outside the foreground. The "heal" was the wrecking ball — it is what took
 *  the 2026-08-06 walk to zero.
 *
 *  armNativeRegions now refuses any background re-arm of a live registration,
 *  so this function survives only for the case where nothing is registered
 *  (nothing to lose) and, mainly, as the documented place where that lesson
 *  lives. Fences are rebuilt in the FOREGROUND, full stop.
 *
 *  Everything awaited here is native or AsyncStorage (getArmFix answers from
 *  the stream cache / OS cache; the live-GPS branch is bounded). No network —
 *  callers rely on this chain never freezing, because the wake task starts it
 *  BEFORE the confirm round-trip that can. */
/** ARM THE MOMENT PERMISSION LANDS (2026-08-06 field).
 *
 *  Granting background location used to arm nothing. The startup effect
 *  checks permission, and when it is missing it clears the partner
 *  fingerprint and returns — so arming waits for the NEXT partner refresh
 *  (app launch, return-to-foreground, or the 5-minute interval). A user who
 *  grants permission and then pockets the phone — onboarding's single most
 *  common ending — walks to the gym with nothing armed.
 *
 *  That is exactly what happened on the 08-06 walk: permission granted in-app
 *  at 18:47, app swiped 30 s later, zero `armed` rows until the app was
 *  reopened at 19:10, at which point it armed 20 regions in three seconds.
 *
 *  So every permission-granting surface calls this immediately afterwards. It
 *  is idempotent and cheap: the same-set signature check makes a redundant
 *  call a no-op, and a failure just leaves the old refresh path to catch it.
 *
 *  Ordering matters: fetch the geometry cache FIRST. On a fresh install the
 *  map is empty, and armNativeRegions with no map returns early — the second
 *  way this silently does nothing. */
export function armAfterPermissionGrant(): Promise<void> {
  // Coalesce concurrent callers. 2026-08-13 field run: the settings-return
  // grant fired this TWICE ~130 ms apart — returning from the system radio
  // list resolves the awaited permission request AND fires AppState→active,
  // and both paths call their surface's finish(). Two overlapping runs mean
  // two forceRebinds churning the wake binding and two arms racing
  // startGeofencingAsync (the second cancels the first's PendingIntent —
  // see _armChain). The grant surfaces are latched too; this is the backstop
  // for any pair of callers, present or future.
  if (_grantArmInFlight) return _grantArmInFlight;
  _grantArmInFlight = armAfterPermissionGrantInner()
    .finally(() => { _grantArmInFlight = null; });
  return _grantArmInFlight;
}

let _grantArmInFlight: Promise<void> | null = null;

async function armAfterPermissionGrantInner(): Promise<void> {
  try {
    // BEFORE the permission reads, unconditionally: the grant itself is what
    // kills the native wake binding (field 2026-08-12 — bindings died at the
    // 08:10 grant and the fg-service kept the broken process alive through
    // every swipe, so no later moment ever healed it). Fences are worthless if
    // the wakes that drive claims are being delivered to a dead binding.
    try {
      const { forceRebindBackgroundNotificationTask } = await import('@/lib/backgroundNotificationTask');
      await forceRebindBackgroundNotificationTask();
    } catch { /* the fences below must still arm */ }

    const { status: fg } = await Location.getForegroundPermissionsAsync();
    if (fg !== 'granted') return;
    const { status: bg } = await Location.getBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      // Worth a row: "granted foreground only" is invisible from the server
      // otherwise, and it is the difference between a working install and one
      // that can never check in.
      logRegionEvent('arm', 'rearm_skipped', { reason: 'background_permission_missing' });
      return;
    }

    if (!(await readPartnerMap())) {
      await fetchAndCacheAllPartnerGeometry();
    }

    const fix = await getArmFix();
    await armNativeRegions(fix, { force: true, via: 'permission_grant' });
    console.log('[Geofence] Armed immediately after permission grant.');
  } catch (err) {
    console.warn('[Geofence] Arm-on-grant failed (the refresh path still covers it):', err);
  }
}

export async function rearmFencesFromWake(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const fix = await getArmFix();
    await armNativeRegions(fix, { force: true, freshHandle: true, via: 'wake_fresh_handle' });
  } catch (err) {
    console.warn('[Geofence] wake re-arm failed:', err);
  }
}

/** ZOMBIE-SESSION RECONCILER (2026-08-05 night) — runs on visit-less wakes
 *  (the beacon's fence-refresh ping).
 *
 *  The walk-killer it exists for: a swiped-away phone misses its walk-out EXIT
 *  (mute geofencer — see rearmFencesFromWake), so the persisted session stays
 *  active forever, and the NEXT real arrival is refused by the enter handler
 *  ("Enter ignored — session already active"). One missed exit silently eats
 *  every future check-in until app-open.
 *
 *  The discriminator is a GPS fix, never a timer: by age alone a zombie is
 *  indistinguishable from a live swiped in-gym session (neither gets ticks
 *  while the process is dead), and resetting a live session would destroy its
 *  accrued dwell. Only a fix showing the device OUTSIDE the session's own
 *  radius — buffered by the fix's reported accuracy, so a coarse fix
 *  self-gates into a no-op — may finalize it. endedAt is bounded to the last
 *  PROVEN-inside moment (VISIT_TICK_KEY: stream heartbeats + confirmed-inside
 *  wakes), so the finalized claim cannot inflate dwell up to ping time. */
const RECONCILE_MIN_SESSION_AGE_MS = 10 * 60_000;
// Was 3 minutes. At walking pace that is ~250 m of travel, which is more than the
// whole decision: the exit test is "am I outside radius + buffer", and on a 20 m
// fence a 3-minute-old fix can put a departed user back inside. Field 2026-08-07:
// the device reported nearest_m 85 with a 50 s-old fix while the user stood 400 m
// away, and the visit never closed. 90 s keeps a cheap cache hit for the common
// case without letting the fix outlive the question it is answering.
const RECONCILE_FIX_MAX_AGE_MS = 90_000;

/** Login-time zombie patrol (2026-08-12). A session destroyed by auth machinery
 *  never runs clearGeofenceStateOnSignOut, so the next login inherits whatever
 *  active-session state the old login left behind — and the first reader then
 *  replays a phantom check-in (field: visit 0186f114, minted at the user's home
 *  moments after a re-login). Another account's leftovers are cleared outright;
 *  the same account's are handed to the wake reconciler, which closes only on a
 *  real fix showing the device outside — a live same-user session survives. */
export async function reconcileActiveOnLogin(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (!raw) return;
    const active = JSON.parse(raw) as StoredGeofence;
    if (active.userId && active.userId !== userId) {
      console.warn('[Geofence] Login found another account\'s active session — clearing it.');
      await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY).catch(() => {});
      await AsyncStorage.removeItem(VISIT_TICK_KEY).catch(() => {});
      await AsyncStorage.removeItem(VISIT_TICK_THROTTLE_KEY).catch(() => {});
      await AsyncStorage.removeItem(EXIT_STREAK_KEY).catch(() => {});
      return;
    }
    await reconcileActiveSessionFromWake();
  } catch { /* best-effort — the wake reconciler still owns the steady state */ }
}

export async function reconcileActiveSessionFromWake(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (!raw) return;
    const active = JSON.parse(raw) as StoredGeofence;
    if (active.latitude == null || active.longitude == null || active.radius == null) return;
    // Too young to be the zombie blocking anyone's return walk — and a fresh
    // boundary check-in deserves its wobble grace.
    if (Date.now() - active.entryTimestamp < RECONCILE_MIN_SESSION_AGE_MS) return;

    const fix = await reconcileFix();
    if (!fix) return; // no usable evidence — keep the session; never guess

    const { exitBoundM, fixCreditsPresence } = await import('@/lib/health/gymPresence');
    const distance = haversineMetres(fix.latitude, fix.longitude, active.latitude, active.longitude);
    // ⚠ WAS `Math.max(fix.accuracy ?? 50, LOCATION_EXIT_HYSTERESIS_M)`, which let a
    // 900 m fix claim presence anywhere within 920 m of the venue. Bounded now.
    if (distance <= exitBoundM(active.radius, LOCATION_EXIT_HYSTERESIS_M, fix.accuracy ?? null)) {
      // Still inside by the (bounded) exit test — so do NOT close. But staying open
      // and BILLING are different questions: the evidence floor moves only on a fix
      // good enough to pay out on, the same rule the wake confirm and the stream
      // heartbeat now use. A visit kept alive on a vague fix stops accruing time.
      if (fixCreditsPresence({
        fixTrusted: fix.accuracy == null || fix.accuracy <= MAX_FIX_ACCURACY_M,
        distanceM: distance,
        radiusM: active.radius,
        accuracyM: fix.accuracy ?? null,
      })) {
        await AsyncStorage.setItem(VISIT_TICK_KEY, String(Date.now())).catch(() => {});
      }
      return;
    }

    const tickRaw = await AsyncStorage.getItem(VISIT_TICK_KEY).catch(() => null);
    const tick = Number(tickRaw ?? 0);
    const endedAt = Math.max(active.entryTimestamp, Number.isFinite(tick) ? tick : 0);
    console.warn(
      `[Geofence] Wake reconcile: fix is ${Math.round(distance)}m from "${active.partnerName}" ` +
      `(bound ${Math.round(exitBoundM(active.radius, LOCATION_EXIT_HYSTERESIS_M, fix.accuracy ?? null))}m) — finalizing zombie session, ` +
      `ended ${Math.round((Date.now() - endedAt) / 60_000)}min ago by last inside-evidence.`,
    );
    await finalizeActiveGeofence(undefined, endedAt);
  } catch (err) {
    console.warn('[Geofence] wake reconcile failed:', err);
  }
}

/** Accuracy-carrying cousin of getArmFix: reconciliation needs the fix's own
 *  accuracy for the outside buffer, and tolerates no source that can hang. */
async function reconcileFix(): Promise<{ latitude: number; longitude: number; accuracy: number | null } | null> {
  // A fix too coarse to resolve the fence cannot answer "am I outside", and
  // returning one anyway is worse than returning nothing: the caller's buffer is
  // max(accuracy, 50), so a 247 m fix demands the user be ~250 m clear before it
  // will concede they left — and if the coarse position happens to sit near the
  // venue it silently re-confirms presence instead. That is the whole shape of the
  // 2026-08-07 failure, and of the 5½-hour phantom visit that morning (every one of
  // those confirms carried accuracy_m 100). Screen cached sources on accuracy and
  // fall through to a real acquisition rather than deciding on a blur.
  const usable = (accuracy: number | null | undefined) =>
    accuracy == null || accuracy <= MAX_FIX_ACCURACY_M;

  // 1. The stream's persisted fix, when fresh enough AND sharp enough to speak for "now".
  try {
    const raw = await AsyncStorage.getItem(LAST_STREAM_FIX_KEY);
    if (raw) {
      const f = JSON.parse(raw) as { latitude?: number; longitude?: number; accuracy?: number | null; at?: number };
      if (typeof f?.latitude === 'number' && typeof f?.longitude === 'number'
          && Date.now() - (f.at ?? 0) <= RECONCILE_FIX_MAX_AGE_MS
          && usable(f.accuracy)) {
        return { latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy ?? null };
      }
    }
  } catch { /* fall through to the OS sources */ }

  // 2. OS cache — no acquisition, cannot hang. The ping's own re-arm just made
  // GMS evaluate fence states, so this is usually seconds old.
  const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: RECONCILE_FIX_MAX_AGE_MS })
    .catch(() => null);
  if (lastKnown && usable(lastKnown.coords.accuracy)) {
    return {
      latitude: lastKnown.coords.latitude,
      longitude: lastKnown.coords.longitude,
      accuracy: lastKnown.coords.accuracy ?? null,
    };
  }

  // 3. One bounded live read. The bound is best-effort under Doze (RN timers
  // can freeze) — a hang here holds only the wake task's tail, never the
  // re-arm, which its caller sequences first.
  //
  // HIGH, not Balanced. Balanced on Android is a fused/network position good to a
  // few hundred metres — it cannot resolve a 20 m fence, so asking for it and then
  // rejecting it as coarse wastes the one acquisition this wake gets. The claim
  // path already proves High is affordable here: on 2026-08-07 the dwell and
  // upgrade wakes returned 20 m, 11 m and 15 m fixes inside their wake windows.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ARM_FIX_TIMEOUT_MS); }),
    ]);
    if (!fresh) return null;
    return {
      latitude: fresh.coords.latitude,
      longitude: fresh.coords.longitude,
      accuracy: fresh.coords.accuracy ?? null,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** LOCATION-OFF SESSION CLOSE (2026-08-09).
 *
 *  A session and the location permission feeding it are one mechanism, and until
 *  now only one half knew it. Turn location off mid-visit and the dwell stream
 *  stops delivering fixes, VISIT_TICK_KEY stops advancing, no EXIT can ever fire,
 *  and evaluateLocationFix's geometry never runs — so the visit stayed open until
 *  the 12 h server reaper, which on Android produces a DUPLICATE visit (field
 *  2026-08-08). Whatever finalized it later stamped the wall clock, which is
 *  precisely where the 12-hour duration rows come from (see recordDwellSession).
 *
 *  So: no location, no verified session. Two rules make that honest rather than
 *  punitive, and neither is optional.
 *
 *  1. IT TRUNCATES, IT DOES NOT VOID. Points already earned stay earned — a
 *     revocation after the dwell threshold is not fraud, and finalizeActiveGeofence
 *     still runs the claim for whatever the evidence supports. Never-drop-a-workout
 *     applies here as much as anywhere.
 *  2. IT ENDS AT THE LAST PROVEN-INSIDE MOMENT, NOT AT DISCOVERY. There is no OS
 *     callback for "the user revoked location", so this runs on app-foreground and
 *     on the sweep — potentially hours after the fact. Closing at `now` would bank
 *     hours of unwitnessed time into the very row we are closing BECAUSE it can no
 *     longer be witnessed. VISIT_TICK_KEY is the same evidence floor the zombie
 *     reconciler uses, and with no tick at all the honest answer is entryTimestamp:
 *     we proved presence at one instant and never again.
 *
 *  Turning location back on recovers cheaply: every permission-granting surface
 *  calls armAfterPermissionGrant, whose initial-state burst checks a still-present
 *  user straight back in, and the gym_visits row only ever GROWS (#345), so the
 *  second session of the day tops up the first rather than replacing it.
 *
 *  Nothing here acts on ONE reading — see the confirmation marker below. Three
 *  things can void a pending confirmation, and all three exist because a marker
 *  that outlives its context would let a once-seen loss pass as a confirmed one:
 *  a healthy read (the loss was a blip), a changed reason (different condition),
 *  and the kill switch (off means forget, not pause).
 *
 *  Returns whether it closed a session. */
export async function finalizeSessionIfLocationRevoked(): Promise<boolean> {
  const mode = getLocationCloseMode();
  if (mode === 'off') {
    // Kill switch — no permission reads, no session read. But it must not leave
    // a half-finished decision lying around: the flag is flipped server-side and
    // can come back mid-session, and a marker written before it went off would
    // already be older than the confirmation window. The very next check would
    // then "confirm" a loss it had never seen twice, which is precisely the
    // single-reading close this staging exists to prevent. Switching off means
    // forgetting, not pausing.
    await AsyncStorage.removeItem(LOCATION_LOSS_KEY).catch(() => {});
    return false;
  }

  let active: StoredGeofence;
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (!raw) {
      // No session to lose — drop any marker so the next one starts clean.
      await AsyncStorage.removeItem(LOCATION_LOSS_KEY).catch(() => {});
      return false;
    }
    active = JSON.parse(raw) as StoredGeofence;
  } catch {
    return false; // unreadable state is finalizeActiveGeofence's problem, not ours
  }

  let reason: LocationLossReason | null;
  try {
    reason = await detectLocationLoss();
  } catch {
    return false; // fails closed — never guess a session away
  }

  if (!reason) {
    // Location is fine. Clear any pending marker: whatever we saw before was a
    // blip, and it must not be allowed to combine with a future sighting into a
    // "confirmed" revocation that never actually persisted.
    await AsyncStorage.removeItem(LOCATION_LOSS_KEY).catch(() => {});
    return false;
  }

  // ── TWO SIGHTINGS, SPACED IN TIME, BEFORE ANYTHING ENDS ──────────────────
  // The zombie reconciler demands a GPS fix buffered by its own accuracy before
  // it dares finalize; this ran on a single permission read, which is far weaker
  // evidence for an equally destructive act. The cold-launch check is the worst
  // case: it fires the instant the provider mounts, which is exactly when a
  // native permission read is least trustworthy.
  //
  // Confirmation is a PERSISTED MARKER rather than a timer, deliberately. A
  // setTimeout here would be a wake-path liability — RN drives timers off the UI
  // frame clock and under Doze they simply do not fire (field 2026-07-14: a 30 s
  // timeout still pending 16 minutes later). The marker instead spaces the two
  // observations by the app's real cadence: the next foreground, or the next
  // ~5-6 min sweep. Cheap, timer-free, and it survives process death.
  //
  // Keyed on entryTimestamp so a marker can never outlive the session that
  // produced it and condemn the next one.
  //
  // ⚠ The failure mode is deliberately asymmetric. If the second sighting never
  // arrives, the session simply stays open — the pre-existing behaviour, with the
  // reaper as backstop. We would rather miss a close than invent one.
  const now = Date.now();
  let marker: LocationLossMarker | null = null;
  try {
    const raw = await AsyncStorage.getItem(LOCATION_LOSS_KEY);
    const parsed = raw ? (JSON.parse(raw) as LocationLossMarker) : null;
    if (parsed && parsed.entryTimestamp === active.entryTimestamp) marker = parsed;
  } catch { /* treat an unreadable marker as absent — this is the first sighting */ }

  // A DIFFERENT reason is a DIFFERENT condition, and inherits nothing.
  // Otherwise a marker aged past the window under one cause (Services off) would
  // let an unrelated later cause (permission revoked) skip confirmation entirely
  // on its very first sighting — the two-spaced-sightings guarantee would hold
  // for "some loss" while the thing actually being acted on had been seen once.
  //
  // ⚠ This rule has a failure mode of its own, and it is why firstLossAtMs and
  // reasonChanges exist. detectLocationLoss tests Services BEFORE permission, so
  // a device that is BOTH downgraded to "While Using" AND has battery-saver
  // toggling Services reports services_disabled / permission_downgraded
  // alternately — resetting on every change, never confirming, on a session that
  // genuinely cannot be verified. That is the original bug wearing a new hat.
  // It errs in the direction we chose (miss a close rather than invent one), so
  // it ships as-is, but the observe rows now carry the fingerprint that would
  // prove it: a large loss_total_s beside a small confirmed_after_s, with
  // reason_changes climbing. If the field shows it, the fix is to confirm on the
  // unbroken run once the reason has stopped moving — not to weaken this rule.
  const reasonChanged = !!marker && marker.reason !== reason;

  if (!marker || reasonChanged) {
    await AsyncStorage.setItem(LOCATION_LOSS_KEY, JSON.stringify({
      reason,
      firstSeenAtMs:  now,
      entryTimestamp: active.entryTimestamp,
      // Preserved across a reason change: this run of losses has been unbroken
      // (a healthy read would have deleted the marker above), so the run's start
      // is still the older timestamp.
      firstLossAtMs:  marker?.firstLossAtMs ?? marker?.firstSeenAtMs ?? now,
      reasonChanges:  reasonChanged ? (marker?.reasonChanges ?? 0) + 1 : 0,
    } satisfies LocationLossMarker)).catch(() => {});
    console.log(
      reasonChanged
        ? `[Geofence] Location loss changed ${marker?.reason} → ${reason} — restarting confirmation.`
        : `[Geofence] Location ${reason} with a session open — first sighting, awaiting confirmation.`,
    );
    return false;
  }

  const heldForMs = now - marker.firstSeenAtMs;
  if (heldForMs < LOCATION_LOSS_CONFIRM_MS) return false;

  const tick = await AsyncStorage.getItem(VISIT_TICK_KEY)
    .then(raw => Number(raw ?? 0))
    .catch(() => 0);
  const endedAtMs = Math.max(active.entryTimestamp, Number.isFinite(tick) ? tick : 0);

  // One row per decision, not one per sweep: in 'observe' mode the session stays
  // open, so without this the same verdict would be re-logged every ~5 min for
  // the rest of the visit and the counts would be cadence, not incidence.
  if (!marker.decided) {
    logRegionEvent(active.regionId ?? 'location', 'location_revoked', {
      mode,
      would_close:     true,
      closed:          mode === 'on',
      reason,
      // confirmed_after_s is THIS reason's window; loss_total_s is the whole
      // unbroken run. They diverge only when the reason changed on the way here,
      // which reason_changes counts — together they are the oscillation tell.
      confirmed_after_s: Math.round(heldForMs / 1000),
      loss_total_s:    Math.round((now - (marker.firstLossAtMs ?? marker.firstSeenAtMs)) / 1000),
      reason_changes:  marker.reasonChanges ?? 0,
      session_age_min: Math.round((now - active.entryTimestamp) / 60_000),
      dwell_min:       Math.round((endedAtMs - active.entryTimestamp) / 60_000),
      unwitnessed_min: Math.round((now - endedAtMs) / 60_000),
      had_tick:        endedAtMs > active.entryTimestamp,
      recorded:        !!active.sessionRecorded,
      platform_os:     Platform.OS,
    });
    await AsyncStorage.setItem(LOCATION_LOSS_KEY, JSON.stringify({
      ...marker, decided: true,
    } satisfies LocationLossMarker)).catch(() => {});
  }

  if (mode !== 'on') {
    // OBSERVE. The detector has reached a verdict and recorded it; the session is
    // left exactly as it was before PR #366. This is the whole staging mechanism —
    // read these rows, then flip system_config.location_close_mode to 'on'.
    console.log(
      `[Geofence] [observe] Would close "${active.partnerName}" — location ${reason} ` +
      `for ${Math.round(heldForMs / 1000)}s. No action taken (location_close_mode=${mode}).`,
    );
    return false;
  }

  console.warn(
    `[Geofence] Location ${reason} during an open session at "${active.partnerName}" — ` +
    `closing it at the last proven-inside moment ` +
    `(${Math.round((endedAtMs - active.entryTimestamp) / 60_000)}min dwell, discovered ` +
    `${Math.round((now - endedAtMs) / 60_000)}min later).`,
  );

  // THE BANNER GOES BEFORE THE NETWORK, and this ordering is the point.
  // finalizeActiveGeofence returns only after up to three awaited round-trips
  // (openGymVisit, closeGymVisit, the claim) — the exact frames this codebase has
  // repeatedly recorded as never settling on a backgrounded device. Announcing
  // afterwards would lose the banner precisely on the sweep path, in the
  // background, which is where a revocation is most likely to be discovered and
  // where the user has least idea anything happened. Local honesty must not wait
  // on the network (same rule as the exit-path banner withdrawal above).
  //
  // What it costs: finalize can still decline — a broken AsyncStorage, or a
  // concurrent finalize holding the lease. Neither makes this a lie. Location IS
  // off, the session IS ending, and a declined write is retried on the next
  // foreground. The identifier is keyed on the visit, so a repeat attempt
  // replaces the banner instead of stacking a second one.
  try {
    const { notifyLocationOffSessionEnded } = await import('@/lib/notifications');
    await notifyLocationOffSessionEnded(
      active.partnerName,
      active.visitId ?? String(active.entryTimestamp),
    );
  } catch { /* the close is what matters; a missing banner must not block it */ }

  // The ordinary exit path from here: the claim, the visit close and its outbox
  // retry, the stream stand-down. False means it could not durably record the
  // exit, so the session is deliberately still there — retried on the next
  // foreground or sweep rather than lost.
  const closed = await finalizeActiveGeofence(undefined, endedAtMs);
  if (closed) await AsyncStorage.removeItem(LOCATION_LOSS_KEY).catch(() => {});
  return closed;
}

export async function runVisitCheck(
  stage: 'dwell' | 'upgrade',
  serverVisitId?: string,
  /** The nudge's short-lived ticket. When present, the ENTIRE check runs
   *  auth-free: telemetry and confirm ride the nonce (raw fetch + anon key),
   *  and no auth round-trip is ever awaited — the 2026-08-05 freeze class. */
  wakeNonce?: string,
): Promise<void> {
  // The presence-sweep ping carries the PLACEHOLDER nonce 'fence-refresh' and no
  // visit id — the beacon borrows the field purely to select the auth-free wake
  // path. It is not scoped to any visit, so confirming a locally-stored visit
  // with it is guaranteed to fail: field 2026-08-07, two `confirm_gym_visit_v3
  // 400 invalid or expired wake nonce` per iPhone per ping once a session was
  // live. Treat it as what it is — a wake, not a ticket. The sweep and reconcile
  // that the ping actually exists for run in the background task before this,
  // and are unaffected.
  const isSweepPing = wakeNonce === 'fence-refresh';
  if (isSweepPing) wakeNonce = undefined;

  // Feed the wake-starvation watchdog: any entry here — background task OR the
  // foreground notification handler — proves server wakes are reaching JS.
  // Fire-and-forget; a lost stamp just leaves the watchdog a staler reading.
  void AsyncStorage.setItem(LAST_WAKE_AT_KEY, String(Date.now())).catch(() => {});

  const trace: WakeTrace = { stage };
  // Freshness before the first server touch — but ONLY on ticketless FOREGROUND
  // entries. A ticketed wake must never await auth, a sweep ping counts as
  // ticketed for this purpose even though its nonce is useless, and since
  // 2026-08-11 a ticketless BACKGROUND entry (legacy nudge) skips it too: the
  // confirm now presents the persisted token itself over raw fetch, so the
  // only case this pass could still serve back there is a spent token — and
  // that case reaches the machinery anyway via confirmGymVisit's authed
  // fallback, without holding the whole check hostage first.
  if (!wakeNonce && !isSweepPing && AppState.currentState === 'active') {
    await ensureFreshSession(`visit_check_${stage}`);
  }
  await tracedStep('prime_config', trace, () => primeGymDwellMinutes(), STEP_TIMEOUT_MS);

  const raw = await tracedStep('read_active', trace, () => AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY), STEP_TIMEOUT_MS);
  const active: StoredGeofence | null = raw ? JSON.parse(raw) : null;
  if (!active) {
    console.log('[Geofence] Visit check: no active session — ignoring.');
    return;
  }

  // RECONCILE against the server's own visit id, which rides on the wake payload.
  // The device's stored id was previously the only input, and it can go stale while
  // a live visit is being nudged: on 2026-07-16 the exit closed 2fa4e05d at
  // 07:30:46, a fresh visit 793e434a opened 4 s later, and all FOUR of the new
  // visit's nudges were answered 0.6-0.9 s later by confirms written to the DEAD
  // row — 100 minutes of it. 793e434a recorded zero confirms and burned its entire
  // nudge budget. The server is the authority on which visit it is asking about, so
  // answer for THAT one and repair local state.
  //
  // The presence verdict below is still computed from `active`'s geometry, which is
  // correct: it answers "am I inside the gym I checked into", and since the
  // one-live-visit invariant (2026-07-30) plus the reuse bound (2026-08-01) hold,
  // a user has at most one live visit and it is this session's.
  // `let`, because the late-open below may resolve it before the confirm runs —
  // see the C1 block. It used to be resolved AFTER the confirm, which is why a
  // wake on an unstamped session confirmed nothing at all (field 2026-08-17).
  let visitId = serverVisitId ?? active.visitId;
  const visitMismatch = !!serverVisitId && !!active.visitId && serverVisitId !== active.visitId;
  if (visitMismatch) {
    console.warn(
      `[Geofence] Visit check: stored visit ${active.visitId} != server ${serverVisitId} — answering for the server's.`,
    );
    try {
      // Fresh read, not a re-parse of `raw` — another context (finalize, a
      // concurrent stamp) may have moved the record since; a gone key must
      // never be resurrected by this repair.
      const rawNow = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const current = rawNow ? JSON.parse(rawNow) as StoredGeofence : null;
      if (current && current.visitId === active.visitId) {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...current, visitId: serverVisitId }));
      }
    } catch { /* best-effort repair — never block the wake's one round-trip */ }
  }

  let coords: Location.LocationObjectCoords | null = null;
  let fixSource = 'none';
  // Age of whatever fix we end up reasoning about, for the CREDIT decision only.
  // `last_known` is capped at 60 s and `acquired` is fresh by construction, so
  // only the stream cache can be meaningfully stale — and it was, by 219 s, when
  // it stamped proof of presence four minutes after the user left (2026-08-10).
  let fixAgeMs: number | null = null;

  // ORDER MATTERS, and it is the opposite of what it was.
  //
  // The stream's persisted fix comes FIRST because it needs nothing from the
  // location subsystem — just a storage read. Everything else here calls into
  // expo-location, and on 2026-08-03 that subsystem demonstrably refused to serve
  // this app from a background context: startLocationUpdatesAsync came back
  // "Foreground service cannot be started when the application is in the
  // background", and every one of the four wakes that evening froze in this block
  // before reaching the log below. AsyncStorage was NOT the problem — the location
  // task used it 58 times in the same window — and neither was the network, since
  // log_gym_wake_received landed in about a second on all four wakes. That leaves
  // the location calls, so they are now the fallback rather than the first choice.
  //
  // This costs nothing in accuracy: while checked in, the stream delivers a fix
  // every ~60 s, so its cached fix is typically fresher than the ~10 s wake window
  // could acquire anyway. "No fix, no credit" is unchanged — a stale or missing
  // cache still falls through to a real acquisition, and failing that reports no_fix.
  const stored = await tracedStep('read_stream_fix', trace, () => AsyncStorage.getItem(LAST_STREAM_FIX_KEY), STEP_TIMEOUT_MS);
  let streamFix: { latitude: number; longitude: number; accuracy: number | null; at: number } | null = null;
  try { streamFix = stored ? JSON.parse(stored) : null; } catch { /* corrupted value — fall through */ }

  if (streamFix && Date.now() - streamFix.at <= STREAM_FIX_MAX_AGE_MS) {
    coords = { latitude: streamFix.latitude, longitude: streamFix.longitude, accuracy: streamFix.accuracy } as Location.LocationObjectCoords;
    fixSource = 'stream_cache';
    fixAgeMs = Date.now() - streamFix.at;
    trace.stream_fix_age_s = Math.round(fixAgeMs / 1000);
  } else {
    trace.stream_fix_age_s = streamFix ? Math.round((Date.now() - streamFix.at) / 1000) : 'absent';
    const cached = await tracedStep('last_known', trace, () => Location.getLastKnownPositionAsync({ maxAge: 60_000 }), STEP_TIMEOUT_MS);
    if (cached) {
      coords = cached.coords;
      fixSource = 'last_known';
      fixAgeMs = typeof cached.timestamp === 'number' ? Date.now() - cached.timestamp : null;
    } else {
      // GPS first, network second — see acquireFixPreferHigh. This is already the
      // last resort (stream cache and last-known both missed), so it is the one
      // acquisition in the wake worth spending on: everything downstream of it is
      // a geometric decision, and a 350 m answer fails every one of them.
      // The two slices share the existing budget, so the wake's bound is unchanged.
      const fresh = await tracedStep(
        'acquire',
        trace,
        () => acquireFixPreferHigh(FIX_ACQUIRE_TIMEOUT_MS - 3_000, 3_000),
        FIX_ACQUIRE_TIMEOUT_MS,
      );
      coords = fresh?.coords ?? null;
      fixSource = fresh ? 'acquired' : 'timeout';
      fixAgeMs = fresh ? 0 : null;
    }
  }
  trace.fix_source = fixSource;
  if (fixAgeMs != null) trace.fix_age_ms = fixAgeMs;
  console.log(`[Geofence] Visit check (${stage}): fix source = ${fixSource}.`);

  // No fix = no proof = no credit. Leave the visit open; the server will nudge
  // again, and failing that the exit path still resolves it.
  if (!coords) {
    if (visitId) {
      const { confirmGymVisit, confirmGymVisitViaNonce } = await import('@/lib/gymVisits');
      const detail = { stage, reason: 'no_fix', visit_mismatch: visitMismatch, trace };
      // The nonce is bound to the SERVER's visit; after the mismatch repair
      // above, visitId is exactly that visit whenever a ticket exists.
      if (wakeNonce) await confirmGymVisitViaNonce(visitId, wakeNonce, false, detail);
      else await confirmGymVisit(visitId, false, detail);
    }
    return;
  }

  // Geometry unknown (older active state) → assume inside rather than drop a real
  // session; the dwell machine's own thresholds still gate the claim.
  let inside = true;
  let distance: number | null = null;
  // Captured here so the credit test below can use it: the narrowing on
  // `active.radius` does not survive this block.
  let radiusM: number | null = null;
  if (active.latitude != null && active.longitude != null && active.radius != null) {
    distance = haversineMetres(coords.latitude, coords.longitude, active.latitude, active.longitude);
    radiusM = active.radius;
    inside = distance <= active.radius + LOCATION_EXIT_HYSTERESIS_M;
  }

  // Is this fix good enough for `distance_m` to mean anything? Field 2026-08-08,
  // 09:54: Android answered a presence nudge with accuracy_m 574 and reported
  // distance_m 49 while its owner was several hundred metres away — and the row
  // read exactly like a genuine confirm. That is the signature of every phantom
  // confirm in the 5½-hour zombie visit (all of which carried the 100.0
  // sentinel), and it is what keeps a visit provably "alive" after the user has
  // gone.
  //
  // The DECISION is deliberately unchanged: `inside` still defaults true on a
  // bad fix, because refusing coarse fixes here would starve the time-based
  // dwell exactly as it did on 07-03/07-11 (indoor GPS is routinely >100 m), and
  // the reaper + presence pass are the intended defence against a zombie. What
  // changes is that the confirm no longer LOOKS trustworthy when it isn't: the
  // server and every future investigation can now separate "proven inside" from
  // "asked, and got an answer we cannot bank on".
  const fixTrusted = coords.accuracy == null || coords.accuracy <= MAX_FIX_ACCURACY_M;

  // ── E5: THE LOCAL PROOF FLOOR IS STAMPED BEFORE ANY NETWORK CALL ──────────
  //
  // This computation and its VISIT_TICK_KEY stamp used to live BELOW the confirm,
  // which meant one dead round-trip destroyed both the server's proof and the
  // device's own record of it — and the device's copy is what recordDwellSession
  // and the wake reconciler bound the banked time by. It depends on nothing the
  // network returns, so there is no reason for it to be downstream of a call that
  // can fail. Same gate, same inputs, same rule as before.
  //
  // ⚠ STRICT TO CREDIT, LOOSE TO CLOSE. `inside` is deliberately generous —
  // radius + hysteresis, and true by default on an unusable fix — so the
  // time-based dwell keeps advancing and a coarse fix can never flap a real
  // session out. That generosity is right for staying open and wrong for paying
  // out. VISIT_TICK_KEY is not a liveness flag: recordDwellSession uses it as the
  // ceiling on how much time gets BANKED, so whatever it certifies is billed.
  //
  // Field 2026-08-09: a wake confirmed presence at distance_m 67 against a 20 m
  // fence (bound 20 + 50 hysteresis) nine minutes after the owner had left, and
  // the completion push then told him "60 min" for a 50.5-minute visit.
  let provenInside = false;
  if (inside) {
    try {
      const { fixCreditsPresence } = await import('@/lib/health/gymPresence');
      provenInside = fixCreditsPresence({
        fixTrusted,
        distanceM: distance,
        radiusM,
        accuracyM: coords.accuracy ?? null,
        fixAgeMs,
      });
    } catch {
      provenInside = false;
    }
    if (provenInside) {
      void AsyncStorage.setItem(VISIT_TICK_KEY, String(Date.now())).catch(() => {});
    }
  }

  // ── C1: RESOLVE THE VISIT *BEFORE* THE CONFIRM, NOT AFTER ────────────────
  //
  // DURABLE ENTRY (2026-08-06 field): the check-in's own openGymVisit is a single
  // best-effort call, and when it freezes — which it did that night at 20:03:38,
  // resyncing auth and never returning — the server never learns the session
  // exists. No visit row means no beacon, no nudges, no server-side timers.
  //
  // ⚠ WHY THIS MOVED (2026-08-17). It used to sit BELOW the confirm and gate on
  // `!active.visitId`, which produced the worst of both: a `fence_refresh` wake on
  // an unstamped session found `visitId` null, SKIPPED the confirm entirely, and
  // only then resolved an id it had nothing left to do with. Field: five `reused`
  // rows in 19 minutes and `last_proven_at` NULL the whole time, on a visit whose
  // sweeps were reporting `visit: null`. Resolving first means the wake's one
  // round-trip is actually spent on the confirm.
  //
  // The gate is `!visitId` — NOT `!active.visitId` — or a nonce wake that already
  // has a perfectly good server id would spend its window re-opening.
  let lateResolved = false;
  if (inside && !visitId) {
    try {
      // Bounded: this is on the wake's critical path now, so a freeze here must
      // cost the open and not the confirm behind it.
      const lateId = await withNetworkTimeout(
        openVisitTraced('wake_late_open', active.partnerId, active.regionId, active.entryTimestamp, active.visitId ?? null),
        'late_open_gym_visit',
      ).catch(() => null);
      if (lateId) {
        const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
        const cur = raw ? JSON.parse(raw) as StoredGeofence : null;
        // Only stamp the session we just opened for — never a later one, and
        // never a session at some OTHER partner.
        //
        // ⚠ This used to demand `cur.entryTimestamp === active.entryTimestamp`,
        // the same strict equality that was relaxed in setActiveAndNotify on
        // 2026-08-08 because it failed on every Android check-in. It was never
        // relaxed HERE, so the id was fetched and thrown away: field 2026-08-10,
        // Android re-resolved the visit on every wake for 90 minutes (`reused`
        // at 09:21, 09:26, 09:32, 09:37, 09:56) and still swept `visit: null`.
        // That is not cosmetic — an unstamped visit is what sends the client
        // back to openGymVisit with a stale entryTimestamp after the server has
        // closed the visit, which is how the duplicate a635617c was minted.
        if (stampVisitOnActive(cur, active, lateId, 'wake_late_open')) {
          await patchActiveGeofence(active, { visitId: lateId }, 'wake_late_open');
          // In-place too, or the stamp does not survive this wake: every branch
          // of advanceActiveSession below rewrites the whole record from THIS
          // object, so a stamp that only landed in storage is erased seconds
          // later by the dwell machine — and the next wake re-resolves all over
          // again. heartbeatVisitStream has always done this; this path did not.
          active.visitId = lateId;
        }
        visitId = lateId;
        lateResolved = true;
        console.log(`[Geofence] Late visit open succeeded on wake — server caught up (${lateId}).`);
      }
    } catch (err) {
      console.warn('[Geofence] Late visit open failed — next wake retries:', err);
    }
  }

  // ⚠ A LATE-RESOLVED VISIT MAY ONLY BE CONFIRMED ON *PROVEN* PRESENCE.
  // An inside-confirm refreshes `last_confirmed_at`, and that is what deselects a
  // visit from the beacon's post-upgrade presence pass — the ONLY proof carrier
  // Android has after the upgrade. Confirming an unproven "inside" on every wake
  // would therefore silence the one thing still advancing last_proven_at, which is
  // precisely the 08-14 shape: 40.0 min recorded for a 50.6-minute visit. A visit
  // id we already held keeps its existing, deliberately generous behaviour.
  if (visitId && (!lateResolved || provenInside)) {
    const { confirmGymVisit, confirmGymVisitViaNonce } = await import('@/lib/gymVisits');
    // requestCredit on an inside confirm: this one round-trip both proves
    // presence AND has the server relay the claim/upgrade (confirm_gym_visit_v2)
    // — the wake window fits ~one round-trip and the local chain below starves.
    // The trace rides along on the round-trip we are already making, so the
    // per-step timings land in gym_visit_events.detail with zero extra network
    // cost — and, crucially, they arrive for iOS too, where there is no logcat.
    const detail = {
      stage,
      distance_m: distance != null ? Math.round(distance) : null,
      accuracy_m: coords.accuracy != null ? Math.round(coords.accuracy) : null,
      fix_trusted: fixTrusted,
      // Top-level, not just inside `trace`, because the SERVER's v_proven mirror
      // reads this shape — and it must apply the same age rule as
      // fixCreditsPresence or the two answers diverge. Null means "unknown", which
      // both sides treat as acceptable rather than inventing a failure.
      fix_age_s: fixAgeMs != null ? Math.round(fixAgeMs / 1000) : null,
      visit_mismatch: visitMismatch,
      trace,
    };
    if (wakeNonce) await confirmGymVisitViaNonce(visitId, wakeNonce, inside, detail, inside, active.entryTimestamp);
    else await confirmGymVisit(visitId, inside, detail, inside, active.entryTimestamp);
  }

  if (inside) {
    console.log(`[Geofence] Visit check (${stage}): still inside — advancing dwell.`);
    // The proof floor (provenInside + VISIT_TICK_KEY) was computed and stamped
    // ABOVE, before the confirm — see E5 there for why it must not be downstream
    // of a network call that can fail.
    //
    // Wake-scoped lease: cron wakes (:01) and stream ticks (:32) are permanently
    // out of phase, so a tick-started zombie attempt is almost always <2 min old
    // when a wake arrives — under the normal lease the wake would skip and waste
    // its window (three consecutive wakes lost this way, field 2026-07-14).
    // Inside a wake window any pre-window attempt is presumed dead; idempotency
    // (23505 + already-claimed + relay pre-checks) absorbs a zombie that lands.
    await advanceActiveSession(active, WAKE_STALE_CLAIM_LOCK_MS);
  } else {
    console.log(`[Geofence] Visit check (${stage}): left the gym — finalizing.`);
    await finalizeActiveGeofence();
  }
}

/** Read-modify-write for every flag mutation of the stored active session.
 *
 *  Both 2026-08-11 field bugs were the same write, aimed two different ways: a
 *  branch captured `{ ...active }` BEFORE an awaited call and persisted that
 *  snapshot afterwards. In the background the snapshot pre-dated the check-in's
 *  visitId stamp, so the first claim writer erased the id and every wake
 *  re-resolved it (`visit: null` sweeps, `reused` each wake — foreground was
 *  fine only because its snapshot happened to be taken after the stamp). After
 *  an exit the snapshot post-dated finalizeActiveGeofence's removeItem, so the
 *  write RESURRECTED the key and the exit backstop kept running against a
 *  visit the server had already closed.
 *
 *  So: merge the patch onto whatever is stored NOW, and refuse outright when
 *  the key is gone (the session was finalized — never bring it back) or when
 *  the stored record belongs to a different region (a new session started —
 *  never bleed one session's flags into another). An entryTimestamp change at
 *  the SAME region is a concurrent check-in path rewriting the same physical
 *  visit (see stampVisitOnActive) and patches normally.
 *
 *  This shrinks the race to the get→set microtask gap instead of an entire
 *  network round-trip; it is not a mutex (see heartbeatVisitStream's throttle
 *  history for why an AsyncStorage lock cannot be one). Returns the merged
 *  record it wrote, or null when it refused or storage failed — callers treat
 *  null as "this session is no longer mine to advance". */
async function patchActiveGeofence(
  expected: StoredGeofence,
  patch: Partial<StoredGeofence>,
  source: string,
): Promise<StoredGeofence | null> {
  let current: StoredGeofence | null = null;
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    current = raw ? JSON.parse(raw) as StoredGeofence : null;
  } catch {
    return null; // unreadable — never guess over a write this load-bearing
  }
  if (!current) {
    logRegionEvent(expected.regionId ?? 'exit', 'active_patch_refused', {
      reason: 'key_gone', source, patch: Object.keys(patch),
    });
    return null;
  }
  if (current.regionId !== expected.regionId) {
    logRegionEvent(expected.regionId ?? 'exit', 'active_patch_refused', {
      reason: 'region_mismatch', source, stored_region: current.regionId ?? null, patch: Object.keys(patch),
    });
    return null;
  }
  const merged: StoredGeofence = { ...current, ...patch };
  try {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(merged));
  } catch {
    return null;
  }
  return merged;
}

/** Immediate (timer-free) dwell state machine driven by the background-location
 *  task while the user is still inside a gym. Mirrors the foreground dwell timer's
 *  branches but acts the moment a GPS batch shows a threshold was crossed — so a
 *  session is recorded and the tier upgraded even when the app is fully closed,
 *  without depending on the EXIT event ever firing. Claims are idempotent (the
 *  in-flight lock, sessionRecorded flag, and DB unique index dedup against the
 *  foreground path). */
async function advanceActiveSession(active: StoredGeofence, staleLockMs?: number): Promise<void> {
  const elapsed = Date.now() - active.entryTimestamp;

  // 1. Prior claim was too short / failed — retry once the prod threshold is met.
  if (active.sessionRecorded && active.pointsPending) {
    if (elapsed < prodDwellMs()) return;
    const started = await patchActiveGeofence(active, { pointsPending: false, claimAttemptAt: Date.now() }, 'dwell_retry_start');
    if (!started) return; // finalized under us — the exit path owns this claim now
    const { outcome, sessionId } = await recordDwellSession(started, staleLockMs);
    if (outcome === 'claimed' && sessionId) {
      await patchActiveGeofence(started, { pointsPending: false, sessionId }, 'dwell_retry_claimed');
    } else {
      await patchActiveGeofence(started, { pointsPending: true }, 'dwell_retry_unresolved');
      // Durably queue (frozen at now) on a hard error so a logout/app-kill before the
      // EXIT event can't lose the claim — flushPendingClaims retries it on re-login.
      if (outcome === 'error') await enqueuePendingClaim({ ...started, endedAtMs: Date.now() });
    }
    return;
  }

  // 2. Claimed at the 30-min tier — upgrade once the 40-min threshold is met.
  if (active.sessionRecorded && active.sessionId && !active.tierUpgraded) {
    if (elapsed < prodUpgradeMs()) return;
    const ok = await upgradeGymTier(active.sessionId, active.partnerName, active.visitId);
    if (ok) await patchActiveGeofence(active, { tierUpgraded: true }, 'dwell_upgrade');
    return;
  }

  if (active.sessionRecorded) {
    // sessionRecorded with no sessionId and no pointsPending means a prior attempt
    // died BETWEEN persisting "attempt started" and writing its outcome (hung
    // request, process kill). Left alone this state is a silent dead-end no tick
    // or beacon wake can leave — the claim only resurfaces at EXIT, and a session
    // that ends between the 30- and 40-min tiers loses its points entirely
    // (field-caught 2026-07-14). After a grace window, hand it back to the
    // pointsPending retry path above; claim-points and the sessions unique index
    // make a duplicate retry a no-op.
    //
    // In a WAKE window both the grace and the retry timing shrink: cron wakes
    // (:01) and stream ticks (:32) are permanently out of phase, so under the
    // normal 2-min grace a wake almost always found a sub-grace zombie from the
    // previous tick and left empty-handed — then the retry it queued ran on the
    // NEXT tick, outside any window (wakes #2–#4 all lost this way, field
    // 2026-07-14 evening). A pre-window attempt is dead by definition; heal it
    // and retry NOW, while the radio is up.
    const resultGraceMs = staleLockMs ?? CLAIM_RESULT_GRACE_MS;
    if (!active.sessionId && !active.pointsPending
        && Date.now() - (active.claimAttemptAt ?? 0) > resultGraceMs) {
      console.warn('[Geofence] Claim attempt left no outcome — queueing retry.');
      const queued = await patchActiveGeofence(active, { pointsPending: true }, 'dwell_heal');
      if (queued && staleLockMs != null) await advanceActiveSession(queued, staleLockMs);
    }
    return;
  }

  // 3. Initial claim once the dwell threshold is met.
  if (elapsed < minDwellMs()) return;
  const started = await patchActiveGeofence(active, { sessionRecorded: true, claimAttemptAt: Date.now() }, 'dwell_claim_start');
  if (!started) return; // finalized under us — the exit path owns this claim now
  const { outcome, sessionId } = await recordDwellSession(started, staleLockMs);
  if (outcome === 'claimed' && sessionId) {
    await patchActiveGeofence(started, { sessionRecorded: true, sessionId }, 'dwell_claimed');
  } else if (outcome === 'too_short' || outcome === 'error' || outcome === 'relayed') {
    // relayed: the server is completing the claim — keep pointsPending so the
    // next tick re-enters recordDwellSession, whose relay answers
    // 'already_claimed' and finalizes. Not a failure, so no durable queue.
    await patchActiveGeofence(started, { sessionRecorded: true, pointsPending: true }, 'dwell_claim_unresolved');
    // Durably queue on a hard error (e.g. logged out) so the claim survives an app
    // kill before EXIT and is flushed on re-login. too_short retries in-gym only.
    if (outcome === 'error') await enqueuePendingClaim({ ...started, endedAtMs: Date.now() });
  }
}

/** Core of the foreground-service location task. Given a GPS fix, drives ENTER,
 *  dwell, and EXIT against the cached partner circles + active-session state. Runs
 *  headless (separate JS context) when the app is closed, so it reads everything
 *  from AsyncStorage and never touches React. */
/** Tells the server the location stream is actually delivering fixes while checked
 *  in. Fires on EVERY tick — coarse ones included — because the question it answers
 *  ("is the background stream alive?") is independent of whether the fix is accurate
 *  enough to prove presence. Presence is confirmGymVisit's job and stays untouched.
 *  Throttled + best-effort: it must never delay or break the dwell machine. */
async function heartbeatVisitStream(active: StoredGeofence, coords: Location.LocationObjectCoords): Promise<void> {
  try {
    // Claim the window SYNCHRONOUSLY, before any await. The old read-modify-write
    // across `await getItem` let every callback in a burst read the same stale
    // value and all pass: 451 of 1,044 stream_tick rows are redundant burst rows,
    // worst cases 109 ticks in 4.04 s (visit 81ff3551) and 67 in 1.30 s. That also
    // broke the promise in this function's own docstring — the heartbeat is
    // awaited ahead of advanceActiveSession, so a burst delayed the dwell machine
    // it swears never to delay.
    const now = Date.now();
    if (now - _lastTickAtMs < VISIT_TICK_INTERVAL_MS) return;
    _lastTickAtMs = now;

    // In-memory alone can't dedupe across JS contexts (the headless location task
    // and the UI both run this), and a fresh context starts at 0 — so the
    // persisted value is still the cross-context floor. It just no longer has to
    // win a race it structurally cannot win.
    const persisted = Number((await AsyncStorage.getItem(VISIT_TICK_THROTTLE_KEY)) ?? 0);
    if (now - persisted < VISIT_TICK_INTERVAL_MS) return;
    await AsyncStorage.setItem(VISIT_TICK_THROTTLE_KEY, String(now));

    // The heartbeat proves the STREAM is alive. Whether it also proves the USER is
    // present is a separate question with a separate answer — and billing the wrong
    // one cost 19 minutes of phantom session time on 2026-08-10, because opening the
    // app anywhere woke the stream and the stamp went in unconditionally.
    //
    // The credit floor moves only on a fix that would pass the same test the wake
    // confirm and the wake reconciler use. Everything below this line still runs:
    // liveness, the late-open retry and the dwell machine are unaffected.
    {
      const { fixCreditsPresence } = await import('@/lib/health/gymPresence');
      const distanceM = (active.latitude != null && active.longitude != null)
        ? haversineMetres(coords.latitude, coords.longitude, active.latitude, active.longitude)
        : null;
      if (fixCreditsPresence({
        fixTrusted: coords.accuracy == null || coords.accuracy <= MAX_FIX_ACCURACY_M,
        distanceM,
        radiusM: active.radius ?? null,
        accuracyM: coords.accuracy ?? null,
      })) {
        await AsyncStorage.setItem(VISIT_TICK_KEY, String(now));
      }
    }

    if (!active.visitId) {
      // Late-open. openGymVisit fires exactly once, at check-in — but check-in can
      // RACE auth (fresh install: the entry fix landed 240 ms into login and the RPC
      // failed P0001 'not authenticated', field-caught 2026-07-14). Without a retry
      // the visit has no beacon for its entire life: no server timers, no wakes.
      // Passing the original entryTimestamp backdates started_at, so the server's
      // dwell/upgrade timers are unaffected by how late the open happens; the RPC
      // re-uses an already-open visit, so a racing double-open is a no-op.
      const visitId = await openVisitTraced(
        'stream_late_open', active.partnerId, active.regionId, active.entryTimestamp, active.visitId ?? null,
      );
      if (!visitId) return; // still unauthenticated/offline — next interval retries
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const current = raw ? JSON.parse(raw) as StoredGeofence : null;
      // Only stamp the visit onto the session it belongs to — never a later one.
      // Same relaxation, and the same reason, as the wake path above: the strict
      // entryTimestamp equality failed on every Android check-in and silently
      // discarded a perfectly good id.
      if (!stampVisitOnActive(current, active, visitId, 'stream_late_open')) return;
      // Merge rather than write `current` back wholesale: `current` was read
      // before this line and the dwell machine writes the same key (2026-08-17).
      await patchActiveGeofence(active, { visitId }, 'stream_late_open');
      active.visitId = visitId; // in-place so this tick's claim path sees it too
      console.log('[Geofence] Visit beacon opened late — check-in had raced auth.');
    }

    const { logGymVisitTick } = await import('@/lib/gymVisits');
    await logGymVisitTick(active.visitId, {
      accuracy_m:  coords.accuracy != null ? Math.round(coords.accuracy) : null,
      elapsed_min: Math.round((Date.now() - active.entryTimestamp) / 60000),
    });
  } catch { /* diagnostic only — never let it affect the claim */ }
}

async function evaluateLocationFix(coords: Location.LocationObjectCoords): Promise<void> {
  // A coarse fix can't be trusted against a tight radius — it must never fire a
  // false "You're in" from far away (ENTER) or flap a real session out early
  // (EXIT). But dwell progression (advanceActiveSession) is purely TIME-based and
  // needs no position at all. Rejecting coarse fixes wholesale starved it for
  // entire in-gym dwells (indoor GPS is routinely >100 m), so the 30-min claim
  // only ran at app-open — 2026-07-03 + 2026-07-11 field sessions. A coarse fix
  // now still ticks an active session; only the geometric decisions demand
  // accuracy.
  //
  // `>=`, not `>`. A fix reporting EXACTLY 100 m used to pass this gate by one
  // unit, and 100.0 is not a measurement — it is the round number a fused/network
  // provider emits when it is really saying "somewhere around here". Every phantom
  // confirm in the 2026-08-07 5½-hour zombie visit carried accuracy_m 100, as did
  // the upgrade confirm on the clean run that same afternoon. The gate exists to
  // reject exactly that class of fix; letting the sentinel value through on a
  // boundary technicality defeated it.
  const isCoarse = coords.accuracy != null && coords.accuracy >= MAX_FIX_ACCURACY_M;

  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  const active: StoredGeofence | null = raw ? JSON.parse(raw) : null;

  if (active && isCoarse) {
    // Position untrusted: skip the EXIT geometry (assume still inside — the same
    // effective outcome as the old early-return) but keep the time-based dwell
    // state machine alive so background claims fire without an app-open.
    //
    // ⚠ This is ALSO why an Android device cannot notice it has left: indoors or
    // out, whenever the fused provider reports >=100 m the exit geometry never
    // runs. Field 2026-08-08: the owner walked 500 m away and the visit stayed
    // open for 25 minutes, because every fix in that window was coarse and the
    // sweep (which returns early on session_active) is no backstop for exits.
    // Kept as-is deliberately — rejecting coarse fixes wholesale is what starved
    // entire in-gym dwells on 07-03/07-11 — but it is no longer SILENT.
    logCoarseRejection('dwell_tick', coords, active);
    await heartbeatVisitStream(active, coords);
    await advanceActiveSession(active);
    return;
  }

  if (isCoarse) {
    // ENTER detection needs a trusted position — but ARM drift is km-scale, so a
    // fix good to ≤1 km can still prove the armed set is centred on the wrong
    // town. 2026-08-04: after a city-level fix mis-centred the arm by 13 km,
    // every indoor fix was >100 m and returned HERE, so nothing could ever
    // correct it. armNativeRegions itself no-ops inside the sentinel envelope.
    logCoarseRejection('enter_blocked', coords, null);
    if (coords.accuracy != null && coords.accuracy <= ARM_FIX_MAX_ACCURACY_M) {
      await armNativeRegions(
        { latitude: coords.latitude, longitude: coords.longitude },
        { via: 'coarse_recentre' },
      );
    }
    return;
  }

  if (active) {
    // Still inside the active circle? If geometry is missing (older active state),
    // assume inside so we never drop a session on incomplete data. EXIT keeps a
    // small hysteresis (not the entry radius) so GPS noise can't flap a real
    // session out early — entry detection itself stays exactly at the radius.
    let stillInside = true;
    if (active.latitude != null && active.longitude != null && active.radius != null) {
      const dist = haversineMetres(coords.latitude, coords.longitude, active.latitude, active.longitude);
      stillInside = dist <= active.radius + LOCATION_EXIT_HYSTERESIS_M;
    }
    if (stillInside) {
      await heartbeatVisitStream(active, coords);
      await advanceActiveSession(active);
      await selfPollIfWakeStarved(active, coords);
    } else {
      // Location-detected EXIT — the native exit event may never arrive when closed.
      await finalizeActiveGeofence();
    }
    return;
  }

  // No active session — look for an ENTER against the cached circles.
  const partnerMap = await readPartnerMap();
  if (!partnerMap) {
    // Previously a SILENT return, and the leading suspect for the one failure
    // this telemetry could not explain: field 2026-08-08, Android's sweeps
    // reported trusted fixes (32 m and 27 m accuracy) placing it 16–17 m from
    // POWR — inside the 25 m radius — and no check-in followed, with no error
    // anywhere. A missing or unreadable partner map looks exactly like "nothing
    // nearby" from the server side, because both produce no rows at all.
    logEnterScan('map_unavailable', coords, null, null, 0);
    return;
  }

  let withinAnyApproach = false;
  let nearestM: number | null = null;
  let nearestId: string | null = null;
  let scanned = 0;
  for (const [regionId, entry] of Object.entries(partnerMap)) {
    if (entry.lat == null || entry.lng == null) continue;
    scanned++;
    const dist = haversineMetres(coords.latitude, coords.longitude, entry.lat, entry.lng);
    if (nearestM == null || dist < nearestM) { nearestM = dist; nearestId = regionId; }
    // Exact partner radius — no accuracy buffer added, so a 25 m circle means 25 m.
    if (dist <= (entry.radius ?? 100)) {
      await setActiveAndNotify(regionId, entry);
      return;
    }
    if (dist <= APPROACH_RADIUS_M) withinAnyApproach = true;
  }

  // Scanned the whole map from inside the approach ring and still did not check
  // in. Usually legitimate — 120 m ring, 25 m fence — but it is also the only
  // shape the above failure could take if the map were merely INCOMPLETE rather
  // than absent, so it must not be silent either. Bounded to the ring so a user
  // walking past a town's worth of gyms does not generate a row per fix.
  if (withinAnyApproach) {
    logEnterScan('no_match_in_ring', coords, nearestM, nearestId, scanned);
  }

  // Outside every approach ring — if the stream is still escalated (the native
  // EXIT that normally de-escalates was missed, which can happen on iOS), drop it
  // back to baseline so a high-accuracy stream can't run indefinitely. exitApproach
  // is a cheap no-op when we weren't escalated.
  if (!withinAnyApproach) await exitApproach();

  // Not near any partner. If this fix has drifted outside the armed sentinel
  // (user travelled with the app closed), re-target the native regions around
  // where they actually are — cache-only, no network. armNativeRegions itself
  // no-ops while the fix is still inside the armed envelope.
  await armNativeRegions(
    { latitude: coords.latitude, longitude: coords.longitude },
    { via: 'drift' },
  );
}

/** Re-registers native geofencing + the location stream from the cached partner
 *  circles. Network-free, so it can run on boot. No-op without background permission. */
async function rearmGeofencingFromCache(): Promise<void> {
  const { status } = await Location.getBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as Location.PermissionStatus }));
  if (status !== 'granted') return;

  // Only (re)arm when monitoring is actually down (fresh boot). While alive,
  // the sentinel/drift logic owns re-targeting.
  if (!(await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false))) {
    // Accuracy-screened: an unqualified last-known here can be any age and any
    // accuracy — the same class of wrong-town centre as the 2026-08-04 arm.
    const fix = await getArmFix();
    await armNativeRegions(fix, { force: true, via: 'boot_restore' });
  }

  if (Platform.OS === 'android') {
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false))) {
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, LOCATION_UPDATE_OPTIONS);
        await recordStreamMode('passive');
      }
    } catch (err) {
      console.warn('[Geofence] Boot re-arm location stream failed:', err);
    }
  }
}

/** Registers the boot re-arm task once. Call at app startup. */
export async function registerGeofenceBootRearm(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_REARM_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(GEOFENCE_REARM_TASK, {
        minimumInterval: 15 * 60,
        stopOnTerminate:  false,
        startOnBoot:      true,
      });
    }
  } catch { /* background fetch unavailable (e.g. simulator) */ }
}

// ─── Background Tasks ─────────────────────────────────────────────────────────
// Defined at module level so they are registered before any monitoring starts.

// Foreground-service location stream (primary closed-app detector on Android).
TaskManager.defineTask(LOCATION_TRACKING_TASK, async ({ data, error }) => {
  // Names the executor on any crash report filed from this wake — a headless
  // stack has no route to place it. Pure assignment, no throw surface.
  noteTask('POWR_LOCATION_TRACKING');
  if (error) {
    console.error('[Geofence] Location task error:', error);
    return;
  }
  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  console.log(`[Geofence] Location task fired: ${locations?.length ?? 0} fix(es).`);
  if (!locations || locations.length === 0) return;
  // Persist the newest fix for the wake path. A silent wake must never block on
  // GPS acquisition (see runVisitCheck), and the stream is already delivering a
  // fix roughly every 60 s throughout a checked-in session — so the presence
  // proof the wake needs is nearly always already in hand. Written before the
  // dwell work below so a throw down there can't cost us the fix.
  try {
    const newest = locations[locations.length - 1];
    await AsyncStorage.setItem(LAST_STREAM_FIX_KEY, JSON.stringify({
      latitude:  newest.coords.latitude,
      longitude: newest.coords.longitude,
      accuracy:  newest.coords.accuracy ?? null,
      at:        newest.timestamp ?? Date.now(),
    }));

    // ⚠ THE ROW THAT CONVICTS A SILENT APPROACH STREAM (2026-08-17).
    //
    // `approach_stream_on` now reports honestly whether the START succeeded, but a
    // started stream that then delivers NOTHING is a different failure and looked
    // identical from the server: 08-12 PM, 08-13 and 08-17 all recorded
    // approach_stream_on followed by zero fixes for 6-8 minutes while the user
    // stood inside the fence. One row on the FIRST fix of an approach settles it
    // forever: present means the stream is alive and the check-in gate is the
    // suspect; absent, with `started: true` beside it, means the stream is the
    // suspect. `approach_age_s` is the number — it is how long the user walked
    // before the driver produced anything at all.
    //
    // One-shot per approach: the flag resets in exitApproach. A burst of fixes
    // must not become a burst of rows (see noteSuppressedExit for what that costs).
    if (!_approachFirstTickEmitted) {
      const rawApproach = await AsyncStorage.getItem(APPROACH_STATE_KEY).catch(() => null);
      if (rawApproach) {
        _approachFirstTickEmitted = true;
        let since: number | null = null;
        let approachRegion: string | null = null;
        try {
          const st = JSON.parse(rawApproach) as { regionId?: string; since?: number };
          since = typeof st.since === 'number' ? st.since : null;
          approachRegion = st.regionId ?? null;
        } catch { /* an unreadable blob still deserves the row */ }
        logRegionEvent(approachRegion ?? 'stream', 'stream_first_tick', {
          acc_m:          newest.coords.accuracy != null ? Math.round(newest.coords.accuracy) : null,
          age_s:          Math.round((Date.now() - (newest.timestamp ?? Date.now())) / 1000),
          approach_age_s: since != null ? Math.round((Date.now() - since) / 1000) : null,
        });
      }
    }
  } catch { /* best-effort — the wake falls back to its other sources */ }
  try {
    // Headless context: load the last-persisted admin dwell threshold from
    // storage before any dwell decision (foreground refreshes it on launch).
    await primeGymDwellMinutes();
    await drainOutboxesBounded('stream_tick');
    await evaluateLocationFix(locations[locations.length - 1].coords);
  } catch (err) {
    console.warn('[Geofence] evaluateLocationFix failed:', err);
  }
});

// Boot re-arm: re-issues monitoring from cached circles after a device restart.
TaskManager.defineTask(GEOFENCE_REARM_TASK, async () => {
  noteTask('POWR_GEOFENCE_BOOT_REARM');
  try {
    await drainOutboxesBounded('boot_rearm');
    await rearmGeofencingFromCache();
    await sweepForMissedCheckIn();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Native event debounce ───────────────────────────────────────────────────
// 2026-08-11 field, BOTH runs: ONE foreground startGeofencingAsync produced a
// ~6 s native initial-trigger storm — 12 ENTERs for the occupied venue and 2–11
// EXITs for every other armed region (~160 rows), delivered in cumulative waves
// as GMS ingested the 50-fence add: region k joins the storm when its add
// lands, and everything already added re-fires — hence the ×12, ×11, ×10…
// descending counts, plus a straggler wave 5.3 s in. JS armed exactly ONCE
// (single `armed` row); the amplification is entirely below us, so it is
// absorbed here instead. The FIRST event per (region, transition) is processed
// and logged normally — iOS check-ins LIVE on that first arm-time burst event,
// so it must never be suppressed — and repeats inside the window are dropped
// BEFORE the handler's first await, so they cannot interleave with the real
// event's run (the stale-snapshot race class this file keeps re-paying for).
// The window SLIDES (a repeat refreshes the stamp) so a storm outliving it
// stays suppressed. Module state deliberately: one storm arrives in one JS
// context, and a synchronous check-and-set cannot race at an await the way an
// AsyncStorage read-modify-write would. Cost of the trade: a REAL re-crossing
// of the same edge within 5 s is dropped — at that rate it's boundary flap,
// and the stream/sweep (check-in) and finalize guards (exit) own the truth.
const NATIVE_EVENT_DEBOUNCE_MS = 5_000;
const _lastNativeEventAt = new Map<string, number>();

function isDuplicateNativeEvent(regionId: string, eventType: Location.GeofencingEventType): boolean {
  const key = `${regionId}:${eventType}`;
  const now = Date.now();
  const last = _lastNativeEventAt.get(key);
  _lastNativeEventAt.set(key, now);
  if (_lastNativeEventAt.size > 256) {
    for (const [k, t] of _lastNativeEventAt) {
      if (now - t > NATIVE_EVENT_DEBOUNCE_MS) _lastNativeEventAt.delete(k);
    }
  }
  return last != null && now - last < NATIVE_EVENT_DEBOUNCE_MS;
}

/** Test-only: the debounce map is module state, so back-to-back simulated
 *  crossings in one jest module instance read as a storm without this. */
export function resetNativeEventDebounceForTests(): void {
  _lastNativeEventAt.clear();
}

// ─── Exit-noise suppression (2026-08-13) ─────────────────────────────────────
// MEASURED IN PROD TODAY: geofence_region_events held 26,689 rows, of which
// 21,895 — 82% of the entire table — were `exit` rows carrying no information.
//
// They come from the same place as the storm above, one layer further out.
// Arming registers ~50 regions at once, and Google Play Services reports INITIAL
// STATE for every one of them: the user is not inside 49 of the 50, so GMS
// dutifully delivers 49 EXITs within ~10 s of every single arm, for venues the
// user has never been near. The debounce absorbs the *repeats* of each of those
// (the ×12/×11/×10 waves); it deliberately lets the FIRST of each pair through,
// because iOS check-ins live on that first arm-time event. So one clean arm
// still writes ~49 exit rows that describe nothing but the act of arming.
//
// EVERY consumer already throws them away at read time, which is the proof that
// nobody wants them stored:
//   • scripts/e2e-watch.sh surfaces an exit only for a region it has already
//     seen an ENTER for, and counts the rest into "N bg exits suppressed".
//   • shared/liveops.ts collapseTimeline has an explicit arm-burst rule plus an
//     unpaired-exit noise flag (see its rules 1 and 2).
// We were paying to write, store, purge and repeatedly re-filter rows that no
// reader has ever wanted. So stop writing them.
//
// ⚠ WHAT WE MUST NOT LOSE. "The OS never delivered an exit" and "we suppressed
// the exit" are different diagnoses, and confusing them has cost this project
// weeks (it is the same trap documented on the ENTER branch: a missing row made
// a dead wake path and a working-but-unacted-on one look identical for 17 days).
// So a suppressed exit is still COUNTED, and the tally ships as one
// `exit_noise_suppressed` row per burst instead of N `exit` rows. Aggregate
// evidence, zero per-region noise.
//
// SAFE BECAUSE IT IS PURELY A LOGGING DECISION: exitApproach, nativeExitRefuted
// and finalizeActiveGeofence run below on exactly the conditions they ran on
// before. Nothing about departure detection reads this table.

/** How long a tally may accumulate before the next suppressed exit ships it.
 *  Longer than the ~10 s an initial-state burst takes to land, so a whole burst
 *  aggregates into one row rather than dribbling out mid-storm. */
const EXIT_NOISE_FLUSH_MS = 60_000;

function emitExitNoiseRow(count: number, sinceMs: number, nowMs: number): void {
  logRegionEvent('arm', 'exit_noise_suppressed', {
    count,
    window_s: Math.max(0, Math.round((nowMs - sinceMs) / 1000)),
  });
}

/** Ships any pending tally now. Called on every arm ATTEMPT (before the new
 *  registration fires its own storm), which is what guarantees a burst's row
 *  lands even if the device then goes quiet for hours: bursts are arm-caused, so
 *  an arm is the one event certain to follow one. */
async function flushSuppressedExitNoise(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(EXIT_NOISE_KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(EXIT_NOISE_KEY).catch(() => {});
    const tally = JSON.parse(raw) as { count?: number; since?: number };
    if (!tally?.count) return;
    emitExitNoiseRow(tally.count, tally.since ?? Date.now(), Date.now());
  } catch { /* a tally must never be able to break an arm */ }
}

// ⚠ SERIALISED, BECAUSE IT NEVER ACTUALLY WAS (2026-08-17).
//
// noteSuppressedExit read-modify-writes EXIT_NOISE_KEY across an await, and its
// docstring justified that with "the events are serialised through one task
// executor". They are not: the EXIT branch calls it as
// `void noteSuppressedExit(regionId)`, so an arm burst runs N copies
// concurrently. All N awaited `getItem`, all N read the SAME aged-out tally, and
// all N shipped it — field 2026-08-17: **17 identical rows** carrying
// `{count: 4, window_s: 1243}` written in 3 seconds, while the 17 increments those
// calls should have banked were lost, each overwriting the last with `count: 1`.
// The aggregation built to replace per-region exit noise was itself generating a
// storm, on the one table a future server-side exit accelerator would have to
// treat as truth.
//
// The fix is a promise chain, not an in-memory tally. Appending to the chain
// happens SYNCHRONOUSLY — before any await — so N concurrent callers queue behind
// each other and each one's read sees the previous one's write. Storage stays the
// single source of truth, which matters: flushSuppressedExitNoise ships the tally
// and REMOVES the key, and an in-memory counter would sail past that and re-count
// events already shipped.
let _exitNoiseChain: Promise<void> = Promise.resolve();

/** One `stream_first_tick` row per approach — see the stream task for why, and
 *  exitApproach for where it re-arms. */
let _approachFirstTickEmitted = false;

/** openGymVisit, wrapped in an attempt/result row PAIR.
 *
 *  ⚠ TWO ROWS, NOT ONE, AND THE FIRST ONE GOES BEFORE THE AWAIT (2026-08-17).
 *
 *  Every field question we could not answer about this call needed a fact that is
 *  only knowable AFTER the await that is itself the suspect — did it resolve, what
 *  did it return, how long did it take. A single row emitted afterwards therefore
 *  cannot exist for the one case that matters. An attempt row with **no result row
 *  beside it** is the artefact that convicts a hang, and it is the same reasoning
 *  the sweep's own telemetry already follows: the row goes before the handoff,
 *  never in a `finally` (a suspended frame never reaches its finally).
 *
 *  It also finally names the PRODUCER. On 08-17 one visit was re-opened nine times
 *  — five of them inside 19 minutes on a 3-minute cadence that no nudge schedule
 *  explains — and with four call sites all logging nothing, at least two of those
 *  rows had no identified source at all. `source` ends that.
 *
 *  Never throws: telemetry must not be able to break a check-in. */
async function openVisitTraced(
  source: 'check_in' | 'sweep_proven_stamp' | 'wake_late_open' | 'stream_late_open' | 'close_recovery',
  partnerId: string,
  regionId: string | undefined,
  entryTimestamp: number,
  storedVisit: string | null,
): Promise<string | null> {
  const rid = regionId ?? 'visit';
  logRegionEvent(rid, 'visit_open_attempt', {
    source,
    stored_visit:  storedVisit,
    opened_entry:  entryTimestamp,
    app_state:     AppState.currentState,
  });
  const startedAt = Date.now();
  try {
    const { openGymVisit } = await import('@/lib/gymVisits');
    const id = await openGymVisit(partnerId, regionId, entryTimestamp);
    logRegionEvent(rid, 'visit_open_result', {
      source,
      resolved: !!id,
      visit:    id,
      ms:       Date.now() - startedAt,
    });
    return id;
  } catch (err) {
    logRegionEvent(rid, 'visit_open_result', {
      source,
      resolved: false,
      ms:       Date.now() - startedAt,
      err:      String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}

/** Records one exit we chose not to write a row for, and ships the accumulated
 *  tally once it is older than EXIT_NOISE_FLUSH_MS. Concurrency-safe: see the
 *  chain above. A lost increment costs a number in a telemetry row, never a
 *  decision — but a DUPLICATED row costs the readability the tally exists for. */
async function noteSuppressedExit(regionId: string): Promise<void> {
  const run = _exitNoiseChain.then(() => noteSuppressedExitInner(regionId));
  // Assigned before this function's first await, so the next caller — even one
  // that arrives in the same tick — chains onto THIS run rather than racing it.
  _exitNoiseChain = run.catch(() => {});
  return run;
}

async function noteSuppressedExitInner(regionId: string): Promise<void> {
  const now = Date.now();
  let count = 0;
  let since = now;
  try {
    const raw = await AsyncStorage.getItem(EXIT_NOISE_KEY);
    const tally = raw ? JSON.parse(raw) as { count?: number; since?: number } : null;
    if (tally?.count && tally.count > 0) {
      count = tally.count;
      since = typeof tally.since === 'number' ? tally.since : now;
    }
  } catch { /* an unreadable tally simply starts a new one */ }

  if (count > 0 && now - since >= EXIT_NOISE_FLUSH_MS) {
    // The pending batch has aged out — ship it and start a fresh one with this
    // event, so a row's window_s always describes the burst it counts.
    emitExitNoiseRow(count, since, now);
    count = 0;
    since = now;
  }
  count += 1;

  await AsyncStorage.setItem(EXIT_NOISE_KEY, JSON.stringify({ count, since })).catch(() => {});
  console.log(`[Geofence] Exit for "${regionId}" is arm-burst noise — not logged (tally ${count}).`);
}

/** WAKE-STARVATION WATCHDOG (2026-08-12) — the self-poll that makes an open
 *  visit survive a dead push channel.
 *
 *  The server holds every timer and can only ASK the device via silent pushes.
 *  On 2026-08-12 that channel was severed for 100+ minutes while a visit was
 *  open — dead task binding after a permission grant, then a VPN-strangled FCM
 *  socket, then an UNREGISTERED token after a reinstall: three different
 *  transports, one symptom, and the app sat inside a gym with a claimable visit
 *  doing nothing, because every claim path waits to be woken. Meanwhile the
 *  Android location stream delivered a fix every ~60 s the entire time — the
 *  one executor the repo can actually rely on without a push
 *  (expo-background-fetch "has never delivered a single row", per
 *  lib/backgroundNotificationTask.ts).
 *
 *  So the dwell tick carries the fallback: if a visit is open, the dwell
 *  threshold has passed, and NO server wake has been processed for
 *  WAKE_STARVATION_MS, spend the tick's own fix on the same single round-trip
 *  a wake would have made — confirm_gym_visit_v2 with request_credit, which
 *  both stamps proven presence and lets the server relay the claim/upgrade.
 *  Strictly gated on fixCreditsPresence (live fix, age 0): a starved device
 *  with weak evidence keeps waiting — the watchdog exists to beat channel
 *  death, not to weaken the credit bar. iOS runs no baseline stream, so this
 *  is Android-first by design; iOS's APNs direct path answered force-quit all
 *  through the same field day.
 *
 *  Self-throttled to one poll per 10 min, module state — worst case after a
 *  context death is one extra poll, and the confirm is idempotent server-side. */
async function selfPollIfWakeStarved(active: StoredGeofence, coords: Location.LocationObjectCoords): Promise<void> {
  try {
    if (!active.visitId) return;
    const elapsed = Date.now() - active.entryTimestamp;
    if (elapsed < minDwellMs()) return; // nothing creditable yet
    if (Date.now() - _lastSelfPollAt < 10 * 60_000) return;

    const rawLast = await AsyncStorage.getItem(LAST_WAKE_AT_KEY).catch(() => null);
    // 0 = no wake EVER processed on this install — with an open, dwell-satisfied
    // visit that is the starved case exactly (a fresh install's first visit on a
    // wake path that never worked), not an exemption from it.
    const lastWakeAt = Number(rawLast ?? 0) || 0;
    if (Date.now() - lastWakeAt < WAKE_STARVATION_MS) return;

    const acc = coords.accuracy ?? null;
    const fixTrusted = acc == null || acc <= MAX_FIX_ACCURACY_M;
    let distance: number | null = null;
    let radiusM: number | null = null;
    if (active.latitude != null && active.longitude != null && active.radius != null) {
      distance = haversineMetres(coords.latitude, coords.longitude, active.latitude, active.longitude);
      radiusM = active.radius;
    }
    const { fixCreditsPresence } = await import('@/lib/health/gymPresence');
    if (!fixCreditsPresence({ fixTrusted, distanceM: distance, radiusM, accuracyM: acc, fixAgeMs: 0 })) return;

    _lastSelfPollAt = Date.now();
    logRegionEvent(active.regionId ?? 'watchdog', 'sweep', {
      outcome:     'wake_starved_self_poll',
      starved_min: lastWakeAt > 0 ? Math.round((Date.now() - lastWakeAt) / 60_000) : null,
      elapsed_min: Math.round(elapsed / 60_000),
      distance_m:  distance != null ? Math.round(distance) : null,
      acc_m:       acc != null ? Math.round(acc) : null,
    });

    const { confirmGymVisit } = await import('@/lib/gymVisits');
    await confirmGymVisit(active.visitId, true, {
      stage:       elapsed >= prodUpgradeMs() ? 'upgrade' : 'dwell',
      source:      'wake_starved_self_poll',
      distance_m:  distance != null ? Math.round(distance) : null,
      accuracy_m:  acc != null ? Math.round(acc) : null,
      fix_trusted: fixTrusted,
      fix_age_ms:  0,
    }, true, active.entryTimestamp);
  } catch { /* the watchdog must never cost the tick */ }
}

/** Can a fresh fix refute this native EXIT? (2026-08-12)
 *
 *  An OS region exit carries no accuracy and no appeal: iOS fired one off a
 *  wandering 2243 m cell pin 12 minutes into a live visit, the handler
 *  finalized on its word alone, and a sweep EIGHT SECONDS later measured 4 m
 *  from centre at 11 m accuracy — the dwell clock reset, the claim slid 12
 *  minutes, and the re-minted visit under-recorded the session. The enter path
 *  refuses fixes that coarse; the exit path executed one without a fix at all.
 *
 *  So: while the visit still has something to earn (pre-upgrade-threshold), a
 *  native EXIT must survive one bounded verification — a fix ≤90 s old (cache
 *  or one Balanced acquisition, same budget as the sweep backstop) that is
 *  TRUSTED (<= MAX_FIX_ACCURACY_M) and places us back INSIDE refutes it.
 *
 *  Deliberate asymmetries, each load-bearing:
 *  • No fix / stale fix / coarse fix → the OS is honored. Verification can
 *    only SAVE a visit on strong contrary evidence, never veto a real
 *    departure on weak evidence — a phone in a bag on a walk-out often can't
 *    produce a trusted fix, and blocking that exit would resurrect the 08-08
 *    "nothing periodically checks you've LEFT" class.
 *  • Past the upgrade threshold the OS is honored unverified — nothing is
 *    left to earn, a native-exit close bills the exit moment (generous), and
 *    the 08-11 PM runs proved that path end-to-end. Refuting there could only
 *    trade a good close for a later, meaner reaper truncation.
 *  • A refuted exit closes NOTHING and re-arms nothing: the dwell stream's
 *    geometry, the sweep backstop and the reaper all still own the real exit. */
export async function nativeExitRefuted(regionId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (!raw) return false;
    const active = JSON.parse(raw) as StoredGeofence;
    if (active.regionId && active.regionId !== regionId) return false; // finalize ignores it anyway
    if (active.latitude == null || active.longitude == null || active.radius == null) return false;
    if (Date.now() - active.entryTimestamp >= prodUpgradeMs()) return false;

    let fix = await Location.getLastKnownPositionAsync({ maxAge: EXIT_BACKSTOP_FIX_MAX_AGE_MS }).catch(() => null);
    if (!fix) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), EXIT_BACKSTOP_ACQUIRE_TIMEOUT_MS); }),
      ]);
      clearTimeout(timer);
    }
    if (!fix) return false;
    const ageMs = typeof fix.timestamp === 'number' ? Date.now() - fix.timestamp : null;
    if (ageMs != null && ageMs > EXIT_BACKSTOP_FIX_MAX_AGE_MS) return false; // the 08-11 stale-"acquired" lesson
    const acc = fix.coords.accuracy;
    if (acc != null && acc >= MAX_FIX_ACCURACY_M) return false;
    const dist = haversineMetres(fix.coords.latitude, fix.coords.longitude, active.latitude, active.longitude);
    if (dist > active.radius + LOCATION_EXIT_HYSTERESIS_M) return false;

    logRegionEvent(regionId, 'exit_refuted', {
      distance_m: Math.round(dist),
      acc_m: acc != null ? Math.round(acc) : null,
      fix_age_s: ageMs != null ? Math.round(ageMs / 1000) : null,
      elapsed_min: Math.round((Date.now() - active.entryTimestamp) / 60_000),
    });
    return true;
  } catch {
    return false; // verification must never block a real exit
  }
}

// Native geofence (fast, low-power ENTER/EXIT trigger when the OS delivers it).
// The whole body is guarded: this executor runs headlessly at every relaunch a
// region crossing causes, and its siblings both already catch. A malformed or
// null event (iOS delivers these on Circle-remount flake and cold relaunches)
// must drop THIS event, never abort the executor with an unhandled rejection
// (2026-08-05 crash-hunt findings #3/#5).
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  noteTask('GEOFENCE_CHECK_IN');
  try {
    if (error) {
      console.error('[Geofence] Task error:', error);
      return;
    }

    const { eventType, region } = (data ?? {}) as {
      eventType?: Location.GeofencingEventType;
      region?: Location.LocationRegion;
    };
    if (eventType == null || !region) {
      console.warn('[Geofence] Task fired without a usable event — ignoring.');
      return;
    }

    const regionId = region.identifier ?? '';

    // Storm absorber — MUST stay before the first await (see docstring above).
    if (isDuplicateNativeEvent(regionId, eventType)) {
      console.log(`[Geofence] Duplicate native event suppressed (${regionId}:${eventType}).`);
      return;
    }

    // Headless context: load the last-persisted admin dwell threshold from storage
    // so exit-time dwell checks use the current value. (After the debounce: a
    // 24-event storm needs one flush pass, not 24 interleaved ones.)
    await primeGymDwellMinutes();
    // Bounded, or a stuck outbox entry swallows the region crossing behind it —
    // and a swallowed EXIT is the most expensive event in the system.
    await drainOutboxesBounded('region_event');

  // Sentinel crossings re-target coverage; they are never partner check-ins.
  // Guard BEFORE any session state is touched — a sentinel EXIT can coincide
  // with an active gym session and must not clear or claim it.
  if (regionId === SENTINEL_REGION_ID) {
    if (eventType === Location.GeofencingEventType.Exit) {
      // The user left the armed envelope (iOS relaunches a terminated app for
      // exactly this). Re-arm around wherever they are now. Log FIRST: this
      // branch failing silently is how the 2026-08-04 phantom-centred arm
      // survived a 13 km drive — "the OS never fired the exit" and "the exit
      // fired and re-arming died" were the same silence. The fix acquisition is
      // accuracy-screened and bounded (getArmFix): the old path here fell back
      // to an UNBOUNDED city-level read — both halves of that killed us.
      logRegionEvent(SENTINEL_REGION_ID, 'sentinel_exit');
      const fix = await getArmFix();
      if (fix) {
        await armNativeRegions(fix, { via: 'sentinel_exit' });
      } else {
        // No trusted position → DON'T re-arm around a guess. The current set
        // stays live and the next qualifying fix re-arms via the drift path.
        logRegionEvent(SENTINEL_REGION_ID, 'rearm_skipped', { reason: 'no_trusted_fix' });
      }
    }
    return;
  }

  if (eventType === Location.GeofencingEventType.Enter) {
    // Log BEFORE the active-session guard and before any stream work: this row is
    // the only proof the OS delivered the ENTER at all. Without it, "no region
    // event" and "region event we then failed to act on" are the same silence —
    // the trap that hid the dead iOS wake path for 17 days (see
    // logGeofenceRegionEvent / log_gym_wake_received).
    const alreadyActive = (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) != null;
    logRegionEvent(regionId, 'enter', { already_active: alreadyActive });

    // Don't overwrite an already-active session.
    if (alreadyActive) {
      console.log('[Geofence] Enter ignored — session already active.');
      return;
    }

    // The native region fires at the WIDER approach radius, so ENTER only means
    // "near". Escalate to the high-accuracy stream and let evaluateLocationFix —
    // the sole authority that starts a session + fires "You're in" — check the
    // user in at the exact 25 m crossing (and dedup the once-per-day guard). A
    // "You're in" therefore never fires from 120 m away. We deliberately do NOT
    // block on a GPS fix here: iOS's region-wake window is tight, and starting
    // the stream promptly matters more than confirming an (uncommon) already-inside.
    await enterApproach(regionId);

    // ...then find the crossing ourselves rather than trusting the stream to
    // deliver it. The stream is exactly what fails in the background (see
    // pollForCheckIn), and waiting on it is why neither platform re-checked in
    // on 2026-08-03. Awaited so the OS keeps this task alive for the walk-in;
    // it exits early the moment a session starts.
    await pollForCheckIn(regionId);

  } else if (eventType === Location.GeofencingEventType.Exit) {
    // Log only a MEANINGFUL exit — see the exit-noise suppression block above for
    // the 82% / 21,895-row measurement that motivates this. Meaningful means the
    // exit could plausibly be about a place the user actually was:
    //   1. an active session for THIS region — the departure that ends a visit, or
    //   2. this region is the one in approach state — the walk-up that turned
    //      around. (Shape matched to enterApproach's { regionId, since }; a stored
    //      approach with no regionId counts, exactly as exitApproach treats it.)
    // Everything else is Play Services reporting initial state for a fence the
    // user has never been inside.
    //
    // Both reads happen HERE, before exitApproach clears APPROACH_STATE_KEY and
    // finalizeActiveGeofence clears ACTIVE_GEOFENCE_KEY — after those, every exit
    // would look like noise. They are also safely after the storm absorber's
    // synchronous check-and-set (which must stay before the first await).
    let meaningful = false;
    try {
      const activeRaw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const active = activeRaw ? JSON.parse(activeRaw) as { regionId?: string } : null;
      meaningful = active?.regionId === regionId;
      if (!meaningful) {
        const approachRaw = await AsyncStorage.getItem(APPROACH_STATE_KEY);
        const approach = approachRaw ? JSON.parse(approachRaw) as { regionId?: string } : null;
        meaningful = approach != null && (approach.regionId == null || approach.regionId === regionId);
      }
    } catch {
      // Unreadable state is not evidence of noise. Log it — a row we cannot
      // justify is far cheaper than a departure we cannot see.
      meaningful = true;
    }
    if (meaningful) logRegionEvent(regionId, 'exit');
    else void noteSuppressedExit(regionId);

    // ⚠ PROCESSING IS UNCHANGED BELOW THIS LINE. The suppression above decides
    // what we WRITE, never what we DO: exitApproach, nativeExitRefuted and
    // finalizeActiveGeofence run on exactly the conditions they always have.
    // Left the approach ring — return the stream to baseline whether or not a
    // session was active (also covers "walked up but never checked in"). A
    // neighboring approach-ring exit must not stop tracking an active gym.
    await exitApproach(regionId);
    if (await nativeExitRefuted(regionId)) {
      // Spurious OS exit — the visit stays open. The dwell stream's geometry,
      // the sweep backstop and the reaper still own the real departure.
    } else {
      await finalizeActiveGeofence(regionId);
    }
  }
  } catch (err) {
    // One bad event must cost one event, not the executor.
    console.error('[Geofence] Task handler failed:', err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Row formatter ────────────────────────────────────────────────────────────

function formatPartnerRows(data: any[]): Partner[] {
  const formatted: Partner[] = [];
  data.forEach((p: any) => {
    if (!p.locations) return;
    const locs = Array.isArray(p.locations) ? p.locations : [p.locations];
    locs.forEach((loc: any, idx: number) => {
      if (loc.lat == null || loc.lng == null || !isFinite(loc.lat) || !isFinite(loc.lng)) return;
      const words = p.name.split(' ');
      const logoText = words.length > 1
        ? `${words[0]}\n${words[1]}`.toUpperCase()
        : p.name.toUpperCase();
      const oh: OpeningHours | undefined = p.opening_hours ?? undefined;
      const openNow = checkIsOpenNow(oh);
      formatted.push({
        id:             `${p.id}-${idx}`,
        dbId:           p.id,
        name:           p.name,
        description:    p.description ?? undefined,
        category:       p.category.charAt(0).toUpperCase() + p.category.slice(1),
        status:         openNow ? 'Open now' : 'Closed',
        address:        p.address?.trim() || '',
        area:           (loc.address?.trim() || loc.name?.trim()) || 'Local',
        pts:            p.category.toLowerCase() === 'gym' ? 15 : 10,
        distance:       '',
        logoText:       logoText.length > 10 ? logoText.substring(0, 10) : logoText,
        logoUrl:        p.logo_url,
        logoBg:         (p.logo_bg as 'dark' | 'black' | 'white') ?? 'dark',
        logoLight:      p.category.toLowerCase() !== 'gym',
        image1Url:      p.image1_url ?? undefined,
        image2Url:      p.image2_url ?? undefined,
        lat:            loc.lat,
        lng:            loc.lng,
        geofenceRadius: DEV_RADIUS_M[p.name] ?? loc.radius ?? 100,
        openingHours:   oh,
        isOpenNow:      openNow,
      });
    });
  });
  return formatted;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface GeofenceContextValue {
  partners: Partner[];
  isMonitoring: boolean;
  loading: boolean;
  refresh: (coords?: { latitude: number; longitude: number }) => Promise<void>;
  /** Re-fetches the nearby set when a fresh fix lands far from the last fetch
   *  centre — e.g. Discover obtained GPS after the user travelled. */
  ensureCoverage: (coords: { latitude: number; longitude: number }) => Promise<void>;
}

const GeofenceContext = createContext<GeofenceContextValue>({
  partners: [],
  isMonitoring: false,
  loading: true,
  refresh: async () => {},
  ensureCoverage: async () => {},
});

export function GeofenceProvider({ children }: { children: React.ReactNode }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const fingerprintRef = useRef('');
  const dwellTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInsideCheckRef = useRef<number>(0);
  const lastFlushRef       = useRef<number>(0);

  const lastFetchCenterRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const refresh = useCallback(async (coords?: { latitude: number; longitude: number }) => {
    setLoading(true);
    try {
      // Resolve the freshest centre available: caller-supplied fix → recent
      // last-known (free) → quick low-accuracy fix → any last-known. A stale
      // centre here is exactly what made a traveller's Discover keep showing
      // their old city until the next blind refresh.
      let center = coords ?? null;
      if (!center) {
        const recent = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
        if (recent) center = { latitude: recent.coords.latitude, longitude: recent.coords.longitude };
      }
      if (!center) {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null);
        if (current) center = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      }
      if (!center) {
        const any = await Location.getLastKnownPositionAsync().catch(() => null);
        if (any) center = { latitude: any.coords.latitude, longitude: any.coords.longitude };
      }

      let data: any[] | null = null;

      if (center) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('nearby_partners', {
          user_lat:   center.latitude,
          user_lng:   center.longitude,
          radius_deg: 0.15, // ~15 km bounding box
        });
        if (!rpcError) data = rpcData;

        // Sparse area: the box came back empty — fall back to the nearest N
        // regardless of distance so Discover never shows an empty screen.
        if (!rpcError && (data?.length ?? 0) === 0) {
          const { data: nearestData, error: nearestError } = await supabase.rpc('nearest_partners', {
            user_lat:    center.latitude,
            user_lng:    center.longitude,
            max_results: 20,
          });
          if (!nearestError && nearestData?.length) data = nearestData;
        }
      }

      // Fallback: fetch all if no location or RPC failed
      if (!data) {
        const { data: allData, error } = await supabase
          .from('partners')
          .select('id, name, description, category, address, locations, logo_url, logo_bg, image1_url, image2_url, opening_hours')
          .eq('active', true);
        if (error || !allData) return;
        data = allData;
      }

      if (!data) return;

      if (center) lastFetchCenterRef.current = center;
      setPartners(formatPartnerRows(data));

      // Opportunistic freshness: keep the nationwide geometry cache (the
      // headless detectors' world view) no older than the TTL — and rewrite it
      // once if it predates the paginated fetch (v1 = truncated to 1000 rows).
      // Fire-and-forget — never blocks the UI list.
      try {
        if (await partnerMapIsStale()) {
          fetchAndCacheAllPartnerGeometry().catch(() => {});
        }
      } catch { /* non-fatal */ }
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureCoverage = useCallback(async (coords: { latitude: number; longitude: number }) => {
    const c = lastFetchCenterRef.current;
    if (c && haversineMetres(c.latitude, c.longitude, coords.latitude, coords.longitude) < 5_000) return;
    await refresh(coords);
  }, [refresh]);

  // Foreground dwell timer — awards points immediately at the threshold without requiring an exit event.
  // Polls every 10 s to catch geofence entries that happen while the app is already open.
  // The background task exit handler is the fallback when the app is backgrounded/killed.
  const scheduleDwellTimer = useCallback(async () => {
    // Retry any claims that failed after the user exited a gym (e.g. lost
    // connectivity on the way out). Fire-and-forget, rate-limited to once per
    // 60 s so it never blocks the dwell logic or hammers the network.
    const nowFlush = Date.now();
    if (nowFlush - lastFlushRef.current >= 60_000) {
      lastFlushRef.current = nowFlush;
      flushPendingClaims().catch(() => { /* non-fatal */ });
      flushPendingVisitCloses().catch(() => { /* non-fatal */ });
    }

    if (dwellTimerRef.current != null) return; // timer already running

    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (!raw) {
      // Native geofence ENTER event can be delayed 30–60 s on iOS/Android.
      // Periodically check if we are already inside using the last-known GPS
      // position (free — no GPS wake-up). Rate-limited to once per 30 s.
      // Scans the nationwide geometry cache (not the nearby UI list) so it
      // works immediately even when the user has just travelled somewhere new.
      const now = Date.now();
      if (now - lastInsideCheckRef.current >= 30_000) {
        lastInsideCheckRef.current = now;
        try {
          // Cheap checks first: last-known position (cached — no GPS wake-up) and
          // an in-memory proximity scan. setActiveAndNotify only touches the
          // network/DB once we're actually inside a partner radius, so there's no
          // Supabase query every 30 s for the common case of not being at a gym.
          const loc = await Location.getLastKnownPositionAsync().catch(() => null);
          // Ignore coarse fixes — a low-accuracy position can't be trusted against a
          // tight radius and would otherwise match a gym from far away.
          if (loc && (loc.coords.accuracy == null || loc.coords.accuracy <= MAX_FIX_ACCURACY_M)) {
            const map = await readPartnerMap();
            if (map) {
              for (const [regionId, entry] of Object.entries(map)) {
                if (entry.lat == null || entry.lng == null) continue;
                // Exact partner radius — no accuracy buffer added.
                if (haversineMetres(loc.coords.latitude, loc.coords.longitude, entry.lat, entry.lng) <= (entry.radius ?? 100)) {
                  // No-ops if a session is already active or a gym was already
                  // logged today; dedups against the native ENTER notification.
                  await setActiveAndNotify(regionId, entry);
                  break;
                }
              }
            }
          }
        } catch { /* non-fatal */ }
      }
      return;
    }

    const activeGeofence: StoredGeofence = JSON.parse(raw);

    // Skip only if the completion belongs to THIS session (timestamp after entry)
    // AND we don't still need to schedule the tier upgrade.
    // A stale key from a previous visit (timestamp before current entry) should not
    // block the foreground timer for new sessions.
    const completedRaw = await AsyncStorage.getItem(SESSION_COMPLETED_KEY);
    if (completedRaw) {
      const completed: { timestamp: number } = JSON.parse(completedRaw);
      const needsTierUpgrade = activeGeofence.sessionRecorded
        && !activeGeofence.pointsPending
        && !!activeGeofence.sessionId
        && !activeGeofence.tierUpgraded;
      if (completed.timestamp >= activeGeofence.entryTimestamp && !needsTierUpgrade) return;
    }

    // If the previous claim attempt failed (session too short at the time), retry as soon
    // as the production eligibility threshold is met — don't wait for exit.
    if (activeGeofence.sessionRecorded && activeGeofence.pointsPending) {
      const elapsed    = Date.now() - activeGeofence.entryTimestamp;
      const remaining  = prodDwellMs() - elapsed;
      if (remaining <= 0) {
        console.log('[Geofence] Foreground: retrying pending claim now (production threshold met).');
        const started = await patchActiveGeofence(activeGeofence, { pointsPending: false, claimAttemptAt: Date.now() }, 'fg_retry_start');
        if (!started) return; // finalized under us — the exit path owns this claim now
        const { outcome, sessionId: retriedId } = await recordDwellSession(started);
        if (outcome === 'claimed' && retriedId) {
          // claim-points already fired the session_completed push.
          await patchActiveGeofence(started, { pointsPending: false, sessionId: retriedId }, 'fg_retry_claimed');
        } else {
          // Still failing — restore flag and keep retrying via the poll interval
          await patchActiveGeofence(started, { pointsPending: true }, 'fg_retry_unresolved');
          console.log('[Geofence] Retry claim failed — will try again.');
        }
      } else {
        console.log(`[Geofence] Foreground: scheduling pending-claim retry in ${Math.round(remaining / 1000)}s`);
        dwellTimerRef.current = setTimeout(async () => {
          dwellTimerRef.current = null;
          const raw2 = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
          if (!raw2) return;
          const gf: StoredGeofence = JSON.parse(raw2);
          if (!gf.pointsPending) return;
          console.log('[Geofence] Foreground: pending-claim retry timer fired.');
          const started = await patchActiveGeofence(gf, { pointsPending: false, claimAttemptAt: Date.now() }, 'fg_retry_timer_start');
          if (!started) return; // finalized under us — the exit path owns this claim now
          const { outcome, sessionId: retriedId } = await recordDwellSession(started);
          if (outcome === 'claimed' && retriedId) {
            // claim-points already fired the session_completed push.
            await patchActiveGeofence(started, { pointsPending: false, sessionId: retriedId }, 'fg_retry_timer_claimed');
          } else {
            await patchActiveGeofence(started, { pointsPending: true }, 'fg_retry_timer_unresolved');
            console.log('[Geofence] Retry claim failed — poll will try again.');
          }
        }, remaining);
      }
      return;
    }

    // Tier upgrade path: session already claimed at 30-min tier, schedule/trigger 40-min upgrade
    if (activeGeofence.sessionRecorded && !activeGeofence.pointsPending && activeGeofence.sessionId && !activeGeofence.tierUpgraded) {
      const elapsed   = Date.now() - activeGeofence.entryTimestamp;
      const remaining = upgradeMs() - elapsed;
      if (remaining <= 0) {
        // Backoff between attempts: a rejected upgrade (e.g. the server's
        // threshold is ahead of the client's — config drift, field 2026-07-14)
        // stays rejected until time passes, and this branch re-runs on the 10 s
        // scheduleDwellTimer poll — without the backoff it hammered
        // upgrade-gym-tier 6×/min for 9 minutes straight.
        if (Date.now() - _lastUpgradeAttemptAt < UPGRADE_ATTEMPT_BACKOFF_MS) return;
        _lastUpgradeAttemptAt = Date.now();
        console.log('[Geofence] Foreground: upgrade threshold met — upgrading tier now.');
        const upgraded1 = await upgradeGymTier(activeGeofence.sessionId, activeGeofence.partnerName, activeGeofence.visitId);
        if (upgraded1) {
          await patchActiveGeofence(activeGeofence, { tierUpgraded: true }, 'fg_upgrade');
        }
      } else {
        console.log(`[Geofence] Foreground: scheduling 40-min tier upgrade in ${Math.round(remaining / 1000)}s`);
        dwellTimerRef.current = setTimeout(async () => {
          dwellTimerRef.current = null;
          const raw2 = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
          if (!raw2) return;
          const gf: StoredGeofence = JSON.parse(raw2);
          if (gf.tierUpgraded || !gf.sessionId) return;
          console.log('[Geofence] Foreground: 40-min upgrade timer fired.');
          const upgraded2 = await upgradeGymTier(gf.sessionId, gf.partnerName, gf.visitId);
          if (upgraded2) {
            await patchActiveGeofence(gf, { tierUpgraded: true }, 'fg_upgrade_timer');
          }
        }, remaining);
      }
      return;
    }

    if (activeGeofence.sessionRecorded) return;

    const elapsed   = Date.now() - activeGeofence.entryTimestamp;
    // Add a 5 s grace buffer so JS timer imprecision never produces a sub-threshold
    // duration_sec that gets rejected by claim-points as "does not meet eligibility minimum".
    const remaining = (minDwellMs() + 5_000) - elapsed;

    if (remaining <= 0) {
      console.log('[Geofence] Foreground: dwell already met — recording session now.');
      const started = await patchActiveGeofence(activeGeofence, { sessionRecorded: true, claimAttemptAt: Date.now() }, 'fg_claim_start');
      if (!started) return; // finalized under us — the exit path owns this claim now
      const { outcome, sessionId } = await recordDwellSession(started);
      if (outcome === 'too_short' || outcome === 'error' || outcome === 'relayed') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path,
        //            and durably queue so a logout/app-kill before EXIT can't lose the claim.
        // relayed:   server is completing the claim — the retry's relay resolves it.
        await patchActiveGeofence(started, { sessionRecorded: true, pointsPending: true }, 'fg_claim_unresolved');
        if (outcome === 'error') await enqueuePendingClaim({ ...started, endedAtMs: Date.now() });
      } else if (outcome === 'claimed' && sessionId) {
        // claim-points already fired the session_completed push.
        await patchActiveGeofence(started, { sessionRecorded: true, sessionId }, 'fg_claimed');
      }
      return;
    }

    console.log(`[Geofence] Foreground: dwell timer set for ${Math.round(remaining / 1000)}s`);
    dwellTimerRef.current = setTimeout(async () => {
      dwellTimerRef.current = null;
      const raw2 = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      if (!raw2) return; // user exited before timer — background task handles it
      const gf: StoredGeofence = JSON.parse(raw2);
      if (gf.sessionRecorded) return;
      console.log('[Geofence] Foreground: dwell timer fired — recording session.');
      const started = await patchActiveGeofence(gf, { sessionRecorded: true, claimAttemptAt: Date.now() }, 'fg_claim_timer_start');
      if (!started) return; // finalized under us — the exit path owns this claim now
      const { outcome, sessionId } = await recordDwellSession(started);
      if (outcome === 'too_short' || outcome === 'error' || outcome === 'relayed') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path,
        //            and durably queue so a logout/app-kill before EXIT can't lose the claim.
        // relayed:   server is completing the claim — the retry's relay resolves it.
        await patchActiveGeofence(started, { sessionRecorded: true, pointsPending: true }, 'fg_claim_timer_unresolved');
        if (outcome === 'error') await enqueuePendingClaim({ ...started, endedAtMs: Date.now() });
      } else if (outcome === 'claimed' && sessionId) {
        // claim-points already fired the session_completed push.
        await patchActiveGeofence(started, { sessionRecorded: true, sessionId }, 'fg_claim_timer_claimed');
      }
    }, remaining);
  }, []);

  useEffect(() => {
    scheduleDwellTimer();
    const pollInterval = setInterval(scheduleDwellTimer, 10_000);
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        scheduleDwellTimer();
      } else {
        // App backgrounded — clear foreground timer; exit event is the fallback
        if (dwellTimerRef.current != null) {
          clearTimeout(dwellTimerRef.current);
          dwellTimerRef.current = null;
        }
      }
    });
    return () => {
      clearInterval(pollInterval);
      sub.remove();
      if (dwellTimerRef.current != null) clearTimeout(dwellTimerRef.current);
    };
  }, [scheduleDwellTimer]);

  // Fetch partners once on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reconcile partner circles when the app becomes active, and periodically while
  // the app stays open, so admin radius edits don't leave stale native regions behind.
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (AppState.currentState === 'active') {
        refresh();
      }
    }, 5 * 60 * 1000);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        refresh();
      }
    });

    return () => {
      clearInterval(refreshInterval);
      sub.remove();
    };
  }, [refresh]);

  // Close an open session whose location permission has gone away. THE primary
  // detection point: there is no OS callback for a revoked permission, and on
  // Android revoking one usually kills the process outright — so app-foreground
  // (and cold launch, which is why this fires on mount too) is where the app
  // first gets to look. Lateness is fine; finalizeSessionIfLocationRevoked ends
  // the session at the last proven-inside moment, not at this discovery.
  useEffect(() => {
    const check = () => { void finalizeSessionIfLocationRevoked().catch(() => {}); };
    check();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  // Start geofencing when partners load — never torn down by navigation
  useEffect(() => {
    if (!partners.length) return;

    // Restart native monitoring whenever the monitored circles change.
    const fingerprint = partners
      .map(p => `${p.id}:${p.lat.toFixed(6)}:${p.lng.toFixed(6)}:${p.geofenceRadius}`)
      .sort()
      .join(',');
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;

    async function startGeofencing() {
      // Check-only, never request: this runs at app launch (partners load on
      // mount), and a root provider firing the OS permission dialogs here
      // ambushes the user before the primed onboarding pages get their shot —
      // on Android 11+ the background request even bounces them into system
      // settings from nowhere. The dialogs are owned by the primed surfaces
      // (onboarding, settings, discover). Clearing the fingerprint lets the
      // next partner refresh (foreground return / 5-min interval) re-attempt,
      // so geofencing comes up in the same session once permissions land.
      const { status: fg } = await Location.getForegroundPermissionsAsync();
      if (fg !== 'granted') {
        fingerprintRef.current = '';
        return;
      }

      const { status: bg } = await Location.getBackgroundPermissionsAsync();
      if (bg !== 'granted') {
        fingerprintRef.current = '';
        console.warn('[Geofence] Background location permission not granted — geofencing inactive.');
        return;
      }

      // Refresh the nationwide geometry cache — the headless detectors' world
      // view. The fingerprint gate above means this runs only when local data
      // actually changed (new partner, radius edit, different area), so admin
      // edits propagate within one refresh cycle. If the fetch fails and no
      // cache exists yet (first run offline), fall back to caching the nearby
      // set so local detection still works.
      const cached = await fetchAndCacheAllPartnerGeometry();
      if (!cached && !(await readPartnerMap())) {
        const fallbackMap: Record<string, PartnerMapEntry> = {};
        partners.forEach(p => {
          fallbackMap[p.id] = { name: p.name, dbId: p.dbId, lat: p.lat, lng: p.lng, radius: p.geofenceRadius };
        });
        if (Object.keys(fallbackMap).length) await writePartnerMap(fallbackMap, { partial: true });
      }

      // Arm the nearest partner circles + travel sentinel around a TRUSTWORTHY
      // fix. This used to be a single Accuracy.Low read — city-level, served
      // from cell/IP positioning — which on 2026-08-04 placed a stationary user
      // 13 km away and built the whole watch list around the wrong town (their
      // own gym missed the nearest-49 cut at rank 65). getArmFix screens every
      // source to ≤1 km and never hangs.
      const userPos = await getArmFix();
      await armNativeRegions(userPos, { force: true, via: 'startup_refresh' });
      setIsMonitoring(true);

      // Android: run a persistent foreground-service location stream alongside the
      // native geofence. The geofence is the fast low-power trigger; this keeps a
      // resident process so arrival/dwell/exit detection survives the app being
      // swiped away or fully closed (the native geofence's PendingIntent does not).
      // It reads circles from the partner map written above, so it never needs a
      // restart when the monitored set changes — only start it once.
      if (Platform.OS === 'android') {
        try {
          const alreadyStreaming = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false);
          // STREAM-LIVENESS WATCHDOG (2026-08-13). "Started" is a registration
          // flag, not a heartbeat: killServiceOnDestroy stops the service on a
          // swipe, the task stays registered, and this block — latched by
          // _locationStreamEnsuredThisProcess — trusted both and never
          // restarted. Field 08-13: a checked-in visit ran 37 minutes with a
          // dead driver (zero stream fixes 08:32→09:09) and the process died
          // in a pocket, so the claim nudges hit a corpse. With a visit OPEN,
          // silence from a stream that claims to be running IS the failure —
          // dwell mode delivers every ~60 s by contract, so a stale
          // LAST_STREAM_FIX_KEY is proof of a dead service, and a foreground
          // pass through here is exactly the one context allowed to fix it.
          let streamSilent = false;
          if (_locationStreamEnsuredThisProcess && alreadyStreaming
              && AppState.currentState === 'active'
              && (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY).catch(() => null)) != null) {
            const rawFix = await AsyncStorage.getItem(LAST_STREAM_FIX_KEY).catch(() => null);
            const lastTickAt = rawFix ? Number((JSON.parse(rawFix) as { at?: number }).at ?? 0) : 0;
            streamSilent = Date.now() - lastTickAt > STREAM_SILENCE_RESTART_MS;
            if (streamSilent) {
              logRegionEvent('stream', 'visit_stream_ensured', {
                silent_s: lastTickAt ? Math.round((Date.now() - lastTickAt) / 1000) : null,
              });
            }
          }
          // On the first run of this JS process, the "started" flag may be stale
          // (the service was killed by a reboot but TaskManager kept the task
          // registered). Force a clean restart so the service — and its banner —
          // is actually live. Later restarts in the same process trust the flag,
          // except when the watchdog above has just proven it a liar.
          if ((!_locationStreamEnsuredThisProcess || streamSilent) && alreadyStreaming) {
            await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
          }
          if (!_locationStreamEnsuredThisProcess || !alreadyStreaming || streamSilent) {
            // Resume the mode the CURRENT visit state calls for — never a hard-coded
            // baseline. A JS process that restarts mid-visit (Android reclaiming a
            // backgrounded process, an OTA restart, a headless task boot) used to come
            // back on the 50 m-displacement baseline, which delivers NO fixes to a
            // stationary user: the dwell machine stopped ticking and the 30-min claim
            // never fired. That silently un-did the whole point of the dwell stream,
            // mid-session, with the banner the only visible tell.
            const resumeRaw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
            const resumeApproach = await AsyncStorage.getItem(APPROACH_STATE_KEY);
            const resumeMode = visitStreamMode(Platform.OS, {
              sessionActive: resumeRaw != null,
              approaching:   resumeApproach != null,
            });
            const resumeOpts = resumeMode === 'dwell'    ? DWELL_LOCATION_OPTIONS
              :                resumeMode === 'approach' ? APPROACH_LOCATION_OPTIONS
              :                                            LOCATION_UPDATE_OPTIONS;
            await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, resumeOpts);
            await recordStreamMode(resumeMode);
            console.log(`[Geofence] Foreground-service location stream started (${resumeMode}).`);
          }
          _locationStreamEnsuredThisProcess = true;
        } catch (err) {
          console.warn('[Geofence] Failed to start location stream:', err);
        }
      }

      // Register the boot re-arm task so monitoring resumes after a device restart.
      registerGeofenceBootRearm().catch(() => { /* non-fatal */ });

      // If the user is already inside a circle when monitoring starts, record it.
      // Scans the nationwide cache so this works wherever the user opens the app.
      try {
        const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
        const lastKnownFresh = lastKnown != null
          && (Date.now() - lastKnown.timestamp) < 15_000
          && lastKnown.coords.accuracy != null
          && lastKnown.coords.accuracy <= 20;
        const loc = lastKnownFresh
          ? lastKnown
          : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);

        // Ignore coarse fixes — they'd inflate the radius and cause false matches.
        if (loc && (loc.coords.accuracy == null || loc.coords.accuracy <= MAX_FIX_ACCURACY_M)) {
          const map = await readPartnerMap();
          if (map) {
            for (const [regionId, entry] of Object.entries(map)) {
              if (entry.lat == null || entry.lng == null) continue;
              const dist = haversineMetres(loc.coords.latitude, loc.coords.longitude, entry.lat, entry.lng);
              // Exact partner radius — no accuracy buffer added, so a 25 m circle means 25 m.
              if (dist <= (entry.radius ?? 100)) {
                // No-ops if a session is already active or a gym was already logged today.
                await setActiveAndNotify(regionId, entry);
                break;
              }
            }
          }
        }
      } catch { /* non-fatal — geofencing is still active */ }
    }

    startGeofencing();
    // No cleanup: geofencing must survive tab navigation and screen transitions
  }, [partners]);

  return (
    <GeofenceContext.Provider value={{ partners, isMonitoring, loading, refresh, ensureCoverage }}>
      {children}
    </GeofenceContext.Provider>
  );
}

export function useGeofenceContext(): GeofenceContextValue {
  return useContext(GeofenceContext);
}

// ─── Standalone name search (searches entire DB, not just nearby) ─────────────

export async function searchPartners(query: string): Promise<Partner[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('partners')
    .select('id, name, description, category, address, locations, logo_url, logo_bg, image1_url, image2_url, opening_hours')
    .eq('active', true)
    .ilike('name', `%${q}%`)
    .limit(200);
  if (error || !data) return [];
  return formatPartnerRows(data);
}

// ─── Nearest gyms to a coordinate (pure RPC, no native geofence stack) ────────
// Used by onboarding's home-gym picker to show "gyms near you" before the user
// types. Reuses the same row → Partner formatting as search.

export async function fetchNearbyGyms(
  lat: number,
  lng: number,
  maxResults = 20,
): Promise<Partner[]> {
  const { data, error } = await supabase.rpc('nearest_partners', {
    user_lat: lat,
    user_lng: lng,
    max_results: maxResults,
  });
  if (error || !data) return [];
  return formatPartnerRows(data);
}

// ─── Viewport partner loading (Discover map) ─────────────────────────────────
// Fetches full partner rows for an arbitrary map viewport — the provider's own
// nearby set only ever tracks the USER's location, so a panned map needs its
// own fetches. Radius is clamped to the provider's default (0.15°) so a single
// call can never exceed the payload the app already pulls on every open.

export async function fetchPartnersInArea(
  lat: number,
  lng: number,
  radiusDeg: number,
): Promise<Partner[]> {
  const { data, error } = await supabase.rpc('nearby_partners', {
    user_lat:   lat,
    user_lng:   lng,
    radius_deg: Math.min(Math.max(radiusDeg, 0.02), 0.15),
  });
  if (error || !data) return [];
  return formatPartnerRows(data);
}

// Slim geometry point for map clustering — one entry per partner location,
// sourced from the nationwide cache the headless geofence detectors maintain.
export interface PartnerGeoPoint {
  id:     string; // composite "${dbId}-${locationIndex}" — same key as Partner.id
  dbId:   string;
  name:   string;
  lat:    number;
  lng:    number;
  radius: number;
}

/** Every active partner location as slim points (~8k) — the cluster source for
 *  the Discover map, so zoomed-out counts cover the whole dataset without a
 *  per-viewport fetch. Reads the nationwide geometry cache; (re)populates it
 *  first when it is missing, partial, or from the truncated v1 format. Falls
 *  back to whatever cache exists if the refetch fails (e.g. offline). */
export async function getPartnerGeometry(): Promise<PartnerGeoPoint[]> {
  let map = (await partnerMapIsStale()) ? null : await readPartnerMap();
  if (!map) {
    await fetchAndCacheAllPartnerGeometry().catch(() => {});
    map = await readPartnerMap();
  }
  if (!map) return [];
  return Object.entries(map)
    .filter(([, e]) => e.lat != null && e.lng != null)
    .map(([id, e]) => ({
      id,
      dbId:   e.dbId,
      name:   e.name,
      lat:    e.lat!,
      lng:    e.lng!,
      radius: e.radius ?? 100,
    }));
}
