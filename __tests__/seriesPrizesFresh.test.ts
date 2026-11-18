/**
 * The Series prizes on screen follow /admin/series (lib/api/series): read
 * again when the screen comes back into view and when the app comes back to
 * the front, a failed read keeps what's there, and a screen that opens again
 * starts from the last answer instead of "To be announced".
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

type Row = { id: string; kind: string; place: number | null; name: string; sponsor: null; detail: null; image_url: string | null; winners: number };
const row = (id: string, name: string, kind = 'place', place: number | null = 1): Row =>
    ({ id, kind, place, name, sponsor: null, detail: null, image_url: null, winners: 1 });

let mockAnswer: { data: unknown; error: unknown } = { data: [], error: null };
const mockOrder = jest.fn(async () => mockAnswer);
const mockEq = jest.fn(() => ({ order: mockOrder }));
jest.mock('@/lib/supabase', () => ({
    supabase: {
        from: () => ({ select: () => ({ eq: (...a: unknown[]) => mockEq(...a) }) }),
        rpc: jest.fn(async () => ({ data: null, error: null })),
        channel: jest.fn(),
        getChannels: () => [],
        auth: { onAuthStateChange: jest.fn() },
    },
}));
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (k: string) => k }, getFormatLocale: () => 'en-GB' }));

import { useSeriesPrizeRows, useSquadPrize } from '@/lib/api/series';

// What the app does on coming back to the front.
let appListeners: ((s: AppStateStatus) => void)[] = [];
const toFront = () => appListeners.forEach((l) => l('active'));
const withRows = (rows: Row[]) => { mockAnswer = { data: rows.map((r) => ({ ...r, series_rounds: { slug: 'x' } })), error: null }; };

beforeEach(() => {
    mockOrder.mockClear();
    mockEq.mockClear();
    appListeners = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, l) => {
        appListeners.push(l as (s: AppStateStatus) => void);
        return { remove: () => { appListeners = appListeners.filter((x) => x !== l); } } as ReturnType<typeof AppState.addEventListener>;
    });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('useSeriesPrizeRows', () => {
    it('reads the round on screen, and nothing while off screen', async () => {
        withRows([row('a', 'Healthspan Elite hamper')]);
        const { result, rerender } = renderHook(({ active }) => useSeriesPrizeRows('r-view', active), { initialProps: { active: false } });
        await act(async () => {});
        expect(mockOrder).not.toHaveBeenCalled();
        expect(result.current).toEqual([]);

        rerender({ active: true });
        await act(async () => {});
        expect(mockEq).toHaveBeenCalledWith('series_rounds.slug', 'r-view');
        expect(result.current.map((r) => r.name)).toEqual(['Healthspan Elite hamper']);
    });

    it('reads again each time the screen comes back into view', async () => {
        withRows([row('a', 'Healthspan Elite hamper')]);
        const { result, rerender } = renderHook(({ active }) => useSeriesPrizeRows('r-focus', active), { initialProps: { active: true } });
        await act(async () => {});

        rerender({ active: false });
        withRows([row('a', 'BraWow bundle')]);
        rerender({ active: true });
        await act(async () => {});
        expect(mockOrder).toHaveBeenCalledTimes(2);
        expect(result.current.map((r) => r.name)).toEqual(['BraWow bundle']);
    });

    it('reads again when the app comes back to the front', async () => {
        withRows([row('a', 'Healthspan Elite hamper')]);
        const { result, unmount } = renderHook(() => useSeriesPrizeRows('r-front', true));
        await act(async () => {});

        withRows([row('a', 'Healthspan Elite hamper'), row('b', 'Huel hamper', 'place', 2)]);
        await act(async () => { toFront(); });
        expect(result.current.map((r) => r.name)).toEqual(['Healthspan Elite hamper', 'Huel hamper']);

        unmount();
        expect(appListeners).toHaveLength(0);
    });

    it('keeps the prizes on screen when a read fails', async () => {
        withRows([row('a', 'Healthspan Elite hamper')]);
        const { result } = renderHook(() => useSeriesPrizeRows('r-fail', true));
        await act(async () => {});

        mockAnswer = { data: null, error: { message: 'offline' } };
        await act(async () => { toFront(); });
        expect(result.current.map((r) => r.name)).toEqual(['Healthspan Elite hamper']);
    });

    it('starts a screen that opens again from the last answer', async () => {
        withRows([row('a', 'Theragun Prime', 'patient_zero', null)]);
        const first = renderHook(() => useSeriesPrizeRows('r-cache', true));
        await act(async () => {});
        first.unmount();

        let resolve: (v: unknown) => void = () => {};
        mockOrder.mockImplementationOnce(() => new Promise((r) => { resolve = r; }) as never);
        const again = renderHook(() => useSeriesPrizeRows('r-cache', true));
        expect(again.result.current.map((r) => r.name)).toEqual(['Theragun Prime']);
        await act(async () => { resolve({ data: [], error: null }); });
        expect(again.result.current).toEqual([]);
    });
});

describe('useSquadPrize', () => {
    it('follows the Squad Builder row as it changes', async () => {
        withRows([row('z', 'Prize to be announced', 'patient_zero', null)]);
        const { result } = renderHook(() => useSquadPrize('r-squad', true));
        await act(async () => {});
        expect(result.current).toBeNull();

        withRows([row('z', 'Theragun Prime', 'patient_zero', null)]);
        await act(async () => { toFront(); });
        expect(result.current).toEqual({ name: 'Theragun Prime', imageUrl: null });
    });
});
