/**
 * Sleep is keyed on the instant it started, not the day it falls in.
 *
 * These exist because of a real loss. On 2026-08-21 jamiemasonwright had no
 * sleep for the night of 08-20→08-21. Terra was delivering it — ~30-60 webhook
 * POSTs an hour, all 200, connection fresh. The row was thrown away by
 * idx_one_session_per_type_per_day, which held ONE sleep per user per UTC day
 * keyed on the BEDTIME day: a 1.49h fragment carrying start_time 08-20 03:21
 * had already taken the 2026-08-20 bucket, so the real night beginning ~21:30
 * that same UTC day raised 23505 and terra-webhook's handleSleep silently
 * discarded it. terra-poll replays a rolling 2-day window, so it was
 * re-delivered and re-dropped every cycle and never self-healed.
 *
 * Migration 20260821140000 moved wearable sleep onto its start instant, which
 * removes the collision but also removes what the bucket was providing:
 * idempotence against a provider restating a night. Overlap supplies it
 * instead — the same test the workout path has used since 2026-08-07. So the
 * distinction that must hold for sleep windows:
 *
 *   a nap and that night's sleep   → 'separate'   (two rows; the bug)
 *   a night restated by Terra      → 'same'       (fold in, take the fuller)
 *   a night split across an awake  → 'contiguous' (one night, durations sum)
 */
import {
  mergeWorkouts,
  relateWorkouts,
  type WorkoutWindow,
} from '@/supabase/functions/_shared/sessionMerge';

/** Build a sleep window the way terra-webhook's handleSleep does. */
function sleep(startIso: string, endIso: string): WorkoutWindow {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  return {
    startMs,
    endMs,
    durationSec: Math.round((endMs - startMs) / 1000),
    distanceM: null,
    hrAvg: null,
  };
}

const utcDay = (w: WorkoutWindow) => new Date(w.startMs).toISOString().slice(0, 10);

describe('sleep segments', () => {
  // The exact rows from the incident.
  const fragment = sleep('2026-08-20T03:21:21.840Z', '2026-08-20T04:50:50.870Z');
  const thatNight = sleep('2026-08-20T21:30:00.000Z', '2026-08-21T05:30:00.000Z');

  it('keeps a fragment and that night as SEPARATE sleeps, though they share a UTC day', () => {
    // The precondition for the bug: both sat in the 2026-08-20 bucket.
    expect(utcDay(fragment)).toBe('2026-08-20');
    expect(utcDay(thatNight)).toBe('2026-08-20');

    // ...and yet they are not the same sleep, so both must be recorded.
    expect(relateWorkouts(fragment, thatNight)).toBe('separate');
  });

  it('keeps a daytime nap and that evening′s sleep separate', () => {
    // 2026-08-15: a 2.33h nap at 11:30 UTC took the bucket and ate the night.
    const nap = sleep('2026-08-15T11:30:44.610Z', '2026-08-15T13:50:21.840Z');
    const night = sleep('2026-08-15T21:32:13.220Z', '2026-08-16T05:31:38.890Z');
    expect(utcDay(nap)).toBe(utcDay(night));
    expect(relateWorkouts(nap, night)).toBe('separate');
  });

  it('absorbs a restatement of the same night, whatever start instant it carries', () => {
    // Terra restates a night's window after the fact and terra-poll replays it.
    // This is what has to keep re-delivery idempotent now the day bucket is gone.
    const restated = sleep('2026-08-20T21:28:00.000Z', '2026-08-21T05:34:00.000Z');
    expect(relateWorkouts(thatNight, restated)).toBe('same');

    const merged = mergeWorkouts(thatNight, restated, 'same');
    // The fuller telling wins; a night never shrinks on re-delivery.
    expect(merged.durationSec).toBe(Math.max(thatNight.durationSec, restated.durationSec));
    expect(merged.startMs).toBe(restated.startMs); // earliest bedtime we have seen
    expect(merged.endMs).toBe(restated.endMs);     // latest wake we have seen
  });

  it('reports a stale replay as unchanged so it costs nothing', () => {
    const shorterReplay = sleep('2026-08-20T21:45:00.000Z', '2026-08-21T05:10:00.000Z');
    expect(relateWorkouts(thatNight, shorterReplay)).toBe('same');
    expect(mergeWorkouts(thatNight, shorterReplay, 'same').changed).toBe(false);
  });

  it('stitches a night the provider split across a short awake gap', () => {
    const firstHalf = sleep('2026-08-20T21:30:00.000Z', '2026-08-21T01:00:00.000Z');
    const secondHalf = sleep('2026-08-21T01:20:00.000Z', '2026-08-21T05:30:00.000Z');
    expect(relateWorkouts(firstHalf, secondHalf)).toBe('contiguous');

    const merged = mergeWorkouts(firstHalf, secondHalf, 'contiguous');
    // Durations SUM — the 20 minutes awake are not sleep, so elapsed time would
    // over-credit the night.
    expect(merged.durationSec).toBe(firstHalf.durationSec + secondHalf.durationSec);
    expect(merged.durationSec).toBe(Math.round(7.6667 * 3600));
    expect(merged.startMs).toBe(firstHalf.startMs);
    expect(merged.endMs).toBe(secondHalf.endMs);
  });

  it('does not stitch two nights that merely fall either side of one UTC day', () => {
    // A bedtime that drifts across UTC midnight put two nights in one bucket too.
    const nightA = sleep('2026-08-17T00:11:00.000Z', '2026-08-17T07:11:00.000Z');
    const nightB = sleep('2026-08-17T23:07:00.000Z', '2026-08-18T05:37:00.000Z');
    expect(utcDay(nightA)).toBe(utcDay(nightB));
    expect(relateWorkouts(nightA, nightB)).toBe('separate');
  });
});
