/**
 * Tests for the Terra ingestion helpers used by the terra-webhook edge function:
 *   - terraActivityToPOWR: Terra activity name/type → POWR canonical type
 *   - point calculators that mirror the client-side logic
 *   - Terra webhook signature verification (HMAC-SHA256 over `${t}.${rawBody}`)
 *
 * These are pure, Deno-free modules so they run unchanged in both the edge
 * function and here.
 */

import {
  terraActivityToPOWR,
  terraResourceToSource,
  calculateBasePoints,
  calculateSleepPoints,
  DAILY_CAPS,
  dailyCapBucket,
  stepTierPoints,
} from '@/supabase/functions/_shared/points';
import {
  computeTerraSignature,
  verifyTerraSignature,
  parseTerraSignature,
  constantTimeEqual,
} from '@/supabase/functions/_shared/terraSignature';

describe('terraActivityToPOWR', () => {
  it('maps names to canonical POWR types', () => {
    expect(terraActivityToPOWR('Trail Running')).toBe('running');
    expect(terraActivityToPOWR('Indoor Cycling')).toBe('cycling');
    expect(terraActivityToPOWR('Open Water Swim')).toBe('swimming');
    expect(terraActivityToPOWR('Weight Training')).toBe('gym');
    expect(terraActivityToPOWR('HIIT')).toBe('hiit');
    expect(terraActivityToPOWR('Vinyasa Yoga')).toBe('yoga');
    expect(terraActivityToPOWR('Tennis')).toBe('sports');
    expect(terraActivityToPOWR('Hip Hop Dance')).toBe('dance');
  });

  it('maps deterministically off Terra\'s normalised type enum (authoritative)', () => {
    expect(terraActivityToPOWR('', 8)).toBe('running');    // Running
    expect(terraActivityToPOWR('', 1)).toBe('cycling');    // Biking
    expect(terraActivityToPOWR('', 18)).toBe('cycling');   // Stationary Biking
    expect(terraActivityToPOWR('', 82)).toBe('swimming');  // Swimming
    expect(terraActivityToPOWR('', 80)).toBe('gym');       // Strength Training
    expect(terraActivityToPOWR('', 100)).toBe('yoga');     // Yoga
    expect(terraActivityToPOWR('', 45)).toBe('yoga');      // Meditation
    expect(terraActivityToPOWR('', 114)).toBe('hiit');     // HIIT
    expect(terraActivityToPOWR('', 24)).toBe('dance');     // Dancing
    expect(terraActivityToPOWR('', 87)).toBe('sports');    // Tennis
  });

  it('fixes the old name-only gaps/mis-maps via the enum', () => {
    expect(terraActivityToPOWR('Dancing', 24)).toBe('dance');     // was missed by 'dance' substring
    expect(terraActivityToPOWR('Gymnastics', 33)).toBe('sports'); // was wrongly caught by 'gym'
    expect(terraActivityToPOWR('Zumba', 101)).toBe('dance');
  });

  it('returns null only for walking and genuine non-exercise sensor states', () => {
    expect(terraActivityToPOWR('', 7)).toBeNull();    // Walking → daily steps
    expect(terraActivityToPOWR('', 93)).toBeNull();   // Walking for Fitness → daily steps
    expect(terraActivityToPOWR('', 0)).toBeNull();    // In Vehicle
    expect(terraActivityToPOWR('', 135)).toBeNull();  // Driving
    expect(terraActivityToPOWR('Walking')).toBeNull();
  });

  it('logs an unrecognised workout as gym rather than dropping it', () => {
    // A real activity payload Terra sent but we can't name is still a workout —
    // it must land as a session. Whoop's unspecified "Activity" arrives as 108.
    expect(terraActivityToPOWR('', 108)).toBe('gym');                  // Other
    expect(terraActivityToPOWR('', 4)).toBe('gym');                    // Unknown
    expect(terraActivityToPOWR('Activity', 108)).toBe('gym');          // Whoop generic
    expect(terraActivityToPOWR('')).toBe('gym');                       // unnamed, no type
    expect(terraActivityToPOWR('Underwater Basket Weaving')).toBe('gym'); // unrecognised name
  });

  it('still resolves via name heuristics for unknown/future type ints', () => {
    expect(terraActivityToPOWR('Trail Running', 9999)).toBe('running');
    expect(terraActivityToPOWR('Gymnastics', 9999)).toBe('sports'); // specific bucket beats bare 'gym'
  });
});

describe('terraResourceToSource', () => {
  it('maps Terra resource slugs to health_snapshots source labels', () => {
    expect(terraResourceToSource('WHOOP')).toBe('whoop');
    expect(terraResourceToSource('oura')).toBe('oura');
    expect(terraResourceToSource('Garmin')).toBe('garmin');
    expect(terraResourceToSource('POLAR')).toBe('polar');
    expect(terraResourceToSource('huawei')).toBe('huawei');
    expect(terraResourceToSource('WITHINGS')).toBe('withings');
    expect(terraResourceToSource('Peloton')).toBe('peloton');
    expect(terraResourceToSource('ZEPP')).toBe('zepp');
    expect(terraResourceToSource('TECHNOGYM')).toBe('technogym');
    expect(terraResourceToSource('COROS')).toBe('coros');
    expect(terraResourceToSource('Wahoo')).toBe('wahoo');
    expect(terraResourceToSource('CONCEPT2')).toBe('concept2');
    expect(terraResourceToSource('Strava')).toBe('strava');
    expect(terraResourceToSource('UNKNOWN')).toBeNull();
  });
});

describe('point calculators', () => {
  it('awards base points only above each type minimum duration', () => {
    expect(calculateBasePoints('running', 10)).toBe(0);   // < 15 min, no distance
    expect(calculateBasePoints('running', 30)).toBe(8);
    expect(calculateBasePoints('yoga', 25)).toBe(3);
    expect(calculateBasePoints('swimming', 20)).toBe(7);
  });

  // Cardio used to pay a FLAT rate off duration alone — any run over 15 minutes
  // was worth 10, the same as a 10 k. That was invisible while the daily cap was
  // also 10; uncapping cardio (2026-08-07) made it the difference between paying
  // for effort and paying for the number of times you pressed start.
  describe('cardio scores on effort, not per session', () => {
    it('pays a 10 k more than a jog, however long each took', () => {
      expect(calculateBasePoints('running', 55, {}, 10_000)).toBe(10);
      expect(calculateBasePoints('running', 16, {}, 2_100)).toBe(5);
    });

    it('leaves splitting a workout up strictly worse than finishing it', () => {
      // The 2026-08-06 incident, priced: one 10 km run vs the same distance
      // logged as three separate legs. Uncapped and flat this paid 30 vs 10.
      const whole = calculateBasePoints('running', 57, {}, 10_000);
      const legs = [3_400, 3_300, 3_300]
        .map(d => calculateBasePoints('running', 19, {}, d))
        .reduce((a, b) => a + b, 0);
      expect(whole).toBe(10);
      expect(legs).toBe(18);
      // Still more than the whole — three legs IS three efforts — but nothing
      // like the 3× a flat rate paid, and each leg is scored on its own merit.
      expect(legs / whole).toBeLessThan(2);
    });

    it('scores on distance when a session is short but fast', () => {
      // 12 minutes is under every duration rung; 3.1 km is not.
      expect(calculateBasePoints('running', 12, {}, 3_100)).toBe(6);
    });

    it('falls back to duration when a provider reports no distance', () => {
      expect(calculateBasePoints('cycling', 95)).toBe(10);
      expect(calculateBasePoints('cycling', 95, {}, null)).toBe(10);
    });

    it('matches the ladder claim-points uses for the same session', () => {
      expect(calculateBasePoints('cycling', 30, {}, 12_000)).toBe(6);
      expect(calculateBasePoints('swimming', 45, {}, 1_200)).toBe(9);
      expect(calculateBasePoints('sports', 90)).toBe(10);
      expect(calculateBasePoints('dance', 45)).toBe(7);
      expect(calculateBasePoints('yoga', 60)).toBe(6);
    });
  });

  describe('daily caps', () => {
    it('caps only the strength lane and the daily aggregates', () => {
      expect(DAILY_CAPS.gym).toBe(30);
      expect(DAILY_CAPS.hiit).toBe(30);   // must equal gym — strength lane parity
      expect(DAILY_CAPS.walking).toBe(5);
      expect(DAILY_CAPS.sleep).toBe(5);
    });

    it('buckets gym and hiit under the same daily cap lane', () => {
      expect(dailyCapBucket('gym')).toBe('gym');
      expect(dailyCapBucket('hiit')).toBe('gym');
    });

    it('leaves cardio uncapped — absent means unlimited', () => {
      for (const type of ['running', 'cycling', 'swimming', 'sports', 'yoga', 'dance'] as const) {
        expect(DAILY_CAPS[type]).toBeUndefined();
      }
    });

    it('never caps a type below what one session of it can score', () => {
      // A ceiling under the top rung would silently shave every full effort.
      expect(DAILY_CAPS.gym!).toBeGreaterThanOrEqual(calculateBasePoints('gym', 120));
      expect(DAILY_CAPS.hiit!).toBeGreaterThanOrEqual(calculateBasePoints('hiit', 120));
    });
  });

  describe('strength lane (gym + hiit score identically)', () => {
    it('pays a wearable session the same 15/20 tiers a check-in pays', () => {
      expect(calculateBasePoints('gym', 30)).toBe(15);
      expect(calculateBasePoints('gym', 45)).toBe(20);
      expect(calculateBasePoints('hiit', 30)).toBe(15);
      expect(calculateBasePoints('hiit', 45)).toBe(20);
    });

    it('keeps HIIT qualifying at 20 min while gym waits for the dwell gate', () => {
      expect(calculateBasePoints('hiit', 20)).toBe(15);
      expect(calculateBasePoints('hiit', 19)).toBe(0);
      expect(calculateBasePoints('gym', 20)).toBe(0);
      expect(calculateBasePoints('gym', 29)).toBe(0);
    });

    it('follows an admin retune of the shared thresholds', () => {
      const tuned = { gymDwellMin: 25, gymUpgradeMin: 50 };
      expect(calculateBasePoints('gym', 25, tuned)).toBe(15);
      expect(calculateBasePoints('gym', 45, tuned)).toBe(15); // upgrade moved to 50
      expect(calculateBasePoints('gym', 50, tuned)).toBe(20);
      expect(calculateBasePoints('hiit', 20, tuned)).toBe(15); // HIIT floor is fixed
      expect(calculateBasePoints('hiit', 50, tuned)).toBe(20);
    });
  });

  it('scores sleep by duration and restorative ratio', () => {
    expect(calculateSleepPoints(8)).toBe(5);
    expect(calculateSleepPoints(2)).toBe(0); // < 3h ignored
    // 8h with low restorative ratio scales the base of 5 down.
    expect(calculateSleepPoints(8, 0.5, 0.5)).toBe(3); // ratio 0.125 → 0.60×5 = 3
    expect(calculateSleepPoints(8, 1.5, 1.5)).toBe(5); // ratio 0.375 → 1.0×5 = 5
  });

  it('tiers walking points by step count', () => {
    expect(stepTierPoints(3000)).toBe(0);
    expect(stepTierPoints(6000)).toBe(3);
    expect(stepTierPoints(10000)).toBe(5);
  });
});

describe('Terra signature verification', () => {
  const secret = 'whsec_test_signing_secret';
  const rawBody = JSON.stringify({ type: 'activity', user: { user_id: 'abc' }, data: [] });
  const t = '1723808700';

  it('parses the terra-signature header', () => {
    expect(parseTerraSignature(`t=${t},v1=deadbeef`)).toEqual({ t, v1: 'deadbeef' });
    expect(parseTerraSignature('garbage')).toBeNull();
    expect(parseTerraSignature(null)).toBeNull();
  });

  it('accepts a correctly signed body', async () => {
    const v1 = await computeTerraSignature(t, rawBody, secret);
    expect(await verifyTerraSignature(rawBody, `t=${t},v1=${v1}`, secret)).toBe(true);
  });

  it('rejects a tampered body, wrong secret, or missing header', async () => {
    const v1 = await computeTerraSignature(t, rawBody, secret);
    expect(await verifyTerraSignature(rawBody + ' ', `t=${t},v1=${v1}`, secret)).toBe(false);
    expect(await verifyTerraSignature(rawBody, `t=${t},v1=${v1}`, 'wrong_secret')).toBe(false);
    expect(await verifyTerraSignature(rawBody, null, secret)).toBe(false);
  });

  it('constantTimeEqual compares by value, length-safe', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
