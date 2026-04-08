import AsyncStorage from '@react-native-async-storage/async-storage';
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

  async function readStorage() {
    try {
      // Active geofence
      const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
      if (!raw) {
        setActiveGeofence(null);
      } else {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.entryTimestamp > MAX_SESSION_MS) {
          await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
          setActiveGeofence(null);
        } else {
          setActiveGeofence(parsed);
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
