import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { finalizeActiveGeofence } from '@/context/GeofenceContext';

const ACTIVE_GEOFENCE_KEY    = '@powr/active_geofence';
const SESSION_COMPLETED_KEY  = '@powr/session_completed';
const POLL_INTERVAL_MS       = 5000;
const MAX_SESSION_MS         = 12 * 60 * 60 * 1000; // auto-expire sessions older than 12 h

export interface ActiveGeofence {
  partnerId:      string;
  partnerName:    string;
  entryTimestamp: number;
  latitude?:      number;
  longitude?:     number;
  radius?:        number;
  sessionRecorded?: boolean;
  pointsPending?:   boolean;
  tierUpgraded?:    boolean;
}

export interface SessionCompletedEvent {
  partnerName: string;
  durationSec: number;
  timestamp:   number;
}

export function useActiveGeofence(): {
  activeGeofence:       ActiveGeofence | null;
  sessionCompleted:     SessionCompletedEvent | null;
  clearSessionCompleted: () => Promise<void>;
} {
  const [activeGeofence,   setActiveGeofence]   = useState<ActiveGeofence | null>(null);
  const [sessionCompleted, setSessionCompleted] = useState<SessionCompletedEvent | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

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

    // Only reuse a last-known position if it is fresh (< 15 s old) AND
    // the reported horizontal accuracy is within 20 m. Cached positions from
    // Wi-Fi/cell triangulation can be 200–1000 m off and will falsely keep
    // the session alive after the user has left a 100 m geofence.
    // High accuracy forces the GPS chip (≈ 5–15 m on Android/iOS).
    const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
    const lastKnownAge = lastKnown ? Date.now() - lastKnown.timestamp : Infinity;
    const lastKnownAccurate = lastKnown != null
      && lastKnownAge < 15_000
      && lastKnown.coords.accuracy != null
      && lastKnown.coords.accuracy <= 20;

    if (lastKnown) {
      console.log(
        `[Geofence:clearIfOutside] last-known age=${Math.round(lastKnownAge / 1000)}s` +
        ` accuracy=${lastKnown.coords.accuracy?.toFixed(0) ?? 'null'}m` +
        ` → ${lastKnownAccurate ? 'USING cached' : 'REQUESTING fresh GPS'}`,
      );
    } else {
      console.log('[Geofence:clearIfOutside] no last-known position → REQUESTING fresh GPS');
    }

    const pos = lastKnownAccurate
      ? lastKnown
      : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 8_000 }).catch(() => null);

    if (!pos) {
      console.warn('[Geofence:clearIfOutside] could not obtain a position — keeping session active');
      return parsed;
    }

    const distance = haversineMetres(
      pos.coords.latitude,
      pos.coords.longitude,
      parsed.latitude,
      parsed.longitude,
    );

    // Buffer = the GPS fix's own reported accuracy, floored at 10 m.
    // This makes the threshold as tight as the hardware allows: a 12 m fix
    // gives a 12 m buffer, a 66 m fix gives a 66 m buffer — never a blanket 50 m.
    const accuracyBuffer = pos.coords.accuracy != null ? Math.ceil(pos.coords.accuracy) : 50;
    const threshold = parsed.radius + accuracyBuffer;
    console.log(
      `[Geofence:clearIfOutside] "${parsed.partnerName}"` +
      ` | posAccuracy=${pos.coords.accuracy?.toFixed(0) ?? '?'}m` +
      ` | distance=${distance.toFixed(0)}m` +
      ` | radius=${parsed.radius}m` +
      ` | buffer=${accuracyBuffer}m` +
      ` | threshold=${threshold}m` +
      ` | ${distance > threshold ? '⚠️ OUTSIDE → clearing session' : '✅ inside'}`,
    );

    if (distance > threshold) {
      // GeofenceProvider owns session finalization. Deleting the key here used
      // to bypass the exit claim and could lose an earned session entirely.
      return (await finalizeActiveGeofence()) ? null : parsed;
    }

    return parsed;
  }

  async function readStorage() {
    try {
      // Active geofence
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      if (!raw) {
        setActiveGeofence(null);
      } else {
        const parsed = JSON.parse(raw);
        const elapsedMs = Date.now() - parsed.entryTimestamp;

        if (elapsedMs > MAX_SESSION_MS) {
          await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
          setActiveGeofence(null);
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
