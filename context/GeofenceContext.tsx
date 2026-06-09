import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

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
const ACTIVE_GEOFENCE_KEY    = '@powr/active_geofence';
const PARTNER_MAP_KEY        = '@powr/partner_map';
const SESSION_COMPLETED_KEY  = '@powr/session_completed';
const PENDING_CLAIMS_KEY     = '@powr/pending_claims';

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
const MIN_DWELL_MS    = __DEV__ ? 30 * 1000 : 30 * 60 * 1000;
const UPGRADE_MS      = __DEV__ ? 60 * 1000 : 40 * 60 * 1000; // 1 min in dev, 40 min in prod
// Production eligibility minimum — used for pointsPending retry regardless of MIN_DWELL_MS
const PROD_DWELL_MS   = 30 * 60 * 1000;
const PROD_UPGRADE_MS = 40 * 60 * 1000;
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
    const { data: { session: authSession }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !authSession?.user) {
      console.error('[Geofence] Token refresh failed — cannot record session:', refreshError?.message ?? 'no session');
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

async function enqueuePendingClaim(entry: StoredGeofence): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CLAIMS_KEY);
    const queue: StoredGeofence[] = raw ? JSON.parse(raw) : [];
    const dupe = queue.some(
      q => q.entryTimestamp === entry.entryTimestamp && q.partnerId === entry.partnerId,
    );
    if (!dupe) {
      queue.push(entry);
      await AsyncStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(queue));
      console.log('[Geofence] Queued failed claim for retry.');
    }
  } catch (err) {
    console.warn('[Geofence] enqueuePendingClaim failed:', err);
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

async function upgradeGymTier(sessionId: string): Promise<boolean> {
  try {
    // Refresh token before calling — session may be 45+ min old
    const { data: { session: authSession }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !authSession) {
      console.warn('[Geofence] Tier upgrade: token refresh failed — will retry on next poll.', refreshError?.message);
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
  await AsyncStorage.setItem(
    ACTIVE_GEOFENCE_KEY,
    JSON.stringify({
      partnerId:      entry.dbId,
      partnerName:    entry.name,
      entryTimestamp: Date.now(),
      latitude:       entry.lat,
      longitude:      entry.lng,
      radius:         entry.radius,
    }),
  );
  console.log(`[Geofence] Location task: entered "${entry.name}".`);
  try {
    const { notifyCheckInAvailable } = await import('@/lib/notifications');
    await notifyCheckInAvailable(entry.name, regionId);
  } catch { /* non-fatal */ }
}

/** Runs the exit claim/upgrade path for a session that has just ended. The caller
 *  must clear ACTIVE_GEOFENCE_KEY first. Shared by the native geofence EXIT and
 *  the location-task EXIT. The exit time is frozen so a retry that runs later
 *  still records the true session length rather than an ever-growing one. */
async function recordExitAndClaim(activeGeofence: StoredGeofence): Promise<void> {
  const exitMs = Date.now();
  const claimEntry: StoredGeofence = { ...activeGeofence, endedAtMs: exitMs };

  // Session already recorded AND claimed (e.g. by the foreground/location dwell path).
  if (activeGeofence.sessionRecorded && !activeGeofence.pointsPending) {
    const dwellMs = exitMs - activeGeofence.entryTimestamp;
    if (dwellMs >= PROD_UPGRADE_MS && !activeGeofence.tierUpgraded) {
      // Crossed the 40-min tier. Use the stored sessionId, or recover it from the
      // DB if it was lost — the upgrade is the user's bonus and must not depend on
      // fragile local state. upgradeGymTier is idempotent, so re-calling is safe.
      const sid = activeGeofence.sessionId ?? await resolveTodayGymSessionId();
      if (sid) {
        console.log('[Geofence] Exit: session crossed 40-min tier — upgrading.');
        await upgradeGymTier(sid);
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
    return;
  }

  const dwellMs = exitMs - activeGeofence.entryTimestamp;
  if (dwellMs < MIN_DWELL_MS) {
    console.log(`[Geofence] Dwell ${Math.round(dwellMs / 60000)}min < threshold — no points.`);
    return;
  }

  const { outcome: exitOutcome } = await recordDwellSession(claimEntry);
  if (exitOutcome === 'error') {
    // Transient failure (offline, token refresh) — queue for retry so a
    // genuinely-earned session is never silently lost. The retry eventually
    // claims and the server-side session_completed push delivers then.
    console.log('[Geofence] Exit claim failed — queued for retry.');
    await enqueuePendingClaim(claimEntry);
  }
  // 'claimed' → claim-points fires the single "Session recorded" push (source of
  // truth). 'too_short' cannot normally occur here (dwell >= MIN_DWELL_MS).
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
    if (elapsed < PROD_DWELL_MS) return;
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, pointsPending: false }));
    const { outcome, sessionId } = await recordDwellSession(active);
    if (outcome === 'claimed' && sessionId) {
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, pointsPending: false, sessionId }));
    } else {
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, pointsPending: true }));
    }
    return;
  }

  // 2. Claimed at the 30-min tier — upgrade once the 40-min threshold is met.
  if (active.sessionRecorded && active.sessionId && !active.tierUpgraded) {
    if (elapsed < PROD_UPGRADE_MS) return;
    const ok = await upgradeGymTier(active.sessionId);
    if (ok) await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, tierUpgraded: true }));
    return;
  }

  if (active.sessionRecorded) return;

  // 3. Initial claim once the dwell threshold is met.
  if (elapsed < MIN_DWELL_MS) return;
  await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true }));
  const { outcome, sessionId } = await recordDwellSession(active);
  if (outcome === 'claimed' && sessionId) {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true, sessionId }));
  } else if (outcome === 'too_short' || outcome === 'error') {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...active, sessionRecorded: true, pointsPending: true }));
  }
}

/** Core of the foreground-service location task. Given a GPS fix, drives ENTER,
 *  dwell, and EXIT against the cached partner circles + active-session state. Runs
 *  headless (separate JS context) when the app is closed, so it reads everything
 *  from AsyncStorage and never touches React. */
async function evaluateLocationFix(coords: Location.LocationObjectCoords): Promise<void> {
  // Reject coarse fixes — a low-accuracy position can't be trusted against a tight
  // radius and would otherwise fire a false "You're in" from far away.
  if (coords.accuracy != null && coords.accuracy > MAX_FIX_ACCURACY_M) return;

  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  const active: StoredGeofence | null = raw ? JSON.parse(raw) : null;

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
      await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
      await recordExitAndClaim(active);
    }
    return;
  }

  // No active session — look for an ENTER against the cached circles.
  const mapJson = await AsyncStorage.getItem(PARTNER_MAP_KEY);
  if (!mapJson) return;
  let partnerMap: Record<string, PartnerMapEntry>;
  try { partnerMap = JSON.parse(mapJson); } catch { return; }

  for (const [regionId, entry] of Object.entries(partnerMap)) {
    if (entry.lat == null || entry.lng == null) continue;
    const dist = haversineMetres(coords.latitude, coords.longitude, entry.lat, entry.lng);
    // Exact partner radius — no accuracy buffer added, so a 25 m circle means 25 m.
    if (dist <= (entry.radius ?? 100)) {
      await setActiveAndNotify(regionId, entry);
      return;
    }
  }
}

/** Re-registers native geofencing + the location stream from the cached partner
 *  circles. Network-free, so it can run on boot. No-op without background permission. */
async function rearmGeofencingFromCache(): Promise<void> {
  const mapJson = await AsyncStorage.getItem(PARTNER_MAP_KEY);
  if (!mapJson) return;
  let partnerMap: Record<string, PartnerMapEntry>;
  try { partnerMap = JSON.parse(mapJson); } catch { return; }

  const { status } = await Location.getBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as Location.PermissionStatus }));
  if (status !== 'granted') return;

  const MAX_REGIONS = Platform.OS === 'ios' ? 20 : 50;
  const regions: Location.LocationRegion[] = Object.entries(partnerMap)
    .filter(([, e]) => e.lat != null && e.lng != null)
    .slice(0, MAX_REGIONS)
    .map(([id, e]) => ({
      identifier:    id,
      latitude:      e.lat!,
      longitude:     e.lng!,
      radius:        e.radius ?? 100,
      notifyOnEnter: true,
      notifyOnExit:  true,
    }));
  if (regions.length === 0) return;

  try {
    if (!(await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false))) {
      await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
    }
  } catch (err) {
    console.warn('[Geofence] Boot re-arm geofencing failed:', err);
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
    await evaluateLocationFix(locations[locations.length - 1].coords);
  } catch (err) {
    console.warn('[Geofence] evaluateLocationFix failed:', err);
  }
});

// Boot re-arm: re-issues monitoring from cached circles after a device restart.
TaskManager.defineTask(GEOFENCE_REARM_TASK, async () => {
  try {
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

  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };

  if (eventType === Location.GeofencingEventType.Enter) {
    // Don't overwrite an already-active session
    const existingRaw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    if (existingRaw) {
      console.log('[Geofence] Enter ignored — session already active.');
      return;
    }

    const regionId = region.identifier ?? '';
    const mapJson = await AsyncStorage.getItem(PARTNER_MAP_KEY);
    const partnerMap: Record<string, PartnerMapEntry> = mapJson ? JSON.parse(mapJson) : {};
    const mapEntry = partnerMap[regionId];
    const partnerName = mapEntry?.name ?? regionId;
    // Use the raw DB UUID — regionId is the composite "uuid-idx" UI key which is not a valid UUID
    const dbPartnerId = mapEntry?.dbId ?? regionId;

    // Write entry state and fire the notification BEFORE any network I/O.
    // iOS background tasks have a tight execution window; network calls can be killed
    // before the notification is reached if they run first.
    await AsyncStorage.setItem(
      ACTIVE_GEOFENCE_KEY,
      JSON.stringify({
        partnerId:      dbPartnerId,
        partnerName,
        entryTimestamp: Date.now(),
        latitude:       region.latitude,
        longitude:      region.longitude,
        radius:         region.radius,
      })
    );
    console.log(`[Geofence] Entered "${partnerName}"`);

    try {
      const { notifyCheckInAvailable } = await import('@/lib/notifications');
      await notifyCheckInAvailable(partnerName, regionId);
    } catch (err) {
      console.warn('[Geofence] Entry notification failed:', err);
    }

    // One gym session per day — check AFTER writing active state + firing notification.
    // If already logged today, clean up the state we just set (best-effort: the
    // entry notification may already have been delivered, which is acceptable).
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !DEV_TEST_EMAILS.has(user.email ?? '')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from('activity_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('type', 'gym')
          .eq('verification', 'geofence')
          .gte('started_at', today.toISOString());
        if ((count ?? 0) > 0) {
          console.log('[Geofence] Gym session already logged today — clearing active state.');
          await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
          return;
        }
      }
    } catch {
      // Non-fatal — active state already written, proceed
    }

  } else if (eventType === Location.GeofencingEventType.Exit) {
    const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    const activeGeofence: StoredGeofence | null = raw ? JSON.parse(raw) : null;

    await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);

    if (!activeGeofence) return;

    // All exit claim/upgrade logic is shared with the location-task EXIT path.
    await recordExitAndClaim(activeGeofence);
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
  refresh: () => Promise<void>;
}

const GeofenceContext = createContext<GeofenceContextValue>({
  partners: [],
  isMonitoring: false,
  loading: true,
  refresh: async () => {},
});

export function GeofenceProvider({ children }: { children: React.ReactNode }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const fingerprintRef = useRef('');
  const dwellTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnersRef        = useRef<Partner[]>([]);
  const lastInsideCheckRef = useRef<number>(0);
  const lastFlushRef       = useRef<number>(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Get last-known position quickly (no GPS warmup) to filter partners by proximity.
      // Falls back to fetching all active partners if location is unavailable.
      let data: any[] | null = null;

      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      if (pos) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('nearby_partners', {
          user_lat:   pos.coords.latitude,
          user_lng:   pos.coords.longitude,
          radius_deg: 0.15, // ~15 km bounding box
        });
        if (!rpcError) data = rpcData;
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

      setPartners(formatPartnerRows(data));
    } finally {
      setLoading(false);
    }
  }, []);

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
      const now = Date.now();
      if (now - lastInsideCheckRef.current >= 30_000 && partnersRef.current.length > 0) {
        lastInsideCheckRef.current = now;
        try {
          // Cheap checks first: last-known position (cached — no GPS wake-up) and
          // an in-memory proximity scan. Only touch the network/DB once we're
          // actually inside a partner radius, so we don't run a Supabase query
          // every 30 s for the (overwhelmingly common) case of not being at a gym.
          const loc = await Location.getLastKnownPositionAsync().catch(() => null);
          // Ignore coarse fixes — a low-accuracy position can't be trusted against a
          // tight radius and would otherwise match a gym from far away.
          if (loc && (loc.coords.accuracy == null || loc.coords.accuracy <= MAX_FIX_ACCURACY_M)) {
            // Exact partner radius — no accuracy buffer added.
            const insidePartner = partnersRef.current.find(p =>
              haversineMetres(loc.coords.latitude, loc.coords.longitude, p.lat, p.lng)
                <= p.geofenceRadius,
            );

            if (insidePartner && !(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))) {
              // Inside a geofence with no active session — confirm a gym session
              // wasn't already logged today before opening one. getSession() reads
              // the cached token locally (no network round-trip).
              let gymLoggedToday = false;
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (user && !DEV_TEST_EMAILS.has(user.email ?? '')) {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const { count } = await supabase
                    .from('activity_sessions')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', user.id)
                    .eq('type', 'gym')
                    .eq('verification', 'geofence')
                    .gte('started_at', today.toISOString());
                  gymLoggedToday = (count ?? 0) > 0;
                }
              } catch { /* non-fatal */ }

              if (!gymLoggedToday) {
                await AsyncStorage.setItem(
                  ACTIVE_GEOFENCE_KEY,
                  JSON.stringify({
                    partnerId:      insidePartner.dbId,
                    partnerName:    insidePartner.name,
                    entryTimestamp: Date.now(),
                    latitude:       insidePartner.lat,
                    longitude:      insidePartner.lng,
                    radius:         insidePartner.geofenceRadius,
                  }),
                );
                console.log(`[Geofence] Periodic scan: inside "${insidePartner.name}" — active state set.`);
                try {
                  const { notifyCheckInAvailable } = await import('@/lib/notifications');
                  await notifyCheckInAvailable(insidePartner.name, insidePartner.id);
                } catch { /* non-fatal */ }
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
      const remaining  = PROD_DWELL_MS - elapsed;
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
      const remaining = UPGRADE_MS - elapsed;
      if (remaining <= 0) {
        console.log('[Geofence] Foreground: already past 40-min mark — upgrading tier now.');
        const upgraded1 = await upgradeGymTier(activeGeofence.sessionId);
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
          const upgraded2 = await upgradeGymTier(gf.sessionId);
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
    const remaining = (MIN_DWELL_MS + 5_000) - elapsed;

    if (remaining <= 0) {
      console.log('[Geofence] Foreground: dwell already met — recording session now.');
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true }));
      const { outcome, sessionId } = await recordDwellSession(activeGeofence);
      if (outcome === 'too_short' || outcome === 'error') {
        // too_short: claim rejected because duration < eligibility minimum — retry at PROD_DWELL_MS.
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path.
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...activeGeofence, sessionRecorded: true, pointsPending: true }));
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
        // error:     transient failure (network, auth, rate-limit, etc.) — retry via the same path.
        await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...gf, sessionRecorded: true, pointsPending: true }));
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

  // Keep partnersRef in sync so scheduleDwellTimer can access partners without
  // needing partners as a dependency (which would restart the poll interval).
  useEffect(() => { partnersRef.current = partners; }, [partners]);

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
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return;

      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') {
        console.warn('[Geofence] Background location permission denied — geofencing inactive.');
        return;
      }

      // Persist full geometry (not just name/dbId) so the headless location task
      // can compute proximity from cache with no React state or network fetch.
      const partnerMap: Record<string, PartnerMapEntry> = {};
      partners.forEach(p => {
        partnerMap[p.id] = { name: p.name, dbId: p.dbId, lat: p.lat, lng: p.lng, radius: p.geofenceRadius };
      });
      await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify(partnerMap));

      // iOS allows max 20 geofence regions; Android allows 100.
      // iOS hard-limits to 20 monitored regions; Android allows 100.
      // Sort by proximity so the nearest partners are always included.
      const MAX_REGIONS = Platform.OS === 'ios' ? 20 : 50;
      const userPos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null);
      const nearby = [...partners]
        .sort((a, b) => userPos
          ? haversineMetres(userPos.coords.latitude, userPos.coords.longitude, a.lat, a.lng) -
            haversineMetres(userPos.coords.latitude, userPos.coords.longitude, b.lat, b.lng)
          : 0
        )
        .slice(0, MAX_REGIONS);

      const regions: Location.LocationRegion[] = nearby.map(p => ({
        identifier:    p.id,
        latitude:      p.lat,
        longitude:     p.lng,
        radius:        p.geofenceRadius,
        notifyOnEnter: true,
        notifyOnExit:  true,
      }));

      try {
        // To avoid internal sync issues in Expo Go, we check if the task is already registered.
        // If it is, we stop it first to ensure we're starting with a fresh set of regions.
        const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME);
        if (isRegistered) {
          await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
        }
      } catch {
        // If unregistration fails (e.g. because of TaskNotFoundException), we can safely ignore it
        // and proceed to (re)start the geofencing.
      }

      try {
        await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
        setIsMonitoring(true);
        console.log(`[Geofence] Monitoring ${regions.length} location(s).`);
      } catch (err) {
        console.error('[Geofence] Failed to start:', err);
      }

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

      // If the user is already inside a geofence when monitoring starts, record it
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
          // Check if a gym session was already logged today before setting active state
          let gymLoggedToday = false;
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user && !DEV_TEST_EMAILS.has(user.email ?? '')) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const { count } = await supabase
                .from('activity_sessions')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('type', 'gym')
                .eq('verification', 'geofence')
                .gte('started_at', today.toISOString());
              gymLoggedToday = (count ?? 0) > 0;
            }
          } catch { /* non-fatal */ }

          for (const partner of partners) {
            const dist = haversineMetres(
              loc.coords.latitude, loc.coords.longitude,
              partner.lat, partner.lng,
            );
            // Exact partner radius — no accuracy buffer added, so a 25 m circle means 25 m.
            if (dist <= partner.geofenceRadius) {
              if (gymLoggedToday) {
                console.log(`[Geofence] Already inside "${partner.name}" but gym session logged today — skipping.`);
              } else {
                const existing = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
                if (!existing) {
                  await AsyncStorage.setItem(
                    ACTIVE_GEOFENCE_KEY,
                    JSON.stringify({
                      partnerId:      partner.dbId,
                      partnerName:    partner.name,
                      entryTimestamp: Date.now(),
                      latitude:       partner.lat,
                      longitude:      partner.lng,
                      radius:         partner.geofenceRadius,
                    }),
                  );
                  console.log(`[Geofence] Already inside "${partner.name}" — active state set.`);
                  try {
                    const { notifyCheckInAvailable } = await import('@/lib/notifications');
                    await notifyCheckInAvailable(partner.name, partner.id);
                  } catch { /* non-fatal */ }
                }
              }
              break;
            }
          }
        }
      } catch { /* non-fatal — geofencing is still active */ }
    }

    startGeofencing();
    // No cleanup: geofencing must survive tab navigation and screen transitions
  }, [partners]);

  return (
    <GeofenceContext.Provider value={{ partners, isMonitoring, loading, refresh }}>
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
