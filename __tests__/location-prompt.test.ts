/**
 * Tests for lib/locationPrompt.ts — the pacing brain behind the primed
 * background-location ("Always") re-ask. Same shape as notification-prompt,
 * plus isWhileUsingOnly which decides whether the silent-failure state (fg
 * granted, bg not) even applies.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
    getForegroundPermissionsAsync: jest.fn(),
    getBackgroundPermissionsAsync: jest.fn(),
}));

// hasReachedLocationValueMoment leans on hasAnyCompletedSession, so the module
// now pulls in the supabase client — stub the one query shape it issues.
const mockSessionCount = jest.fn();
jest.mock('@/lib/supabase', () => ({
    supabase: {
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({
                    not: mockSessionCount,
                })),
            })),
        })),
    },
}));

import {
    DEFAULT_LOCATION_PROMPT_STATE,
    FOREGROUND_REPROMPT_INTERVAL_MS,
    LOCATION_ONBOARDING_DECLINE_COOLOFF_MS,
    LOCATION_REPROMPT_INTERVAL_MS,
    MAX_FOREGROUND_PROMPT_DISMISSALS,
    MAX_LOCATION_PROMPT_DISMISSALS,
    getLocationPromptState,
    hasReachedLocationValueMoment,
    isForegroundMissing,
    isWhileUsingOnly,
    recordAppOpenDay,
    recordForegroundPromptDismissed,
    recordForegroundPromptShown,
    recordLocationOnboardingDeclined,
    recordLocationPromptDismissed,
    recordLocationPromptShown,
    hasReturnedOnALaterDay,
    shouldShowForegroundPrompt,
    shouldShowLocationPrompt,
} from '@/lib/locationPrompt';

const getFg = Location.getForegroundPermissionsAsync as jest.Mock;
const getBg = Location.getBackgroundPermissionsAsync as jest.Mock;

const NOW = 1_800_000_000_000;

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockSessionCount.mockResolvedValue({ count: 0, error: null });
});

describe('shouldShowLocationPrompt', () => {
    it('allows a fresh user (no history)', () => {
        expect(shouldShowLocationPrompt(DEFAULT_LOCATION_PROMPT_STATE, NOW)).toBe(true);
    });

    it('stops for good after the dismissal cap', () => {
        const state = { ...DEFAULT_LOCATION_PROMPT_STATE, dismissCount: MAX_LOCATION_PROMPT_DISMISSALS };
        expect(shouldShowLocationPrompt(state, NOW)).toBe(false);
    });

    it('spaces re-asks by the re-prompt interval', () => {
        const justShown = { ...DEFAULT_LOCATION_PROMPT_STATE, lastPromptAt: NOW - 1000 };
        expect(shouldShowLocationPrompt(justShown, NOW)).toBe(false);

        const longAgo = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            lastPromptAt: NOW - LOCATION_REPROMPT_INTERVAL_MS - 1,
        };
        expect(shouldShowLocationPrompt(longAgo, NOW)).toBe(true);
    });

    it('gives breathing room after an onboarding decline, then allows', () => {
        const justDeclined = { ...DEFAULT_LOCATION_PROMPT_STATE, onboardingDeclinedAt: NOW - 1000 };
        expect(shouldShowLocationPrompt(justDeclined, NOW)).toBe(false);

        const yesterday = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            onboardingDeclinedAt: NOW - LOCATION_ONBOARDING_DECLINE_COOLOFF_MS - 1,
        };
        expect(shouldShowLocationPrompt(yesterday, NOW)).toBe(true);
    });
});

describe('shouldShowForegroundPrompt', () => {
    it('allows a fresh user (no history)', () => {
        expect(shouldShowForegroundPrompt(DEFAULT_LOCATION_PROMPT_STATE, NOW)).toBe(true);
    });

    it('stops for good at the dismissal cap, and stays stopped past it', () => {
        const atCap = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            fgDismissCount: MAX_FOREGROUND_PROMPT_DISMISSALS,
        };
        expect(shouldShowForegroundPrompt(atCap, NOW)).toBe(false);

        const overCap = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            fgDismissCount: MAX_FOREGROUND_PROMPT_DISMISSALS + 1,
        };
        expect(shouldShowForegroundPrompt(overCap, NOW)).toBe(false);
    });

    it('gives up sooner than the background re-ask (full-screen takeover)', () => {
        expect(MAX_FOREGROUND_PROMPT_DISMISSALS).toBeLessThan(MAX_LOCATION_PROMPT_DISMISSALS);
        expect(FOREGROUND_REPROMPT_INTERVAL_MS).toBeGreaterThan(LOCATION_REPROMPT_INTERVAL_MS);
    });

    it('spaces re-asks by the foreground re-prompt interval', () => {
        const justShown = { ...DEFAULT_LOCATION_PROMPT_STATE, fgLastPromptAt: NOW - 1000 };
        expect(shouldShowForegroundPrompt(justShown, NOW)).toBe(false);

        const insideEdge = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            fgLastPromptAt: NOW - FOREGROUND_REPROMPT_INTERVAL_MS + 1,
        };
        expect(shouldShowForegroundPrompt(insideEdge, NOW)).toBe(false);

        const longAgo = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            fgLastPromptAt: NOW - FOREGROUND_REPROMPT_INTERVAL_MS - 1,
        };
        expect(shouldShowForegroundPrompt(longAgo, NOW)).toBe(true);
    });

    it('gives breathing room after an onboarding decline, then allows', () => {
        const justDeclined = { ...DEFAULT_LOCATION_PROMPT_STATE, onboardingDeclinedAt: NOW - 1000 };
        expect(shouldShowForegroundPrompt(justDeclined, NOW)).toBe(false);

        const yesterday = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            onboardingDeclinedAt: NOW - LOCATION_ONBOARDING_DECLINE_COOLOFF_MS - 1,
        };
        expect(shouldShowForegroundPrompt(yesterday, NOW)).toBe(true);
    });

    it('paces independently of the background re-ask', () => {
        // A user who already exhausted the "Always" sheet can still be primed
        // for the foreground grant — they are different permissions.
        const bgExhausted = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            dismissCount: MAX_LOCATION_PROMPT_DISMISSALS,
            lastPromptAt: NOW - 1000,
        };
        expect(shouldShowForegroundPrompt(bgExhausted, NOW)).toBe(true);

        const fgExhausted = {
            ...DEFAULT_LOCATION_PROMPT_STATE,
            fgDismissCount: MAX_FOREGROUND_PROMPT_DISMISSALS,
            fgLastPromptAt: NOW - 1000,
        };
        expect(shouldShowLocationPrompt(fgExhausted, NOW)).toBe(true);
    });
});

describe('state persistence round-trips', () => {
    it('returns defaults when nothing is stored or storage is corrupt', async () => {
        expect(await getLocationPromptState()).toEqual(DEFAULT_LOCATION_PROMPT_STATE);

        await AsyncStorage.setItem('@powr/location_prompt_state', 'not-json{');
        expect(await getLocationPromptState()).toEqual(DEFAULT_LOCATION_PROMPT_STATE);
    });

    it('records an onboarding decline without touching other fields', async () => {
        await recordLocationPromptDismissed();
        await recordLocationOnboardingDeclined();

        const state = await getLocationPromptState();
        expect(state.onboardingDeclinedAt).toBeGreaterThan(0);
        expect(state.dismissCount).toBe(1);
    });

    it('counts dismissals and stamps shown-at', async () => {
        await recordLocationPromptShown();
        await recordLocationPromptDismissed();
        await recordLocationPromptDismissed();

        const state = await getLocationPromptState();
        expect(state.dismissCount).toBe(2);
        expect(state.lastPromptAt).toBeGreaterThan(0);
    });

    it('keeps foreground counters separate from the background ones', async () => {
        await recordForegroundPromptShown();
        await recordForegroundPromptDismissed();

        const state = await getLocationPromptState();
        expect(state.fgDismissCount).toBe(1);
        expect(state.fgLastPromptAt).toBeGreaterThan(0);
        expect(state.dismissCount).toBe(0);
        expect(state.lastPromptAt).toBeNull();
    });

    it('backfills the new fields onto an old persisted blob', async () => {
        // Blobs written before the foreground re-ask existed must still load.
        await AsyncStorage.setItem(
            '@powr/location_prompt_state',
            JSON.stringify({ lastPromptAt: 123, dismissCount: 1, onboardingDeclinedAt: null }),
        );

        const state = await getLocationPromptState();
        expect(state).toEqual({
            ...DEFAULT_LOCATION_PROMPT_STATE,
            lastPromptAt: 123,
            dismissCount: 1,
        });
    });
});

describe('isForegroundMissing', () => {
    it('is true when foreground has never been granted', async () => {
        getFg.mockResolvedValue({ status: 'undetermined' });
        expect(await isForegroundMissing()).toBe(true);

        getFg.mockResolvedValue({ status: 'denied' });
        expect(await isForegroundMissing()).toBe(true);
    });

    it('is false once foreground is granted', async () => {
        getFg.mockResolvedValue({ status: 'granted' });
        expect(await isForegroundMissing()).toBe(false);
    });

    it('is null on a native error (never surfaces the screen on a transient fault)', async () => {
        getFg.mockRejectedValue(new Error('native boom'));
        expect(await isForegroundMissing()).toBeNull();
    });
});

describe('hasReturnedOnALaterDay', () => {
    const DAY_ONE = new Date(2026, 6, 16, 9, 0, 0).getTime();
    const DAY_ONE_LATE = new Date(2026, 6, 16, 23, 30, 0).getTime();
    const DAY_TWO = new Date(2026, 6, 17, 1, 0, 0).getTime();

    it('is false on a first-ever open', async () => {
        await recordAppOpenDay(DAY_ONE);
        expect(await hasReturnedOnALaterDay()).toBe(false);
    });

    it('is false for a second open on the same local day, and writes nothing', async () => {
        await recordAppOpenDay(DAY_ONE);
        // Every evaluate() calls this, so the same-day path has to stay a read.
        const setItem = AsyncStorage.setItem as unknown as jest.Mock;
        setItem.mockClear();
        await recordAppOpenDay(DAY_ONE_LATE);

        expect(setItem).not.toHaveBeenCalled();
        expect(await hasReturnedOnALaterDay()).toBe(false);
    });

    it('is true once they come back on a later local day', async () => {
        // 23:30 then 01:00 is one sitting by the clock but two days to the
        // user — local keys, not UTC, is the whole point.
        await recordAppOpenDay(DAY_ONE_LATE);
        await recordAppOpenDay(DAY_TWO);

        const state = await getLocationPromptState();
        expect(state.firstSeenDay).toBe('2026-07-16');
        expect(state.lastSeenDay).toBe('2026-07-17');
        expect(await hasReturnedOnALaterDay()).toBe(true);
    });

    it('is false with no history at all (fails closed)', async () => {
        expect(await hasReturnedOnALaterDay()).toBe(false);

        await AsyncStorage.setItem('@powr/location_prompt_state', 'not-json{');
        expect(await hasReturnedOnALaterDay()).toBe(false);
    });
});

describe('hasReachedLocationValueMoment', () => {
    // Relative to the real clock: the function stamps today itself, so the
    // seeded first-seen day has to be genuinely in the past.
    const THREE_DAYS_AGO = Date.now() - 3 * 24 * 60 * 60 * 1000;

    it('is true on a banked session even with no return history', async () => {
        mockSessionCount.mockResolvedValue({ count: 1, error: null });
        expect(await hasReachedLocationValueMoment('user-1')).toBe(true);
    });

    it('is true on a return with no session — the catch-22 case', async () => {
        // No background permission → passive check-ins never land → no session
        // row ever appears. Opening POWR again is the only engagement we can see.
        await recordAppOpenDay(THREE_DAYS_AGO);
        expect(await hasReachedLocationValueMoment('user-1')).toBe(true);
    });

    it('is false for a first-open user with nothing banked', async () => {
        expect(await hasReachedLocationValueMoment('user-1')).toBe(false);
    });

    it('stamps the day itself, so history accrues from the first call', async () => {
        mockSessionCount.mockResolvedValue({ count: 1, error: null });
        await hasReachedLocationValueMoment('user-1');
        expect((await getLocationPromptState()).firstSeenDay).not.toBeNull();
    });

    it('fails closed when the session query errors', async () => {
        mockSessionCount.mockResolvedValue({ count: null, error: { message: 'boom' } });
        expect(await hasReachedLocationValueMoment('user-1')).toBe(false);
    });
});

describe('isWhileUsingOnly', () => {
    it('is true when foreground is granted but background is not', async () => {
        getFg.mockResolvedValue({ status: 'granted' });
        getBg.mockResolvedValue({ status: 'denied' });
        expect(await isWhileUsingOnly()).toBe(true);
    });

    it('is false when background is already granted (Always)', async () => {
        getFg.mockResolvedValue({ status: 'granted' });
        getBg.mockResolvedValue({ status: 'granted' });
        expect(await isWhileUsingOnly()).toBe(false);
    });

    it('is null (not our case) when foreground is not granted', async () => {
        getFg.mockResolvedValue({ status: 'denied' });
        expect(await isWhileUsingOnly()).toBeNull();

        getFg.mockResolvedValue({ status: 'undetermined' });
        expect(await isWhileUsingOnly()).toBeNull();
    });

    it('is null on a native error (never surfaces the sheet on a transient fault)', async () => {
        getFg.mockRejectedValue(new Error('native boom'));
        expect(await isWhileUsingOnly()).toBeNull();

        getFg.mockResolvedValue({ status: 'granted' });
        getBg.mockRejectedValue(new Error('native boom'));
        expect(await isWhileUsingOnly()).toBeNull();
    });
});
