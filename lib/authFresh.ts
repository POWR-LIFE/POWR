// Background auth freshness — the fix for the silent-401 class that killed
// background writes fleet-wide (root-caused 2026-08-05).
//
// THE MECHANISM IT DEFEATS: Supabase access tokens live one hour, and refresh
// tokens ROTATE on every refresh. Multiple JS runtimes share one persisted
// session (UI context, headless TaskManager context, successive short-lived
// headless processes) but each keeps its own IN-MEMORY copy — and supabase-js
// never re-reads storage once a runtime has loaded. So the moment any runtime
// refreshes, every other runtime's memory is stale; whichever of them refreshes
// next presents the dead token, and GoTrue's reuse-detection REVOKES THE WHOLE
// TOKEN FAMILY. From then on the device is logged out server-side: JS runs,
// GPS works, network is granted — and every RPC dies as a 401 that supabase-js
// returns (not throws) and call sites swallow. Field evidence 2026-08-05:
// `token_revoked` stamped the exact second of the first background wake
// (jamiemasonwright 09:01:02, elliot 08:07:57 = the second of his gym ENTER),
// then three flawless JS executions writing nothing.
//
// The 2026-07 fix ("getSession(), never refreshSession(), on background paths")
// removed one trigger — unconditional rotation — but not the divergence itself:
// getSession()'s lazy refresh still uses the stale in-memory token. This module
// adds the missing capability:
//
//   1. RESYNC: re-read the persisted pair and, when it differs from what this
//      runtime believes, adopt it via setSession() — the persisted pair is
//      always the newest family member, so refreshing from it cannot trip
//      reuse-detection.
//   2. SINGLE-FLIGHT: one freshness check in flight per runtime, ever.
//   3. PROACTIVE: refresh when the access token is inside the expiry slack, so
//      a wake's one guaranteed round-trip is never spent discovering staleness.
//   4. RETRY-ONCE: callWithAuthRetry() re-runs an RPC exactly once after a
//      forced refresh when the first attempt came back auth-rejected.
//   5. LOUD: failures breadcrumb to AsyncStorage and flush to
//      geofence_region_events ('auth_stale') on the next healthy call — this
//      bug survived for weeks precisely because every failure was silent.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
// STATIC, and it must stay that way. This was `await import('react-native')`
// inside flushBreadcrumbs(), and it was the SIGABRT that cost us 2026-08-05/06:
// Metro compiles a dynamic import() to asyncRequire -> importAll, and importAll
// COPIES EVERY PROPERTY off the module — firing every deprecated getter on React
// Native's index. One of them is PushNotificationIOS, whose module scope runs
// `new NativeEventEmitter(NativePushNotificationManagerIOS)`; that native module
// is absent from an Expo build, so the argument is null, and the resulting
// Invariant Violation is an uncaught fatal -> RCTFatal -> abort.
// Never dynamically import 'react-native'. A named static import costs nothing.
import { Platform } from 'react-native';
import { withNetworkTimeout } from '@/lib/networkTimeout';
import { AUTH_STORAGE_KEY, authStorage, supabase } from '@/lib/supabase';

/** Refresh when under this much lifetime remains. Generous on purpose: a wake
 *  that starts at T-90s must not have its confirm rejected at T+2s. */
const EXPIRY_SLACK_S = 120;

const BREADCRUMB_KEY = 'POWR_AUTH_FAILURE_BREADCRUMBS';
const MAX_BREADCRUMBS = 20;

/** What THIS runtime believes the current refresh token is. Maintained via
 *  onAuthStateChange so divergence from storage is detectable without poking
 *  GoTrue (getSession() would lazily refresh — off the stale token, which is
 *  the exact bug). null = unknown/cold runtime, which must adopt the persisted
 *  pair before trusting any local session state. */
let memRefreshToken: string | null = null;
let subscribed = false;

function subscribeOnce(): void {
  if (subscribed) return;
  subscribed = true;
  // Optional surface: the listener is an accuracy improvement, not a
  // dependency — remember() below keeps the belief current either way.
  if (typeof supabase.auth.onAuthStateChange === 'function') {
    supabase.auth.onAuthStateChange((_event, session) => {
      memRefreshToken = session?.refresh_token ?? null;
    });
  }
}

/** Every session that passes through this module updates the runtime's belief —
 *  the event subscription alone is not enough (INITIAL_SESSION timing varies,
 *  and a quiet client emits nothing), and the divergence detector is only as
 *  good as this value. */
function remember(session: Session | null): Session | null {
  memRefreshToken = session?.refresh_token ?? null;
  return session;
}

interface PersistedPair { access_token: string; refresh_token: string }

/** The latest persisted session, read straight from the shared storage — the
 *  one source every runtime agrees on. Tolerates both the v2 shape (the session
 *  object itself) and the legacy `{ currentSession }` wrapper. */
async function readPersistedPair(): Promise<PersistedPair | null> {
  try {
    const raw = await authStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = parsed?.currentSession ?? parsed;
    if (typeof s?.access_token === 'string' && typeof s?.refresh_token === 'string') {
      return { access_token: s.access_token, refresh_token: s.refresh_token };
    }
    return null;
  } catch {
    return null;
  }
}

let inFlight: Promise<Session | null> | null = null;
let inFlightForced = false;
let inFlightStartedMs = 0;

/** A freshness pass older than this is presumed hung, not slow. Background
 *  processes freeze in-flight network promises (RN's documented class: request
 *  delivered, response never processed, timers frozen so withNetworkTimeout
 *  never fires). Field-caught 2026-08-05 15:18Z: a wake's resync froze and the
 *  single-flight latch then pinned every later wake to the same dead promise —
 *  re-creating the exact wedge this module exists to prevent. Wall-clock
 *  comparison works where timers don't: new callers only arrive on new wakes,
 *  and Date.now() read at call time needs no timer. */
const IN_FLIGHT_DEADLINE_MS = 45_000;

/**
 * Returns a session whose access token is guaranteed fresh (≥ EXPIRY_SLACK_S of
 * life), resyncing this runtime to the latest persisted token family first.
 * Returns null when signed out or when auth is unrecoverable (revoked family) —
 * it never throws, and it logs loudly + breadcrumbs on failure.
 *
 * Call it at the top of every background entry point BEFORE any RPC: the wake's
 * guaranteed round-trip belongs to the confirm, and this is what makes the
 * confirm's token valid when it fires.
 */
export function ensureFreshSession(reason: string, opts?: { force?: boolean }): Promise<Session | null> {
  if (inFlight && Date.now() - inFlightStartedMs > IN_FLIGHT_DEADLINE_MS) {
    // The pending pass is presumed frozen — abandon the latch (NOT the promise;
    // if it ever settles it is harmless) and let this caller start a live pass.
    console.warn(`[authFresh] ${reason}: abandoning a freshness pass stuck for >${IN_FLIGHT_DEADLINE_MS / 1000}s.`);
    inFlight = null;
    inFlightForced = false;
  }
  if (inFlight) {
    // A FORCED caller must never coalesce onto a non-forced pass: the retry
    // paths call force precisely because the current token was just rejected,
    // and inheriting a pass that may conclude "still fresh, no rotation" makes
    // the retry re-present the same dead token (2026-08-05 crash-hunt finding
    // #2 — this silently stranded claims). Chain a genuinely forced pass after
    // the pending one instead. Forced callers still coalesce with each other.
    if (opts?.force && !inFlightForced) {
      return inFlight.then(() => ensureFreshSession(reason, opts));
    }
    return inFlight;
  }
  inFlightForced = !!opts?.force;
  inFlightStartedMs = Date.now();
  const myPass = (async () => {
    subscribeOnce();
    try {
      const persisted = await readPersistedPair();

      // Divergence: another runtime rotated after we loaded. Adopt the
      // persisted pair — setSession() refreshes off it if the access token is
      // already expired, and that refresh presents the NEWEST family member.
      //
      // Deliberately adopts when memRefreshToken is UNKNOWN (null) too: null
      // does not mean cold — it can mean a long-lived runtime whose supabase
      // client holds a stale in-memory session while this module has simply
      // never run. getSession() there would lazily refresh off the dead token
      // (the family-killer). The cost is one setSession per runtime lifetime —
      // after the first pass, remember() makes the belief concrete.
      if (persisted && persisted.refresh_token !== memRefreshToken) {
        console.warn(`[authFresh] ${reason}: runtime session is stale vs storage — resyncing to the persisted pair.`);
        const { data, error } = await withNetworkTimeout(
          supabase.auth.setSession(persisted), 'auth.setSession',
        );
        if (error) throw error;
        void flushBreadcrumbs();
        return remember(data.session ?? null);
      }

      // Memory matches storage (or this is a cold runtime, where they are the
      // same thing): getSession()'s lazy refresh is safe here because any
      // refresh it performs uses the newest pair.
      const { data: { session }, error } = await withNetworkTimeout(
        supabase.auth.getSession(), 'auth.getSession',
      );
      if (error) throw error;
      if (!session) return null;
      remember(session);

      // A session without expires_at is treated as fresh, not expired: real
      // GoTrue sessions always carry it, and guessing "expired" here would
      // force a rotation on every call — the exact churn this module exists
      // to minimise.
      const expiresAt = session.expires_at;
      const nearExpiry = typeof expiresAt === 'number'
        && expiresAt - Math.floor(Date.now() / 1000) < EXPIRY_SLACK_S;
      if ((opts?.force || nearExpiry) && typeof supabase.auth.refreshSession === 'function') {
        const { data, error } = await withNetworkTimeout(
          supabase.auth.refreshSession(), 'auth.refreshSession',
        );
        if (error) throw error;
        void flushBreadcrumbs();
        return remember(data.session ?? null);
      }

      void flushBreadcrumbs();
      return session;
    } catch (err) {
      // This is the moment the old code went silent. Never again: this line in
      // logcat + the breadcrumb row are how the next auth regression gets
      // caught in one query instead of a week of field walks.
      //
      // Say what happened, NOT what it means. The old wording ("background
      // writes will be rejected until re-auth") asserted the 2026-08-05 model —
      // revoked family, heals only at app-open — and on 2026-08-09 that reading
      // was wrong twice over: the failure was a 30s TIMEOUT (a local auth call
      // that never settled, with zero requests reaching GoTrue), and the very
      // next pass succeeded ~3s later and flushed this breadcrumb. A message
      // that diagnoses instead of reporting sends the next triage down the
      // wrong path.
      console.error(`[authFresh] ensureFreshSession(${reason}) did not complete — this caller has no fresh session; later passes may still succeed:`, err);
      void recordBreadcrumb(reason, err);
      return null;
    }
  })().finally(() => {
    // An abandoned pass settling late must not clear a LIVE successor's latch.
    if (inFlight === myPass) { inFlight = null; inFlightForced = false; }
  });
  inFlight = myPass;
  return myPass;
}

/** Auth-shaped failure, across the shapes our stack actually produces:
 *  PostgREST (PGRST301 / "JWT expired"), GoTrue ("Invalid Refresh Token"),
 *  edge functions (401 status). */
export function isAuthError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string | number; status?: number; message?: unknown };
  if (e.code === 'PGRST301' || e.code === 401 || e.status === 401) return true;
  return /jwt|expired|invalid.*token|refresh.*token|unauthorized|not.*authenticated/i
    .test(String(e.message ?? ''));
}

/**
 * Runs a supabase call with freshness-first ordering and one auth-retry:
 * ensure a fresh session → run → if the result is auth-rejected, force one
 * refresh and run again. The factory is invoked per attempt so each attempt is
 * an independent request. Never throws on the auth handling itself — the
 * caller sees exactly what supabase returned.
 */
export async function callWithAuthRetry<T>(
  make: () => PromiseLike<{ data: T; error: unknown }>,
  label: string,
): Promise<{ data: T | null; error: unknown }> {
  await ensureFreshSession(label);
  let res = await withNetworkTimeout(make(), label);
  if (res?.error && isAuthError(res.error)) {
    console.warn(`[authFresh] ${label}: auth-rejected — forcing one refresh and retrying.`);
    const session = await ensureFreshSession(`${label}:retry`, { force: true });
    if (session) res = await withNetworkTimeout(make(), `${label}:retry`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Breadcrumbs: auth failures happen exactly when the DB is unreachable (that is
// the failure), so they queue locally and flush on the next healthy pass.

async function recordBreadcrumb(reason: string, err: unknown): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BREADCRUMB_KEY);
    const list: unknown[] = raw ? JSON.parse(raw) : [];
    list.push({
      at: new Date().toISOString(),
      reason,
      error: String((err as Error)?.message ?? err),
    });
    await AsyncStorage.setItem(BREADCRUMB_KEY, JSON.stringify(list.slice(-MAX_BREADCRUMBS)));
  } catch { /* breadcrumbs are best-effort by definition */ }
}

let flushing = false;

async function flushBreadcrumbs(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const raw = await AsyncStorage.getItem(BREADCRUMB_KEY);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return;
    const { error } = await withNetworkTimeout(supabase.rpc('log_geofence_region_event', {
      p_region_id: 'auth',
      p_event:     'auth_stale',
      p_platform:  Platform.OS,
      p_detail:    { failures: list },
    }), 'log_geofence_region_event');
    if (error) throw error;
    await AsyncStorage.removeItem(BREADCRUMB_KEY);
  } catch { /* flush retries on the next healthy call */ } finally {
    flushing = false;
  }
}
