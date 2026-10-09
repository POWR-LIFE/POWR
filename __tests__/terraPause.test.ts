/**
 * The Terra pause switch (system_config 'terra_paused').
 *
 * While it's on, every Terra brand reads as paused and the phone's health
 * store stands in for it — but NOTHING is dropped from the profile, so turning
 * it off restores Terra exactly as it was. Garmin's own `paused` flag is the
 * permanent kind and still drops the connection. Disconnecting for good is a
 * separate step whose profile rewrite lives in profileAfterDeauth.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {}, getSessionUser: jest.fn(async () => null) }));
jest.mock('@/lib/api/points', () => ({ awardBonus: jest.fn() }));
jest.mock('@/lib/api/onboardingSync', () => ({ backfillHealthHistoryIfNeeded: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { sanitizeConnections } from '@/hooks/useHealthProviders';
import {
    ALL_PROVIDER_META,
    effectiveProviderId,
    isPausedProvider,
    isStaticallyPaused,
} from '@/lib/health/providers';
import { isPausedValue, isTerraPaused, setTerraPaused } from '@/lib/health/terraPause';
import { profileAfterDeauth } from '@/supabase/functions/_shared/terraDeauth';
import { isPausedValue as serverIsPausedValue } from '@/supabase/functions/_shared/terraPause';

afterEach(() => setTerraPaused(false));

describe('the switch value', () => {
    it.each([['true', true], ['TRUE ', true], ['1', true], ['on', true], ['false', false], ['', false], [null, false]])(
        '%p reads as paused=%p on both sides', (value, expected) => {
            expect(isPausedValue(value)).toBe(expected);
            expect(serverIsPausedValue(value)).toBe(expected);
        },
    );

    it('is cached for the next cold or headless start', async () => {
        setTerraPaused(true);
        expect(isTerraPaused()).toBe(true);
        await new Promise(r => setTimeout(r, 0));
        expect(await AsyncStorage.getItem('@powr/terra_paused')).toBe('1');
    });
});

describe('isPausedProvider with the switch', () => {
    it('off: only Garmin is paused', () => {
        expect(isPausedProvider('garmin')).toBe(true);
        expect(isPausedProvider('whoop')).toBe(false);
    });

    it('on: every Terra brand is paused, the phone stores never are', () => {
        setTerraPaused(true);
        const terra = ALL_PROVIDER_META.filter(m => m.transport === 'terra');
        expect(terra.length).toBeGreaterThan(10);
        for (const m of terra) expect(isPausedProvider(m.id)).toBe(true);
        expect(isPausedProvider('WHOOP')).toBe(true);
        expect(isPausedProvider('apple-health')).toBe(false);
        expect(isPausedProvider('health-connect')).toBe(false);
        expect(isPausedProvider('samsung-health')).toBe(false);
    });

    it('a paused brand reads from the phone store in its place', () => {
        setTerraPaused(true);
        expect(effectiveProviderId('whoop')).toBe('apple-health'); // jest-expo runs as iOS
        expect(effectiveProviderId('apple-health')).toBe('apple-health');
        expect(effectiveProviderId(null)).toBeNull();
        setTerraPaused(false);
        expect(effectiveProviderId('whoop')).toBe('whoop');
    });
});

describe('sanitizeConnections — the remote pause is reversible', () => {
    it('keeps a Whoop connection while the switch is on (Garmin\'s permanent pause still drops)', () => {
        setTerraPaused(true);
        const out = sanitizeConnections({
            'apple-health': { connected_at: '2026-08-01T00:00:00Z' },
            whoop: { terra_user_id: '38cb14bf' },
            garmin: { terra_user_id: 'a0bb73fd' },
        });
        expect(Object.keys(out).sort()).toEqual(['apple-health', 'whoop']);
        expect(isStaticallyPaused('whoop')).toBe(false);
        expect(isStaticallyPaused('garmin')).toBe(true);
    });
});

describe('profileAfterDeauth — disconnecting for good', () => {
    it('removes the connection and hands the active source to the phone store', () => {
        expect(profileAfterDeauth(
            { whoop: { terra_user_id: 'x' }, 'apple-health': { connected_at: 't' } }, 'whoop', 'WHOOP',
        )).toEqual({ health_provider_connections: { 'apple-health': { connected_at: 't' } }, active_health_provider: 'apple-health' });
    });

    it('prefers the phone store over another connection, and falls back to none', () => {
        expect(profileAfterDeauth({ zepp: {}, oura: {}, 'health-connect': {} }, 'zepp', 'ZEPP').active_health_provider)
            .toBe('health-connect');
        expect(profileAfterDeauth({ whoop: {} }, 'whoop', 'WHOOP').active_health_provider).toBeNull();
    });

    it('leaves a different active source alone', () => {
        expect(profileAfterDeauth({ garmin: {}, 'apple-health': {} }, 'apple-health', 'GARMIN')).toEqual({
            health_provider_connections: { 'apple-health': {} }, active_health_provider: 'apple-health',
        });
    });

    it('does not mutate the stored connections object', () => {
        const conns = { whoop: {}, 'apple-health': {} };
        profileAfterDeauth(conns, 'whoop', 'WHOOP');
        expect(Object.keys(conns)).toEqual(['whoop', 'apple-health']);
    });
});
