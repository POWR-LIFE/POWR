/**
 * starterCrew (lib/social/crew.ts) — the crew pitched on the starter cards and
 * preselected when one is tapped. Usual crew leads, the rest of the invitable
 * friends fill the remaining slots; never anyone the create sheet would then
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

  it('leads with the last crew, in its own order', () => {
    expect(starterCrew([elliot, sorine, casey], ['sorine', 'elliot'], 2)).toEqual([sorine, elliot]);
  });

  it('tops a short last crew up from the other invitable friends', () => {
    // One small challenge must not shrink the pitch to that single friend on
    // every card — the usual crew leads, everyone else fills the empty slots.
    expect(starterCrew([elliot, sorine, casey], ['casey'])).toEqual([casey, elliot, sorine]);
  });

  it('never repeats a friend already in the last crew', () => {
    const crew = starterCrew([elliot, sorine, casey], ['sorine']);
    expect(crew.map((f) => f.id)).toEqual(['sorine', 'elliot', 'casey']);
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
