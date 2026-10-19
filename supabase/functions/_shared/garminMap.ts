// Garmin Connect Developer Program payloads → the normalised (Terra-shaped)
// records _shared/wearableIngest.ts credits. Pure and dependency-free, so both
// runtimes import it:
//   - edge function (Deno): import { ... } from '../_shared/garminMap.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/garminMap'
//
// Garmin pushes one JSON body per summary type ("activities", "dailies",
// "sleeps", "hrv", ...), each a list of records carrying the Garmin userId.
// Times are UTC unix seconds plus a separate offset to the device's local time.
//
// What is deliberately NOT credited (anti-cheat — points are money here):
//   - activities with manual: true (typed in on Garmin Connect, no device behind them)
//   - activities with isWebUpload: true (a file uploaded through the website)
//   - multisport parents (isParent: true): their legs arrive as their own
//     activities, so crediting the parent would pay the swim/bike/run twice
//   - sleeps validated MANUAL (entered by hand) or OFF_WRIST (no heart rate
//     behind the stages)

import { terraActivityToPOWR, type ActivityType } from './points.ts';

/** Garmin's own activity types (Activity API, Appendix A) → POWR type. null = not a workout. */
const GARMIN_TYPE_TO_POWR: Record<string, ActivityType | null> = {
  // Running
  RUNNING: 'running', INDOOR_RUNNING: 'running', OBSTACLE_RUN: 'running', STREET_RUNNING: 'running',
  TRACK_RUNNING: 'running', TRAIL_RUNNING: 'running', TREADMILL_RUNNING: 'running', ULTRA_RUN: 'running',
  VIRTUAL_RUN: 'running', WHEELCHAIR_PUSH_RUN: 'running',
  // Cycling
  CYCLING: 'cycling', BMX: 'cycling', CYCLOCROSS: 'cycling', DOWNHILL_BIKING: 'cycling',
  E_BIKE_FITNESS: 'cycling', E_BIKE_MOUNTAIN: 'cycling', E_ENDURO_MTB: 'cycling', ENDURO_MTB: 'cycling',
  GRAVEL_CYCLING: 'cycling', INDOOR_CYCLING: 'cycling', MOUNTAIN_BIKING: 'cycling',
  RECUMBENT_CYCLING: 'cycling', ROAD_BIKING: 'cycling', TRACK_CYCLING: 'cycling', VIRTUAL_RIDE: 'cycling',
  HANDCYCLING: 'cycling', INDOOR_HANDCYCLING: 'cycling',
  // Gym & fitness equipment — the same calls the HealthKit table makes
  // (lib/health/workoutTypes.ts): climbing walls, rowing and stairs are gym,
  // mixed cardio is HIIT, mobility is flexibility work.
  FITNESS_EQUIPMENT: 'gym', BOULDERING: 'gym', ELLIPTICAL: 'gym', INDOOR_CARDIO: 'hiit', HIIT: 'hiit',
  INDOOR_CLIMBING: 'gym', INDOOR_ROWING: 'gym', MOBILITY: 'yoga', PILATES: 'yoga',
  STAIR_CLIMBING: 'gym', STRENGTH_TRAINING: 'gym', YOGA: 'yoga', MEDITATION: 'yoga', FLOOR_CLIMBING: 'gym',
  // Swimming
  SWIMMING: 'swimming', LAP_SWIMMING: 'swimming', OPEN_WATER_SWIMMING: 'swimming',
  // Walking and hiking pay through the day's steps, never as a workout.
  WALKING: null, CASUAL_WALKING: null, SPEED_WALKING: null, HIKING: null, RUCKING: null,
  WHEELCHAIR_PUSH_WALK: null,
  // Winter sports
  WINTER_SPORTS: 'sports', BACKCOUNTRY_SNOWBOARDING: 'sports', BACKCOUNTRY_SKIING: 'sports',
  CROSS_COUNTRY_SKIING_WS: 'sports', RESORT_SKIING: 'sports', SNOWBOARDING_WS: 'sports',
  RESORT_SKIING_SNOWBOARDING_WS: 'sports', SKATE_SKIING_WS: 'sports', SKATING_WS: 'sports',
  SNOW_SHOE_WS: 'sports', SNOWMOBILING_WS: null,
  // Water sports. Rowing is gym, as Terra and HealthKit both have it; riding in
  // a boat or fishing from one is not exercise.
  WATER_SPORTS: 'sports', BOATING: null, FISHING: null, KAYAKING: 'sports', KITEBOARDING: 'sports',
  OFFSHORE_GRINDING: 'sports', ONSHORE_GRINDING: 'sports', PADDLING: 'sports', ROWING: 'gym',
  SAILING: 'sports', SNORKELING: 'sports', STAND_UP_PADDLEBOARDING: 'sports', SURFING: 'sports',
  WAKEBOARDING: 'sports', WATERSKIING: 'sports', WHITEWATER_RAFTING: 'sports', WINDSURFING: 'sports',
  // Multisport transitions are the gap between legs, not a workout.
  TRANSITION: null, BIKE_TO_RUN_TRANSITION: null, RUN_TO_BIKE_TRANSITION: null, SWIM_TO_BIKE_TRANSITION: null,
  // Team and racket sports
  TEAM_SPORTS: 'sports', AMERICAN_FOOTBALL: 'sports', BASEBALL: 'sports', BASKETBALL: 'sports',
  CRICKET: 'sports', FIELD_HOCKEY: 'sports', ICE_HOCKEY: 'sports', LACROSSE: 'sports', RUGBY: 'sports',
  SOCCER: 'sports', SOFTBALL: 'sports', ULTIMATE_DISC: 'sports', VOLLEYBALL: 'sports',
  RACKET_SPORTS: 'sports', BADMINTON: 'sports', PADDELBALL: 'sports', PICKLEBALL: 'sports',
  PLATFORM_TENNIS: 'sports', RACQUETBALL: 'sports', SQUASH: 'sports', TABLE_TENNIS: 'sports', TENNIS: 'sports',
  // Other
  BOXING: 'sports', BREATHWORK: 'yoga', DANCE: 'dance', DISC_GOLF: 'sports', GOLF: 'sports',
  INLINE_SKATING: 'sports', JUMP_ROPE: 'hiit', MIXED_MARTIAL_ARTS: 'sports', MOUNTAINEERING: 'sports',
  ROCK_CLIMBING: 'sports', PARA_SPORTS: 'sports',
  // A generic timer or an unnamed activity is still a workout the user chose to
  // record — the same "never drop it, log it as gym" rule Terra's table follows.
  OTHER: 'gym', STOP_WATCH: 'gym',
};

/**
 * Garmin activity type → POWR type. Garmin suffixes some water-sport and
 * transition types with _V2 ("KAYAKING_V2"); those mean the same as the bare
 * name. A type added after this table was written falls back to Terra's name
 * heuristics, which end in 'gym' rather than dropping a real workout.
 */
export function garminActivityToPOWR(activityType: string | null | undefined): ActivityType | null {
  const key = (activityType ?? '').trim().toUpperCase().replace(/_V2$/, '');
  if (key in GARMIN_TYPE_TO_POWR) return GARMIN_TYPE_TO_POWR[key];
  return terraActivityToPOWR(key.replace(/_/g, ' ').toLowerCase());
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** A finite number, else undefined. Garmin sends explicit nulls for unmeasured fields. */
function n(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A finite number above zero, else undefined. */
function pos(v: unknown): number | undefined {
  const x = n(v);
  return x != null && x > 0 ? x : undefined;
}

/** Mean of a Garmin `{ "<offset>": value }` map, rounded to 1 dp; undefined when empty. */
function mapMean(m: unknown): number | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const vals = Object.values(m as Record<string, unknown>).map(pos).filter((v): v is number => v != null);
  if (vals.length === 0) return undefined;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/** Why an activity was left out, or null when it should be credited. */
export function garminActivitySkipReason(a: any): string | null {
  if (!a || typeof a !== 'object') return 'malformed';
  if (a.manual === true) return 'manual';
  if (a.isWebUpload === true) return 'web_upload';
  if (a.isParent === true) return 'multisport_parent';
  if (n(a.startTimeInSeconds) == null) return 'no_start';
  if (!(pos(a.durationInSeconds))) return 'no_duration';
  return null;
}

/**
 * One Garmin activity summary → one normalised activity record.
 * metadata.powr_type carries the mapped type so the engine skips Terra's table.
 */
export function garminActivityToRecord(a: any) {
  const start = a.startTimeInSeconds as number;
  const dur = a.durationInSeconds as number;
  const typeName = String(a.activityType ?? '');
  const deviceName = typeof a.deviceName === 'string' && a.deviceName.trim() && a.deviceName !== 'unknown'
    ? a.deviceName.trim() : null;
  return {
    metadata: {
      start_time: iso(start),
      end_time: iso(start + dur),
      // The name the user sees in Garmin Connect ("Hyde Park Running"); the
      // type spelled out when Garmin sent no name.
      name: (typeof a.activityName === 'string' && a.activityName.trim())
        || typeName.replace(/_/g, ' ').toLowerCase(),
      powr_type: garminActivityToPOWR(typeName),
    },
    distance_data: {
      summary: {
        distance_meters: n(a.distanceInMeters),
        steps: n(a.steps),
        elevation: {
          gain_actual_meters: n(a.totalElevationGainInMeters),
          loss_actual_meters: n(a.totalElevationLossInMeters),
        },
        // Garmin counts pool LENGTHS; the column has always held what the
        // provider called its swim count, Garmin's included.
        swimming: { num_laps: n(a.numberOfActiveLengths) },
      },
    },
    heart_rate_data: {
      summary: {
        avg_hr_bpm: n(a.averageHeartRateInBeatsPerMinute),
        max_hr_bpm: n(a.maxHeartRateInBeatsPerMinute),
      },
    },
    calories_data: { total_burned_calories: n(a.activeKilocalories) },
    device_data: deviceName ? { name: deviceName } : undefined,
  };
}

/** One Garmin daily summary → one normalised daily record (steps + resting HR). */
export function garminDailyToRecord(d: any) {
  const start = n(d?.startTimeInSeconds);
  if (start == null) return null;
  const dur = n(d.durationInSeconds) ?? 86400;
  return {
    metadata: {
      // The user's local midnight as an instant — the same convention Terra
      // used, so a phone sync of the same day lands in the same bucket.
      start_time: iso(start),
      end_time: iso(start + dur),
    },
    distance_data: { steps: n(d.steps) },
    heart_rate_data: { summary: { resting_hr_bpm: pos(d.restingHeartRateInBeatsPerMinute) } },
  };
}

/** Sleep validations that carry no device-measured night. */
const UNCREDITED_SLEEP = new Set(['MANUAL', 'OFF_WRIST']);

export function garminSleepSkipReason(s: any): string | null {
  if (!s || typeof s !== 'object') return 'malformed';
  const v = String(s.validation ?? '').toUpperCase();
  if (UNCREDITED_SLEEP.has(v)) return v.toLowerCase();
  if (n(s.startTimeInSeconds) == null) return 'no_start';
  return null;
}

/**
 * One Garmin sleep summary → one normalised sleep record.
 *
 * Garmin's durationInSeconds is asleep PLUS awake (both examples in the Health
 * API spec add up that way, whatever its prose says), so time asleep comes off
 * the stage total instead — resolveSleepSeconds prefers it over time in bed.
 * The window ends where the last sleep level ends; without levels, at
 * start + duration + unmeasured time.
 */
export function garminSleepToRecord(s: any) {
  const start = s.startTimeInSeconds as number;
  const deep = pos(s.deepSleepDurationInSeconds);
  const light = pos(s.lightSleepDurationInSeconds);
  const rem = pos(s.remSleepInSeconds);
  const unmeasured = pos(s.unmeasurableSleepInSeconds) ?? pos(s.unmeasurableSleepDurationInSeconds) ?? 0;
  const inBed = (pos(s.durationInSeconds) ?? 0) + unmeasured;

  let end = start + inBed;
  const levels = s.sleepLevelsMap && typeof s.sleepLevelsMap === 'object' ? s.sleepLevelsMap : {};
  for (const ranges of Object.values(levels)) {
    if (!Array.isArray(ranges)) continue;
    for (const r of ranges) {
      const e = n(r?.endTimeInSeconds);
      if (e != null && e > end) end = e;
    }
  }

  return {
    metadata: { start_time: iso(start), end_time: iso(end) },
    sleep_durations_data: {
      asleep: {
        duration_deep_sleep_state_seconds: deep,
        duration_REM_sleep_state_seconds: rem,
        duration_light_sleep_state_seconds: light,
      },
      other: { duration_in_bed_seconds: inBed > 0 ? inBed : undefined },
    },
    respiration_data: {
      breaths_data: { avg_breaths_per_min: mapMean(s.timeOffsetSleepRespiration) },
      oxygen_saturation_data: { avg_saturation_percentage: mapMean(s.timeOffsetSleepSpo2) },
    },
  };
}

/**
 * One Garmin HRV summary (last night's average RMSSD) → a daily record that
 * carries only the HRV, filed on the day the user woke up (calendarDate), at
 * that day's local midnight — where the daily summary's resting HR lands too.
 */
export function garminHrvToRecord(h: any) {
  const avg = pos(h?.lastNightAvg);
  const date = typeof h?.calendarDate === 'string' ? h.calendarDate : null;
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (avg == null || !m) return null;
  const offset = n(h.startTimeOffsetInSeconds) ?? 0;
  const localMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000 - offset;
  return {
    metadata: { start_time: iso(localMidnight), end_time: iso(localMidnight + 86400) },
    heart_rate_data: { summary: { avg_hrv_rmssd: avg } },
  };
}

/** The device behind a batch of activities, for the connection's "synced from" label. */
export function garminDeviceName(activities: any[]): string | null {
  for (const a of activities ?? []) {
    const d = typeof a?.deviceName === 'string' ? a.deviceName.trim() : '';
    if (d && d !== 'unknown') return d;
  }
  return null;
}

/** Group a summary list by Garmin userId. Records without one are dropped. */
export function groupByUser<T extends { userId?: unknown }>(records: T[] | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of records ?? []) {
    const id = typeof r?.userId === 'string' ? r.userId : null;
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push(r);
    out.set(id, list);
  }
  return out;
}
