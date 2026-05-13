import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

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

    const pos = await Location.getLastKnownPositionAsync().catch(() => null)
      ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null);

    if (!pos) return parsed;

    const distance = haversineMetres(
      pos.coords.latitude,
      pos.coords.longitude,
      parsed.latitude,
      parsed.longitude,
    );

    // Use a 100 m GPS-accuracy buffer — raw positions from getLastKnownPositionAsync
    // or Low-accuracy mode can be off by 50–200 m, so a small radius + 10 m would
    // clear the active session prematurely due to normal GPS drift.
    if (distance > parsed.radius + 100) {
      await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
      return null;
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
