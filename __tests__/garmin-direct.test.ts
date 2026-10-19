/**
 * Garmin, direct (2026-10-19). Garmin no longer goes through Terra: POWR's own
 * Garmin app signs the user in (garmin-auth) and Garmin pushes data to
 * garmin-webhook. Until the garmin_direct switch lets a user in, Garmin reads
 * as paused for them and syncs through the phone — the behaviour every Garmin
 * user had while Terra's Garmin access was dead.
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
    isServerDelivered,
    isTerraProvider,
    visibleProviders,
} from '@/lib/health/providers';
import { isGarminDirectAvailable, setGarminDirectAvailable } from '@/lib/health/garminDirect';
import { setTerraPaused } from '@/lib/health/terraPause';

afterEach(() => {
    setGarminDirectAvailable(false);
    setTerraPaused(false);
});

describe('Garmin is a direct provider', () => {
    it('is not a Terra brand, but is delivered server-side', () => {
        expect(ALL_PROVIDER_META.find(m => m.id === 'garmin')?.transport).toBe('direct');
        expect(isTerraProvider('garmin')).toBe(false);
        expect(isServerDelivered('garmin')).toBe(true);
        expect(isServerDelivered('whoop')).toBe(true);
        expect(isServerDelivered('apple-health')).toBe(false);
        expect(isServerDelivered(null)).toBe(false);
    });

    it('carries no permanent pause flag any more', () => {
        expect(ALL_PROVIDER_META.filter(m => m.paused)).toEqual([]);
    });

    it('keeps the Garmin tile visible', () => {
        expect(visibleProviders().some(m => m.id === 'garmin')).toBe(true);
    });
});

describe('the garmin_direct switch', () => {
    it('defaults to unavailable: Garmin reads as paused and syncs through the phone', () => {
        expect(isGarminDirectAvailable()).toBe(false);
        expect(isPausedProvider('garmin')).toBe(true);
        expect(isPausedProvider('GARMIN')).toBe(true);
        expect(effectiveProviderId('garmin')).toBe('apple-health'); // jest-expo runs as iOS
    });

    it('available: Garmin is live and is its own source', () => {
        setGarminDirectAvailable(true);
        expect(isPausedProvider('garmin')).toBe(false);
        expect(effectiveProviderId('garmin')).toBe('garmin');
    });

    it('is independent of the Terra pause switch', () => {
        setGarminDirectAvailable(true);
        setTerraPaused(true);
        expect(isPausedProvider('garmin')).toBe(false);
        expect(isPausedProvider('whoop')).toBe(true);
    });

    it('is cached for the next cold or headless start', async () => {
        setGarminDirectAvailable(true);
        await new Promise(r => setTimeout(r, 0));
        expect(await AsyncStorage.getItem('@powr/garmin_direct')).toBe('1');
    });

    it('leaves other providers alone', () => {
        for (const id of ['whoop', 'oura', 'fitbit', 'strava', 'apple-health', 'health-connect']) {
            expect(isPausedProvider(id)).toBe(false);
        }
        expect(isPausedProvider(null)).toBe(false);
        expect(isPausedProvider('not-a-provider')).toBe(false);
    });
});

describe('sanitizeConnections', () => {
    it('drops a Garmin entry left over from Terra (no garmin_user_id)', () => {
        const out = sanitizeConnections({
            'apple-health': { connected_at: '2026-08-01T00:00:00Z' },
            garmin: { connected_at: '2026-08-02T00:00:00Z', terra_user_id: 'a0bb73fd' },
        });
        expect(Object.keys(out)).toEqual(['apple-health']);
    });

    it('keeps a Garmin entry linked by garmin-auth — even while the switch has it paused', () => {
        const linked = { connected_at: '2026-10-19T10:00:00Z', garmin_user_id: 'd3315b10' };
        expect(sanitizeConnections({ garmin: linked })).toEqual({ garmin: linked });
        setGarminDirectAvailable(true);
        expect(sanitizeConnections({ garmin: linked })).toEqual({ garmin: linked });
    });

    it('keeps other Terra wearables that have a terra_user_id', () => {
        const out = sanitizeConnections({
            whoop: { terra_user_id: '38cb14bf' },
            oura: { connected_at: '2026-06-01T00:00:00Z' }, // pre-Terra entry, no id
        });
        expect(Object.keys(out)).toEqual(['whoop']);
    });
});

describe('garminStatusFrom — reading garmin-auth\'s outcome off the return address', () => {
    // Imported here so the provider module loads with the mocks above.
    const { garminStatusFrom } = require('@/lib/health/providers/garminProvider');

    it.each([
        ['powr://garmin-callback?status=connected', 'connected'],
        ['exp://192.168.1.20:8081/--/garmin-callback?status=already_linked', 'already_linked'],
        ['powr://garmin-callback?a=1&status=denied', 'denied'],
        ['powr://garmin-callback', null],
        [null, null],
    ])('%p → %p', (url, status) => {
        expect(garminStatusFrom(url)).toBe(status);
    });
});
