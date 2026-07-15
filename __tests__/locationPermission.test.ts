/**
 * Tests for the location-permission + accuracy telemetry snapshot
 * (lib/locationPermission.ts). The accuracy sample is the only signal that
 * iOS Precise Location is off (permission reads 'always' either way), so the
 * reporting rules around it are load-bearing for geofence support forensics.
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

const mockEq = jest.fn().mockResolvedValue({ error: null });
const mockUpdate = jest.fn((_payload: Record<string, unknown>) => ({ eq: mockEq }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ update: mockUpdate })) },
}));

import { reportLocationPermission } from '@/lib/locationPermission';

const USER_A = 'user-a';

function grantAlways() {
  mockGetForeground.mockResolvedValue({ status: 'granted' });
  mockGetBackground.mockResolvedValue({ status: 'granted' });
}

describe('reportLocationPermission accuracy telemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEq.mockResolvedValue({ error: null });
  });

  it('reports a precise fix alongside an always grant', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 12.4 } });

    await reportLocationPermission(USER_A);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      location_permission: 'always',
      location_accuracy_m: 12,
    }));
  });

  it('surfaces reduced accuracy (Precise Location off) as a large radius', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 2831 } });

    await reportLocationPermission(USER_A);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      location_permission: 'always',
      location_accuracy_m: 2831,
    }));
  });

  it('falls back to a fresh fix when no cached position exists', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue(null);
    mockGetCurrent.mockResolvedValue({ coords: { accuracy: 48 } });

    await reportLocationPermission(USER_A);

    expect(mockGetCurrent).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ location_accuracy_m: 48 }));
  });

  it('omits the accuracy field when granted but no fix is available (keeps previous reading)', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue(null);
    mockGetCurrent.mockRejectedValue(new Error('location services off'));

    await reportLocationPermission(USER_A);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('location_accuracy_m');
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ location_permission: 'always' });
  });

  it('nulls the accuracy when permission is revoked and never samples a fix', async () => {
    mockGetForeground.mockResolvedValue({ status: 'denied' });

    await reportLocationPermission(USER_A);

    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(mockGetCurrent).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      location_permission: 'denied',
      location_accuracy_m: null,
    }));
  });

  it('dedupes repeat snapshots but re-reports when the accuracy bucket flips', async () => {
    grantAlways();
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 15 } });
    await reportLocationPermission(USER_A);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Same level, same bucket (metres jitter) → deduped, no second write.
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 90 } });
    await reportLocationPermission(USER_A);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Precise Location toggled off → bucket flips → new write.
    mockGetLastKnown.mockResolvedValue({ coords: { accuracy: 1900 } });
    await reportLocationPermission(USER_A);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ location_accuracy_m: 1900 }));
  });
});
