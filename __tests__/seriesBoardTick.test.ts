/**
 * The Series board's live tick (lib/api/series): one channel for the runtime,
 * every board on screen hears it, and a burst of ticks is one re-read.
 */
import { act, renderHook } from '@testing-library/react-native';

type Listener = (msg: { payload: unknown }) => void;
const mockListeners: Listener[] = [];
const mockChannel = {
    topic: 'realtime:series-board',
    on: jest.fn((_t: string, _f: unknown, cb: Listener) => { mockListeners.push(cb); return mockChannel; }),
    subscribe: jest.fn(() => mockChannel),
};
const mockChannelFactory = jest.fn(() => mockChannel);
const mockRpc = jest.fn(async () => ({ data: { state: 'running', rows: [] }, error: null }));
jest.mock('@/lib/supabase', () => ({
    supabase: {
        rpc: (...a: unknown[]) => mockRpc(...a),
        channel: (...a: unknown[]) => mockChannelFactory(...a),
        getChannels: () => [],
        auth: { onAuthStateChange: jest.fn() },
    },
}));
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (k: string) => k }, getFormatLocale: () => 'en-GB' }));

import { subscribeSeriesTicks, useSeriesBoard } from '@/lib/api/series';

const tick = () => mockListeners.forEach(l => l({ payload: {} }));

beforeEach(() => { mockRpc.mockClear(); });

describe('the mockChannel', () => {
    it('is made once, however many boards listen', () => {
        const offA = subscribeSeriesTicks(() => {});
        const offB = subscribeSeriesTicks(() => {});
        expect(mockChannelFactory).toHaveBeenCalledTimes(1);
        expect(mockChannelFactory).toHaveBeenCalledWith('series-board', { config: { broadcast: { self: false } } });
        expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
        offA(); offB();
    });

    it('reaches every listener, and one that throws does not stop the rest', () => {
        const heard = jest.fn();
        const offBad = subscribeSeriesTicks(() => { throw new Error('bad'); });
        const offGood = subscribeSeriesTicks(heard);
        tick();
        expect(heard).toHaveBeenCalledTimes(1);
        offBad(); offGood();
        tick();
        expect(heard).toHaveBeenCalledTimes(1);
    });
});

describe('useSeriesBoard', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('re-reads once after a burst of ticks, and still every minute', async () => {
        const { unmount } = renderHook(() => useSeriesBoard(true));
        await act(async () => {});
        expect(mockRpc).toHaveBeenCalledTimes(1);

        act(() => { tick(); tick(); tick(); });
        act(() => { jest.advanceTimersByTime(1_499); });
        expect(mockRpc).toHaveBeenCalledTimes(1);
        await act(async () => { jest.advanceTimersByTime(1); });
        expect(mockRpc).toHaveBeenCalledTimes(2);

        await act(async () => { jest.advanceTimersByTime(60_000); });
        expect(mockRpc).toHaveBeenCalledTimes(3);
        unmount();
    });

    it('stops listening when off screen', async () => {
        const { unmount } = renderHook(() => useSeriesBoard(true));
        await act(async () => {});
        unmount();
        act(() => { tick(); });
        await act(async () => { jest.advanceTimersByTime(2_000); });
        expect(mockRpc).toHaveBeenCalledTimes(1);
    });
});
