/**
 * The words a Series invite travels with: the share-sheet caption (which the
 * clipboard copies verbatim), the QR link, and the share card's og:title /
 * og:description and landing path. User-facing surface, so the wording is
 * pinned — and the landing path must stay the /app smart-link
 * (share_cards.app_path's CHECK and share-card-og both reject anything else).
 */

import {
    buildSeriesShareMessage,
    buildSeriesShareSubtitle,
    buildSeriesShareTitle,
    REFERRAL_BONUS_POINTS,
    seriesInviteLink,
    seriesInviteMessage,
    seriesInvitePath,
} from '@/lib/seriesInvite';

const CODE = 'ABCD1234';

test('the link is the friend smart-link: add-friend with the code, like My QR', () => {
    expect(seriesInviteLink(CODE)).toBe('https://powr.life/app?to=add-friend&ref=ABCD1234');
});

test('the card lands where SHARE does, under /app; no code → the plain bounce', () => {
    expect(seriesInvitePath(CODE)).toBe('/app?to=add-friend&ref=ABCD1234');
    expect(seriesInvitePath(null)).toBe('/app');
    expect(seriesInvitePath(CODE).startsWith('/app')).toBe(true);
});

test('the message names the season, spells the code out with the bonus, then the link', () => {
    const link = seriesInviteLink(CODE);
    expect(seriesInviteMessage({ seasonName: 'Autumn Series', link, code: CODE })).toBe(
        'Join me in the Autumn Series on POWR 💪\n' +
            `Sign up with my code ABCD1234 — we both earn +${REFERRAL_BONUS_POINTS} POWR after your first workout.\n` +
            link,
    );
});

test('the referral bonus is the server default', () => {
    expect(REFERRAL_BONUS_POINTS).toBe(20);
});

test('no code yet: the season line and the link, nothing invented', () => {
    const link = 'https://powr.life/app';
    expect(seriesInviteMessage({ seasonName: 'Autumn Series', link, code: null })).toBe(
        'Join me in the Autumn Series on POWR 💪\n' + link,
    );
});

test('the card caption is the invite with the card link in place of the smart-link', () => {
    const shareUrl = 'https://powr.life/s/abc123';
    expect(buildSeriesShareMessage({ seasonName: 'Autumn Series', shareUrl, code: CODE })).toBe(
        seriesInviteMessage({ seasonName: 'Autumn Series', link: shareUrl, code: CODE }),
    );
});

test('link preview: the season on POWR; the round and its start, or that it is on', () => {
    expect(buildSeriesShareTitle('Autumn Series')).toBe('Autumn Series on POWR');
    const startsAt = Date.parse('2026-11-01T00:00:00Z');
    expect(buildSeriesShareSubtitle({ roundName: 'Round 01', startsAt, date: 'Sun 1 Nov', now: startsAt - 1 })).toBe(
        'Round 01 starts Sun 1 Nov. Free to enter. Tap to get POWR and join me.',
    );
    expect(buildSeriesShareSubtitle({ roundName: 'Round 01', startsAt, date: 'Sun 1 Nov', now: startsAt })).toBe(
        'Round 01 is on. Free to enter. Tap to get POWR and join me.',
    );
});
