import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'powr_device_id';

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
