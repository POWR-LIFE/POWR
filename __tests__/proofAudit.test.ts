import {
  provenSec,
  shouldFlagUnproven,
  unprovenExcessSec,
  UNPROVEN_EXCESS_FLAG_SEC,
} from '@/supabase/functions/_shared/proofAudit';

const MIN = 60;
const T0 = '2026-08-19T05:54:21.704Z';
const at = (minsAfter: number) =>
  new Date(Date.parse(T0) + minsAfter * 60_000).toISOString();

describe('proofAudit', () => {
  describe('the rows it exists to catch', () => {
    it('flags the 121-min zero-proof session (2026-08-19, visit clamped to 0.0 min)', () => {
      // Check-in 05:54, no proof ever, exit clamped to started_at
      // (clamp_loss_s 7318), claim at 07:56 inserted 121 min anyway.
      expect(shouldFlagUnproven({
        durationSec: 121 * MIN,
        visitStartedAt: T0,
        lastProvenAt: null,
      })).toBe(true);
    });

    it('flags the 128-min session claimed a day late against a 0-min visit (2026-08-17)', () => {
      expect(shouldFlagUnproven({
        durationSec: 128 * MIN,
        visitStartedAt: T0,
        lastProvenAt: null,
      })).toBe(true);
    });

    it('flags a geofence claim that resolved NO visit at all — zero evidence', () => {
      expect(shouldFlagUnproven({
        durationSec: 45 * MIN,
        visitStartedAt: null,
        lastProvenAt: null,
      })).toBe(true);
    });

    it('flags a proof clock that stalled at check-in (proven 0 of 52 min)', () => {
      // 2026-08-19: last_proven_at stamped once at check-in, never again.
      // Deliberately flagged — the duration IS unproven, and the flag is
      // triage visibility, not punishment (the award already went through).
      expect(shouldFlagUnproven({
        durationSec: 52 * MIN,
        visitStartedAt: T0,
        lastProvenAt: at(0),
      })).toBe(true);
    });
  });

  describe('honest chains stay unflagged', () => {
    it('a proven session with a routine proof gap at the end passes', () => {
      // Proofs through 50 min of a 55-min session — proof cadence + exit
      // detection lag, the normal healthy shape.
      expect(shouldFlagUnproven({
        durationSec: 55 * MIN,
        visitStartedAt: T0,
        lastProvenAt: at(50),
      })).toBe(false);
    });

    it('a min-dwell claim with proofs flowing passes', () => {
      expect(shouldFlagUnproven({
        durationSec: 31 * MIN,
        visitStartedAt: T0,
        lastProvenAt: at(25),
      })).toBe(false);
    });

    it('a short zero-proof row stays under the threshold (dev short claims, drive-bys)', () => {
      expect(shouldFlagUnproven({
        durationSec: 20 * MIN,
        visitStartedAt: T0,
        lastProvenAt: null,
      })).toBe(false);
    });

    it('the threshold is a strict excess: exactly threshold seconds passes', () => {
      expect(shouldFlagUnproven({
        durationSec: UNPROVEN_EXCESS_FLAG_SEC,
        visitStartedAt: T0,
        lastProvenAt: null,
      })).toBe(false);
      expect(shouldFlagUnproven({
        durationSec: UNPROVEN_EXCESS_FLAG_SEC + 1,
        visitStartedAt: T0,
        lastProvenAt: null,
      })).toBe(true);
    });
  });

  describe('provenSec — absence of evidence reads as zero, never as leniency', () => {
    it('no visit → 0', () => {
      expect(provenSec({ durationSec: 0, visitStartedAt: null, lastProvenAt: at(40) })).toBe(0);
    });
    it('no proof → 0', () => {
      expect(provenSec({ durationSec: 0, visitStartedAt: T0, lastProvenAt: null })).toBe(0);
    });
    it('unparseable timestamps → 0', () => {
      expect(provenSec({ durationSec: 0, visitStartedAt: 'garbage', lastProvenAt: at(40) })).toBe(0);
      expect(provenSec({ durationSec: 0, visitStartedAt: T0, lastProvenAt: 'garbage' })).toBe(0);
    });
    it('a proof BEFORE the visit start clamps to 0, not negative', () => {
      expect(provenSec({ durationSec: 0, visitStartedAt: T0, lastProvenAt: at(-5) })).toBe(0);
    });
    it('a normal proven window measures start → last proof', () => {
      expect(provenSec({ durationSec: 0, visitStartedAt: T0, lastProvenAt: at(40) })).toBe(40 * MIN);
    });
  });

  describe('unprovenExcessSec', () => {
    it('is claimed minus proven, floored at 0', () => {
      expect(unprovenExcessSec({ durationSec: 50 * MIN, visitStartedAt: T0, lastProvenAt: at(40) }))
        .toBe(10 * MIN);
      // Proven PAST the claimed duration (visit outlived the session row) is
      // not a negative debt.
      expect(unprovenExcessSec({ durationSec: 30 * MIN, visitStartedAt: T0, lastProvenAt: at(40) }))
        .toBe(0);
    });
    it('treats a non-finite duration as zero rather than NaN-poisoning the compare', () => {
      expect(unprovenExcessSec({ durationSec: NaN, visitStartedAt: T0, lastProvenAt: null })).toBe(0);
    });
  });
});
