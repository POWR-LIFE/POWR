/**
 * Settings › Distance units (lib/units): 'auto' is exactly the sport × region
 * table everyone had before the setting existed; 'mi' and 'km' put every land
 * sport in that unit; swims stay in metres whatever is picked; and the pick
 * is remembered on the device.
 */

import type AsyncStorageType from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

// The hook test renders with this suite's own React, so it needs the copy of
// lib/units loaded alongside it rather than a fresh one from load().
import * as units from '@/lib/units';

type UnitsModule = typeof import('@/lib/units');

/** A fresh copy of lib/units (its preference is module state) over seeded storage. */
async function load(saved?: string) {
  jest.resetModules();
  const storage: typeof AsyncStorageType = require('@react-native-async-storage/async-storage');
  await storage.clear();
  if (saved !== undefined) await storage.setItem('powr:distanceUnit', saved);
  const units: UnitsModule = require('@/lib/units');
  return { units, storage };
}

const REGIONS = ['GB', 'US', 'IE', 'FR', 'ES', 'NL', 'DE', 'AU', 'CA', 'LR', 'MM', null];
const LAND_SPORTS = ['running', 'cycling', 'walking', 'hiking', 'gym'];

/** The table from before the setting, written out independently of lib/units. */
function previousUnit(type: string, region: string | null): 'km' | 'mi' | 'm' {
  if (type === 'swimming') return 'm';
  if (!region) return 'km';
  if (type === 'cycling') return ['GB', 'US', 'LR', 'MM'].includes(region) ? 'mi' : 'km';
  return ['US', 'LR', 'MM'].includes(region) ? 'mi' : 'km';
}

describe("'auto' (the default)", () => {
  it('starts on auto with nothing saved', async () => {
    const { units } = await load();
    await units.distancePreferenceReady;
    expect(units.getDistancePreference()).toBe('auto');
  });

  it('keeps every sport in every region exactly as before', async () => {
    const { units } = await load();
    await units.distancePreferenceReady;
    for (const region of REGIONS) {
      for (const type of [...LAND_SPORTS, 'swimming']) {
        expect({ type, region, unit: units.distanceUnitFor(type, region) })
          .toEqual({ type, region, unit: previousUnit(type, region) });
      }
    }
  });

  it('formats as before: UK rides in miles, UK runs in km, US runs in miles', async () => {
    const { units } = await load();
    await units.distancePreferenceReady;
    expect(units.formatDistance(81267, 'cycling', 'GB')).toBe('50.5 mi');
    expect(units.formatDistance(10000, 'running', 'GB')).toBe('10.0 km');
    expect(units.formatDistance(10000, 'running', 'US')).toBe('6.2 mi');
    expect(units.speedParts(23.2, 'cycling', 'GB')).toEqual({ value: '14.4', unit: 'mph' });
    expect(units.paceParts(10, 'running', 'GB')).toEqual({ secondsPerUnit: 360, unit: '/km' });
  });

  it('leaves Discover in miles', async () => {
    const { units } = await load();
    expect(units.discoverDistanceUnit()).toBe('mi');
    expect(units.discoverDistanceUnit('auto')).toBe('mi');
    expect(units.discoverDistanceUnit('mi')).toBe('mi');
    expect(units.discoverDistanceUnit('km')).toBe('km');
  });
});

describe("'mi' and 'km'", () => {
  it('puts every land sport in miles, in every region, and swims in metres', async () => {
    const { units } = await load();
    await units.setDistancePreference('mi');
    for (const region of REGIONS) {
      for (const type of LAND_SPORTS) expect(units.distanceUnitFor(type, region)).toBe('mi');
      expect(units.distanceUnitFor('swimming', region)).toBe('m');
    }
    expect(units.formatDistance(10000, 'running', 'FR')).toBe('6.2 mi');
    expect(units.speedParts(23.2, 'cycling', 'FR')).toEqual({ value: '14.4', unit: 'mph' });
    expect(units.paceParts(10, 'running', 'GB').unit).toBe('/mi');
    expect(units.discoverDistanceUnit()).toBe('mi');
  });

  it('puts every land sport in km, in every region, and swims in metres', async () => {
    const { units } = await load();
    await units.setDistancePreference('km');
    for (const region of REGIONS) {
      for (const type of LAND_SPORTS) expect(units.distanceUnitFor(type, region)).toBe('km');
      expect(units.distanceUnitFor('swimming', region)).toBe('m');
    }
    expect(units.formatDistance(81267, 'cycling', 'GB')).toBe('81.3 km');
    expect(units.formatDistance(10000, 'running', 'US')).toBe('10.0 km');
    expect(units.speedParts(23.2, 'cycling', 'US')).toEqual({ value: '23.2', unit: 'km/h' });
    expect(units.paceParts(10, 'running', 'US')).toEqual({ secondsPerUnit: 360, unit: '/km' });
    expect(units.discoverDistanceUnit()).toBe('km');
  });

  it('keeps long swims and sub-kilometre efforts in metres whatever is picked', async () => {
    const { units } = await load();
    for (const pref of ['auto', 'mi', 'km'] as const) {
      await units.setDistancePreference(pref);
      expect(units.formatDistance(2400, 'swimming', 'US')).toBe('2,400 m');
      expect(units.formatDistance(830, 'running', 'GB')).toBe('830 m');
      expect(units.formatDistance(830, 'cycling', 'US')).toBe('830 m');
    }
  });

  it('beats a pinned region, and hands back to it on auto', async () => {
    const { units } = await load();
    units.setRegionOverride('GB');
    await units.setDistancePreference('km');
    expect(units.formatDistance(81267, 'cycling')).toBe('81.3 km');
    await units.setDistancePreference('auto');
    expect(units.formatDistance(81267, 'cycling')).toBe('50.5 mi');
    units.setRegionOverride(undefined);
  });
});

describe('remembering the pick', () => {
  it('saves a pick on the device, and forgets it on auto', async () => {
    const { units, storage } = await load();
    await units.setDistancePreference('km');
    expect(await storage.getItem('powr:distanceUnit')).toBe('km');
    await units.setDistancePreference('mi');
    expect(await storage.getItem('powr:distanceUnit')).toBe('mi');
    await units.setDistancePreference('auto');
    expect(await storage.getItem('powr:distanceUnit')).toBeNull();
  });

  it('reads the saved pick at startup without making anything wait for it', async () => {
    const { units } = await load('km');
    // Storage is async: until it answers, formatters behave as auto.
    expect(units.getDistancePreference()).toBe('auto');
    await units.distancePreferenceReady;
    expect(units.getDistancePreference()).toBe('km');
    expect(units.formatDistance(81267, 'cycling', 'GB')).toBe('81.3 km');
  });

  it('treats anything unrecognised in storage as auto', async () => {
    const { units } = await load('furlongs');
    await units.distancePreferenceReady;
    expect(units.getDistancePreference()).toBe('auto');
  });

  it('never lets a slow startup read undo a pick made in the meantime', async () => {
    const { units } = await load('mi');
    await units.setDistancePreference('km');
    await units.distancePreferenceReady;
    expect(units.getDistancePreference()).toBe('km');
  });
});

describe('useDistancePreference', () => {
  it('re-renders the screen when the pick changes', async () => {
    await units.distancePreferenceReady;
    function Probe() {
      units.useDistancePreference();
      return <Text>{units.formatDistance(81267, 'cycling', 'GB')}</Text>;
    }
    render(<Probe />);
    expect(screen.getByText('50.5 mi')).toBeTruthy();
    await act(() => units.setDistancePreference('km'));
    expect(screen.getByText('81.3 km')).toBeTruthy();
    await act(() => units.setDistancePreference('auto'));
    expect(screen.getByText('50.5 mi')).toBeTruthy();
  });
});
