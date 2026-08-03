// @ts-nocheck — Deno runtime, not Node.
//
// Gym visit beacon (pg_cron, every minute). Token-gated by the same
// x-resolve-token cron secret as the other cron-invoked functions, so it needs no
// user JWT (verify_jwt = false).
//
// WHY THIS EXISTS: the dwell state machine is time-based but only ever runs from a
// location callback, and BOTH platforms suppress location callbacks entirely for a
// stationary device (Android setSmallestDisplacement, iOS distanceFilter). A user
// who checks in and stands still — every real gym session — receives no fixes, so
// the 30-min claim and the 40-min upgrade never fire in the background. They only
// landed when the app was next opened (t+33 min 2026-07-03, t+36 min 2026-07-13).
//
// The device can't be relied on to wake itself, so the SERVER holds the timer and
// wakes it with a SILENT (data-only) push at each threshold. That is all this does.
//
// IT NEVER CREDITS ANYTHING. Points are awarded only by claim-points /
// upgrade-gym-tier, called by the DEVICE after it has taken a fresh GPS fix and
// confirmed it is still inside the partner radius. No fix, no credit. A device that
// never answers simply gets nudged a few times and then left to the existing exit
// path — nothing is fabricated, nothing is lost.

import { createClient } from '@supabase/supabase-js';
import { deliverExpoMessages } from '../_shared/expoPush.ts';
import { sendFcmDataMessage } from '../_shared/fcmV1.ts';

// Budgets are PER STAGE and live in their own columns (nudge_count /
// nudge_count_upgrade). They used to share `nudge_count`, which silently handed the
// upgrade stage whatever the dwell stage didn't spend — usually 7 — and made the
// "per stage" comment a lie. Total exposure 9 ≈ the old effective 8, so this is not
// a material change against Apple's ~2-3 background pushes/hour guidance.
const MAX_NUDGES_DWELL = 4;              // then leave it to the exit path
const MAX_NUDGES_UPGRADE = 5;            // the weaker leg — one more attempt than dwell
const NUDGE_BACKOFF_MS = 5 * 60 * 1000;  // don't re-wake a silent device more than every 5 min
// How far back the upgrade stage will keep retrying after a visit has ended. The
// bonus is worth chasing past the exit (that is the whole point of this change),
// but not indefinitely — a device that has ignored 5 nudges across a day is not
// going to answer, and the backfill migration covers anything older.
const UPGRADE_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
// From which silent-wake attempt the dwell stage escalates to a VISIBLE push.
// Attempt 1 gets the full 5-min backoff to answer before we bother the user.
const VISIBLE_FALLBACK_FROM_ATTEMPT = 2;

async function thresholds(admin): Promise<{ dwellMin: number; upgradeMin: number }> {
  const { data } = await admin
    .from('system_config')
    .select('key, value')
    .in('key', ['min_gym_dwell_minutes', 'gym_upgrade_minutes']);

  const read = (key: string, fallback: number) => {
    const raw = (data ?? []).find((r: { key: string }) => r.key === key)?.value;
    const n = parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  // Same source of truth the client primes from — client and server cannot drift.
  return { dwellMin: read('min_gym_dwell_minutes', 30), upgradeMin: read('gym_upgrade_minutes', 40) };
}

/** Visits whose threshold has passed, that the device hasn't resolved, and that we
 *  haven't just nudged. `stage` decides which threshold and which state we're in. */
async function dueVisits(admin, stage: 'dwell' | 'upgrade', minutes: number) {
  const thresholdAt = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const backoffAt = new Date(Date.now() - NUDGE_BACKOFF_MS).toISOString();

  let q = admin
    .from('gym_visits')
    .select('id, user_id, partner_id, started_at, nudge_count, nudge_count_upgrade, last_nudge_at')
    .lte('started_at', thresholdAt)
    .or(`last_nudge_at.is.null,last_nudge_at.lt.${backoffAt}`)
    .limit(200);

  // Each stage counts against its OWN column, so a dwell stage that burns its
  // budget no longer eats into the upgrade stage's.
  q = stage === 'dwell'
    // A dwell claim genuinely requires the user to still be inside — the device
    // must take a fresh fix and confirm the radius — so a visit that has ended is
    // correctly out of scope here.
    ? q.is('ended_at', null)
       .eq('status', 'open').is('claimed_session_id', null)
       .lt('nudge_count', MAX_NUDGES_DWELL)
    // The UPGRADE does not: it asks "did they stay past the tier?", which is a
    // question about a window that is already over. Requiring `ended_at is null`
    // here made the bonus unretryable the instant the user walked out — and since
    // the claim fires at 30 min and the tier is 40, the eligible window is at most
    // 10 minutes wide. Measured 2026-08-03: 17 of 39 claimed visits ended within
    // 10 minutes of the claim, so the beacon never got a single chance at them,
    // and only 26 of 62 sessions >= 2h ever received the bonus. The client's own
    // exit-path attempt is single-shot too — the durable claim queue deliberately
    // skips the upgrade (GeofenceContext.tsx:898) — so one failed background call
    // lost the bonus permanently.
    //
    // Keyed on claimed_session_id rather than status='claimed': the exit moves the
    // row to 'closed'/'abandoned', and post-beacon prod holds ZERO visits sitting
    // in 'claimed'. The FACT that a session was claimed is what matters; `status`
    // has not been a reliable label since it started carrying exit state.
    //
    // Safe to retry late ONLY because upgrade-gym-tier now gates on the visit's
    // real length once it has ended, instead of an ever-growing now - started_at
    // (see this PR's companion change). Without that, a 32-minute visit would
    // eventually cross the 40-minute gate on its own — the exact phantom upgrade
    // the single-shot design was protecting against.
    : q.not('claimed_session_id', 'is', null).is('upgraded_at', null)
       .gte('started_at', new Date(Date.now() - UPGRADE_RETRY_WINDOW_MS).toISOString())
       .lt('nudge_count_upgrade', MAX_NUDGES_UPGRADE);

  const { data, error } = await q;
  if (error) {
    console.error('[gym-visit-beacon] dueVisits failed', stage, error);
    return [];
  }
  return data ?? [];
}

// A silent wake the device never answers is invisible to the user: no wake → no
// claim → no "Session recorded" push — the visit dies in total silence. Fleet
// 07-20→08-03: of 16 real-user visits the dwell stage nudged, exactly ONE ever
// landed a wake_received (iOS suspends a locked app; content-available delivery
// is best-effort by contract). From the second unanswered attempt onward,
// escalate ONCE per visit to a VISIBLE push: the OS displays it with no app
// involvement, and the tap foregrounds the app, whose pending-claim backstop
// completes the credit. Dwell stage only — its visits are still open, so "open
// POWR to record this session" is honest; the upgrade stage may be chasing a
// visit whose user left hours ago (see dueVisits), where it would be a lie.
async function maybeSendVisibleFallback(admin, visit, attempt: number | null): Promise<boolean> {
  if ((attempt ?? 0) < VISIBLE_FALLBACK_FROM_ATTEMPT) return false;

  // The device is answering wakes — the silent chain is alive; let it finish.
  const { count: woke } = await admin
    .from('gym_visit_events')
    .select('id', { count: 'exact', head: true })
    .eq('visit_id', visit.id)
    .eq('event', 'wake_received');
  if (woke) return false;

  // Once per visit, ever. (No stage key needed: this only runs for dwell.)
  const { count: already } = await admin
    .from('gym_visit_events')
    .select('id', { count: 'exact', head: true })
    .eq('visit_id', visit.id)
    .eq('event', 'visible_nudge_sent');
  if (already) return false;

  // Through send-push-notification rather than deliverExpoMessages directly, so
  // the user's session_completed mute and the push log apply like any other push.
  let outcome = null;
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        target_user_id: visit.user_id,
        type: 'session_ready_to_record',
        payload: { visit_id: visit.id, stage: 'dwell' },
      }),
    });
    if (!res.ok) return false; // leave unmarked — the next silent attempt retries
    outcome = await res.json().catch(() => null);
  } catch (err) {
    console.error('[gym-visit-beacon] visible fallback send failed', err);
    return false;
  }

  // A deliberate skip (user muted session pushes) counts as handled — retrying
  // would just re-ask a question the user has answered. No ticket and no skip
  // means the send genuinely failed; stay unmarked so the next attempt retries.
  const landed = outcome?.skipped === true || Number(outcome?.result?.queued ?? 0) > 0;
  if (!landed) return false;

  await admin.from('gym_visit_events').insert({
    visit_id: visit.id, user_id: visit.user_id,
    event: 'visible_nudge_sent',
    detail: { stage: 'dwell', attempt, skipped: outcome?.skipped === true },
  });
  return true;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Token-gated (no user JWT — invoked by pg_cron), mirroring the other cron fns.
  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await admin.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const { dwellMin, upgradeMin } = await thresholds(admin);
  const stats = { dwell: 0, upgrade: 0, sent: 0, no_token: 0, visible: 0 };

  for (const stage of ['dwell', 'upgrade'] as const) {
    const visits = await dueVisits(admin, stage, stage === 'dwell' ? dwellMin : upgradeMin);
    if (visits.length === 0) continue;
    stats[stage] = visits.length;

    for (const visit of visits) {
      const { data: tokens } = await admin
        .from('user_push_tokens')
        .select('expo_push_token, device_token, platform')
        .eq('user_id', visit.user_id);

      if (!tokens || tokens.length === 0) {
        // No device to wake. The exit path still claims when they leave.
        //
        // This branch used to `continue` before the counter update below, so
        // nudge_count stayed 0 and last_nudge_at stayed null — meaning dueVisits
        // re-selected the visit EVERY MINUTE for its whole life. Visit 77736089
        // produced 722 nudge_failed rows (05:18 → 17:19, one per minute), 28.5% of
        // every gym_visit_events row ever written.
        //
        // Touching last_nudge_at hands the visit to the 5-minute backoff without
        // spending wake budget: a token can still appear later (the user opens the
        // app mid-session and registers), and burning the budget on four token-less
        // minutes would guarantee they never get woken when it does.
        stats.no_token++;
        await admin.rpc('touch_gym_visit_nudge', { p_visit_id: visit.id });

        // One row per visit per stage is enough to diagnose; the rest was noise.
        const { count: alreadyLogged } = await admin
          .from('gym_visit_events')
          .select('id', { count: 'exact', head: true })
          .eq('visit_id', visit.id)
          .eq('event', 'nudge_failed')
          .eq('detail->>stage', stage);

        if (!alreadyLogged) {
          await admin.from('gym_visit_events').insert({
            visit_id: visit.id, user_id: visit.user_id,
            event: 'nudge_failed', detail: { stage, reason: 'no_tokens' },
          });
        }
        continue;
      }

      // ANDROID goes DIRECT via FCM v1: Expo-routed data-only pushes are never
      // delivered to a backgrounded Android app (field matrix 2026-07-13/14 —
      // visible pushes fine, silent wakes never), while a direct HIGH-priority
      // FCM data message reaches the background task in ~1 s AND grants the app
      // the execution window the woken claim chain needs. iOS stays on Expo:
      // _contentAvailable wakes proved end-to-end same day (claim 3 s after the
      // t+30 wake). If FCM credentials are missing/broken the Android rows fall
      // back to Expo — unsetting the secret is the rollback switch.
      const payload = { type: 'gym_visit_check', visit_id: visit.id, stage };
      const TTL_SEC = 10 * 60; // pointless to deliver a presence check long after the fact
      let sentDirect = 0;
      let failedDirect = 0;
      const viaExpo = [];

      for (const t of tokens) {
        if (t.platform !== 'android' || !t.device_token) {
          viaExpo.push(t);
          continue;
        }
        const outcome = await sendFcmDataMessage(t.device_token, {
          ...payload,
          // Expo's envelope nests the payload under `body`; mirroring it keeps
          // the client task's extractData working whichever shape it receives.
          body: JSON.stringify(payload),
        }, TTL_SEC);

        if (outcome.unavailable) {
          viaExpo.push(t); // no FCM credentials — old path, unchanged behaviour
          continue;
        }
        if (outcome.ok) sentDirect++; else failedDirect++;
        if (outcome.unregistered) {
          // Token is dead at the platform — prune, mirroring the Expo receipts path.
          await admin.from('user_push_tokens').delete().eq('device_token', t.device_token);
        }
        // Same per-user forensics the Expo path gets, one row per send. FCM 200
        // = accepted by the platform (stronger than an Expo ticket).
        await admin.from('push_send_log').insert({
          user_id: visit.user_id,
          type: `gym_visit_check_${stage}`,
          expo_push_token: t.device_token,
          status: outcome.ok ? 'accepted' : 'rejected',
          ticket_id: outcome.messageName ?? null,
          error: outcome.ok ? null : outcome.error,
        }).then(({ error }) => { if (error) console.error('[gym-visit-beacon] fcm log insert failed', error); });
      }

      let result = { queued: 0, failed: 0 };
      if (viaExpo.length > 0) {
        // SILENT / data-only: no title, no body — nothing is displayed.
        // _contentAvailable is what makes iOS wake a backgrounded app. The visible
        // "Session recorded" push is fired later by claim-points, only if the
        // device confirms and the claim actually lands.
        const messages = viaExpo.map(({ expo_push_token }) => ({
          to: expo_push_token,
          data: payload,
          priority: 'high',
          _contentAvailable: true,
          ttl: TTL_SEC,
        }));
        result = await deliverExpoMessages(admin, messages, {
          userId: visit.user_id,
          type: `gym_visit_check_${stage}`,
        });
      }
      stats.sent += result.queued + sentDirect;

      // Atomic: `set nudge_count = nudge_count + 1` is evaluated by the database
      // against the current row under a row lock. The old read-modify-write off the
      // stale SELECT let two overlapping ticks both write N+1 — visit 67458ff7
      // logged two nudge_sent rows BOTH stamped `attempt 1`, and 5 dwell nudges
      // against a cap of 4. The RPC also stamps last_nudge_at, so the backoff and
      // the counter can never disagree.
      const { data: attempt } = await admin.rpc('record_gym_visit_nudge', {
        p_visit_id: visit.id,
        p_stage: stage,
      });

      await admin.from('gym_visit_events').insert({
        visit_id: visit.id, user_id: visit.user_id,
        event: 'nudge_sent',
        detail: {
          stage,
          queued: result.queued,
          failed: result.failed + failedDirect,
          fcm_direct: sentDirect,
          attempt: attempt ?? null,
        },
      });

      if (stage === 'dwell' && await maybeSendVisibleFallback(admin, visit, attempt)) {
        stats.visible++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, thresholds: { dwellMin, upgradeMin }, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
