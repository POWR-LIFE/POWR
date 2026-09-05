/**
 * Which claim-points / upgrade-gym-tier answers the beacon's settle pass must
 * stop retrying. Pinned because the cost of getting it wrong is silent: a
 * terminal status retried every minute is 676 calls per visit (2026-09-04);
 * a transient one treated as terminal is a proven member never paid.
 */
import { TERMINAL_SETTLE_STATUSES, settleIsTerminal } from '@/supabase/functions/_shared/settleOutcome';

describe('settleIsTerminal', () => {
  it('final answers stop the retry loop', () => {
    expect(settleIsTerminal(422, 'Daily cap reached')).toBe(true);
    expect(settleIsTerminal(409, 'Session already claimed')).toBe(true);
  });
  it('422 is only terminal for the daily-cap refusal', () => {
    expect(settleIsTerminal(422, 'Session does not meet eligibility minimum')).toBe(false);
    expect(settleIsTerminal(422, `Session has not reached the 40-min tier`)).toBe(false);
  });
  it('transient answers keep the visit in play', () => {
    for (const s of [0, 200, 401, 403, 429, 500, 502, 503, 504]) expect(settleIsTerminal(s, null)).toBe(false);
  });
});
