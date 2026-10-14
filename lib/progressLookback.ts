import i18n from 'i18next';

// ─── Progress-page lookback anchors ──────────────────────────────────────────
// The D/W/M breakdown views can step back through history. `offset` counts
// periods back from now: 0 = current, -1 = previous, and so on. All anchors
// are local-midnight Dates, matching how the activity fetchers bucket days.

export type LookbackPeriod = 'D' | 'W' | 'M';

// Month and weekday names come from the progress catalog: Intl's en-GB writes
// "Sept", and English must keep printing "Sep".
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const shortMonth = (d: Date) => i18n.t(`progress:months.short.${MONTH_KEYS[d.getMonth()]}`);
const yearSuffix = (d: Date) => (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '');

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
    return i18n.t('progress:lookback.shortDate', { month: shortMonth(d), day: d.getDate(), year: yearSuffix(d) });
}

function shortRange(start: Date, end: Date): string {
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return i18n.t('progress:lookback.sameMonthRange', {
            month: shortMonth(start), startDay: start.getDate(), endDay: end.getDate(), year: yearSuffix(start),
        });
    }
    return `${shortDate(start)} – ${shortDate(end)}`;
}

/**
 * Human label for a calendar month, e.g. "This Month", "June", "June 2025".
 * The year is only shown once it differs from the current one.
 */
export function monthLabel(offset: number): string {
    if (offset === 0) return i18n.t('progress:lookback.thisMonth');
    const start = monthAnchorStart(offset);
    return i18n.t('progress:lookback.monthYear', {
        month: i18n.t(`progress:months.full.${MONTH_KEYS[start.getMonth()]}`), year: yearSuffix(start),
    });
}

/** Human label for the stepper, e.g. "This Week", "Jun 16 – 22", "Tue Jul 8". */
export function rangeLabel(period: LookbackPeriod, offset: number): string {
    if (period === 'D') {
        if (offset === 0) return i18n.t('progress:lookback.today');
        if (offset === -1) return i18n.t('progress:lookback.yesterday');
        const d = dayAnchor(offset);
        return `${i18n.t(`progress:days.short.${DAY_KEYS[d.getDay()]}`)} ${shortDate(d)}`;
    }
    if (period === 'W') {
        if (offset === 0) return i18n.t('progress:lookback.thisWeek');
        const start = weekAnchorMonday(offset);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return shortRange(start, end);
    }
    return monthLabel(offset);
}
