/**
 * Discover's place distances follow Settings › Distance units: miles under
 * Automatic (as they always were) and Miles, kilometres under Kilometres, with
 * the max-distance chips on a km ladder of their own (2 / 5 / 10 / 25 km) that
 * still filters on the true distance.
 *
 * The screen is a 2.8k-line map tab, so everything around it (map, location,
 * the geofence provider) is stubbed down to what the list needs.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Ionicons: (p: any) => React.createElement(Text, null, `icon:${p.name}`) };
});
jest.mock('@/components/HeaderActions', () => ({ HeaderActions: () => null }));
jest.mock('@/components/home/GeometricBackground', () => ({ GeometricBackground: () => null }));
jest.mock('@/components/PermissionFixScreen', () => ({ __esModule: true, default: () => null }));

// Gyms due north of the member, at these distances in km (1° of latitude is
// 111.195 km on the 6371 km sphere both haversines use).
const mockKm = [0.05, 0.8, 1.6, 1.99, 3.2, 4.99, 8.05, 9.99, 16.1, 24.99, 40.2];
const mockPartners = mockKm.map((km, i) => ({
  id: `p${i}-0`, dbId: `p${i}`, name: `Gym ${String(i).padStart(2, '0')}`, category: 'Gym', status: 'active',
  address: `${i} Road`, area: 'London', pts: 10 + i, distance: '', logoText: `G${i}`, logoBg: 'dark', logoLight: false,
  lat: 51.5074 + km / 111.195, lng: -0.1278, geofenceRadius: 100, isOpenNow: true,
}));
jest.mock('@/context/GeofenceContext', () => ({
  fetchPartnersInArea: jest.fn(async () => []),
  getPartnerGeometry: jest.fn(async () => []),
  searchPartners: jest.fn(async () => []),
  useGeofenceContext: () => ({ partners: mockPartners, refresh: jest.fn(async () => {}), ensureCoverage: jest.fn(async () => {}) }),
}));
jest.mock('@/hooks/useActiveGeofence', () => ({ useActiveGeofence: () => ({ activeGeofence: null }) }));
jest.mock('@/lib/api/gyms', () => ({ createGymRequest: jest.fn() }));
jest.mock('@/lib/locationPrompt', () => ({
  getLocationPromptState: jest.fn(async () => ({})), isForegroundMissing: jest.fn(async () => false),
  isWhileUsingOnly: jest.fn(async () => false), recordForegroundPromptDismissed: jest.fn(async () => {}),
  recordForegroundPromptShown: jest.fn(async () => {}), shouldShowForegroundPrompt: () => false,
}));
jest.mock('@/lib/mapProvider', () => ({ GOOGLE_DIRECTIONS_KEY: '', MAP_PROVIDER: undefined }));
jest.mock('@/lib/supabase', () => ({ getSessionUser: jest.fn(async () => null), supabase: {} }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: any) => children ?? null }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 51.5074, longitude: -0.1278 } })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  watchPositionAsync: jest.fn(async () => ({ remove() {} })),
  Accuracy: { Balanced: 3, High: 4, BestForNavigation: 6 },
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: any) => React.useEffect(() => cb(), [cb]),
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  };
});
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef(function MapView(p: any, ref: any) {
    React.useImperativeHandle(ref, () => ({ animateToRegion() {}, animateCamera() {}, fitToCoordinates() {} }));
    return React.createElement(View, { testID: 'map' }, p.children);
  });
  return { __esModule: true, default: MapView, Circle: () => null, Marker: () => null, Polyline: () => null };
});
jest.mock('react-native-maps-directions', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import Discover from '@/app/(tabs)/discover';
import { setDistancePreference } from '@/lib/units';

// The map's markers settle on a timer outside act(); that warning isn't under test.
const realError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
    realError(...args);
  });
});
afterEach(async () => { await act(() => setDistancePreference('auto')); });

const distances = () => screen.getAllByText(/ (mi|km)$/).map(n => n.props.children as string);
const gymsListed = () => [...new Set(screen.getAllByText(/^Gym \d\d$/).map(n => n.props.children as string))];

async function openDiscover() {
  const view = render(<Discover />);
  await waitFor(() => expect(screen.getAllByText(/^(< )?\d+\.\d (mi|km)$/).length).toBe(mockKm.length));
  return view;
}

it('shows miles under Automatic, nearest first, with the mile chips', async () => {
  await openDiscover();
  expect(distances()).toEqual([
    '< 0.1 mi', '0.5 mi', '1.0 mi', '1.2 mi', '2.0 mi', '3.1 mi', '5.0 mi', '6.2 mi', '10.0 mi', '15.5 mi', '25.0 mi',
  ]);
  fireEvent.press(screen.getByText('Filters'));
  for (const chip of ['Any', '1 mi', '5 mi', '10 mi', '25 mi']) expect(screen.getByText(chip)).toBeTruthy();
  expect(screen.queryByText('2 km')).toBeNull();
});

it('shows kilometres when picked, with no miles left on screen', async () => {
  await act(() => setDistancePreference('km'));
  await openDiscover();
  expect(distances()).toEqual([
    '< 0.1 km', '0.8 km', '1.6 km', '2.0 km', '3.2 km', '5.0 km', '8.1 km', '10.0 km', '16.1 km', '25.0 km', '40.2 km',
  ]);
  fireEvent.press(screen.getByText('Filters'));
  for (const chip of ['Any', '2 km', '5 km', '10 km', '25 km']) expect(screen.getByText(chip)).toBeTruthy();
  expect(screen.queryAllByText(/ mi$/)).toHaveLength(0);
});

it('filters on the true distance with the km chips', async () => {
  await act(() => setDistancePreference('km'));
  await openDiscover();
  fireEvent.press(screen.getByText('Filters'));
  fireEvent.press(screen.getByText('2 km'));
  expect(gymsListed()).toEqual(['Gym 00', 'Gym 01', 'Gym 02', 'Gym 03']);
  fireEvent.press(screen.getByText('5 km'));
  expect(gymsListed()).toEqual(['Gym 00', 'Gym 01', 'Gym 02', 'Gym 03', 'Gym 04', 'Gym 05']);
  fireEvent.press(screen.getByText('25 km'));
  expect(gymsListed()).toHaveLength(10);
});

it('drops a km pick when the setting goes back to miles, rather than filtering by an unseen chip', async () => {
  await act(() => setDistancePreference('km'));
  await openDiscover();
  fireEvent.press(screen.getByText('Filters'));
  fireEvent.press(screen.getByText('2 km'));
  expect(gymsListed()).toHaveLength(4);
  await act(() => setDistancePreference('auto'));
  expect(gymsListed()).toHaveLength(mockKm.length);
  expect(screen.getByText('1 mi')).toBeTruthy();
});
