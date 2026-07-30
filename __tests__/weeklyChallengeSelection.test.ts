import { selectWeeklyBoard } from '@/lib/weeklyChallengeSelection';
import type { ChallengeCardData } from '@/hooks/useWeeklyChallenge';

const NO_DAYS = [false, false, false, false, false, false, false];

function ch(overrides: Partial<ChallengeCardData> & { id: string; category: string }): ChallengeCardData {
  return {
    categoryLabel: overrides.category,
    icon: { lib: 'ion', name: 'barbell' },
    tier: 'medium',
    title: overrides.id,
    description: '',
    points: 40,
    fraction: 0,
    displayValue: 0,
    displayGoal: 3,
    unit: 'sessions',
    showDots: false,
    completed: false,
    expiresIn: '3d left',
    streak: NO_DAYS,
    overallStreak: NO_DAYS,
    todayIndex: 2,
    completeSubtitle: '',
    ...overrides,
  } as ChallengeCardData;
}

const week = (overrides: Array<Partial<ChallengeCardData> & { id: string; category: string }>) =>
  overrides.map(ch);

describe('selectWeeklyBoard', () => {
  it('fills the two slots by progress momentum and queues the rest', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym', fraction: 0.6 },
      { id: 'walk', category: 'walking', fraction: 0.2 },
      { id: 'run', category: 'running', fraction: 0.9 },
      { id: 'cycle', category: 'cycling' },
      { id: 'multi', category: 'multi' },
    ]), null);
    expect(board.active.map((c) => c.id)).toEqual(['run', 'gym']);
    expect(board.hiddenCount).toBe(3);
    expect(board.done).toHaveLength(0);
  });

  it('moves completed challenges to done and refills the slot from the queue', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym', completed: true, fraction: 1 },
      { id: 'walk', category: 'walking', fraction: 0.4 },
      { id: 'run', category: 'running', fraction: 0.1 },
      { id: 'cycle', category: 'cycling' },
      { id: 'multi', category: 'multi' },
    ]), null);
    expect(board.done.map((c) => c.id)).toEqual(['gym']);
    expect(board.active.map((c) => c.id)).toEqual(['walk', 'run']);
    expect(board.hiddenCount).toBe(2);
  });

  it('seats a zero-signal week from the stored relevance order', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym' },
      { id: 'walk', category: 'walking' },
      { id: 'run', category: 'running' },
      { id: 'cycle', category: 'cycling' },
      { id: 'multi', category: 'multi' },
    ]), ['cycling', 'running', 'gym', 'walking', 'multi']);
    expect(board.active.map((c) => c.id)).toEqual(['cycle', 'run']);
    expect(board.derivedOrder).toBeNull(); // quiet week never overwrites the memory
  });

  it('falls back to the easiest tier with no signal and no memory', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym', tier: 'hard' },
      { id: 'walk', category: 'walking', tier: 'easy' },
      { id: 'run', category: 'running', tier: 'medium' },
    ]), null);
    expect(board.active.map((c) => c.id)).toEqual(['walk', 'run']);
  });

  it('breaks fraction ties with category-active days', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym', streak: [true, true, false, false, false, false, false] },
      { id: 'walk', category: 'walking', streak: [true, false, false, false, false, false, false] },
      { id: 'run', category: 'running' },
    ]), null);
    expect(board.active.map((c) => c.id)).toEqual(['gym', 'walk']);
  });

  it('does not let multi day-counts outrank genuine goal progress', () => {
    const board = selectWeeklyBoard(week([
      { id: 'multi', category: 'multi', streak: [true, true, true, true, false, false, false] },
      { id: 'gym', category: 'gym', fraction: 0.34 },
      { id: 'run', category: 'running' },
    ]), null);
    expect(board.active[0].id).toBe('gym');
  });

  it('derives an order that ranks signal first and preserves stored standing for quiet categories', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym', fraction: 0.5 },
      { id: 'walk', category: 'walking' },
      { id: 'run', category: 'running' },
      { id: 'cycle', category: 'cycling' },
    ]), ['running', 'cycling', 'walking']);
    expect(board.derivedOrder).toEqual(['gym', 'running', 'cycling', 'walking']);
  });

  it('shrinks gracefully at the end of the week', () => {
    const board = selectWeeklyBoard(week([
      { id: 'gym', category: 'gym', completed: true, fraction: 1 },
      { id: 'walk', category: 'walking', completed: true, fraction: 1 },
      { id: 'run', category: 'running', completed: true, fraction: 1 },
      { id: 'cycle', category: 'cycling', completed: true, fraction: 1 },
      { id: 'multi', category: 'multi', fraction: 0.5 },
    ]), null);
    expect(board.active.map((c) => c.id)).toEqual(['multi']);
    expect(board.hiddenCount).toBe(0);
    expect(board.done).toHaveLength(4);
  });
});
