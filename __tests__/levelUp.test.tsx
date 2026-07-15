import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useLevelUp } from '@/hooks/useLevelUp';

const mockUser: { id: string; email: string } = { id: 'me', email: 'someone@example.com' };
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const points = { totalEarned: 0, loading: false };
jest.mock('@/hooks/usePoints', () => ({
  usePoints: () => ({ ...points }),
}));

const KEY = '@powr/level_seen:me';

describe('useLevelUp', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    points.totalEarned = 0;
    points.loading = false;
    mockUser.email = 'someone@example.com';
  });

  it('seeds silently on first run — no celebration for pre-existing levels', async () => {
    points.totalEarned = 1500; // level 3
    const { result } = renderHook(() => useLevelUp());

    await waitFor(async () => {
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual({ level: 3, totalEarned: 1500 });
    });
    expect(result.current.pending).toBeNull();
  });

  it('fires once when lifetime points cross a level boundary', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ level: 1, totalEarned: 420 }));
    points.totalEarned = 560; // level 2 starts at 500

    const { result } = renderHook(() => useLevelUp());
    await waitFor(() => expect(result.current.pending).toEqual({
      fromLevel: 1,
      toLevel: 2,
      fromXp: 420,
    }));

    // ack persists the new level so it never replays
    await act(async () => result.current.ack());
    expect(result.current.pending).toBeNull();
    await waitFor(async () => {
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual({ level: 2, totalEarned: 560 });
    });
  });

  it('collapses a multi-level jump into a single celebration to the final level', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ level: 1, totalEarned: 100 }));
    points.totalEarned = 3000; // level 4 (2500+)

    const { result } = renderHook(() => useLevelUp());
    await waitFor(() => expect(result.current.pending).toEqual({
      fromLevel: 1,
      toLevel: 4,
      fromXp: 100,
    }));
  });

  it('quietly follows the level down after a points reversal', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ level: 2, totalEarned: 520 }));
    points.totalEarned = 480; // back under the level-2 gate

    const { result } = renderHook(() => useLevelUp());
    await waitFor(async () => {
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual({ level: 1, totalEarned: 480 });
    });
    expect(result.current.pending).toBeNull();
  });

  it('preview only works for the dev test account', async () => {
    points.totalEarned = 1500;
    const { result } = renderHook(() => useLevelUp());
    await waitFor(async () => expect(await AsyncStorage.getItem(KEY)).not.toBeNull());

    act(() => result.current.preview());
    expect(result.current.pending).toBeNull();

    mockUser.email = 'jamiemasonwright@gmail.com';
    const dev = renderHook(() => useLevelUp());
    act(() => dev.result.current.preview());
    expect(dev.result.current.pending).toMatchObject({ fromLevel: 2, toLevel: 3 });
  });
});
