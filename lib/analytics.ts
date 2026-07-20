import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { getSessionUser, supabase } from '@/lib/supabase';

/**
 * Product analytics — which screens members open and which buttons they press.
 * Writes to public.app_events; read in aggregate by the admin Usage panel.
 *
 * THE OVERRIDING RULE HERE IS THAT THIS MODULE MUST NEVER BE FELT BY A MEMBER.
 * Analytics is the least important code in the app: it exists to answer product
 * questions, and no such question justifies a dropped frame, a flat battery or
 * a crash. Everything below follows from that:
 *
 *  - Nothing throws. Every public function swallows its own errors, so a call
 *    site can never be broken by instrumentation failing.
 *  - Nothing is awaited by the UI. track() returns void, synchronously, having
 *    done nothing more than push onto an in-memory array.
 *  - Nothing sends per event. Events are batched and flushed on a timer, at a
 *    size threshold, or when the app backgrounds — one round trip per batch,
 *    which matters on a phone already spending its radio budget on geofencing.
 *  - Nothing retries. A failed flush is dropped, not re-queued: a retry storm
 *    on a flaky connection would cost far more than the events are worth.
 *    Analytics data is lossy by design and the panel is read as trends, so a
 *    missing batch changes nothing an admin would conclude.
 *  - Nothing accumulates without bound. The buffer is capped and drops oldest
 *    first, so a member who is offline for a week cannot grow it forever.
 *
 * PRIVACY. Only developer-authored constants are recorded — route names and
 * button ids — plus the platform and app version. No free text, no user input,
 * no location, no content. The table has length caps as a backstop. Rows are
 * attributed to a user id so the panel can count PEOPLE rather than devices,
 * and they cascade away when an account is deleted.
 */

// ── Configuration, refreshed from system_config at launch ──────────────────
// Cached to AsyncStorage so a kill switch survives being set while the device
// is offline: the next launch reads the last-known value rather than defaulting
// back on. Defaults match the seeded rows (enabled, 100%).
const ENABLED_KEY = '@powr/analytics_enabled';
const SAMPLE_KEY = '@powr/analytics_sample_pct';

let enabled = true;
let samplePct = 100;

// Sampling is decided ONCE per launch, not per event. A launch that reports
// must report everything it does, or sessions would come through with holes in
// them and the screen-to-screen flows would be built from fragments.
let launchSampled = true;

// ── Batching state ─────────────────────────────────────────────────────────
const MAX_BUFFER = 200;
const FLUSH_AT = 25;
const FLUSH_INTERVAL_MS = 30_000;

type PendingEvent = {
  session_id: string;
  event_type: 'screen_view' | 'tap' | 'touch' | 'custom';
  route: string | null;
  target: string | null;
  props: Record<string, unknown> | null;
  platform: string;
  app_version: string;
  created_at: string;
  x: number | null;
  y: number | null;
  vw: number | null;
  vh: number | null;
};

let buffer: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let lastRoute: string | null = null;
let started = false;

/**
 * Groups this launch's events into one "visit" so the panel can ask ordering
 * questions — what screen came next, where the visit ended. Deliberately not
 * the auth session id: signing out and back in is part of a member's journey,
 * not a new one, and an auth session outlives an app launch.
 */
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const appVersion = (() => {
  try {
    // Expo Go reports no native version; fall back to the manifest so QA builds
    // are still distinguishable from store builds in the panel.
    return (
      Application.nativeApplicationVersion ??
      Constants.expoConfig?.version ??
      'unknown'
    ).slice(0, 32);
  } catch {
    return 'unknown';
  }
})();

const parseInt10 = (raw: string | null | undefined): number | null => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? n : null;
};

/** True when this launch should report. Cheap; safe to call on every event. */
const reporting = (): boolean => enabled && launchSampled;

/**
 * Load the last-known switches from AsyncStorage, then decide whether this
 * launch reports. Runs before the network refresh so a kill switch set on a
 * previous run applies immediately at boot rather than one screen late.
 */
async function primeConfig(): Promise<void> {
  try {
    const [en, pct] = await AsyncStorage.multiGet([ENABLED_KEY, SAMPLE_KEY]);
    if (en?.[1] != null) enabled = en[1] === 'true';
    const p = parseInt10(pct?.[1]);
    if (p != null) samplePct = Math.min(Math.max(p, 0), 100);
  } catch {
    /* keep defaults */
  }
  launchSampled = samplePct >= 100 || Math.random() * 100 < samplePct;
}

/** Re-read the switches from system_config and persist them. Failure is fine. */
async function refreshConfig(): Promise<void> {
  try {
    const { data } = await supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['analytics_enabled', 'analytics_sample_pct']);

    const pairs: [string, string][] = [];
    for (const row of data ?? []) {
      if (row.key === 'analytics_enabled') {
        enabled = row.value === 'true';
        pairs.push([ENABLED_KEY, String(enabled)]);
      } else if (row.key === 'analytics_sample_pct') {
        const p = parseInt10(row.value);
        if (p != null) {
          samplePct = Math.min(Math.max(p, 0), 100);
          pairs.push([SAMPLE_KEY, String(samplePct)]);
        }
      }
    }
    if (pairs.length > 0) await AsyncStorage.multiSet(pairs);

    // A kill arriving mid-launch takes effect now: stop the timer and throw
    // away anything already buffered rather than flushing it on the way out.
    if (!enabled) {
      buffer = [];
      stopTimer();
    }
  } catch {
    /* keep primed / default values */
  }
}

function startTimer(): void {
  if (flushTimer != null) return;
  flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
}

function stopTimer(): void {
  if (flushTimer == null) return;
  clearInterval(flushTimer);
  flushTimer = null;
}

/**
 * Send everything buffered. Safe to call concurrently — the in-flight guard
 * means a timer tick landing on top of a background flush is a no-op rather
 * than a duplicate insert.
 *
 * Events buffered before sign-in are HELD, not dropped. Onboarding is exactly
 * the journey most worth seeing, and it happens before an account exists to
 * attribute it to; holding until the session appears means those screens land
 * under the account the member goes on to create. The buffer cap bounds the
 * cost if they never do.
 */
async function flush(): Promise<void> {
  if (flushing || buffer.length === 0 || !reporting()) return;
  flushing = true;
  try {
    const user = await getSessionUser();
    if (!user) return; // hold for a later flush, once signed in

    const batch = buffer;
    buffer = [];
    try {
      const { error } = await supabase
        .from('app_events')
        .insert(batch.map((e) => ({ ...e, user_id: user.id })));
      // Dropped on purpose — see the no-retry note in the header.
      if (error && __DEV__) console.warn('[analytics] flush failed', error.message);
    } catch (e) {
      if (__DEV__) console.warn('[analytics] flush threw', e);
    }
  } catch {
    /* never surface */
  } finally {
    flushing = false;
  }
}

type Position = { x: number; y: number; vw: number; vh: number };

function enqueue(
  eventType: PendingEvent['event_type'],
  route: string | null,
  target: string | null,
  props?: Record<string, unknown> | null,
  pos?: Position | null,
): void {
  try {
    if (!reporting()) return;

    buffer.push({
      session_id: sessionId,
      event_type: eventType,
      route: route ? route.slice(0, 128) : null,
      target: target ? target.slice(0, 128) : null,
      props: props ?? null,
      platform: Platform.OS.slice(0, 16),
      app_version: appVersion,
      // Stamped client-side so ordering within a launch survives batching —
      // a whole batch shares one insert time, which would flatten the flows.
      created_at: new Date().toISOString(),
      x: pos ? pos.x : null,
      y: pos ? pos.y : null,
      vw: pos ? pos.vw : null,
      vh: pos ? pos.vh : null,
    });

    // Oldest-first: recent behaviour is the more useful thing to keep.
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    if (buffer.length >= FLUSH_AT) void flush();
  } catch {
    /* instrumentation must never break a call site */
  }
}

/**
 * Start collection. Called once from the root layout. Idempotent.
 */
export function startAnalytics(): void {
  if (started) return;
  started = true;
  try {
    void (async () => {
      await primeConfig();
      if (!reporting()) return;
      startTimer();
      await refreshConfig();
    })();

    AppState.addEventListener('change', (state) => {
      try {
        if (state === 'active') {
          if (reporting()) startTimer();
        } else {
          // Last chance to send before the OS suspends us — and no point
          // holding a timer that will not fire reliably in the background.
          stopTimer();
          void flush();
        }
      } catch {
        /* never surface */
      }
    });
  } catch {
    started = false;
  }
}

/**
 * Record a screen view. Repeat views of the same route are ignored: expo-router
 * re-emits the current path on param-only changes and on some re-renders, and
 * those would otherwise inflate the busiest screens and fill the flow graph
 * with meaningless A→A edges.
 */
export function trackScreen(route: string): void {
  if (!route || route === lastRoute) return;
  lastRoute = route;
  enqueue('screen_view', route, null);
}

/**
 * Record a button press. `target` is a stable developer-authored id such as
 * 'redeem_reward' — never a label, which would change with copy edits and
 * split one button's history into two.
 */
export function trackTap(target: string, props?: Record<string, unknown>): void {
  enqueue('tap', lastRoute, target, props);
}

/** Record something that is neither a screen nor a button. */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  enqueue('custom', lastRoute, name, props);
}

/**
 * Record where a finger landed, for the admin heatmap.
 *
 * Positions are normalised to a fraction of the screen (0..1) before they leave
 * the device. The app runs on everything from an SE to a Pro Max, and raw
 * pixels from a mix of devices cannot be composited onto one reference
 * screenshot; a fraction of the way across the screen can.
 *
 * Throttled, because this fires on EVERY touch — including the first frame of
 * every scroll. Without the floor, one enthusiastic scroll would fill the
 * buffer and evict the screen views that give the heat its context.
 */
let lastTouchAt = 0;
const TOUCH_MIN_GAP_MS = 120;

export function trackTouch(pageX: number, pageY: number, width: number, height: number): void {
  try {
    if (!reporting()) return;
    if (!(width > 0) || !(height > 0)) return;

    const now = Date.now();
    if (now - lastTouchAt < TOUCH_MIN_GAP_MS) return;
    lastTouchAt = now;

    // A touch can land marginally outside the reported window (the notch area,
    // rubber-band overscroll). Clamp rather than drop: the position is real,
    // only the arithmetic is off by a pixel, and the column rejects out-of-range.
    const x = Math.min(Math.max(pageX / width, 0), 1);
    const y = Math.min(Math.max(pageY / height, 0), 1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    enqueue('touch', lastRoute, null, null, {
      x,
      y,
      vw: Math.round(width),
      vh: Math.round(height),
    });
  } catch {
    /* a missed heat point is never worth a broken gesture */
  }
}

/**
 * Wrap an onPress so the tap is recorded before the real handler runs.
 *
 *   onPress={tracked('redeem_reward', handleRedeem)}
 *
 * Deliberately a handler wrapper rather than a <TrackedPressable> component.
 * Wrapping buttons in an extra view to observe them would put instrumentation
 * into the layout and touch-handling path — the exact place this app has been
 * bitten before by invisible views swallowing presses — whereas this changes
 * nothing about the tree, the styling or the hit box. It also composes with
 * every button style already in the codebase instead of replacing them.
 *
 * The wrapper is transparent in both directions: it forwards arguments and the
 * return value, and if recording somehow throws, the real handler still runs.
 */
export function tracked<A extends unknown[], R>(
  target: string,
  handler: (...args: A) => R,
  props?: Record<string, unknown>,
): (...args: A) => R {
  return (...args: A): R => {
    try {
      trackTap(target, props);
    } catch {
      /* the member's tap matters, the record of it does not */
    }
    return handler(...args);
  };
}

/** Exposed for tests. */
export const __analyticsInternals = {
  getBufferSize: () => buffer.length,
  getSessionId: () => sessionId,
  peek: () => [...buffer],
  reset: () => {
    buffer = [];
    lastRoute = null;
    started = false;
    lastTouchAt = 0;
    stopTimer();
  },
};
