/**
 * Open challenge board — the rules that decide whether a stranger race is fair.
 *
 * The one that matters most is the clock. A shared challenge normally backdates
 * its qualifying window to CREATION, so activity done while invites sat
 * unanswered still counts. Carried unchanged onto the board, that rule is an
 * exploit: post an open challenge, do the work while it waits on the shelf, and
 * you are already finished the moment someone takes it.
 */
import {
  challengeStartsAt,
  shouldKeepForming,
  unclaimedOpenPostGoesSolo,
} from '@/supabase/functions/_shared/sharedChallengeLifecycle';

const NOW = new Date('2026-08-21T18:00:00.000Z');
const TWO_DAYS_AGO = '2026-08-19T18:00:00.000Z';

describe('challengeStartsAt', () => {
  it('backdates an invited challenge to its creation', () => {
    // Everything the group did while an invite went unanswered still counts.
    expect(challengeStartsAt({ created_at: TWO_DAYS_AGO }, NOW)).toBe(TWO_DAYS_AGO);
  });

  it('starts an OPEN board challenge at the take, never at the post', () => {
    // The creator sat on the shelf for two days. None of it counts.
    expect(challengeStartsAt({ is_open: true, created_at: TWO_DAYS_AGO }, NOW))
      .toBe(NOW.toISOString());
  });

  it('gives an open post no head start even when taken instantly', () => {
    const posted = { is_open: true, created_at: NOW.toISOString() };
    expect(challengeStartsAt(posted, NOW)).toBe(NOW.toISOString());
  });

  it('treats a null/absent is_open as the ordinary invited rule', () => {
    expect(challengeStartsAt({ is_open: null, created_at: TWO_DAYS_AGO }, NOW)).toBe(TWO_DAYS_AGO);
    expect(challengeStartsAt({ is_open: false, created_at: TWO_DAYS_AGO }, NOW)).toBe(TWO_DAYS_AGO);
  });

  it('falls back to now when a challenge has no creation stamp', () => {
    expect(challengeStartsAt({}, NOW)).toBe(NOW.toISOString());
    expect(challengeStartsAt({ created_at: null }, NOW)).toBe(NOW.toISOString());
  });
});

describe('shouldKeepForming', () => {
  // The cron sweeps EVERY forming row. An open post has no invitees, so without
  // its own clause it read as "nobody is coming" and was cancelled on the first
  // sweep after posting — the board emptied before a single user saw it.
  it('keeps an open post alive while its window is open', () => {
    expect(shouldKeepForming({ isOpen: true, invitedLeft: 0 }, false)).toBe(true);
  });

  it('keeps an invited challenge alive while answers are outstanding', () => {
    expect(shouldKeepForming({ isOpen: false, invitedLeft: 2 }, false)).toBe(true);
  });

  it('lets an untaken open post die once the window elapses', () => {
    expect(shouldKeepForming({ isOpen: true, invitedLeft: 0 }, true)).toBe(false);
  });

  it('lets a ghosted invite die once the window elapses', () => {
    expect(shouldKeepForming({ isOpen: false, invitedLeft: 3 }, true)).toBe(false);
  });

  it('cancels a challenge nobody is waiting on', () => {
    expect(shouldKeepForming({ isOpen: false, invitedLeft: 0 }, false)).toBe(false);
  });
});

describe('unclaimedOpenPostGoesSolo', () => {
  // At launch scale most posts go untaken, so "cancelled" would have been the
  // modal last word the board ever said to a first-time user. It converts.
  it('converts an untaken post once its window elapses', () => {
    expect(unclaimedOpenPostGoesSolo({ is_open: true }, true)).toBe(true);
  });

  it('leaves a post alone while its window is still open', () => {
    expect(unclaimedOpenPostGoesSolo({ is_open: true }, false)).toBe(false);
  });

  it('never converts an ordinary invited challenge', () => {
    // A group challenge nobody accepted still cancels — there was no solo
    // intent to preserve, and its creator picked people, not a shelf.
    expect(unclaimedOpenPostGoesSolo({ is_open: false }, true)).toBe(false);
    expect(unclaimedOpenPostGoesSolo({}, true)).toBe(false);
  });
});
