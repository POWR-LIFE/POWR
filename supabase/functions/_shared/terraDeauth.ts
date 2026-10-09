// What a user's profile looks like once a Terra connection is gone — shared by
// terra-webhook's deauth handler and terra-deauth-all, so a disconnect reads
// the same whichever side records it first.
//
// The connection entry is removed, and if that wearable was the active source
// the phone's own health store takes over (falling back to any other
// connection, then none). An active Terra source is what turns the app's
// native workout and sleep sync off; moving it is what lets the phone's data
// flow again — on every app version, with no update needed.
//
// Pure — Jest-tested from __tests__/terraPause.test.ts.

const NATIVE_KEYS = ['apple-health', 'health-connect'];

export function profileAfterDeauth(
  connections: Record<string, unknown>,
  active: string | null,
  provider: string,
): { health_provider_connections: Record<string, unknown>; active_health_provider: string | null } {
  const key = provider.toLowerCase();
  const conns = { ...connections };
  delete conns[key];
  let nextActive = active;
  if (active === key) {
    const keys = Object.keys(conns);
    nextActive = keys.find(k => NATIVE_KEYS.includes(k)) ?? keys[0] ?? null;
  }
  return { health_provider_connections: conns, active_health_provider: nextActive };
}
