/**
 * useChallengeSettled — the one-shot "the challenge is over and your bonus is
 * banked" trigger.
 *
 * The distinction under test is settlement (`settled_at` stamped by the resolve
 * cron / pooled evaluator) versus the pre-existing `newlyCompletedId` signal,
 * which fires when you finish YOUR part — for a parallel challenge, up to 72h
 * before the group bonus exists.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useChallengeSettled } from '@/hooks/useChallengeSettled';
import type { Participant, SharedChallenge } from '@/lib/social/types';

const mockUser: { id: string; email: string } = { id: 'me', email: 'someone@example.com' };
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const seenKey = (id: string) => `@powr/challenge_settled_seen/${id}`;
const SEEDED = '@powr/challenge_settled_seeded:me';

function participant(id: string, opts: Partial<Participant> = {}): Participant {
  return {
    friend: { id, username: id, displayName: id, status: 'accepted' },
    state: 'completed',
    progress: 1,
    completed: true,
    ...opts,
  };
}

function challenge(overrides: Partial<SharedChallenge> = {}): SharedChallenge {
  return {
    id: 'ch1',
    template: {
      id: 't1',
      category: 'gym',
      categoryLabel: 'Gym',
      icon: { lib: 'ion', name: 'barbell' },
      tier: 'medium',
      title: 'Back Again',
      goal: 'Check in on 7 different days',
      basePoints: 30,
      mode: 'solo',
    },
    kind: 'parallel',
    status: 'completed',
    creatorId: 'me',
    participants: [participant('me', { isSelf: true }), participant('f1')],
    expiresIn: 'done',
    settledAt: '2026-07-27T10:00:00Z',
    ...overrides,
  };
}

/** Pretend the account has already been through a first run. */
async function markSeeded() {
  await AsyncStorage.setItem(SEEDED, '1');
}

describe('useChallengeSettled', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser.email = 'someone@example.com';
  });

  it('seeds silently on first run — no celebration for challenges settled before the feature shipped', async () => {
    const all = [challenge()];
    const { result } = renderHook(() => useChallengeSettled(all));

    await waitFor(async () => expect(await AsyncStorage.getItem(SEEDED)).toBe('1'));
    expect(await AsyncStorage.getItem(seenKey('ch1'))).toBe('1');
    expect(result.current.pending).toBeNull();
  });

  it('seeds an account that has nothing settled yet, so its FIRST real settlement still fires', async () => {
    // Regression: seeding used to sit behind an empty-candidates bail, which
    // left a challenge-less account un-seeded — and then swallowed the very
    // first settlement it ever had as if it predated the feature.
    const { rerender } = renderHook(
      ({ all }: { all: SharedChallenge[] }) => useChallengeSettled(all),
      { initialProps: { all: [] as SharedChallenge[] } },
    );
    await waitFor(async () => expect(await AsyncStorage.getItem(SEEDED)).toBe('1'));

    const settled = [challenge()];
    const { result } = renderHook(() => useChallengeSettled(settled));
    rerender({ all: settled });
    await waitFor(() => expect(result.current.pending?.id).toBe('ch1'));
  });

  it('does not seed off a list that has not loaded yet', async () => {
    // `all` is empty during the first fetch. Seeding there would mark the
    // account initialised, and the settled challenge arriving a beat later
    // would be treated as pre-existing and never celebrated.
    const { rerender } = renderHook(
      ({ all, loading }: { all: SharedChallenge[]; loading: boolean }) =>
        useChallengeSettled(all, loading),
      { initialProps: { all: [] as SharedChallenge[], loading: true } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(await AsyncStorage.getItem(SEEDED)).toBeNull();

    rerender({ all: [challenge()], loading: false });
    await waitFor(async () => expect(await AsyncStorage.getItem(SEEDED)).toBe('1'));
    // Settled before we were watching → seeded as seen, not announced.
    expect(await AsyncStorage.getItem(seenKey('ch1'))).toBe('1');
  });

  it('fires once on a newly settled challenge, and ack persists so it never replays', async () => {
    await markSeeded();
    const all = [challenge()];

    const { result, rerender } = renderHook(() => useChallengeSettled(all));
    await waitFor(() => expect(result.current.pending?.id).toBe('ch1'));

    await act(async () => result.current.ack());
    expect(result.current.pending).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(seenKey('ch1'))).toBe('1'));

    // A refetch delivering the same settled challenge must not re-announce it.
    rerender({});
    await waitFor(() => expect(result.current.pending).toBeNull());
  });

  it('stays silent for a challenge the user did not finish', async () => {
    await markSeeded();
    const all = [
      challenge({
        participants: [
          participant('me', { isSelf: true, completed: false, state: 'accepted', progress: 0.4 }),
          participant('f1'),
        ],
      }),
    ];

    const { result } = renderHook(() => useChallengeSettled(all));
    // Give the effect a tick to do the wrong thing if it's going to.
    await act(async () => { await Promise.resolve(); });
    expect(result.current.pending).toBeNull();
  });

  it('stays silent while the challenge is still live', async () => {
    await markSeeded();
    // Completed your part mid-challenge: settled_at is still null, so this is
    // the `newlyCompletedId` moment, not this hook's.
    const all = [challenge({ status: 'active', settledAt: null })];

    const { result } = renderHook(() => useChallengeSettled(all));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.pending).toBeNull();
  });

  it('celebrates the older settlement first when two land together', async () => {
    await markSeeded();
    const all = [
      challenge({ id: 'newer', settledAt: '2026-07-27T18:00:00Z' }),
      challenge({ id: 'older', settledAt: '2026-07-27T09:00:00Z' }),
    ];

    const { result } = renderHook(() => useChallengeSettled(all));
    await waitFor(() => expect(result.current.pending?.id).toBe('older'));

    await act(async () => result.current.ack());
    await waitFor(() => expect(result.current.pending?.id).toBe('newer'));
  });

  it('preview replays without consuming the challenge’s seen-marker', async () => {
    await markSeeded();
    mockUser.email = 'jamiemasonwright@gmail.com';
    // A LIVE challenge: the real path can never fire for it, so anything that
    // shows up is the preview — and any marker written is the preview leaking.
    const all = [challenge({ status: 'active', settledAt: null })];

    const { result } = renderHook(() => useChallengeSettled(all));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.pending).toBeNull();

    await act(async () => result.current.preview());
    expect(result.current.pending?.id).toBe('ch1');

    await act(async () => result.current.ack());
    expect(result.current.pending).toBeNull();
    expect(await AsyncStorage.getItem(seenKey('ch1'))).toBeNull();
  });

  it('preview is inert for non-dev accounts', async () => {
    await markSeeded();
    const all = [challenge({ status: 'active', settledAt: null })];

    const { result } = renderHook(() => useChallengeSettled(all));
    await act(async () => result.current.preview());
    expect(result.current.pending).toBeNull();
  });
});
