// ─── Progress-page lookback anchors ──────────────────────────────────────────
// The D/W/M breakdown views can step back through history. `offset` counts
// periods back from now: 0 = current, -1 = previous, and so on. All anchors
// are local-midnight Dates, matching how the activity fetchers bucket days.

export type LookbackPeriod = 'D' | 'W' | 'M';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

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

/** First day (local midnight) of the calendar month the M view is anchored to. */
export function monthAnchorStart(offset: number): Date {
    const now = new Date();
    // Built from (year, month, 1) rather than setMonth() on today's date: on the
    // 31st, setMonth(-1) overflows ("Jun 31" → Jul 1) and lands on the wrong
    // month entirely. The constructor normalises out-of-range months for free,
    // so offset -7 in January correctly rolls back into the previous year.
    return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

/**
 * Last day (local midnight, inclusive) of the calendar month the M view is
 * anchored to. The CURRENT month stops at today rather than running to the
 * 31st, so the heatmap doesn't render cells for days that haven't happened yet.
 */
export function monthAnchorEnd(offset: number): Date {
    const today = localMidnight(new Date());
    // Day 0 of the following month = the last day of this one, which is how we
    // avoid hardcoding month lengths or a leap-year table.
    const lastDay = monthAnchorStart(offset + 1);
    lastDay.setDate(0);
    return lastDay > today ? today : lastDay;
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

/**
 * Human label for a calendar month, e.g. "This Month", "June", "June 2025".
 * The year is only shown once it differs from the current one.
 */
export function monthLabel(offset: number): string {
    if (offset === 0) return 'This Month';
    const start = monthAnchorStart(offset);
    const year = start.getFullYear() !== new Date().getFullYear() ? ` ${start.getFullYear()}` : '';
    return `${MONTHS_FULL[start.getMonth()]}${year}`;
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
    return monthLabel(offset);
}
