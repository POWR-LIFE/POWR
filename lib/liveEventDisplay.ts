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

/** Short status chip copy for the home card. */
export function eventStatusChip(event: Pick<LiveEvent, 'status' | 'window_start_at'>): string {
    if (event.status !== 'scheduled') return 'LIVE NOW';
    const days = Math.max(0, Math.ceil((new Date(event.window_start_at).getTime() - Date.now()) / 86_400_000));
    if (days === 0) return 'STARTS TODAY';
    if (days === 1) return 'STARTS TOMORROW';
    return `IN ${days} DAYS`;
}

/** Promo media is one URL that may be a video or a still — route by extension. */
export function isVideoUrl(url: string | null | undefined): boolean {
    return !!url && /\.(mp4|m3u8|webm|mov)(\?|#|$)/i.test(url);
}
