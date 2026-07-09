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

import {
    DEFAULT_LOCATION_PROMPT_STATE,
    LOCATION_ONBOARDING_DECLINE_COOLOFF_MS,
    LOCATION_REPROMPT_INTERVAL_MS,
    MAX_LOCATION_PROMPT_DISMISSALS,
    getLocationPromptState,
    isWhileUsingOnly,
    recordLocationOnboardingDeclined,
    recordLocationPromptDismissed,
    recordLocationPromptShown,
    shouldShowLocationPrompt,
} from '@/lib/locationPrompt';

const getFg = Location.getForegroundPermissionsAsync as jest.Mock;
const getBg = Location.getBackgroundPermissionsAsync as jest.Mock;

const NOW = 1_800_000_000_000;

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
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
