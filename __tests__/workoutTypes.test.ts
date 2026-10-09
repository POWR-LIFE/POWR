/**
 * lib/health/workoutTypes — every key pinned to the native libraries' own enums
 * BY NAME.
 *
 * The Health Connect table used to be hand-typed integers that matched a
 * different list: ExerciseType 56 (RUNNING) was stored as "rowing" and synced
 * as gym, 70 (STRENGTH_TRAINING) as squash/sports, and yoga (83), HIIT (36),
 * weightlifting (81) and open-water swims (73) weren't in it at all, so they
 * were dropped. The expectations below are keyed on the enum MEMBER NAMES and
 * resolved through the libraries' compiled enums, so a wrong integer in the
 * table fails here instead of mistyping workouts in production.
 */

import { mapHealthType } from '@/lib/health/points';
import { HC_EXERCISE_TYPES, HK_WORKOUT_TYPES, type WorkoutTypeEntry } from '@/lib/health/workoutTypes';

// The compiled enum modules are plain JS — no native module behind them. The
// HealthKit package's exports map hides its generated enums, so that one is
// required by path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ExerciseType } = require('react-native-health-connect/lib/commonjs/constants') as {
    ExerciseType: Record<string, number>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WorkoutActivityType } = require('../node_modules/@kingstinct/react-native-healthkit/lib/commonjs/generated/healthkit.generated.js') as {
    WorkoutActivityType: Record<string, number | string>;
};

/** Health Connect, keyed by ExerciseType member name. */
const HC_EXPECTED: Record<string, WorkoutTypeEntry['type']> = {
    OTHER_WORKOUT: 'gym',
    BACK_EXTENSION: 'gym',
    BADMINTON: 'sports',
    BARBELL_SHOULDER_PRESS: 'gym',
    BASEBALL: 'sports',
    BASKETBALL: 'sports',
    BENCH_PRESS: 'gym',
    BENCH_SIT_UP: 'gym',
    BIKING: 'cycling',
    BIKING_STATIONARY: 'cycling',
    BOOT_CAMP: 'hiit',
    BOXING: 'sports',
    BURPEE: 'hiit',
    CALISTHENICS: 'gym',
    CRICKET: 'sports',
    CRUNCH: 'gym',
    DANCING: 'dance',
    DEADLIFT: 'gym',
    DUMBBELL_CURL_LEFT_ARM: 'gym',
    DUMBBELL_CURL_RIGHT_ARM: 'gym',
    DUMBBELL_FRONT_RAISE: 'gym',
    DUMBBELL_LATERAL_RAISE: 'gym',
    DUMBBELL_TRICEPS_EXTENSION_LEFT_ARM: 'gym',
    DUMBBELL_TRICEPS_EXTENSION_RIGHT_ARM: 'gym',
    DUMBBELL_TRICEPS_EXTENSION_TWO_ARM: 'gym',
    ELLIPTICAL: 'gym',
    EXERCISE_CLASS: 'gym',
    FENCING: 'sports',
    FOOTBALL_AMERICAN: 'sports',
    FOOTBALL_AUSTRALIAN: 'sports',
    FORWARD_TWIST: 'gym',
    FRISBEE_DISC: 'sports',
    GOLF: 'sports',
    GUIDED_BREATHING: 'yoga',
    GYMNASTICS: 'sports',
    HANDBALL: 'sports',
    HIGH_INTENSITY_INTERVAL_TRAINING: 'hiit',
    HIKING: 'walking',
    ICE_HOCKEY: 'sports',
    ICE_SKATING: 'sports',
    JUMPING_JACK: 'hiit',
    JUMP_ROPE: 'hiit',
    LAT_PULL_DOWN: 'gym',
    LUNGE: 'gym',
    MARTIAL_ARTS: 'sports',
    PADDLING: 'sports',
    PILATES: 'yoga',
    PLANK: 'gym',
    RACQUETBALL: 'sports',
    ROCK_CLIMBING: 'sports',
    ROLLER_HOCKEY: 'sports',
    ROWING: 'gym',
    ROWING_MACHINE: 'gym',
    RUGBY: 'sports',
    RUNNING: 'running',
    RUNNING_TREADMILL: 'running',
    SAILING: 'sports',
    SCUBA_DIVING: 'sports',
    SKATING: 'sports',
    SKIING: 'sports',
    SNOWBOARDING: 'sports',
    SNOWSHOEING: 'sports',
    SOCCER: 'sports',
    SOFTBALL: 'sports',
    SQUASH: 'sports',
    SQUAT: 'gym',
    STAIR_CLIMBING: 'gym',
    STAIR_CLIMBING_MACHINE: 'gym',
    STRENGTH_TRAINING: 'gym',
    STRETCHING: 'yoga',
    SURFING: 'sports',
    SWIMMING_OPEN_WATER: 'swimming',
    SWIMMING_POOL: 'swimming',
    TABLE_TENNIS: 'sports',
    TENNIS: 'sports',
    UPPER_TWIST: 'gym',
    VOLLEYBALL: 'sports',
    WALKING: 'walking',
    WATER_POLO: 'sports',
    WEIGHTLIFTING: 'gym',
    YOGA: 'yoga',
};
/** Deliberately unscored — terra-webhook drops the same activities. */
const HC_UNSCORED = ['PARAGLIDING', 'WHEELCHAIR'];

/** HealthKit, keyed by WorkoutActivityType member name. */
const HK_EXPECTED: Record<string, WorkoutTypeEntry['type']> = {
    americanFootball: 'sports',
    archery: 'sports',
    australianFootball: 'sports',
    badminton: 'sports',
    baseball: 'sports',
    basketball: 'sports',
    boxing: 'sports',
    climbing: 'gym',
    cricket: 'sports',
    crossTraining: 'gym',
    curling: 'sports',
    cycling: 'cycling',
    dance: 'dance',
    danceInspiredTraining: 'dance',
    elliptical: 'gym',
    equestrianSports: 'sports',
    fencing: 'sports',
    functionalStrengthTraining: 'gym',
    golf: 'sports',
    gymnastics: 'sports',
    handball: 'sports',
    hiking: 'walking',
    hockey: 'sports',
    lacrosse: 'sports',
    martialArts: 'sports',
    mindAndBody: 'yoga',
    mixedMetabolicCardioTraining: 'hiit',
    paddleSports: 'sports',
    racquetball: 'sports',
    rowing: 'gym',
    rugby: 'sports',
    running: 'running',
    sailing: 'sports',
    skatingSports: 'sports',
    snowSports: 'sports',
    soccer: 'sports',
    softball: 'sports',
    squash: 'sports',
    stairClimbing: 'gym',
    surfingSports: 'sports',
    swimming: 'swimming',
    tableTennis: 'sports',
    tennis: 'sports',
    trackAndField: 'running',
    traditionalStrengthTraining: 'gym',
    volleyball: 'sports',
    walking: 'walking',
    waterFitness: 'swimming',
    waterPolo: 'sports',
    waterSports: 'sports',
    wrestling: 'sports',
    yoga: 'yoga',
    barre: 'yoga',
    coreTraining: 'gym',
    crossCountrySkiing: 'sports',
    downhillSkiing: 'sports',
    flexibility: 'yoga',
    highIntensityIntervalTraining: 'hiit',
    jumpRope: 'hiit',
    kickboxing: 'hiit',
    pilates: 'yoga',
    snowboarding: 'sports',
    stairs: 'gym',
    stepTraining: 'gym',
    taiChi: 'yoga',
    mixedCardio: 'hiit',
    handCycling: 'cycling',
    discSports: 'sports',
    cardioDance: 'dance',
    socialDance: 'dance',
    pickleball: 'sports',
    swimBikeRun: 'running',
    underwaterDiving: 'sports',
    other: 'gym',
};
/**
 * Deliberately unscored: not exercise (fishing, hunting, play), a fragment of
 * a workout already counted (cooldown, transition), or something terra-webhook
 * also leaves out (bowling, wheelchair, fitness gaming, prep & recovery).
 */
const HK_UNSCORED = [
    'bowling', 'fishing', 'hunting', 'play', 'preparationAndRecovery',
    'wheelchairWalkPace', 'wheelchairRunPace', 'fitnessGaming', 'cooldown', 'transition',
];

describe('Health Connect exercise types', () => {
    it('maps every ExerciseType member by name, and nothing else', () => {
        for (const [member, type] of Object.entries(HC_EXPECTED)) {
            const int = ExerciseType[member];
            expect(int).toEqual(expect.any(Number));
            expect({ member, type: HC_EXERCISE_TYPES[int]?.type }).toEqual({ member, type });
        }
        for (const member of HC_UNSCORED) {
            expect(HC_EXERCISE_TYPES[ExerciseType[member]]).toBeUndefined();
        }
        // Every key in the table is an ExerciseType this test knows about.
        const known = new Set([...Object.keys(HC_EXPECTED), ...HC_UNSCORED].map(m => ExerciseType[m]));
        for (const key of Object.keys(HC_EXERCISE_TYPES)) expect(known.has(Number(key))).toBe(true);
        // ...and every ExerciseType is accounted for one way or the other.
        expect(known.size).toBe(Object.keys(ExerciseType).length);
    });

    it('fixes the integers that were wrong', () => {
        // The values the old hand-typed table got wrong, by their real names.
        expect(HC_EXERCISE_TYPES[ExerciseType.RUNNING].type).toBe('running');
        expect(HC_EXERCISE_TYPES[ExerciseType.RUNNING_TREADMILL].type).toBe('running');
        expect(HC_EXERCISE_TYPES[ExerciseType.STRENGTH_TRAINING].type).toBe('gym');
        expect(HC_EXERCISE_TYPES[ExerciseType.YOGA].type).toBe('yoga');
        expect(HC_EXERCISE_TYPES[ExerciseType.HIGH_INTENSITY_INTERVAL_TRAINING].type).toBe('hiit');
        expect(HC_EXERCISE_TYPES[ExerciseType.SWIMMING_OPEN_WATER].type).toBe('swimming');
        expect(HC_EXERCISE_TYPES[ExerciseType.SAILING].type).not.toBe('running');
        expect(HC_EXERCISE_TYPES[ExerciseType.HIKING].type).toBe('walking');
    });

    it('trusts a window distance only where distance is the workout', () => {
        const withDistance = Object.entries(HC_EXERCISE_TYPES)
            .filter(([, e]) => e.distance)
            .map(([k]) => Object.keys(ExerciseType).find(m => ExerciseType[m] === Number(k)))
            .sort();
        expect(withDistance).toEqual([
            'BIKING', 'BIKING_STATIONARY', 'HIKING', 'RUNNING', 'RUNNING_TREADMILL',
            'SWIMMING_OPEN_WATER', 'SWIMMING_POOL', 'WALKING',
        ]);
    });
});

describe('HealthKit workout types', () => {
    it('maps every WorkoutActivityType member by name, and nothing else', () => {
        for (const [member, type] of Object.entries(HK_EXPECTED)) {
            const int = WorkoutActivityType[member];
            expect(int).toEqual(expect.any(Number));
            expect({ member, type: HK_WORKOUT_TYPES[int as number]?.type }).toEqual({ member, type });
        }
        for (const member of HK_UNSCORED) {
            expect(HK_WORKOUT_TYPES[WorkoutActivityType[member] as number]).toBeUndefined();
        }
        const known = new Set([...Object.keys(HK_EXPECTED), ...HK_UNSCORED].map(m => WorkoutActivityType[m]));
        for (const key of Object.keys(HK_WORKOUT_TYPES)) expect(known.has(Number(key))).toBe(true);
        // A numeric TS enum carries reverse mappings; count the names only.
        const members = Object.keys(WorkoutActivityType).filter(k => Number.isNaN(Number(k)));
        expect(known.size).toBe(members.length);
    });
});

describe('every entry survives the sync bucketing', () => {
    it.each([
        ['Health Connect', HC_EXERCISE_TYPES],
        ['HealthKit', HK_WORKOUT_TYPES],
    ])('%s: mapHealthType keeps the type, and only walks become steps', (_store, table) => {
        for (const entry of Object.values(table)) {
            const mapped = mapHealthType(entry.type);
            if (entry.type === 'walking') expect(mapped).toBeNull();
            else expect(mapped).toBe(entry.type);
        }
    });
});
