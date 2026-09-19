import { useCallback, useEffect, useState } from 'react';

import { localDateStr } from '@/lib/api/activity';

/** Local midnight `days` after `base`. */
export function addDays(base: Date, days: number): Date {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * A `YYYY-MM-DD` heatmap key as a Date. Parsed at local NOON, never midnight:
 * a bare date string parses as UTC, which is the neighbouring day anywhere west
 * of Greenwich.
 */
export function dayFromKey(key: string): Date {
    return new Date(`${key}T12:00:00`);
}

/**
 * State behind the tappable week bars and month cells: one tap on a day opens
 * that day's PointsBreakdownSheet directly.
 *
 * There used to be a step in between — the tap showed a caption line under the
 * chart and the caption opened the sheet. The caption said nothing the sheet's
 * first screen doesn't, and at 12px it didn't read as a button, so the sheet went
 * undiscovered. Comparing days, the one thing the caption was good at, now
 * happens inside the sheet: `days` is every tappable day on the chart, in order,
 * and the sheet steps through them.
 *
 * Two pieces of state, because they end at different times. `day` is the open
 * sheet and clears on close. `markedKey` is the chart's selection mark — it
 * follows the sheet as it steps and OUTLIVES the close, so the chart still shows
 * where you were. It clears when `resetKey` changes, i.e. when the chart stops
 * showing the same days.
 */
export function useDaySelection(resetKey: string) {
    const [day, setDay] = useState<Date | null>(null);
    const [days, setDays] = useState<Date[]>([]);
    const [marked, setMarked] = useState<Date | null>(null);

    useEffect(() => { setMarked(null); }, [resetKey]);

    const open = useCallback((d: Date, navigable: Date[]) => {
        setDays(navigable);
        setMarked(d);
        setDay(d);
    }, []);
    const step = useCallback((d: Date) => {
        setMarked(d);
        setDay(d);
    }, []);
    const close = useCallback(() => setDay(null), []);

    return {
        /** The day the sheet is pinned to; null = closed. */
        day,
        /** Every tappable day on the chart the sheet was opened from, ascending. */
        days,
        /** Local date key of the day to mark on the chart. */
        markedKey: marked ? localDateStr(marked) : null,
        open,
        step,
        close,
    };
}
