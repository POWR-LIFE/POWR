/**
 * The Garmin provider's sign-in and disconnect calls (lib/health/providers/
 * garminProvider). Expo web can't drive these — the screens store their return
 * target in expo-secure-store first, which has no web build — so they're
 * pinned here instead.
 */
const mockInvoke = jest.fn();
const mockOpenAuth = jest.fn();
const mockAwardBonus = jest.fn(async () => {});

jest.mock('@/lib/supabase', () => ({
    supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
    getSessionUser: jest.fn(async () => null),
}));
jest.mock('@/lib/api/points', () => ({ awardBonus: () => mockAwardBonus() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...a) }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `powr://${path}` }));

import { Alert } from 'react-native';

import { createGarminProvider } from '@/lib/health/providers/garminProvider';
import { ALL_PROVIDER_META } from '@/lib/health/providers';

const garmin = () => createGarminProvider(ALL_PROVIDER_META.find(m => m.id === 'garmin')!);

beforeEach(() => {
    mockInvoke.mockReset();
    mockOpenAuth.mockReset();
    mockAwardBonus.mockClear();
});

describe('connect', () => {
    it('asks garmin-auth to start, opens Garmin\'s consent page, and waits for the callback', async () => {
        mockInvoke.mockResolvedValue({ data: { url: 'https://connect.garmin.com/oauth2Confirm?x=1' }, error: null });
        mockOpenAuth.mockResolvedValue({ type: 'success', url: 'powr://garmin-callback?status=connected' });

        await expect(garmin().connect()).resolves.toBe('pending');
        expect(mockInvoke).toHaveBeenCalledWith('garmin-auth', {
            body: { action: 'start', return_to: 'powr://garmin-callback' },
        });
        expect(mockOpenAuth).toHaveBeenCalledWith(
            'https://connect.garmin.com/oauth2Confirm?x=1', 'powr://garmin-callback',
        );
        // jest-expo runs as iOS, where the outcome comes back to this promise.
        expect(mockAwardBonus).toHaveBeenCalledTimes(1);
    });

    it('explains a refusal on iOS rather than failing silently', async () => {
        const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        mockInvoke.mockResolvedValue({ data: { url: 'https://connect.garmin.com/oauth2Confirm' }, error: null });
        mockOpenAuth.mockResolvedValue({ type: 'success', url: 'powr://garmin-callback?status=already_linked' });

        await expect(garmin().connect()).resolves.toBe('pending');
        expect(mockAwardBonus).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
        alert.mockRestore();
    });

    it('says nothing when the user just closes the sign-in sheet', async () => {
        const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        mockInvoke.mockResolvedValue({ data: { url: 'https://connect.garmin.com/oauth2Confirm' }, error: null });
        mockOpenAuth.mockResolvedValue({ type: 'cancel' });

        await expect(garmin().connect()).resolves.toBe('pending');
        expect(alert).not.toHaveBeenCalled();
        alert.mockRestore();
    });

    it('fails when garmin-auth refuses (switch off, or not configured)', async () => {
        mockInvoke.mockResolvedValue({ data: null, error: { message: 'Garmin is not available yet' } });
        await expect(garmin().connect()).resolves.toBe('failed');
        expect(mockOpenAuth).not.toHaveBeenCalled();
    });
});

describe('disconnect', () => {
    it('asks garmin-auth to release the user at Garmin', async () => {
        mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
        await garmin().disconnect();
        expect(mockInvoke).toHaveBeenCalledWith('garmin-auth', { body: { action: 'disconnect' } });
    });
});

describe('data reads', () => {
    it('are not available on-device — Garmin delivers server-side', async () => {
        await expect(garmin().getStepsToday()).rejects.toThrow(/does not implement getStepsToday/);
    });
});
