/**
 * What each phone health store calls a workout, and what POWR buckets it as.
 *
 * Both stores tag a workout with a bare integer: HealthKit's
 * HKWorkoutActivityType and Health Connect's ExerciseType. These tables turn
 * that integer into the POWR type (`type`, fed through mapHealthType() by the
 * sync, so 'walking' means "paid as steps, never as a session") and a display
 * name (`name`, stored as activity_sessions.raw_activity_name).
 *
 * The integers are the libraries' own — @kingstinct/react-native-healthkit's
 * WorkoutActivityType and react-native-health-connect's ExerciseType — and
 * __tests__/workoutTypes.test.ts pins every key to those enums by name. The
 * Health Connect table was once hand-typed from the wrong list and was wrong
 * for most entries (runs landed as gym, yoga and HIIT were dropped); the test
 * is what stops that happening again. Types follow terra-webhook's
 * TERRA_TYPE_TO_POWR wherever both cover an activity, so the same workout
 * earns the same way whichever route it arrives by.
 *
 * Kept free of native imports so both stores' tables load anywhere.
 */

export type WorkoutTypeEntry = {
    /** POWR bucket, fed through mapHealthType(). */
    type: 'running' | 'cycling' | 'swimming' | 'gym' | 'hiit' | 'yoga' | 'sports' | 'dance' | 'walking';
    /** Human-readable name, kept as the session's raw_activity_name. */
    name: string;
    /**
     * Health Connect only: a distance aggregate over this session's window is
     * the workout's own distance. Off for gym/yoga-style sessions, where the
     * same aggregate would pick up incidental walking around them.
     */
    distance?: boolean;
};

/** HKWorkoutActivityType → POWR. Unlisted types are not scored. */
export const HK_WORKOUT_TYPES: Readonly<Record<number, WorkoutTypeEntry>> = {
    1:    { type: 'sports',   name: 'American Football' },
    2:    { type: 'sports',   name: 'Archery' },
    3:    { type: 'sports',   name: 'Australian Football' },
    4:    { type: 'sports',   name: 'Badminton' },
    5:    { type: 'sports',   name: 'Baseball' },
    6:    { type: 'sports',   name: 'Basketball' },
    8:    { type: 'sports',   name: 'Boxing' },
    9:    { type: 'gym',      name: 'Climbing' },
    10:   { type: 'sports',   name: 'Cricket' },
    11:   { type: 'gym',      name: 'Cross Training' },
    12:   { type: 'sports',   name: 'Curling' },
    13:   { type: 'cycling',  name: 'Cycling' },
    14:   { type: 'dance',    name: 'Dance' },
    15:   { type: 'dance',    name: 'Dance Training' },
    16:   { type: 'gym',      name: 'Elliptical' },
    17:   { type: 'sports',   name: 'Equestrian Sports' },
    18:   { type: 'sports',   name: 'Fencing' },
    20:   { type: 'gym',      name: 'Functional Strength Training' },
    21:   { type: 'sports',   name: 'Golf' },
    22:   { type: 'sports',   name: 'Gymnastics' },
    23:   { type: 'sports',   name: 'Handball' },
    24:   { type: 'walking',  name: 'Hiking' },
    25:   { type: 'sports',   name: 'Hockey' },
    27:   { type: 'sports',   name: 'Lacrosse' },
    28:   { type: 'sports',   name: 'Martial Arts' },
    29:   { type: 'yoga',     name: 'Mind & Body' },
    30:   { type: 'hiit',     name: 'Mixed Metabolic Cardio' },
    31:   { type: 'sports',   name: 'Paddle Sports' },
    34:   { type: 'sports',   name: 'Racquetball' },
    35:   { type: 'gym',      name: 'Rowing' },
    36:   { type: 'sports',   name: 'Rugby' },
    37:   { type: 'running',  name: 'Running' },
    38:   { type: 'sports',   name: 'Sailing' },
    39:   { type: 'sports',   name: 'Skating' },
    40:   { type: 'sports',   name: 'Snow Sports' },
    41:   { type: 'sports',   name: 'Soccer' },
    42:   { type: 'sports',   name: 'Softball' },
    43:   { type: 'sports',   name: 'Squash' },
    44:   { type: 'gym',      name: 'Stair Climbing' },
    45:   { type: 'sports',   name: 'Surfing' },
    46:   { type: 'swimming', name: 'Swimming' },
    47:   { type: 'sports',   name: 'Table Tennis' },
    48:   { type: 'sports',   name: 'Tennis' },
    49:   { type: 'running',  name: 'Track & Field' },
    50:   { type: 'gym',      name: 'Strength Training' },
    51:   { type: 'sports',   name: 'Volleyball' },
    52:   { type: 'walking',  name: 'Walking' },
    53:   { type: 'swimming', name: 'Water Fitness' },
    54:   { type: 'sports',   name: 'Water Polo' },
    55:   { type: 'sports',   name: 'Water Sports' },
    56:   { type: 'sports',   name: 'Wrestling' },
    57:   { type: 'yoga',     name: 'Yoga' },
    58:   { type: 'yoga',     name: 'Barre' },
    59:   { type: 'gym',      name: 'Core Training' },
    60:   { type: 'sports',   name: 'Cross Country Skiing' },
    61:   { type: 'sports',   name: 'Downhill Skiing' },
    62:   { type: 'yoga',     name: 'Flexibility' },
    63:   { type: 'hiit',     name: 'HIIT' },
    64:   { type: 'hiit',     name: 'Jump Rope' },
    65:   { type: 'hiit',     name: 'Kickboxing' },
    66:   { type: 'yoga',     name: 'Pilates' },
    67:   { type: 'sports',   name: 'Snowboarding' },
    68:   { type: 'gym',      name: 'Stairs' },
    69:   { type: 'gym',      name: 'Step Training' },
    72:   { type: 'yoga',     name: 'Tai Chi' },
    73:   { type: 'hiit',     name: 'Mixed Cardio' },
    74:   { type: 'cycling',  name: 'Hand Cycling' },
    75:   { type: 'sports',   name: 'Disc Sports' },
    77:   { type: 'dance',    name: 'Cardio Dance' },
    78:   { type: 'dance',    name: 'Social Dance' },
    79:   { type: 'sports',   name: 'Pickleball' },
    82:   { type: 'running',  name: 'Triathlon' },
    84:   { type: 'sports',   name: 'Underwater Diving' },
    // Apple Watch's catch-all "Other" workout. terra-webhook logs the same
    // unnamed workout as gym rather than dropping it (a workout we can't name
    // is still a workout the user did); this is the HealthKit route to match.
    3000: { type: 'gym',      name: 'Workout' },
};

/** Health Connect ExerciseType → POWR. Unlisted types are not scored. */
export const HC_EXERCISE_TYPES: Readonly<Record<number, WorkoutTypeEntry>> = {
    // Generic and class-style sessions, logged as gym like Terra's "Other".
    0:  { type: 'gym',      name: 'Workout' },
    26: { type: 'gym',      name: 'Exercise Class' },

    // Single-movement types an early Health Connect allowed as a whole
    // session (now segment types). Still strength work when an app writes one.
    1:  { type: 'gym',      name: 'Back Extension' },
    3:  { type: 'gym',      name: 'Shoulder Press' },
    6:  { type: 'gym',      name: 'Bench Press' },
    7:  { type: 'gym',      name: 'Sit-ups' },
    12: { type: 'hiit',     name: 'Burpees' },
    15: { type: 'gym',      name: 'Crunches' },
    17: { type: 'gym',      name: 'Deadlift' },
    18: { type: 'gym',      name: 'Dumbbell Curls' },
    19: { type: 'gym',      name: 'Dumbbell Curls' },
    20: { type: 'gym',      name: 'Dumbbell Raises' },
    21: { type: 'gym',      name: 'Dumbbell Raises' },
    22: { type: 'gym',      name: 'Triceps Extensions' },
    23: { type: 'gym',      name: 'Triceps Extensions' },
    24: { type: 'gym',      name: 'Triceps Extensions' },
    30: { type: 'gym',      name: 'Core Training' },
    40: { type: 'hiit',     name: 'Jumping Jacks' },
    42: { type: 'gym',      name: 'Lat Pulldowns' },
    43: { type: 'gym',      name: 'Lunges' },
    49: { type: 'gym',      name: 'Core Training' },
    67: { type: 'gym',      name: 'Squats' },
    77: { type: 'gym',      name: 'Core Training' },

    2:  { type: 'sports',   name: 'Badminton' },
    4:  { type: 'sports',   name: 'Baseball' },
    5:  { type: 'sports',   name: 'Basketball' },
    8:  { type: 'cycling',  name: 'Cycling', distance: true },
    9:  { type: 'cycling',  name: 'Stationary Cycling', distance: true },
    10: { type: 'hiit',     name: 'Boot Camp' },
    11: { type: 'sports',   name: 'Boxing' },
    13: { type: 'gym',      name: 'Calisthenics' },
    14: { type: 'sports',   name: 'Cricket' },
    16: { type: 'dance',    name: 'Dancing' },
    25: { type: 'gym',      name: 'Elliptical' },
    27: { type: 'sports',   name: 'Fencing' },
    28: { type: 'sports',   name: 'American Football' },
    29: { type: 'sports',   name: 'Australian Football' },
    31: { type: 'sports',   name: 'Frisbee' },
    32: { type: 'sports',   name: 'Golf' },
    33: { type: 'yoga',     name: 'Guided Breathing' },
    34: { type: 'sports',   name: 'Gymnastics' },
    35: { type: 'sports',   name: 'Handball' },
    36: { type: 'hiit',     name: 'HIIT' },
    37: { type: 'walking',  name: 'Hiking', distance: true },
    38: { type: 'sports',   name: 'Ice Hockey' },
    39: { type: 'sports',   name: 'Ice Skating' },
    41: { type: 'hiit',     name: 'Jump Rope' },
    44: { type: 'sports',   name: 'Martial Arts' },
    46: { type: 'sports',   name: 'Paddling' },
    48: { type: 'yoga',     name: 'Pilates' },
    50: { type: 'sports',   name: 'Racquetball' },
    51: { type: 'sports',   name: 'Rock Climbing' },
    52: { type: 'sports',   name: 'Roller Hockey' },
    53: { type: 'gym',      name: 'Rowing' },
    54: { type: 'gym',      name: 'Rowing Machine' },
    55: { type: 'sports',   name: 'Rugby' },
    56: { type: 'running',  name: 'Running', distance: true },
    57: { type: 'running',  name: 'Treadmill Running', distance: true },
    58: { type: 'sports',   name: 'Sailing' },
    59: { type: 'sports',   name: 'Scuba Diving' },
    60: { type: 'sports',   name: 'Skating' },
    61: { type: 'sports',   name: 'Skiing' },
    62: { type: 'sports',   name: 'Snowboarding' },
    63: { type: 'sports',   name: 'Snowshoeing' },
    64: { type: 'sports',   name: 'Soccer' },
    65: { type: 'sports',   name: 'Softball' },
    66: { type: 'sports',   name: 'Squash' },
    68: { type: 'gym',      name: 'Stair Climbing' },
    69: { type: 'gym',      name: 'Stair Climbing Machine' },
    70: { type: 'gym',      name: 'Strength Training' },
    71: { type: 'yoga',     name: 'Stretching' },
    72: { type: 'sports',   name: 'Surfing' },
    73: { type: 'swimming', name: 'Open Water Swimming', distance: true },
    74: { type: 'swimming', name: 'Pool Swimming', distance: true },
    75: { type: 'sports',   name: 'Table Tennis' },
    76: { type: 'sports',   name: 'Tennis' },
    78: { type: 'sports',   name: 'Volleyball' },
    79: { type: 'walking',  name: 'Walking', distance: true },
    80: { type: 'sports',   name: 'Water Polo' },
    81: { type: 'gym',      name: 'Weightlifting' },
    83: { type: 'yoga',     name: 'Yoga' },
};
