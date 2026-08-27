import { fetchProfile, type Profile } from '@/lib/api/user';

export type ResumeRoute = '/onboarding-profile' | '/onboarding-permission' | '/(tabs)';

/** A profile the app cannot show properly: no name to render, no handle to find. */
export function profileIncomplete(p: Pick<Profile, 'display_name' | 'username'> | null | undefined): boolean {
    return !p?.display_name?.trim() || !p?.username?.trim();
}

/**
 * Where a signed-in user should land — the ONE place that decides.
 *
 * Email signups and anyone returning mid-onboarding used to be dropped
 * straight onto /onboarding-permission — one step PAST the profile screen —
 * so they never chose a name and surfaced on leaderboards as "?" / "Unknown"
 * (FNL x POWR, 2026-08-27). Name + username are mandatory: a profile missing
 * either goes to the profile step first, even after onboarding is complete
 * (the profile screen returns such a user straight to the tabs).
 *
 * An unreachable profile falls through to the old destination rather than
 * trapping the user on a screen that cannot load.
 */
export async function resumeOnboardingRoute(onboardingComplete: boolean): Promise<ResumeRoute> {
    try {
        const profile = await fetchProfile();
        if (profile && profileIncomplete(profile)) return '/onboarding-profile';
    } catch {
        // fall through
    }
    return onboardingComplete ? '/(tabs)' : '/onboarding-permission';
}
