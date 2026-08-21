/**
 * "Everyone's in" — the claim a shared challenge could not keep.
 *
 * tryStartForming starts a challenge on the SECOND accept (creator + one) and
 * deliberately leaves outstanding invitees on the roster to join mid-race. The
 * challenge_started copy predated that rule and still announced "everyone's in",
 * so a group of five with a single acceptance was told the whole group had
 * joined. Reported from the app on 2026-08-21.
 *
 * This pins the sentence selection. The builder itself lives in the Deno edge
 * function; the rule it encodes is reproduced here exactly.
 */

/** Mirrors the body selection in send-push-notification's challenge_started case. */
export function challengeStartedBody(
  title: string,
  acceptedCount: number,
  totalCount: number,
): string {
  const inCount = Math.max(0, Math.round(Number(acceptedCount ?? 0)));
  const rosterCount = Math.max(0, Math.round(Number(totalCount ?? 0)));
  const stillOut = Math.max(0, rosterCount - inCount);
  return inCount > 0 && stillOut > 0
    ? `"${title}" has started with ${inCount} of ${rosterCount} in — the others can still join. Get your part done.`
    : inCount > 0
      ? `"${title}" has started — everyone's in. Get your part done.`
      : `"${title}" has started. Get your part done.`;
}

describe('challenge_started copy', () => {
  it('never claims everyone is in while invites are outstanding', () => {
    // The reported case: a group of five, one person has accepted.
    const body = challengeStartedBody('Four of a Kind', 2, 5);
    expect(body).not.toContain("everyone's in");
    expect(body).toContain('2 of 5 in');
    expect(body).toContain('the others can still join');
  });

  it('does claim everyone is in when the roster really is complete', () => {
    expect(challengeStartedBody('Just Run', 5, 5)).toContain("everyone's in");
  });

  it('reads correctly for the two-person case', () => {
    // A board take, or a pair: 2 of 2 is genuinely everyone.
    expect(challengeStartedBody('Just Run', 2, 2)).toContain("everyone's in");
  });

  it('falls back to a neutral line when counts are missing', () => {
    // An older caller that sends no counts must not get the claim by default.
    const body = challengeStartedBody('Just Run', 0, 0);
    expect(body).not.toContain("everyone's in");
    expect(body).toBe('"Just Run" has started. Get your part done.');
  });

  it('never renders a negative or nonsense remainder', () => {
    // Defensive: counts arriving inconsistent must not produce "5 of 2".
    expect(challengeStartedBody('X', 5, 2)).toContain("everyone's in");
  });
});
