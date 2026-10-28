import { inviteCodeLine } from '@/lib/eventInviteLink';
import i18n from '@/lib/i18n';
import { friendInviteLink } from '@/lib/social/friendCode';

/**
 * The words a Series invite travels with — the share sheet, the clipboard,
 * the QR, and the share card's link preview. One place, so SHARE, Copy and
 * the card can never disagree about the code or the bonus. Pure, so the
 * wording is pinned by __tests__/seriesInvite.test.ts.
 *
 * A Series invite is the FRIEND invite: the same smart-link as My QR
 * (`?to=add-friend&ref=<code>`), because a friend brought in counts for
 * Squad Builder, opens your gym's crown and is someone to duel — all of
 * which need the friendship, not just the signup. The code is spelled out
 * next to the link: `ref=` only survives when the app is already installed,
 * and a friend who installs from the store arrives with what they can read.
 */

/**
 * What the referral programme pays each side once a friend who joined with
 * your code logs their first verified workout — the server's default
 * (referral_conversion_check, `v_bonus := 20`; live events can override it
 * per event, the Series doesn't).
 */
export const REFERRAL_BONUS_POINTS = 20;

/** The link a Series invite encodes — share sheet, clipboard and QR alike. */
export function seriesInviteLink(code: string): string {
    return friendInviteLink(code);
}

/**
 * The same invite as a path under powr.life — what a published share card
 * stores as its `app_path`, so a friend who taps the card's preview lands
 * where SHARE's link does (add-friend, code filled), attributed to the sharer.
 */
export function seriesInvitePath(code: string | null): string {
    return code ? `/app?to=add-friend&ref=${encodeURIComponent(code)}` : '/app';
}

/** The text an invite travels as — share sheet AND clipboard, the same words. */
export function seriesInviteMessage(opts: { seasonName: string; link: string; code: string | null }): string {
    const { seasonName, link, code } = opts;
    const lines = [i18n.t('series:invite.message', { season: seasonName })];
    if (code) lines.push(inviteCodeLine(code, REFERRAL_BONUS_POINTS));
    lines.push(link);
    return lines.join('\n');
}

// The share card's words, in the SHARER's language: they're written into the
// card when it's published, before anyone else sees it.

/** Bold line of the link preview. */
export function buildSeriesShareTitle(seasonName: string): string {
    return i18n.t('series:shareLink.title', { season: seasonName });
}

/** Grey line beneath it — the round and when it starts (or that it's on), the entry, the ask. */
export function buildSeriesShareSubtitle(opts: { roundName: string; startsAt: number; date: string; now?: number }): string {
    const { roundName, startsAt, date, now = Date.now() } = opts;
    return now >= startsAt
        ? i18n.t('series:shareLink.onNow', { round: roundName })
        : i18n.t('series:shareLink.starts', { round: roundName, date });
}

/**
 * Caption + link for the share sheet — the invite card's text with the card
 * link in place of the bare smart-link, so the two say the same thing.
 */
export function buildSeriesShareMessage(opts: { seasonName: string; shareUrl: string; code: string | null }): string {
    return seriesInviteMessage({ seasonName: opts.seasonName, link: opts.shareUrl, code: opts.code });
}
