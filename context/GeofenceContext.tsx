import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { ensureFreshSession } from '@/lib/authFresh';
import { bgInsert, bgRpc, bgSelect, bgUpdate, readBackgroundAuth } from '@/lib/backgroundRest';
import { withNetworkTimeout } from '@/lib/networkTimeout';
import { supabase } from '@/lib/supabase';
import { getGymDwellMinutes, getGymUpgradeMinutes, primeGymDwellMinutes } from '@/lib/gymDwellConfig';

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
const VISIT_TICK_KEY         = '@powr/last_visit_tick';   // throttle for the stream heartbeat
const LAST_STREAM_FIX_KEY    = '@powr/last_stream_fix';   // newest fix the location stream delivered — the wake path's fallback presence proof

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
const LOCATION_UPDATE_OPTIONS: Location.LocationTaskOptions = {
  accuracy:                         Location.Accuracy.Balanced,
  timeInterval:                     60_000,
  distanceInterval:                 50,
  deferredUpdatesInterval:          60_000,
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
 * 'dwell' (time-driven, see DWELL_LOCATION_OPTIONS) is **Android only**: on iOS
 * `distanceInterval: 0` is kCLDistanceFilterNone — a continuous firehose — and iOS
 * ignores timeInterval, so the same options would hammer the battery. iOS keeps its
 * existing behaviour: the approach stream runs while inside the ring, and the claim
 * lands on the region EXIT.
 *
 * Pure so the platform rules are testable without a Platform mock. */
export function visitStreamMode(
  os: string,
  state: { sessionActive: boolean; approaching: boolean },
): StreamMode {
  if (os === 'android' && state.sessionActive) return 'dwell';
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

// Location-detected EXIT is a backstop for when the native geofence exit never
// fires (closed app). Require the fix to be clearly outside the circle before
// trusting it, so GPS noise can't flap a genuinely-inside session out early.
const LOCATION_EXIT_HYSTERESIS_M = 50;

// Accounts that bypass the one-session-per-day guard during testing
const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

// Proximity checks trigger at exactly the partner's configured radius — no GPS
// accuracy buffer is added, so a 25 m circle means 25 m, not 25 m + the user's
// position uncertainty. Coarse fixes are still rejected outright: Android's first
// fix on app open is often a network/fused position accurate to only a few hundred
// metres, which can't be trusted against a tight radius and would otherwise fire a
// false "You're in" from far away.
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

export interface ArmFix { latitude: number; longitude: number; src: 'stream_cache' | 'last_known' | 'live' }

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
        return { latitude: f.latitude, longitude: f.longitude, src: 'stream_cache' };
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
    return { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude, src: 'last_known' };
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
      return { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude, src: 'live' };
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

async function armNativeRegions(
  fix: { latitude: number; longitude: number } | null,
  opts: { force?: boolean; freshHandle?: boolean } = {},
): Promise<void> {
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
  return mode === 'approach' ? APPROACH_LOCATION_OPTIONS
    :    mode === 'dwell'    ? DWELL_LOCATION_OPTIONS
    :                          LOCATION_UPDATE_OPTIONS;
}

async function recordStreamMode(mode: StreamMode): Promise<void> {
  _streamModeInProcess = mode;
  await AsyncStorage.setItem(STREAM_MODE_KEY, mode).catch(() => {});
}

// Exported for tests: the same-mode no-op and the restore-on-refused-start are
// regression-pinned directly (__tests__/geofence-arm-fix.test.ts).
export async function setLocationStreamMode(mode: StreamMode): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false);
    if (mode === 'off') {
      if (started) await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
      await recordStreamMode('off');
      return;
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
    if (started && current === mode) return;

    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
    try {
      await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, streamOptsFor(mode));
      await recordStreamMode(mode);
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
      // when this fires.
      logRegionEvent('stream', 'stream_start_failed', { mode, restored, error: String(err).slice(0, 120) });
      console.warn('[Geofence] setLocationStreamMode failed:', mode, err);
    }
  } catch (err) {
    logRegionEvent('stream', 'stream_start_failed', { mode, error: String(err).slice(0, 120) });
    console.warn('[Geofence] setLocationStreamMode failed:', mode, err);
  }
}

/** Fire-and-forget region telemetry, lazily imported like the rest of the
 *  gymVisits surface so a headless context only pulls it in when it fires. */
function logRegionEvent(
  regionId: string,
  event: 'enter' | 'exit' | 'approach_stream_on' | 'checked_in' | 'stream_start_failed'
    | 'armed' | 'sentinel_exit' | 'rearm_skipped',
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
  attempts:      6,
  intervalMs:    15 * 1000,   // ~90 s of cover: a 120 m walk-in at normal pace
  fixTimeoutMs:   8 * 1000,
};

async function pollForCheckIn(regionId: string): Promise<void> {
  for (let attempt = 0; attempt < CHECKIN_POLL.attempts; attempt++) {
    try {
      // Someone got there first (the stream, or a previous pass) — done.
      if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) return;

      const cached = await Location.getLastKnownPositionAsync({ maxAge: 30_000 }).catch(() => null);
      const fix = cached ?? await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
        new Promise<null>(resolve => setTimeout(() => resolve(null), CHECKIN_POLL.fixTimeoutMs)),
      ]);
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

async function sweepForMissedCheckIn(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) return; // already checked in
    const { status } = await Location.getBackgroundPermissionsAsync()
      .catch(() => ({ status: 'denied' as Location.PermissionStatus }));
    if (status !== 'granted') return;

    // Cheap sources only — this runs on the OS's schedule, not in a wake window,
    // but an unbounded acquisition here would hang exactly like the wake path did.
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
    if (!cached) return;
    await evaluateLocationFix(cached.coords);
  } catch (err) {
    console.warn('[Geofence] Missed check-in sweep failed:', err);
  }
}

/** Enters the approach ring for a gym: escalate to the high-accuracy stream so
 *  evaluateLocationFix can catch the precise 25 m crossing. No session/notification
 *  is started here — that's evaluateLocationFix's job, at the true radius. */
async function enterApproach(regionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(APPROACH_STATE_KEY, JSON.stringify({ regionId, since: Date.now() }));
  } catch { /* non-fatal */ }
  await setLocationStreamMode('approach');
  // Pairs with the 'enter' row: this one landing means the OS delivered ENTER
  // *and* we got the high-accuracy stream running, so any missing check-in after
  // this point is the stream failing to produce an inside fix — not a missed
  // region event. Two rows, two distinct failure modes, no guessing.
  logRegionEvent(regionId, 'approach_stream_on');
  console.log(`[Geofence] Approach ring "${regionId}" — high-accuracy stream on.`);
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
  const endedAtMs = activeGeofence.endedAtMs ?? Date.now();
  const dwellMs = endedAtMs - activeGeofence.entryTimestamp;
  try {
    // Backgrounded, the auth machinery is the enemy. A cold headless runtime
    // always takes authFresh's resync branch (its remembered token is null by
    // definition), and setSession can hang forever with the screen off: on
    // 2026-08-06 this claim froze there, and the zombie-heal retry froze in the
    // identical place six minutes later. Present the persisted token over raw
    // REST instead — same user, same RLS, no auth work (see lib/backgroundRest).
    //
    // Foreground keeps ensureFreshSession: nothing freezes there, and it is the
    // only path allowed to rotate a token (a background rotation revokes the
    // family — the silent-401 outage of 2026-08-05).
    const backgrounded = AppState.currentState !== 'active';
    const bgAuth = backgrounded ? await readBackgroundAuth() : null;

    let userId: string;
    if (bgAuth) {
      userId = bgAuth.userId;
    } else {
      const authSession = await ensureFreshSession('record_dwell_session');
      if (!authSession?.user) {
        console.error('[Geofence] No valid session — cannot record session (auth unrecoverable until app-open).');
        return { outcome: 'error' };
      }
      userId = authSession.user.id;
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

  // There is real work: make the whole replay pass run on a fresh token. Placed
  // after the empty-queue return so the hot path (every task wake flushes) costs
  // nothing when there is nothing to flush.
  await ensureFreshSession('flush_pending_claims');

  // Whose queue is this? The outbox is replayed on login, so without an owner check
  // an entry banked by the previous account is claimed by whoever signs in next —
  // a real cross-account credit path, not just cosmetic state bleed. Entries
  // written before this field existed have no userId and stay claimable by the
  // current user, which is the old behaviour and the safe direction for a device
  // that has only ever had one account.
  let currentUserId: string | null = null;
  try {
    const { data: { user } } = await withNetworkTimeout(supabase.auth.getUser(), 'auth.getUser');
    currentUserId = user?.id ?? null;
  } catch { /* offline — fall through and treat ownership as unknown */ }

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
    const { data: { user } } = await withNetworkTimeout(supabase.auth.getUser(), 'auth.getUser');
    if (!user) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
    // ensureFreshSession resyncs this runtime to the latest persisted token pair
    // before any refresh, which is what actually prevents the family-revocation
    // race the old comment here worried about (see lib/authFresh.ts, 2026-08-05).
    const authSession = await ensureFreshSession('upgrade_gym_tier');
    if (!authSession) {
      console.warn('[Geofence] Tier upgrade: no valid session — will retry on next poll.');
      return false;
    }

    // BACKGROUND: same as the claim — a functions.invoke never arrives from a
    // backgrounded Android app, so relay via the REST path and let pg_net call
    // upgrade-gym-tier server-to-server. 'accepted' returns false on purpose:
    // the next tick's relay answers 'already_done' and finalizes the state.
    if (AppState.currentState !== 'active') {
      const { data: relay, error: relayError } = await withNetworkTimeout(
        supabase.rpc('relay_gym_upgrade', { p_session_id: sessionId, p_visit_id: visitId ?? null }),
        'relay_gym_upgrade rpc',
      );
      if (relayError) {
        console.warn('[Geofence] Upgrade relay failed:', relayError.message);
        return false;
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

/** True if the user has already logged a geofence gym session today. Uses the
 *  cached auth token (getSession — local, no network round-trip) for the user id. */
async function gymAlreadyLoggedToday(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || DEV_TEST_EMAILS.has(user.email ?? '')) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('activity_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'gym')
      .eq('verification', 'geofence')
      .gte('started_at', today.toISOString())
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

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
  let ownerId: string | undefined;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    ownerId = session?.user?.id;
  } catch { /* unauthenticated or offline — leave unstamped */ }

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
  let checkInShown = false;
  try {
    const { notifyCheckInAvailable } = await import('@/lib/notifications');
    checkInShown = await notifyCheckInAvailable(entry.name, regionId);
  } catch (err) {
    console.warn('[Geofence] check-in banner failed locally — server announce will cover (android):', err);
  }

  // iOS: pre-schedule the 30/40-minute banners now, while we are provably
  // awake. Keyed on entryTimestamp — always known locally — NOT the visit id,
  // which needs a network round-trip that background relaunches may freeze.
  // The EXIT path cancels by the same key (see finalizeActiveGeofenceInner).
  // No-op on Android.
  try {
    const { scheduleSessionMarkNotifications } = await import('@/lib/notifications');
    await scheduleSessionMarkNotifications({
      sessionKey: String(entryTimestamp),
      partnerName: entry.name,
      entryTimestampMs: entryTimestamp,
      dwellMinutes: getGymDwellMinutes(),
      upgradeMinutes: getGymUpgradeMinutes(),
    });
  } catch (err) {
    console.warn('[Geofence] session marks failed to schedule:', err);
  }

  // Day-cap honesty, advisory + fire-and-forget. A second visit today still
  // gets the FULL check-in (session history, announce, exit close) — the
  // never-drop-a-workout rule; the server caps the POINTS on its own. The one
  // local artifact that would lie is the pre-scheduled iOS marks ("banked"),
  // so when the check says the day is already claimed, withdraw them.
  //
  // NEVER await this. Its former life as an awaited gate — an UNBOUNDED
  // PostgREST round-trip before even the session write — was the frozen-
  // response class parked at the front door of entry, invisible on dev
  // phones (DEV_TEST_EMAILS short-circuits before the query) and lethal for
  // real users (2026-08-06 audit, gap #1: no banner, no marks, no session,
  // no visit — total silence on arrival).
  void gymAlreadyLoggedToday()
    .then(async (already) => {
      if (!already) return;
      const { cancelSessionMarkNotifications } = await import('@/lib/notifications');
      await cancelSessionMarkNotifications(String(entryTimestamp), 'all');
      console.log('[Geofence] Day already claimed — session records, marks withdrawn.');
    })
    .catch(() => { /* advisory only — worst case the marks stay */ });

  // Only now the network: open the server-side visit beacon.
  let visitId: string | null = null;
  try {
    const { openGymVisit } = await import('@/lib/gymVisits');
    visitId = await openGymVisit(entry.dbId, regionId, entryTimestamp);
    if (visitId) {
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const active = raw ? JSON.parse(raw) as StoredGeofence : null;
      // Only stamp the visit onto the session we just opened — never a later one.
      if (active && active.entryTimestamp === entryTimestamp) {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, visitId }));
      }
      if (checkInShown) {
        // Local banner displayed — tell the beacon not to double-announce
        // (android). Promise.resolve upgrades PostgREST's PromiseLike; two-arg
        // then covers both the {error} result and a thrown network error.
        const { supabase } = await import('@/lib/supabase');
        void Promise.resolve(
          supabase.rpc('mark_gym_visit_announced', { p_visit_id: visitId }),
        ).then(
          ({ error }) => { if (error) console.warn('[Geofence] announce mark failed:', error.message); },
          (rpcErr: unknown) => { console.warn('[Geofence] announce mark RPC threw:', rpcErr); },
        );
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
  try {
    const dwellMs = endedAtMs - active.entryTimestamp;
    const dwellThresholdMs = getGymDwellMinutes() * 60_000;
    const upgradeThresholdMs = getGymUpgradeMinutes() * 60_000;
    if (dwellMs < upgradeThresholdMs) {
      const { cancelSessionMarkNotifications } = await import('@/lib/notifications');
      await cancelSessionMarkNotifications(
        String(active.entryTimestamp),
        dwellMs < dwellThresholdMs ? 'all' : 'upgrade_only',
      );
    }
  } catch (err) {
    console.warn('[Geofence] session mark cancel failed:', err);
  }

  // Close the beacon so the server stops waking a device that has already left.
  if (active.visitId) {
    try {
      const { closeGymVisit } = await import('@/lib/gymVisits');
      await closeGymVisit(active.visitId, endedAtMs);
    } catch { /* non-fatal */ }
  }

  if (!needsClaim) {
    console.log(`[Geofence] Dwell ${Math.round((endedAtMs - active.entryTimestamp) / 60000)}min < threshold — no points.`);
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
export async function armAfterPermissionGrant(): Promise<void> {
  try {
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
    await armNativeRegions(
      fix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
      { force: true },
    );
    console.log('[Geofence] Armed immediately after permission grant.');
  } catch (err) {
    console.warn('[Geofence] Arm-on-grant failed (the refresh path still covers it):', err);
  }
}

export async function rearmFencesFromWake(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const fix = await getArmFix();
    await armNativeRegions(
      fix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
      { force: true, freshHandle: true },
    );
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
const RECONCILE_FIX_MAX_AGE_MS = 3 * 60_000;

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

    const distance = haversineMetres(fix.latitude, fix.longitude, active.latitude, active.longitude);
    const buffer = Math.max(fix.accuracy ?? 50, LOCATION_EXIT_HYSTERESIS_M);
    if (distance <= active.radius + buffer) {
      // Proven inside right now — refresh the evidence floor the endedAt bound
      // reads. (Also throttles the next stream heartbeat by one interval; the
      // wake just did that heartbeat's job.)
      await AsyncStorage.setItem(VISIT_TICK_KEY, String(Date.now())).catch(() => {});
      return;
    }

    const tickRaw = await AsyncStorage.getItem(VISIT_TICK_KEY).catch(() => null);
    const tick = Number(tickRaw ?? 0);
    const endedAt = Math.max(active.entryTimestamp, Number.isFinite(tick) ? tick : 0);
    console.warn(
      `[Geofence] Wake reconcile: fix is ${Math.round(distance)}m from "${active.partnerName}" ` +
      `(radius ${active.radius}m + ${Math.round(buffer)}m buffer) — finalizing zombie session, ` +
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
  // 1. The stream's persisted fix, when fresh enough to speak for "now".
  try {
    const raw = await AsyncStorage.getItem(LAST_STREAM_FIX_KEY);
    if (raw) {
      const f = JSON.parse(raw) as { latitude?: number; longitude?: number; accuracy?: number | null; at?: number };
      if (typeof f?.latitude === 'number' && typeof f?.longitude === 'number'
          && Date.now() - (f.at ?? 0) <= RECONCILE_FIX_MAX_AGE_MS) {
        return { latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy ?? null };
      }
    }
  } catch { /* fall through to the OS sources */ }

  // 2. OS cache — no acquisition, cannot hang. The ping's own re-arm just made
  // GMS evaluate fence states, so this is usually seconds old.
  const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: RECONCILE_FIX_MAX_AGE_MS })
    .catch(() => null);
  if (lastKnown) {
    return {
      latitude: lastKnown.coords.latitude,
      longitude: lastKnown.coords.longitude,
      accuracy: lastKnown.coords.accuracy ?? null,
    };
  }

  // 3. One bounded live read. The bound is best-effort under Doze (RN timers
  // can freeze) — a hang here holds only the wake task's tail, never the
  // re-arm, which its caller sequences first.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
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

export async function runVisitCheck(
  stage: 'dwell' | 'upgrade',
  serverVisitId?: string,
  /** The nudge's short-lived ticket. When present, the ENTIRE check runs
   *  auth-free: telemetry and confirm ride the nonce (raw fetch + anon key),
   *  and no auth round-trip is ever awaited — the 2026-08-05 freeze class. */
  wakeNonce?: string,
): Promise<void> {
  const trace: WakeTrace = { stage };
  // Freshness before the first server touch — but ONLY on ticketless entries
  // (foreground callers, legacy nudges). A ticketed wake must never await auth;
  // warming happens fire-and-forget in the background task instead.
  if (!wakeNonce) await ensureFreshSession(`visit_check_${stage}`);
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
  const visitId = serverVisitId ?? active.visitId;
  const visitMismatch = !!serverVisitId && !!active.visitId && serverVisitId !== active.visitId;
  if (visitMismatch) {
    console.warn(
      `[Geofence] Visit check: stored visit ${active.visitId} != server ${serverVisitId} — answering for the server's.`,
    );
    try {
      const current = raw ? JSON.parse(raw) as StoredGeofence : null;
      if (current && current.visitId === active.visitId) {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...current, visitId: serverVisitId }));
      }
    } catch { /* best-effort repair — never block the wake's one round-trip */ }
  }

  let coords: Location.LocationObjectCoords | null = null;
  let fixSource = 'none';

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
    trace.stream_fix_age_s = Math.round((Date.now() - streamFix.at) / 1000);
  } else {
    trace.stream_fix_age_s = streamFix ? Math.round((Date.now() - streamFix.at) / 1000) : 'absent';
    const cached = await tracedStep('last_known', trace, () => Location.getLastKnownPositionAsync({ maxAge: 60_000 }), STEP_TIMEOUT_MS);
    if (cached) {
      coords = cached.coords;
      fixSource = 'last_known';
    } else {
      const fresh = await tracedStep('acquire', trace, () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), FIX_ACQUIRE_TIMEOUT_MS);
      coords = fresh?.coords ?? null;
      fixSource = fresh ? 'acquired' : 'timeout';
    }
  }
  trace.fix_source = fixSource;
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
  if (active.latitude != null && active.longitude != null && active.radius != null) {
    distance = haversineMetres(coords.latitude, coords.longitude, active.latitude, active.longitude);
    inside = distance <= active.radius + LOCATION_EXIT_HYSTERESIS_M;
  }

  if (visitId) {
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
      visit_mismatch: visitMismatch,
      trace,
    };
    if (wakeNonce) await confirmGymVisitViaNonce(visitId, wakeNonce, inside, detail, inside, active.entryTimestamp);
    else await confirmGymVisit(visitId, inside, detail, inside, active.entryTimestamp);
  }

  // DURABLE ENTRY (2026-08-06 field): the check-in's own openGymVisit is a
  // single best-effort call, and when it freezes — which it did tonight at
  // 20:03:38, resyncing auth and never returning — the server never learns the
  // session exists. No visit row means no beacon, no nudges, no server-side
  // timers: the device is alone with a session nobody else knows about.
  //
  // The device is the source of truth, so the server just has to catch up.
  // Every wake already has a fresh fix and a live network, so a wake that
  // finds an active session WITHOUT a visit id opens one, backdated to the
  // real entry time (open_gym_visit re-uses an open visit, so a racing
  // double-open is a no-op, and the backdate keeps the server's 30/40 timers
  // honest no matter how late this lands). A frozen check-in therefore costs a
  // few minutes of beacon coverage rather than the whole session.
  //
  // This mirrors what the stream heartbeat already does — but the heartbeat
  // needs stream ticks, and a swiped Android phone's only heartbeat IS the wake.
  if (inside && !active.visitId) {
    try {
      const { openGymVisit } = await import('@/lib/gymVisits');
      const lateId = await openGymVisit(active.partnerId, active.regionId, active.entryTimestamp);
      if (lateId) {
        const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
        const cur = raw ? JSON.parse(raw) as StoredGeofence : null;
        // Only stamp the session we just opened for — never a later one.
        if (cur && cur.entryTimestamp === active.entryTimestamp) {
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...cur, visitId: lateId }));
        }
        console.log(`[Geofence] Late visit open succeeded on wake — server caught up (${lateId}).`);
      }
    } catch (err) {
      console.warn('[Geofence] Late visit open failed — next wake retries:', err);
    }
  }

  if (inside) {
    console.log(`[Geofence] Visit check (${stage}): still inside — advancing dwell.`);
    // Confirmed-inside is inside-EVIDENCE: stamp the heartbeat floor so the
    // wake reconciler's honest endedAt bound tracks nudge-confirmed sessions
    // (a swiped phone's only ticks ARE these wakes). void — evidence must
    // never cost the wake anything.
    void AsyncStorage.setItem(VISIT_TICK_KEY, String(Date.now())).catch(() => {});
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
    await AsyncStorage.setItem(
      ACTIVE_GEOFENCE_KEY,
      JSON.stringify({ ...active, pointsPending: false, claimAttemptAt: Date.now() }),
    );
    const { outcome, sessionId } = await recordDwellSession(active, staleLockMs);
    if (outcome === 'claimed' && sessionId) {
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, pointsPending: false, sessionId }));
    } else {
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, pointsPending: true }));
      // Durably queue (frozen at now) on a hard error so a logout/app-kill before the
      // EXIT event can't lose the claim — flushPendingClaims retries it on re-login.
      if (outcome === 'error') await enqueuePendingClaim({ ...active, endedAtMs: Date.now() });
    }
    return;
  }

  // 2. Claimed at the 30-min tier — upgrade once the 40-min threshold is met.
  if (active.sessionRecorded && active.sessionId && !active.tierUpgraded) {
    if (elapsed < prodUpgradeMs()) return;
    const ok = await upgradeGymTier(active.sessionId, active.partnerName, active.visitId);
    if (ok) await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, tierUpgraded: true }));
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
      const queued = { ...active, pointsPending: true };
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(queued));
      if (staleLockMs != null) await advanceActiveSession(queued, staleLockMs);
    }
    return;
  }

  // 3. Initial claim once the dwell threshold is met.
  if (elapsed < minDwellMs()) return;
  await AsyncStorage.setItem(
    ACTIVE_GEOFENCE_KEY,
    JSON.stringify({ ...active, sessionRecorded: true, claimAttemptAt: Date.now() }),
  );
  const { outcome, sessionId } = await recordDwellSession(active, staleLockMs);
  if (outcome === 'claimed' && sessionId) {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true, sessionId }));
  } else if (outcome === 'too_short' || outcome === 'error' || outcome === 'relayed') {
    // relayed: the server is completing the claim — keep pointsPending so the
    // next tick re-enters recordDwellSession, whose relay answers
    // 'already_claimed' and finalizes. Not a failure, so no durable queue.
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true, pointsPending: true }));
    // Durably queue on a hard error (e.g. logged out) so the claim survives an app
    // kill before EXIT and is flushed on re-login. too_short retries in-gym only.
    if (outcome === 'error') await enqueuePendingClaim({ ...active, endedAtMs: Date.now() });
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
    const persisted = Number((await AsyncStorage.getItem(VISIT_TICK_KEY)) ?? 0);
    if (now - persisted < VISIT_TICK_INTERVAL_MS) return;
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(now));

    if (!active.visitId) {
      // Late-open. openGymVisit fires exactly once, at check-in — but check-in can
      // RACE auth (fresh install: the entry fix landed 240 ms into login and the RPC
      // failed P0001 'not authenticated', field-caught 2026-07-14). Without a retry
      // the visit has no beacon for its entire life: no server timers, no wakes.
      // Passing the original entryTimestamp backdates started_at, so the server's
      // dwell/upgrade timers are unaffected by how late the open happens; the RPC
      // re-uses an already-open visit, so a racing double-open is a no-op.
      const { openGymVisit } = await import('@/lib/gymVisits');
      const visitId = await openGymVisit(active.partnerId, active.regionId, active.entryTimestamp);
      if (!visitId) return; // still unauthenticated/offline — next interval retries
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const current = raw ? JSON.parse(raw) as StoredGeofence : null;
      // Only stamp the visit onto the session it belongs to — never a later one.
      if (!current || current.entryTimestamp !== active.entryTimestamp) return;
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...current, visitId }));
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
  const isCoarse = coords.accuracy != null && coords.accuracy > MAX_FIX_ACCURACY_M;

  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  const active: StoredGeofence | null = raw ? JSON.parse(raw) : null;

  if (active && isCoarse) {
    // Position untrusted: skip the EXIT geometry (assume still inside — the same
    // effective outcome as the old early-return) but keep the time-based dwell
    // state machine alive so background claims fire without an app-open.
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
    if (coords.accuracy != null && coords.accuracy <= ARM_FIX_MAX_ACCURACY_M) {
      await armNativeRegions({ latitude: coords.latitude, longitude: coords.longitude });
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
    } else {
      // Location-detected EXIT — the native exit event may never arrive when closed.
      await finalizeActiveGeofence();
    }
    return;
  }

  // No active session — look for an ENTER against the cached circles.
  const partnerMap = await readPartnerMap();
  if (!partnerMap) return;

  let withinAnyApproach = false;
  for (const [regionId, entry] of Object.entries(partnerMap)) {
    if (entry.lat == null || entry.lng == null) continue;
    const dist = haversineMetres(coords.latitude, coords.longitude, entry.lat, entry.lng);
    // Exact partner radius — no accuracy buffer added, so a 25 m circle means 25 m.
    if (dist <= (entry.radius ?? 100)) {
      await setActiveAndNotify(regionId, entry);
      return;
    }
    if (dist <= APPROACH_RADIUS_M) withinAnyApproach = true;
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
  await armNativeRegions({ latitude: coords.latitude, longitude: coords.longitude });
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
    await armNativeRegions(
      fix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
      { force: true },
    );
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
  } catch { /* best-effort — the wake falls back to its other sources */ }
  try {
    // Headless context: load the last-persisted admin dwell threshold from
    // storage before any dwell decision (foreground refreshes it on launch).
    await primeGymDwellMinutes();
    await flushPendingClaims();
    await evaluateLocationFix(locations[locations.length - 1].coords);
  } catch (err) {
    console.warn('[Geofence] evaluateLocationFix failed:', err);
  }
});

// Boot re-arm: re-issues monitoring from cached circles after a device restart.
TaskManager.defineTask(GEOFENCE_REARM_TASK, async () => {
  try {
    await flushPendingClaims();
    await rearmGeofencingFromCache();
    await sweepForMissedCheckIn();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Native geofence (fast, low-power ENTER/EXIT trigger when the OS delivers it).
// The whole body is guarded: this executor runs headlessly at every relaunch a
// region crossing causes, and its siblings both already catch. A malformed or
// null event (iOS delivers these on Circle-remount flake and cold relaunches)
// must drop THIS event, never abort the executor with an unhandled rejection
// (2026-08-05 crash-hunt findings #3/#5).
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  try {
    if (error) {
      console.error('[Geofence] Task error:', error);
      return;
    }

    // Headless context: load the last-persisted admin dwell threshold from storage
    // so exit-time dwell checks use the current value.
    await primeGymDwellMinutes();
    await flushPendingClaims();

    const { eventType, region } = (data ?? {}) as {
      eventType?: Location.GeofencingEventType;
      region?: Location.LocationRegion;
    };
    if (eventType == null || !region) {
      console.warn('[Geofence] Task fired without a usable event — ignoring.');
      return;
    }

    const regionId = region.identifier ?? '';

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
        await armNativeRegions({ latitude: fix.latitude, longitude: fix.longitude });
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
    logRegionEvent(regionId, 'exit');
    // Left the approach ring — return the stream to baseline whether or not a
    // session was active (also covers "walked up but never checked in"). A
    // neighboring approach-ring exit must not stop tracking an active gym.
    await exitApproach(regionId);
    await finalizeActiveGeofence(regionId);
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
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, pointsPending: false, claimAttemptAt: Date.now() }));
        const { outcome, sessionId: retriedId } = await recordDwellSession(activeGeofence);
        if (outcome === 'claimed' && retriedId) {
          // claim-points already fired the session_completed push.
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, pointsPending: false, sessionId: retriedId }));
        } else {
          // Still failing — restore flag and keep retrying via the poll interval
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, pointsPending: true }));
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
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, pointsPending: false, claimAttemptAt: Date.now() }));
          const { outcome, sessionId: retriedId } = await recordDwellSession(gf);
          if (outcome === 'claimed' && retriedId) {
            // claim-points already fired the session_completed push.
            await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, pointsPending: false, sessionId: retriedId }));
          } else {
            await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, pointsPending: true }));
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
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, tierUpgraded: true }));
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
            await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, tierUpgraded: true }));
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
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true, claimAttemptAt: Date.now() }));
      const { outcome, sessionId } = await recordDwellSession(activeGeofence);
      if (outcome === 'too_short' || outcome === 'error' || outcome === 'relayed') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path,
        //            and durably queue so a logout/app-kill before EXIT can't lose the claim.
        // relayed:   server is completing the claim — the retry's relay resolves it.
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true, pointsPending: true }));
        if (outcome === 'error') await enqueuePendingClaim({ ...activeGeofence, endedAtMs: Date.now() });
      } else if (outcome === 'claimed' && sessionId) {
        // claim-points already fired the session_completed push.
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true, sessionId }));
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
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true, claimAttemptAt: Date.now() }));
      const { outcome, sessionId } = await recordDwellSession(gf);
      if (outcome === 'too_short' || outcome === 'error' || outcome === 'relayed') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path,
        //            and durably queue so a logout/app-kill before EXIT can't lose the claim.
        // relayed:   server is completing the claim — the retry's relay resolves it.
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true, pointsPending: true }));
        if (outcome === 'error') await enqueuePendingClaim({ ...gf, endedAtMs: Date.now() });
      } else if (outcome === 'claimed' && sessionId) {
        // claim-points already fired the session_completed push.
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true, sessionId }));
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
      await armNativeRegions(
        userPos ? { latitude: userPos.latitude, longitude: userPos.longitude } : null,
        { force: true },
      );
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
          // On the first run of this JS process, the "started" flag may be stale
          // (the service was killed by a reboot but TaskManager kept the task
          // registered). Force a clean restart so the service — and its banner —
          // is actually live. Later restarts in the same process trust the flag.
          if (!_locationStreamEnsuredThisProcess && alreadyStreaming) {
            await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
          }
          if (!_locationStreamEnsuredThisProcess || !alreadyStreaming) {
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
