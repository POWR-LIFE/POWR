// The Terra pause switch, server side.
//
// system_config 'terra_paused' ('true' / 'false'), set by an admin. While it
// is on, Terra stands down without anyone disconnecting:
//   - terra-auth refuses new connections (old app builds still show the
//     buttons; this is what stops them),
//   - terra-webhook ignores data payloads, so a workout the phone's health
//     store now delivers can't also land from Terra and be paid twice,
//   - terra-poll skips its cycle.
// Auth and deauth events are still handled — switching Terra off for good
// (terra-deauth-all) relies on the deauth events landing.
//
// The app reads the same row (lib/health/terraPause.ts) and treats every Terra
// brand as "read from the phone instead" while it is on. Turning it back off
// restores everything that hasn't been disconnected.
//
// Pure helpers are Jest-tested from __tests__/terraPause.test.ts.

export const TERRA_PAUSED_KEY = 'terra_paused';

/** Lenient read of the stored text value: 'true' / '1' / 'on' / 'yes' mean paused. */
export function isPausedValue(value: unknown): boolean {
  return typeof value === 'string' && ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase());
}

/**
 * True while Terra is paused. A failed read counts as NOT paused: the switch
 * exists to stand Terra down on purpose, and an outage must never quietly drop
 * every wearable's data.
 */
// deno-lint-ignore no-explicit-any
export async function isTerraPaused(supabase: any): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', TERRA_PAUSED_KEY)
      .maybeSingle();
    if (error) return false;
    return isPausedValue(data?.value);
  } catch {
    return false;
  }
}
