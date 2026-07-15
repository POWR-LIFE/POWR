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

function checkIn(overrides: Partial<ShareSummary> = {}): ShareSummary {
    return base({
        mode: 'check-in',
        sessionId: 's1',
        type: 'gym',
        startedAt: '2026-06-20T18:30:00Z',
        durationMin: 45,
        sessionPoints: 12,
        venue: { name: 'PureGym', locationLabel: null, category: 'gym' },
        historical: false,
        ...overrides,
    } as Partial<ShareSummary>);
}

test('live check-in headline carries venue, detail and the streak', () => {
    expect(buildShareHeadline(checkIn()))
        .toBe('Checked in at PureGym on POWR — 45 min, +12 pts. Day 5 of my streak.');
});

test('historical check-in headline dates the session and drops the streak', () => {
    // fetchCheckInSummary zeroes currentStreak on throwbacks; mirror that here.
    // The date is device-locale formatted ("20 Jun" / "Jun 20"), so match loosely.
    const headline = buildShareHeadline(checkIn({ historical: true, currentStreak: 0 }));
    expect(headline).toMatch(/^Checked in at PureGym on POWR — (20 Jun|Jun 20), 45 min, \+12 pts\.$/);
    expect(headline).not.toMatch(/streak/i);
});

test('level-up headline announces the new level by name', () => {
    expect(buildShareHeadline(base({ mode: 'level-up', historical: false })))
        .toBe('Just hit Level 7 — Iron Lungs — on POWR.');
});

test('a throwback level-up drops the "just"', () => {
    expect(buildShareHeadline(base({ mode: 'level-up', historical: true })))
        .toBe('Hit Level 7 — Iron Lungs — on POWR.');
});
