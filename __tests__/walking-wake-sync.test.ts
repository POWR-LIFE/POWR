/**
 * syncWalkingFromWake rides the geofence beacon's ~5-6 minute wake, which is the
 * only recurring execution this app reliably gets (BackgroundFetch has never
 * delivered a walking row — proven 2026-08-08). That makes the throttle the whole
 * safety story: without it every wake would trigger a health-store read and a
 * Supabase round-trip on a path whose one rule is that nothing may jeopardise the
 * check-in.
 *
 * Asserted through the stamp rather than by spying on syncWalkingNow: the call is
 * module-internal, so a spy on the export never intercepts it and the test would
 * pass while proving nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-background-fetch', () => ({
    registerTaskAsync: jest.fn(),
    getStatusAsync: jest.fn(),
    BackgroundFetchStatus: { Restricted: 1, Denied: 2 },
    BackgroundFetchResult: { NewData: 1, Failed: 3 },
}));
jest.mock('expo-task-manager', () => ({
    defineTask: jest.fn(),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
}));
// Make the underlying read fail immediately and loudly. The point of these tests
// is that the gate holds and the failure stays contained — not what the read does.
jest.mock('@/lib/supabase', () => ({
    supabase: {},
    getSessionUser: jest.fn().mockRejectedValue(new Error('no session in test')),
}));

const WAKE_SYNC_KEY = '@powr/walking_wake_sync_at';

describe('syncWalkingFromWake', () => {
    let syncWalkingFromWake: () => Promise<void>;

    beforeEach(async () => {
        jest.clearAllMocks();
        await AsyncStorage.clear();
        ({ syncWalkingFromWake } = await import('@/lib/health/walkingSync'));
    });

    it('never rejects, even though the read underneath fails', async () => {
        await expect(syncWalkingFromWake()).resolves.toBeUndefined();
    });

    it('stamps the throttle on the first wake', async () => {
        await syncWalkingFromWake();
        const stamped = Number(await AsyncStorage.getItem(WAKE_SYNC_KEY));
        expect(Number.isFinite(stamped)).toBe(true);
        expect(Date.now() - stamped).toBeLessThan(60_000);
    });

    it('stamps BEFORE the read, so a throwing read still closes the gate', async () => {
        // getSessionUser rejects, so the read never completes — the stamp must
        // exist anyway or every subsequent wake piles into a failing read.
        await syncWalkingFromWake();
        expect(await AsyncStorage.getItem(WAKE_SYNC_KEY)).not.toBeNull();
    });

    it('skips a second wake inside the 30-minute window', async () => {
        await syncWalkingFromWake();
        const first = await AsyncStorage.getItem(WAKE_SYNC_KEY);
        await new Promise(r => setTimeout(r, 5));
        await syncWalkingFromWake();
        // An unchanged stamp is the observable proof the gate short-circuited.
        expect(await AsyncStorage.getItem(WAKE_SYNC_KEY)).toBe(first);
    });

    it('runs again once the window has passed', async () => {
        const stale = Date.now() - 31 * 60 * 1000;
        await AsyncStorage.setItem(WAKE_SYNC_KEY, String(stale));
        await syncWalkingFromWake();
        const stamped = Number(await AsyncStorage.getItem(WAKE_SYNC_KEY));
        expect(stamped).toBeGreaterThan(stale);
        expect(Date.now() - stamped).toBeLessThan(60_000);
    });

    it('treats a corrupted stamp as due rather than wedging forever', async () => {
        await AsyncStorage.setItem(WAKE_SYNC_KEY, 'not-a-number');
        await syncWalkingFromWake();
        const stamped = Number(await AsyncStorage.getItem(WAKE_SYNC_KEY));
        expect(Number.isFinite(stamped)).toBe(true);
    });
});
