import type { LiveEvent } from '@/lib/api/liveEvents';

/**
 * Shared display formatting for live-event surfaces (home card, register
 * sheet, league tab). One place so every surface agrees on how a window
 * reads — especially the half-open [start, end) boundary.
 */

export function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The window is half-open [start, end) — show the last day people can score, not the boundary. */
export function lastDayOf(endIso: string): string {
    return shortDate(new Date(new Date(endIso).getTime() - 60_000).toISOString());
}

export function eventDateRange(event: Pick<LiveEvent, 'window_start_at' | 'window_end_at'>): string {
    return `${shortDate(event.window_start_at)} – ${lastDayOf(event.window_end_at)}`;
}

/**
 * The home card's date line. `window_start_at` is when SCORING opens, which
 * for a venue event is typically the week BEFORE the night itself — so a bare
 * "Thu 27 Aug" there reads as the date of the event and sends people to the
 * wrong day. Name what the date actually is, every time.
 *
 * Once the window is open "starts" is behind us, so the live half names the
 * deadline that's left instead — the same last-scoring-day the League header
 * uses, so the two surfaces can never quote different days.
 */
export function scoringLine(
    event: Pick<LiveEvent, 'status' | 'window_start_at' | 'window_end_at'>,
): string {
    return event.status === 'scheduled'
        ? `Scoring starts ${shortDate(event.window_start_at)}`
        : `Scoring ends ${lastDayOf(event.window_end_at)}`;
}

/**
 * Short status chip copy for the home card.
 *
 * Every branch names SCORING as the thing being counted to. A bare "IN 6
 * DAYS" reads as "the event is in 6 days" — and for a venue event the night
 * itself is a week the other side of that, so the chip was quietly pointing
 * at the wrong date in the same way the bare start date was.
 */
export function eventStatusChip(event: Pick<LiveEvent, 'status' | 'window_start_at'>): string {
    if (event.status !== 'scheduled') return 'LIVE NOW';
    const days = Math.max(0, Math.ceil((new Date(event.window_start_at).getTime() - Date.now()) / 86_400_000));
    if (days === 0) return 'SCORING TODAY';
    if (days === 1) return 'SCORING TOMORROW';
    return `SCORING IN ${days} DAYS`;
}

/** Promo media is one URL that may be a video or a still — route by extension. */
export function isVideoUrl(url: string | null | undefined): boolean {
    return !!url && /\.(mp4|m3u8|webm|mov)(\?|#|$)/i.test(url);
}

/**
 * The registration consent line. Shown whenever the event has a venue — even
 * before a booking_url exists, because the admin roster export exists from
 * day one and consent has to precede the share, not the link. One place so
 * the pitch stage and any future surface can never drift on the wording.
 */
export function consentLine(event: Pick<LiveEvent, 'venue'>): string | null {
    if (!event.venue?.name) return null;
    return `By registering, your name and email are shared with ${event.venue.name} to arrange your booking.`;
}
