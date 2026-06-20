/**
 * Tests for the source-of-truth priority rule shared by claim-points
 * (supersedeLowerTrust) and the unit tests: a geofence gym check-in is the
 * authoritative record of that time at the gym and supersedes any overlapping
 * lower-trust wearable/manual WORKOUT, regardless of how the device typed it.
 *
 * Pure, Deno-free module → runs unchanged in the edge function and here.
 */

import {
  geofenceSupersedes,
  windowsOverlap,
  sessionWindowMs,
  type PrioritySession,
} from '@/supabase/functions/_shared/sessionPriority';

// Trust scores mirror the live writers: geofence 0.94 (GeofenceContext),
// wearable workout/sleep 0.85, wearable walking 0.90, manual 0.55 (lib/api).
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

// A 54-minute geofence gym check-in: 18:00 → 18:54.
const checkInStart = Date.UTC(2026, 5, 20, 18, 0, 0);
const geofenceGym: PrioritySession = {
  type: 'gym',
  verification: 'geofence',
  trust_score: 0.94,
  started_at: iso(checkInStart),
  ended_at: iso(checkInStart + 54 * 60 * 1000),
  duration_sec: 54 * 60,
};

const wearable = (type: string, startMs: number, durMin: number, trust = 0.85): PrioritySession => ({
  type,
  verification: 'wearable',
  trust_score: trust,
  started_at: iso(startMs),
  ended_at: iso(startMs + durMin * 60 * 1000),
  duration_sec: durMin * 60,
});

describe('geofenceSupersedes — geofence always wins over wearable/manual', () => {
  it('supersedes an overlapping wearable CYCLING session (the gym bike / spin class)', () => {
    // 99-min cycling starting 18:05 — overlaps the 18:00–18:54 check-in. This is
    // the case the old same-type-only filter missed (cycling !== gym).
    const cycling = wearable('cycling', checkInStart + 5 * 60 * 1000, 99);
    expect(geofenceSupersedes(geofenceGym, cycling)).toBe(true);
  });

  it('supersedes overlapping wearable workouts of any type', () => {
    expect(geofenceSupersedes(geofenceGym, wearable('gym', checkInStart, 54))).toBe(true);
    expect(geofenceSupersedes(geofenceGym, wearable('hiit', checkInStart + 10 * 60 * 1000, 30))).toBe(true);
    expect(geofenceSupersedes(geofenceGym, wearable('yoga', checkInStart, 60))).toBe(true);
    expect(geofenceSupersedes(geofenceGym, wearable('sports', checkInStart + 20 * 60 * 1000, 40))).toBe(true);
  });

  it('supersedes an overlapping MANUAL session (lowest trust)', () => {
    const manual: PrioritySession = {
      type: 'gym', verification: 'manual', trust_score: 0.55,
      started_at: iso(checkInStart + 10 * 60 * 1000),
      ended_at: iso(checkInStart + 40 * 60 * 1000), duration_sec: 30 * 60,
    };
    expect(geofenceSupersedes(geofenceGym, manual)).toBe(true);
  });

  it('does NOT supersede a non-overlapping workout (a separate morning run)', () => {
    const morningRun = wearable('running', checkInStart - 12 * HOUR, 69);
    expect(geofenceSupersedes(geofenceGym, morningRun)).toBe(false);
  });

  it('does NOT supersede daily WALKING even though its window spans the whole day', () => {
    const dayStart = Date.UTC(2026, 5, 20, 0, 0, 0);
    const walking: PrioritySession = {
      type: 'walking', verification: 'wearable', trust_score: 0.90,
      started_at: iso(dayStart), ended_at: iso(dayStart + 23 * HOUR), duration_sec: 0,
    };
    // The windows DO overlap — the protection comes from the type exclusion.
    const [wStart, wEnd] = sessionWindowMs(geofenceGym);
    const [cStart, cEnd] = sessionWindowMs(walking);
    expect(windowsOverlap(wStart, wEnd, cStart, cEnd)).toBe(true);
    expect(geofenceSupersedes(geofenceGym, walking)).toBe(false);
  });

  it('does NOT supersede SLEEP', () => {
    const sleepStart = Date.UTC(2026, 5, 20, 14, 0, 0); // overlaps an 18:00 check-in window edge
    const sleep = wearable('sleep', sleepStart, 555);
    expect(geofenceSupersedes(geofenceGym, sleep)).toBe(false);
  });

  it('does NOT supersede an equal/higher-trust session (another geofence check-in)', () => {
    const otherGeofence: PrioritySession = {
      ...geofenceGym, started_at: iso(checkInStart + 5 * 60 * 1000),
    };
    expect(geofenceSupersedes(geofenceGym, otherGeofence)).toBe(false);
  });

  it('only acts when the WINNER is a geofence check-in', () => {
    const wearableWinner = wearable('gym', checkInStart, 54);
    const overlappingCycling = wearable('cycling', checkInStart + 5 * 60 * 1000, 99);
    // A wearable winner must not use this rule (terra-webhook handles wearable→manual).
    expect(geofenceSupersedes(wearableWinner, overlappingCycling)).toBe(false);
  });
});

describe('windowsOverlap', () => {
  it('is half-open — touching edges do not overlap', () => {
    expect(windowsOverlap(0, 100, 100, 200)).toBe(false);
    expect(windowsOverlap(0, 100, 99, 200)).toBe(true);
    expect(windowsOverlap(50, 60, 0, 100)).toBe(true); // fully contained
  });
});
