/**
 * The beacon's exit settle (stage 3) pays closed-by-exit, proven, unclaimed
 * visits. Two things must never invert: it pays nothing that did not prove
 * presence, and it stops retrying when the answer is final.
 */
import {
  EXIT_SETTLE_LOOKBACK_MS,
  EXIT_SETTLE_MAX_ATTEMPTS,
  EXIT_SETTLE_RIGHT_OF_WAY_MS,
  exitSettleDue,
  exitSettleExhausted,
} from '@/supabase/functions/_shared/exitSettle';

const NOW = Date.parse('2026-09-06T16:30:00Z');
const MIN = 60 * 1000;

function visit(overrides: Partial<Parameters<typeof exitSettleDue>[0]> = {}) {
  return {
    started_at: new Date(NOW - 90 * MIN).toISOString(),
    ended_at: new Date(NOW - 10 * MIN).toISOString(),
    close_reason: 'exit',
    claimed_session_id: null,
    last_proven_at: new Date(NOW - 90 * MIN).toISOString(),
    ...overrides,
  };
}

describe('exitSettleDue', () => {
  it('pays a proven, unclaimed visit closed by the exit fence after the device had its turn', () => {
    expect(exitSettleDue(visit(), 30, NOW)).toBe(true);
  });

  it('never pays a visit that proved nothing', () => {
    expect(exitSettleDue(visit({ last_proven_at: null }), 30, NOW)).toBe(false);
  });

  it('leaves already-claimed visits alone', () => {
    expect(exitSettleDue(visit({ claimed_session_id: 'sess-1' }), 30, NOW)).toBe(false);
  });

  it('only acts on closes the device reported as an exit', () => {
    expect(exitSettleDue(visit({ close_reason: 'stale_after_upgrade' }), 30, NOW)).toBe(false);
    expect(exitSettleDue(visit({ close_reason: 'abandoned_12h' }), 30, NOW)).toBe(false);
    expect(exitSettleDue(visit({ close_reason: null }), 30, NOW)).toBe(false);
  });

  it('pays nothing under the dwell threshold', () => {
    const short = visit({
      started_at: new Date(NOW - 35 * MIN).toISOString(),
      ended_at: new Date(NOW - 10 * MIN).toISOString(),
    });
    expect(exitSettleDue(short, 30, NOW)).toBe(false);
    expect(exitSettleDue(short, 20, NOW)).toBe(true);
  });

  it('gives the relaunched app right-of-way before stepping in', () => {
    const justClosed = visit({ ended_at: new Date(NOW - EXIT_SETTLE_RIGHT_OF_WAY_MS + 1000).toISOString() });
    expect(exitSettleDue(justClosed, 30, NOW)).toBe(false);
    const pastGrace = visit({ ended_at: new Date(NOW - EXIT_SETTLE_RIGHT_OF_WAY_MS - 1000).toISOString() });
    expect(exitSettleDue(pastGrace, 30, NOW)).toBe(true);
  });

  it('does not resurrect history', () => {
    const old = visit({
      started_at: new Date(NOW - EXIT_SETTLE_LOOKBACK_MS - 120 * MIN).toISOString(),
      ended_at: new Date(NOW - EXIT_SETTLE_LOOKBACK_MS - 60 * MIN).toISOString(),
    });
    expect(exitSettleDue(old, 30, NOW)).toBe(false);
  });

  it('refuses malformed timestamps rather than guessing', () => {
    expect(exitSettleDue(visit({ ended_at: 'not-a-date' }), 30, NOW)).toBe(false);
    expect(exitSettleDue(visit({ ended_at: null }), 30, NOW)).toBe(false);
  });
});

describe('exitSettleExhausted', () => {
  const failed = (terminal: boolean) => ({ event: 'settle_failed', detail: { stage: 'exit', terminal } });

  it('starts fresh with no history', () => {
    expect(exitSettleExhausted([])).toBe(false);
  });

  it('stops after a settle', () => {
    expect(exitSettleExhausted([{ event: 'settled', detail: { stage: 'exit' } }])).toBe(true);
  });

  it('stops at once on a terminal refusal', () => {
    expect(exitSettleExhausted([failed(true)])).toBe(true);
  });

  it(`retries transient failures ${EXIT_SETTLE_MAX_ATTEMPTS} times, then stops`, () => {
    const tries = Array.from({ length: EXIT_SETTLE_MAX_ATTEMPTS - 1 }, () => failed(false));
    expect(exitSettleExhausted(tries)).toBe(false);
    expect(exitSettleExhausted([...tries, failed(false)])).toBe(true);
  });

  it('ignores the dwell and upgrade stages entirely', () => {
    expect(exitSettleExhausted([
      { event: 'settled', detail: { stage: 'dwell' } },
      { event: 'settle_failed', detail: { stage: 'upgrade', terminal: true } },
    ])).toBe(false);
  });
});
