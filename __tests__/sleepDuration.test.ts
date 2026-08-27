/**
 * A night is how long you SLEPT, not how long you were in bed.
 *
 * These exist because of a real, visible wrong number. terra-webhook's
 * handleSleep resolved a night's duration as
 *
 *     inBedSec ?? asleepSec ?? fallbackSec
 *
 * so `duration_in_bed_seconds` won whenever the provider sent it — which Whoop
 * always does. On 2026-08-23 the Progress page showed 11h 6m for the night of
 * 08-22 while Whoop's own app showed 8h 48m: session bc0cebb8 stored 40,081s,
 * the exact wall-clock span 21:05:40 → 08:13:41, with 2h 20m of it awake. The
 * stages already on that row (deep 2.44 + REM 2.64 + light 3.76 = 8h 51m) had
 * been right all along, which is also what made the backfill possible without
 * re-fetching anything from Terra (migration 20260823110100).
 *
 * It ran across the whole wearable fleet: 188 rows, 9 users, 28 min/night high
 * on average and 2h 17m at worst. Not the HealthKit rows, though — that reader
 * drops the inBed and awake samples and sums stages, so it was already correct,
 * and the two paths had simply been storing different quantities under one name.
 */
import {
  positiveSec,
  resolveSleepSeconds,
  stageTotalSec,
} from '@/supabase/functions/_shared/sleepDuration';

const H = 3600;

// The real payload shape for the night that surfaced this, to the second.
const NIGHT_START = '2026-08-22T20:05:40.880Z';
const NIGHT_END = '2026-08-23T07:13:41.890Z';
const IN_BED = 40081;          // 11h 08m — the whole bed window
const ASLEEP = 31845;          // 8h 50m 45s — deep + REM + light

const whoopNight = {
  asleep: {
    duration_asleep_state_seconds: ASLEEP,
    duration_deep_sleep_state_seconds: 8790,
    duration_REM_sleep_state_seconds: 9511,
    duration_light_sleep_state_seconds: 13544,
  },
  other: { duration_in_bed_seconds: IN_BED },
};

describe('resolveSleepSeconds', () => {
  it('reports the night that surfaced the bug as asleep, not in bed', () => {
    const sec = resolveSleepSeconds(whoopNight, NIGHT_START, NIGHT_END);

    expect(sec).toBe(ASLEEP);
    // The number the user actually saw, and must never see again.
    expect(Math.round((sec / H) * 10) / 10).not.toBe(11.1);
    // Whoop's own figure for that night, to within a couple of minutes.
    expect(sec / H).toBeCloseTo(8.8, 1);
  });

  it('never returns the bed window when an asleep figure exists', () => {
    const sec = resolveSleepSeconds(whoopNight, NIGHT_START, NIGHT_END);
    expect(sec).toBeLessThan(IN_BED);
    expect(sec).toBeLessThan(Date.parse(NIGHT_END) - Date.parse(NIGHT_START));
  });

  it('falls back to the stage total when the provider states no asleep figure', () => {
    const { duration_asleep_state_seconds: _omitted, ...stagesOnly } = whoopNight.asleep;
    const sec = resolveSleepSeconds(
      { asleep: stagesOnly, other: { duration_in_bed_seconds: IN_BED } },
      NIGHT_START, NIGHT_END,
    );
    // Stages beat in-bed: they measure sleep, in-bed measures furniture.
    expect(sec).toBe(8790 + 9511 + 13544);
    expect(sec).toBeLessThan(IN_BED);
  });

  it('uses in-bed only when the device measured nothing about sleep itself', () => {
    const sec = resolveSleepSeconds(
      { other: { duration_in_bed_seconds: IN_BED } },
      NIGHT_START, NIGHT_END,
    );
    expect(sec).toBe(IN_BED);
  });

  it('falls back to the window when the payload carries no durations at all', () => {
    expect(resolveSleepSeconds({}, NIGHT_START, NIGHT_END))
      .toBe(Math.round((Date.parse(NIGHT_END) - Date.parse(NIGHT_START)) / 1000));
    expect(resolveSleepSeconds(null, NIGHT_START, NIGHT_END))
      .toBe(Math.round((Date.parse(NIGHT_END) - Date.parse(NIGHT_START)) / 1000));
  });

  it('treats a zeroed asleep figure as absent rather than as a night of no sleep', () => {
    // A night resolved to 0 is dropped by handleSleep's `hours < 1` guard, so a
    // provider that pads the field with 0 would silently lose the whole night.
    const sec = resolveSleepSeconds(
      { asleep: { duration_asleep_state_seconds: 0 }, other: { duration_in_bed_seconds: IN_BED } },
      NIGHT_START, NIGHT_END,
    );
    expect(sec).toBe(IN_BED);
  });
});

describe('stageTotalSec', () => {
  it('sums the stages it has', () => {
    expect(stageTotalSec(whoopNight.asleep)).toBe(8790 + 9511 + 13544);
  });

  it('is null when no stage is present, so the caller falls through', () => {
    expect(stageTotalSec({})).toBeNull();
    expect(stageTotalSec(undefined)).toBeNull();
    expect(stageTotalSec({ duration_deep_sleep_state_seconds: null })).toBeNull();
  });

  it('sums a partial breakdown rather than discarding it', () => {
    expect(stageTotalSec({
      duration_deep_sleep_state_seconds: 3600,
      duration_REM_sleep_state_seconds: 1800,
    })).toBe(5400);
  });
});

describe('positiveSec', () => {
  it('accepts only a real, positive duration', () => {
    expect(positiveSec(120)).toBe(120);
    expect(positiveSec(0)).toBeNull();
    expect(positiveSec(-5)).toBeNull();
    expect(positiveSec(null)).toBeNull();
    expect(positiveSec(undefined)).toBeNull();
    expect(positiveSec('3600')).toBeNull();
    expect(positiveSec(NaN)).toBeNull();
    expect(positiveSec(Infinity)).toBeNull();
  });
});
