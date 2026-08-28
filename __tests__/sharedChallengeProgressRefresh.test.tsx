import { renderHook, waitFor } from '@testing-library/react-native';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockMaybeSingle = jest.fn();
const mockOrder = jest.fn();

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
  useAuthOptional: () => ({ user: { id: 'me' } }),
}));
jest.mock('@/hooks/useFriends', () => ({
  useFriends: () => ({ friends: [], search: jest.fn(), sendRequest: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockMaybeSingle(),
          order: () => mockOrder(),
        }),
      }),
    }),
  },
}));

const challenge = (contribution: number) => ({
  id: 'challenge-1',
  creator_id: 'me',
  kind: 'pooled',
  category: 'walking',
  status: 'active',
  ends_at: '2026-07-20T00:00:00.000Z',
  template: { id: 'steps', tier: 'easy', title: '35k steps', pool: { target: 35000, unit: 'steps' } },
  rule: { metric: 'steps', target: 35000 },
  participants: [{
    user_id: 'me', username: 'me', display_name: 'Me', state: 'accepted',
    progress: 0, contribution, completed: false, is_self: true,
  }],
});

describe('useSharedChallenges pooled progress refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: { per_head: 5, max_bonus: 30, challenge_cap: 3 } });
    mockOrder.mockResolvedValue({ data: [] });
    mockRpc
      .mockResolvedValue({ data: [challenge(12000)], error: null })
      .mockResolvedValueOnce({ data: [challenge(0)], error: null });
    mockInvoke.mockResolvedValue({ data: { ok: true, newly_completed: false, pool_total: 12000 } });
  });

  it('reloads after evaluation when the pool has progress but is not complete', async () => {
    const { result } = renderHook(() => useSharedChallenges());

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      'complete-shared-challenge',
      expect.objectContaining({ body: expect.objectContaining({ challenge_id: 'challenge-1' }) }),
    ));
    await waitFor(() => expect(result.current.all[0]?.pool?.total).toBe(12000));
  });
});
