/**
 * Garmin payloads → the normalised records the shared wearable engine credits
 * (supabase/functions/_shared/garminMap.ts). Field names and example values
 * follow Garmin's Health API 1.2.4 and Activity API 1.2.5 specs.
 */
import {
    garminActivitySkipReason,
    garminActivityToPOWR,
    garminActivityToRecord,
    garminDailyToRecord,
    garminDeviceName,
    garminHrvToRecord,
    garminSleepSkipReason,
    garminSleepToRecord,
    groupByUser,
} from '@/supabase/functions/_shared/garminMap';
import { activityExtras } from '@/supabase/functions/_shared/terraExtras';
import { resolveSleepSeconds } from '@/supabase/functions/_shared/sleepDuration';

describe('garminActivityToPOWR', () => {
    it.each([
        ['RUNNING', 'running'], ['TRAIL_RUNNING', 'running'], ['TREADMILL_RUNNING', 'running'],
        ['ROAD_BIKING', 'cycling'], ['INDOOR_CYCLING', 'cycling'], ['VIRTUAL_RIDE', 'cycling'],
        ['LAP_SWIMMING', 'swimming'], ['OPEN_WATER_SWIMMING', 'swimming'],
        ['STRENGTH_TRAINING', 'gym'], ['INDOOR_ROWING', 'gym'], ['STAIR_CLIMBING', 'gym'], ['BOULDERING', 'gym'],
        ['HIIT', 'hiit'], ['INDOOR_CARDIO', 'hiit'], ['JUMP_ROPE', 'hiit'],
        ['YOGA', 'yoga'], ['PILATES', 'yoga'], ['MOBILITY', 'yoga'], ['BREATHWORK', 'yoga'],
        ['DANCE', 'dance'],
        ['SOCCER', 'sports'], ['TENNIS_V2', 'sports'], ['PADDELBALL', 'sports'], ['RESORT_SKIING', 'sports'],
        ['KAYAKING_V2', 'sports'], ['ROCK_CLIMBING', 'sports'],
        ['OTHER', 'gym'], ['STOP_WATCH', 'gym'],
    ])('%s → %s', (garmin, powr) => {
        expect(garminActivityToPOWR(garmin)).toBe(powr);
    });

    it.each(['WALKING', 'CASUAL_WALKING', 'HIKING', 'RUCKING', 'BOATING_V2', 'FISHING', 'SNOWMOBILING_WS',
        'TRANSITION_V2', 'BIKE_TO_RUN_TRANSITION'])('%s is not a workout (steps or nothing)', (garmin) => {
        expect(garminActivityToPOWR(garmin)).toBeNull();
    });

    it('falls back to name heuristics for a type added after the table, ending in gym', () => {
        expect(garminActivityToPOWR('SOME_NEW_RUNNING_MODE')).toBe('running');
        expect(garminActivityToPOWR('SOMETHING_UNHEARD_OF')).toBe('gym');
    });
});

const RUN = {
    userId: 'u1', summaryId: '5001968355', activityId: 5001968355,
    activityType: 'RUNNING', activityName: 'Hyde Park Running',
    startTimeInSeconds: 1452470400, startTimeOffsetInSeconds: 0, durationInSeconds: 1789,
    averageHeartRateInBeatsPerMinute: 144, maxHeartRateInBeatsPerMinute: 159,
    averageSpeedInMetersPerSecond: 2.781, distanceInMeters: 4976.83, activeKilocalories: 367,
    deviceName: 'Forerunner 265', steps: 5022, totalElevationGainInMeters: 16.0, totalElevationLossInMeters: 22.0,
};

describe('activities', () => {
    it('maps a run into the engine shape', () => {
        const r = garminActivityToRecord(RUN);
        expect(r.metadata).toEqual({
            start_time: '2016-01-11T00:00:00.000Z',
            end_time: '2016-01-11T00:29:49.000Z',
            name: 'Hyde Park Running',
            powr_type: 'running',
        });
        expect(r.distance_data.summary.distance_meters).toBe(4976.83);
        expect(r.heart_rate_data.summary).toEqual({ avg_hr_bpm: 144, max_hr_bpm: 159 });
        expect(r.calories_data.total_burned_calories).toBe(367);
        expect(r.device_data).toEqual({ name: 'Forerunner 265' });
    });

    it('carries steps and elevation into the snapshot extras, never fabricated zeros', () => {
        expect(activityExtras(garminActivityToRecord(RUN))).toEqual({
            steps: 5022, elevation_gain_m: 16, elevation_loss_m: 22,
        });
        // A strength session has no distance, elevation or lengths: nothing invented.
        const lift = garminActivityToRecord({
            activityType: 'STRENGTH_TRAINING', startTimeInSeconds: 1, durationInSeconds: 2400,
            distanceInMeters: null, totalElevationGainInMeters: null,
        });
        expect(activityExtras(lift)).toBeNull();
        expect(lift.distance_data.summary.distance_meters).toBeUndefined();
    });

    it('carries pool lengths as the swim count', () => {
        const swim = garminActivityToRecord({
            activityType: 'LAP_SWIMMING', startTimeInSeconds: 1, durationInSeconds: 1800, numberOfActiveLengths: 40,
        });
        expect(activityExtras(swim)).toEqual({ swim_laps: 40 });
    });

    it('names an unnamed activity after its type', () => {
        const r = garminActivityToRecord({ activityType: 'INDOOR_ROWING', startTimeInSeconds: 1, durationInSeconds: 600 });
        expect(r.metadata.name).toBe('indoor rowing');
    });

    it('ignores the "unknown" device name of manually created activities', () => {
        expect(garminActivityToRecord({ ...RUN, deviceName: 'unknown' }).device_data).toBeUndefined();
        expect(garminDeviceName([{ deviceName: 'unknown' }, { deviceName: 'fenix 8' }])).toBe('fenix 8');
        expect(garminDeviceName([{}])).toBeNull();
    });

    it.each([
        [{ ...RUN, manual: true }, 'manual'],
        [{ ...RUN, isWebUpload: true }, 'web_upload'],
        [{ ...RUN, isParent: true, activityType: 'MULTI_SPORT' }, 'multisport_parent'],
        [{ ...RUN, startTimeInSeconds: undefined }, 'no_start'],
        [{ ...RUN, durationInSeconds: 0 }, 'no_duration'],
        [null, 'malformed'],
    ])('does not credit %# (%s)', (a, reason) => {
        expect(garminActivitySkipReason(a)).toBe(reason);
    });

    it('credits a device-recorded activity, including a multisport leg', () => {
        expect(garminActivitySkipReason(RUN)).toBeNull();
        expect(garminActivitySkipReason({ ...RUN, manual: false, parentSummaryId: '99' })).toBeNull();
    });
});

describe('dailies', () => {
    it('files steps and resting HR at the user\'s local midnight', () => {
        // 2016-01-11 00:00 local at UTC+1 is 2016-01-10T23:00Z.
        const r = garminDailyToRecord({
            calendarDate: '2016-01-11', startTimeInSeconds: 1452466800, startTimeOffsetInSeconds: 3600,
            durationInSeconds: 86400, steps: 4210, restingHeartRateInBeatsPerMinute: 64,
        })!;
        expect(r.metadata.start_time).toBe('2016-01-10T23:00:00.000Z');
        expect(r.metadata.end_time).toBe('2016-01-11T23:00:00.000Z');
        expect(r.distance_data.steps).toBe(4210);
        expect(r.heart_rate_data.summary.resting_hr_bpm).toBe(64);
    });

    it('a mid-day sync carries the partial duration', () => {
        const r = garminDailyToRecord({ startTimeInSeconds: 0, durationInSeconds: 3600, steps: 10 })!;
        expect(r.metadata.end_time).toBe('1970-01-01T01:00:00.000Z');
    });

    it('drops a record with no start', () => {
        expect(garminDailyToRecord({ steps: 10 })).toBeNull();
    });
});

// Garmin's Health API sleep example, second record.
const NIGHT = {
    summaryId: 'EXAMPLE_567891', calendarDate: '2016-01-11',
    durationInSeconds: 11900, startTimeInSeconds: 1452467493, startTimeOffsetInSeconds: 7200,
    unmeasurableSleepDurationInSeconds: 0, deepSleepDurationInSeconds: 9446, lightSleepDurationInSeconds: 0,
    remSleepInSeconds: 2142, awakeDurationInSeconds: 312,
    sleepLevelsMap: {
        deep: [{ startTimeInSeconds: 1452467493, endTimeInSeconds: 1452476939 }],
        light: [{ startTimeInSeconds: 1452478725, endTimeInSeconds: 1452479725 },
            { startTimeInSeconds: 1452481725, endTimeInSeconds: 1452484266 }],
        rem: [{ startTimeInSeconds: 1452476940, endTimeInSeconds: 1452479082 }],
    },
    validation: 'ENHANCED_FINAL',
    timeOffsetSleepRespiration: { 60: 15.31, 120: 14.58, 180: 12.73, 240: 12.87 },
    timeOffsetSleepSpo2: { 0: 95, 60: 96, 120: 97, 180: 93, 240: 94, 300: 95, 360: 96 },
};

describe('sleeps', () => {
    it('counts time ASLEEP (the stages), not Garmin\'s duration, which includes awake time', () => {
        const r = garminSleepToRecord(NIGHT);
        // deep 9446 + rem 2142 = 11588; durationInSeconds 11900 = that + 312 awake.
        expect(resolveSleepSeconds(r.sleep_durations_data, r.metadata.start_time, r.metadata.end_time)).toBe(11588);
        expect(r.sleep_durations_data.asleep.duration_light_sleep_state_seconds).toBeUndefined(); // 0 isn't a reading
    });

    it('ends the window where the last sleep level ends', () => {
        expect(garminSleepToRecord(NIGHT).metadata).toEqual({
            start_time: new Date(1452467493 * 1000).toISOString(),
            end_time: new Date(1452484266 * 1000).toISOString(),
        });
    });

    it('without levels, ends at start + duration + unmeasured time', () => {
        const r = garminSleepToRecord({
            startTimeInSeconds: 0, durationInSeconds: 28000, unmeasurableSleepInSeconds: 800,
            deepSleepDurationInSeconds: 5000, lightSleepDurationInSeconds: 15000, remSleepInSeconds: 6000,
        });
        expect(r.metadata.end_time).toBe(new Date(28800 * 1000).toISOString());
        expect(r.sleep_durations_data.other.duration_in_bed_seconds).toBe(28800);
    });

    it('averages the night\'s breathing rate and SpO2', () => {
        const r = garminSleepToRecord(NIGHT);
        expect(r.respiration_data.breaths_data.avg_breaths_per_min).toBe(13.9);
        expect(r.respiration_data.oxygen_saturation_data.avg_saturation_percentage).toBe(95.1);
        const bare = garminSleepToRecord({ ...NIGHT, timeOffsetSleepRespiration: {}, timeOffsetSleepSpo2: undefined });
        expect(bare.respiration_data.breaths_data.avg_breaths_per_min).toBeUndefined();
    });

    it.each([['MANUAL', 'manual'], ['OFF_WRIST', 'off_wrist']])('does not credit a %s night', (validation, reason) => {
        expect(garminSleepSkipReason({ ...NIGHT, validation })).toBe(reason);
    });

    it.each(['AUTO_TENTATIVE', 'AUTO_FINAL', 'AUTO_MANUAL', 'DEVICE', 'ENHANCED_TENTATIVE', 'ENHANCED_FINAL'])(
        'credits a %s night', (validation) => {
            expect(garminSleepSkipReason({ ...NIGHT, validation })).toBeNull();
        });
});

describe('hrv', () => {
    it('files last night\'s average on the wake-up day, at its local midnight', () => {
        const r = garminHrvToRecord({
            summaryId: 'x473db21-6295abc4', calendarDate: '2022-05-31', lastNightAvg: 44, lastNight5MinHigh: 72,
            startTimeOffsetInSeconds: -18000, durationInSeconds: 3820, startTimeInSeconds: 1653976004,
        })!;
        // Local midnight at UTC-5 is 05:00Z.
        expect(r.metadata.start_time).toBe('2022-05-31T05:00:00.000Z');
        expect(r.heart_rate_data.summary.avg_hrv_rmssd).toBe(44);
    });

    it('drops a summary without an average or a date', () => {
        expect(garminHrvToRecord({ calendarDate: '2022-05-31' })).toBeNull();
        expect(garminHrvToRecord({ lastNightAvg: 40 })).toBeNull();
    });
});

describe('groupByUser', () => {
    it('groups a push by Garmin user and drops records without one', () => {
        const g = groupByUser([{ userId: 'a', n: 1 }, { userId: 'b', n: 2 }, { userId: 'a', n: 3 }, { n: 4 }] as any);
        expect([...g.keys()]).toEqual(['a', 'b']);
        expect(g.get('a')!.map((r: any) => r.n)).toEqual([1, 3]);
    });
});
