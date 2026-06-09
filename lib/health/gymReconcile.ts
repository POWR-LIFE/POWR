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

import { supabase } from '@/lib/supabase';
import {
  computeCorrectedWindow,
  ENTRY_BACKDATE_MARGIN_MS,
  EXIT_COOLDOWN_BUFFER_MS,
  type StepSample,
} from './gymPresence';

const FORTY_MIN_SEC = 40 * 60;
/** Ignore sub-minute corrections so GPS jitter never rewrites a row. */
const MIN_CORRECTION_SEC = 60;

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

/** Corrects one gym session's duration/start/end against step activity. Idempotent. */
export async function reconcileGymSession(session: GymSessionRow): Promise<void> {
  const startMs = new Date(session.started_at).getTime();
  const endMs = session.ended_at
    ? new Date(session.ended_at).getTime()
    : startMs + session.duration_sec * 1000;

  // Read a little before/after the GPS window to catch early arrival / late departure.
  const samples = await getStepSamples(startMs - ENTRY_BACKDATE_MARGIN_MS, endMs + EXIT_COOLDOWN_BUFFER_MS);
  if (samples === null) return; // health unavailable — keep the GPS-derived value

  const corrected = computeCorrectedWindow(startMs, endMs, samples);
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

  const { error } = await supabase
    .from('activity_sessions')
    .update({
      started_at: new Date(corrected.startMs).toISOString(),
      ended_at: new Date(corrected.endMs).toISOString(),
      duration_sec: corrected.durationSec,
    })
    .eq('id', session.id);
  if (error) {
    console.warn('[gymReconcile] update failed:', error.message);
    return;
  }
  console.log(
    `[gymReconcile] ${session.id.slice(0, 8)}… ${Math.round(session.duration_sec / 60)}m → ${Math.round(corrected.durationSec / 60)}m`,
  );
}

/**
 * Reconciles recent geofence gym sessions (started within the last 24 h). Safe to
 * call repeatedly — `computeCorrectedWindow` is idempotent (a settled row produces
 * no change), so this no-ops once a session is corrected. Best-effort; failures are
 * swallowed so it never blocks the health sync.
 */
export async function reconcileRecentGymSessions(): Promise<void> {
  if (Platform.OS === 'web') return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('activity_sessions')
    .select('id, started_at, ended_at, duration_sec')
    .eq('type', 'gym')
    .eq('verification', 'geofence')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(3);
  if (error || !data) return;

  for (const session of data as GymSessionRow[]) {
    try {
      await reconcileGymSession(session);
    } catch (e) {
      console.warn('[gymReconcile] reconcile failed:', e);
    }
  }
}
