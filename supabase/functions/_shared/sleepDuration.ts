/**
 * How long a night of sleep lasted, from a Terra `sleep_durations_data` block.
 *
 * The answer is TIME ASLEEP. terra-webhook preferred `duration_in_bed_seconds`
 * until 2026-08-23, which billed every wearable night as its whole bed window:
 * the night of 08-22 stored 11h08 against Whoop's own 8h48, because 2h20 of it
 * was spent lying awake. It also left the two ingest paths meaning different
 * things by the same word — the HealthKit reader (useHealthData's
 * iosGetLastNightSleep) has always discarded the inBed and awake samples and
 * summed only the stages.
 *
 * Lives in _shared rather than inline in handleSleep so the preference order is
 * a thing that can be tested, which is what this file is really for.
 */

export interface SleepDurationsData {
  asleep?: {
    duration_asleep_state_seconds?: unknown;
    duration_deep_sleep_state_seconds?: unknown;
    duration_REM_sleep_state_seconds?: unknown;
    duration_light_sleep_state_seconds?: unknown;
  };
  other?: {
    duration_in_bed_seconds?: unknown;
  };
}

/** A duration we can believe: present, numeric, finite and above zero. */
export function positiveSec(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * deep + REM + light. Null unless at least one stage is present, so a provider
 * that sends no breakdown falls through to the next source rather than
 * reporting a night of zero seconds.
 */
export function stageTotalSec(asleep: SleepDurationsData['asleep']): number | null {
  const stages = [
    asleep?.duration_deep_sleep_state_seconds,
    asleep?.duration_REM_sleep_state_seconds,
    asleep?.duration_light_sleep_state_seconds,
  ].map(positiveSec);
  if (stages.every(s => s === null)) return null;
  return stages.reduce((sum: number, s) => sum + (s ?? 0), 0);
}

/**
 * Resolve a night's duration in seconds, best measurement first.
 *
 *   1. the stated asleep total — the provider's own answer to this exact question
 *   2. the stage total — a provider that splits the night into deep/REM/light but
 *      never states an asleep figure is still telling us how long it slept
 *   3. time in bed — measures the wrong thing, but for a device that measures
 *      nothing else it is the only number there is
 *   4. the window — start to end, the loosest bound of all
 *
 * 3 and 4 both include awake time, which is why they rank below anything the
 * device actually observed about sleep.
 */
export function resolveSleepSeconds(
  dur: SleepDurationsData | null | undefined,
  startIso: string,
  endIso: string,
): number {
  const windowSec = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  return positiveSec(dur?.asleep?.duration_asleep_state_seconds)
    ?? positiveSec(stageTotalSec(dur?.asleep))
    ?? positiveSec(dur?.other?.duration_in_bed_seconds)
    ?? windowSec;
}
