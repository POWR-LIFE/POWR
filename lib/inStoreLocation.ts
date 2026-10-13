import * as Location from 'expo-location';

export type QuietFix = { lat: number; lng: number; accuracy: number | null };

/**
 * A location fix for in-store redemption that never prompts. Members only
 * reach the wallet after onboarding's location ask; if they said no, the
 * voucher still opens (the server records "not at a shop") rather than
 * blocking a member standing at the till.
 *
 * Prefers a recent last-known fix, then a Balanced read raced against a
 * timeout, so tapping "Use in store" is never held up by GPS indoors.
 */
export async function quietFix(timeoutMs = 6000, maxAgeMs = 2 * 60 * 1000): Promise<QuietFix | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs, requiredAccuracy: 250 });
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null };
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return fresh ? { lat: fresh.coords.latitude, lng: fresh.coords.longitude, accuracy: fresh.coords.accuracy ?? null } : null;
  } catch {
    return null;
  }
}
