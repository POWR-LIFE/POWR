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

const MAX_NUDGES = 4;                    // per stage — then leave it to the exit path
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
    .select('id, user_id, partner_id, started_at, nudge_count, last_nudge_at')
    .is('ended_at', null)
    .lte('started_at', thresholdAt)
    .lt('nudge_count', stage === 'dwell' ? MAX_NUDGES : MAX_NUDGES * 2)
    .or(`last_nudge_at.is.null,last_nudge_at.lt.${backoffAt}`)
    .limit(200);

  q = stage === 'dwell'
    ? q.eq('status', 'open').is('claimed_session_id', null)
    : q.eq('status', 'claimed').is('upgraded_at', null);

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
  const stats = { dwell: 0, upgrade: 0, sent: 0, no_token: 0 };

  for (const stage of ['dwell', 'upgrade'] as const) {
    const visits = await dueVisits(admin, stage, stage === 'dwell' ? dwellMin : upgradeMin);
    if (visits.length === 0) continue;
    stats[stage] = visits.length;

    for (const visit of visits) {
      const { data: tokens } = await admin
        .from('user_push_tokens')
        .select('expo_push_token')
        .eq('user_id', visit.user_id);

      if (!tokens || tokens.length === 0) {
        // No device to wake. The exit path still claims when they leave.
        stats.no_token++;
        await admin.from('gym_visit_events').insert({
          visit_id: visit.id, user_id: visit.user_id,
          event: 'nudge_failed', detail: { stage, reason: 'no_tokens' },
        });
        continue;
      }

      // SILENT / data-only: no title, no body — nothing is displayed. _contentAvailable
      // is what makes iOS wake a backgrounded app; priority high does the same on
      // Android FCM. The visible "Session recorded" push is fired later by
      // claim-points, only if the device confirms and the claim actually lands.
      const messages = tokens.map(({ expo_push_token }) => ({
        to: expo_push_token,
        data: { type: 'gym_visit_check', visit_id: visit.id, stage },
        priority: 'high',
        _contentAvailable: true,
        // Pointless to deliver a presence check long after the fact.
        ttl: 10 * 60,
      }));

      const result = await deliverExpoMessages(admin, messages, {
        userId: visit.user_id,
        type: `gym_visit_check_${stage}`,
      });
      stats.sent += result.queued;

      await admin
        .from('gym_visits')
        .update({ nudge_count: (visit.nudge_count ?? 0) + 1, last_nudge_at: new Date().toISOString() })
        .eq('id', visit.id);

      await admin.from('gym_visit_events').insert({
        visit_id: visit.id, user_id: visit.user_id,
        event: 'nudge_sent',
        detail: { stage, queued: result.queued, failed: result.failed, attempt: (visit.nudge_count ?? 0) + 1 },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, thresholds: { dwellMin, upgradeMin }, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
