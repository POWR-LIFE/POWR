import type { LiveEvent, LiveEventPrize } from '@/lib/api/liveEvents';
import i18n from '@/lib/i18n';
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

/**
 * The ordinal in the language on screen, for the share-sheet caption: "1st"
 * and "22nd", "1er" and "2e", "1.º". Each language's own ordinal rule picks
 * the form, which in English is exactly the suffix rule `ordinal` spells out.
 * The link preview (sent to the server) keeps `ordinal`.
 */
const PLACE_KEYS: Record<string, string> = {
    one: 'events:prizeShare.place.one',
    two: 'events:prizeShare.place.two',
    few: 'events:prizeShare.place.few',
    other: 'events:prizeShare.place.other',
};

function place(rank: number): string {
    const form = new Intl.PluralRules(i18n.language, { type: 'ordinal' }).select(rank);
    return i18n.t(PLACE_KEYS[form] ?? PLACE_KEYS.other, { rank });
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
    const lines = [i18n.t('events:prizeShare.message', { place: place(prize.rank), event: event.name, prize: prize.label })];
    lines.push(
        referralCode
            ? i18n.t('events:invite.joinMe', { codeLine: inviteCodeLine(referralCode, event.invite_bonus_points) })
            : i18n.t('events:prizeShare.join'),
    );
    lines.push(shareUrl);
    return lines.join('\n');
}
