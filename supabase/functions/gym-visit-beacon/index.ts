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
    // The embedded session start is what the upgrade gate actually measures from
    // (see the hopeless-visit filter below). It is null for the dwell stage —
    // those rows have no claimed_session_id yet — and unused there.
    .select(
      'id, user_id, partner_id, started_at, ended_at, nudge_count, nudge_count_upgrade, last_nudge_at, ' +
      'activity_sessions!gym_visits_claimed_session_id_fkey(started_at)',
    )
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
       .lt('nudge_count_upgrade', MAX_NUDGES_UPGRADE)
       // Newest first. The hopeless-visit filter below drops rows AFTER the row
       // cap, and a dropped row is never nudged, so it keeps matching this query
       // for its whole 24h window instead of cycling out on the backoff. Ordering
       // means that if the 200 cap is ever reached, the visits still worth a wake
       // are the ones that survive it.
       .order('started_at', { ascending: false });

  const { data, error } = await q;
  if (error) {
    console.error('[gym-visit-beacon] dueVisits failed', stage, error);
    return [];
  }
  const rows = data ?? [];
  if (stage !== 'upgrade') return rows;

  // HOPELESS VISITS. Retrying past the exit is the point of the query above, but
  // only while the answer can still be yes. Once a visit has ended its length is
  // fixed, so one already under the tier can never reach it — upgrade-gym-tier
  // declines every attempt with the same 422, forever. On 2026-08-07 visits
  // 3dc2d104 (30 min) and 0ce2dc84 (36 min) each burned all 5 upgrade nudges
  // waking a phone to be told no.
  //
  // Measured the way the GATE measures, which is NOT the visit's own length: the
  // gate bounds elapsed by ended_at − SESSION.started_at (upgrade-gym-tier
  // index.ts:146-170), and one session spans every gym visit of the UTC day. A
  // 30-minute second visit can therefore sit 800 minutes past its session start
  // and legitimately qualify — visit d568eb6d on 2026-08-01 is exactly that. Using
  // the visit's own length here would have suppressed a bonus the gate accepts.
  //
  // Deliberately NOT mirroring the gate's MAX_GYM_SESSION_SEC clamp: it is 12 h,
  // so it can only ever lower a value that is already far above the tier.
  //
  // In JS rather than the query because PostgREST cannot compare two columns and
  // gym_visits stores no duration.
  const live = rows.filter((v) => {
    if (!v.ended_at) return true;                       // still open — the answer is still open
    const sessionStart = v.activity_sessions?.started_at;
    if (!sessionStart) return true;                     // no session to measure against; leave it alone
    const sec = Math.round((new Date(v.ended_at).getTime() - new Date(sessionStart).getTime()) / 1000);
    // sec <= 0 is a late-write artifact (visit ends before its session starts).
    // The gate leaves visitEndSec null there and falls back to now − session
    // start, so it does NOT decline — mirror that and keep the row.
    if (sec <= 0) return true;
    return Math.floor(sec / 60) >= minutes;
  });
  if (live.length !== rows.length) {
    console.log(`[gym-visit-beacon] upgrade: skipped ${rows.length - live.length} ended visit(s) already under ${minutes} min`);
  }
  return live;
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
        .select('expo_push_token')
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

      const result = await deliverExpoMessages(admin, tokens.map(({ expo_push_token }) => ({
        to: expo_push_token,
        title: 'Session complete 💪',
        body: `${gymName} · ${mins} min` + (totalPts > 0 ? ` · +${totalPts} pts today` : ''),
        data: { type: 'session_completed', route: '/(tabs)/index' },
        priority: 'high',
      })), { userId: visit.user_id, type: 'gym_session_complete' });
      if (result.queued > 0) stats.completed++;
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
  // WHAT KEEPS A LIVE SESSION ALIVE: confirm_gym_visit_v2 writes last_confirmed_at
  // on EVERY inside-confirm, before any credit branch — so any wake that reaches
  // the device's JS refreshes it and resets this window. What the beacon no longer
  // does after the upgrade is CAUSE such a wake: the dwell and upgrade stages are
  // both spent, and the fence-refresh pass below deliberately carries no visit_id
  // (placeholder nonce, visit check no-ops). The presence pass added alongside this
  // one closes that gap by re-nudging still-open upgraded visits, so silence here
  // means "asked and got no answer", not "never asked".
  {
    const STALE_SILENCE_MS = 45 * 60 * 1000;
    const { data: orphans, error: orphanErr } = await admin
      .from('gym_visits')
      .select('id, user_id, started_at, claimed_at, upgraded_at, last_confirmed_at, claimed_session_id')
      .is('ended_at', null)
      .not('upgraded_at', 'is', null)
      .limit(100);
    if (orphanErr) console.error('[gym-visit-beacon] stale-close scan failed', orphanErr);

    const silenceCutoff = Date.now() - STALE_SILENCE_MS;
    for (const v of orphans ?? []) {
      // Last moment the DEVICE proved it was inside. claimed_at/upgraded_at both
      // required a location-confirmed wake, so they are proof too — and
      // last_confirmed_at is not updated by the upgrade confirm, so taking the
      // max of all three is strictly more accurate than last_confirmed_at alone.
      const provenMs = Math.max(
        v.last_confirmed_at ? Date.parse(v.last_confirmed_at) : 0,
        v.upgraded_at ? Date.parse(v.upgraded_at) : 0,
        v.claimed_at ? Date.parse(v.claimed_at) : 0,
        Date.parse(v.started_at),
      );
      if (provenMs > silenceCutoff) continue; // proved presence recently — still live

      const endedAtIso = new Date(provenMs).toISOString();
      const { data: closed, error: closeErr } = await admin
        .from('gym_visits')
        .update({ status: 'closed', close_reason: 'stale_after_upgrade', ended_at: endedAtIso })
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
