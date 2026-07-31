/**
 * Friend-pulse relevance ranking (lib/social/friendPulse.ts): who the home
 * "challenge them" row features, and the fatigue guardrails around it.
 * Together-history with you outranks raw recency; recent decliners sit out a
 * week; the same friend features at most once per cool-off (with same-day
 * continuation); dismissing silences the row entirely.
 */

import {
  buildPulseHistory,
  rankFriendPulse,
  sameLocalDay,
  PULSE_DECLINE_COOLOFF_MS,
  PULSE_DISMISS_COOLOFF_MS,
  PULSE_FRIEND_COOLOFF_MS,
  type PulseCandidate,
  type PulseHistory,
} from '@/lib/social/friendPulse';
import type { Friend, SharedChallenge } from '@/lib/social/types';

const NOW = Date.parse('2026-07-31T12:00:00Z');
const H = 3_600_000;

const friend = (id: string): Friend => ({ id, username: id, displayName: id, status: 'accepted' });

const candidate = (id: string, agoHours: number, type = 'gym'): PulseCandidate => ({
  friend: friend(id),
  type,
  startedAt: new Date(NOW - agoHours * H).toISOString(),
});

const emptyHistory = (): PulseHistory => ({
  togetherCount: new Map(),
  invitedMeCount: new Map(),
  recentDeclineAt: new Map(),
});

const noPacing = () => ({ lastSuggestedAt: {} });

describe('rankFriendPulse', () => {
  it('with no history, freshest workout wins', () => {
    const pick = rankFriendPulse([candidate('a', 10), candidate('b', 2)], emptyHistory(), noPacing(), NOW);
    expect(pick?.friend.id).toBe('b');
  });

  it('together-history beats recency', () => {
    const history = emptyHistory();
    history.togetherCount.set('veteran', 2);
    const pick = rankFriendPulse(
      [candidate('veteran', 20), candidate('fresh', 1)],
      history,
      noPacing(),
      NOW,
    );
    expect(pick?.friend.id).toBe('veteran');
  });

  it('reciprocity (they invited you) nudges ahead of a mere fresh stranger', () => {
    const history = emptyHistory();
    history.invitedMeCount.set('host', 2); // 50 points > 24-point max freshness edge
    const pick = rankFriendPulse([candidate('host', 20), candidate('fresh', 1)], history, noPacing(), NOW);
    expect(pick?.friend.id).toBe('host');
  });

  it('a recent decliner sits out, then becomes eligible again', () => {
    const history = emptyHistory();
    history.recentDeclineAt.set('a', NOW - PULSE_DECLINE_COOLOFF_MS + H);
    expect(rankFriendPulse([candidate('a', 1)], history, noPacing(), NOW)).toBeNull();
    history.recentDeclineAt.set('a', NOW - PULSE_DECLINE_COOLOFF_MS - H);
    expect(rankFriendPulse([candidate('a', 1)], history, noPacing(), NOW)?.friend.id).toBe('a');
  });

  it('a recently featured friend cools off, letting the runner-up through', () => {
    const pacing = { lastSuggestedAt: { a: NOW - 24 * H } }; // yesterday
    const pick = rankFriendPulse([candidate('a', 1), candidate('b', 5)], emptyHistory(), pacing, NOW);
    expect(pick?.friend.id).toBe('b');
  });

  it('same-day continuation: the friend featured earlier today keeps showing', () => {
    const pacing = { lastSuggestedAt: { a: NOW - 2 * H } };
    const pick = rankFriendPulse([candidate('a', 1)], emptyHistory(), pacing, NOW);
    expect(pick?.friend.id).toBe('a');
  });

  it('cool-off expires', () => {
    const pacing = { lastSuggestedAt: { a: NOW - PULSE_FRIEND_COOLOFF_MS - H } };
    expect(rankFriendPulse([candidate('a', 1)], emptyHistory(), pacing, NOW)?.friend.id).toBe('a');
  });

  it('row dismissal silences everything for the cool-off, then recovers', () => {
    const dismissed = { lastSuggestedAt: {}, rowDismissedAt: NOW - PULSE_DISMISS_COOLOFF_MS + H };
    expect(rankFriendPulse([candidate('a', 1)], emptyHistory(), dismissed, NOW)).toBeNull();
    const recovered = { lastSuggestedAt: {}, rowDismissedAt: NOW - PULSE_DISMISS_COOLOFF_MS - H };
    expect(rankFriendPulse([candidate('a', 1)], emptyHistory(), recovered, NOW)?.friend.id).toBe('a');
  });

  it('empty candidates → null', () => {
    expect(rankFriendPulse([], emptyHistory(), noPacing(), NOW)).toBeNull();
  });
});

describe('buildPulseHistory', () => {
  const participant = (id: string, state: string, isSelf = false) => ({
    friend: friend(id),
    isSelf,
    state,
    completed: state === 'completed',
  });

  it('counts together-history, reciprocity and declines of MY challenges', () => {
    const all = [
      {
        creatorId: 'me',
        settledAt: new Date(NOW - 24 * H).toISOString(),
        participants: [participant('me', 'completed', true), participant('a', 'completed'), participant('b', 'declined')],
      },
      {
        creatorId: 'a',
        endsAt: new Date(NOW - 48 * H).toISOString(),
        participants: [participant('me', 'accepted', true), participant('a', 'accepted')],
      },
    ] as unknown as SharedChallenge[];

    const h = buildPulseHistory(all, 'me');
    expect(h.togetherCount.get('a')).toBe(2);
    expect(h.invitedMeCount.get('a')).toBe(1);
    expect(h.recentDeclineAt.get('b')).toBe(NOW - 24 * H);
    // Declining SOMEONE ELSE's challenge is not held against them for mine.
    const other = buildPulseHistory(all, 'someone-else');
    expect(other.recentDeclineAt.size).toBe(0);
  });
});

describe('sameLocalDay', () => {
  it('distinguishes same day from adjacent days', () => {
    const noon = new Date(2026, 6, 31, 12, 0).getTime();
    expect(sameLocalDay(noon, new Date(2026, 6, 31, 23, 59).getTime())).toBe(true);
    expect(sameLocalDay(noon, new Date(2026, 7, 1, 0, 1).getTime())).toBe(false);
  });
});
