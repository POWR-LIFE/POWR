/**
 * Reconciles recorded geofence gym sessions against the device health store so
 * the stored duration reflects real presence — fixing late-entry under-counts and
 * missed-EXIT over-counts that GPS alone can't. Runs in the foreground (where
 * native health reads are reliable) off the back of the health sync.
 *
 * The pure correction logic lives in `gymPresence.ts` (unit-tested); this file is
 * the native step reader + the Supabase round-trip, neither of which can run in
 * Expo Go — verify on an EAS build.
 */

import { Platform } from 'react-native';

import { getSessionUser, supabase } from '@/lib/supabase';
import {
  computeCorrectedWindow,
  type SessionAnchor,
  stepReadWindow,
  type StepSample,
} from './gymPresence';

const FORTY_MIN_SEC = 40 * 60;
/** Ignore sub-minute corrections so GPS jitter never rewrites a row. */
const MIN_CORRECTION_SEC = 60;

const maxOrNull = (a: number | null, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);

// ── Native step-sample readers ────────────────────────────────────────────────
// Return null (not []) on unavailability so the caller leaves the GPS value alone
// rather than treating "no health access" as "no activity".

async function getStepSamplesIOS(fromMs: number, toMs: number): Promise<StepSample[] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
    const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', {
      filter: { date: { startDate: new Date(fromMs), endDate: new Date(toMs) } },
      limit: 0, // non-positive = all samples
      unit: 'count',
    });
    return samples.map(s => ({
      startMs: s.startDate.getTime(),
      endMs: s.endDate.getTime(),
      steps: s.quantity,
    }));
  } catch (e) {
    console.warn('[gymReconcile] iOS step read failed:', e);
    return null;
  }
}

async function getStepSamplesAndroid(fromMs: number, toMs: number): Promise<StepSample[] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initialize, readRecords } = require('react-native-health-connect');
    await initialize();
    const result = await readRecords('Steps', {
      timeRangeFilter: {
        operator: 'between',
        startTime: new Date(fromMs).toISOString(),
        endTime: new Date(toMs).toISOString(),
      },
    });
    const records = (result?.records ?? []) as Array<{ startTime: string; endTime: string; count?: number }>;
    return records.map(r => ({
      startMs: new Date(r.startTime).getTime(),
      endMs: new Date(r.endTime).getTime(),
      steps: r.count ?? 0,
    }));
  } catch (e) {
    console.warn('[gymReconcile] Android step read failed:', e);
    return null;
  }
}

function getStepSamples(fromMs: number, toMs: number): Promise<StepSample[] | null> {
  if (Platform.OS === 'ios') return getStepSamplesIOS(fromMs, toMs);
  if (Platform.OS === 'android') return getStepSamplesAndroid(fromMs, toMs);
  return Promise.resolve(null);
}

// ── Reconciliation ────────────────────────────────────────────────────────────

type GymSessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
};

/**
 * Corrects one gym session's duration/start/end against step activity. Idempotent —
 * and idempotent across re-READS, which is the stronger property this needs and did
 * not have before 2026-08-17: `anchor` comes from `gym_visits`, so neither the span
 * of health data read nor the limit on backdating is derived from a column this
 * function writes. See `SessionAnchor` for what happened when they were.
 */
export async function reconcileGymSession(
  session: GymSessionRow,
  anchor: SessionAnchor | null = null,
): Promise<void> {
  const startMs = new Date(session.started_at).getTime();
  const endMs = session.ended_at
    ? new Date(session.ended_at).getTime()
    : startMs + session.duration_sec * 1000;

  // Read a little before/after the visit's own window to catch early arrival / late
  // departure. Anchored on the visit, never on this row — see stepReadWindow.
  const window = stepReadWindow(startMs, endMs, anchor);
  const samples = await getStepSamples(window.fromMs, window.toMs);
  if (samples === null) return; // health unavailable — keep the GPS-derived value

  const corrected = computeCorrectedWindow(startMs, endMs, samples, anchor);
  if (!corrected.changed) return;
  if (Math.abs(corrected.durationSec - session.duration_sec) < MIN_CORRECTION_SEC) return;

  // If the corrected (true) length newly crosses the 40-min tier, award the upgrade
  // FIRST (it sets duration to its own capped elapsed), then overwrite with the
  // corrected truth below. Points only ever go up — we never claw back. Gated on the
  // pre-correction duration so a session already at/above the tier isn't re-invoked.
  if (corrected.durationSec >= FORTY_MIN_SEC && session.duration_sec < FORTY_MIN_SEC) {
    try {
      await supabase.functions.invoke('upgrade-gym-tier', { body: { session_id: session.id } });
    } catch (e) {
      console.warn('[gymReconcile] tier upgrade during reconcile failed:', e);
    }
  }

  // ⚠ READ BACK WHAT WAS ACTUALLY STORED. The `guard_client_session_window` trigger
  // silently CLAMPS a client write into the visit's proven envelope rather than
  // rejecting it, so a successful update is not evidence the values took. On 08-17
  // this log printed `40m → 9m` for a write the database had already refused —
  // reporting the request as the outcome. Log the row, not the intention.
  const { data: stored, error } = await supabase
    .from('activity_sessions')
    .update({
      started_at: new Date(corrected.startMs).toISOString(),
      ended_at: new Date(corrected.endMs).toISOString(),
      duration_sec: corrected.durationSec,
    })
    .eq('id', session.id)
    .select('duration_sec')
    .maybeSingle();
  if (error) {
    console.warn('[gymReconcile] update failed:', error.message);
    return;
  }
  if (!stored) {
    // No row came back from an update that did not error: it matched nothing. Say so
    // rather than printing the requested figure as though it had landed.
    console.warn(`[gymReconcile] ${session.id.slice(0, 8)}… update matched no row — nothing changed`);
    return;
  }
  const clamped =
    stored.duration_sec !== corrected.durationSec
      ? ` (asked ${Math.round(corrected.durationSec / 60)}m, database clamped)`
      : '';
  console.log(
    `[gymReconcile] ${session.id.slice(0, 8)}… ${Math.round(session.duration_sec / 60)}m → ${Math.round(stored.duration_sec / 60)}m${clamped}`,
  );
}

/**
 * Reconciles recent geofence gym sessions (started within the last 24 h). Best-effort;
 * failures are swallowed so it never blocks the health sync.
 *
 * ⚠ "Safe to call repeatedly" is a property of the PAIR (window + correction), not of
 * `computeCorrectedWindow` alone. This docstring used to claim the latter and it read
 * as reassurance for eight days: the pure function is indeed idempotent on fixed
 * samples, while the loop around it re-read a different span each pass and walked
 * `started_at` backwards forever. The anchors below are what actually make this safe.
 */
export async function reconcileRecentGymSessions(): Promise<void> {
  if (Platform.OS === 'web') return;
  // Scoped on user_id: activity_sessions has an "admins can read all" policy,
  // so an unfiltered limit-3 hands back other users' sessions — and each one is
  // then put through `upgrade-gym-tier` from this device.
  const user = await getSessionUser();
  if (!user) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('activity_sessions')
    .select('id, started_at, ended_at, duration_sec')
    .eq('user_id', user.id)
    .eq('type', 'gym')
    .eq('verification', 'geofence')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(3);
  if (error || !data) return;

  const sessions = data as GymSessionRow[];
  if (sessions.length === 0) return;

  // The anchors. Fetched from gym_visits precisely because this function writes
  // activity_sessions and nothing else — a session's own columns cannot bound a
  // correction to that same session without feeding back into it.
  const anchors = new Map<string, SessionAnchor>();
  const { data: visits, error: visitErr } = await supabase
    .from('gym_visits')
    .select('claimed_session_id, started_at, last_proven_at')
    .eq('user_id', user.id)
    .in('claimed_session_id', sessions.map(s => s.id));
  if (visitErr) {
    // No anchor means no backdating and no proof floor — a strictly more
    // conservative pass, not a skipped one. Never guess the anchor from the row.
    console.warn('[gymReconcile] anchor fetch failed, correcting conservatively:', visitErr.message);
  }
  for (const v of visits ?? []) {
    if (!v.claimed_session_id) continue;
    const startMs = v.started_at ? new Date(v.started_at).getTime() : null;
    const provenMs = v.last_proven_at ? new Date(v.last_proven_at).getTime() : null;
    // Two visits claiming one session shouldn't happen, but "shouldn't" is not a
    // guarantee and last-row-wins would make the correction depend on row order.
    // Take the tighter start (less backdating) and the later proof (less shrinking) —
    // both lean the same way, toward leaving the recorded session alone.
    const prev = anchors.get(v.claimed_session_id);
    anchors.set(v.claimed_session_id, {
      visitStartMs: maxOrNull(prev?.visitStartMs ?? null, startMs),
      provenUntilMs: maxOrNull(prev?.provenUntilMs ?? null, provenMs),
    });
  }

  for (const session of sessions) {
    try {
      await reconcileGymSession(session, anchors.get(session.id) ?? null);
    } catch (e) {
      console.warn('[gymReconcile] reconcile failed:', e);
    }
  }
}
