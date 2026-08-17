// Keychain access with a WORKING accessibility migration.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// On 2026-08-07 we set `keychainAccessible: AFTER_FIRST_UNLOCK` on the auth
// token and added a "heal existing installs" rewrite, on the reasoning that iOS
// stamps the attribute at WRITE time so already-signed-in devices needed their
// token written once more. The reasoning was right. The rewrite was not:
//
//   expo-secure-store `set()`  (ios/SecureStoreModule.swift)
//     → SecItemAdd
//     → errSecDuplicateItem  →  update()
//                            →  SecItemUpdate(query, [kSecValueData: …])
//
// `kSecAttrAccessible` is not part of a generic-password item's primary key, so
// the add ALWAYS collides for an existing key, and `SecItemUpdate` is handed an
// update dictionary containing the value and nothing else. The item's
// accessibility is never touched. The heal ran, reported success, and changed
// nothing — on every device, every launch, for nine days.
//
// Field cost, measured 2026-08-16: iOS gym visits closing at ZERO seconds
// because every locked-pocket background read threw errSecInteractionNotAllowed
// → `readBackgroundAuth()` null → `ensureFreshSession` refuses to rotate in the
// background → no session row, and `close_gym_visit`'s never-inflate clamp
// (correctly) truncates `ended_at` back to `started_at`. Eight lost workouts
// across five users between 08-13 and 08-17; one of them 33 real minutes
// recorded as 0. Users who happened to open the app mid-visit were unaffected,
// which is exactly why it looked intermittent.
//
// ── THE MIGRATION, AND WHY IT IS SHAPED LIKE THIS ───────────────────────────
//
// The obvious fix is delete-then-add. It works, but it opens a window — however
// short — in which the token exists nowhere, and a crash or a kill inside that
// window signs the user out. Given [[project_background_auth_freshness]]'s
// history of unintended sign-outs, that trade is not worth making.
//
// Instead we write under a DIFFERENT `keychainService`. A different service is a
// different primary key, so `SecItemAdd` genuinely adds, and the new item gets
// the accessibility we asked for. The legacy item is deleted only AFTER the copy
// has landed, so every interruption leaves at least one readable copy:
//
//   copy fails            → legacy intact, retry next read
//   copy ok, delete fails → both exist, reads prefer the new one
//   crash between them    → both exist
//
// There is no ordering in which the token goes missing.
//
// ── iOS ONLY, DELIBERATELY ──────────────────────────────────────────────────
//
// `keychainAccessible` is a no-op on Android — there is no locked-keychain
// failure mode there, so there is nothing to migrate. Android also keys its
// SharedPreferences entry as `"$keychainService-$key"` and derives its Keystore
// alias from the same string, so changing the service would force a one-time new
// Keystore key generation. Keystore work from a backgrounded Android process is
// the documented hang in lib/device.ts (field-caught 2026-07-14). Android keeps
// the default service and the pre-existing behaviour, exactly.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** The accessibility every POWR keychain item must be written with.
 *  AFTER_FIRST_UNLOCK stays readable in the background once the user has
 *  unlocked the device at least once since boot — what a geofencing app needs,
 *  and the standard setting for one. */
export const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } as const;

/** The service the migrated items live under. Its only job is to be different
 *  from the default ("app" on iOS) so SecItemAdd cannot collide with a legacy
 *  item and fall through to the accessibility-preserving update path. */
export const AFU_SERVICE = 'powr.afu';

const KEYCHAIN_AFU = { ...KEYCHAIN, keychainService: AFU_SERVICE } as const;

/** Where reads and writes go. On Android this IS the legacy options object, and
 *  every branch below that compares the two collapses to the old behaviour. */
const PRIMARY = Platform.OS === 'ios' ? KEYCHAIN_AFU : KEYCHAIN;
const MIGRATES = PRIMARY !== KEYCHAIN;

/** Keys whose legacy copy is known to be gone (or known to be unnecessary).
 *  Per launch, not persisted: the cost of being wrong is one extra keychain
 *  delete of a key that no longer exists, while a stale persisted flag could
 *  leave a device permanently unmigrated. */
const legacyRetired = new Set<string>();

/** Copy `value` to the migrated service, then retire the legacy item. Ordering
 *  is the safety property — see the header. Fire-and-forget by design: a caller
 *  already holds the value it needs, and the migration must never delay a
 *  sign-in or a token read. */
async function migrate(key: string, value: string): Promise<void> {
  if (legacyRetired.has(key)) return;
  try {
    await SecureStore.setItemAsync(key, value, PRIMARY);
  } catch (err) {
    // Legacy copy is untouched, so nothing is lost. The next successful read
    // tries again — and the write itself is what needs the device unlocked.
    console.warn(`[keychain] could not copy ${key} to ${AFU_SERVICE} — retrying on the next read:`, err);
    return;
  }
  await retireLegacy(key);
}

/** Delete the pre-migration copy. Only ever called once the migrated copy is
 *  known to exist. Failure is harmless: reads prefer the migrated service, so a
 *  surviving legacy item is litter, not a fault. */
async function retireLegacy(key: string): Promise<void> {
  if (!MIGRATES || legacyRetired.has(key)) return;
  legacyRetired.add(key);
  try {
    await SecureStore.deleteItemAsync(key, KEYCHAIN);
  } catch (err) {
    console.warn(`[keychain] legacy copy of ${key} could not be removed (harmless):`, err);
  }
}

/**
 * Read a keychain item, migrating it to the AFTER_FIRST_UNLOCK service the first
 * time it is found under the legacy one.
 *
 * NEVER THROWS. A locked keychain must read as "absent", never as an exception:
 * auth-js's `getItemAsync` is a bare `await storage.getItem` and `__loadSession`
 * / `_useSession` / `getSession` are try/FINALLY with no catch, so a throw
 * propagates all the way out of `supabase.auth.getSession()` to callers that
 * were never written to handle one. That is the 2026-08-07 iOS load hang.
 */
export async function readSecure(key: string): Promise<string | null> {
  try {
    const migrated = await SecureStore.getItemAsync(key, PRIMARY);
    if (migrated != null) {
      // Nothing left to migrate, but a legacy copy may still be sitting there
      // from a write that landed between the copy and the delete.
      void retireLegacy(key);
      return migrated;
    }
  } catch (err) {
    // An AFTER_FIRST_UNLOCK item is unreadable only before the first unlock
    // since boot. Rare, real, and not recoverable here.
    console.warn(`[keychain] read for ${key} failed — treating as absent:`, err);
    return null;
  }

  if (!MIGRATES) return null;

  let legacy: string | null = null;
  try {
    legacy = await SecureStore.getItemAsync(key, KEYCHAIN);
  } catch (err) {
    // THE BUG THIS FILE EXISTS FOR: a WHEN_UNLOCKED item on a locked device.
    // Absent is the honest answer — and once the migration below has run for
    // this key, this branch stops being reachable.
    console.warn(`[keychain] legacy read for ${key} failed — treating as absent:`, err);
    return null;
  }

  if (legacy == null) return null;
  // A successful legacy read PROVES the device is unlocked right now, which is
  // precisely the moment the copy can be written.
  void migrate(key, legacy);
  return legacy;
}

/**
 * Write a keychain item under the migrated service.
 *
 * DELIBERATELY THROWS ON FAILURE, unlike the read. A silent failure to persist a
 * rotated refresh token is what produces the token-family revocation documented
 * in lib/authFresh.ts — every other runtime keeps presenting the superseded
 * token and GoTrue revokes the family. Loud is correct here.
 */
export async function writeSecure(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, PRIMARY);
  } catch (err) {
    // Name the key before it propagates: this rethrow surfaces in Sentry as an
    // unhandled rejection out of auth-js's `_callRefreshToken`, which rejects
    // its internal `refreshingDeferred` with no handler attached whenever the
    // error is not an AuthError. Without this line the report says only
    // "setValueWithKeyAsync failed" with no indication of what was being saved.
    console.warn(`[keychain] write for ${key} failed:`, err);
    throw err;
  }
  // The value now exists under the migrated service, so any legacy copy is
  // stale — and a stale refresh token is worth removing promptly.
  void retireLegacy(key);
}

/** Delete an item from BOTH services, so a sign-out is a real sign-out even on a
 *  device that has not finished migrating. */
export async function removeSecure(key: string): Promise<void> {
  legacyRetired.add(key);
  const outcomes = await Promise.allSettled([
    SecureStore.deleteItemAsync(key, PRIMARY),
    ...(MIGRATES ? [SecureStore.deleteItemAsync(key, KEYCHAIN)] : []),
  ]);
  const failed = outcomes.find((o) => o.status === 'rejected');
  // A delete that did not land must not report success — the erase-gate callers
  // in lib/supabase.ts treat a resolved promise as "the session is gone".
  if (failed && failed.status === 'rejected') throw failed.reason;
}

/** Test seam: forget which keys have been retired this launch. */
export function __resetKeychainMigrationState(): void {
  legacyRetired.clear();
}
