/**
 * The words a Series invite travels with: the share-sheet caption (which the
 * clipboard copies verbatim), the link whose preview is the Series card, and
 * the share card's og:title / og:description and landing path. User-facing
 * surface, so the wording is pinned — and the landing path must stay the
 * /app smart-link (share_cards.app_path's CHECK and share-card-og both
 * reject anything else).
 */

import {
    buildSeriesShareMessage,
    buildSeriesShareSubtitle,
    buildSeriesShareTitle,
    ordinalDay,
    REFERRAL_BONUS_POINTS,
    seriesInviteLink,
    seriesInviteMessage,
    seriesInvitePath,
    startDay,
} from '@/lib/seriesInvite';

const CODE = 'ABCD1234';
/** Round 01: London midnight, 15 Nov. */
const STARTS = Date.parse('2026-11-15T00:00:00Z');

test('the link is the Series page with the code — what unfurls as the card; no code, the page alone', () => {
    expect(seriesInviteLink(CODE)).toBe('https://powr.life/series/ABCD1234');
    expect(seriesInviteLink(null)).toBe('https://powr.life/series');
});

test('the card lands where the link bounces, under /app; no code → the plain bounce', () => {
    expect(seriesInvitePath(CODE)).toBe('/app?to=add-friend&ref=ABCD1234');
    expect(seriesInvitePath(null)).toBe('/app');
    expect(seriesInvitePath(CODE).startsWith('/app')).toBe(true);
});

test('before the round: the season starts on the day, the ask, the link', () => {
    const link = seriesInviteLink(CODE);
    expect(seriesInviteMessage({ seasonName: 'Autumn Series', link, startsAt: STARTS, now: STARTS - 1 })).toBe(
        'Autumn Series starts on the 15th. You in?\n' + link,
    );
});

test('once the round is on: that it is on, the ask, the link', () => {
    const link = seriesInviteLink(CODE);
    expect(seriesInviteMessage({ seasonName: 'Autumn Series', link, startsAt: STARTS, now: STARTS })).toBe(
        'Autumn Series is on. You in?\n' + link,
    );
    // An unknown start never invents a date.
    expect(seriesInviteMessage({ seasonName: 'Autumn Series', link, startsAt: NaN })).toBe('Autumn Series is on. You in?\n' + link);
});

test('the day is London’s, said the way each language says it', () => {
    expect(startDay(STARTS, 'en')).toBe('15th');
    // London's day, not UTC's: 23:30 UTC on 1 Jun is already 2 Jun in BST.
    expect(startDay(Date.parse('2026-06-01T23:30:00Z'), 'en')).toBe('2nd');
    expect(ordinalDay(1, 'en')).toBe('1st');
    expect(ordinalDay(2, 'en')).toBe('2nd');
    expect(ordinalDay(3, 'en')).toBe('3rd');
    expect(ordinalDay(4, 'en')).toBe('4th');
    expect(ordinalDay(11, 'en')).toBe('11th');
    expect(ordinalDay(12, 'en')).toBe('12th');
    expect(ordinalDay(13, 'en')).toBe('13th');
    expect(ordinalDay(21, 'en')).toBe('21st');
    expect(ordinalDay(22, 'en-GB')).toBe('22nd');
    expect(ordinalDay(23, 'en')).toBe('23rd');
    expect(ordinalDay(31, 'en')).toBe('31st');
    expect(ordinalDay(1, 'fr')).toBe('1er');
    expect(ordinalDay(15, 'fr')).toBe('15');
    expect(ordinalDay(1, 'es')).toBe('1');
    expect(ordinalDay(15, 'es-ES')).toBe('15');
});

test('the referral bonus is the server default', () => {
    expect(REFERRAL_BONUS_POINTS).toBe(20);
});

test('the card caption is the invite with the card link in place of the Series link', () => {
    const shareUrl = 'https://powr.life/s/abc123';
    expect(buildSeriesShareMessage({ seasonName: 'Autumn Series', shareUrl, startsAt: STARTS, now: STARTS - 1 })).toBe(
        seriesInviteMessage({ seasonName: 'Autumn Series', link: shareUrl, startsAt: STARTS, now: STARTS - 1 }),
    );
});

test('link preview: POWR · the season; the round and its start, or that it is on', () => {
    expect(buildSeriesShareTitle('Autumn Series')).toBe('POWR · Autumn Series');
    const startsAt = Date.parse('2026-11-01T00:00:00Z');
    expect(buildSeriesShareSubtitle({ roundName: 'Round 01', startsAt, date: 'Sun 1 Nov', now: startsAt - 1 })).toBe(
        'Round 01 starts Sun 1 Nov. Free to enter. Tap to get POWR and join me.',
    );
    expect(buildSeriesShareSubtitle({ roundName: 'Round 01', startsAt, date: 'Sun 1 Nov', now: startsAt })).toBe(
        'Round 01 is on. Free to enter. Tap to get POWR and join me.',
    );
});
