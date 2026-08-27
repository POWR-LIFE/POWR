import { fetchProfile } from '@/lib/api/user';

/**
 * Where a signed-in user who has not finished onboarding should land.
 *
 * Email signups and anyone who returns mid-onboarding used to be dropped
 * straight onto /onboarding-permission — one step PAST the profile screen —
 * so they never chose a name and surfaced on leaderboards as "Unknown"
 * (FNL x POWR, 2026-08-27). The name step is only skippable once it has
 * actually been done.
 */
export async function resumeOnboardingRoute(): Promise<'/onboarding-profile' | '/onboarding-permission'> {
    try {
        const profile = await fetchProfile();
        if (!profile?.display_name?.trim()) return '/onboarding-profile';
    } catch {
        // Unreachable profile → fall through to the old destination rather
        // than trapping the user on a screen that cannot load.
    }
    return '/onboarding-permission';
}
