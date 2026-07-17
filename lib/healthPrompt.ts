import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSessionUser, supabase } from '@/lib/supabase';

/**
 * Pacing + trigger logic for the primed health re-ask (HealthPrimeSheet).
 *
 * Strategy: mirrors lib/notificationPrompt — the sheet only shows at a value
 * moment, spaced out and capped so it never becomes a nag. The trigger is
 * "no health data is flowing", which has two distinct flavours:
 *
 *  - 'connect'   — the user never linked a native health source. The onboarding
 *                  step was their only pitch; this is the second chance.
 *  - 'reconnect' — our records say a native source WAS connected, but the OS
 *                  grant is dead (Health Connect toggles off after a reinstall,
 *                  Health app sharing revoked…). Steps silently stopped counting
 *                  — the 2026-07-16 incident — and nothing else in the app says so.
 */

const STORAGE_KEY = '@powr/health_prompt_state';

export interface HealthPromptState {
    /** Last time the re-ask sheet was shown (ms epoch). */
    lastPromptAt: number | null;
    /** How many times the user has dismissed the re-ask sheet. */
    dismissCount: number;
    /** When the user skipped the onboarding health page. */
    onboardingDeclinedAt: number | null;
}

export const DEFAULT_HEALTH_PROMPT_STATE: HealthPromptState = {
    lastPromptAt: null,
    dismissCount: 0,
    onboardingDeclinedAt: null,
};

/** Stop auto-showing the sheet after this many dismissals. */
export const MAX_HEALTH_PROMPT_DISMISSALS = 3;
/** Minimum gap between re-asks. */
export const HEALTH_REPROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Breathing room after an onboarding skip before the first re-ask. */
export const HEALTH_ONBOARDING_DECLINE_COOLOFF_MS = 12 * 60 * 60 * 1000;
/**
 * "Steps are flowing" lookback. A walking session that STARTED within this
 * window means the pipeline works (phone sync or a Terra wearable top-up), so
 * the sheet stays away. 48h — not 24 — so an early-morning check doesn't fire
 * before today's first sync, while a grant that died yesterday still gets
 * caught on day two.
 */
export const WALKING_FLOW_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Pure decision: may the re-ask sheet show now? Callers gate separately on the
 * data-flow signals (detectHealthPromptMode) and the value moment — this only
 * answers the pacing question.
 */
export function shouldShowHealthPrompt(state: HealthPromptState, now: number): boolean {
    if (state.dismissCount >= MAX_HEALTH_PROMPT_DISMISSALS) return false;
    if (state.lastPromptAt !== null && now - state.lastPromptAt < HEALTH_REPROMPT_INTERVAL_MS) {
        return false;
    }
    if (
        state.onboardingDeclinedAt !== null &&
        now - state.onboardingDeclinedAt < HEALTH_ONBOARDING_DECLINE_COOLOFF_MS
    ) {
        return false;
    }
    return true;
}

export type HealthPromptMode = 'connect' | 'reconnect';

export interface HealthFlowSignals {
    platform: 'ios' | 'android' | 'web';
    /** Native health store grant is alive (useHealthData.isAuthorized). */
    isAuthorized: boolean;
    /** Live device step read for today. */
    stepsToday: number;
    /** A walking session started within WALKING_FLOW_LOOKBACK_MS (any source —
     *  phone sync on this/another device, or a Terra wearable top-up). */
    hasRecentWalkingSession: boolean;
    /** Our records show a native source (Apple Health / Health Connect) was
     *  connected at some point. */
    everConnectedNative: boolean;
}

/**
 * Pure decision: is health data flowing, and if not, which pitch applies?
 * Returns null when there is nothing to fix (or nothing we should nag about).
 */
export function detectHealthPromptMode(s: HealthFlowSignals): HealthPromptMode | null {
    if (s.platform === 'web') return null;
    // Steps readable right now — the native pipe is healthy.
    if (s.stepsToday > 0) return null;
    // Grant is alive; zero steps just means they haven't moved yet today.
    if (s.isAuthorized) return null;
    // Steps are arriving without the native grant (Terra wearable top-up,
    // another device syncing) — data IS flowing, don't nag.
    if (s.hasRecentWalkingSession) return null;
    return s.everConnectedNative ? 'reconnect' : 'connect';
}

export async function getHealthPromptState(): Promise<HealthPromptState> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_HEALTH_PROMPT_STATE };
        const parsed = JSON.parse(raw) as Partial<HealthPromptState>;
        return { ...DEFAULT_HEALTH_PROMPT_STATE, ...parsed };
    } catch {
        return { ...DEFAULT_HEALTH_PROMPT_STATE };
    }
}

async function saveState(patch: Partial<HealthPromptState>): Promise<void> {
    try {
        const current = await getHealthPromptState();
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {
        // Storage unavailable — worst case we ask again sooner than planned.
    }
}

/** The user skipped the onboarding health page. */
export async function recordHealthOnboardingDeclined(): Promise<void> {
    await saveState({ onboardingDeclinedAt: Date.now() });
}

/** The re-ask sheet became visible — starts the re-prompt interval. */
export async function recordHealthPromptShown(): Promise<void> {
    await saveState({ lastPromptAt: Date.now() });
}

/** The user dismissed the re-ask sheet without connecting. */
export async function recordHealthPromptDismissed(): Promise<void> {
    const current = await getHealthPromptState();
    await saveState({ dismissCount: current.dismissCount + 1 });
}

// ── DB-backed signals ─────────────────────────────────────────────────────────

/** A walking session (auto-sync, trust 0.90) started within the lookback? */
export async function hasRecentWalkingSession(): Promise<boolean> {
    try {
        const user = await getSessionUser();
        if (!user) return false;
        const since = new Date(Date.now() - WALKING_FLOW_LOOKBACK_MS).toISOString();
        const { count, error } = await supabase
            .from('activity_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('type', 'walking')
            .eq('trust_score', 0.90)
            .gte('started_at', since);
        if (error) return false;
        return (count ?? 0) > 0;
    } catch {
        return false;
    }
}

/** Did this account ever connect a native health source (per our records)? */
export async function hasEverConnectedNative(): Promise<boolean> {
    try {
        const user = await getSessionUser();
        if (!user) return false;
        const { data, error } = await supabase
            .from('profiles')
            .select('health_provider_connections')
            .eq('id', user.id)
            .maybeSingle<{ health_provider_connections: Record<string, unknown> | null }>();
        if (error || !data) return false;
        const conns = data.health_provider_connections ?? {};
        return 'apple-health' in conns || 'health-connect' in conns;
    } catch {
        return false;
    }
}
