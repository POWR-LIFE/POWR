/**
 * Garmin's direct (Terra) link is paused: Terra has delivered nothing for it
 * since 2026-09-21, while Garmin Connect still writes to Apple Health / Health
 * Connect. A paused provider must read as "not connected", so the self-heal in
 * useHealthProviders.refresh moves `active` back to the phone health store and
 * native workout + sleep sync switches back on.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {}, getSessionUser: jest.fn(async () => null) }));
jest.mock('@/lib/api/points', () => ({ awardBonus: jest.fn() }));
jest.mock('@/lib/api/onboardingSync', () => ({ backfillHealthHistoryIfNeeded: jest.fn() }));

import { sanitizeConnections } from '@/hooks/useHealthProviders';
import { ALL_PROVIDER_META, isPausedProvider, visibleProviders } from '@/lib/health/providers';

describe('isPausedProvider', () => {
    it('flags Garmin by app id and by Terra slug', () => {
        expect(isPausedProvider('garmin')).toBe(true);
        expect(isPausedProvider('GARMIN')).toBe(true);
    });

    it('leaves live providers alone', () => {
        for (const id of ['whoop', 'oura', 'fitbit', 'strava', 'apple-health', 'health-connect']) {
            expect(isPausedProvider(id)).toBe(false);
        }
        expect(isPausedProvider(null)).toBe(false);
        expect(isPausedProvider(undefined)).toBe(false);
        expect(isPausedProvider('not-a-provider')).toBe(false);
    });

    it('pauses only Garmin', () => {
        expect(ALL_PROVIDER_META.filter(m => m.paused).map(m => m.id)).toEqual(['garmin']);
    });

    it('keeps the Garmin tile visible so it can route to the phone store', () => {
        expect(visibleProviders().some(m => m.id === 'garmin')).toBe(true);
    });
});

describe('sanitizeConnections', () => {
    it('drops a paused Garmin connection even with a live terra_user_id', () => {
        const out = sanitizeConnections({
            'apple-health': { connected_at: '2026-08-01T00:00:00Z' },
            garmin: { connected_at: '2026-08-02T00:00:00Z', terra_user_id: 'a0bb73fd' },
        });
        expect(Object.keys(out)).toEqual(['apple-health']);
    });

    it('keeps other Terra wearables that have a terra_user_id', () => {
        const out = sanitizeConnections({
            whoop: { terra_user_id: '38cb14bf' },
            oura: { connected_at: '2026-06-01T00:00:00Z' }, // pre-Terra entry, no id
        });
        expect(Object.keys(out)).toEqual(['whoop']);
    });
});
