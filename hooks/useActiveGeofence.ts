import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const POLL_INTERVAL_MS    = 5000;
const MAX_SESSION_MS      = 12 * 60 * 60 * 1000; // auto-expire sessions older than 12 h

export interface ActiveGeofence {
  partnerId:      string;
  partnerName:    string;
  entryTimestamp: number;
}

export function useActiveGeofence(): { activeGeofence: ActiveGeofence | null } {
  const [activeGeofence, setActiveGeofence] = useState<ActiveGeofence | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function readStorage() {
    try {
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      if (!raw) { setActiveGeofence(null); return; }
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.entryTimestamp > MAX_SESSION_MS) {
        await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
        setActiveGeofence(null);
        return;
      }
      setActiveGeofence(parsed);
    } catch {
      // Leave state as-is on read failure
    }
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

  return { activeGeofence };
}
