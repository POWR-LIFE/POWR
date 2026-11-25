/**
 * ONE rule for where a member is relative to a venue (lib/geofence/zone.ts).
 *
 * Review 2026-11-25. The engine had three meanings of "inside" — check-in at the
 * radius, proof at radius + the fix's whole error bar, leaving at radius + 50 —
 * so a member could stand where they could neither prove presence nor leave, and
 * a blurry fix proved more than a sharp one. Check-in also took the FIRST venue
 * the loop reached, on ONE reading of any age.
 *
 * What this file pins:
 *   1. the three bands meet with no gap and no overlap;
 *   2. blur no longer buys proof range;
 *   3. the NEAREST venue wins, on every device, whatever the map order;
 *   4. one reading is never a check-in, and the same reading twice is still one;
 *   5. a resumed visit never bills the time away.
 */
import {
  ENTRY_BACKDATE_CAP_MS,
  ENTRY_CANDIDATE_TTL_MS,
  ENTRY_CONFIRM_MIN_GAP_MS,
  ENTRY_CONFIRM_MIN_GAP_WAKE_MS,
  ENTRY_FIX_MAX_AGE_MS,
  ENTRY_MAX_SPEED_MPS,
  RESUME_WINDOW_MS,
  entryDecision,
  PIN_OFFSET_MAX_DISTANCE_M,
  goneBoundM,
  pinOffsetM,
  proofBoundM,
  resumedStartMs,
  scanForEntry,
  venueBand,
  type EntryCandidate,
} from '@/lib/geofence/zone';
import { exitBoundM, fixCreditsPresence, nearKeepsVisitOpen } from '@/lib/health/gymPresence';

// One degree of latitude is ~111,195 m, so this many degrees is `m` metres north.
const north = (m: number) => m / 111_195;
const GYM = { lat: 51.5, lng: -0.12, radius: 25 };
const at = (metresNorth: number) => ({ latitude: GYM.lat + north(metresNorth), longitude: GYM.lng });

describe('venueBand — three bands, no gap', () => {
  it('a sharp fix inside the circle proves presence', () => {
    expect(venueBand(18, 25, 8)).toBe('inside');
  });

  it('the proof bound grows with the error bar only up to the cap', () => {
    expect(proofBoundM(25, 10)).toBe(35);
    expect(proofBoundM(25, 30)).toBe(55);
    expect(proofBoundM(25, 99)).toBe(55);   // was 124 — blur bought 69 m of range
    expect(proofBoundM(25, null)).toBe(25);
  });

  it('a blurry fix no longer proves from further out than a sharp one could reach', () => {
    // 80 m from a 25 m pin on a 99 m fix: the old rule (radius + accuracy) said present.
    expect(venueBand(80, 25, 99)).toBe('near');
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 80, radiusM: 25, accuracyM: 99, fixAgeMs: 0 })).toBe(false);
  });

  it('the ONE LDN case: 37 m from a 30 m pin on a 5 m fix is near, not gone and not proof', () => {
    expect(venueBand(37, 30, 5)).toBe('near');
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 37, radiusM: 30, accuracyM: 5, fixAgeMs: 0 })).toBe(false);
    expect(nearKeepsVisitOpen({ fixTrusted: true, distanceM: 37, radiusM: 30, accuracyM: 5, fixAgeMs: 0 })).toBe(true);
  });

  it('near ends exactly where the exit test begins', () => {
    for (const acc of [null, 0, 5, 20, 30, 60, 99]) {
      expect(goneBoundM(25, acc)).toBe(exitBoundM(25, 50, acc));
    }
    expect(venueBand(goneBoundM(25, 10), 25, 10)).toBe('near');
    expect(venueBand(goneBoundM(25, 10) + 0.01, 25, 10)).toBe('gone');
  });

  it('every distance lands in exactly one band, in order', () => {
    let last = 'inside';
    const rank = { inside: 0, near: 1, gone: 2 } as const;
    for (let d = 0; d <= 200; d += 1) {
      const b = venueBand(d, 25, 12);
      expect(rank[b]).toBeGreaterThanOrEqual(rank[last as keyof typeof rank]);
      last = b;
    }
    expect(last).toBe('gone');
  });

  it('a stale or untrusted reading keeps nothing open', () => {
    expect(nearKeepsVisitOpen({ fixTrusted: false, distanceM: 40, radiusM: 25, accuracyM: 150 })).toBe(false);
    expect(nearKeepsVisitOpen({ fixTrusted: true, distanceM: 40, radiusM: 25, accuracyM: 10, fixAgeMs: 5 * 60_000 })).toBe(false);
    expect(nearKeepsVisitOpen({ fixTrusted: true, distanceM: 200, radiusM: 25, accuracyM: 10, fixAgeMs: 0 })).toBe(false);
  });
});

describe('scanForEntry — the nearest venue wins', () => {
  it('returns no match outside every circle, but still names the nearest', () => {
    const scan = scanForEntry({ 'a-0': GYM }, at(60), 120);
    expect(scan.match).toBeNull();
    expect(scan.nearestId).toBe('a-0');
    expect(Math.round(scan.nearestM!)).toBe(60);
    expect(scan.withinApproach).toBe(true);
    expect(scan.scanned).toBe(1);
  });

  it('check-in is the exact radius: 25 m means 25 m', () => {
    expect(scanForEntry({ 'a-0': GYM }, at(24), 120).match?.regionId).toBe('a-0');
    expect(scanForEntry({ 'a-0': GYM }, at(26), 120).match).toBeNull();
  });

  it('picks the nearer of two overlapping venues whatever order the map lists them in', () => {
    // Two gyms 30 m apart, both 25 m circles; the member stands 8 m from B.
    const A = { lat: GYM.lat, lng: GYM.lng, radius: 25 };
    const B = { lat: GYM.lat + north(30), lng: GYM.lng, radius: 25 };
    const fix = at(22);
    // The old loop returned whichever key came first.
    expect(scanForEntry({ 'a-0': A, 'b-0': B }, fix, 120).match?.regionId).toBe('b-0');
    expect(scanForEntry({ 'b-0': B, 'a-0': A }, fix, 120).match?.regionId).toBe('b-0');
  });

  it('breaks an exact tie the same way on every device: smaller circle, then lower id', () => {
    const big = { lat: GYM.lat, lng: GYM.lng, radius: 40 };
    const small = { lat: GYM.lat, lng: GYM.lng, radius: 25 };
    expect(scanForEntry({ 'z-0': big, 'y-0': small }, at(5), 120).match?.regionId).toBe('y-0');
    expect(scanForEntry({ 'q-0': small, 'c-0': small }, at(5), 120).match?.regionId).toBe('c-0');
    expect(scanForEntry({ 'c-0': small, 'q-0': small }, at(5), 120).match?.regionId).toBe('c-0');
  });

  it('skips entries with no usable geometry', () => {
    const scan = scanForEntry({ 'x-0': { lat: null, lng: null, radius: 25 }, 'a-0': GYM }, at(3), 120);
    expect(scan.scanned).toBe(1);
    expect(scan.match?.regionId).toBe('a-0');
  });
});

describe('entryDecision — one reading is never a check-in', () => {
  const NOW = 1_800_000_000_000;
  const first = (ageMs: number): EntryCandidate => ({
    regionId: 'a-0', firstSeenAtMs: NOW - ageMs, lastSeenAtMs: NOW - ageMs, readings: 1,
  });

  it('the first inside reading is remembered, not acted on', () => {
    const d = entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate: null });
    expect(d.verdict).toBe('candidate');
    expect(d.candidate).toEqual({ regionId: 'a-0', firstSeenAtMs: NOW, lastSeenAtMs: NOW, readings: 1 });
  });

  it('a second reading after the gap opens the visit, starting at the FIRST', () => {
    const d = entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate: first(ENTRY_CONFIRM_MIN_GAP_MS) });
    expect(d.verdict).toBe('enter');
    expect(d.startAtMs).toBe(NOW - ENTRY_CONFIRM_MIN_GAP_MS);
    expect(d.candidate).toBeNull();
  });

  it('a second reading too soon keeps waiting', () => {
    const d = entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate: first(ENTRY_CONFIRM_MIN_GAP_MS - 1_000) });
    expect(d.verdict).toBe('candidate');
    expect(d.candidate?.readings).toBe(2);
    expect(d.candidate?.firstSeenAtMs).toBe(NOW - ENTRY_CONFIRM_MIN_GAP_MS + 1_000);
  });

  it('the SAME fix read twice is one reading — a cache cannot corroborate itself', () => {
    // 45 s of wall clock pass, but the poll is handed the identical cached fix.
    const cached = NOW - 45_000;
    const d = entryDecision({
      regionId: 'a-0', fixAtMs: cached, nowMs: NOW,
      candidate: { regionId: 'a-0', firstSeenAtMs: cached, lastSeenAtMs: cached, readings: 1 },
    });
    expect(d.verdict).toBe('candidate');
    expect(d.candidate?.readings).toBe(1);
  });

  it('a reading older than the limit describes the past and is refused outright', () => {
    const d = entryDecision({
      regionId: 'a-0', fixAtMs: NOW - ENTRY_FIX_MAX_AGE_MS - 1, nowMs: NOW, candidate: first(120_000),
    });
    expect(d.verdict).toBe('stale');
    expect(d.candidate).toEqual(first(120_000)); // the stored first reading is untouched
  });

  it('vehicle speed is refused; an unknown speed is not held against the reading', () => {
    const fast = entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, speedMps: ENTRY_MAX_SPEED_MPS + 0.1, candidate: first(40_000) });
    expect(fast.verdict).toBe('too_fast');
    for (const speedMps of [-1, null, undefined, 0, 1.4, ENTRY_MAX_SPEED_MPS]) {
      expect(entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, speedMps, candidate: first(40_000) }).verdict).toBe('enter');
    }
  });

  it('a reading at a DIFFERENT venue starts over rather than confirming the first', () => {
    const d = entryDecision({ regionId: 'b-0', fixAtMs: NOW, nowMs: NOW, candidate: first(40_000) });
    expect(d.verdict).toBe('candidate');
    expect(d.candidate).toEqual({ regionId: 'b-0', firstSeenAtMs: NOW, lastSeenAtMs: NOW, readings: 1 });
  });

  it('a first reading past its lifetime no longer vouches for anything', () => {
    const d = entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate: first(ENTRY_CANDIDATE_TTL_MS + 1) });
    expect(d.verdict).toBe('candidate');
    expect(d.candidate?.firstSeenAtMs).toBe(NOW);
  });

  it('the start is never backdated further than the cap', () => {
    // Readings 8 minutes apart, the candidate kept alive by one in between.
    const candidate: EntryCandidate = {
      regionId: 'a-0', firstSeenAtMs: NOW - 8 * 60_000, lastSeenAtMs: NOW - 2 * 60_000, readings: 2,
    };
    const d = entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate });
    expect(d.verdict).toBe('enter');
    expect(d.startAtMs).toBe(NOW - ENTRY_BACKDATE_CAP_MS);
  });

  it('a server wake confirms on the shorter gap; nothing else does', () => {
    const candidate = first(ENTRY_CONFIRM_MIN_GAP_WAKE_MS);
    expect(entryDecision({ regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate }).verdict).toBe('candidate');
    expect(entryDecision({
      regionId: 'a-0', fixAtMs: NOW, nowMs: NOW, candidate, minGapMs: ENTRY_CONFIRM_MIN_GAP_WAKE_MS,
    }).verdict).toBe('enter');
  });

  it('an unknown fix time counts as now', () => {
    expect(entryDecision({ regionId: 'a-0', fixAtMs: null, nowMs: NOW, candidate: first(40_000) }).verdict).toBe('enter');
    expect(entryDecision({ regionId: 'a-0', fixAtMs: null, nowMs: NOW, candidate: null }).candidate?.firstSeenAtMs).toBe(NOW);
  });

  it('a late-delivered older fix never rewinds the stored first reading', () => {
    const candidate = first(5_000);
    const d = entryDecision({ regionId: 'a-0', fixAtMs: NOW - 20_000, nowMs: NOW, candidate });
    expect(d.verdict).toBe('candidate');
    expect(d.candidate).toEqual(candidate);
  });
});

describe('resumedStartMs — a re-entry minutes later is the same visit', () => {
  const T0 = 1_800_000_000_000;
  const min = 60_000;
  // The 2026-11-16 shape: 24 minutes, a false exit, back 12 minutes later.
  const closed = { partnerId: 'p-1', entryTimestamp: T0, endedAtMs: T0 + 24 * min, userId: 'u-1' };

  it('moves the start forward by exactly the time away — the gap is never billed', () => {
    const start = resumedStartMs(closed, { partnerId: 'p-1', startAtMs: T0 + 36 * min, userId: 'u-1' });
    expect(start).toBe(T0 + 12 * min);
    // Fifteen and a half more minutes: 24 + 15.5 = 39.5 of age, where the split
    // visit recorded two halves that each missed the 30-minute threshold.
    expect((T0 + 51.5 * min - start!) / min).toBe(39.5);
  });

  it('is a new visit past the window, at another venue, or for another account', () => {
    expect(resumedStartMs(closed, { partnerId: 'p-1', startAtMs: closed.endedAtMs + RESUME_WINDOW_MS + 1, userId: 'u-1' })).toBeNull();
    expect(resumedStartMs(closed, { partnerId: 'p-2', startAtMs: T0 + 30 * min, userId: 'u-1' })).toBeNull();
    expect(resumedStartMs(closed, { partnerId: 'p-1', startAtMs: T0 + 30 * min, userId: 'u-2' })).toBeNull();
    expect(resumedStartMs(null, { partnerId: 'p-1', startAtMs: T0 })).toBeNull();
  });

  it('resumes when ownership is unknown on either side (check-in can race auth)', () => {
    expect(resumedStartMs({ ...closed, userId: null }, { partnerId: 'p-1', startAtMs: T0 + 30 * min, userId: 'u-1' })).toBe(T0 + 6 * min);
    expect(resumedStartMs(closed, { partnerId: 'p-1', startAtMs: T0 + 30 * min, userId: null })).toBe(T0 + 6 * min);
  });

  it('refuses a re-entry that claims to start before the close', () => {
    expect(resumedStartMs(closed, { partnerId: 'p-1', startAtMs: closed.endedAtMs - 1, userId: 'u-1' })).toBeNull();
  });
});

describe('pinOffsetM — which way the member stood from the pin', () => {
  const pin = { lat: GYM.lat, lng: GYM.lng };
  // Metres east at this latitude.
  const east = (m: number) => m / (111_195 * Math.cos(GYM.lat * Math.PI / 180));

  it('is (0, 0) on the pin', () => {
    expect(pinOffsetM(pin, { latitude: GYM.lat, longitude: GYM.lng })).toEqual({ dx_m: 0, dy_m: 0 });
  });

  it('reports whole metres east and north', () => {
    expect(pinOffsetM(pin, { latitude: GYM.lat + north(40), longitude: GYM.lng })).toEqual({ dx_m: 0, dy_m: 40 });
    expect(pinOffsetM(pin, { latitude: GYM.lat, longitude: GYM.lng + east(40) })).toEqual({ dx_m: 40, dy_m: 0 });
    expect(pinOffsetM(pin, { latitude: GYM.lat - north(12.4), longitude: GYM.lng - east(30.6) })).toEqual({ dx_m: -31, dy_m: -12 });
  });

  it('agrees with the distance the engine already sends', () => {
    const fix = { latitude: GYM.lat + north(60), longitude: GYM.lng + east(80) };
    const off = pinOffsetM(pin, fix)!;
    expect(Math.round(Math.hypot(off.dx_m, off.dy_m))).toBe(100);
  });

  it('is null away from the venue — where the member is then is not ours to record', () => {
    expect(pinOffsetM(pin, { latitude: GYM.lat + north(PIN_OFFSET_MAX_DISTANCE_M + 5), longitude: GYM.lng })).toBeNull();
    expect(pinOffsetM(pin, { latitude: 48.85, longitude: 2.35 })).toBeNull();
  });

  it('is null without a usable pin or fix', () => {
    expect(pinOffsetM({ lat: null, lng: GYM.lng }, { latitude: GYM.lat, longitude: GYM.lng })).toBeNull();
    expect(pinOffsetM({}, { latitude: GYM.lat, longitude: GYM.lng })).toBeNull();
    expect(pinOffsetM(pin, { latitude: NaN, longitude: GYM.lng })).toBeNull();
  });

  it('carries no latitude or longitude', () => {
    const off = pinOffsetM(pin, { latitude: GYM.lat + north(20), longitude: GYM.lng + east(10) })!;
    expect(Object.keys(off).sort()).toEqual(['dx_m', 'dy_m']);
  });
});
