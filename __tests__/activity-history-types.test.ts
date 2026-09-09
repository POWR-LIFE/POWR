/**
 * historyTypesFrom (lib/api/activity.ts): the pure reducer behind
 * fetchActivityHistoryTypes, which decides which activities have EVER had a
 * session and therefore earn a Progress radial.
 */
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
  getSessionUser: jest.fn(),
}));
jest.mock('@/lib/device', () => ({ getDeviceId: jest.fn() }));
jest.mock('@/lib/pointsEvents', () => ({ emitPointsChanged: jest.fn() }));

import { historyTypesFrom } from '@/lib/api/activity';

describe('historyTypesFrom', () => {
  it('includes only types with at least one session', () => {
    const set = historyTypesFrom([['gym', 3], ['running', 0], ['walking', 120]], []);
    expect([...set].sort()).toEqual(['gym', 'walking']);
  });

  it('counts suppressed workouts as history for their type (a run inside a gym visit is a run)', () => {
    const set = historyTypesFrom([['gym', 1], ['running', 0]], ['running', 'running']);
    expect([...set].sort()).toEqual(['gym', 'running']);
  });

  it('ignores sleep and unknown suppressed types', () => {
    const set = historyTypesFrom([], ['sleep', 'bogus']);
    expect(set.size).toBe(0);
  });

  it('is empty for a brand-new user', () => {
    expect(historyTypesFrom([['gym', 0], ['running', 0]], []).size).toBe(0);
  });
});
