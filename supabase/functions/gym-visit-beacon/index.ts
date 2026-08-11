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
import { deliverVisiblePush } from '../_shared/visiblePush.ts';
import { sendFcmDataMessage } from '../_shared/fcmV1.ts';
import { sendApnsBackgroundPush } from '../_shared/apnsV1.ts';
import { staleVisitVerdict } from '../_shared/gymReaper.ts';

// Budgets are PER STAGE and live in their own columns (nudge_count /
// nudge_count_upgrade). They used to share `nudge_count`, which silently handed the
// upgrade stage whatever the dwell stage didn't spend — usually 7 — and made the
// "per stage" comment a lie. Total exposure 9 ≈ the old effective 8, so this is not
// a material change against Apple's ~2-3 background pushes/hour guidance.
const MAX_NUDGES_DWELL = 4;              // then leave it to the exit path
const MAX_NUDGES_UPGRADE = 5;            // the weaker leg — one more attempt than dwell
const NUDGE_BACKOFF_MS = 5 * 60 * 1000;  // don't re-wake a silent device more than every 5 min

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
    .select('id, user_id, partner_id, started_at, ended_at, nudge_count, nudge_count_upgrade, last_nudge_at')
    // BOTH stages require a live visit (ended_at null). The dwell stage always
    // did — a claim needs the user provably still inside. The upgrade stage
    // spent 2026-08-03 → 2026-08-11 retrying past the exit instead, on the
    // theory that upgrade-gym-tier gates an ended visit on its RECORDED length
    // so a late answer could still bank the bonus. The theory was sound; the
    // client is not: the exit path clears ACTIVE_GEOFENCE_KEY, and runVisitCheck
    // returns at "no active session — ignoring" (GeofenceContext.tsx) before it
    // ever looks at the wake's visit_id. Measured over the experiment's whole
    // life: ZERO of 21 upgrades landed after ended_at. Visit 3468ccdd
    // (2026-08-11) is the shape of every one: session 41.0 min — genuinely owed
    // the 40-min bonus — closed at 06:50:59, then four more wakes 06:54–07:11
    // burned the full budget against a client guaranteed not to answer.
    //
    // So: no wake after the exit. An ended visit's bonus cannot be recovered by
    // waking the device at all — the recovery, if we want it, is a server-side
    // settle (the gate already needs no presence once ended_at is fixed) or a
    // client change that answers for a visit it no longer holds locally.
    .is('ended_at', null)
    .lte('started_at', thresholdAt)
    .or(`last_nudge_at.is.null,last_nudge_at.lt.${backoffAt}`)
    .limit(200);

  // Each stage counts against its OWN column, so a dwell stage that burns its
  // budget no longer eats into the upgrade stage's.
  q = stage === 'dwell'
    ? q.eq('status', 'open').is('claimed_session_id', null)
       .lt('nudge_count', MAX_NUDGES_DWELL)
    // Keyed on claimed_session_id rather than status='claimed': the exit moves the
    // row to 'closed'/'abandoned', and post-beacon prod holds ZERO visits sitting
    // in 'claimed'. The FACT that a session was claimed is what matters; `status`
    // has not been a reliable label since it started carrying exit state.
    : q.not('claimed_session_id', 'is', null).is('upgraded_at', null)
       .lt('nudge_count_upgrade', MAX_NUDGES_UPGRADE)
       // Newest first, so if the 200 cap is ever reached the visits still worth
       // a wake are the ones that survive it.
       .order('started_at', { ascending: false });

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
  const stats = { dwell: 0, upgrade: 0, sent: 0, no_token: 0, announced: 0, completed: 0, fence_refresh: 0, presence: 0, stale_closed: 0, stale_clamped: 0 };

  // SESSION COMPLETE: the walk-out closure banner, both platforms, one
  // template. Only CLAIMED visits (sub-threshold pop-ins end silently). The
  // 30-minute window stops a deploy from blasting history.
  //
  // THE GRACE IS CONDITIONAL (2026-08-07). It exists so an exit-time claim or
  // upgrade can settle before we quote a points total — but a visit that has
  // ALREADY upgraded has nothing left to settle, and waiting on it is pure
  // latency on the most satisfying notification in the product. Field
  // 2026-08-07: upgrade landed 16:25:07, the user walked out at 16:31:04, and
  // the banner still sat behind the grace. So: upgraded visits are due
  // immediately, everything else keeps the full wait.
  //
  // Deliberately keyed on upgraded_at rather than "is it past the upgrade
  // threshold" — the latter is a guess about what MIGHT still land, and the
  // whole point of the grace is to not guess.
  {
    const COMPLETE_GRACE_MS = 2 * 60 * 1000;
    const COMPLETE_WINDOW_MS = 30 * 60 * 1000;
    const graceCutoff = new Date(Date.now() - COMPLETE_GRACE_MS).toISOString();
    const { data: doneVisits, error: doneErr } = await admin
      .from('gym_visits')
      .select('id, user_id, started_at, ended_at, claimed_session_id, partners(name)')
      .is('completed_push_at', null)
      .not('ended_at', 'is', null)
      .not('claimed_session_id', 'is', null)
      .or(`upgraded_at.not.is.null,ended_at.lte.${graceCutoff}`)
      .gte('ended_at', new Date(Date.now() - COMPLETE_WINDOW_MS).toISOString())
      .limit(50);
    if (doneErr) console.error('[gym-visit-beacon] complete scan failed', doneErr);

    for (const visit of doneVisits ?? []) {
      const { data: tokens, error: tokensErr } = await admin
        .from('user_push_tokens')
        .select('expo_push_token, device_token, platform')
        .eq('user_id', visit.user_id);
      if (tokensErr) {
        console.error('[gym-visit-beacon] complete token lookup failed', tokensErr);
        continue;
      }
      if (!tokens || tokens.length === 0) continue;

      const { data: pts, error: ptsErr } = await admin
        .from('point_transactions')
        .select('amount')
        .eq('session_id', visit.claimed_session_id);
      if (ptsErr) {
        console.error('[gym-visit-beacon] complete points lookup failed', ptsErr);
        continue;
      }
      const totalPts = (pts ?? []).reduce((sum: number, r: { amount: number }) => sum + (r.amount ?? 0), 0);

      // Stamp (conditionally): a crash between send and stamp must not double-banner on the next tick.
      const { data: stamped, error: stampErr } = await admin
        .from('gym_visits')
        .update({ completed_push_at: new Date().toISOString() })
        .eq('id', visit.id)
        .is('completed_push_at', null)
        .select('id');
      if (stampErr) {
        console.error('[gym-visit-beacon] complete stamp failed', stampErr);
        continue;
      }
      if (!stamped || stamped.length === 0) continue;

      // THE SESSION IS AUTHORITATIVE, not the visit (2026-08-07).
      //
      // This used to quote the visit's own span, which meant the user was told one
      // number and the app stored another: field 2026-08-07, the push said 47 min
      // while activity_sessions held 63.4 min, because gymReconcile.ts had matched
      // the row to a HealthKit workout that began 19 minutes before the geofence
      // ever saw them. Three numbers for one workout, and the one the user read was
      // the one we did not keep.
      //
      // The session wins because the codebase already says it should — see
      // MAX_GYM_SESSION_SEC: the cap "only bounds the runaway wall-clock", and "the
      // true length is corrected after the fact ... against the health store". It is
      // also the row every other surface renders (history, stats, Progress); the
      // visit is internal lifecycle plumbing the user never sees.
      //
      // Reconciliation can still land after this push, in which case the app shows a
      // corrected figure later. That is a visible correction to a shared value, not
      // two permanently different sources — which is what it was before.
      const { data: sessRow } = await admin
        .from('activity_sessions')
        .select('duration_sec')
        .eq('id', visit.claimed_session_id)
        .maybeSingle();
      const mins = sessRow?.duration_sec
        ? Math.max(1, Math.round(sessRow.duration_sec / 60))
        : Math.max(1, Math.round(
        (new Date(visit.ended_at as string).getTime() - new Date(visit.started_at as string).getTime()) / 60_000,
      ));
      const gymName = (visit as { partners?: { name?: string } | null }).partners?.name ?? 'your gym';

      // ⚠ THE ROUTE MATTERS AS MUCH AS THE COPY (2026-08-09). This send used to
      // go through Expo like every other visible push, and on 08-09 it took ~25
      // minutes to reach an Android tray while the FCM-direct wakes around it
      // landed in under a second — including two that were queued LATER and
      // flushed the instant the radio came back. deliverVisiblePush puts Android
      // on the same direct, HIGH-priority transport as those wakes and leaves
      // iOS on Expo; the full evidence is in _shared/visiblePush.ts.
      //
      // It also supplies the channel this call was missing. Omitting channelId
      // does not mean "the app's default" — per Expo's docs it means Expo's own
      // auto-created "Default" channel, at importance DEFAULT, so the most
      // satisfying notification in the product had no heads-up banner.
      const result = await deliverVisiblePush(admin, tokens, {
        title: 'Session complete 💪',
        body: `${gymName} · ${mins} min` + (totalPts > 0 ? ` · +${totalPts} pts today` : ''),
        data: { type: 'session_completed', route: '/(tabs)/index' },
        sound: 'default',
        channelId: 'powr_default_v2',
        priority: 'high',
      }, { userId: visit.user_id, type: 'gym_session_complete' });
      if (result.direct + result.queued > 0) stats.completed++;
    }
  }

  // ANNOUNCE — DELETED 2026-08-07.
  //
  // This existed on one premise: "headless Android check-ins cannot display a
  // local notification (the schedule call silently no-ops without a UI context
  // — client bug class known since 2026-07-14)". The field run on 2026-08-07
  // disproved it. A Pixel swiped away from recents checked in headless at
  // 15:42:55 and DID display the client's local banner; the user then received
  // this server copy as well at 15:45:02 and reported two check-in
  // notifications — one without the gym name (the local one) and one with it.
  //
  // It could never have been anything else. The de-dupe depends on the client
  // winning a 90-second race to call mark_gym_visit_announced, and the client
  // deliberately SKIPS that mark when backgrounded without a usable token
  // (GeofenceContext.tsx, "losing the mark costs one duplicate banner"). So on
  // precisely the headless check-in this pass was built to rescue, the mark is
  // guaranteed not to land and the duplicate is guaranteed to fire. Field
  // 2026-08-07 15:42:54: announced_at was stamped by THIS function, not the
  // client — 2m07s after check-in, with no client mark at any point.
  //
  // Both platforms' local banners are now confirmed working headless (Android
  // 2026-08-07 above; iOS confirmed by the same run, slightly behind Android).
  // One announcer per platform, and it is the client's — the one that fires at
  // the moment of check-in rather than up to 90s later.
  //
  // If a headless local banner ever regresses, restore this pass — but fix the
  // mark first, or it will duplicate again exactly as it did here.

  // ── PRESENCE: keep a post-upgrade session provably alive (2026-08-07) ─────
  //
  // Once a visit is upgraded, the dwell and upgrade stages are both spent and the
  // beacon stops waking the device. Nothing else refreshes last_confirmed_at
  // either — the fence-refresh pass carries no visit_id on purpose, so its visit
  // check no-ops. Measured 2026-08-07 on Android: last_confirmed_at froze at the
  // upgrade (16:23:03) and never moved again, though the user stayed until 16:31.
  //
  // That makes silence ambiguous exactly where the reaper below has to act on it:
  // a user still training and a user who left an hour ago look identical. This
  // pass removes the ambiguity by ASKING. A device that answers refreshes
  // last_confirmed_at (confirm_gym_visit_v2 writes it on every inside-confirm,
  // before any credit branch) and resets the reaper's clock; one that never
  // answers is genuinely gone and gets reaped on honest evidence.
  //
  // NO CREDIT CAN LEAK FROM THIS. confirm_gym_visit_v2's two credit branches are
  // gated on status 'open' and 'claimed' respectively; these visits are already
  // 'upgraded', so both are unreachable and the call is a pure presence confirm.
  // The wire `stage` stays 'dwell' because that is what the client task already
  // understands — introducing a third stage would need a migration
  // (record_gym_visit_nudge hard-rejects anything but dwell/upgrade) for no gain.
  //
  // Bounded by TIME, not budget, deliberately: the nudge counters are per-stage
  // and already spent by the time we get here, so this rides last_nudge_at via
  // touch_gym_visit_nudge — the same 'no wake budget, just a backoff' mechanism
  // the token-less branch uses. A live session is cheap to keep proving (one
  // wake per 15 min); a dead one stops costing anything after PRESENCE_MAX_AGE.
  {
    const PRESENCE_SILENCE_MS = 15 * 60 * 1000;  // ask only if we haven't heard for this long
    const PRESENCE_BACKOFF_MS = 15 * 60 * 1000;  // and never re-ask faster than this
    const PRESENCE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // past this the 12h cron owns it
    const silenceCut = new Date(Date.now() - PRESENCE_SILENCE_MS).toISOString();
    const backoffCut = new Date(Date.now() - PRESENCE_BACKOFF_MS).toISOString();

    const { data: quiet, error: quietErr } = await admin
      .from('gym_visits')
      .select('id, user_id, started_at, last_confirmed_at')
      .is('ended_at', null)
      .not('upgraded_at', 'is', null)
      .gte('started_at', new Date(Date.now() - PRESENCE_MAX_AGE_MS).toISOString())
      .or(`last_confirmed_at.is.null,last_confirmed_at.lt.${silenceCut}`)
      .or(`last_nudge_at.is.null,last_nudge_at.lt.${backoffCut}`)
      .limit(50);
    if (quietErr) console.error('[gym-visit-beacon] presence scan failed', quietErr);

    for (const visit of quiet ?? []) {
      const { data: tokens } = await admin
        .from('user_push_tokens')
        .select('expo_push_token, device_token, platform')
        .eq('user_id', visit.user_id);
      // Always take the backoff, even with no device to wake — otherwise this
      // re-selects the same visit every minute forever (the 722-row lesson from
      // the token-less branch above).
      await admin.rpc('touch_gym_visit_nudge', { p_visit_id: visit.id });
      if (!tokens || tokens.length === 0) continue;

      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = Array.from(nonceBytes, b => b.toString(16).padStart(2, '0')).join('');
      const nonceHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
      const nonceHash = Array.from(new Uint8Array(nonceHashBuf), b => b.toString(16).padStart(2, '0')).join('');
      const { error: nonceErr } = await admin.rpc('set_gym_visit_wake_nonce', {
        p_visit_id: visit.id, p_nonce_hash: nonceHash, p_ttl_seconds: 900,
      });
      if (nonceErr) console.error('[gym-visit-beacon] presence nonce stamp failed (wake will fall back to JWT)', nonceErr);

      const payload = { type: 'gym_visit_check', visit_id: visit.id, stage: 'dwell', nonce: nonceErr ? undefined : nonce };
      const TTL_SEC = 10 * 60;
      for (const t of tokens) {
        if (!t.device_token || (t.platform !== 'android' && t.platform !== 'ios')) continue;
        const outcome = t.platform === 'android'
          ? await sendFcmDataMessage(t.device_token, { ...payload, body: JSON.stringify(payload) }, TTL_SEC)
          : await sendApnsBackgroundPush(t.device_token, payload, TTL_SEC);
        if (outcome.unavailable) continue;
        const { error: logErr } = await admin.from('push_send_log').insert({
          user_id: visit.user_id,
          type: 'gym_visit_check_presence',
          expo_push_token: t.device_token,
          status: outcome.ok ? 'accepted' : 'rejected',
          ticket_id: outcome.messageName ?? outcome.apnsId ?? null,
          error: outcome.ok ? null : (outcome.error ?? null),
        });
        if (logErr) console.error('[gym-visit-beacon] presence log insert failed', logErr);
        if (outcome.ok) stats.presence++;
      }
    }
  }

  // ── STALE CLOSE: the orphaned-visit reaper (2026-08-07) ───────────────────
  //
  // A visit can only be closed by the client, and the client can forget it. Field
  // 2026-08-07: an Android visit sat `upgraded` with ended_at null while the user
  // stood 400m away. Opening the app did NOT close it — ACTIVE_GEOFENCE_KEY was
  // already gone, so reconcileActiveSessionFromWake() returns at its first line
  // and the exit path never runs. Server open, client unaware: a deadlock only
  // the 12h abandon cron could break, and it had to be closed by hand.
  //
  // Three costs while it sits there: no "Session complete" push (that pass needs
  // ended_at), the user's one live slot in gym_visits_one_live_per_user_idx is
  // occupied so a genuine return check-in gets reused instead of created, and —
  // the expensive one — the client's pending-claim flush keeps re-recording the
  // session with a FRESH now() end, so duration climbs with wall-clock. Measured
  // the same day: 2400s (exactly 40.0 min) at 16:22, 3598s (exactly 60.0 min) at
  // 16:42, still climbing. That is where the 12-hour session rows come from.
  //
  // WHY THIS IS SAFE TO DO EARLY, when 20260803100000 warns at length that
  // closing early "is equivalent to abandoning the points": it is gated on
  // upgraded_at. Past the upgrade there is nothing left to earn — the claim and
  // the 40-min bonus are both banked — so ending the visit forfeits nothing. The
  // dwell and upgrade stages are untouched; this only reaps what they finished.
  //
  // ended_at is the last PROVEN-inside moment, never now(): under-report a
  // session rather than inflate one. It costs a few minutes of tail on a real
  // walk-out and cannot manufacture dwell that never happened.
  //
  // WHAT KEEPS A LIVE SESSION ALIVE — and the 2026-08-10 correction to it.
  //
  // This used to read last_confirmed_at, on the reasoning that confirm_gym_visit_v2
  // writes it on EVERY inside-confirm, so any wake reaching the device's JS resets
  // the window. True, and that is exactly the defect: `inside` is the client's
  // GENEROUS liveness verdict (radius + 50 m hysteresis, and true by default when
  // the fix is too coarse to run the geometry), and three further writers —
  // mark_gym_visit_progress, claim-points, upgrade-gym-tier — stamp the same column
  // from the server with no device involved at all. Every one of them bought
  // another 45 minutes. Visit 2efeea36: a `claimed` relay at 09:42:30Z moved the
  // deadline from 09:53 to 10:27 with the owner miles away.
  //
  // So the clock now runs on last_proven_at, which has ONE writer and one meaning:
  // the device proved it was inside with a fix good enough to bill
  // (fixCreditsPresence — the same test PR #374 applied to credit). The presence
  // pass above still does its job of ASKING; what changed is that an answer we
  // cannot bank on no longer counts as an answer. Silence here means "asked, and
  // got nothing we could prove", not "never asked".
  //
  // The whole decision lives in _shared/gymReaper.ts so it can be unit-tested.
  {
    const { data: orphans, error: orphanErr } = await admin
      .from('gym_visits')
      .select('id, user_id, started_at, claimed_at, upgraded_at, last_proven_at, claimed_session_id')
      .is('ended_at', null)
      .not('upgraded_at', 'is', null)
      .limit(100);
    if (orphanErr) console.error('[gym-visit-beacon] stale-close scan failed', orphanErr);

    for (const v of orphans ?? []) {
      const verdict = staleVisitVerdict(v, Date.now());
      if (!verdict.close) continue; // proved presence recently — still live

      const provenMs = verdict.provenMs;
      const endedAtIso = new Date(provenMs).toISOString();
      const { data: closed, error: closeErr } = await admin
        .from('gym_visits')
        .update({ status: 'closed', close_reason: verdict.closeReason, ended_at: endedAtIso })
        .eq('id', v.id)
        .is('ended_at', null)          // conditional: a real client exit racing us wins
        .select('id');
      if (closeErr) { console.error('[gym-visit-beacon] stale-close failed', closeErr); continue; }
      if (!closed || closed.length === 0) continue;

      // Undo any drift the pending-claim flush already wrote into the session.
      // Clamp DOWN only: iOS health reconciliation legitimately moves started_at
      // earlier (gymReconcile.ts), and this must never fight a longer, truer
      // session — only a stored end that outruns the last proof of presence.
      if (v.claimed_session_id) {
        const { data: sess } = await admin
          .from('activity_sessions')
          .select('id, started_at, ended_at')
          .eq('id', v.claimed_session_id)
          .maybeSingle();
        // Only DRIFT, never a health correction. The session is the authoritative
        // length (see the SESSION COMPLETE pass), and gymReconcile.ts legitimately
        // extends it against the health store — by minutes, to cover a warm-up the
        // fence never saw. Drift is a different animal entirely: it ratchets with
        // wall-clock for as long as the visit stays open and reaches HOURS (2400s →
        // 3598s in twenty minutes, on its way to the 12h cap). The margin lets an
        // honest reconciliation stand and still catches the pathology.
        const DRIFT_MARGIN_MS = 30 * 60 * 1000;
        if (sess?.ended_at && Date.parse(sess.ended_at) > provenMs + DRIFT_MARGIN_MS) {
          const durationSec = Math.max(0, Math.round((provenMs - Date.parse(sess.started_at)) / 1000));
          const { error: sessErr } = await admin
            .from('activity_sessions')
            .update({ ended_at: endedAtIso, duration_sec: durationSec })
            .eq('id', sess.id);
          if (sessErr) console.error('[gym-visit-beacon] stale-close session clamp failed', sessErr);
          else stats.stale_clamped++;
        }
      }
      stats.stale_closed++;
    }
  }

  // ── Fence-refresh pass (2026-08-05 night) ─────────────────────────────────
  // GMS geofence delivery to a swiped-away app goes mute (registry populated,
  // crossings undelivered — root cause under investigation). The client's wake
  // task re-arms its fences with a fresh PendingIntent on EVERY wake (#327),
  // but organic wakes only fire while a visit is OPEN — i.e. only after the
  // check-in this very defect blocks. This pass closes that trigger gap: ping
  // idle Android devices on a slow cadence so the self-heal keeps their fence
  // registration fresh BETWEEN sessions, and arrival finds live fences.
  //
  // The payload is a visit-less gym_visit_check carrying a PLACEHOLDER nonce.
  // The nonce's only client-side job is selecting the auth-free wake path (no
  // awaited refresh — the 08-05 freeze class); with no visit_id the task skips
  // wake telemetry, the re-arm runs, and the visit check no-ops. If the device
  // happens to hold a stale local visit, its confirm is rejected on the nonce
  // hash — harmless, the real nudges own real visits. A typed payload can
  // replace this trick once a client OTA adds explicit handling.
  //
  // IT STILL CREDITS NOTHING — this wakes a device so the DEVICE can re-arm
  // (and, post-#329, reconcile a zombie session against a real GPS fix).
  //
  // FLEET-WIDE since v15 (2026-08-06): every android device with a fresh
  // native token, on a gentle cadence (fences at most ~4h stale, 6 silent
  // wakes/day). The bench account keeps its tight loop for test velocity.
  // ⚠ DISABLED 2026-08-06. This pass existed to keep fences fresh via a
  // background re-arm. Field work that day showed a background re-arm cannot
  // heal anything — every re-arm is remove-then-add (expo's consumer
  // setOptions/didUnregister removes + cancels the PendingIntent first), so a
  // wake-triggered re-arm can only ever risk the user's live registration.
  // Until a device-side build can VERIFY registration (the instrumentation
  // patch did not make it into build 16), waking phones to re-arm is pure
  // downside.
  //
  // RE-ENABLED with a DIFFERENT job: the wake no longer re-arms anything (#336
  // refuses that outright). It triggers the presence sweep (#338) — the device
  // answers "am I in a gym right now?" from a cached fix and evaluateLocationFix
  // decides, exactly as it does for every other check-in. That is entry
  // detection which does not depend on the fence layer at all, riding the one
  // primitive with hundreds of proven successes: an FCM data wake to a swiped
  // app. It also carries the zombie-session reconcile (#329).
  const FENCE_REFRESH_ENABLED = true;
  if (FENCE_REFRESH_ENABLED) {
    // ⚠ BOTH PLATFORMS since 2026-08-07. This pass was android-only, and that
    // asymmetry cost a field test: iOS armed 20 regions at 08:43:06 (POWR among
    // them, initial state correctly reported as outside), the user walked back
    // in at ~08:54 — Android saw the crossing that second — and iOS delivered
    // NOTHING for 27 minutes until the app was opened by hand. Android survived
    // the same mute fence layer because a ping every 5 minutes woke it to ask
    // "am I in a gym right now?". iOS had no such backstop, so a quiet fence
    // layer there is simply an invisible dead end.
    //
    // Root cause of the iOS fence silence is still unknown, and this does not
    // pretend to fix it — it makes iOS entry survive it, which is the same bet
    // that already works on Android.
    const FAST_USER_IDS = new Set([
      '234d49f3-d189-44b1-a874-063e724e4380', // Sony bench   (android)
      'a2585666-5b7a-4622-8e43-6bd4fb8013f0', // iPhone bench (ios)
    ]);
    const FAST_INTERVAL_MIN = 5;    // bench cadence while the sweep is being proven
    const FLEET_INTERVAL_MIN = 0;   // 0 = fleet OFF; only FAST_USER_IDS are pinged
    const TOKEN_FRESH_DAYS = 14; // dormant devices aren't worth the wake budget

    const { data: refreshTargets, error: refreshScanErr } = await admin
      .from('user_push_tokens')
      .select('user_id, device_token, platform')
      .in('platform', ['android', 'ios'])
      .not('device_token', 'is', null)
      .gte('updated_at', new Date(Date.now() - TOKEN_FRESH_DAYS * 86_400_000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(500);
    if (refreshScanErr) console.error('[gym-visit-beacon] fence_refresh target scan failed', refreshScanErr);

    // One query for everyone's last ping instead of a count per user per tick.
    const { data: recentPings, error: recentPingsErr } = await admin
      .from('push_send_log')
      .select('user_id, created_at')
      .eq('type', 'fence_refresh')
      // ⚠ Lookback is its OWN value. It was FLEET_INTERVAL_MIN, and when that
      // went to 0 to disable fleet pings the window became 'the last zero
      // minutes' — nobody ever looked recently-pinged, so the bench phone was
      // woken on EVERY cron tick, once a minute (field 2026-08-06). A rate
      // limiter must never derive its memory from a value that can be zero.
      .gte('created_at', new Date(Date.now() - Math.max(FAST_INTERVAL_MIN, FLEET_INTERVAL_MIN, 60) * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(2000);
    if (recentPingsErr) console.error('[gym-visit-beacon] fence_refresh recent ping scan failed', recentPingsErr);
    const lastPingByUser = new Map();
    for (const row of recentPings ?? []) {
      const at = new Date(row.created_at).getTime();
      if (at > (lastPingByUser.get(row.user_id) ?? 0)) lastPingByUser.set(row.user_id, at);
    }

    const tokensByUser = new Map();
    for (const t of refreshTargets ?? []) {
      const arr = tokensByUser.get(t.user_id) ?? [];
      if (!arr.some((e) => e.token === t.device_token)) arr.push({ token: t.device_token, platform: t.platform });
      tokensByUser.set(t.user_id, arr);
    }

    const refreshPayload = { type: 'gym_visit_check', stage: 'dwell', nonce: 'fence-refresh' };
    // Per-platform, so a missing credential on one side cannot silence the
    // other — the whole point of this change is that iOS stops depending on
    // Android's luck.
    const platformDown = { android: false, ios: false };
    for (const [userId, entries] of tokensByUser) {
      if (!FAST_USER_IDS.has(userId) && FLEET_INTERVAL_MIN <= 0) continue; // fleet off
      const intervalMin = FAST_USER_IDS.has(userId) ? FAST_INTERVAL_MIN : FLEET_INTERVAL_MIN;
      if (Date.now() - (lastPingByUser.get(userId) ?? 0) < intervalMin * 60_000) continue;

      for (const { token, platform } of entries) {
        if (platformDown[platform]) continue;
        // iOS takes the documented background-push shape (apns-push-type:
        // background, priority 5) — the same call the dwell/upgrade nudges
        // already use successfully on this device. Android keeps the mirrored
        // `body` key because Expo's envelope nests the payload there and the
        // client's extractData accepts either shape.
        const outcome = platform === 'android'
          ? await sendFcmDataMessage(token, { ...refreshPayload, body: JSON.stringify(refreshPayload) }, 15 * 60)
          : await sendApnsBackgroundPush(token, refreshPayload, 15 * 60);
        if (outcome.unavailable) {
          // Leave a trace, once per platform per tick. Silently skipping made
          // "this platform has no credentials" indistinguishable from "no
          // targets matched" in push_send_log — and that log is the whole
          // monitoring plan for this pass. An absence that means two different
          // things is not evidence of either.
          platformDown[platform] = true;
          await admin.from('push_send_log').insert({
            user_id: userId,
            type: 'fence_refresh',
            expo_push_token: token,
            status: 'skipped',
            skip_reason: `${platform}_credentials_unavailable`,
            error: outcome.error ?? null,
          }).then(({ error }) => { if (error) console.error('[gym-visit-beacon] fence_refresh skip log failed', error); });
          continue;
        }
        await admin.from('push_send_log').insert({
          user_id: userId,
          type: 'fence_refresh',
          expo_push_token: token,
          status: outcome.ok ? 'accepted' : 'rejected',
          ticket_id: outcome.messageName ?? outcome.apnsId ?? null,
          error: outcome.ok ? null : outcome.error,
        }).then(({ error }) => { if (error) console.error('[gym-visit-beacon] fence_refresh log insert failed', error); });
        if (outcome.ok) stats.fence_refresh++;
      }
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
      // WAKE NONCE (2026-08-05): the nudge carries a short-lived, visit-scoped
      // ticket so the device can answer over confirm_gym_visit_v3 with ZERO
      // auth work in the wake window. An expired-token wake froze awaiting its
      // refresh (server 200 in 276ms, client promise never settled — RN frozen
      // response + Keystore write); the wake fits ONE round-trip and the ticket
      // makes the confirm that round-trip. Hash lives on the visit row; raw
      // value rides the push (TLS end-to-end on both platforms).
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = Array.from(nonceBytes, b => b.toString(16).padStart(2, '0')).join('');
      const nonceHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
      const nonceHash = Array.from(new Uint8Array(nonceHashBuf), b => b.toString(16).padStart(2, '0')).join('');
      const { error: nonceErr } = await admin.rpc('set_gym_visit_wake_nonce', {
        p_visit_id: visit.id, p_nonce_hash: nonceHash, p_ttl_seconds: 900,
      });
      if (nonceErr) console.error('[gym-visit-beacon] nonce stamp failed (wake will fall back to JWT)', nonceErr);

      const payload = { type: 'gym_visit_check', visit_id: visit.id, stage, nonce: nonceErr ? undefined : nonce };
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
