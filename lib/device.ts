import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'powr_device_id';

/** Whether the JavaScript bundle is running inside the Expo Go store client. */
export function isExpoGoClient(): boolean {
    return Constants.executionEnvironment === 'storeClient';
}

/**
 * Returns a stable device identifier that persists across app launches.
 *
 * - iOS: uses identifierForVendor (IDFV) — stable per vendor per device,
 *   resets only if ALL apps from the same vendor are uninstalled.
 * - Android: uses androidId — stable for the lifetime of the device
 *   (resets on factory reset).
 *
 * Falls back to a cached UUID in SecureStore if native IDs are unavailable.
 * This is a soft signal for fraud detection, NOT a hard gate.
 */
export async function getDeviceId(): Promise<string> {
    // Try the cached value first (fastest path)
    const cached = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (cached) return cached;

    let deviceId: string | null = null;

    if (Platform.OS === 'ios') {
        deviceId = await Application.getIosIdForVendorAsync();
    } else if (Platform.OS === 'android') {
        deviceId = Application.getAndroidId();
    }

    // Fallback: generate a random ID and persist it
    if (!deviceId) {
        deviceId = crypto.randomUUID();
    }

    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    return deviceId;
}

/**
 * The app version/build this client is running, for backend telemetry
 * (reported with the push-token upsert on every launch).
 *
 * In Expo Go the native binary is Expo Go itself, so its native version is
 * meaningless — report the project version from app config tagged "(Expo Go)"
 * instead, so dev devices are distinguishable in the admin panel.
 *
 * otaUpdateId identifies the JS actually running when it differs from what the
 * binary shipped with: null = the binary's embedded bundle (or dev/Expo Go,
 * where OTA is disabled), an id = that EAS Update. Binary version alone stops
 * identifying the code the moment an OTA update is published.
 */
export function getAppVersion(): {
    appVersion: string | null;
    appBuild: string | null;
    otaUpdateId: string | null;
    otaChannel: string | null;
} {
    const runningOta = Updates.isEnabled && !Updates.isEmbeddedLaunch;
    const ota = {
        otaUpdateId: runningOta ? Updates.updateId : null,
        otaChannel: Updates.isEnabled ? Updates.channel : null,
    };
    if (isExpoGoClient()) {
        return {
            appVersion: `${Constants.expoConfig?.version ?? 'unknown'} (Expo Go)`,
            appBuild: null,
            ...ota,
        };
    }
    return {
        appVersion: Application.nativeApplicationVersion,
        appBuild: Application.nativeBuildVersion,
        ...ota,
    };
}
