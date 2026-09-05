/**
 * Which claim-points / upgrade-gym-tier answers the beacon's settle pass must
 * stop retrying. Pinned because the cost of getting it wrong is silent: a
 * terminal status retried every minute is 676 calls per visit (2026-09-04);
 * a transient one treated as terminal is a proven member never paid.
 */
import { TERMINAL_SETTLE_STATUSES, settleIsTerminal } from '@/supabase/functions/_shared/settleOutcome';

describe('settleIsTerminal', () => {
  it('is pinned to 409 (already claimed) and 422 (daily cap reached)', () => {
    expect([...TERMINAL_SETTLE_STATUSES].sort()).toEqual([409, 422]);
  });
  it('final answers stop the retry loop', () => {
    expect(settleIsTerminal(422)).toBe(true);
    expect(settleIsTerminal(409)).toBe(true);
  });
  it('transient answers keep the visit in play', () => {
    for (const s of [0, 200, 401, 403, 429, 500, 502, 503, 504]) expect(settleIsTerminal(s)).toBe(false);
  });
});
