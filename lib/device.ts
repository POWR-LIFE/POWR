import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { readSecure, writeSecure } from '@/lib/secureKeychain';

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
let _deviceIdMemo: string | null = null;

export async function getDeviceId(): Promise<string> {
    if (_deviceIdMemo) return _deviceIdMemo;

    // Android first, and SYNCHRONOUSLY: getAndroidId() needs no storage and no
    // keystore. This path must never await SecureStore — Android Keystore ops
    // from a backgrounded process can block indefinitely, and this function is
    // on the background claim chain (field-caught 2026-07-14: claim attempts
    // hung at the SecureStore read below while the network was healthy).
    // ANDROID_ID is what the SecureStore cache historically held, so the value
    // is unchanged for existing installs.
    if (Platform.OS === 'android') {
        const androidId = Application.getAndroidId();
        if (androidId) {
            _deviceIdMemo = androidId;
            return androidId;
        }
    }

    // iOS (and the rare Android-without-ANDROID_ID): SecureStore survives app
    // reinstalls (iOS keychain), which is exactly why the IDFV is cached there.
    //
    // ⚠ THIS USED TO BE AN UNGUARDED SecureStore CALL PAIR, and it was the same
    // bug as the auth token: written under the default WHEN_UNLOCKED, so both
    // the read and the write threw errSecInteractionNotAllowed on a locked
    // device — with no try/catch, on a path the background claim chain reaches
    // (context/GeofenceContext.tsx's record-session step). Flagged 2026-08-07,
    // fixed 2026-08-17 alongside the auth token it shadowed. readSecure/
    // writeSecure migrate the item to AFTER_FIRST_UNLOCK on the first readable
    // pass; see lib/secureKeychain.ts.
    const cached = await readSecure(DEVICE_ID_KEY);
    if (cached) {
        _deviceIdMemo = cached;
        return cached;
    }

    let deviceId: string | null = null;

    if (Platform.OS === 'ios') {
        deviceId = await Application.getIosIdForVendorAsync();
    }

    // Fallback: generate a random ID and persist it
    if (!deviceId) {
        deviceId = crypto.randomUUID();
    }

    // Best-effort persistence. This is a SOFT fraud signal (see the docstring),
    // never a gate, so an id that could not be cached is strictly better than a
    // rejected promise propagating into a background claim — which is what the
    // unguarded write did before. On iOS the value is the IDFV either way, so a
    // failed write costs nothing but a re-read next launch.
    try {
        await writeSecure(DEVICE_ID_KEY, deviceId);
    } catch (err) {
        console.warn('[device] could not cache the device id — continuing uncached:', err);
    }
    _deviceIdMemo = deviceId;
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
