import React from 'react';
import { AppState } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePoints } from '@/hooks/usePoints';
import { emitPointsChanged } from '@/lib/pointsEvents';

const mockSessionListeners = new Set<() => void>();
jest.mock('@/context/GeofenceContext', () => ({
  onSessionCompleted: (l: () => void) => {
    mockSessionListeners.add(l);
    return () => mockSessionListeners.delete(l);
  },
}));
jest.mock('@/lib/api/points', () => ({
  fetchPointsSummary: jest.fn(async () => ({
    balance: 10, todayEarned: 0, weeklyEarned: 0, monthlyEarned: 0,
    totalEarned: 10, vaultPending: 0, vaultNextVestAt: null,
  })),
}));

describe('usePoints refresh triggers', () => {
  let client: QueryClient;
  let invalidate: jest.SpyInstance;
  let appStateHandlers: ((s: string) => void)[];
  let appStateRemovals: jest.Mock;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidate = jest.spyOn(client, 'invalidateQueries');
    appStateHandlers = [];
    appStateRemovals = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, h: (s: string) => void) => {
      appStateHandlers.push(h);
      return { remove: appStateRemovals };
    }) as any);
  });

  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('fires one invalidate per trigger however many consumers are mounted', () => {
    const consumers = [1, 2, 3, 4, 5].map(() => renderHook(() => usePoints(), { wrapper }));

    expect(appStateHandlers).toHaveLength(1);
    expect(mockSessionListeners.size).toBe(1);

    emitPointsChanged();
    expect(invalidate).toHaveBeenCalledTimes(1);

    mockSessionListeners.forEach((l) => l());
    expect(invalidate).toHaveBeenCalledTimes(2);

    appStateHandlers[0]('active');
    expect(invalidate).toHaveBeenCalledTimes(3);
    appStateHandlers[0]('background');
    expect(invalidate).toHaveBeenCalledTimes(3);

    consumers.forEach((c) => c.unmount());
  });

  it('keeps the triggers while any consumer is mounted and drops them after the last', () => {
    const a = renderHook(() => usePoints(), { wrapper });
    const b = renderHook(() => usePoints(), { wrapper });

    a.unmount();
    emitPointsChanged();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(appStateRemovals).not.toHaveBeenCalled();

    b.unmount();
    expect(appStateRemovals).toHaveBeenCalledTimes(1);
    expect(mockSessionListeners.size).toBe(0);
    emitPointsChanged();
    expect(invalidate).toHaveBeenCalledTimes(1);

    // A later mount subscribes afresh.
    const c = renderHook(() => usePoints(), { wrapper });
    emitPointsChanged();
    expect(invalidate).toHaveBeenCalledTimes(2);
    c.unmount();
  });
});
