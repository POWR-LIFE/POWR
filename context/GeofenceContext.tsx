import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
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
const PARTNER_MAP_META_KEY   = '@powr/partner_map_meta';   // { fetchedAt } — bump invalidates the in-context parse memo
const ARM_META_KEY           = '@powr/geofence_arm_meta';  // centre + sentinel radius of the currently armed region set
const SESSION_COMPLETED_KEY  = '@powr/session_completed';
const PENDING_CLAIMS_KEY     = '@powr/pending_claims';

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
  sessionId?:       string;  // set after the initial 30-min claim succeeds
  tierUpgraded?:    boolean; // true once the 40-min upgrade has been attempted
  endedAtMs?:       number;  // frozen exit time — used by post-exit retry claims so
                             // the recorded duration stays the true session length
  visitId?:         string;  // server-side beacon record; lets the server wake this
                             // device at the dwell/upgrade thresholds (see lib/gymVisits)
}

// ─── Partner geometry cache (nationwide) ─────────────────────────────────────
// PARTNER_MAP_KEY holds the geometry of EVERY active partner location — not just
// the ones near the last app open — so the headless detectors keep working no
// matter where the user travels with the app closed. ~8k entries is ~1.5 MB of
// AsyncStorage and a few ms of haversines per scan. The meta key carries
// fetchedAt so each JS context (app + headless task) memoizes the parse and only
// re-reads when the cache was actually rewritten.

interface PartnerMapMeta { fetchedAt: number }

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

async function writePartnerMap(map: Record<string, PartnerMapEntry>): Promise<void> {
  const fetchedAt = Date.now();
  await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify(map));
  await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt } satisfies PartnerMapMeta));
  _partnerMapMemo = { fetchedAt, map };
}

/** Fetches geometry-only columns for every active partner and rewrites the
 *  cache. Kept lightweight (id/name/locations) so the payload stays small even
 *  at ~8k partners. */
async function fetchAndCacheAllPartnerGeometry(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('partners')
      .select('id, name, locations')
      .eq('active', true);
    if (error || !data) return false;
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

async function armNativeRegions(
  fix: { latitude: number; longitude: number } | null,
  opts: { force?: boolean } = {},
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
    // Stop first so we always start with a fresh region set (also avoids
    // internal sync issues in Expo Go).
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
    if (meta) {
      await AsyncStorage.setItem(ARM_META_KEY, JSON.stringify(meta));
    } else {
      await AsyncStorage.removeItem(ARM_META_KEY).catch(() => {});
    }
    console.log(`[Geofence] Armed ${regions.length} region(s)${fix ? ' around current fix' : ' (no fix — unsorted)'}.`);
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
async function setLocationStreamMode(mode: StreamMode): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false);
    if (mode === 'off') {
      if (started) await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
      return;
    }
    const opts = mode === 'approach' ? APPROACH_LOCATION_OPTIONS
      : mode === 'dwell'             ? DWELL_LOCATION_OPTIONS
      :                                LOCATION_UPDATE_OPTIONS;
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
    await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, opts);
  } catch (err) {
    console.warn('[Geofence] setLocationStreamMode failed:', mode, err);
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
// task runs in a separate JS context and can't share this Set).
const _recordingInFlight = new Set<string>();

async function recordDwellSession(activeGeofence: StoredGeofence): Promise<{ outcome: 'claimed' | 'too_short' | 'error' | 'in_flight'; sessionId?: string; earned?: number; currentStreak?: number }> {
  const lockKey = `${activeGeofence.partnerId}:${activeGeofence.entryTimestamp}`;
  if (_recordingInFlight.has(lockKey)) {
    console.log('[Geofence] recordDwellSession already in flight for this session — skipping duplicate.');
    return { outcome: 'in_flight' };
  }
  _recordingInFlight.add(lockKey);

  // Use the frozen exit time when present (post-exit retry) so a claim that runs
  // minutes/hours later still records the real session length — not entry→now,
  // which would keep growing and wrongly cross the 40-min tier.
  const endedAtMs = activeGeofence.endedAtMs ?? Date.now();
  const dwellMs = endedAtMs - activeGeofence.entryTimestamp;
  try {
    // Use the cached session (getSession) — NOT refreshSession(). refreshSession()
    // unconditionally ROTATES the refresh token; when this runs in the background
    // TaskManager context (a separate GoTrue instance sharing the same SecureStore as
    // the foreground app), the two clients race to rotate the same token and GoTrue's
    // reuse-detection revokes the whole session family — silently logging the user out
    // mid-gym and dropping the claim. getSession() returns the stored token and only
    // refreshes (under the client's lock) when it's actually expired, so it can't
    // trigger that race.
    const { data: { session: authSession }, error: authError } = await supabase.auth.getSession();
    if (authError || !authSession?.user) {
      console.error('[Geofence] No valid session — cannot record session:', authError?.message ?? 'logged out');
      return { outcome: 'error' };
    }
    const user = authSession.user;

    const startedAt   = new Date(activeGeofence.entryTimestamp);
    // Cap the dwell so a late EXIT/dwell detection can't record an impossible
    // (multi-hour/-day) session. ended_at is derived from the capped length so
    // the row stays internally consistent.
    const durationSec = Math.min(Math.round(dwellMs / 1000), MAX_GYM_SESSION_SEC);
    const endedAt     = new Date(activeGeofence.entryTimestamp + durationSec * 1000);

    const { getDeviceId } = await import('@/lib/device');
    const deviceId = await getDeviceId();

    let sessionId: string;

    const { data: session, error: sessionError } = await supabase
      .from('activity_sessions')
      .insert({
        user_id:      user.id,
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
      })
      .select()
      .single();

    if (sessionError) {
      if (sessionError.code === '23505') {
        // Session already exists (recorded when duration was too short) — update to actual elapsed time
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: existing } = await supabase
          .from('activity_sessions')
          .select('id')
          .eq('user_id', user.id)
          .eq('type', 'gym')
          .gte('started_at', today.toISOString())
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        if (!existing) {
          console.error('[Geofence] 23505 but could not find existing session');
          return { outcome: 'error' };
        }

        await supabase
          .from('activity_sessions')
          .update({ ended_at: endedAt.toISOString(), duration_sec: durationSec })
          .eq('id', existing.id);

        sessionId = existing.id;
        console.log(`[Geofence] Updated existing session to ${Math.round(durationSec / 60)}min.`);
      } else {
        console.error('[Geofence] Failed to create session:', sessionError);
        return { outcome: 'error' };
      }
    } else {
      if (!session) return { outcome: 'error' };
      sessionId = session.id;
    }

    const { data: claimData, error: claimError } = await supabase.functions.invoke('claim-points', {
      body: { session_id: sessionId },
    });

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
      const { data: streakRow } = await supabase
        .from('user_streaks')
        .select('current_streak')
        .eq('user_id', user.id)
        .maybeSingle();
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
    _recordingInFlight.delete(lockKey);
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
  if (!queue.length) return;

  const remaining: StoredGeofence[] = [];
  for (const entry of queue) {
    // Drop entries too old to be meaningful (also avoids odd tier math).
    if (entry.endedAtMs && Date.now() - entry.endedAtMs > PENDING_CLAIM_MAX_AGE_MS) {
      console.log('[Geofence] Dropping stale pending claim (>24h).');
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('activity_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'gym')
      .eq('verification', 'geofence')
      .gte('started_at', today.toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ?? undefined;
  } catch {
    return undefined;
  }
}

async function upgradeGymTier(sessionId: string, partnerName?: string, visitId?: string): Promise<boolean> {
  try {
    // Use the cached session (getSession) rather than a forced refreshSession(): a
    // forced rotation here races the background/foreground GoTrue instances and can
    // revoke the session family. getSession() refreshes under the client's lock only
    // if the token is actually expired.
    const { data: { session: authSession }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !authSession) {
      console.warn('[Geofence] Tier upgrade: no valid session — will retry on next poll.', sessionError?.message);
      return false;
    }
    const { data: upgradeData, error: fnError } = await supabase.functions.invoke('upgrade-gym-tier', {
      body: { session_id: sessionId },
      headers: { Authorization: `Bearer ${authSession.access_token}` },
    });
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
    const { count } = await supabase
      .from('activity_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('type', 'gym')
      .eq('verification', 'geofence')
      .gte('started_at', today.toISOString());
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Writes active-geofence state and fires the "You're in" notification for a
 *  newly-entered circle. No-ops if a session is already active or a gym was
 *  already logged today. `regionId` is the composite UI key so the notification
 *  cooldown dedups against the native ENTER path for the same gym. */
async function setActiveAndNotify(regionId: string, entry: PartnerMapEntry): Promise<void> {
  if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) return;
  if (await gymAlreadyLoggedToday()) return;
  const entryTimestamp = Date.now();
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
  try {
    const { openGymVisit } = await import('@/lib/gymVisits');
    const visitId = await openGymVisit(entry.dbId, regionId, entryTimestamp);
    if (visitId) {
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      const active = raw ? JSON.parse(raw) as StoredGeofence : null;
      // Only stamp the visit onto the session we just opened — never a later one.
      if (active && active.entryTimestamp === entryTimestamp) {
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, visitId }));
      }
    }
  } catch (err) {
    console.warn('[Geofence] Visit beacon failed to open:', err);
  }

  try {
    const { notifyCheckInAvailable } = await import('@/lib/notifications');
    await notifyCheckInAvailable(entry.name, regionId);
  } catch { /* non-fatal */ }
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
      // Retry on exit; if it still fails, queue it so it's never lost.
      console.log('[Geofence] Exit: recorded session has no sessionId — retrying on exit.');
      const { outcome } = await recordDwellSession(claimEntry);
      if (outcome === 'error') await enqueuePendingClaim(claimEntry);
    }
    return 'resolved';
  }

  const dwellMs = exitMs - activeGeofence.entryTimestamp;
  if (dwellMs < minDwellMs()) {
    console.log(`[Geofence] Dwell ${Math.round(dwellMs / 60000)}min < threshold — no points.`);
    return 'resolved';
  }

  const { outcome: exitOutcome } = await recordDwellSession(claimEntry);
  if (exitOutcome === 'error' || exitOutcome === 'in_flight') {
    // The durable exit record stays queued until a transient failure or a
    // concurrent claim has conclusively resolved, so neither can lose a valid
    // session between separate foreground/headless JS contexts.
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
export async function finalizeActiveGeofence(expectedRegionId?: string): Promise<boolean> {
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

  const endedAtMs = Date.now();
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
export async function runVisitCheck(stage: 'dwell' | 'upgrade'): Promise<void> {
  await primeGymDwellMinutes();

  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  const active: StoredGeofence | null = raw ? JSON.parse(raw) : null;
  if (!active) {
    console.log('[Geofence] Visit check: no active session — ignoring.');
    return;
  }

  let coords: Location.LocationObjectCoords | null = null;
  try {
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    coords = fix?.coords ?? null;
  } catch (err) {
    console.warn('[Geofence] Visit check: could not get a fix:', err);
  }

  // No fix = no proof = no credit. Leave the visit open; the server will nudge
  // again, and failing that the exit path still resolves it.
  if (!coords) {
    if (active.visitId) {
      const { confirmGymVisit } = await import('@/lib/gymVisits');
      await confirmGymVisit(active.visitId, false, { stage, reason: 'no_fix' });
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

  if (active.visitId) {
    const { confirmGymVisit } = await import('@/lib/gymVisits');
    await confirmGymVisit(active.visitId, inside, {
      stage,
      distance_m: distance != null ? Math.round(distance) : null,
      accuracy_m: coords.accuracy != null ? Math.round(coords.accuracy) : null,
    });
  }

  if (inside) {
    console.log(`[Geofence] Visit check (${stage}): still inside — advancing dwell.`);
    await advanceActiveSession(active);
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
async function advanceActiveSession(active: StoredGeofence): Promise<void> {
  const elapsed = Date.now() - active.entryTimestamp;

  // 1. Prior claim was too short / failed — retry once the prod threshold is met.
  if (active.sessionRecorded && active.pointsPending) {
    if (elapsed < prodDwellMs()) return;
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, pointsPending: false }));
    const { outcome, sessionId } = await recordDwellSession(active);
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

  if (active.sessionRecorded) return;

  // 3. Initial claim once the dwell threshold is met.
  if (elapsed < minDwellMs()) return;
  await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true }));
  const { outcome, sessionId } = await recordDwellSession(active);
  if (outcome === 'claimed' && sessionId) {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true, sessionId }));
  } else if (outcome === 'too_short' || outcome === 'error') {
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
    await advanceActiveSession(active);
    return;
  }

  if (isCoarse) return; // ENTER detection needs a trusted position.

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
    const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
    await armNativeRegions(
      lastKnown ? { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude } : null,
      { force: true },
    );
  }

  if (Platform.OS === 'android') {
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false))) {
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, LOCATION_UPDATE_OPTIONS);
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
  if (!locations || locations.length === 0) return;
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
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Native geofence (fast, low-power ENTER/EXIT trigger when the OS delivers it).
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[Geofence] Task error:', error);
    return;
  }

  // Headless context: load the last-persisted admin dwell threshold from storage
  // so exit-time dwell checks use the current value.
  await primeGymDwellMinutes();
  await flushPendingClaims();

  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };

  const regionId = region.identifier ?? '';

  // Sentinel crossings re-target coverage; they are never partner check-ins.
  // Guard BEFORE any session state is touched — a sentinel EXIT can coincide
  // with an active gym session and must not clear or claim it.
  if (regionId === SENTINEL_REGION_ID) {
    if (eventType === Location.GeofencingEventType.Exit) {
      // The user left the armed envelope (iOS relaunches a terminated app for
      // exactly this). Re-arm around wherever they are now. The OS just
      // computed a fix to detect the crossing, so last-known is fresh.
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
      const fix = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null);
      if (fix) {
        await armNativeRegions({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
      }
    }
    return;
  }

  if (eventType === Location.GeofencingEventType.Enter) {
    // Don't overwrite an already-active session.
    if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) {
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

  } else if (eventType === Location.GeofencingEventType.Exit) {
    // Left the approach ring — return the stream to baseline whether or not a
    // session was active (also covers "walked up but never checked in"). A
    // neighboring approach-ring exit must not stop tracking an active gym.
    await exitApproach(regionId);
    await finalizeActiveGeofence(regionId);
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
      // headless detectors' world view) no older than the TTL while the app
      // is in use. Fire-and-forget — never blocks the UI list.
      try {
        const metaRaw = await AsyncStorage.getItem(PARTNER_MAP_META_KEY);
        const fetchedAt = metaRaw ? ((JSON.parse(metaRaw) as PartnerMapMeta).fetchedAt ?? 0) : 0;
        if (Date.now() - fetchedAt > PARTNER_CACHE_TTL_MS) {
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
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, pointsPending: false }));
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
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, pointsPending: false }));
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
        console.log('[Geofence] Foreground: already past 40-min mark — upgrading tier now.');
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
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true }));
      const { outcome, sessionId } = await recordDwellSession(activeGeofence);
      if (outcome === 'too_short' || outcome === 'error') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path,
        //            and durably queue so a logout/app-kill before EXIT can't lose the claim.
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
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true }));
      const { outcome, sessionId } = await recordDwellSession(gf);
      if (outcome === 'too_short' || outcome === 'error') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path,
        //            and durably queue so a logout/app-kill before EXIT can't lose the claim.
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
        if (Object.keys(fallbackMap).length) await writePartnerMap(fallbackMap);
      }

      // Arm the nearest partner circles + travel sentinel around a fresh fix.
      const userPos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null);
      await armNativeRegions(
        userPos ? { latitude: userPos.coords.latitude, longitude: userPos.coords.longitude } : null,
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
            await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, LOCATION_UPDATE_OPTIONS);
            console.log('[Geofence] Foreground-service location stream started.');
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
