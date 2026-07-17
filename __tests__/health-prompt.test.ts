/**
 * Tests for lib/healthPrompt.ts — the pacing + trigger brain behind the primed
 * health re-ask. The trigger question is "is health data flowing?", and the
 * decision matrix is what stands between catching a dead Health Connect grant
 * (steps silently stopped counting) and nagging users whose data is fine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/lib/supabase', () => ({
    supabase: { from: jest.fn() },
    getSessionUser: jest.fn(),
}));

import {
    DEFAULT_HEALTH_PROMPT_STATE,
    HEALTH_ONBOARDING_DECLINE_COOLOFF_MS,
    HEALTH_REPROMPT_INTERVAL_MS,
    MAX_HEALTH_PROMPT_DISMISSALS,
    detectHealthPromptMode,
    getHealthPromptState,
    recordHealthOnboardingDeclined,
    recordHealthPromptDismissed,
    recordHealthPromptShown,
    shouldShowHealthPrompt,
    type HealthFlowSignals,
} from '@/lib/healthPrompt';

const NOW = 1_800_000_000_000;

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
});

describe('shouldShowHealthPrompt', () => {
    it('allows a fresh user (no history)', () => {
        expect(shouldShowHealthPrompt(DEFAULT_HEALTH_PROMPT_STATE, NOW)).toBe(true);
    });

    it('stops for good after the dismissal cap', () => {
        const state = { ...DEFAULT_HEALTH_PROMPT_STATE, dismissCount: MAX_HEALTH_PROMPT_DISMISSALS };
        expect(shouldShowHealthPrompt(state, NOW)).toBe(false);
    });

    it('spaces re-asks by the re-prompt interval', () => {
        const justShown = { ...DEFAULT_HEALTH_PROMPT_STATE, lastPromptAt: NOW - 1000 };
        expect(shouldShowHealthPrompt(justShown, NOW)).toBe(false);

        const longAgo = { ...DEFAULT_HEALTH_PROMPT_STATE, lastPromptAt: NOW - HEALTH_REPROMPT_INTERVAL_MS - 1 };
        expect(shouldShowHealthPrompt(longAgo, NOW)).toBe(true);
    });

    it('gives breathing room after an onboarding skip, then allows', () => {
        const justSkipped = { ...DEFAULT_HEALTH_PROMPT_STATE, onboardingDeclinedAt: NOW - 1000 };
        expect(shouldShowHealthPrompt(justSkipped, NOW)).toBe(false);

        const yesterday = {
            ...DEFAULT_HEALTH_PROMPT_STATE,
            onboardingDeclinedAt: NOW - HEALTH_ONBOARDING_DECLINE_COOLOFF_MS - 1,
        };
        expect(shouldShowHealthPrompt(yesterday, NOW)).toBe(true);
    });
});

describe('detectHealthPromptMode', () => {
    const base: HealthFlowSignals = {
        platform: 'android',
        isAuthorized: false,
        stepsToday: 0,
        hasRecentWalkingSession: false,
        everConnectedNative: false,
    };

    it('never fires on web', () => {
        expect(detectHealthPromptMode({ ...base, platform: 'web' })).toBeNull();
    });

    it('stays away while steps are readable on-device', () => {
        expect(detectHealthPromptMode({ ...base, stepsToday: 4200 })).toBeNull();
    });

    it('stays away while the grant is alive, even at 0 steps (early morning)', () => {
        expect(detectHealthPromptMode({ ...base, isAuthorized: true })).toBeNull();
    });

    it('stays away when steps arrive without the grant (Terra wearable top-up)', () => {
        expect(detectHealthPromptMode({ ...base, hasRecentWalkingSession: true })).toBeNull();
    });

    it('pitches connect to the never-connected', () => {
        expect(detectHealthPromptMode(base)).toBe('connect');
    });

    it("pitches reconnect when our records say connected but the OS grant is dead — the 2026-07-16 incident", () => {
        expect(detectHealthPromptMode({ ...base, everConnectedNative: true })).toBe('reconnect');
    });
});

describe('state persistence round-trips', () => {
    it('returns defaults when nothing is stored or storage is corrupt', async () => {
        expect(await getHealthPromptState()).toEqual(DEFAULT_HEALTH_PROMPT_STATE);

        await AsyncStorage.setItem('@powr/health_prompt_state', 'not-json{');
        expect(await getHealthPromptState()).toEqual(DEFAULT_HEALTH_PROMPT_STATE);
    });

    it('records an onboarding skip without touching other fields', async () => {
        await recordHealthPromptDismissed();
        await recordHealthOnboardingDeclined();

        const state = await getHealthPromptState();
        expect(state.onboardingDeclinedAt).toBeGreaterThan(0);
        expect(state.dismissCount).toBe(1);
    });

    it('counts dismissals and stamps shown-at', async () => {
        await recordHealthPromptShown();
        await recordHealthPromptDismissed();
        await recordHealthPromptDismissed();

        const state = await getHealthPromptState();
        expect(state.lastPromptAt).toBeGreaterThan(0);
        expect(state.dismissCount).toBe(2);
    });
});
