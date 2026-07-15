// ─── Progress-page lookback anchors ──────────────────────────────────────────
// The D/W/M breakdown views can step back through history. `offset` counts
// periods back from now: 0 = current, -1 = previous, and so on. All anchors
// are local-midnight Dates, matching how the activity fetchers bucket days.

export type LookbackPeriod = 'D' | 'W' | 'M';

/** The M view is a trailing window, not a calendar month — one step = 30 days. */
export const MONTH_WINDOW_DAYS = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localMidnight(base: Date): Date {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Local calendar day the D view is anchored to (offset 0 = today). */
export function dayAnchor(offset: number): Date {
    const d = localMidnight(new Date());
    d.setDate(d.getDate() + offset);
    return d;
}

/** Monday (local midnight) of the week the W view is anchored to. */
export function weekAnchorMonday(offset: number): Date {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = localMidnight(now);
    monday.setDate(monday.getDate() + mondayOffset + offset * 7);
    return monday;
}

/** Final day (local midnight) of the 30-day window the M view is anchored to. */
export function monthAnchorEnd(offset: number): Date {
    const d = localMidnight(new Date());
    d.setDate(d.getDate() + offset * MONTH_WINDOW_DAYS);
    return d;
}

function shortDate(d: Date): string {
    const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

function shortRange(start: Date, end: Date): string {
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return `${shortDate(start)} – ${end.getDate()}`;
    }
    return `${shortDate(start)} – ${shortDate(end)}`;
}

/** Human label for the stepper, e.g. "This Week", "Jun 16 – 22", "Tue Jul 8". */
export function rangeLabel(period: LookbackPeriod, offset: number): string {
    if (period === 'D') {
        if (offset === 0) return 'Today';
        if (offset === -1) return 'Yesterday';
        const d = dayAnchor(offset);
        const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
        return `${weekday} ${shortDate(d)}`;
    }
    if (period === 'W') {
        if (offset === 0) return 'This Week';
        const start = weekAnchorMonday(offset);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return shortRange(start, end);
    }
    if (offset === 0) return 'Last 30 Days';
    const end = monthAnchorEnd(offset);
    const start = new Date(end);
    start.setDate(start.getDate() - (MONTH_WINDOW_DAYS - 1));
    return shortRange(start, end);
}
