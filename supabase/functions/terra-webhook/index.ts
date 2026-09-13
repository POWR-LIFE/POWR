// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Terra data webhook. Terra POSTs normalised health data here whenever a
// connected user has new activity/sleep/daily data, plus auth/deauth lifecycle
// events. Deployed with verify_jwt = false (Terra is not a Supabase user) —
// security rests on the terra-signature HMAC check below.
//
// Writes run with the SERVICE ROLE key because there is no auth context: every
// insert sets user_id explicitly (activity_sessions.user_id otherwise defaults
// to auth.uid(), which is null here). Session writes mirror the client logic in
// hooks/useHealthSync.ts + lib/api/activity.ts:
//   - workouts/sleep → verification 'wearable', trust_score 0.85
//   - walking (daily) → trust_score 0.90
// Idempotency on Terra re-delivery comes from a unique index plus an overlap
// test: walking, geofence and manual rows are one-per-type-per-day, while every
// WEARABLE row — workouts and sleep alike — is keyed on its own start instant
// (idx_one_wearable_session_per_start). The day bucket used to cover workouts,
// which meant a workout the user paused and restarted arrived as a 23505 and had
// its first half overwritten (migration 20260807120000); it covered sleep until
// 2026-08-21, which meant a nap silently ate that night's sleep (migration
// 20260821140000). Both now resolve through findMergeTarget below: a restatement
// overlaps what we hold and is absorbed, a genuinely separate session does not
// and gets its own row.
import { createClient } from '@supabase/supabase-js';
import {
  calculateBasePoints,
  calculateSleepPoints,
  dailyCapBucket,
  dailyCapForType,
  stepTierPoints,
  terraActivityToPOWR,
  terraResourceToSource,
  type ActivityType,
  type StrengthThresholds,
} from '../_shared/points.ts';
import { mergeWorkouts, relateWorkouts, type WorkoutWindow } from '../_shared/sessionMerge.ts';
import { resolveSleepSeconds } from '../_shared/sleepDuration.ts';
import { verifyTerraSignature } from '../_shared/terraSignature.ts';
import { DATA_TYPES, extractDeviceFreshness, freshnessPatch } from '../_shared/deviceFreshness.ts';
import { activityExtras } from '../_shared/terraExtras.ts';

const SIGNING_SECRET = Deno.env.get('TERRA_SIGNING_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the POWR user_id for a payload via reference_id, else terra_connections. */
async function resolveUserId(supabase, payload): Promise<string | null> {
  const ref = payload?.user?.reference_id;
  if (typeof ref === 'string' && UUID_RE.test(ref)) return ref;
  const terraUserId = payload?.user?.user_id;
  if (!terraUserId) return null;
  const { data } = await supabase
    .from('terra_connections')
    .select('user_id')
    .eq('terra_user_id', terraUserId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Insert a session + award points; idempotent via the per-type-per-day unique index.
 *  point_transactions.user_id is NOT NULL (defaults to auth.uid(), which is null under
 *  the service role) so it must be set explicitly from the session row. */
/**
 * Returns the new session's id, or null when nothing was written. The id is
 * returned so the caller can stamp it onto the health_snapshots row — that link
 * is what lets the Progress day sheet read a session's heart rate and calories
 * back (see supabase/migrations/20260801110000_*).
 */
type InsertSessionResult = { id: string } | { conflict: true } | { error: true };

async function insertSession(supabase, row, points: number): Promise<InsertSessionResult> {
  const { data: session, error } = await supabase
    .from('activity_sessions')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { conflict: true };
    console.error('[terra-webhook] session insert failed:', error.message);
    return { error: true };
  }
  if (points > 0) {
    await supabase.from('point_transactions').insert({
      user_id: row.user_id, session_id: session.id, amount: points, type: 'earn', source: 'health_sync',
    });
  }
  return { id: session.id as string };
}

/**
 * How much of this activity type's daily ceiling the user has left.
 *
 * enforce_point_award_cap applies the same ceiling to client-side writes but
 * returns early for the service role, so nothing capped THIS path — it did not
 * have to while a unique index allowed only one wearable workout per type per
 * day. Since migration 20260807120000 a day can hold two runs, so the ceiling
 * has to be counted here or the second one gets paid in full.
 *
 * Counts 'earn' AND 'streak' rows, matching claim-points: the bonus lives in its
 * own row so the ledger can show it, and summing only 'earn' would let it ride
 * past the cap uncounted.
 */
async function dailyHeadroom(supabase, userId: string, type: ActivityType, startIso: string): Promise<number> {
  const capBucket = dailyCapBucket(type);
  // Absent from DAILY_CAPS means uncapped — cardio pays for every session done.
  const cap = dailyCapForType(type);
  if (cap == null) return Infinity;
  const bucketStart = dayStartUTC(startIso);
  const bucketEnd = new Date(new Date(bucketStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  let sessionQuery = supabase
    .from('activity_sessions')
    .select('id')
    .eq('user_id', userId)
    .gte('started_at', bucketStart)
    .lt('started_at', bucketEnd);
  sessionQuery = capBucket === 'gym'
    ? sessionQuery.in('type', ['gym', 'hiit'])
    : sessionQuery.eq('type', capBucket);
  const { data: sessions, error: sessionsError } = await sessionQuery;
  if (sessionsError) {
    console.error('[terra-webhook] daily cap session lookup failed:', sessionsError.message);
    return 0;
  }
  const ids = (sessions ?? []).map((s) => s.id);
  if (ids.length === 0) return cap;

  const { data: earned, error: earnedError } = await supabase
    .from('point_transactions')
    .select('amount')
    .eq('user_id', userId)
    .in('type', ['earn', 'streak'])
    .in('session_id', ids);
  if (earnedError) {
    console.error('[terra-webhook] daily cap ledger lookup failed:', earnedError.message);
    return 0;
  }
  const already = (earned ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  return Math.max(0, cap - already);
}

function rowToWindow(row): WorkoutWindow {
  const startMs = new Date(row.started_at).getTime();
  return {
    startMs,
    endMs: row.ended_at ? new Date(row.ended_at).getTime() : startMs + (row.duration_sec ?? 0) * 1000,
    durationSec: row.duration_sec ?? 0,
    distanceM: row.distance_m,
    hrAvg: row.hr_avg,
  };
}

/**
 * Find the workout already on file that this delivery belongs to, if any.
 *
 * Two things arrive here that must NOT become two rows: the same activity told
 * twice (a mid-workout fragment then the finished article, or terra-poll
 * replaying its 2-day window), and the two halves of a workout the user stopped
 * and restarted. relateWorkouts decides which from the windows alone; anything
 * further apart than the contiguity gap is a genuinely separate workout and gets
 * its own row.
 *
 * Deliberately not bucketed by day: a run that ends at 23:55 and resumes at
 * 00:05 is one run, and the old day bucket is exactly what made split workouts
 * destroy each other.
 */
async function findMergeTarget(supabase, userId: string, type: string, incoming: WorkoutWindow) {
  // ±1 day bounds the scan onto (user_id, started_at); the relation itself is
  // decided in JS so the gap rule lives in one tested place.
  const windowStart = new Date(incoming.startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(incoming.endMs + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('activity_sessions')
    .select('id, started_at, ended_at, duration_sec, distance_m, hr_avg')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('trust_score', 0.85)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .order('started_at', { ascending: true });
  if (error) {
    console.error('[terra-webhook] merge-target lookup failed:', error.message);
    return null;
  }

  let nearest = null;
  for (const row of data ?? []) {
    const existing = rowToWindow(row);
    const relation = relateWorkouts(existing, incoming);
    if (relation === 'separate') continue;
    // An overlap is the same activity told twice — settled, stop looking.
    if (relation === 'same') return { row, existing, relation };
    const gap = incoming.startMs >= existing.endMs
      ? incoming.startMs - existing.endMs
      : existing.startMs - incoming.endMs;
    if (!nearest || gap < nearest.gap) nearest = { row, existing, relation, gap };
  }
  return nearest;
}

/**
 * Fold a delivery into the workout it belongs to and pay what the merged shape
 * is worth, minus what this session has already been paid, minus whatever the
 * day's ceiling leaves.
 *
 * Replaces upgradeTruncatedSession, whose rule was "keep whichever telling is
 * longer". That healed fragments correctly and destroyed split workouts: the
 * second half of Sorine's 2026-08-06 10 k overwrote the first half in place,
 * because to a day-bucketed index the two halves were indistinguishable from one
 * run delivered twice. mergeWorkouts distinguishes them and sums instead.
 *
 * Returns { deltaPoints } when the row changed, else null.
 */
async function mergeIntoSession(supabase, {
  userId, type, target, incoming, hrMax, caloriesActive, extras, rawName, thresholds,
}): Promise<{ deltaPoints: number } | null> {
  const { row: sessionRow, existing, relation } = target;
  const merged = mergeWorkouts(existing, incoming, relation);
  if (!merged.changed) return null; // a replay of something we already hold

  const patch: Record<string, unknown> = {
    started_at: new Date(merged.startMs).toISOString(),
    ended_at: new Date(merged.endMs).toISOString(),
    duration_sec: merged.durationSec,
  };
  if (merged.distanceM != null) patch.distance_m = Math.round(merged.distanceM);
  if (merged.hrAvg != null) patch.hr_avg = merged.hrAvg;
  if (rawName) patch.raw_activity_name = rawName;
  const { error } = await supabase.from('activity_sessions').update(patch).eq('id', sessionRow.id);
  if (error) {
    console.error('[terra-webhook] session merge failed:', error.message);
    return null;
  }

  // The ledger, not a recomputation, is the source of truth for what this
  // session has already been paid: an admin retuning thresholds between the two
  // deliveries must not make the delta over- or underpay.
  const { data: txRows, error: txReadError } = await supabase
    .from('point_transactions')
    .select('amount')
    .eq('session_id', sessionRow.id)
    .eq('type', 'earn');
  if (txReadError) {
    console.error('[terra-webhook] ledger read failed:', txReadError.message);
    return { deltaPoints: 0 };
  }
  const oldPoints = (txRows ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0);
  // Priced on the MERGED shape: two halves of one run are one run's distance.
  const newPoints = calculateBasePoints(type, merged.durationSec / 60, thresholds, merged.distanceM);
  const headroom = await dailyHeadroom(supabase, userId, type, patch.started_at as string);
  const deltaPoints = Math.min(Math.max(0, newPoints - oldPoints), headroom);

  if (deltaPoints > 0) {
    const { error: txError } = await supabase.from('point_transactions').insert({
      user_id: userId, session_id: sessionRow.id, amount: deltaPoints, type: 'earn', source: 'health_sync',
    });
    if (txError) {
      console.error('[terra-webhook] delta points insert failed:', txError.message);
      return { deltaPoints: 0 };
    }
  }

  await mergeSnapshot(supabase, {
    sessionId: sessionRow.id, type, relation,
    durationSec: merged.durationSec,
    distanceM: merged.distanceM,
    hrAvg: merged.hrAvg,
    hrMax, caloriesActive, extras,
  });

  console.log(
    `[terra-webhook] ${relation === 'contiguous' ? 'stitched split' : 'healed'} ${type}: `
    + `${existing.durationSec}s → ${merged.durationSec}s (+${deltaPoints} pts)`,
  );
  return { deltaPoints };
}

/**
 * Bring the session's health snapshot up to the merged shape. A stitched
 * workout accumulates (two halves burned two halves' worth of calories and
 * steps); a healed fragment is superseded by the fuller reading.
 */
async function mergeSnapshot(supabase, {
  sessionId, type, relation, durationSec, distanceM, hrAvg, hrMax, caloriesActive, extras,
}): Promise<void> {
  // Deliberately limit(1) rather than maybeSingle: a session that has been
  // through both the native sync and Terra can carry two snapshot rows, and a
  // read that errors on the second one would silently drop the merge.
  const { data: snap, error: snapError } = await supabase
    .from('health_snapshots')
    .select('id, hr_max, calories_active, extras')
    .eq('session_id', sessionId)
    .eq('activity_type', type)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (snapError) {
    console.error('[terra-webhook] snapshot lookup failed:', snapError.message);
    return;
  }
  if (!snap) return;

  const patch: Record<string, unknown> = { duration_sec: durationSec };
  if (distanceM != null) patch.distance_m = Math.round(distanceM);
  if (hrAvg != null) patch.hr_avg = hrAvg;

  const pick = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return null;
    return relation === 'contiguous' ? (a ?? 0) + (b ?? 0) : Math.max(a ?? 0, b ?? 0);
  };
  // hr_max is a peak either way — the hardest moment of a split workout is still
  // the hardest moment, so it maxes even when everything else sums.
  const nextHrMax = maxOf(snap?.hr_max, hrMax);
  if (nextHrMax != null) patch.hr_max = Math.round(nextHrMax);
  const nextCalories = pick(snap?.calories_active, caloriesActive);
  if (nextCalories != null) patch.calories_active = Math.round(nextCalories);

  if (extras != null || snap?.extras != null) {
    const prev = snap?.extras ?? {};
    const next = extras ?? {};
    patch.extras = {
      ...prev,
      ...next,
      ...(pick(prev.steps, next.steps) != null ? { steps: Math.round(pick(prev.steps, next.steps)!) } : {}),
      ...(pick(prev.elevation_gain_m, next.elevation_gain_m) != null
        ? { elevation_gain_m: Math.round(pick(prev.elevation_gain_m, next.elevation_gain_m)!) } : {}),
      ...(pick(prev.elevation_loss_m, next.elevation_loss_m) != null
        ? { elevation_loss_m: Math.round(pick(prev.elevation_loss_m, next.elevation_loss_m)!) } : {}),
      ...(maxOf(prev.hr_min, next.hr_min) != null ? { hr_min: Math.round(minOf(prev.hr_min, next.hr_min)!) } : {}),
    };
  }

  const { error } = await supabase.from('health_snapshots').update(patch).eq('id', snap.id);
  if (error) console.error('[terra-webhook] snapshot merge failed:', error.message);
}

function maxOf(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return Math.max(a ?? -Infinity, b ?? -Infinity);
}

function minOf(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return Math.min(a ?? Infinity, b ?? Infinity);
}

/** Marks today as an active streak day for the user. Mirrors updateStreakForToday in lib/api/activity.ts. */
async function bumpStreak(supabase, userId: string): Promise<void> {
  const { data: streak } = await supabase
    .from('user_streaks')
    .select('current_streak, longest_streak, last_activity_date')
    .eq('user_id', userId)
    .maybeSingle();
  if (!streak) return;
  const today = new Date().toISOString().split('T')[0];
  if (streak.last_activity_date === today) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yStr = y.toISOString().split('T')[0];
  const next = streak.last_activity_date === yStr ? streak.current_streak + 1 : 1;
  await supabase.from('user_streaks').update({
    current_streak: next,
    longest_streak: Math.max(next, streak.longest_streak),
    last_activity_date: today,
  }).eq('user_id', userId);
}

function isToday(iso: string): boolean {
  return new Date(iso).toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
}

function dayStartUTC(iso: string): string {
  return `${new Date(iso).toISOString().split('T')[0]}T00:00:00.000Z`;
}

/**
 * Gym geofence check-ins are POWR's source of truth — they're the feature we own.
 * Any wearable workout whose window overlaps an existing geofence gym session is
 * the SAME time spent at the gym, so we suppress the wearable entry to avoid
 * double-counting (a Whoop "strength" session, a spin-class "cycling", etc., all
 * defer to the gym check-in). See project_terra_wearable_aggregator / the
 * wearable-sync duplicate item. Returns the ID of the check-in that outranks
 * this window, or null when nothing overlaps. The caller stamps that id onto the
 * suppressed_workouts record so the loss is attributable to a specific check-in
 * rather than just asserted.
 */
async function overlappingGeofenceGym(
  supabase, userId: string, startMs: number, endMs: number,
): Promise<string | null> {
  // Bound the query by day (±1d) for index use, then check exact overlap in JS.
  const windowStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(endMs + 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('activity_sessions')
    .select('id, started_at, ended_at, duration_sec')
    .eq('user_id', userId)
    .eq('type', 'gym')
    .eq('verification', 'geofence')
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .order('started_at', { ascending: false });
  if (!data) return null;
  for (const g of data) {
    const gStart = new Date(g.started_at).getTime();
    const gEnd = g.ended_at
      ? new Date(g.ended_at).getTime()
      : gStart + (g.duration_sec ?? 0) * 1000;
    if (startMs < gEnd && endMs > gStart) return g.id as string; // half-open overlap
  }
  return null;
}

/**
 * Source-of-truth priority is geofence (0.94) > wearable (0.85) > manual (0.55).
 * A wearable session that lands here outranks any MANUAL session of the same type
 * whose window overlaps — it's the same effort, sensor-backed. Remove the manual
 * row and reverse its points so the higher-trust wearable entry stands alone
 * (mirrors admin-review-session's reject: append a compensating penalty since the
 * ledger is append-only + the session FK is ON DELETE SET NULL). Geofence still
 * wins over both (handled earlier by overlapsGeofenceGym).
 */
async function supersedeManualOverlaps(
  supabase, userId: string, type: string, startMs: number, endMs: number,
): Promise<void> {
  const windowStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(endMs + 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('activity_sessions')
    .select('id, started_at, ended_at, duration_sec')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('verification', 'manual')
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd);
  for (const m of data ?? []) {
    const mStart = new Date(m.started_at).getTime();
    const mEnd = m.ended_at
      ? new Date(m.ended_at).getTime()
      : mStart + (m.duration_sec ?? 0) * 1000;
    if (!(startMs < mEnd && endMs > mStart)) continue; // no overlap

    const { data: earns } = await supabase
      .from('point_transactions')
      .select('amount')
      .eq('session_id', m.id)
      .eq('type', 'earn');
    const reversed = (earns ?? []).reduce((s, t) => s + (t.amount ?? 0), 0);
    if (reversed > 0) {
      await supabase.from('point_transactions').insert({
        user_id: userId, amount: -reversed, type: 'penalty', multiplier: 1.0,
        description: `Superseded manual ${type} by wearable sync`,
      });
    }
    await supabase.from('activity_sessions').delete().eq('id', m.id);
    console.log(`[terra-webhook] superseded manual ${type} ${m.started_at} (−${reversed} pts) — wearable outranks`);
  }
}

// ── Payload handlers ────────────────────────────────────────────────────────────

// Cloud-wearable provider keys (lowercased). Used to enforce one-wearable-at-a-time
// without touching the user's native (Apple Health / Health Connect) connection.
const WEARABLE_KEYS = new Set([
  'whoop', 'oura', 'garmin', 'polar', 'fitbit', 'strava', 'huawei', 'withings', 'peloton', 'zepp', 'technogym',
  'coros', 'suunto', 'wahoo', 'zwift', 'concept2', 'ifit', 'underarmour',
]);

/**
 * On a fresh connection, ask Terra to (re)send the last week so the Progress
 * surfaces (BODY tab, sleep, sessions) fill immediately instead of accruing
 * from today — before this, a new wearable only ever received terra-poll's
 * rolling 2-day window and the page started near-empty.
 *
 * Same request shape as terra-poll: to_webhook=true routes the data back
 * through this function's normal handlers, so dedup and the bounded-extras
 * rule (terraExtras) apply to backfilled sessions exactly as to live ones.
 * Best-effort on purpose — a failed request costs the user nothing but a
 * slower fill (the poll still covers the last 2 days), so nothing here throws.
 */
const BACKFILL_DAYS = 7;
const BACKFILL_RESOURCES = ['sleep', 'activity', 'daily'];

async function requestBackfill(terraUserId: string): Promise<void> {
  const devId = Deno.env.get('TERRA_DEV_ID');
  const apiKey = Deno.env.get('TERRA_API_KEY');
  if (!devId || !apiKey) return;

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const start = isoDate(new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000));
  const end = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  for (const r of BACKFILL_RESOURCES) {
    try {
      const url = `https://api.tryterra.co/v2/${r}?user_id=${encodeURIComponent(terraUserId)}`
        + `&start_date=${start}&end_date=${end}&to_webhook=true`;
      const res = await fetch(url, { headers: { 'dev-id': devId, 'x-api-key': apiKey } });
      if (!res.ok) {
        console.warn(`[terra-webhook] backfill ${r} → ${res.status}`);
      }
    } catch (e) {
      console.warn(`[terra-webhook] backfill ${r} threw:`, e?.message ?? e);
    }
  }
}

async function handleAuth(supabase, payload): Promise<void> {
  const u = payload.user ?? {};
  const terraUserId = u.user_id;
  const userId = await resolveUserId(supabase, payload);
  const provider = (u.provider ?? '').toUpperCase();
  if (!terraUserId || !userId || !provider) return;

  await supabase.from('terra_connections').upsert({
    terra_user_id: terraUserId, user_id: userId, provider, deauthed_at: null,
  });
  // One wearable at a time: mark this user's OTHER Terra connections as deauthed so
  // stale wearable data is ignored going forward.
  await supabase.from('terra_connections')
    .update({ deauthed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .neq('terra_user_id', terraUserId)
    .is('deauthed_at', null);

  const key = provider.toLowerCase();
  const { data: prof } = await supabase
    .from('profiles').select('health_provider_connections, active_health_provider')
    .eq('id', userId).maybeSingle();
  const conns = prof?.health_provider_connections ?? {};
  // Drop any other wearable entry (single wearable; native is kept) and promote this
  // wearable to the active source of truth.
  for (const k of Object.keys(conns)) {
    if (k !== key && WEARABLE_KEYS.has(k)) delete conns[k];
  }
  conns[key] = { connected_at: new Date().toISOString(), terra_user_id: terraUserId };
  void requestBackfill(terraUserId);
  await supabase.from('profiles').update({
    health_provider_connections: conns,
    active_health_provider: key,
  }).eq('id', userId);
}

async function handleDeauth(supabase, payload): Promise<void> {
  const terraUserId = payload?.user?.user_id;
  const provider = (payload?.user?.provider ?? '').toUpperCase();
  if (terraUserId) {
    await supabase.from('terra_connections')
      .update({ deauthed_at: new Date().toISOString() })
      .eq('terra_user_id', terraUserId);
  }
  const userId = await resolveUserId(supabase, payload);
  if (!userId || !provider) return;
  const { data: prof } = await supabase
    .from('profiles').select('health_provider_connections, active_health_provider')
    .eq('id', userId).maybeSingle();
  const conns = prof?.health_provider_connections ?? {};
  const key = provider.toLowerCase();
  delete conns[key];
  const nextActive = prof?.active_health_provider === key
    ? (Object.keys(conns)[0] ?? null)
    : prof?.active_health_provider ?? null;
  await supabase.from('profiles').update({
    health_provider_connections: conns, active_health_provider: nextActive,
  }).eq('id', userId);
}

/**
 * Fire-and-forget "workout synced" receipt after Terra awards land. One call
 * per webhook batch (count/points aggregated); send-push's per-type daily cap
 * (notification_config, 1/day) keeps later same-day syncs and backfill bursts
 * silent, and its wearable_session preference + feed write do the rest.
 * Best-effort: a push failure must never fail the webhook.
 */
async function notifyWearableReceipt(
  userId: string, count: number, points: number, activityLabel: string | null,
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        target_user_id: userId,
        type: 'wearable_session_recorded',
        payload: { count, points, activity_label: activityLabel ?? undefined },
      }),
    });
  } catch (err) {
    console.warn('[terra-webhook] wearable receipt push failed:', err);
  }
}

/** Admin-tunable strength thresholds. The strength lane (gym + hiit) pays the
 *  same 15/20 tiers here as a geofence check-in does, so it must read the same
 *  system_config gates claim-points reads — a hardcoded 30/40 would desync from
 *  the check-in path on every retune. Falls back to the historical defaults. */
async function readStrengthThresholds(supabase): Promise<StrengthThresholds> {
  const out: StrengthThresholds = {};
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['min_gym_dwell_minutes', 'gym_upgrade_minutes']);
    if (error) {
      console.warn('[terra-webhook] strength threshold read failed, using defaults:', error.message);
      return out;
    }
    for (const row of data ?? []) {
      const parsed = parseInt(row.value ?? '', 10);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      if (row.key === 'min_gym_dwell_minutes') out.gymDwellMin = parsed;
      if (row.key === 'gym_upgrade_minutes') out.gymUpgradeMin = parsed;
    }
  } catch (err) {
    console.warn('[terra-webhook] strength threshold read failed, using defaults:', err);
  }
  return out;
}

async function handleActivity(supabase, payload): Promise<void> {
  const userId = await resolveUserId(supabase, payload);
  if (!userId) return;
  const source = terraResourceToSource(payload?.user?.provider ?? '');
  const thresholds = await readStrengthThresholds(supabase);

  let awardedCount = 0;
  let awardedPoints = 0;
  let awardedLabel: string | null = null;

  for (const a of payload.data ?? []) {
    const meta = a.metadata ?? {};
    const start = meta.start_time;
    const end = meta.end_time;
    if (!start) continue;
    const type = terraActivityToPOWR(meta.name ?? '', meta.type);
    if (!type) continue;

    const durSec = end
      ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
      : Math.round(a.active_durations_data?.activity_seconds ?? 0);
    if (durSec <= 0) continue;
    const durMin = durSec / 60;

    const distanceM = a.distance_data?.summary?.distance_meters;
    const hrAvg = a.heart_rate_data?.summary?.avg_hr_bpm;
    const hrMax = a.heart_rate_data?.summary?.max_hr_bpm;
    const caloriesActive = a.calories_data?.total_burned_calories != null
      ? Math.round(a.calories_data.total_burned_calories) : null;
    const rawName = (meta.name ?? '').trim().slice(0, 80) || null;
    const points = calculateBasePoints(type, durMin, thresholds, distanceM);
    const extras = activityExtras(a);

    // Gym geofence wins: if this wearable workout overlaps a geofence gym check-in,
    // it's the same time at the gym — it must not be paid a second time.
    //
    // It is still a real workout the user did, so RECORD it rather than dropping
    // it on the floor. This used to be a bare `continue` + console.log: no row, no
    // points, no trace, nothing the user or an admin could ever see. Deliberately
    // NOT an activity_sessions row — every challenge evaluator counts sessions
    // through one builder that would treat it as an independent workout and pay
    // out unearned points (see the migration for the full reasoning). The audit
    // table is inert: nothing counts it, nothing pays from it.
    const startMs = new Date(start).getTime();
    const endMs = end ? new Date(end).getTime() : startMs + durSec * 1000;
    const winner = await overlappingGeofenceGym(supabase, userId, startMs, endMs);
    if (winner) {
      console.log(`[terra-webhook] suppressing ${type} (${Math.round(durMin)}m) — overlaps geofence gym session ${winner}`);
      // Idempotent on (user_id, type, started_at): terra-poll replays a ~2-day
      // window, so the same suppression arrives repeatedly. Never let a failure
      // here cost us the rest of the payload.
      const { error: suppressErr } = await supabase
        .from('suppressed_workouts')
        .upsert({
          user_id: userId,
          winner_session_id: winner,
          type,
          started_at: start,
          ended_at: end ? end : new Date(startMs + durSec * 1000).toISOString(),
          duration_sec: durSec,
          distance_m: distanceM != null ? Math.round(distanceM) : null,
          hr_avg: hrAvg != null ? Math.round(hrAvg) : null,
          hr_max: hrMax != null ? Math.round(hrMax) : null,
          calories_active: caloriesActive,
          source,
          raw_activity_name: rawName,
          reason: 'overlaps_geofence_gym',
          would_have_earned: points,
        }, { onConflict: 'user_id,type,started_at' });
      if (suppressErr) {
        console.error('[terra-webhook] suppressed_workouts write failed:', suppressErr.message);
      }
      continue;
    }

    const endedAt = end ? end : new Date(new Date(start).getTime() + durSec * 1000).toISOString();
    const incoming: WorkoutWindow = {
      startMs, endMs, durationSec: durSec, distanceM, hrAvg,
    };

    // Does this delivery belong to a workout we already hold — the same activity
    // told twice, or the other half of one the user stopped and restarted? Ask
    // BEFORE inserting: a second half carries a different start_time, so the
    // unique index would happily let it become a second row, and the day would
    // read as two short runs instead of the one long one it was.
    const mergeInto = async (target) => {
      const merged = await mergeIntoSession(supabase, {
        userId, type, target, incoming, hrMax, caloriesActive, extras, rawName, thresholds,
      });
      if (!merged) return;
      // The window grew — a manual log it now overlaps is superseded too.
      await supersedeManualOverlaps(supabase, userId, type,
        Math.min(startMs, target.existing.startMs), Math.max(endMs, target.existing.endMs));
      if (merged.deltaPoints > 0) {
        awardedCount++;
        awardedPoints += merged.deltaPoints;
        awardedLabel = (meta.name ?? '').trim() || type;
      }
    };

    const target = await findMergeTarget(supabase, userId, type, incoming);
    if (target) {
      await mergeInto(target);
      continue;
    }

    // A genuinely separate workout. It gets its own row — but the day's ceiling
    // still applies, so a second run does not pay a second time.
    const headroom = await dailyHeadroom(supabase, userId, type, start);
    const award = Math.min(points, headroom);
    const result = await insertSession(supabase, {
      user_id: userId,
      type,
      started_at: start,
      ended_at: endedAt,
      duration_sec: durSec,
      distance_m: distanceM != null ? Math.round(distanceM) : null,
      hr_avg: hrAvg != null ? Math.round(hrAvg) : null,
      verification: 'wearable',
      trust_score: 0.85,
      device_id: null,
      raw_activity_name: rawName,
    }, award);

    if ('id' in result) {
      const inserted = result.id;
      // Wearable outranks manual: remove any overlapping manual session of this
      // type and reverse its points (geofence already handled above).
      await supersedeManualOverlaps(supabase, userId, type, startMs, endMs);
      await supabase.from('health_snapshots').insert({
        user_id: userId,
        session_id: inserted,
        distance_m: distanceM != null ? Math.round(distanceM) : null,
        hr_avg: hrAvg != null ? Math.round(hrAvg) : null,
        hr_max: hrMax != null ? Math.round(hrMax) : null,
        calories_active: caloriesActive,
        activity_type: type,
        duration_sec: durSec,
        source,
        extras,
      });
      if (isToday(start)) await bumpStreak(supabase, userId);

      if (points > 0 && award === 0) {
        console.log(`[terra-webhook] recorded ${type} (${Math.round(durMin)}m) unpaid — ${type} daily cap already met`);
      }
      if (award > 0) {
        awardedCount++;
        awardedPoints += award;
        // Prefer the human name Terra sent ("Spin", "Functional Fitness"),
        // fall back to the mapped POWR type. Only meaningful when count = 1.
        awardedLabel = (meta.name ?? '').trim() || type;
      }
    } else if ('conflict' in result) {
      // Lost the race to a concurrent delivery of this same activity (identical
      // start_time). Re-look and fold into whatever landed first.
      const raced = await findMergeTarget(supabase, userId, type, incoming);
      if (raced) await mergeInto(raced);
    }
  }

  if (awardedCount > 0) {
    await notifyWearableReceipt(
      userId, awardedCount, awardedPoints, awardedCount === 1 ? awardedLabel : null,
    );
  }
}

/**
 * Read the sleep snapshot attached to a session, so a merge can fold the new
 * telling's stages into the ones already on file.
 *
 * limit(1) rather than maybeSingle for the same reason mergeSnapshot does it: a
 * night that arrived through both the native sync and Terra carries two rows,
 * and erroring on the second would silently drop the merge.
 */
async function readSleepSnapshot(supabase, sessionId: string) {
  const { data, error } = await supabase
    .from('health_snapshots')
    .select('id, sleep_duration_h, sleep_deep_h, sleep_rem_h, sleep_light_h, hr_resting, extras')
    .eq('session_id', sessionId)
    .eq('activity_type', 'sleep')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[terra-webhook] sleep snapshot lookup failed:', error.message);
    return null;
  }
  return data;
}

/**
 * How much a night has to grow before we re-announce it. Below this a merge is
 * Terra restating the same night with a few minutes of drift, and the user does
 * not need telling twice.
 */
const RECEIPT_CORRECTION_MIN_H = 0.5;

/**
 * The sleep receipt. Gated to a night that ended in the last 24h: a reconnect
 * backfills a week of history, and without the gate the user is congratulated
 * NOW for a night they slept days ago (seen live 2026-08-21). Points still land
 * for old nights — never drop a workout — only the push is fresh-only.
 *
 * `points` is always what the NIGHT is worth, never what one delivery added —
 * see the correction block in mergeSleepInto.
 */
async function sendSleepReceipt(userId: string, endIso: string, hours: number, points: number): Promise<void> {
  if (points <= 0) return;
  if (Date.now() - new Date(endIso).getTime() >= 24 * 60 * 60 * 1000) return;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        target_user_id: userId,
        type: 'sleep_target_met',
        payload: { hours, points },
      }),
    });
  } catch (err) {
    console.warn('[terra-webhook] sleep push failed:', err);
  }
}

/**
 * Fold a delivery into the night it belongs to and top up what it is worth.
 *
 * The sleep counterpart of mergeIntoSession. Until 2026-08-21 sleep had no merge
 * path at all: a second sleep starting in the same UTC day collided on the day
 * bucket and handleSleep silently discarded it. Now that wearable sleep keys on
 * its start instant (migration 20260821140000) the collision is gone, and THIS
 * is what keeps re-delivery idempotent in its place — a restatement of a night
 * overlaps the row we hold and is absorbed, whatever start instant it carries.
 *
 * 'same'       — one night, two tellings. Take the fuller of each field; a
 *                fragment under-reports everything, so max() is the truth.
 * 'contiguous' — a night the provider split across an awake gap. Duration and
 *                stages SUM: two segments of one night are one night's sleep.
 */
async function mergeSleepInto(supabase, { userId, target, incoming, reading, source, vitals }): Promise<void> {
  const { row: sessionRow, existing, relation } = target;
  const merged = mergeWorkouts(existing, incoming, relation);

  const snap = await readSleepSnapshot(supabase, sessionRow.id);
  // Vitals ride on the fullest telling: a restatement that brings resting HR
  // or a recovery score the row lacks is worth writing even when the night's
  // window and stages are unchanged (the backfill after 2026-09-06 re-lands
  // every held night exactly this way).
  const night: NightVitals = vitals ?? { hrResting: null, extras: {} };
  const vitalsChanged = vitalsDiffer(snap, night);
  const pick = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return null;
    return relation === 'contiguous' ? (a ?? 0) + (b ?? 0) : Math.max(a ?? 0, b ?? 0);
  };
  // Hours come off the merged WINDOW, not the snapshot, so they stay consistent
  // with the session row that prices the night.
  const mergedHours = merged.durationSec / 3600;
  const mergedDeep = pick(snap?.sleep_deep_h, reading.deepH);
  const mergedRem = pick(snap?.sleep_rem_h, reading.remH);
  const mergedLight = pick(snap?.sleep_light_h, reading.lightH);

  const stagesChanged = snap != null && (
    mergedDeep !== (snap.sleep_deep_h ?? null)
    || mergedRem !== (snap.sleep_rem_h ?? null)
    || mergedLight !== (snap.sleep_light_h ?? null)
    || mergedHours !== (snap.sleep_duration_h ?? null)
  );
  if (snap && !merged.changed && !stagesChanged && !vitalsChanged) return; // a replay of something we already hold

  if (merged.changed) {
    const { error } = await supabase.from('activity_sessions').update({
      started_at: new Date(merged.startMs).toISOString(),
      ended_at: new Date(merged.endMs).toISOString(),
      duration_sec: merged.durationSec,
    }).eq('id', sessionRow.id);
    if (error) {
      console.error('[terra-webhook] sleep merge failed:', error.message);
      return;
    }
  }

  if (snap) {
    const patch: Record<string, unknown> = {
      sleep_duration_h: mergedHours,
      duration_sec: merged.durationSec,
    };
    if (mergedDeep != null) patch.sleep_deep_h = mergedDeep;
    if (mergedRem != null) patch.sleep_rem_h = mergedRem;
    if (mergedLight != null) patch.sleep_light_h = mergedLight;
    if (vitalsChanged) {
      if (night.hrResting != null) patch.hr_resting = night.hrResting;
      // Incoming keys win; anything the row already knew that this telling
      // doesn't mention (a zone bag, an earlier SpO2) is kept.
      patch.extras = { ...(snap.extras ?? {}), ...night.extras };
    }
    const { error } = await supabase.from('health_snapshots').update(patch).eq('id', snap.id);
    if (error) console.error('[terra-webhook] sleep snapshot merge failed:', error.message);
  } else {
    // Session on file with no snapshot (client-written row, or an earlier
    // insert whose snapshot write failed). Give it one rather than lose the
    // stages this delivery carries.
    await supabase.from('health_snapshots').insert({
      user_id: userId,
      session_id: sessionRow.id,
      sleep_duration_h: mergedHours,
      sleep_deep_h: mergedDeep,
      sleep_rem_h: mergedRem,
      sleep_light_h: mergedLight,
      hr_resting: night.hrResting,
      extras: Object.keys(night.extras).length > 0 ? night.extras : null,
      activity_type: 'sleep',
      duration_sec: merged.durationSec,
      source,
    });
  }

  // The ledger, not a recomputation, says what this night has already been paid.
  const { data: txRows, error: txReadError } = await supabase
    .from('point_transactions')
    .select('amount')
    .eq('session_id', sessionRow.id)
    .eq('type', 'earn');
  if (txReadError) {
    console.error('[terra-webhook] sleep ledger read failed:', txReadError.message);
    return;
  }
  const oldPoints = (txRows ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const newPoints = calculateSleepPoints(mergedHours, mergedDeep ?? undefined, mergedRem ?? undefined);
  const startedAt = new Date(merged.startMs).toISOString();
  // headroom already nets off what this session was paid — it is inside the bucket.
  const headroom = await dailyHeadroom(supabase, userId, 'sleep', startedAt);
  const deltaPoints = Math.min(Math.max(0, newPoints - oldPoints), headroom);

  if (deltaPoints > 0) {
    const { error: txError } = await supabase.from('point_transactions').insert({
      user_id: userId, session_id: sessionRow.id, amount: deltaPoints, type: 'earn', source: 'health_sync',
    });
    if (txError) {
      console.error('[terra-webhook] sleep delta points insert failed:', txError.message);
      return;
    }
  }

  console.log(
    `[terra-webhook] ${relation === 'contiguous' ? 'stitched split' : 'healed'} sleep: `
    + `${existing.durationSec}s → ${merged.durationSec}s (+${deltaPoints} pts)`,
  );

  // Correct a receipt that went out on half a night.
  //
  // The insert path announces the first telling it sees, and on a split night
  // that is a fragment: 2026-08-23 pushed "4.8h earned you 1 POWR point" at
  // 01:56 for a night that finished at 08:13 worth 8.8h and 5 points. Terra
  // cannot tell us at 01:56 that more is coming — Whoop had scored that segment
  // as a complete sleep — so the only honest repair is to say so afterwards.
  //
  // Two things make that safe to send. It reports the night's TOTAL, not this
  // merge's delta, so the correction reads as the whole story rather than a
  // second helping. And it only fires when the number actually moved, so the
  // restatements Terra sends all day (same night, minutes of drift) stay
  // silent. daily_cap 2 on sleep_target_met (migration 20260823110000) is what
  // lets it through at all: at 1 the fragment permanently outranked the truth,
  // and every correction we tried to send logged as type_daily_cap.
  const grewBy = mergedHours - existing.durationSec / 3600;
  if (grewBy >= RECEIPT_CORRECTION_MIN_H) {
    await sendSleepReceipt(
      userId, new Date(merged.endMs).toISOString(), mergedHours, oldPoints + deltaPoints,
    );
  }
}

async function handleSleep(supabase, payload): Promise<void> {
  const userId = await resolveUserId(supabase, payload);
  if (!userId) return;
  const source = terraResourceToSource(payload?.user?.provider ?? '');

  for (const s of payload.data ?? []) {
    const meta = s.metadata ?? {};
    const start = meta.start_time;
    const end = meta.end_time;
    if (!start || !end) continue;

    const dur = s.sleep_durations_data ?? {};
    const asleep = dur.asleep ?? {};
    // Time ASLEEP, not time in bed — see resolveSleepSeconds for why the order
    // is what it is, and what reading in-bed first used to cost.
    const totalSec = resolveSleepSeconds(dur, start, end);
    const hours = totalSec / 3600;
    if (hours < 1) continue; // ignore very short naps (matches client)

    const deepH = asleep.duration_deep_sleep_state_seconds != null
      ? asleep.duration_deep_sleep_state_seconds / 3600 : undefined;
    const remH = asleep.duration_REM_sleep_state_seconds != null
      ? asleep.duration_REM_sleep_state_seconds / 3600 : undefined;
    const lightH = asleep.duration_light_sleep_state_seconds != null
      ? asleep.duration_light_sleep_state_seconds / 3600 : undefined;
    const points = calculateSleepPoints(hours, deepH, remH);
    const reading = { deepH, remH, lightH };
    const vitals = nightVitalsFrom(s);

    const durationSec = Math.round(hours * 3600);
    const incoming: WorkoutWindow = {
      startMs: new Date(start).getTime(),
      endMs: new Date(end).getTime(),
      durationSec,
      distanceM: null,
      hrAvg: null,
    };

    // Is this a night we already hold? Terra restates a night's window after the
    // fact and terra-poll replays a rolling 2-day window, so most deliveries are
    // re-tellings. Overlap decides, not the calendar — which is what lets a nap
    // and that night's sleep coexist as two rows (they are hours apart, so
    // relateWorkouts calls them 'separate') while a restatement still folds in.
    const target = await findMergeTarget(supabase, userId, 'sleep', incoming);
    if (target) {
      await mergeSleepInto(supabase, { userId, target, incoming, reading, source, vitals });
      continue;
    }

    // sleep's daily ceiling (DAILY_CAPS.sleep = 5) used to be enforced only by
    // there being one sleep row a day. Now that a day can hold a nap AND a night,
    // it has to be counted here, exactly as the workout path does — the service
    // role bypasses enforce_point_award_cap.
    const headroom = await dailyHeadroom(supabase, userId, 'sleep', start);
    const award = Math.min(points, headroom);

    const sleepResult = await insertSession(supabase, {
      user_id: userId,
      type: 'sleep',
      started_at: start,
      ended_at: end,
      duration_sec: durationSec,
      verification: 'wearable',
      trust_score: 0.85,
      device_id: null,
    }, award);

    if ('conflict' in sleepResult) {
      // Two deliveries of the same night raced between the lookup above and this
      // insert (they share a start instant, so they collide on
      // idx_one_wearable_session_per_start). Re-look and fold into whichever
      // landed first — mirrors the workout path.
      const raced = await findMergeTarget(supabase, userId, 'sleep', incoming);
      if (raced) await mergeSleepInto(supabase, { userId, target: raced, incoming, reading, source, vitals });
      continue;
    }

    if ('id' in sleepResult) {
      await supabase.from('health_snapshots').insert({
        user_id: userId,
        session_id: sleepResult.id,
        sleep_duration_h: hours,
        sleep_deep_h: deepH ?? null,
        sleep_rem_h: remH ?? null,
        sleep_light_h: lightH ?? null,
        hr_resting: vitals.hrResting,
        extras: Object.keys(vitals.extras).length > 0 ? vitals.extras : null,
        activity_type: 'sleep',
        duration_sec: durationSec,
        source,
      });

      // Sleep credit was previously silent — the sleep_target_met type had copy
      // and a preference toggle but no sender. Fire it here where the points
      // actually land.
      await sendSleepReceipt(userId, end, hours, award);
    }
  }
}

function finitePositive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The recovery vitals a night carries, ready to sit on its snapshot row. */
type NightVitals = {
  hrResting: number | null;
  /** Only the keys the payload actually had — never a bag of nulls. */
  extras: Record<string, unknown>;
};

/**
 * What a SLEEP delivery says about recovery, beyond how long it lasted.
 *
 * For a Whoop, Oura or Garmin the night is where the body's baseline is
 * measured: resting HR and HRV come off the sleeping heart, and the provider's
 * own recovery/readiness verdict is computed from them. Until 2026-09-06 the
 * sleep handler read only the durations and dropped all of it, which left the
 * BODY tab judging readiness from hours slept alone — while Whoop's daily
 * summary never carries HRV at all, and its resting HR arrives on roughly half
 * the days (it is a sleep measure there, restated into the day). Reading the
 * night fixes both: every night that lands now brings its vitals with it.
 *
 * Terra Sleep model paths (docs.tryterra.co, data models):
 *   heart_rate_data.summary.{resting_hr_bpm, avg_hrv_rmssd, avg_hrv_sdnn}
 *   respiration_data.breaths_data.avg_breaths_per_min
 *   respiration_data.oxygen_saturation_data.avg_saturation_percentage
 *   temperature_data.delta                (skin temp vs the user's baseline)
 *   readiness_data.{readiness, recovery_level}
 *   sleep_durations_data.sleep_efficiency
 *   metadata.is_nap
 *
 * Every field is optional and provider-dependent; anything absent or malformed
 * is simply left out. `hrv_rmssd` keeps the key the daily handler and the
 * client already use, so a night's HRV and a day's HRV are one series.
 */
function nightVitalsFrom(s): NightVitals {
  const hr = s?.heart_rate_data?.summary ?? {};
  const resp = s?.respiration_data ?? {};
  const readiness = s?.readiness_data ?? {};
  const extras: Record<string, unknown> = {};
  const round1 = (v: number) => Math.round(v * 10) / 10;

  const hrv = finitePositive(hr.avg_hrv_rmssd);
  if (hrv != null) extras.hrv_rmssd = round1(hrv);
  const sdnn = finitePositive(hr.avg_hrv_sdnn);
  if (sdnn != null) extras.hrv_sdnn = round1(sdnn);
  const breaths = finitePositive(resp.breaths_data?.avg_breaths_per_min);
  if (breaths != null) extras.resp_rate = round1(breaths);
  const spo2 = finitePositive(resp.oxygen_saturation_data?.avg_saturation_percentage);
  if (spo2 != null) extras.spo2 = round1(spo2);
  // A delta can legitimately be negative — the one vital that is not "positive".
  const tempDelta = finiteNum(s?.temperature_data?.delta);
  if (tempDelta != null) extras.temp_delta = Math.round(tempDelta * 100) / 100;
  const score = finitePositive(readiness.readiness);
  if (score != null) extras.readiness = Math.round(score);
  const level = finiteNum(readiness.recovery_level);
  if (level != null) extras.recovery_level = Math.round(level);
  const efficiency = finitePositive(s?.sleep_durations_data?.sleep_efficiency);
  if (efficiency != null) extras.sleep_efficiency = round1(efficiency);
  if (s?.metadata?.is_nap === true) extras.is_nap = true;

  const rhr = finitePositive(hr.resting_hr_bpm);
  return { hrResting: rhr != null ? Math.round(rhr) : null, extras };
}

/**
 * True when `incoming` would change what the row already holds — a new key,
 * or a different value for one it has. Restatements that carry the same vitals
 * stay no-ops, exactly as the durations do.
 */
function vitalsDiffer(
  existing: { hr_resting?: number | null; extras?: Record<string, unknown> | null } | null,
  incoming: NightVitals,
): boolean {
  if (incoming.hrResting != null && existing?.hr_resting !== incoming.hrResting) return true;
  const have = existing?.extras ?? {};
  return Object.entries(incoming.extras).some(([k, v]) => have[k] !== v);
}

/**
 * A provider's DAILY summary carries the vitals a day-worn device measures
 * without ever going to bed — resting heart rate above all (Garmin, Whoop and
 * Zepp all send `heart_rate_data.summary.resting_hr_bpm`), plus the day's HRV
 * average where the device has one. This handler used to read only the steps
 * and drop the rest, which left the BODY tab's readiness read with nothing for
 * anyone who doesn't sleep in their wearable (Sorine's report, 2026-08-27):
 * every chip said "waiting on your device" for a night that was never coming.
 *
 * One health_snapshots row per user per provider-day, keyed by the provider's
 * LOCAL day (start_time is the user's local midnight, as it is for steps).
 * Terra re-delivers a day's summary many times as the day fills in, so an
 * existing row is updated in place, never duplicated. No session_id — this is
 * a reading, not a workout, nothing is awarded — and ONLY resting HR + HRV are
 * stored: the day's max HR / kcal would be read by the BODY tab's weekly
 * aggregates as a workout peak/burn (bodyTrends' day-wide gate only knows the
 * native providers), so they stay out. recorded_at is local NOON so the
 * client's local-day bucketing lands the reading on the right calendar day
 * from any timezone within ±10h of the device's.
 */
async function upsertDailyVitals(supabase, userId: string, source: string | null, d, start: string): Promise<void> {
  const summary = d.heart_rate_data?.summary ?? {};
  const rhr = finitePositive(summary.resting_hr_bpm);
  const hrv = finitePositive(summary.avg_hrv_rmssd);
  // The provider's own day-level verdicts, where it has them (Terra Daily:
  // scores.recovery is Whoop's recovery / Oura's readiness; strain_data.
  // strain_level is Whoop's strain). Stored, not interpreted here.
  const recovery = finitePositive(d.scores?.recovery);
  const strain = finitePositive(d.strain_data?.strain_level);
  if (rhr == null && hrv == null && recovery == null && strain == null) return;

  const dayStart = new Date(start);
  if (Number.isNaN(dayStart.getTime())) return;
  const bucketStart = dayStart.toISOString();
  const bucketEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const recordedAt = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from('health_snapshots')
    .select('id, hr_resting, extras')
    .eq('user_id', userId)
    .eq('activity_type', 'daily')
    .is('session_id', null)
    .gte('recorded_at', bucketStart)
    .lt('recorded_at', bucketEnd)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const extras: Record<string, unknown> = { ...(existing?.extras ?? {}), scope: 'day' };
  if (hrv != null) extras.hrv_rmssd = Math.round(hrv * 10) / 10;
  if (recovery != null) extras.recovery_score = Math.round(recovery);
  if (strain != null) extras.strain = Math.round(strain * 10) / 10;
  const hrResting = rhr != null ? Math.round(rhr) : (existing?.hr_resting ?? null);

  if (existing) {
    const unchanged = existing.hr_resting === hrResting
      && existing.extras?.hrv_rmssd === extras.hrv_rmssd
      && existing.extras?.recovery_score === extras.recovery_score
      && existing.extras?.strain === extras.strain;
    if (unchanged) return;
    const { error } = await supabase.from('health_snapshots')
      .update({ hr_resting: hrResting, extras })
      .eq('id', existing.id);
    if (error) console.error('[terra-webhook] daily vitals update:', error.message);
    return;
  }

  const { error } = await supabase.from('health_snapshots').insert({
    user_id: userId,
    session_id: null,
    recorded_at: recordedAt,
    hr_resting: hrResting,
    activity_type: 'daily',
    source,
    extras,
  });
  if (!error) return;
  // Lost the race to a concurrent delivery of the same day (the 30-min poll
  // and a backfill can land the same summary seconds apart — proven on the
  // first backfill, 5 duplicate days in 2 minutes). The partial unique index
  // on (user_id, source, day) refuses the second row; fold into the winner.
  if (error.code === '23505') {
    const { data: winner } = await supabase
      .from('health_snapshots')
      .select('id')
      .eq('user_id', userId)
      .eq('activity_type', 'daily')
      .is('session_id', null)
      .gte('recorded_at', bucketStart)
      .lt('recorded_at', bucketEnd)
      .limit(1)
      .maybeSingle();
    if (winner) {
      const { error: upErr } = await supabase.from('health_snapshots')
        .update({ hr_resting: hrResting, extras })
        .eq('id', winner.id);
      if (upErr) console.error('[terra-webhook] daily vitals merge:', upErr.message);
    }
    return;
  }
  console.error('[terra-webhook] daily vitals insert:', error.message);
}

async function handleDaily(supabase, payload): Promise<void> {
  const userId = await resolveUserId(supabase, payload);
  if (!userId) return;
  const source = terraResourceToSource(payload?.user?.provider ?? '');

  for (const d of payload.data ?? []) {
    const start = d.metadata?.start_time;
    if (!start) continue;

    // The day's vitals ride on the same payload as its steps, and a day with
    // a resting HR but no steps yet (early morning) still counts.
    await upsertDailyVitals(supabase, userId, source, d, start);

    const steps = d.distance_data?.steps;
    if (steps == null || steps <= 0) continue;

    // Terra sends localized timestamps: start_time is the user's LOCAL midnight
    // (e.g. "2026-07-16T00:00:00+01:00"). Preserve that exact instant as
    // started_at — it's the same convention the phone sync uses (local
    // midnight), so the per-day unique index (which buckets by the UTC day of
    // started_at) lands a Terra delivery and a phone sync of the same civil day
    // in the SAME bucket, and the merge below tops up instead of double-awarding.
    // The old code truncated to the UTC day start, which filed positive-offset
    // users' steps under the previous day AND dodged the phone-sync's row.
    const startedAt = new Date(start).toISOString();
    const bucketStart = dayStartUTC(startedAt);
    const bucketEnd = new Date(new Date(bucketStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const end = d.metadata?.end_time;
    const endedAt = end && new Date(end).getTime() < Date.now()
      ? new Date(end).toISOString()
      : new Date().toISOString();
    const targetPoints = stepTierPoints(steps);

    // The day's existing walking session (trust 0.90 marks auto-sync). Queries
    // the unique index's bucket exactly, so insert-vs-lookup can never disagree
    // (the index guarantees at most one row per bucket).
    const findExisting = () => supabase
      .from('activity_sessions')
      .select('id, steps')
      .eq('user_id', userId)
      .eq('type', 'walking')
      .eq('trust_score', 0.90)
      .gte('started_at', bucketStart)
      .lt('started_at', bucketEnd)
      .maybeSingle();

    let { data: existing } = await findExisting();

    if (!existing) {
      const { data: session, error } = await supabase
        .from('activity_sessions')
        .insert({
          user_id: userId, type: 'walking', started_at: startedAt,
          ended_at: endedAt, duration_sec: 0, steps,
          verification: 'wearable', trust_score: 0.90, device_id: null,
        })
        .select('id').single();
      if (!error) {
        if (targetPoints > 0) {
          await supabase.from('point_transactions').insert({
            user_id: userId, session_id: session.id, amount: targetPoints, type: 'earn', source: 'health_sync',
          });
        }
        continue;
      }
      if (error.code !== '23505') { console.error('[terra-webhook] walking insert:', error.message); continue; }
      // Lost the race against a concurrent phone sync — merge into its row.
      ({ data: existing } = await findExisting());
      if (!existing) continue;
    }

    if (steps > (existing.steps ?? 0)) {
      const delta = targetPoints - stepTierPoints(existing.steps ?? 0);
      await supabase.from('activity_sessions').update({ steps }).eq('id', existing.id);
      if (delta > 0) {
        await supabase.from('point_transactions').insert({
          user_id: userId, session_id: existing.id, amount: delta, type: 'earn', source: 'health_sync',
        });
      }
    }
  }
}

// ── Entry ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const rawBody = await req.text();
  const ok = await verifyTerraSignature(rawBody, req.headers.get('terra-signature'), SIGNING_SECRET);
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // Freshness stamp: a sleep/activity/body payload marks this connection as
    // recently delivered, so the terra-poll cron skips it (see
    // terra-poll/index.ts). Lifecycle events (auth/deauth) deliberately don't
    // count — a connection that only ever authed still needs polling. 'daily'
    // doesn't count either: terra-poll requests it unconditionally every cycle
    // (providers like Whoop never auto-push it), and letting those deliveries
    // stamp freshness would mark every connection permanently fresh and starve
    // the sleep/activity re-poll.
    if (['activity', 'sleep', 'body'].includes(payload.type) && payload.user?.user_id) {
      await supabase.from('terra_connections')
        .update({ last_event_at: new Date().toISOString() })
        .eq('terra_user_id', payload.user.user_id);
    }

    // User-facing freshness (powers the home wearable chip + the stale-wearable
    // banner). Unlike last_event_at above, this DOES include 'daily' — otherwise
    // a provider with no sleep/activity data (Strava) would read as silent while
    // syncing fine. Never stamped by auth/deauth: a connection that only ever
    // authed has delivered nothing and must read as "never synced".
    if (DATA_TYPES.has(payload.type) && payload.user?.user_id) {
      await supabase.from('terra_connections')
        .update(freshnessPatch(extractDeviceFreshness(payload)))
        .eq('terra_user_id', payload.user.user_id);
    }

    switch (payload.type) {
      case 'auth': await handleAuth(supabase, payload); break;
      case 'deauth':
      case 'access_revoked':
      case 'connection_error': await handleDeauth(supabase, payload); break;
      case 'activity': await handleActivity(supabase, payload); break;
      case 'sleep': await handleSleep(supabase, payload); break;
      case 'daily': await handleDaily(supabase, payload); break;
      // 'body' and others: ignored for now.
      default: break;
    }
  } catch (e) {
    console.error('[terra-webhook] handler error:', e?.message ?? e);
    // Still 200 so Terra doesn't hammer retries on a single bad record; logged for triage.
  }

  return json({ received: true });
});
