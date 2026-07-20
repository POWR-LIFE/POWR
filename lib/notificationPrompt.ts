import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

/**
 * Pacing state for the primed notification re-ask (NotificationPrimeSheet).
 *
 * Strategy: the OS notification dialog is one-shot on iOS, so it must only
 * ever fire from a primed surface the user deliberately tapped — never
 * automatically. Users who decline the onboarding ask get re-asked at a value
 * moment (first completed session banked) on Home, spaced out and capped so
 * it never turns into a nag. After the cap, the settings-screen banner is the
 * remaining path back in.
 */

const STORAGE_KEY = '@powr/notification_prompt_state';

export interface NotificationPromptState {
    /** Last time the re-ask sheet was shown (ms epoch). */
    lastPromptAt: number | null;
    /** How many times the user has dismissed the re-ask sheet. */
    dismissCount: number;
    /** When the user declined the onboarding notifications page (skip or deny). */
    onboardingDeclinedAt: number | null;
}

export const DEFAULT_PROMPT_STATE: NotificationPromptState = {
    lastPromptAt: null,
    dismissCount: 0,
    onboardingDeclinedAt: null,
};

/** Stop auto-showing the sheet after this many dismissals. */
export const MAX_PROMPT_DISMISSALS = 3;
/** Minimum gap between re-asks. */
export const REPROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Breathing room after an onboarding decline before the first re-ask —
 * long enough to not feel like nagging the same person twice in one sitting,
 * short enough that a same-day first gym session can still convert tomorrow.
 */
export const ONBOARDING_DECLINE_COOLOFF_MS = 12 * 60 * 60 * 1000;

/**
 * Pure decision: may the re-ask sheet show now? Callers gate separately on
 * permission status and on the user having a completed session (the value
 * moment) — this only answers the pacing question.
 */
export function shouldShowNotificationPrompt(
    state: NotificationPromptState,
    now: number,
): boolean {
    if (state.dismissCount >= MAX_PROMPT_DISMISSALS) return false;
    if (state.lastPromptAt !== null && now - state.lastPromptAt < REPROMPT_INTERVAL_MS) {
        return false;
    }
    if (
        state.onboardingDeclinedAt !== null &&
        now - state.onboardingDeclinedAt < ONBOARDING_DECLINE_COOLOFF_MS
    ) {
        return false;
    }
    return true;
}

export async function getNotificationPromptState(): Promise<NotificationPromptState> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PROMPT_STATE };
        const parsed = JSON.parse(raw) as Partial<NotificationPromptState>;
        return { ...DEFAULT_PROMPT_STATE, ...parsed };
    } catch {
        return { ...DEFAULT_PROMPT_STATE };
    }
}

async function saveState(patch: Partial<NotificationPromptState>): Promise<void> {
    try {
        const current = await getNotificationPromptState();
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {
        // Storage unavailable — worst case we ask again sooner than planned.
    }
}

/** The user skipped (or denied) the primed onboarding notifications page. */
export async function recordOnboardingDeclined(): Promise<void> {
    await saveState({ onboardingDeclinedAt: Date.now() });
}

/** The re-ask sheet became visible — starts the re-prompt interval. */
export async function recordPromptShown(): Promise<void> {
    await saveState({ lastPromptAt: Date.now() });
}

/** The user dismissed the re-ask sheet without enabling. */
export async function recordPromptDismissed(): Promise<void> {
    const current = await getNotificationPromptState();
    await saveState({ dismissCount: current.dismissCount + 1 });
}

/**
 * The "value moment" gate: has this user banked at least one completed
 * session? (Any type — a wearable-synced run counts as much as a gym visit.)
 */
export async function hasAnyCompletedSession(userId: string): Promise<boolean> {
    const { count, error } = await supabase
        .from('activity_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('ended_at', 'is', null);
    if (error) return false;
    return (count ?? 0) > 0;
}
