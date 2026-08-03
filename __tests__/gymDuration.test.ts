import {
  recordedGymDurationSec,
  MAX_GYM_SESSION_SEC,
} from '@/supabase/functions/_shared/gymDuration';

const MIN = 60;
const UPGRADE_MIN = 40; // system_config default

describe('recordedGymDurationSec', () => {
  describe('the bug it exists to stop', () => {
    it('does not clobber a correct 45-min session when the upgrade lands 16h late', () => {
      // Checked in 17:00, trained 45 min, relay finally succeeds 09:00 next day.
      // Old behaviour: min(now − started, 12h) = 43200. This is session 086aa9f0.
      expect(recordedGymDurationSec({
        elapsedSec: MAX_GYM_SESSION_SEC,
        presenceSec: 45 * MIN,
        recordedSec: 45 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(45 * MIN);
    });

    it('falls back to the already-recorded duration when the visit never confirmed', () => {
      // ~56% of visits have no last_confirmed_at. The client's own frozen exit
      // value still beats a late wall clock.
      expect(recordedGymDurationSec({
        elapsedSec: MAX_GYM_SESSION_SEC,
        presenceSec: null,
        recordedSec: 45 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(45 * MIN);
    });

    it('is convergent — a repeat call cannot ratchet the number forward', () => {
      // The UPDATE runs before the `delta <= 0` idempotency return, so no-op
      // retries hit this. 5b34d854 reached 7.1h off a 42-min visit this way.
      const first = recordedGymDurationSec({
        elapsedSec: 3 * 60 * MIN,
        presenceSec: 42 * MIN,
        recordedSec: 42 * MIN,
        upgradeMin: UPGRADE_MIN,
      });
      const second = recordedGymDurationSec({
        elapsedSec: 9 * 60 * MIN, // hours later
        presenceSec: 42 * MIN,
        recordedSec: first,
        upgradeMin: UPGRADE_MIN,
      });
      expect(first).toBe(42 * MIN);
      expect(second).toBe(first);
    });

    it('self-heals a row already poisoned to 12h once presence evidence exists', () => {
      expect(recordedGymDurationSec({
        elapsedSec: MAX_GYM_SESSION_SEC,
        presenceSec: 50 * MIN,
        recordedSec: MAX_GYM_SESSION_SEC,
        upgradeMin: UPGRADE_MIN,
      })).toBe(50 * MIN);
    });

    it('ignores a last_confirmed_at that markVisitUpgraded/claim-points stamped to now()', () => {
      // Both stamp last_confirmed_at = now() on a relay mark, so on a second late
      // call presence reads back as the full elapsed span. Weakest-bound wins.
      expect(recordedGymDurationSec({
        elapsedSec: MAX_GYM_SESSION_SEC,
        presenceSec: MAX_GYM_SESSION_SEC, // polluted
        recordedSec: 45 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(45 * MIN);
    });
  });

  describe('honest cases are left alone', () => {
    it('records a normal in-gym upgrade at its real length', () => {
      expect(recordedGymDurationSec({
        elapsedSec: 41 * MIN,
        presenceSec: 41 * MIN,
        recordedSec: 41 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(41 * MIN);
    });

    it('keeps a genuine multi-hour session that kept confirming presence', () => {
      // The gym-worker case: 3h of continuously proven presence stays 3h.
      expect(recordedGymDurationSec({
        elapsedSec: 3 * 60 * MIN,
        presenceSec: 3 * 60 * MIN,
        recordedSec: 3 * 60 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(3 * 60 * MIN);
    });

    it('grows a too_short row up to the tier it is being paid for', () => {
      // Client wrote 22 min on the too_short path; the upgrade pays the 40-min
      // tier, so the row must not still read 22 min.
      expect(recordedGymDurationSec({
        elapsedSec: 41 * MIN,
        presenceSec: null,
        recordedSec: 22 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(UPGRADE_MIN * MIN);
    });

    it('reproduces the old behaviour when there is no evidence at all', () => {
      expect(recordedGymDurationSec({
        elapsedSec: 55 * MIN,
        presenceSec: null,
        recordedSec: 0,
        upgradeMin: UPGRADE_MIN,
      })).toBe(55 * MIN);
    });
  });

  describe('bounds', () => {
    it('never exceeds elapsed, even when the stored value already does', () => {
      expect(recordedGymDurationSec({
        elapsedSec: 50 * MIN,
        presenceSec: 90 * MIN,
        recordedSec: 120 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(50 * MIN);
    });

    it('caps at the 12h backstop', () => {
      expect(recordedGymDurationSec({
        elapsedSec: 30 * 60 * MIN,
        presenceSec: null,
        recordedSec: null,
        upgradeMin: UPGRADE_MIN,
      })).toBe(MAX_GYM_SESSION_SEC);
    });

    it('does not inflate a dev-override upgrade of a genuinely short session', () => {
      // DEV_MIN_UPGRADE_SEC lets a dev-test account upgrade at 5 min. The tier
      // floor must not push the recorded length past real elapsed time.
      expect(recordedGymDurationSec({
        elapsedSec: 5 * MIN,
        presenceSec: 5 * MIN,
        recordedSec: 5 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(5 * MIN);
    });

    it('tracks an admin-tuned gym_upgrade_minutes rather than a hardcoded 40', () => {
      expect(recordedGymDurationSec({
        elapsedSec: 60 * MIN,
        presenceSec: null,
        recordedSec: 10 * MIN,
        upgradeMin: 25,
      })).toBe(25 * MIN);
    });

    it('ignores zero/negative/NaN evidence rather than recording it', () => {
      expect(recordedGymDurationSec({
        elapsedSec: 45 * MIN,
        presenceSec: -100,
        recordedSec: Number.NaN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(45 * MIN);
    });
  });

  describe('late retries after the visit ended', () => {
    // gym-visit-beacon now retries the upgrade for up to 24h after a visit ends.
    // upgrade-gym-tier bounds its gate by the visit's real length so a short visit
    // can never drift over the tier; these cover what the clamp then STORES.
    it('a retry hours after the exit still records the real length', () => {
      // Visit ended at 52 min; beacon retries 6h later. elapsedSec arrives already
      // bounded by the visit end, so the clamp sees a truthful ceiling.
      expect(recordedGymDurationSec({
        elapsedSec: 52 * MIN,
        presenceSec: 52 * MIN,
        recordedSec: 52 * MIN,
        upgradeMin: UPGRADE_MIN,
      })).toBe(52 * MIN);
    });

    it('repeated beacon retries converge on one value', () => {
      let stored = 47 * MIN;
      for (let attempt = 0; attempt < 5; attempt++) {
        stored = recordedGymDurationSec({
          elapsedSec: 47 * MIN,   // bounded by visit end, so constant across retries
          presenceSec: 47 * MIN,
          recordedSec: stored,
          upgradeMin: UPGRADE_MIN,
        });
      }
      expect(stored).toBe(47 * MIN);
    });
  });

  describe('the reason shrinking is safe', () => {
    it('never returns less than the tier being paid for when time allows', () => {
      // A row must stay consistent with its own tier: a session paid the 40-min
      // bonus can never store less than 40 min unless it truly is shorter.
      for (const presence of [1, 5, 20, 39].map(m => m * MIN)) {
        expect(recordedGymDurationSec({
          elapsedSec: 3 * 60 * MIN,
          presenceSec: presence,
          recordedSec: presence,
          upgradeMin: UPGRADE_MIN,
        })).toBe(UPGRADE_MIN * MIN);
      }
    });

    it('only ever narrows the supersede window, never widens it', () => {
      // claim-points supersedeLowerTrust / terra-webhook overlapsGeofenceGym read
      // this duration as their overlap window, so the result must not exceed what
      // the old code would have written (elapsed).
      const elapsedSec = 8 * 60 * MIN;
      for (const presence of [null, 30 * MIN, 4 * 60 * MIN, elapsedSec]) {
        expect(recordedGymDurationSec({
          elapsedSec,
          presenceSec: presence,
          recordedSec: 90 * MIN,
          upgradeMin: UPGRADE_MIN,
        })).toBeLessThanOrEqual(elapsedSec);
      }
    });
  });
});
