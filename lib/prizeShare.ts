import type { LiveEvent, LiveEventPrize } from '@/lib/api/liveEvents';
import { eventInvitePath, inviteCodeLine } from '@/lib/eventInviteLink';
import { eventDateRange } from '@/lib/liveEventDisplay';

/**
 * The words a shared prize travels with — the og:title/og:description the
 * /s/<id> page serves, the caption the share sheet sends, and where a friend
 * who taps the preview lands. Pure, so the wording is pinned by tests.
 *
 * A prize share is an invite in disguise: the picture does the selling, the
 * caption spells the code out (a store install arrives with nothing else),
 * and the link lands on the EVENT, not the generic smart-link.
 */

export type PrizeShareEvent = Pick<
    LiveEvent,
    'slug' | 'name' | 'window_start_at' | 'window_end_at' | 'invite_bonus_points'
>;

/** "1st", "2nd", "3rd", "4th" — sentence-case, for prose. */
export function ordinal(rank: number): string {
    const mod100 = rank % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
    switch (rank % 10) {
        case 1: return `${rank}st`;
        case 2: return `${rank}nd`;
        case 3: return `${rank}rd`;
        default: return `${rank}th`;
    }
}

/** Bold line of the link preview. */
export function buildPrizeShareTitle(event: PrizeShareEvent, prize: LiveEventPrize): string {
    return `${ordinal(prize.rank)} prize · ${event.name}`;
}

/** Grey line beneath it — the prize, the week, and the ask. */
export function buildPrizeShareSubtitle(event: PrizeShareEvent, prize: LiveEventPrize): string {
    return `${prize.label} — up for grabs at ${event.name}, ${eventDateRange(event)}. Tap to get POWR and join me.`;
}

/** Where a human who taps the preview lands: this event, attributed to the sharer. */
export function buildPrizeSharePath(event: PrizeShareEvent, referralCode: string | null): string {
    return eventInvitePath(event.slug, referralCode);
}

/**
 * Caption + link for the share sheet. The code line is the same sentence the
 * event invite sends, so the promise never drifts between the two.
 */
export function buildPrizeShareMessage(opts: {
    event: PrizeShareEvent;
    prize: LiveEventPrize;
    shareUrl: string;
    referralCode: string | null;
}): string {
    const { event, prize, shareUrl, referralCode } = opts;
    const lines = [`${ordinal(prize.rank)} prize at ${event.name}: ${prize.label} 🏆`];
    lines.push(
        referralCode
            ? `Join me on POWR. ${inviteCodeLine(referralCode, event.invite_bonus_points)}`
            : 'Join me on POWR and it could be yours.',
    );
    lines.push(shareUrl);
    return lines.join('\n');
}
