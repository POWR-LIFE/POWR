import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';

import { ACTIVE_GEOFENCE_KEY } from '@/context/GeofenceContext';

// expo-updates' own launch-time check already downloads new updates for the
// NEXT cold start; this prompt exists so users aren't a launch behind. Checks
// are rate-limited — foregrounding the app every few minutes shouldn't hammer
// the update server.
const CHECK_COOLDOWN_MS = 15 * 60_000;

let lastCheckAt = 0;
let promptedUpdateId: string | null = null;

async function maybePromptForUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return; // Expo Go / dev client
  const now = Date.now();
  if (now - lastCheckAt < CHECK_COOLDOWN_MS) return;
  lastCheckAt = now;

  try {
    // Never offer a restart while a gym visit is in progress — reloadAsync
    // tears down the JS runtime, and with it the foreground dwell/claim flow.
    // The update still lands via the next foreground check or cold start.
    if (await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)) return;

    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;

    const updateId = (check.manifest as { id?: string } | undefined)?.id ?? 'unknown';
    if (promptedUpdateId === updateId) return; // already offered; "Later" means later

    await Updates.fetchUpdateAsync();
    promptedUpdateId = updateId;

    Alert.alert(
      'Update ready',
      'A new version of POWR is ready. Restart now to get the latest improvements?',
      [
        { text: 'Later', style: 'cancel' }, // applies automatically on the next cold start
        { text: 'Restart', onPress: () => Updates.reloadAsync().catch(() => {}) },
      ],
    );
  } catch {
    // Offline / update server hiccup — routine; the cold-start check covers it.
  }
}

/**
 * Mount once at the app root: offers a restart when an OTA update is ready,
 * checking at launch and whenever the app returns to the foreground.
 */
export function useOtaUpdatePrompt(): void {
  useEffect(() => {
    maybePromptForUpdate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybePromptForUpdate();
    });
    return () => sub.remove();
  }, []);
}
