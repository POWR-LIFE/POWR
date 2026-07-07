/**
 * Tests for lib/notificationPrompt.ts — the pacing brain behind the primed
 * notification re-ask. The OS dialog is one-shot on iOS, so these rules are
 * what stand between "maximum acceptance" and "burned the only prompt".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const mockNotResult = jest.fn();
jest.mock('@/lib/supabase', () => ({
    supabase: {
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({
                    not: mockNotResult,
                })),
            })),
        })),
    },
}));

import {
    DEFAULT_PROMPT_STATE,
    MAX_PROMPT_DISMISSALS,
    ONBOARDING_DECLINE_COOLOFF_MS,
    REPROMPT_INTERVAL_MS,
    getNotificationPromptState,
    hasAnyCompletedSession,
    recordOnboardingDeclined,
    recordPromptDismissed,
    recordPromptShown,
    shouldShowNotificationPrompt,
} from '@/lib/notificationPrompt';

const NOW = 1_800_000_000_000;

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockNotResult.mockResolvedValue({ count: 1, error: null });
});

describe('shouldShowNotificationPrompt', () => {
    it('allows a fresh user (no history)', () => {
        expect(shouldShowNotificationPrompt(DEFAULT_PROMPT_STATE, NOW)).toBe(true);
    });

    it('stops for good after the dismissal cap', () => {
        const state = { ...DEFAULT_PROMPT_STATE, dismissCount: MAX_PROMPT_DISMISSALS };
        expect(shouldShowNotificationPrompt(state, NOW)).toBe(false);
    });

    it('spaces re-asks by the re-prompt interval', () => {
        const justShown = { ...DEFAULT_PROMPT_STATE, lastPromptAt: NOW - 1000 };
        expect(shouldShowNotificationPrompt(justShown, NOW)).toBe(false);

        const longAgo = { ...DEFAULT_PROMPT_STATE, lastPromptAt: NOW - REPROMPT_INTERVAL_MS - 1 };
        expect(shouldShowNotificationPrompt(longAgo, NOW)).toBe(true);
    });

    it('gives breathing room after an onboarding decline, then allows', () => {
        const justDeclined = { ...DEFAULT_PROMPT_STATE, onboardingDeclinedAt: NOW - 1000 };
        expect(shouldShowNotificationPrompt(justDeclined, NOW)).toBe(false);

        const yesterday = {
            ...DEFAULT_PROMPT_STATE,
            onboardingDeclinedAt: NOW - ONBOARDING_DECLINE_COOLOFF_MS - 1,
        };
        expect(shouldShowNotificationPrompt(yesterday, NOW)).toBe(true);
    });
});

describe('state persistence round-trips', () => {
    it('returns defaults when nothing is stored or storage is corrupt', async () => {
        expect(await getNotificationPromptState()).toEqual(DEFAULT_PROMPT_STATE);

        await AsyncStorage.setItem('@powr/notification_prompt_state', 'not-json{');
        expect(await getNotificationPromptState()).toEqual(DEFAULT_PROMPT_STATE);
    });

    it('records an onboarding decline without touching other fields', async () => {
        await recordPromptDismissed();
        await recordOnboardingDeclined();

        const state = await getNotificationPromptState();
        expect(state.onboardingDeclinedAt).toBeGreaterThan(0);
        expect(state.dismissCount).toBe(1);
    });

    it('counts dismissals and stamps shown-at', async () => {
        await recordPromptShown();
        await recordPromptDismissed();
        await recordPromptDismissed();

        const state = await getNotificationPromptState();
        expect(state.dismissCount).toBe(2);
        expect(state.lastPromptAt).toBeGreaterThan(0);
    });
});

describe('hasAnyCompletedSession', () => {
    it('is true when the user has a completed session row', async () => {
        mockNotResult.mockResolvedValue({ count: 3, error: null });
        expect(await hasAnyCompletedSession('user-1')).toBe(true);
    });

    it('is false with zero sessions or on query error', async () => {
        mockNotResult.mockResolvedValue({ count: 0, error: null });
        expect(await hasAnyCompletedSession('user-1')).toBe(false);

        mockNotResult.mockResolvedValue({ count: null, error: { message: 'boom' } });
        expect(await hasAnyCompletedSession('user-1')).toBe(false);
    });
});
