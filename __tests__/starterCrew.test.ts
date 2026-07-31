/**
 * starterCrew (lib/social/crew.ts) — the crew pitched on the empty-state
 * starter cards and preselected when one is tapped. Usual crew first, first
 * invitable friends as the fallback; never anyone the create sheet would then
 * refuse (pending, blocked, or together-disabled).
 */

import { starterCrew } from '@/lib/social/crew';
import type { Friend } from '@/lib/social/types';

const friend = (id: string, over: Partial<Friend> = {}): Friend => ({
  id,
  username: id,
  displayName: id.toUpperCase(),
  status: 'accepted',
  ...over,
});

describe('starterCrew', () => {
  const elliot = friend('elliot');
  const sorine = friend('sorine');
  const casey = friend('casey');

  it('maps the last crew to friends when available', () => {
    expect(starterCrew([elliot, sorine, casey], ['sorine', 'elliot'])).toEqual([sorine, elliot]);
  });

  it('falls back to first invitable friends for a first-time creator', () => {
    expect(starterCrew([elliot, sorine, casey], [])).toEqual([elliot, sorine, casey]);
  });

  it('caps the crew size', () => {
    expect(starterCrew([elliot, sorine, casey], [], 2)).toEqual([elliot, sorine]);
  });

  it('drops non-invitable friends everywhere', () => {
    const pending = friend('pending', { status: 'pending' });
    const optedOut = friend('optout', { togetherEnabled: false });
    // Fallback path skips them…
    expect(starterCrew([pending, optedOut, casey], [])).toEqual([casey]);
    // …and a stale last-crew id can't resurrect them.
    expect(starterCrew([pending, optedOut, casey], ['optout', 'casey'])).toEqual([casey]);
  });

  it('ignores last-crew ids that are no longer friends', () => {
    expect(starterCrew([casey], ['gone', 'also-gone'])).toEqual([casey]);
  });

  it('is empty with no friends', () => {
    expect(starterCrew([], ['whoever'])).toEqual([]);
  });
});
