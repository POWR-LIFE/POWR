/**
 * The share caption/title/subtitle builders. These feed both the chat-app link
 * message and the og:title/og:description the /s/<id> page serves, so their
 * wording is user-facing surface worth pinning.
 */

import { buildShareHeadline, buildShareTitle, buildShareSubtitle, buildShareMessage } from '@/lib/api/share';
import type { ShareSummary } from '@/lib/api/share';

function base(overrides: Partial<ShareSummary> = {}): ShareSummary {
    return {
        mode: 'streak',
        longestStreak: 9,
        pointsBalance: 0,
        totalEarned: 10_000, // Level 7 — Iron Lungs
        lifetimeCount: 30,
        monthCount: 8,
        currentStreak: 5,
        weekActiveDays: [true, true, false, false, false, false, false],
        reward: null,
        profile: { displayName: 'Jamie', username: 'jamie', avatarUrl: null, coverUrl: null, referralCode: 'ABC123' },
        ...overrides,
    } as ShareSummary;
}

test('title carries who + the level the card shows', () => {
    expect(buildShareTitle(base())).toBe('Jamie — Level 7, Iron Lungs');
});

test('title falls back to username, then a generic name', () => {
    expect(buildShareTitle(base({ profile: { displayName: null, username: 'jamie', avatarUrl: null, coverUrl: null, referralCode: null } })))
        .toBe('jamie — Level 7, Iron Lungs');
    expect(buildShareTitle(base({ profile: { displayName: null, username: null, avatarUrl: null, coverUrl: null, referralCode: null } })))
        .toBe('A POWR member — Level 7, Iron Lungs');
});

test('streak headline reads naturally', () => {
    expect(buildShareHeadline(base({ currentStreak: 5, monthCount: 8 })))
        .toBe('5-day streak on POWR — 8 sessions this month.');
    expect(buildShareHeadline(base({ currentStreak: 0, monthCount: 3 })))
        .toBe('3 sessions this month on POWR.');
});

test('the shared message is the headline followed by the link, and nothing else', () => {
    const msg = buildShareMessage(base(), 'https://powr.life/s/abc');
    expect(msg).toBe('5-day streak on POWR — 8 sessions this month.\nhttps://powr.life/s/abc');
});

test('subtitle appends the get-the-app nudge for the link preview', () => {
    expect(buildShareSubtitle(base())).toMatch(/Tap to get POWR/);
});
