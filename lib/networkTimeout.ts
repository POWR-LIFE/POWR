// React Native's Android networking stack configures OkHttp with connect/read/
// write timeouts of 0 (infinite), and supabase-js passes no AbortSignal — so a
// single dead socket can hang an `await` forever. In foreground UI the user just
// retries; on the headless geofence path a hang is a silently dropped claim: the
// state machine persists "attempt started", then waits for an outcome that never
// arrives (field-caught 2026-07-14 — a claim-points invoke neither resolved nor
// rejected, and the session went unclaimed until exit). Racing a rejection turns
// a hang into an ordinary error the existing retry machinery already handles.
//
// The abandoned request is NOT cancelled and may still land later. Every caller
// on this path is idempotent server-side (unique indexes, already-claimed
// checks, owner-locked no-op RPCs), so a late duplicate resolution is harmless.
//
// ⚠️ LIMIT: RN dispatches setTimeout off the UI frame clock, so this race can
// itself FREEZE while the app is backgrounded/screen off (field-caught
// 2026-07-14: a 30 s timeout still pending 16 minutes later). Treat this helper
// as the foreground/best-case bound only — background recovery must be driven
// by the location tick (see the claim lock lease in GeofenceContext), never by
// a timer.
export const NETWORK_TIMEOUT_MS = 30_000;

export function withNetworkTimeout<T>(work: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${NETWORK_TIMEOUT_MS / 1000}s`)),
      NETWORK_TIMEOUT_MS,
    );
    // Promise.resolve tolerates plain values as well as thenables (some test
    // mocks return bare {data, error} objects).
    Promise.resolve(work).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
