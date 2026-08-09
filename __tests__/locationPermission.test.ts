/**
 * Tests for the location-permission + accuracy telemetry snapshot
 * (lib/locationPermission.ts). The accuracy sample is the only signal that
 * iOS Precise Location is off (permission reads 'always' either way), so the
 * reporting rules around it are load-bearing for geofence support forensics.
 *
 * The write goes through the record_location_permission RPC rather than a bare
 * UPDATE on profiles, so the same call also appends to
 * location_permission_events when the LEVEL changed — the only way the server
 * can see a user drop out of 'always'. One consequence is asserted throughout:
 * "no fix available" is now sent as an explicit null and the keep-the-previous-
 * reading rule lives in SQL, so the client no longer omits the argument.
 */

const mockGetForeground = jest.fn();
const mockGetBackground = jest.fn();
const mockGetLastKnown = jest.fn();
const mockGetCurrent = jest.fn();

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...a: unknown[]) => mockGetForeground(...a),
  getBackgroundPermissionsAsync: (...a: unknown[]) => mockGetBackground(...a),
  getLastKnownPositionAsync: (...a: unknown[]) => mockGetLastKnown(...a),
  getCurrentPositionAsync: (...a: unknown[]) => mockGetCurrent(...a),
  Accuracy: { Balanced: 3 },
}));

const mockRpc = jest.fn().mockResolvedValue({ error: null });
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

import { reportLocationPermission } from '@/lib/locationPermission';

const USER_A = 'user-a';

function grantAlways() {
  mockGetForeground.mockResolvedValue({ status: 'granted' });
  mockGetBackground.mockResolvedValue({ status: 'granted' });
}

/** The args of the Nth (0-indexed) RPC call's payload. */
const payload = (n = 0) => mockRpc.mock.calls[n][1];

describe('reportLocationPermission accuracy telemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
  });

  it('reports a precise fix alongside an always grant', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 12.4 } });

    await reportLocationPermission(USER_A);

    expect(mockRpc).toHaveBeenCalledWith('record_location_permission', {
      p_level: 'always',
      p_accuracy_m: 12,
    });
  });

  it('surfaces reduced accuracy (Precise Location off) as a large radius', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 2831 } });

    await reportLocationPermission(USER_A);

    expect(payload()).toMatchObject({ p_level: 'always', p_accuracy_m: 2831 });
  });

  it('falls back to a fresh fix when no cached position exists', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue(null);
    mockGetCurrent.mockResolvedValue({ coords: { accuracy: 48 } });

    await reportLocationPermission(USER_A);

    expect(mockGetCurrent).toHaveBeenCalled();
    expect(payload()).toMatchObject({ p_accuracy_m: 48 });
  });

  it('sends a null accuracy when granted but no fix is available', async () => {
    // The "keep the previous reading" half of this rule is now enforced in
    // record_location_permission: a null on a GRANTED level leaves the stored
    // value alone, so a transient sampling miss still cannot erase real signal.
    grantAlways();
    mockGetLastKnown.mockResolvedValue(null);
    mockGetCurrent.mockRejectedValue(new Error('location services off'));

    await reportLocationPermission(USER_A);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(payload()).toEqual({ p_level: 'always', p_accuracy_m: null });
  });

  it('nulls the accuracy when permission is revoked and never samples a fix', async () => {
    mockGetForeground.mockResolvedValue({ status: 'denied' });

    await reportLocationPermission(USER_A);

    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(mockGetCurrent).not.toHaveBeenCalled();
    expect(payload()).toMatchObject({ p_level: 'denied', p_accuracy_m: null });
  });

  it('dedupes repeat snapshots but re-reports when the accuracy bucket flips', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 15 } });
    await reportLocationPermission(USER_A);
    expect(mockRpc).toHaveBeenCalledTimes(1);

    // Same level, same bucket (metres jitter) → deduped, no second write.
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 90 } });
    await reportLocationPermission(USER_A);
    expect(mockRpc).toHaveBeenCalledTimes(1);

    // Precise Location toggled off → bucket flips → new write.
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 1900 } });
    await reportLocationPermission(USER_A);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(payload(1)).toMatchObject({ p_accuracy_m: 1900 });
  });

  it('does not mark the snapshot reported when the RPC errors, so the next call retries', async () => {
    // The in-process dedupe must not latch on a failed write — otherwise one
    // transient error pins a stale level for the rest of the process's life.
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 20 } });
    mockRpc.mockResolvedValueOnce({ error: { message: 'boom' } });

    await reportLocationPermission(USER_A);
    await reportLocationPermission(USER_A);

    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});
