/**
 * Settings › Distance units: three choices, Automatic ticked until the member
 * picks, and a pick that takes effect at once and is saved on the device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Ionicons: (p: any) => React.createElement(Text, null, `icon:${p.name}`) };
});
jest.mock('@/components/GeometricBackground', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import DistanceUnitsScreen from '@/app/distance-units';
import { formatDistance, getDistancePreference, setDistancePreference } from '@/lib/units';

afterEach(async () => { await act(() => setDistancePreference('auto')); });

const ticked = () => screen.getAllByRole('radio').map(r => r.props.accessibilityState?.selected === true);

it('offers Automatic, Miles and Kilometres, with Automatic ticked by default', () => {
  render(<DistanceUnitsScreen />);
  expect(screen.getByText('Distance units')).toBeTruthy();
  expect(screen.getByText("Automatic uses miles on Discover and your region's usual units for workouts.")).toBeTruthy();
  expect(screen.getByText('Swims always stay in metres.')).toBeTruthy();
  expect(ticked()).toEqual([true, false, false]);
  expect(screen.getByText('mi · mph')).toBeTruthy();
  expect(screen.getByText('km · km/h')).toBeTruthy();
});

it('applies a pick straight away and saves it', async () => {
  render(<DistanceUnitsScreen />);
  await act(async () => { fireEvent.press(screen.getByText('Kilometres')); });
  expect(getDistancePreference()).toBe('km');
  expect(await AsyncStorage.getItem('powr:distanceUnit')).toBe('km');
  expect(formatDistance(81267, 'cycling', 'GB')).toBe('81.3 km');
  expect(ticked()).toEqual([false, false, true]);

  await act(async () => { fireEvent.press(screen.getByText('Automatic')); });
  expect(getDistancePreference()).toBe('auto');
  expect(await AsyncStorage.getItem('powr:distanceUnit')).toBeNull();
  expect(formatDistance(81267, 'cycling', 'GB')).toBe('50.5 mi');
  expect(ticked()).toEqual([true, false, false]);
});
