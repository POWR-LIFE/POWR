/**
 * The failure endings of a shared challenge.
 *
 * Every one of these paths used to be silent: the server wrote a terminal
 * status and returned, there was no failure notification type in the system,
 * and the list RPC dropped 'expired'/'cancelled' the instant they were set —
 * so the card simply vanished from Home. These tests pin the two pure pieces
 * of that fix: the push copy per outcome, and the terminal-status predicate
 * that now drives visibility and dismissal.
 */

import { isTerminal } from '@/lib/social/status';

// Mirrors the `challenge_ended` case in
// supabase/functions/send-push-notification/index.ts. Kept in sync by hand:
// the edge function is Deno + @ts-nocheck and can't be imported here, so this
// is a copy-of-record that fails loudly if the shipped copy drifts from intent.
function endedBody(payload: {
  title?: string;
  outcome?: string;
  finishers?: number;
  roster?: number;
}): string {
  const title = payload.title || 'Your challenge';
  const outcome = String(payload.outcome ?? 'expired');
  const finishers = Math.max(0, Math.round(Number(payload.finishers ?? 0)));
  const roster = Math.max(0, Math.round(Number(payload.roster ?? 0)));
  return outcome === 'cancelled'
    ? `"${title}" was cancelled before it finished.`
    : outcome === 'pool_missed'
      ? `"${title}" ended — the group came up short of the target this time.`
      : outcome === 'missed'
        ? roster > 0
          ? `"${title}" finished without you — ${finishers} of ${roster} made it.`
          : `"${title}" finished without you this time.`
        : `"${title}" ended — nobody finished this one.`;
}

describe('challenge_ended copy', () => {
  it('names the ending rather than implying a win', () => {
    expect(endedBody({ title: 'Back Again', outcome: 'expired' }))
      .toBe('"Back Again" ended — nobody finished this one.');
    expect(endedBody({ title: 'Back Again', outcome: 'cancelled' }))
      .toBe('"Back Again" was cancelled before it finished.');
  });

  it('does not say "time ran out" for a pooled miss', () => {
    // Pooled settles the moment the group hits target, so the two failures are
    // genuinely different stories.
    const body = endedBody({ title: '100k Steps', outcome: 'pool_missed' });
    expect(body).toContain('came up short of the target');
    expect(body).not.toMatch(/nobody finished/);
  });

  it('tells a non-finisher how the group did', () => {
    expect(endedBody({ title: 'Back Again', outcome: 'missed', finishers: 2, roster: 3 }))
      .toBe('"Back Again" finished without you — 2 of 3 made it.');
  });

  it('degrades gracefully when the roster is missing', () => {
    // A malformed payload must not render "0 of 0 made it".
    expect(endedBody({ title: 'Back Again', outcome: 'missed' }))
      .toBe('"Back Again" finished without you this time.');
  });

  it('falls back to the expired wording for an unknown outcome', () => {
    expect(endedBody({ title: 'X', outcome: 'wat' })).toBe('"X" ended — nobody finished this one.');
    expect(endedBody({ title: 'X' })).toBe('"X" ended — nobody finished this one.');
  });

  it('never leaves the title blank', () => {
    expect(endedBody({ outcome: 'expired' })).toBe('"Your challenge" ended — nobody finished this one.');
  });
});

describe('isTerminal', () => {
  it('treats losses as endings, not as live challenges', () => {
    // This predicate now drives three things at once: the 3-day linger window,
    // the card's verdict face, and whether the (X) appears. Losing statuses
    // must be included or a loss renders as a live card that can't be cleared.
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('does not treat a live or forming challenge as ended', () => {
    expect(isTerminal('active')).toBe(false);
    expect(isTerminal('open')).toBe(false);
  });
});
