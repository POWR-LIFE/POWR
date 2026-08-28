/**
 * Tests for the onboarding journey order (lib/onboarding/flow.ts) — the single
 * source of truth every screen's StepDots derives from. These lock the step
 * sequence and the progress-dot indexing so they can't silently drift when a
 * step is added/removed/reordered.
 */

import {
    ONBOARDING_DOT_COUNT,
    ONBOARDING_STEPS,
    dotIndexFor,
    nextRoute,
} from '@/lib/onboarding/flow';

describe('onboarding flow order', () => {
    it('is the expected 10-step sequence, account → achievement', () => {
        expect(ONBOARDING_STEPS).toEqual([
            '/onboarding-account',
            '/onboarding-profile',
            '/onboarding-permission',
            '/onboarding-permission-background',
            '/onboarding-wearables',
            '/onboarding-activities',
            '/onboarding-gym',
            '/onboarding-health',
            '/onboarding-notifications',
            '/onboarding-achievement',
        ]);
    });

    it('pitches wearables early and phone health late, on separate steps', () => {
        expect(dotIndexFor('/onboarding-wearables')).toBe(dotIndexFor('/onboarding-permission-background') + 1);
        expect(nextRoute('/onboarding-health')).toBe('/onboarding-notifications');
    });

    it('places the profile step right after sign-in, and the home-gym step after the activity picks', () => {
        expect(dotIndexFor('/onboarding-profile')).toBe(dotIndexFor('/onboarding-account') + 1);
        // Wearables → activities → gym: the picks are known before the gym map
        // is shown, so the map can be skipped for users who dropped gym.
        expect(dotIndexFor('/onboarding-activities')).toBe(dotIndexFor('/onboarding-wearables') + 1);
        expect(dotIndexFor('/onboarding-gym')).toBe(dotIndexFor('/onboarding-activities') + 1);
    });

    it('primes each permission on its own page: while-using → all-the-time', () => {
        expect(dotIndexFor('/onboarding-permission-background')).toBe(
            dotIndexFor('/onboarding-permission') + 1,
        );
    });

    it('asks for notifications on a primed page right before the finale', () => {
        expect(nextRoute('/onboarding-gym')).toBe('/onboarding-health');
        expect(nextRoute('/onboarding-notifications')).toBe('/onboarding-achievement');
    });

    it('has no duplicate routes', () => {
        expect(new Set(ONBOARDING_STEPS).size).toBe(ONBOARDING_STEPS.length);
    });

    it('has one progress dot per step', () => {
        expect(ONBOARDING_DOT_COUNT).toBe(ONBOARDING_STEPS.length);
        expect(ONBOARDING_DOT_COUNT).toBe(10);
    });
});

describe('dotIndexFor', () => {
    it('returns each step\'s contiguous zero-based position', () => {
        ONBOARDING_STEPS.forEach((route, i) => {
            expect(dotIndexFor(route)).toBe(i);
        });
    });

    it('keeps every dot index inside the dot count', () => {
        ONBOARDING_STEPS.forEach(route => {
            const idx = dotIndexFor(route);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(ONBOARDING_DOT_COUNT);
        });
    });
});

describe('nextRoute', () => {
    it('advances each step to the following one', () => {
        expect(nextRoute('/onboarding-account')).toBe('/onboarding-profile');
        expect(nextRoute('/onboarding-permission')).toBe('/onboarding-permission-background');
        expect(nextRoute('/onboarding-permission-background')).toBe('/onboarding-wearables');
        expect(nextRoute('/onboarding-activities')).toBe('/onboarding-gym');
    });

    it('chains all the way through the flow then stops', () => {
        const visited: string[] = [];
        let route: ReturnType<typeof nextRoute> = ONBOARDING_STEPS[0];
        while (route) {
            visited.push(route);
            route = nextRoute(route);
        }
        expect(visited).toEqual([...ONBOARDING_STEPS]);
    });

    it('returns null at the final step', () => {
        expect(nextRoute('/onboarding-achievement')).toBeNull();
    });
});
