/**
 * Single source of truth for the onboarding journey order.
 *
 * Screens derive their StepDots count + active index from here (via
 * ONBOARDING_DOT_COUNT / dotIndexFor) so the progress indicator can never drift
 * out of sync with the actual flow — adding/removing/reordering a step is a
 * one-line change here. `onboarding-activities` is part of the flow but
 * intentionally renders no dots; its index still counts toward the total.
 */

export const ONBOARDING_STEPS = [
    '/onboarding-account',
    '/onboarding-profile',
    '/onboarding-permission',
    '/onboarding-permission-background',
    '/onboarding-gym',
    '/onboarding-health',
    '/onboarding-activities',
    '/onboarding-notifications',
    '/onboarding-achievement',
] as const;

export type OnboardingRoute = (typeof ONBOARDING_STEPS)[number];

/** Total number of progress dots (= number of steps in the flow). */
export const ONBOARDING_DOT_COUNT = ONBOARDING_STEPS.length;

/** Zero-based position of a step in the flow (its active StepDots index). */
export function dotIndexFor(route: OnboardingRoute): number {
    return ONBOARDING_STEPS.indexOf(route);
}

/** The route the linear "continue" path advances to, or null at the end. */
export function nextRoute(route: OnboardingRoute): OnboardingRoute | null {
    const i = ONBOARDING_STEPS.indexOf(route);
    if (i < 0 || i >= ONBOARDING_STEPS.length - 1) return null;
    return ONBOARDING_STEPS[i + 1];
}
