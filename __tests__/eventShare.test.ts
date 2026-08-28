/**
 * The words a shared live event travels with: og:title/description, the
 * share-sheet caption, and where a tapped preview lands. User-facing surface,
 * so the wording is pinned — and the landing path must stay the /app
 * smart-link (share_cards.app_path's CHECK and share-card-og both reject
 * anything else).
 */

import { eventInviteLink, eventInviteMessage, eventInvitePath } from '@/lib/eventInviteLink';
import {
    buildEventShareMessage,
    buildEventSharePath,
    buildEventShareSubtitle,
    buildEventShareTitle,
} from '@/lib/eventShare';

const event = {
    slug: 'fnl-x-powr',
    name: 'FNL x POWR',
    window_start_at: '2026-08-26T23:00:00.000Z',
    window_end_at: '2026-09-03T23:00:00.000Z',
    doors_open_at: '2026-09-04T17:00:00.000Z',
    doors_close_at: '2026-09-04T18:00:00.000Z',
    invite_bonus_points: 20,
    venue: { name: 'ONE LDN', logo_url: null, logo_bg: 'dark' },
};

test('title = event · live event on POWR', () => {
    expect(buildEventShareTitle(event)).toBe('FNL x POWR · Live event on POWR');
});

test('subtitle: the night at the venue, the scoring week, the ask', () => {
    const s = buildEventShareSubtitle(event);
    expect(s).toMatch(/^Fri.*Sep.* at ONE LDN\. Scoring .+\. Tap to get POWR and join me\.$/);
});

test('subtitle never invents a night: no doors time → venue and scoring only', () => {
    const s = buildEventShareSubtitle({ ...event, doors_open_at: null, doors_close_at: null });
    expect(s.startsWith('At ONE LDN. Scoring ')).toBe(true);
    const bare = buildEventShareSubtitle({ ...event, doors_open_at: null, doors_close_at: null, venue: null });
    expect(bare.startsWith('Scoring ')).toBe(true);
    expect(bare.endsWith('. Tap to get POWR and join me.')).toBe(true);
});

test('landing path is the event invite path — the /app smart-link, code attached', () => {
    expect(buildEventSharePath(event, 'ABC123')).toBe('/app?to=league&event=fnl-x-powr&ref=ABC123');
    expect(buildEventSharePath(event, null)).toBe('/app?to=league&event=fnl-x-powr');
    expect(eventInviteLink('fnl-x-powr', 'ABC123')).toBe(`https://powr.life${eventInvitePath('fnl-x-powr', 'ABC123')}`);
    const APP_PATH_RE = /^\/app(\?[A-Za-z0-9%._~&=-]*)?$/;
    expect(APP_PATH_RE.test(buildEventSharePath(event, 'ABC123'))).toBe(true);
    expect(APP_PATH_RE.test(buildEventSharePath({ slug: 'one ldn/2026' }, 'A_B-1'))).toBe(true);
});

test('message IS the ticket-card invite, with the card link in place of the bare link', () => {
    const msg = buildEventShareMessage({ event, shareUrl: 'https://powr.life/s/abc', referralCode: 'ABC123' });
    expect(msg).toBe(
        eventInviteMessage({ eventName: 'FNL x POWR', link: 'https://powr.life/s/abc', code: 'ABC123', bonusPoints: 20 }),
    );
    expect(msg).toBe([
        'Join me for FNL x POWR on POWR 💪',
        'Sign up with my code ABC123 — we both earn +20 POWR after your first workout.',
        'https://powr.life/s/abc',
    ].join('\n'));
});

test('message without a code still invites', () => {
    const msg = buildEventShareMessage({ event, shareUrl: 'https://powr.life/s/abc', referralCode: null });
    expect(msg).toBe(['Join me for FNL x POWR on POWR 💪', 'https://powr.life/s/abc'].join('\n'));
});
