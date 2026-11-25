import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { finalizeActiveGeofence, finalizeSessionIfOverdue } from '@/context/GeofenceContext';
import { homeExitStep, type OutsideStreak } from '@/lib/health/gymPresence';
import { haversineMetres } from '@/lib/geofence/zone';

const ACTIVE_GEOFENCE_KEY    = '@powr/active_geofence';
const SESSION_COMPLETED_KEY  = '@powr/session_completed';
const POLL_INTERVAL_MS       = 5000;
const MAX_SESSION_MS         = 12 * 60 * 60 * 1000; // auto-expire sessions older than 12 h

export interface ActiveGeofence {
  partnerId:      string;
  partnerName:    string;
  regionId?:      string;
  entryTimestamp: number;
  latitude?:      number;
  longitude?:     number;
  radius?:        number;
  sessionRecorded?: boolean;
  pointsPending?:   boolean;
  tierUpgraded?:    boolean;
  visitId?:         string;
}

export interface SessionCompletedEvent {
  partnerName: string;
  durationSec: number;
  timestamp:   number;
}

// ─── The foreground departure check ──────────────────────────────────────────
//
// ⚠ THIS USED TO END A LIVE VISIT ON ONE READING, AT radius + the fix's own
// accuracy — with a sharp fix, 35-40 m from the pin. The engine itself needs a
// reading past radius + 50 m, corroborated, and never inside the first three
// minutes (lib/health/gymPresence locationExitVerdict). So the tightest exit rule
// in the whole system ran every 5 seconds, only while the member was looking at
// the app, and wrote no trace when it fired.
//
// Field 2026-11-16: a continuous 52-minute session was recorded as 24 + 15½
// minutes, neither half reaching the 30-minute threshold — no check-in, no gym
// credit. 30 days to 11-25: nine paid visits ended within two minutes of the
// 30-minute mark, eight at one venue whose members stand 29-39 m from a 30 m pin,
// six with the app open, and none of them reached the 40-minute bonus. Opening
// the app from the "session recorded" push was enough to end the visit.
//
// The check stays, because it is the one thing that clears a stale local session
// when the app is opened well away from the venue. But it now uses the SAME bound
// as every other departure test, honours the same grace, and needs two DIFFERENT
// fixes spanning HOME_EXIT_MIN_SPAN_MS (lib/health/gymPresence homeExitStep) — and
// it writes a row both when it starts counting and when it closes.

// Module state, not per-hook: the hook is mounted on Home, Discover and three
// sheets at once, and five independent counters would each take their own GPS
// read and reach their own verdict.
let _streak: OutsideStreak | null = null;
let _checking = false;

export function resetHomeExitStateForTests(): void {
  _streak = null;
  _checking = false;
}

function logExit(parsed: ActiveGeofence, detail: Record<string, unknown>): void {
  void import('@/lib/gymVisits')
    .then(({ logGeofenceRegionEvent }) =>
      logGeofenceRegionEvent(parsed.regionId ?? 'home_poll', 'location_exit', { via: 'home_poll', ...detail }))
    .catch(() => { /* telemetry never costs the check */ });
}

export function useActiveGeofence(): {
  activeGeofence:       ActiveGeofence | null;
  sessionCompleted:     SessionCompletedEvent | null;
  clearSessionCompleted: () => Promise<void>;
} {
  const [activeGeofence,   setActiveGeofence]   = useState<ActiveGeofence | null>(null);
  const [sessionCompleted, setSessionCompleted] = useState<SessionCompletedEvent | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function clearIfOutside(parsed: ActiveGeofence): Promise<ActiveGeofence | null> {
    if (
      parsed.latitude == null ||
      parsed.longitude == null ||
      parsed.radius == null ||
      !Number.isFinite(parsed.latitude) ||
      !Number.isFinite(parsed.longitude) ||
      !Number.isFinite(parsed.radius)
    ) {
      return parsed;
    }
    // One reader at a time across every mounted copy of this hook.
    if (_checking) return parsed;
    _checking = true;
    try {
      // Only reuse a last-known position if it is fresh (< 15 s old) AND
      // the reported horizontal accuracy is within 20 m. Cached positions from
      // Wi-Fi/cell triangulation can be 200–1000 m off.
      const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
      const lastKnownAge = lastKnown ? Date.now() - lastKnown.timestamp : Infinity;
      const lastKnownAccurate = lastKnown != null
        && lastKnownAge < 15_000
        && lastKnown.coords.accuracy != null
        && lastKnown.coords.accuracy <= 20;

      const pos = lastKnownAccurate
        ? lastKnown
        : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 8_000 }).catch(() => null);

      // No position, or one too vague to place anybody: keep the session. A
      // departure is never inferred from not knowing.
      if (!pos || pos.coords.accuracy == null || pos.coords.accuracy > 100) return parsed;

      const now = Date.now();
      const distance = haversineMetres(pos.coords.latitude, pos.coords.longitude, parsed.latitude, parsed.longitude);
      const before = _streak;
      const step = homeExitStep(_streak, {
        entryTimestamp: parsed.entryTimestamp,
        distanceM:      distance,
        radiusM:        parsed.radius,
        accuracyM:      pos.coords.accuracy,
        fixAtMs:        typeof pos.timestamp === 'number' ? pos.timestamp : now,
        nowMs:          now,
      });
      _streak = step.streak;

      const detail = {
        distance_m:  Math.round(distance),
        bound_m:     Math.round(step.boundM),
        acc_m:       Math.round(pos.coords.accuracy),
        readings:    step.streak?.readings ?? 0,
        visit_age_s: Math.round((now - parsed.entryTimestamp) / 1000),
        visit:       parsed.visitId ?? null,
      };

      if (step.close) {
        logExit(parsed, { verdict: 'exit', ...detail });
        _streak = null;
        // GeofenceProvider owns session finalization. Deleting the key here used
        // to bypass the exit claim and could lose an earned session entirely.
        return (await finalizeActiveGeofence()) ? null : parsed;
      }
      // First outside reading of a run: say so once, so a close is never the
      // only row a departure leaves.
      if (step.streak && (!before || before.entryTimestamp !== step.streak.entryTimestamp)) {
        logExit(parsed, { verdict: 'pending', ...detail });
      }
      return parsed;
    } finally {
      _checking = false;
    }
  }

  async function readStorage() {
    try {
      // Active geofence
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      if (!raw) {
        _streak = null;
        setActiveGeofence(null);
      } else {
        const parsed = JSON.parse(raw);
        const elapsedMs = Date.now() - parsed.entryTimestamp;

        if (elapsedMs > MAX_SESSION_MS) {
          // The engine's own backstop: closes at the last proven-inside moment,
          // claims what the evidence supports and ends the server visit. This
          // used to delete the local key and nothing else, which left the server
          // visit open and any unclaimed session unclaimed.
          const closed = await finalizeSessionIfOverdue(parsed, 'home_poll').catch(() => false);
          setActiveGeofence(closed ? null : parsed);
        } else {
          setActiveGeofence(await clearIfOutside(parsed));
        }
      }

      // Session completed event (written by background task)
      const completedRaw = await AsyncStorage.getItem(SESSION_COMPLETED_KEY);
      if (completedRaw) {
        setSessionCompleted(JSON.parse(completedRaw));
      }
    } catch {
      // Leave state as-is on read failure
    }
  }

  async function clearSessionCompleted() {
    await AsyncStorage.removeItem(SESSION_COMPLETED_KEY);
    setSessionCompleted(null);
  }

  function startPolling() {
    stopPolling();
    intervalRef.current = setInterval(readStorage, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    readStorage();
    startPolling();

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        readStorage();
        startPolling();
      } else {
        stopPolling();
      }
    });

    return () => {
      stopPolling();
      subscription.remove();
    };
  }, []);

  return { activeGeofence, sessionCompleted, clearSessionCompleted };
}
