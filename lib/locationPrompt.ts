import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

/**
 * Pacing state for the primed background-location re-ask (LocationPrimeSheet).
 *
 * The problem it solves: a user on "While Using" looks granted but earns
 * NOTHING in the background — geofence check-ins only fire on "Always". They
 * won't notice; the app just quietly stops working when it's in their pocket.
 * So we re-ask at a value moment (a session they banked with the app open,
 * proving they're using POWR at a gym), spaced out and capped so it never
 * becomes a nag. After the cap, the settings-screen Location row is the path
 * back in.
 *
 * Mirrors lib/notificationPrompt.ts deliberately — same cap/interval/cool-off
 * shape so the two re-asks behave identically and stay easy to reason about.
 */

const STORAGE_KEY = '@powr/location_prompt_state';

export interface LocationPromptState {
    /** Last time the re-ask sheet was shown (ms epoch). */
    lastPromptAt: number | null;
    /** How many times the user has dismissed the re-ask sheet. */
    dismissCount: number;
    /** When the user skipped/declined the onboarding background-location page. */
    onboardingDeclinedAt: number | null;
}

export const DEFAULT_LOCATION_PROMPT_STATE: LocationPromptState = {
    lastPromptAt: null,
    dismissCount: 0,
    onboardingDeclinedAt: null,
};

/** Stop auto-showing the sheet after this many dismissals. */
export const MAX_LOCATION_PROMPT_DISMISSALS = 3;
/** Minimum gap between re-asks. */
export const LOCATION_REPROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Breathing room after an onboarding decline before the first re-ask — long
 * enough not to nag the same person twice in one sitting, short enough that a
 * same-day first gym session can still convert them tomorrow.
 */
export const LOCATION_ONBOARDING_DECLINE_COOLOFF_MS = 12 * 60 * 60 * 1000;

/**
 * Pure decision: may the re-ask sheet show now? Callers gate separately on the
 * permission level (only 'while_using' is the target) and on the value moment
 * — this only answers the pacing question.
 */
export function shouldShowLocationPrompt(
    state: LocationPromptState,
    now: number,
): boolean {
    if (state.dismissCount >= MAX_LOCATION_PROMPT_DISMISSALS) return false;
    if (
        state.lastPromptAt !== null &&
        now - state.lastPromptAt < LOCATION_REPROMPT_INTERVAL_MS
    ) {
        return false;
    }
    if (
        state.onboardingDeclinedAt !== null &&
        now - state.onboardingDeclinedAt < LOCATION_ONBOARDING_DECLINE_COOLOFF_MS
    ) {
        return false;
    }
    return true;
}

export async function getLocationPromptState(): Promise<LocationPromptState> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_LOCATION_PROMPT_STATE };
        const parsed = JSON.parse(raw) as Partial<LocationPromptState>;
        return { ...DEFAULT_LOCATION_PROMPT_STATE, ...parsed };
    } catch {
        return { ...DEFAULT_LOCATION_PROMPT_STATE };
    }
}

async function saveState(patch: Partial<LocationPromptState>): Promise<void> {
    try {
        const current = await getLocationPromptState();
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {
        // Storage unavailable — worst case we ask again sooner than planned.
    }
}

/** The user skipped/declined the primed onboarding background-location page. */
export async function recordLocationOnboardingDeclined(): Promise<void> {
    await saveState({ onboardingDeclinedAt: Date.now() });
}

/** The re-ask sheet became visible — starts the re-prompt interval. */
export async function recordLocationPromptShown(): Promise<void> {
    await saveState({ lastPromptAt: Date.now() });
}

/** The user dismissed the re-ask sheet without upgrading to Always. */
export async function recordLocationPromptDismissed(): Promise<void> {
    const current = await getLocationPromptState();
    await saveState({ dismissCount: current.dismissCount + 1 });
}

/**
 * The target state for the re-ask: foreground granted but background is NOT,
 * i.e. "While Using". That's the silent-failure case worth fixing.
 *
 *  - 'undetermined' / 'denied' foreground → they never got past the fg ask;
 *    the fg onboarding page / discover tab owns that conversation, not us.
 *  - 'always' → nothing to do.
 *
 * Returns null on any native error so a transient failure never surfaces the
 * sheet.
 */
export async function isWhileUsingOnly(): Promise<boolean | null> {
    try {
        const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (!fg || fg.status !== 'granted') return null;
        const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
        if (!bg) return null;
        return bg.status !== 'granted';
    } catch {
        return null;
    }
}
