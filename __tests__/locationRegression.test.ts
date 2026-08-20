import {
  NOTICE_HOUR_END,
  NOTICE_HOUR_START,
  REGRESSION_GRACE_MS,
  shouldSendRegressionNotice,
} from '@/supabase/functions/_shared/locationRegression';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-20T12:00:00Z');

const eligible = {
  regressionLevel: 'denied',
  regressionAtMs: NOW - 5 * DAY,
  currentLevel: 'denied',
  lastAttemptAtMs: null,
  localHour: 14,
  nowMs: NOW,
};

describe('shouldSendRegressionNotice', () => {
  it('sends for the user it was built for: always→denied five days ago, still denied, never attempted', () => {
    // Field 2026-08-15: permission lost mid-visit, zero visits since, live
    // push token the whole time — the exact dead-end this closes.
    expect(shouldSendRegressionNotice(eligible)).toBe(true);
  });

  it('sends for a while_using regression too', () => {
    expect(shouldSendRegressionNotice({
      ...eligible, regressionLevel: 'while_using', currentLevel: 'while_using',
    })).toBe(true);
  });

  describe('one push per regression, ever', () => {
    it('any attempt AFTER the regression closes it — including a skipped one', () => {
      // no_tokens / user_preference skips still log; retrying every 15 min is
      // log spam at best and a nag at worst.
      expect(shouldSendRegressionNotice({
        ...eligible, lastAttemptAtMs: eligible.regressionAtMs + DAY,
      })).toBe(false);
    });

    it('an attempt from an OLDER regression does not block a fresh one', () => {
      // Re-granted after the first notice, then lost again → new regression
      // row postdates the old attempt and re-arms.
      expect(shouldSendRegressionNotice({
        ...eligible, lastAttemptAtMs: eligible.regressionAtMs - DAY,
      })).toBe(true);
    });
  });

  describe('the 24h grace — permission state flaps', () => {
    it('holds fire inside the grace window', () => {
      // Field-test accounts record always→denied and back several times a day.
      expect(shouldSendRegressionNotice({
        ...eligible, regressionAtMs: NOW - REGRESSION_GRACE_MS + 60_000,
      })).toBe(false);
    });
    it('fires once the regression has survived the full grace', () => {
      expect(shouldSendRegressionNotice({
        ...eligible, regressionAtMs: NOW - REGRESSION_GRACE_MS - 60_000,
      })).toBe(true);
    });
  });

  describe('only while the loss is still true', () => {
    it('self-healed (back on always) → never push', () => {
      expect(shouldSendRegressionNotice({ ...eligible, currentLevel: 'always' })).toBe(false);
    });
    it('moved to a DIFFERENT broken level → not this regression\'s push', () => {
      // denied → while_using has its own in-app surface (LocationPrimeSheet).
      expect(shouldSendRegressionNotice({ ...eligible, currentLevel: 'while_using' })).toBe(false);
    });
    it('profile read failed (null) → never manufacture a push from missing data', () => {
      expect(shouldSendRegressionNotice({ ...eligible, currentLevel: null })).toBe(false);
    });
    it('a regression level outside the two real ones is refused outright', () => {
      expect(shouldSendRegressionNotice({
        ...eligible, regressionLevel: 'undetermined', currentLevel: 'undetermined',
      })).toBe(false);
    });
  });

  describe('daytime-only, user-local', () => {
    it('respects the window bounds inclusively', () => {
      expect(shouldSendRegressionNotice({ ...eligible, localHour: NOTICE_HOUR_START })).toBe(true);
      expect(shouldSendRegressionNotice({ ...eligible, localHour: NOTICE_HOUR_END })).toBe(true);
      expect(shouldSendRegressionNotice({ ...eligible, localHour: NOTICE_HOUR_START - 1 })).toBe(false);
      expect(shouldSendRegressionNotice({ ...eligible, localHour: NOTICE_HOUR_END + 1 })).toBe(false);
      expect(shouldSendRegressionNotice({ ...eligible, localHour: 3 })).toBe(false);
    });
  });

  it('an unparseable regression timestamp never sends', () => {
    expect(shouldSendRegressionNotice({ ...eligible, regressionAtMs: NaN })).toBe(false);
  });
});
