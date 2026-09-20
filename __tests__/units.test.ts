/**
 * Tests for lib/units — the sport × region distance unit table and the
 * figures derived from it.
 */

import { distanceParts, distanceUnitFor, formatDistance, paceParts, speedParts } from '@/lib/units';

describe('distanceUnitFor', () => {
  it('rides in miles in the UK and US, km elsewhere', () => {
    expect(distanceUnitFor('cycling', 'GB')).toBe('mi');
    expect(distanceUnitFor('cycling', 'US')).toBe('mi');
    expect(distanceUnitFor('cycling', 'ES')).toBe('km');
  });

  it('runs in km in the UK, miles only in the US', () => {
    expect(distanceUnitFor('running', 'GB')).toBe('km');
    expect(distanceUnitFor('running', 'US')).toBe('mi');
    expect(distanceUnitFor('walking', 'GB')).toBe('km');
  });

  it('swims in metres everywhere', () => {
    expect(distanceUnitFor('swimming', 'US')).toBe('m');
    expect(distanceUnitFor('swimming', 'GB')).toBe('m');
  });

  it('falls back to km when the region is unknown', () => {
    expect(distanceUnitFor('cycling', null)).toBe('km');
  });
});

describe('distanceParts / formatDistance', () => {
  it('converts a ride to miles for a UK reader', () => {
    expect(formatDistance(81267, 'cycling', 'GB')).toBe('50.5 mi');
    expect(formatDistance(81267, 'cycling', 'NL')).toBe('81.3 km');
  });

  it('keeps sub-kilometre efforts in metres in every region', () => {
    expect(formatDistance(830, 'running', 'US')).toBe('830 m');
    expect(formatDistance(830, 'cycling', 'GB')).toBe('830 m');
  });

  it('keeps long swims in metres with a thousands separator', () => {
    expect(distanceParts(2400, 'swimming', 'GB')).toEqual({ value: '2,400', unit: 'm' });
  });

  it('rounds to whole numbers from 100', () => {
    expect(formatDistance(125459, 'cycling', 'ES')).toBe('125 km');
  });
});

describe('speedParts / paceParts', () => {
  it('shows cycling speed in mph where rides are in miles', () => {
    expect(speedParts(23.2, 'cycling', 'GB')).toEqual({ value: '14.4', unit: 'mph' });
    expect(speedParts(23.2, 'cycling', 'FR')).toEqual({ value: '23.2', unit: 'km/h' });
  });

  it('paces a UK run per km and a US run per mile', () => {
    expect(paceParts(10, 'running', 'GB')).toEqual({ secondsPerUnit: 360, unit: '/km' });
    const us = paceParts(10, 'running', 'US');
    expect(us.unit).toBe('/mi');
    expect(Math.round(us.secondsPerUnit)).toBe(579);
  });
});
