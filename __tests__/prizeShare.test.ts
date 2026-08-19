/**
 * The words a shared prize travels with: og:title/description, the share
 * sheet caption, and where a tapped preview lands. User-facing surface, so
 * the wording is pinned — and the landing path must stay the /app smart-link
 * (share_cards.app_path's CHECK and share-card-og both reject anything else).
 */

import { eventInviteLink, eventInviteMessage, eventInvitePath } from '@/lib/eventInviteLink';
import {
    buildPrizeShareMessage,
    buildPrizeSharePath,
    buildPrizeShareSubtitle,
    buildPrizeShareTitle,
    ordinal,
} from '@/lib/prizeShare';

const event = {
    slug: 'fnl-x-powr',
    name: 'FNL x POWR',
    window_start_at: '2026-08-26T23:00:00.000Z',
    window_end_at: '2026-09-02T23:00:00.000Z',
    invite_bonus_points: 50,
};
const prize = { rank: 1, label: 'Mandarin Oriental Wellness Day', image_url: 'https://x/p.png' };

test('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal))
        .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
});

test('title = ordinal prize · event', () => {
    expect(buildPrizeShareTitle(event, prize)).toBe('1st prize · FNL x POWR');
    expect(buildPrizeShareTitle(event, { rank: 3, label: 'Smart Swim 2' })).toBe('3rd prize · FNL x POWR');
});

test('subtitle names the prize, the event and its week, then the ask', () => {
    const s = buildPrizeShareSubtitle(event, prize);
    expect(s.startsWith('Mandarin Oriental Wellness Day — up for grabs at FNL x POWR, ')).toBe(true);
    expect(s.endsWith('. Tap to get POWR and join me.')).toBe(true);
});

test('landing path is the event invite path — the /app smart-link, code attached', () => {
    expect(buildPrizeSharePath(event, 'ABC123')).toBe('/app?to=league&event=fnl-x-powr&ref=ABC123');
    expect(buildPrizeSharePath(event, null)).toBe('/app?to=league&event=fnl-x-powr');
    // Same path the invite link is built from, so the two can never drift.
    expect(eventInviteLink('fnl-x-powr', 'ABC123')).toBe(`https://powr.life${eventInvitePath('fnl-x-powr', 'ABC123')}`);
    // The shape share_cards.app_path's CHECK constraint accepts.
    const APP_PATH_RE = /^\/app(\?[A-Za-z0-9%._~&=-]*)?$/;
    expect(APP_PATH_RE.test(buildPrizeSharePath(event, 'ABC123'))).toBe(true);
    expect(APP_PATH_RE.test(buildPrizeSharePath({ ...event, slug: 'one ldn/2026' }, 'A_B-1'))).toBe(true);
});

test('message: the prize, the same code sentence as the event invite, the link', () => {
    const msg = buildPrizeShareMessage({ event, prize, shareUrl: 'https://powr.life/s/abc', referralCode: 'ABC123' });
    expect(msg).toBe([
        '1st prize at FNL x POWR: Mandarin Oriental Wellness Day 🏆',
        'Join me on POWR. Sign up with my code ABC123 — we both earn +50 POWR after your first workout.',
        'https://powr.life/s/abc',
    ].join('\n'));
    // The code line is literally the invite's.
    const invite = eventInviteMessage({ eventName: event.name, link: 'x', code: 'ABC123', bonusPoints: 50 });
    expect(invite.split('\n')[1]).toBe('Sign up with my code ABC123 — we both earn +50 POWR after your first workout.');
});

test('message without a code still asks', () => {
    const msg = buildPrizeShareMessage({ event, prize, shareUrl: 'https://powr.life/s/abc', referralCode: null });
    expect(msg.split('\n')[1]).toBe('Join me on POWR and it could be yours.');
});

test('no bonus → plain code sentence', () => {
    const msg = buildPrizeShareMessage({
        event: { ...event, invite_bonus_points: 0 }, prize, shareUrl: 'u', referralCode: 'ABC123',
    });
    expect(msg.split('\n')[1]).toBe('Join me on POWR. Sign up with my code ABC123.');
});
