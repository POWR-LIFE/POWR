/**
 * Accepting an invite must take exactly one press.
 *
 * Field reports: "sometimes I have to press Accept twice." The detail screen
 * (where the invite push deep-links you) fired the accept and navigated back in
 * the same tick, so Home's focus refetch raced the edge function and won —
 * redrawing the invite card the user had just answered. Their second press then
 * "worked", because by then the first one had landed.
 *
 * These lock the two halves of the fix: respond() only resolves once the server
 * has the answer (so navigating on resolve is safe), it answers optimistically
 * and single-flight (so the button can't be pressed into a second call), and a
 * refusal rolls back and reports itself instead of leaving Accept sitting there.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockMaybeSingle = jest.fn();
const mockOrder = jest.fn();

// Stable identity: a fresh user object per render would re-create load() and
// re-fire its effect forever, which is the mock's bug, not the hook's.
const mockUser = { id: 'me' };
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
  useAuthOptional: () => ({ user: mockUser }),
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

const row = (selfState: string) => ({
  id: 'challenge-1',
  creator_id: 'friend',
  kind: 'parallel',
  category: 'gym',
  status: 'forming',
  ends_at: null,
  template: { id: 'gym3', tier: 'easy', title: '3 gym sessions', base_points: 40 },
  rule: { kind: 'session_count', target: 3 },
  participants: [
    {
      user_id: 'me', username: 'me', display_name: 'Me', state: selfState,
      progress: 0, completed: false, is_self: true,
    },
    {
      user_id: 'friend', username: 'friend', display_name: 'Friend', state: 'accepted',
      progress: 0, completed: false, is_self: false,
    },
  ],
});

const selfState = (result: { current: { all: { participants: { isSelf?: boolean; state: string }[] }[] } }) =>
  result.current.all[0]?.participants.find((p) => p.isSelf)?.state;

async function mountWithInvite() {
  const hook = renderHook(() => useSharedChallenges());
  await waitFor(() => expect(hook.result.current.pendingInvites).toHaveLength(1));
  return hook;
}

describe('accepting a shared-challenge invite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: { per_head: 5, max_bonus: 30, challenge_cap: 3 } });
    mockOrder.mockResolvedValue({ data: [] });
    mockRpc.mockResolvedValue({ data: [row('invited')], error: null });
  });

  it('resolves only after the server has the answer, so navigating away is safe', async () => {
    let releaseServer: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(() => new Promise((res) => { releaseServer = res; }));

    const { result } = await mountWithInvite();
    // The refetch that follows the accept sees the accepted row.
    mockRpc.mockResolvedValue({ data: [row('accepted')], error: null });

    let settled = false;
    await act(async () => {
      void result.current.acceptInvite('challenge-1').then(() => { settled = true; });
    });
    // Edge function still in flight — a screen awaiting this must still be here.
    expect(settled).toBe(false);

    await act(async () => {
      releaseServer({ data: { ok: true, state: 'accepted' }, error: null });
    });
    await waitFor(() => expect(settled).toBe(true));
    expect(selfState(result)).toBe('accepted');
  });

  it('flips the card on the first press, before the round trip finishes', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = await mountWithInvite();
    await act(async () => { void result.current.acceptInvite('challenge-1'); });

    // No server answer yet, but the invite has already stopped asking.
    expect(selfState(result)).toBe('accepted');
    expect(result.current.pendingInvites).toHaveLength(0);
    expect(result.current.responding.has('challenge-1')).toBe(true);
  });

  it('ignores a second press while the first is still in flight', async () => {
    let releaseServer: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(() => new Promise((res) => { releaseServer = res; }));

    const { result } = await mountWithInvite();
    mockRpc.mockResolvedValue({ data: [row('accepted')], error: null });

    await act(async () => {
      void result.current.acceptInvite('challenge-1');
      void result.current.acceptInvite('challenge-1');
    });
    expect(mockInvoke.mock.calls.filter((c) => c[0] === 'respond-shared-challenge')).toHaveLength(1);

    await act(async () => { releaseServer({ data: { ok: true }, error: null }); });
    await waitFor(() => expect(result.current.responding.size).toBe(0));
  });

  it('rolls the card back and reports why when the server refuses', async () => {
    const context = { json: async () => ({ error: 'Challenge slots full — finish or drop one first' }) };
    mockInvoke.mockResolvedValue({ data: null, error: Object.assign(new Error('non-2xx'), { context }) });

    const { result } = await mountWithInvite();
    // The refetch on the failure path still says invited — nothing was accepted.
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.acceptInvite('challenge-1'); });

    expect(res).toEqual({ ok: false, error: 'Challenge slots full — finish or drop one first' });
    expect(selfState(result)).toBe('invited');
    expect(result.current.pendingInvites).toHaveLength(1);
  });

  it('keeps the rollback even when the refetch itself fails', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: false, error: 'This challenge has already finished' } });

    const { result } = await mountWithInvite();
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.acceptInvite('challenge-1'); });

    expect(res?.ok).toBe(false);
    expect(res?.error).toBe('This challenge has already finished');
    expect(selfState(result)).toBe('invited');
  });
});
