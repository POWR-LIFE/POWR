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
// and rely on the idx_one_session_per_type_per_day unique index (user_id, type,
// trust_score, day) for idempotency on Terra re-delivery.
import { createClient } from '@supabase/supabase-js';
import {
  calculateBasePoints,
  calculateSleepPoints,
  stepTierPoints,
  terraActivityToPOWR,
  terraResourceToSource,
} from '../_shared/points.ts';
import { verifyTerraSignature } from '../_shared/terraSignature.ts';

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
async function insertSession(supabase, row, points: number): Promise<boolean> {
  const { data: session, error } = await supabase
    .from('activity_sessions')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return false; // already have this type for the day
    console.error('[terra-webhook] session insert failed:', error.message);
    return false;
  }
  if (points > 0) {
    await supabase.from('point_transactions').insert({
      user_id: row.user_id, session_id: session.id, amount: points, type: 'earn', source: 'health_sync',
    });
  }
  return true;
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
 * wearable-sync duplicate item. Returns true when the window overlaps and the
 * wearable session should be dropped.
 */
async function overlapsGeofenceGym(
  supabase, userId: string, startMs: number, endMs: number,
): Promise<boolean> {
  // Bound the query by day (±1d) for index use, then check exact overlap in JS.
  const windowStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(endMs + 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('activity_sessions')
    .select('started_at, ended_at, duration_sec')
    .eq('user_id', userId)
    .eq('type', 'gym')
    .eq('verification', 'geofence')
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd);
  if (!data) return false;
  for (const g of data) {
    const gStart = new Date(g.started_at).getTime();
    const gEnd = g.ended_at
      ? new Date(g.ended_at).getTime()
      : gStart + (g.duration_sec ?? 0) * 1000;
    if (startMs < gEnd && endMs > gStart) return true; // half-open overlap
  }
  return false;
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

async function handleActivity(supabase, payload): Promise<void> {
  const userId = await resolveUserId(supabase, payload);
  if (!userId) return;
  const source = terraResourceToSource(payload?.user?.provider ?? '');

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

    // Gym geofence wins: if this wearable workout overlaps a geofence gym check-in,
    // it's the same time at the gym — drop it so we don't double-count points.
    const startMs = new Date(start).getTime();
    const endMs = end ? new Date(end).getTime() : startMs + durSec * 1000;
    if (await overlapsGeofenceGym(supabase, userId, startMs, endMs)) {
      console.log(`[terra-webhook] suppressing ${type} (${Math.round(durMin)}m) — overlaps geofence gym session`);
      continue;
    }

    const distanceM = a.distance_data?.summary?.distance_meters;
    const hrAvg = a.heart_rate_data?.summary?.avg_hr_bpm;
    const points = calculateBasePoints(type, durMin);

    const inserted = await insertSession(supabase, {
      user_id: userId,
      type,
      started_at: start,
      ended_at: end ?? new Date(new Date(start).getTime() + durSec * 1000).toISOString(),
      duration_sec: durSec,
      distance_m: distanceM != null ? Math.round(distanceM) : null,
      hr_avg: hrAvg != null ? Math.round(hrAvg) : null,
      verification: 'wearable',
      trust_score: 0.85,
      device_id: null,
      raw_activity_name: (meta.name ?? '').trim().slice(0, 80) || null,
    }, points);

    if (inserted) {
      // Wearable outranks manual: remove any overlapping manual session of this
      // type and reverse its points (geofence already handled above).
      await supersedeManualOverlaps(supabase, userId, type, startMs, endMs);
      await supabase.from('health_snapshots').insert({
        user_id: userId,
        distance_m: distanceM != null ? Math.round(distanceM) : null,
        hr_avg: hrAvg != null ? Math.round(hrAvg) : null,
        calories_active: a.calories_data?.total_burned_calories != null
          ? Math.round(a.calories_data.total_burned_calories) : null,
        activity_type: type,
        duration_sec: durSec,
        source,
      });
      if (isToday(start)) await bumpStreak(supabase, userId);
    }
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
    const inBedSec = dur.other?.duration_in_bed_seconds;
    const asleepSec = asleep.duration_asleep_state_seconds;
    const fallbackSec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    const totalSec = inBedSec ?? asleepSec ?? fallbackSec;
    const hours = totalSec / 3600;
    if (hours < 1) continue; // ignore very short naps (matches client)

    const deepH = asleep.duration_deep_sleep_state_seconds != null
      ? asleep.duration_deep_sleep_state_seconds / 3600 : undefined;
    const remH = asleep.duration_REM_sleep_state_seconds != null
      ? asleep.duration_REM_sleep_state_seconds / 3600 : undefined;
    const lightH = asleep.duration_light_sleep_state_seconds != null
      ? asleep.duration_light_sleep_state_seconds / 3600 : undefined;
    const points = calculateSleepPoints(hours, deepH, remH);

    const inserted = await insertSession(supabase, {
      user_id: userId,
      type: 'sleep',
      started_at: start,
      ended_at: end,
      duration_sec: Math.round(hours * 3600),
      verification: 'wearable',
      trust_score: 0.85,
      device_id: null,
    }, points);

    if (inserted) {
      await supabase.from('health_snapshots').insert({
        user_id: userId,
        sleep_duration_h: hours,
        sleep_deep_h: deepH ?? null,
        sleep_rem_h: remH ?? null,
        sleep_light_h: lightH ?? null,
        activity_type: 'sleep',
        duration_sec: Math.round(hours * 3600),
        source,
      });
    }
  }
}

async function handleDaily(supabase, payload): Promise<void> {
  const userId = await resolveUserId(supabase, payload);
  if (!userId) return;

  for (const d of payload.data ?? []) {
    const start = d.metadata?.start_time;
    const steps = d.distance_data?.steps;
    if (!start || steps == null || steps <= 0) continue;

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
