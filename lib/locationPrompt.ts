import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { hasAnyCompletedSession } from '@/lib/notificationPrompt';

/**
 * Pacing state for BOTH primed location re-asks:
 *
 *  - background / "Always" (LocationPrimeSheet, the `lastPromptAt` +
 *    `dismissCount` fields). A user on "While Using" looks granted but earns
 *    NOTHING in the background — geofence check-ins only fire on "Always".
 *    They won't notice; the app just quietly stops working when it's in their
 *    pocket. So we re-ask at a value moment, spaced out and capped.
 *
 *  - foreground (PermissionFixScreen on Discover, the `fg*` fields). Discover
 *    used to fire a bare requestForegroundPermissionsAsync() on mount with no
 *    priming in front of it. On iOS one "Don't Allow" sets canAskAgain:false
 *    forever, so that cold one-shot could permanently burn the permission the
 *    whole product runs on. Same treatment as every other permission now:
 *    prime first, ask only from a surface the user chose to act on.
 *
 * After either cap, the settings-screen Location row is the path back in.
 *
 * Mirrors lib/notificationPrompt.ts deliberately — same cap/interval/cool-off
 * shape so the re-asks behave identically and stay easy to reason about.
 */

const STORAGE_KEY = '@powr/location_prompt_state';

export interface LocationPromptState {
    /** Last time the re-ask sheet was shown (ms epoch). */
    lastPromptAt: number | null;
    /** How many times the user has dismissed the re-ask sheet. */
    dismissCount: number;
    /** When the user skipped/declined the onboarding background-location page. */
    onboardingDeclinedAt: number | null;
    /** Last time the primed FOREGROUND recovery screen was shown (ms epoch). */
    fgLastPromptAt: number | null;
    /** How many times the user has dismissed the foreground recovery screen. */
    fgDismissCount: number;
    /** Local YYYY-MM-DD of the first app open we ever stamped. */
    firstSeenDay: string | null;
    /** Local YYYY-MM-DD of the most recent app open. */
    lastSeenDay: string | null;
    /** Last time the AT-VENUE variant of the re-ask was shown (ms epoch). */
    atVenueLastPromptAt: number | null;
}

export const DEFAULT_LOCATION_PROMPT_STATE: LocationPromptState = {
    lastPromptAt: null,
    dismissCount: 0,
    onboardingDeclinedAt: null,
    fgLastPromptAt: null,
    fgDismissCount: 0,
    firstSeenDay: null,
    lastSeenDay: null,
    atVenueLastPromptAt: null,
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

/**
 * The AT-VENUE re-ask: the user opened the app standing inside a partner venue
 * on "While Using", so THIS visit is earning nothing. That is consequence-
 * anchored evidence (see lib/venuePresence.ts), so it skips the weekly
 * calendar and the value-moment gate — but it is still a sheet in the user's
 * face, so: once a day, the shared dismissal cap still applies, and a fresh
 * onboarding decline gets an hour's grace rather than twelve.
 */
export const AT_VENUE_REPROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AT_VENUE_ONBOARDING_COOLOFF_MS = 60 * 60 * 1000;

export function shouldShowAtVenuePrompt(
    state: LocationPromptState,
    now: number,
): boolean {
    if (state.dismissCount >= MAX_LOCATION_PROMPT_DISMISSALS) return false;
    if (
        state.atVenueLastPromptAt !== null &&
        now - state.atVenueLastPromptAt < AT_VENUE_REPROMPT_INTERVAL_MS
    ) {
        return false;
    }
    if (
        state.onboardingDeclinedAt !== null &&
        now - state.onboardingDeclinedAt < AT_VENUE_ONBOARDING_COOLOFF_MS
    ) {
        return false;
    }
    return true;
}

/**
 * Stop auto-showing the primed foreground recovery screen after this many
 * dismissals — one fewer than the background re-ask, deliberately.
 */
export const MAX_FOREGROUND_PROMPT_DISMISSALS = 2;
/** Minimum gap between foreground re-asks — twice the background interval. */
export const FOREGROUND_REPROMPT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pure decision: may the primed foreground recovery screen show now? Callers
 * gate separately on the permission actually being missing (isForegroundMissing)
 * — this only answers the pacing question.
 *
 * A tighter cap (2 vs 3) and a longer interval (14d vs 7d) than the background
 * re-ask are deliberate. The background re-ask is a sheet on Home, where the
 * user came to see their progress; this one is a full-screen takeover on a tab
 * they opened to look at the map. Hijacking Discover is a bigger tax on
 * someone who asked for something else, so it has to give up sooner.
 *
 * The onboarding cool-off is shared with the background page on purpose: it
 * means "this person just said no to a location page", and re-asking on their
 * very first Discover open in the same sitting is exactly the nag the primed
 * flow exists to avoid.
 */
export function shouldShowForegroundPrompt(
    state: LocationPromptState,
    now: number,
): boolean {
    if (state.fgDismissCount >= MAX_FOREGROUND_PROMPT_DISMISSALS) return false;
    if (
        state.fgLastPromptAt !== null &&
        now - state.fgLastPromptAt < FOREGROUND_REPROMPT_INTERVAL_MS
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

/** The at-venue variant became visible. Also stamps the generic interval so
 *  the calendar-paced sheet doesn't follow it up days later with the same ask. */
export async function recordAtVenuePromptShown(): Promise<void> {
    const now = Date.now();
    await saveState({ atVenueLastPromptAt: now, lastPromptAt: now });
}

/** The user dismissed the re-ask sheet without upgrading to Always. */
export async function recordLocationPromptDismissed(): Promise<void> {
    const current = await getLocationPromptState();
    await saveState({ dismissCount: current.dismissCount + 1 });
}

/** The primed foreground screen became visible — starts its re-prompt interval. */
export async function recordForegroundPromptShown(): Promise<void> {
    await saveState({ fgLastPromptAt: Date.now() });
}

/** The user backed out of the primed foreground screen without granting. */
export async function recordForegroundPromptDismissed(): Promise<void> {
    const current = await getLocationPromptState();
    await saveState({ fgDismissCount: current.fgDismissCount + 1 });
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

/**
 * The target state for the primed foreground recovery screen: foreground is
 * NOT granted ('undetermined' or 'denied'). Both are worth a primed surface —
 * 'undetermined' still has the one-shot OS dialog to spend and must not spend
 * it cold, 'denied' has already burned it and only Settings can undo it.
 * PermissionFixScreen picks 'ask' vs 'settings' from live state either way.
 *
 * Returns null on any native error so a transient failure never surfaces a
 * full-screen takeover. Same defensive shape as isWhileUsingOnly.
 */
export async function isForegroundMissing(): Promise<boolean | null> {
    try {
        const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (!fg) return null;
        return fg.status !== 'granted';
    } catch {
        return null;
    }
}

/**
 * Local YYYY-MM-DD. The day boundary the user actually experiences, not UTC's
 * — the same convention walkingSync uses for step windows, and for the same
 * reason: a 23:00 open and a 01:00 open are two different days to them.
 */
function localDayKey(now: number): string {
    const d = new Date(now);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Stamp today against the prompt state. Safe to call on every evaluate: it
 * only writes when the local day actually rolls over, so the common path is a
 * single AsyncStorage read.
 */
export async function recordAppOpenDay(now: number = Date.now()): Promise<void> {
    const today = localDayKey(now);
    const state = await getLocationPromptState();
    if (state.lastSeenDay === today) return;
    await saveState({
        firstSeenDay: state.firstSeenDay ?? today,
        lastSeenDay: today,
    });
}

/**
 * The second value moment: this person came BACK.
 *
 * Deliberately "a LATER day", not an open count — two opens in one sitting is
 * curiosity, coming back tomorrow is use. Fails closed: a wiped or corrupt
 * store reads as the defaults (both null) and returns false, so a storage blip
 * can never surface a prompt at someone who has done nothing.
 */
export async function hasReturnedOnALaterDay(): Promise<boolean> {
    try {
        const { firstSeenDay, lastSeenDay } = await getLocationPromptState();
        if (!firstSeenDay || !lastSeenDay) return false;
        // YYYY-MM-DD sorts lexicographically the same way it sorts in time.
        return lastSeenDay > firstSeenDay;
    } catch {
        return false;
    }
}

/**
 * The value-moment gate for the location re-asks: has this user given us
 * enough of a reason to spend one of their capped prompts?
 *
 * True if they banked a completed session OR they came back on a later day.
 *
 * The session check alone is a catch-22 for exactly the user the "Always"
 * re-ask exists for: no background permission means passive gym check-ins
 * never land, no check-in means no session row, no session row means the gate
 * never opens, so they are never asked to fix the thing that is breaking them.
 * (Production: 7 users on While Using, only 4 with a session — the gate was
 * shut for 3 of its own 7 targets.) It cannot be widened with another query
 * either: walking auto-sync inserts a session with ended_at always set
 * (logHealthWalkingSession), so every health/step/gym/challenge signal is a
 * subset of hasAnyCompletedSession, not an addition to it. The one engagement
 * a user with no provider connected and no check-in still shows is on-device:
 * they keep opening POWR.
 *
 * Stamps today first, so a caller that reaches this gate on an "Always" user
 * still accrues the day history a later downgrade to While Using would read.
 * Fails closed on any error.
 */
export async function hasReachedLocationValueMoment(userId: string): Promise<boolean> {
    try {
        await recordAppOpenDay();
        if (await hasAnyCompletedSession(userId)) return true;
        return await hasReturnedOnALaterDay();
    } catch {
        return false;
    }
}
