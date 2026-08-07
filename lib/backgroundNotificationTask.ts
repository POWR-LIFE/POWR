// Background notification task — the piece that lets the server WAKE this device.
//
// A stationary phone gets no location callbacks (Android setSmallestDisplacement /
// iOS distanceFilter both suppress them until you move), so the dwell machine can
// never wake itself while the user stands still in a gym. That is why the 30-min
// claim and 40-min bonus only ever landed when the app was next opened.
//
// So the server holds the timers and sends a SILENT, data-only push at each
// threshold. This task is what receives it with the app backgrounded or swiped away.
// It hands straight to runVisitCheck, which takes a fresh GPS fix and decides — the
// server never credits on its own.
//
// Registration is idempotent and safe to call on every launch.
//
// PLATFORM LIMITS (not bugs — Apple/Google policy):
//  • iOS force-quit (swiped from the app switcher): background pushes are NOT
//    delivered to a user-terminated app. Region monitoring still relaunches us on
//    EXIT, so the claim lands then — i.e. exactly today's behaviour, never worse.
//  • iOS throttles background pushes; one per threshold is well within budget.
//  • Android force-stop (from Settings) blocks everything until the app is opened.

import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { noteTask, reportHandled } from '@/lib/crashHandler';

export const BACKGROUND_NOTIFICATION_TASK = 'POWR_BACKGROUND_NOTIFICATION';

/** The one payload marker that says a wake is ours. Kept next to extractData so
 *  the matcher and the guard can never drift apart. */
const VISIT_CHECK_TYPE = 'gym_visit_check';

interface VisitCheckData {
  type?: string;
  stage?: 'dwell' | 'upgrade';
  visit_id?: string;
  /** Short-lived visit-scoped ticket minted by the beacon per nudge. When
   *  present the whole wake runs auth-free (see lib/gymVisits nonce path). */
  nonce?: string;
}

/** Digs the data payload out of the platform-specific notification shapes.
 *
 *  ⚠ A `??` chain was the wrong tool here and cost us the entire iOS wake path.
 *  `??` takes the first candidate that EXISTS, not the first that is OURS.
 *  expo-notifications' BackgroundEventTransformer wraps the APNs userInfo as
 *    { data: { body: <our payload>, dataString, scopeKey, experienceId, projectId },
 *      aps, notification }
 *  (node_modules/expo-notifications/ios/EXNotifications/Notifications/Background/
 *  BackgroundEventTransformer.swift + its Spec). So `raw.data` MATCHED — but it is
 *  the envelope, not the payload, and carries no `type`. The task ran and returned
 *  at the type guard below on every single wake: ~200 iOS wakes from 2026-07-13
 *  onward, ZERO confirmed_* rows, while Android sailed through the same line
 *  because its DIRECT FCM message puts our keys at `raw.data` verbatim.
 *
 *  So: gather every candidate shape and pick the first that actually looks like
 *  ours, rather than the first that happens to be non-null. */
export function extractData(raw: unknown): VisitCheckData {
  const body = raw as Record<string, any> | null | undefined;

  const candidates: unknown[] = [
    body?.data?.body,                                    // iOS (Expo APNs envelope, transformed)
    body?.data,                                          // Android (FCM data-only, keys at top level)
    body?.body,
    body?.notification?.data,
    body?.notification?.request?.content?.data,
    body?.request?.content?.data,                        // iOS UNNotification (foreground shape)
  ];

  // The transformer also mirrors the payload as a JSON string for parity with
  // Android. Parse it as a last resort so a future envelope reshuffle can't
  // silently break the wake path the same way twice.
  const dataString = body?.data?.dataString ?? body?.dataString;
  if (typeof dataString === 'string') {
    try {
      candidates.push(JSON.parse(dataString));
    } catch { /* not JSON — ignore */ }
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object'
        && (candidate as VisitCheckData).type === VISIT_CHECK_TYPE) {
      return candidate as VisitCheckData;
    }
  }
  return {};
}

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[BackgroundNotification] task error:', error);
    return;
  }
  let rearmDone: Promise<void> | undefined;
  try {
    const payload = extractData(data);
    if (payload?.type !== VISIT_CHECK_TYPE) return; // not ours — ignore quietly

    const stage = payload.stage === 'upgrade' ? 'upgrade' : 'dwell';
    console.log(`[BackgroundNotification] Visit check (${stage}) — verifying presence.`);
    // Names the executor on any crash report filed from here. A stack from a
    // headless wake has no route to place it, and this wake is exactly where
    // the 30- and 40-minute-mark crashes were reported from.
    noteTask(`POWR_BACKGROUND_NOTIFICATION:${stage}`);

    // AUTH POLICY FOR WAKES (hard-won, twice):
    //  • Ticketed nudge (payload.nonce, beacon ≥v13): the wake does ZERO auth
    //    work — telemetry and confirm ride the nonce over raw fetch. Awaiting
    //    ANY auth round-trip here froze wakes solid on 2026-08-05 (refresh 200
    //    on the server in 276 ms, client promise never settled — RN frozen
    //    response + a Keystore session write). Session warming still happens,
    //    but fire-and-forget: it helps LATER paths and must never cost this one.
    //  • Legacy nudge without a ticket: keep the awaited freshness pass — a
    //    stale-token confirm there fails outright, so the gamble inverts.
    if (payload.nonce) {
      void import('@/lib/authFresh')
        .then(m => m.ensureFreshSession('background_wake_warm'))
        .catch(() => { /* warming is best-effort by definition */ });
    } else {
      const { ensureFreshSession } = await import('@/lib/authFresh');
      await ensureFreshSession('background_wake');
    }

    // Record that the push reached JS — but NEVER await it.
    //
    // ⚠ THIS AWAIT WAS EATING EVERY WAKE. Field 2026-08-03, four sessions across a
    // full day: `wake_received` landed server-side within a second on EVERY wake,
    // and runVisitCheck was never entered — not once, not on any platform. Its very
    // first breadcrumb never printed while the location task kept logging every 60 s
    // beside it, so the JS context was alive and this await simply never resolved.
    // The row reaches the database and the client-side promise hangs: the request is
    // delivered, the response never settles. withNetworkTimeout cannot save it either
    // — RN drives setTimeout off the UI frame clock, so mid-Doze its 30 s race can
    // itself freeze (a 30 s timeout still pending 16 minutes later, 2026-07-14).
    //
    // So the telemetry added on 2026-08-01 to diagnose the dead wake path became the
    // thing killing it. Its own contract in lib/gymVisits.ts always said so —
    // "Fire-and-forget by contract: the wake has ~10 s mid-Doze and one guaranteed
    // round-trip, and that round-trip belongs to confirmGymVisit, not to telemetry" —
    // and this caller was the one place that ignored it. Honour it: fire, don't wait.
    // Await the IMPORT (cheap, local, and proven to resolve — the RPC below did
    // execute on every stalled wake), but never the RPC. That keeps the invocation
    // strictly ordered before the presence check, which is the invariant the wake
    // telemetry tests pin, while removing the await that actually hung. Chaining
    // off the import instead would have made the ordering depend on which dynamic
    // import settles first — near-certain in practice, not guaranteed.
    if (payload.visit_id) {
      const { logGymWakeReceived, logGymWakeReceivedViaNonce } = await import('@/lib/gymVisits');
      const telemetry = payload.nonce
        ? logGymWakeReceivedViaNonce(payload.visit_id, payload.nonce, stage, { source: 'background_task' })
        : logGymWakeReceived(payload.visit_id, stage, { source: 'background_task' });
      void telemetry.catch(() => { /* telemetry must never cost the wake its round-trip */ });
    }

    // Android fence self-heal: this process is provably awake and FCM-reachable
    // right now — the one thing the dead-fence deadlock can't take away. Refresh
    // the geofence registration with a live PendingIntent before going back to
    // sleep.
    //
    // STARTED BEFORE runVisitCheck, ON PURPOSE. The confirm round-trip inside
    // runVisitCheck can freeze forever with the screen off — server answers,
    // client promise never settles (bench 2026-08-05: the 19:16Z and 19:51Z
    // wakes both landed confirmed_inside server-side at ~80 ms while the JS
    // line after the confirm never printed; same frozen-response class as the
    // morning's auth freeze, now on the nonce fetch itself). Anything sequenced
    // after that await is hostage — which is exactly how the first version of
    // this self-heal died twice ("teardown race" was the wrong read of the
    // first death; the process was alive the whole time). The re-arm chain is
    // pure native + AsyncStorage — no network anywhere in it — so once started
    // it always runs to completion; the trailing await below only holds the
    // task open in the healthy case.
    rearmDone = import('@/context/GeofenceContext')
      .then(async m => {
        await m.rearmFencesFromWake();
        // Visit-less wakes (the beacon's fence-refresh ping) double as
        // zombie-session reconciliation: a missed walk-out EXIT leaves the
        // persisted session active forever, and the enter handler then
        // refuses every REAL arrival ("Enter ignored — session already
        // active"). A wake FOR a visit already reconciles inside/outside via
        // runVisitCheck's own fix — don't double up there.
        if (!payload.visit_id) {
          await m.reconcileActiveSessionFromWake();
          // ...then look for an arrival the fence layer never told us about.
          // ORDER IS LOAD-BEARING: the sweep no-ops while a session is stored,
          // so the reconcile has to clear a zombie FIRST or the sweep can
          // never see the gym the user is standing in right now.
          //
          // This is the fence-independent entry path (2026-08-06). Closed-app
          // ENTRY via GMS fences has never succeeded in the field and the
          // device cannot verify fence health; the FCM wake reliably does.
          // evaluateLocationFix still decides — same radius, same daily cap,
          // no fix means no check-in.
          await m.sweepForMissedCheckInFromWake();
        }
      })
      .catch(() => { /* self-heal is best-effort by definition */ });

    // Imported lazily: this task is registered at module load in a headless context,
    // and GeofenceContext pulls in the whole geofence engine.
    //
    // Bracketed by breadcrumbs because it is the ONLY other await between the wake
    // arriving and runVisitCheck starting. If wakes still stall after the change
    // above, the missing 'engine ready' line convicts this import instead — no more
    // inferring which call hung.
    console.log('[BackgroundNotification] loading geofence engine…');
    const { runVisitCheck } = await import('@/context/GeofenceContext');
    console.log('[BackgroundNotification] geofence engine ready — running visit check.');
    // The server's own visit_id is passed through so runVisitCheck can reconcile it
    // against the device's stored one. Discarding it is how four wakes for live
    // visit 793e434a were answered into the DEAD visit 2fa4e05d (2026-07-16), which
    // then burned its whole nudge budget answering for a visit that had exited.
    await runVisitCheck(stage, payload.visit_id, payload.nonce);
  } catch (err) {
    console.warn('[BackgroundNotification] visit check failed:', err);
    // Captured explicitly because the console.warn above cannot be: only
    // console.error feeds RN's reporting pipeline, and TaskManager's own
    // console.error path flattens the original stack into a synthetic one.
    // Synchronous, returns void, adds no await to the wake.
    reportHandled(err, { task: 'POWR_BACKGROUND_NOTIFICATION' });
  } finally {
    // Hold the task open until the self-heal lands — including the throw path,
    // where a disposable headless context would otherwise be torn down while
    // the re-arm chain is still in flight. Undefined before the payload guard,
    // and awaiting undefined is free.
    await rearmDone;
  }
});

/** REBINDS the task so data-only pushes are delivered while backgrounded/closed.
 *
 *  unregister → register, never register alone: registration persists natively,
 *  and a bare registerTaskAsync no-ops when the name is already registered —
 *  which keeps delivery wired to whatever JS context registered it FIRST. When
 *  the context changes under the same process (an OTA restart-prompt reload via
 *  Updates.reloadAsync, or a headless-born process — fg-service/location restart
 *  — whose UI context mounts later), that first context is dead and every wake
 *  is dropped in silence: the OS hands us the FCM broadcast, the task never
 *  runs. Proven live 2026-07-17: batterystats showed all 7 beacon wakes
 *  dispatched to the app in ~2 s, zero JS reaction, for a session that was alive
 *  the whole time; a cold start healed it, foregrounding alone did NOT.
 *  (Re-registering on boot alone — the 2026-07-15 fix — was not enough.)
 *
 *  The unregister may reject when nothing was registered yet — ignore it and
 *  register anyway. Call this on every UI mount AND every return-to-foreground:
 *  those are the earliest moments a live context can steal the binding back.
 *
 *  ⚠ ONCE PER JS CONTEXT, and that bound is load-bearing — not an optimisation.
 *  unregister → register leaves the NATIVE consumer's task reference null for
 *  the gap between the two calls, and an FCM message arriving in that gap used
 *  to take down the entire process (see the patched null guard in
 *  expo-notifications' BackgroundRemoteNotificationTaskConsumer; field
 *  2026-08-03, the app was crashed by its own "Session recorded" push 2 s after
 *  app-open). Foreground is exactly when a queued push lands, so rebinding on
 *  EVERY foreground reopened that window at the worst possible moment, over and
 *  over. Module state dies with the JS context, so "once per context" still
 *  rebinds after every OTA reload or headless-born start — which is the whole
 *  point of the 2026-07-17 fix — while a context that already owns the binding
 *  stops re-taking it from itself. The native guard and this bound are
 *  belt-and-braces: either alone stops the crash. */
let _bindOnce: Promise<void> | null = null;

export function registerBackgroundNotificationTask(): Promise<void> {
  // Concurrent callers (UI mount racing an immediate foreground event) share the
  // one in-flight rebind rather than starting a second unregister mid-register.
  if (!_bindOnce) {
    _bindOnce = (async () => {
      try {
        await Notifications.unregisterTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});
        await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
        console.log('[BackgroundNotification] task registered.');
      } catch (err) {
        // Unsupported in Expo Go — the geofence engine's own paths still work there.
        // Clear the latch so a real retry is still possible after a transient failure.
        _bindOnce = null;
        console.warn('[BackgroundNotification] registration failed:', err);
      }
    })();
  }
  return _bindOnce;
}
