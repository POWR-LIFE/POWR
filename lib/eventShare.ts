import type { LiveEvent } from '@/lib/api/liveEvents';
import { eventInviteMessage, eventInvitePath } from '@/lib/eventInviteLink';
import { eventDateRange, eventNightLine } from '@/lib/liveEventDisplay';

/**
 * The words a shared live event travels with — the og:title/og:description
 * the /s/<id> page serves, the caption the share sheet sends, and where a
 * friend who taps the preview lands. Pure, so the wording is pinned by tests.
 *
 * An event card IS the event invite with a picture on it: the caption is
 * literally `eventInviteMessage` (code spelled out — a store install arrives
 * with nothing else) and the link lands on the EVENT, attributed to the
 * sharer, exactly like Share on the ticket card. Same promise, same words,
 * one more door.
 */

/** What the card and its copy need off a LiveEvent. */
export type EventShareEvent = Pick<
    LiveEvent,
    | 'slug'
    | 'name'
    | 'status'
    | 'logo_url'
    | 'logo_only'
    | 'window_start_at'
    | 'window_end_at'
    | 'doors_open_at'
    | 'doors_close_at'
    | 'invite_bonus_points'
    | 'promo_media_url'
    | 'promo_headline'
    | 'venue'
>;

/** Bold line of the link preview. */
export function buildEventShareTitle(event: Pick<EventShareEvent, 'name'>): string {
    return `${event.name} · Live event on POWR`;
}

/**
 * Grey line beneath it — the night (when it's set), the venue, the scoring
 * week, then the ask. The night is only ever quoted from doors_open_at; a
 * card must never substitute the scoring window for it (see eventNightLine).
 */
export function buildEventShareSubtitle(
    event: Pick<EventShareEvent, 'window_start_at' | 'window_end_at' | 'doors_open_at' | 'doors_close_at' | 'venue'>,
): string {
    const night = eventNightLine(event);
    const where = event.venue?.name ?? null;
    const lead = night
        ? `${night}${where ? ` at ${where}` : ''}. `
        : where
            ? `At ${where}. `
            : '';
    return `${lead}Scoring ${eventDateRange(event)}. Tap to get POWR and join me.`;
}

/** Where a human who taps the preview lands: this event, attributed to the sharer. */
export function buildEventSharePath(event: Pick<EventShareEvent, 'slug'>, referralCode: string | null): string {
    return eventInvitePath(event.slug, referralCode);
}

/**
 * Caption + link for the share sheet — the ticket card's invite text with
 * the card link in place of the bare smart-link, so the two can never say
 * different things about the code or the bonus.
 */
export function buildEventShareMessage(opts: {
    event: Pick<EventShareEvent, 'name' | 'invite_bonus_points'>;
    shareUrl: string;
    referralCode: string | null;
}): string {
    const { event, shareUrl, referralCode } = opts;
    return eventInviteMessage({
        eventName: event.name,
        link: shareUrl,
        code: referralCode,
        bonusPoints: event.invite_bonus_points,
    });
}
