// Pure, dependency-free helpers shared by the terra-webhook edge function and
// the Jest unit tests. NO Deno or React Native APIs here, so both runtimes can
// import it:
//   - edge function (Deno): import { ... } from '../_shared/points.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/points'
//
// The point tables mirror the client-side logic in hooks/useHealthSync.ts
// (calculateBasePoints / calculateSleepPoints) and lib/api/activity.ts
// (stepTierPoints). Keep them in sync — the client computes points for native
// health sync, this computes them for Terra-delivered (webhook) data.

export type ActivityType =
  | 'walking' | 'running' | 'cycling' | 'swimming' | 'gym'
  | 'hiit' | 'sports' | 'yoga' | 'dance' | 'sleep';

/** Minimum session duration (minutes) below which a workout earns 0 points.
 *  Mirrors constants/activities.ts `minDuration`. */
export const ACTIVITY_MIN_DURATION: Record<ActivityType, number> = {
  walking: 0,
  running: 15,
  cycling: 20,
  swimming: 15,
  gym: 30,
  hiit: 20,
  sports: 30,
  yoga: 20,
  dance: 20,
  sleep: 0,
};

/** Base points for a workout. Mirrors calculateBasePoints in hooks/useHealthSync.ts. */
export function calculateBasePoints(type: ActivityType, durationMin: number): number {
  if (durationMin < ACTIVITY_MIN_DURATION[type]) return 0;
  if (type === 'gym') return 10;
  if (type === 'running' || type === 'cycling') return 10;
  if (type === 'swimming') return 7;
  if (type === 'hiit') return 10;
  if (type === 'sports') return 6;
  if (type === 'yoga') return 3;
  return 5;
}

/** Sleep points, scaled by restorative ratio. Mirrors calculateSleepPoints in hooks/useHealthSync.ts. */
export function calculateSleepPoints(hours: number, deepHours?: number, remHours?: number): number {
  let base = 0;
  if (hours >= 8) base = 5;
  else if (hours >= 7) base = 4;
  else if (hours >= 6) base = 3;
  else if (hours >= 5) base = 2;
  else if (hours >= 3) base = 1;

  if (base === 0) return 0;

  if (deepHours !== undefined && remHours !== undefined) {
    const restorativeRatio = (deepHours + remHours) / hours;
    const multiplier =
      restorativeRatio >= 0.35 ? 1.0 :
      restorativeRatio >= 0.25 ? 0.85 :
      restorativeRatio >= 0.15 ? 0.70 :
      0.60;
    return Math.max(1, Math.round(base * multiplier));
  }
  return base;
}

/** Points for a daily step count. Mirrors stepTierPoints in lib/api/activity.ts. */
export function stepTierPoints(steps: number): number {
  if (steps >= 10000) return 5;
  if (steps >= 8000) return 4;
  if (steps >= 6000) return 3;
  if (steps >= 4000) return 2;
  return 0;
}

// ── Terra activity → POWR canonical type ──────────────────────────────────────
// Terra normalises EVERY provider's workouts into one shared taxonomy: each
// activity carries metadata.type (Terra's stable integer enum) + metadata.name.
// We map deterministically off the integer enum (authoritative — sourced from
// Terra's OpenAPI schemas/ActivityType.yaml), falling back to name heuristics
// only for any future int we don't yet know.
//
// `null` means "don't create a workout session": walking/hiking are handled via
// the `daily` steps payload (same split as the native path), and non-exercise
// entries (driving, housework, elevators, motorsport, etc.) are ignored.
//
// IMPORTANT: an activity payload that Terra DID send but we don't recognise is
// still a real workout the user logged — it must land as a session, not vanish.
// So the generic catch-alls "Unknown" (4) and "Other" (108) default to 'gym'
// (Whoop's unspecified "Activity" comes through as 108), and terraActivityToPOWR
// also defaults any future-unknown int to 'gym'. Only the explicit non-exercise
// sensor states below stay null. See terraActivityToPOWR.
const TERRA_TYPE_TO_POWR: Record<number, ActivityType | null> = {
  0: null,        // In Vehicle
  1: 'cycling',   // Biking
  3: null,        // Still
  4: 'gym',       // Unknown → generic workout, log as gym (don't drop)
  5: null,        // Tilting
  7: null,        // Walking → daily steps
  8: 'running',   // Running
  9: 'dance',     // Aerobics
  10: 'sports',   // Badminton
  11: 'sports',   // Baseball
  12: 'sports',   // Basketball
  13: 'sports',   // Biathlon
  14: 'cycling',  // Hand Biking
  15: 'cycling',  // Mountain Biking
  16: 'cycling',  // Road Biking
  17: 'cycling',  // Spinning
  18: 'cycling',  // Stationary Biking
  19: 'cycling',  // Utility Biking
  20: 'sports',   // Boxing
  21: 'gym',      // Calisthenics
  22: 'hiit',     // Circuit Training
  23: 'sports',   // Cricket
  24: 'dance',    // Dancing
  25: 'gym',      // Elliptical
  26: 'sports',   // Fencing
  27: 'sports',   // American Football
  28: 'sports',   // Australian Football
  29: 'sports',   // English Football
  30: 'sports',   // Frisbee
  31: null,       // Gardening
  32: 'sports',   // Golf
  33: 'sports',   // Gymnastics
  34: 'sports',   // Handball
  35: null,       // Hiking → daily steps
  36: 'sports',   // Hockey
  37: 'sports',   // Horseback Riding
  38: null,       // Housework
  39: 'hiit',     // Jumping Rope
  40: 'sports',   // Kayaking
  41: 'gym',      // Kettlebell Training
  42: 'sports',   // Kickboxing
  43: 'sports',   // Kitesurfing
  44: 'sports',   // Martial Arts
  45: 'yoga',     // Meditation
  46: 'sports',   // Mixed Martial Arts
  47: 'hiit',     // P90X Exercises
  48: null,       // Paragliding
  49: 'yoga',     // Pilates
  50: 'sports',   // Polo
  51: 'sports',   // Racquetball
  52: 'sports',   // Rock Climbing
  53: 'gym',      // Rowing
  54: 'gym',      // Rowing Machine
  55: 'sports',   // Rugby
  56: 'running',  // Jogging
  57: 'running',  // Running on Sand
  58: 'running',  // Treadmill Running
  59: 'sports',   // Sailing
  60: 'sports',   // Scuba Diving
  61: 'sports',   // Skateboarding
  62: 'sports',   // Skating
  63: 'sports',   // Cross Skating
  64: 'sports',   // Indoor Rollerblading
  65: 'sports',   // Skiing
  66: 'sports',   // Back Country Skiing
  67: 'sports',   // Cross Country Skiing
  68: 'sports',   // Downhill Skiing
  69: 'sports',   // Kite Skiing
  70: 'sports',   // Roller Skiing
  71: null,       // Sledding
  73: 'sports',   // Snowboarding
  74: null,       // Snowmobile
  75: 'sports',   // Snowshoeing
  76: 'sports',   // Squash
  77: 'gym',      // Stair Climbing
  78: 'gym',      // Stair Climbing Machine
  79: 'sports',   // Stand Up Paddleboarding
  80: 'gym',      // Strength Training
  81: 'sports',   // Surfing
  82: 'swimming', // Swimming
  83: 'swimming', // Swimming in Pool
  84: 'swimming', // Open Water Swimming
  85: 'sports',   // Table Tennis
  86: 'sports',   // Team Sports
  87: 'sports',   // Tennis
  88: 'running',  // Treadmill
  89: 'sports',   // Volleyball
  90: 'sports',   // Beach Volleyball
  91: 'sports',   // Indoor Volleyball
  92: 'sports',   // Wakeboarding
  93: null,       // Walking for Fitness → daily steps
  94: null,       // Nordic Walking → daily steps
  95: null,       // Treadmill Walking → daily steps
  96: 'sports',   // Water Polo
  97: 'gym',      // Weightlifting
  98: null,       // Wheelchair
  99: 'sports',   // Windsurfing
  100: 'yoga',    // Yoga
  101: 'dance',   // Zumba
  102: 'sports',  // Diving
  103: 'gym',     // Ergometer
  104: 'sports',  // Ice Skating
  105: 'sports',  // Indoor Skating
  106: 'sports',  // Curling
  108: 'gym',     // Other → generic workout, log as gym (Whoop's unspecified "Activity")
  113: 'hiit',    // CrossFit
  114: 'hiit',    // HIIT
  115: 'hiit',    // Interval Training
  116: null,      // Walking with Stroller → daily steps
  117: null,      // Elevator
  118: null,      // Escalator
  119: 'sports',  // Archery
  120: 'sports',  // Softball
  122: 'yoga',    // Guided Breathing
  123: 'hiit',    // Cardio Training
  124: 'sports',  // Lacrosse
  125: 'yoga',    // Stretching
  126: 'running', // Triathlon
  127: 'sports',  // Inline Skating
  128: null,      // Sky Diving
  129: 'sports',  // Paddling
  130: 'sports',  // Mountaineering
  131: null,      // Fishing
  132: 'sports',  // Water Skiing
  133: 'running', // Indoor Running
  134: 'sports',  // Padel Tennis
  135: null,      // Driving
  136: null,      // Off-Road Driving
  137: null,      // Motorbiking
  138: null,      // Motor Racing
  139: null,      // Enduro
  140: 'sports',  // Canoeing
  141: 'sports',  // Orienteering
  142: null,      // Hang Gliding
  143: null,      // Flying
  144: null,      // Hot Air Ballooning
  145: null,      // Jet Skiing
  146: null,      // Power Boating
  147: 'sports',  // Gaelic Football
  148: 'sports',  // Hurling
};

export function terraActivityToPOWR(name: string, terraType?: number): ActivityType | null {
  // Authoritative: Terra's normalised activity-type enum.
  if (terraType !== undefined && terraType in TERRA_TYPE_TO_POWR) {
    return TERRA_TYPE_TO_POWR[terraType];
  }
  // Fallback for any unknown/new int: name heuristics. Order matters — check the
  // most specific buckets first (e.g. gymnastics before the bare 'gym' token).
  // A workout we can't name is still a real workout the user did, so anything
  // that reaches the end falls back to 'gym' rather than being dropped — except
  // walking/hiking, which route to the daily-steps path instead.
  const n = (name ?? '').toLowerCase();
  if (!n) return 'gym'; // unnamed activity payload — still a logged workout
  if (n.includes('walk') || n.includes('hik')) return null; // handled via daily steps
  if (n.includes('run') || n.includes('jog') || n.includes('treadmill')) return 'running';
  if (n.includes('cycl') || n.includes('biking') || n.includes('bike') || n.includes('spin')) return 'cycling';
  if (n.includes('swim')) return 'swimming';
  if (n.includes('gymnastics')) return 'sports';
  if (n.includes('danc') || n.includes('zumba') || n.includes('barre') || n.includes('aerobic')) return 'dance';
  if (n.includes('hiit') || n.includes('boot') || n.includes('circuit')
    || n.includes('tabata') || n.includes('f45') || n.includes('interval') || n.includes('crossfit')) return 'hiit';
  if (n.includes('yoga') || n.includes('pilates') || n.includes('meditat') || n.includes('stretch') || n.includes('breath')) return 'yoga';
  if (n.includes('gym') || n.includes('weight') || n.includes('calisthenics')
    || n.includes('strength') || n.includes('powerlift') || n.includes('functional')
    || n.includes('bodybuilding') || n.includes('elliptical') || n.includes('rowing')
    || n.includes('stair') || n.includes('kettlebell') || n.includes('core')) return 'gym';
  if (n.includes('sport') || n.includes('tennis') || n.includes('soccer') || n.includes('basketball')
    || n.includes('handball') || n.includes('volleyball') || n.includes('squash') || n.includes('racquet')
    || n.includes('fencing') || n.includes('martial') || n.includes('boxing') || n.includes('jiu')
    || n.includes('kickbox') || n.includes('rugby') || n.includes('football') || n.includes('baseball')
    || n.includes('softball') || n.includes('hockey') || n.includes('cricket') || n.includes('lacrosse')
    || n.includes('golf') || n.includes('pickleball') || n.includes('badminton') || n.includes('polo')
    || n.includes('wrestl') || n.includes('surf') || n.includes('climb') || n.includes('ski')
    || n.includes('snowboard') || n.includes('skat') || n.includes('paddl') || n.includes('kayak')) return 'sports';
  // Unrecognised but a real logged workout → default to gym (never drop).
  return 'gym';
}

/** Terra resource slug → health_snapshots.source label. */
export type SnapshotSource =
  | 'whoop' | 'fitbit' | 'strava' | 'garmin' | 'polar' | 'oura' | 'huawei'
  | 'withings' | 'peloton' | 'zepp' | 'technogym'
  | 'coros' | 'suunto' | 'wahoo' | 'zwift' | 'concept2' | 'ifit' | 'underarmour';
export function terraResourceToSource(resource: string): SnapshotSource | null {
  switch ((resource ?? '').toUpperCase()) {
    case 'WHOOP': return 'whoop';
    case 'FITBIT': return 'fitbit';
    case 'STRAVA': return 'strava';
    case 'GARMIN': return 'garmin';
    case 'POLAR': return 'polar';
    case 'OURA': return 'oura';
    case 'HUAWEI': return 'huawei';
    case 'WITHINGS': return 'withings';
    case 'PELOTON': return 'peloton';
    case 'ZEPP': return 'zepp';
    case 'TECHNOGYM': return 'technogym';
    case 'COROS': return 'coros';
    case 'SUUNTO': return 'suunto';
    case 'WAHOO': return 'wahoo';
    case 'ZWIFT': return 'zwift';
    case 'CONCEPT2': return 'concept2';
    case 'IFIT': return 'ifit';
    case 'UNDERARMOUR': return 'underarmour';
    default: return null;
  }
}
