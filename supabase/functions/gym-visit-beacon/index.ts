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
import { sendApnsBackgroundPush } from '../_shared/apnsV1.ts';

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
  const stats = { dwell: 0, upgrade: 0, sent: 0, no_token: 0, announced: 0 };

  // ANNOUNCE: the "You're in" banner as a visible push, Android only.
  //
  // Headless Android check-ins cannot display a local notification (the
  // schedule call silently no-ops without a UI context — client bug class
  // known since 2026-07-14), so any android visit the client has NOT marked
  // announced within the grace window gets the banner from here instead, over
  // the same visible-push path as "Session recorded". The grace window gives a
  // foreground check-in's instant local banner time to mark the visit (the
  // client stamps mark_gym_visit_announced after a successful display), so
  // nobody gets both.
  //
  // iOS is excluded: its headless local banner works (force-quit relaunch
  // displayed one on 2026-08-05), and a frozen-network iOS visit has no row
  // here to announce until app-open anyway — announcing THAT hours later would
  // be noise, not feedback.
  {
    const ANNOUNCE_GRACE_MS = 90 * 1000;        // let a foreground local banner mark first
    const ANNOUNCE_WINDOW_MS = 15 * 60 * 1000;  // a check-in banner 15+ min late is noise
    const { data: due, error: announceErr } = await admin
      .from('gym_visits')
      .select('id, user_id, partners(name)')
      .eq('platform', 'android')
      .is('announced_at', null)
      .is('ended_at', null)
      .lte('started_at', new Date(Date.now() - ANNOUNCE_GRACE_MS).toISOString())
      .gte('started_at', new Date(Date.now() - ANNOUNCE_WINDOW_MS).toISOString())
      .limit(50);
    if (announceErr) console.error('[gym-visit-beacon] announce scan failed', announceErr);

    for (const visit of due ?? []) {
      const { data: tokens, error: tokensErr } = await admin
        .from('user_push_tokens')
        .select('expo_push_token')
        .eq('user_id', visit.user_id);
      if (tokensErr) {
        console.error('[gym-visit-beacon] announce token lookup failed', tokensErr);
        continue;
      }
      if (!tokens || tokens.length === 0) continue;

      // Stamp (conditionally, so a racing client mark wins) before sending so retries never double-banner.
      const { data: stamped, error: stampErr } = await admin
        .from('gym_visits')
        .update({ announced_at: new Date().toISOString() })
        .eq('id', visit.id)
        .is('announced_at', null)
        .select('id');
      if (stampErr) {
        console.error('[gym-visit-beacon] announce stamp failed', stampErr);
        continue;
      }
      if (!stamped || stamped.length === 0) continue; // client marked in the meantime

      const gymName = (visit as { partners?: { name?: string } | null }).partners?.name ?? 'your gym';
      const result = await deliverExpoMessages(admin, tokens.map(({ expo_push_token }) => ({
        to: expo_push_token,
        // Mirrors the client's local banner copy — same moment, same voice.
        title: 'POWR',
        body: `You're in at ${gymName}. Every minute counts.`,
        data: { type: 'check_in_reminder', route: '/(tabs)/index' },
        priority: 'high',
      })), { userId: visit.user_id, type: 'gym_checkin_announce' });
      if (result.queued > 0) stats.announced++;
    }
  }

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

      // BOTH platforms go DIRECT when a native token is stored. Android via FCM
      // v1 since 2026-07-14 (Expo-routed data-only pushes were never delivered
      // to a backgrounded app; direct HIGH-priority FCM reaches the background
      // task in ~1 s and grants the execution window the claim chain needs).
      // iOS via APNs since 2026-08-03 for the same reason with the same
      // evidence shape: fleet 07-20→08-03 landed ONE wake_received across 16
      // dwell-nudged real-user visits while Expo reported every send accepted.
      // Direct APNs uses the documented background-push attributes
      // (apns-push-type: background, priority 5) and returns Apple's per-device
      // verdict. Missing/broken credentials fall back to Expo — unsetting
      // FCM_SERVICE_ACCOUNT / APNS_AUTH_KEY is the per-platform rollback switch.
      const payload = { type: 'gym_visit_check', visit_id: visit.id, stage };
      const TTL_SEC = 10 * 60; // pointless to deliver a presence check long after the fact
      let sentDirect = 0;
      let failedDirect = 0;
      const viaExpo = [];

      for (const t of tokens) {
        if (!t.device_token || (t.platform !== 'android' && t.platform !== 'ios')) {
          viaExpo.push(t);
          continue;
        }
        const outcome = t.platform === 'android'
          ? await sendFcmDataMessage(t.device_token, {
              ...payload,
              // Expo's envelope nests the payload under `body`; mirroring it keeps
              // the client task's extractData working whichever shape it receives.
              body: JSON.stringify(payload),
            }, TTL_SEC)
          // extractData (post-PR #275) picks the first candidate shape whose
          // type matches, so top-level keys on the APNs payload parse the same
          // way the direct-FCM shape does.
          : await sendApnsBackgroundPush(t.device_token, payload, TTL_SEC);

        if (outcome.unavailable) {
          viaExpo.push(t); // no credentials for this platform — old path, unchanged behaviour
          continue;
        }
        if (outcome.ok) sentDirect++; else failedDirect++;
        if (outcome.unregistered) {
          // The native token is dead or mismatched at the platform. Clear ONLY
          // device_token so the row's Expo token keeps the device reachable on
          // the fallback path — BadDeviceToken can be an environment/topic
          // mismatch (a sandbox token from a dev build against the production
          // host), and deleting the whole row would silence visible pushes too.
          // Expo's own receipt pruning stays the authority for removing rows
          // whose Expo token is confirmed dead.
          await admin.from('user_push_tokens').update({ device_token: null }).eq('device_token', t.device_token);
        }
        // Same per-user forensics the Expo path gets, one row per send. A 200
        // here = accepted by Apple/Google themselves (stronger than an Expo
        // ticket). ticket_id: FCM message name or APNs apns-id.
        await admin.from('push_send_log').insert({
          user_id: visit.user_id,
          type: `gym_visit_check_${stage}`,
          expo_push_token: t.device_token,
          status: outcome.ok ? 'accepted' : 'rejected',
          ticket_id: outcome.messageName ?? outcome.apnsId ?? null,
          error: outcome.ok ? null : outcome.error,
        }).then(({ error }) => { if (error) console.error('[gym-visit-beacon] direct log insert failed', error); });
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
    }
  }

  return new Response(JSON.stringify({ ok: true, thresholds: { dwellMin, upgradeMin }, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
