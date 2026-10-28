import i18n from '@/lib/i18n';

/**
 * The words a Series invite travels with — the share sheet, the clipboard,
 * and the share card's link preview. One place, so SHARE, Copy and the card
 * can never disagree about the link or the day. Pure, so the wording is
 * pinned by __tests__/seriesInvite.test.ts.
 *
 * A Series invite is the FRIEND invite — a friend brought in counts for
 * Squad Builder, opens your gym's crown and is someone to duel, all of which
 * need the friendship, not just the signup — sent as powr.life/series/<code>.
 * That page (supabase/functions/series-invite-og) unfurls in WhatsApp and
 * iMessage as the Series card: the P on the season's ground, "POWR · Autumn
 * Series", powr.life (Jamie's mock, 10-28). A human who taps it is bounced to
 * the same `/app?to=add-friend&ref=<code>` smart-link the QR encodes, where
 * the app opens with the code filled — or, without the app, the page shows
 * the code to copy before the store.
 */

const SITE = 'https://powr.life';

/**
 * What the referral programme pays each side once a friend who joined with
 * your code logs their first verified workout — the server's default
 * (referral_conversion_check, `v_bonus := 20`; live events can override it
 * per event, the Series doesn't).
 */
export const REFERRAL_BONUS_POINTS = 20;

/** The link a Series invite is sent as — the share sheet and the clipboard alike (the QR keeps the smart-link). */
export function seriesInviteLink(code: string | null): string {
    return code ? `${SITE}/series/${encodeURIComponent(code)}` : `${SITE}/series`;
}

/**
 * The same invite as a path under powr.life — what a published share card
 * stores as its `app_path`, so a friend who taps the card's preview lands
 * where SHARE's link does (add-friend, code filled), attributed to the sharer.
 */
export function seriesInvitePath(code: string | null): string {
    return code ? `/app?to=add-friend&ref=${encodeURIComponent(code)}` : '/app';
}

/**
 * A day of the month, the way the language on screen says it in a sentence:
 * "the 15th", "le 15" ("le 1er"), "el 15".
 */
export function ordinalDay(day: number, lang: string = i18n.language): string {
    const l = (lang ?? 'en').split('-')[0];
    if (l === 'fr') return day === 1 ? '1er' : String(day);
    if (l === 'es') return String(day);
    const tens = day % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
    return `${day}${suffix}`;
}

/** The day a round starts, in London — rounds start at London midnight, as seriesDate reads them. */
export function startDay(startsAt: number, lang?: string): string {
    const d = new Date(startsAt);
    let day: number;
    try {
        day = Number(d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Europe/London' }));
    } catch {
        day = d.getUTCDate();
    }
    return ordinalDay(Number.isFinite(day) ? day : d.getUTCDate(), lang);
}

/**
 * The text an invite travels as — share sheet AND clipboard, the same words:
 * "Autumn Series starts on the 15th. You in?" and the link; once the round
 * is on, that it's on. The code rides the link, not the words.
 */
export function seriesInviteMessage(opts: { seasonName: string; link: string; startsAt: number; now?: number }): string {
    const { seasonName, link, startsAt, now = Date.now() } = opts;
    const line = Number.isFinite(startsAt) && startsAt > now
        ? i18n.t('series:invite.message', { season: seasonName, day: startDay(startsAt) })
        : i18n.t('series:invite.messageOn', { season: seasonName });
    return `${line}\n${link}`;
}

// The share card's words, in the SHARER's language: they're written into the
// card when it's published, before anyone else sees it.

/** Bold line of the link preview — the same title the /series link unfurls with. */
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
 * Caption + link for the share sheet — the invite's words with the card
 * link in place of the /series link, so the two say the same thing.
 */
export function buildSeriesShareMessage(opts: { seasonName: string; shareUrl: string; startsAt: number; now?: number }): string {
    return seriesInviteMessage({ seasonName: opts.seasonName, link: opts.shareUrl, startsAt: opts.startsAt, now: opts.now });
}
