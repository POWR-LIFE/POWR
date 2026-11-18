// Background work on a signed-out install must not write as anon.
//
// 2026-11-18: one Android install with no session kept waking every 30 minutes
// and sending its writes with only the anon key. supabase-js falls back to anon
// when it has no session, so every write was refused: ~96 "permission denied for
// function log_geofence_region_event" and 49 activity_sessions RLS refusals a
// day. Those writes could never succeed (EXECUTE is authenticated-only; user_id
// defaults to auth.uid()), so the fix is to not send them.

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockGetSessionUser = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getSession: async () => {
        const user = await mockGetSessionUser();
        return { data: { session: user ? { user } : null }, error: null };
      },
    },
  },
  getSessionUser: () => mockGetSessionUser(),
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}));

// The ticket and persisted-token transports are covered by device-wake-ticket;
// here neither exists, which is the state that reached supabase-js.
jest.mock('@/lib/backgroundRest', () => ({
  readDeviceTicket: jest.fn().mockResolvedValue(null),
  readBackgroundAuth: jest.fn().mockResolvedValue(null),
  ticketRpc: jest.fn(),
  bgRpc: jest.fn(),
  isTicketRejection: jest.fn().mockReturnValue(false),
}));

jest.mock('@/lib/authFresh', () => ({
  callWithAuthRetry: (make: () => unknown) => make(),
}));

const mockLogHealthWalkingSession = jest.fn();
jest.mock('@/lib/api/activity', () => ({
  ...jest.requireActual('@/lib/api/activity'),
  logHealthWalkingSession: (...args: unknown[]) => mockLogHealthWalkingSession(...args),
}));

// A real step count, so a signed-out sync would get past the zero-steps exit and
// reach the writes — otherwise the walking tests pass without proving anything.
jest.mock('@kingstinct/react-native-healthkit', () => ({
  queryStatisticsForQuantity: jest.fn().mockResolvedValue({ sumQuantity: { quantity: 5000 } }),
  queryQuantitySamples: jest.fn().mockResolvedValue([]),
}), { virtual: true });

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

import { AppState } from 'react-native';
import { logGeofenceRegionEvent } from '@/lib/gymVisits';
import { backfillWalkingDays, syncWalkingNow } from '@/lib/health/walkingSync';

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockFrom.mockReset();
  mockGetSessionUser.mockReset();
  mockLogHealthWalkingSession.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

// jest-expo stubs AppState.currentState as a plain property, so set it directly.
const initialAppState = AppState.currentState;
function setAppState(state: string): void {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true });
}
afterAll(() => { setAppState(initialAppState as unknown as string); });

describe('logGeofenceRegionEvent without a session', () => {
  it.each(['background', 'active'])('sends nothing when signed out (%s)', async (state) => {
    setAppState(state);
    mockGetSessionUser.mockResolvedValue(null);

    await logGeofenceRegionEvent('region-1', 'wake_received');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('still logs through supabase-js when signed in', async () => {
    setAppState('active');
    mockGetSessionUser.mockResolvedValue({ id: 'user-123' });

    await logGeofenceRegionEvent('region-1', 'wake_received', { via: 'test' });

    expect(mockRpc).toHaveBeenCalledWith('log_geofence_region_event', expect.objectContaining({
      p_region_id: 'region-1',
      p_event: 'wake_received',
    }));
  });

  it('never rejects when the session read fails', async () => {
    setAppState('active');
    mockGetSessionUser.mockRejectedValue(new Error('keychain locked'));

    await expect(logGeofenceRegionEvent('region-1', 'wake_received')).resolves.toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('walking sync without a session', () => {
  it('syncWalkingNow writes nothing when signed out', async () => {
    mockGetSessionUser.mockResolvedValue(null);

    await syncWalkingNow();

    expect(mockLogHealthWalkingSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('backfillWalkingDays writes nothing when signed out, and retries after sign-in', async () => {
    mockGetSessionUser.mockResolvedValue(null);

    await backfillWalkingDays();

    expect(mockLogHealthWalkingSession).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    const readsWhileSignedOut = mockGetSessionUser.mock.calls.length;

    // Signed in: the day gate must have been reset, so the backfill runs again
    // (it reads the session past the guard instead of returning on the gate).
    mockGetSessionUser.mockResolvedValue({ id: 'user-123' });
    await backfillWalkingDays();

    expect(mockGetSessionUser.mock.calls.length).toBeGreaterThan(readsWhileSignedOut);
  });
});
