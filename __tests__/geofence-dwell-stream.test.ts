/**
 * Regression guard for the background-claim starvation (field failures
 * 2026-07-03, 07-11 and 07-13, all Android).
 *
 * The dwell state machine is purely TIME-based, but it only ever runs from a
 * location callback. Android maps `distanceInterval` to FusedLocation's
 * setSmallestDisplacement, which suppresses callbacks until the device MOVES that
 * far — so a user who checks in and then stands still (i.e. every real gym
 * session) received NO fixes at all: the dwell never advanced and the 30-min claim
 * never fired in the background. It only landed when the app was next opened
 * (t+33 min on 07-03, t+36 min on 07-13, both verified against prod).
 *
 * The OS-side filtering can't be reproduced in Jest, so what is pinned here is the
 * contract that makes ticks arrive at all: while a session is active on Android the
 * stream runs TIME-driven (distanceInterval 0), and it stands back down when the
 * visit ends so we don't burn battery all day.
 *
 * These are deliberately pure-function tests: jest-expo compiles under the iOS
 * platform, so an end-to-end Android assertion would need the Platform module
 * mocked out from under GeofenceContext. The mode rules live in visitStreamMode()
 * precisely so the platform behaviour is testable without that.
 */
import { visitStreamMode, DWELL_LOCATION_OPTIONS } from '@/context/GeofenceContext';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn() }));
jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

describe('visitStreamMode', () => {
  it('runs the time-driven dwell stream while checked in on Android', () => {
    // THE fix: a displacement-gated stream starves the dwell machine of the ticks
    // it needs, and the background claim never fires.
    expect(visitStreamMode('android', { sessionActive: true, approaching: true })).toBe('dwell');
    expect(visitStreamMode('android', { sessionActive: true, approaching: false })).toBe('dwell');
  });

  it('never puts iOS into the dwell stream', () => {
    // distanceInterval 0 on iOS is kCLDistanceFilterNone — a continuous firehose.
    // iOS stays on its approach stream and claims on the region EXIT.
    expect(visitStreamMode('ios', { sessionActive: true, approaching: true })).toBe('approach');
    expect(visitStreamMode('ios', { sessionActive: true, approaching: false })).toBe('off');
  });

  it('stands back down to the platform baseline once the visit ends', () => {
    expect(visitStreamMode('android', { sessionActive: false, approaching: false })).toBe('passive');
    expect(visitStreamMode('ios', { sessionActive: false, approaching: false })).toBe('off');
  });

  it('keeps the approach stream when near a gym but not checked in', () => {
    expect(visitStreamMode('android', { sessionActive: false, approaching: true })).toBe('approach');
    expect(visitStreamMode('ios', { sessionActive: false, approaching: true })).toBe('approach');
  });
});

describe('DWELL_LOCATION_OPTIONS', () => {
  it('is time-driven, so a stationary phone still receives fixes', () => {
    // Any displacement filter here reintroduces the starvation bug: Android would
    // deliver nothing to a user standing still in a gym.
    expect(DWELL_LOCATION_OPTIONS.distanceInterval).toBe(0);
    expect(DWELL_LOCATION_OPTIONS.timeInterval).toBe(60_000);
    // Batching would defer exactly the ticks the dwell machine depends on.
    expect(DWELL_LOCATION_OPTIONS.deferredUpdatesInterval).toBeUndefined();
    // The foreground service must stay up or Android kills the stream outright.
    expect(DWELL_LOCATION_OPTIONS.foregroundService).toBeDefined();
  });
});
