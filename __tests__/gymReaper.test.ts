/**
 * The reaper is the ONLY mechanism that can close a visit the client has
 * forgotten. These tests pin the two things that made it unreachable on
 * 2026-08-10:
 *
 *   1. it must not treat "the device answered" as "the device proved it was
 *      there" — that is what let a phone miles away, and a server-side relay
 *      with no phone at all, defer it another 45 minutes each time; and
 *   2. it must have a ceiling that resetting the silence clock cannot postpone.
 *
 * The recorded end is always the last PROVEN moment, never now(): under-report
 * a session rather than inflate one.
 */
import {
  staleVisitVerdict,
  sessionBelongsToVisit,
  STALE_SILENCE_MS,
  MAX_OPEN_AFTER_UPGRADE_MS,
  SESSION_OWNERSHIP_MARGIN_MS,
} from '@/supabase/functions/_shared/gymReaper';

const MIN = 60 * 1000;
const NOW = Date.parse('2026-08-10T10:30:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('staleVisitVerdict', () => {
  describe('the deferral it exists to stop', () => {
    it('closes a visit whose only recent activity was a server-side relay mark', () => {
      // Visit 2efeea36, exactly as it happened: upgraded 09:08, owner left ~09:31,
      // and a `claimed` relay at 09:42:30 stamped last_confirmed_at — which used
      // to move the deadline from 09:53 to 10:27. last_proven_at was never
      // written, because no fix ever proved anything after the upgrade.
      const verdict = staleVisitVerdict({
        started_at: '2026-08-10T08:27:11.294Z',
        claimed_at: '2026-08-10T08:58:05.132Z',
        upgraded_at: '2026-08-10T09:08:05.925Z',
        last_proven_at: null,
      }, NOW);

      expect(verdict.close).toBe(true);
      expect(verdict.closeReason).toBe('stale_after_upgrade');
      expect(iso(verdict.provenMs)).toBe('2026-08-10T09:08:05.925Z');
    });

    it('is not deferred by a coarse "inside" answer, because that never proves', () => {
      // Android answered every fence_refresh within ~1s all morning on 900 m
      // fixes. Those confirms stamp last_confirmed_at and nothing else, so the
      // clock here does not move.
      const upgradedAt = NOW - 90 * MIN;
      expect(staleVisitVerdict({
        started_at: iso(NOW - 125 * MIN),
        claimed_at: iso(NOW - 100 * MIN),
        upgraded_at: iso(upgradedAt),
        last_proven_at: null,
      }, NOW).close).toBe(true);
    });
  });

  describe('what still keeps a session alive', () => {
    it('leaves a visit open while the device keeps proving presence', () => {
      const verdict = staleVisitVerdict({
        started_at: iso(NOW - 100 * MIN),
        claimed_at: iso(NOW - 70 * MIN),
        upgraded_at: iso(NOW - 60 * MIN),
        last_proven_at: iso(NOW - 10 * MIN),
      }, NOW);
      expect(verdict.close).toBe(false);
      expect(verdict.closeReason).toBeNull();
    });

    it('holds the visit open for the full silence window after the upgrade', () => {
      const upgradedAt = NOW - (STALE_SILENCE_MS - MIN);
      expect(staleVisitVerdict({
        started_at: iso(upgradedAt - 40 * MIN),
        claimed_at: iso(upgradedAt - 10 * MIN),
        upgraded_at: iso(upgradedAt),
        last_proven_at: null,
      }, NOW).close).toBe(false);
    });

    it('closes the moment that window elapses, and ends at the last proof', () => {
      const provenAt = NOW - STALE_SILENCE_MS;
      const verdict = staleVisitVerdict({
        started_at: iso(provenAt - 50 * MIN),
        claimed_at: iso(provenAt - 20 * MIN),
        upgraded_at: iso(provenAt - 10 * MIN),
        last_proven_at: iso(provenAt),
      }, NOW);
      expect(verdict.close).toBe(true);
      expect(verdict.provenMs).toBe(provenAt);
    });
  });

  describe('the ceiling silence-resetting cannot postpone', () => {
    it('closes a visit that has kept proving presence past the ceiling', () => {
      // A phone parked 20 m from the centroid proves presence honestly and
      // forever. Past the upgrade there is nothing left to earn, so it goes.
      const startedAt = NOW - (MAX_OPEN_AFTER_UPGRADE_MS + MIN);
      const verdict = staleVisitVerdict({
        started_at: iso(startedAt),
        claimed_at: iso(startedAt + 30 * MIN),
        upgraded_at: iso(startedAt + 40 * MIN),
        last_proven_at: iso(NOW - MIN), // proved one minute ago
      }, NOW);

      expect(verdict.close).toBe(true);
      expect(verdict.closeReason).toBe('max_open_after_upgrade');
      // Still the last PROVEN moment — the ceiling decides when we close, never
      // what we record.
      expect(verdict.provenMs).toBe(NOW - MIN);
    });

    it('leaves a long-but-live session alone just inside the ceiling', () => {
      const startedAt = NOW - (MAX_OPEN_AFTER_UPGRADE_MS - MIN);
      expect(staleVisitVerdict({
        started_at: iso(startedAt),
        claimed_at: iso(startedAt + 30 * MIN),
        upgraded_at: iso(startedAt + 40 * MIN),
        last_proven_at: iso(NOW - MIN),
      }, NOW).close).toBe(false);
    });
  });

  describe('degenerate input', () => {
    it('never ends a visit before it started', () => {
      const startedAt = NOW - 120 * MIN;
      const verdict = staleVisitVerdict({
        started_at: iso(startedAt),
        claimed_at: null,
        upgraded_at: null,
        last_proven_at: null,
      }, NOW);
      expect(verdict.provenMs).toBe(startedAt);
      expect(verdict.close).toBe(true);
    });

    it('ignores unparseable timestamps rather than reading them as 1970', () => {
      const startedAt = NOW - 120 * MIN;
      const verdict = staleVisitVerdict({
        started_at: iso(startedAt),
        claimed_at: 'not-a-date',
        upgraded_at: iso(startedAt + 40 * MIN),
        last_proven_at: undefined,
      }, NOW);
      expect(verdict.provenMs).toBe(startedAt + 40 * MIN);
    });
  });
});

describe('sessionBelongsToVisit', () => {
  // Visit b899021c, exactly as it happened (2026-08-22): the second same-day
  // check-in at POWR was stamped with the morning visit's session, and the reaper
  // grew that session to 1045 minutes when it closed the evening visit.
  const eveningVisit = { started_at: '2026-08-22T20:54:38.628Z' };
  const morningSession = { started_at: '2026-08-22T07:25:36.256Z' };

  it('disowns a same-day session that predates the visit by hours', () => {
    expect(sessionBelongsToVisit(morningSession, eveningVisit)).toBe(false);
  });

  it('owns a session inserted at check-in', () => {
    expect(sessionBelongsToVisit({ started_at: '2026-08-22T20:54:38.628Z' }, eveningVisit)).toBe(true);
  });

  it('owns a session the client inserted a little after check-in (claim at 30 min)', () => {
    expect(sessionBelongsToVisit({ started_at: '2026-08-22T21:25:00.000Z' }, eveningVisit)).toBe(true);
  });

  it('tolerates a health reconciliation or stale-entry replay that backdates the start', () => {
    const backdated = new Date(Date.parse(eveningVisit.started_at) - SESSION_OWNERSHIP_MARGIN_MS + 1000).toISOString();
    expect(sessionBelongsToVisit({ started_at: backdated }, eveningVisit)).toBe(true);
  });

  it('disowns a session that predates the visit by more than the margin', () => {
    const tooEarly = new Date(Date.parse(eveningVisit.started_at) - SESSION_OWNERSHIP_MARGIN_MS - 1000).toISOString();
    expect(sessionBelongsToVisit({ started_at: tooEarly }, eveningVisit)).toBe(false);
  });

  it('keeps the old behaviour when a timestamp is missing or unparseable', () => {
    expect(sessionBelongsToVisit({ started_at: null }, eveningVisit)).toBe(true);
    expect(sessionBelongsToVisit(morningSession, { started_at: 'not-a-date' })).toBe(true);
  });
});
