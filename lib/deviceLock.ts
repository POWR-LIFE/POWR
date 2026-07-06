import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// One-account-per-device lock (client side of claim_device).
//
// A durable per-device identifier is bound to the first account that signs in on
// the device; a second account is refused. We prefer the OS vendor id — it
// survives an uninstall/reinstall, so you can't farm alt accounts by reinstalling
// — and cache it in SecureStore so the id is stable even if the OS getter is
// briefly unavailable. A random fallback (survives logout, not reinstall) keeps
// the lock working on devices where the OS id can't be read.

const DEVICE_ID_KEY = 'powr.device_id.v1';

async function readOsDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      // SSAID — stable per (app signing key, device, user). Synchronous getter.
      const id = Application.getAndroidId();
      return id && id.length > 0 ? `and_${id}` : null;
    }
    if (Platform.OS === 'ios') {
      const idfv = await Application.getIosIdForVendorAsync();
      return idfv && idfv.length > 0 ? `ios_${idfv}` : null;
    }
  } catch {
    // fall through to the stored/random id
  }
  return null;
}

/**
 * A stable identifier for THIS physical device/installation. Cached in
 * SecureStore so it never changes underfoot; seeded from the OS vendor id when
 * available, otherwise a random id.
 */
export async function getDeviceId(): Promise<string> {
  try {
    const cached = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (cached) return cached;
  } catch {
    // SecureStore unavailable — fall back to a per-call OS/random id below.
  }

  const os = await readOsDeviceId();
  const id = os ?? `rnd_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  } catch {
    // Non-fatal: without persistence the id may rotate, but the lock still holds
    // for the current install session.
  }
  return id;
}

export type DeviceClaimStatus = 'ok' | 'locked' | 'unauthenticated';
export interface DeviceClaim {
  status: DeviceClaimStatus;
  bound?: boolean;
  reason?: string;
}

/**
 * Bind this device to the signed-in user, or learn that it's already locked to a
 * different account. Fails OPEN (returns 'ok') on any transient error so a
 * network blip or RPC failure can never lock a user out of their own account.
 */
export async function claimDevice(): Promise<DeviceClaim> {
  try {
    const deviceId = await getDeviceId();
    const { data, error } = await supabase.rpc('claim_device', {
      p_device_id: deviceId,
      p_platform: Platform.OS,
    });
    if (error) {
      console.warn('[deviceLock] claim_device failed:', error.message);
      return { status: 'ok', bound: false, reason: 'rpc_error' };
    }
    return (data ?? { status: 'ok' }) as DeviceClaim;
  } catch (err) {
    console.warn('[deviceLock] claim_device threw:', err);
    return { status: 'ok', bound: false, reason: 'threw' };
  }
}
