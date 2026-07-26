// Imported from lib, not the hook: the hook reaches the native task-manager
// chain via the activity-revision bus, which a pure derivation test must not need.
import { deriveRescueOffer, rescueDayIndexFor, SAVED_VISIBLE_MS } from '@/lib/streakRescue';

const NOW = new Date('2026-07-23T10:00:00Z').getTime();
const HOUR = 3600_000;

const baseRow = {
    id: 'r1',
    status: 'offered',
    lost_streak: 12,
    missed_day: '2026-07-22',
    label: 'Back on track',
    requirement_type: 'sessions',
    sessions_required: 2,
    sessions_done: 1,
    expires_at: new Date(NOW + 40 * HOUR).toISOString(),
    completed_at: null as string | null,
};

describe('deriveRescueOffer', () => {
    it('surfaces a live offer with its frozen terms', () => {
        const offer = deriveRescueOffer(baseRow, NOW);
        expect(offer).toMatchObject({
            state: 'offered',
            lostStreak: 12,
            missedDay: '2026-07-22',
            label: 'Back on track',
            requirementType: 'sessions',
            sessionsRequired: 2,
            sessionsDone: 1,
        });
    });

    it('returns null once an offer has expired — the card and modal must not linger', () => {
        const row = { ...baseRow, expires_at: new Date(NOW - 1000).toISOString() };
        expect(deriveRescueOffer(row, NOW)).toBeNull();
    });

    it('surfaces a completed rescue as the saved state within the visible window', () => {
        const row = {
            ...baseRow,
            status: 'completed',
            sessions_done: 2,
            completed_at: new Date(NOW - 2 * HOUR).toISOString(),
        };
        expect(deriveRescueOffer(row, NOW)?.state).toBe('saved');
    });

    it('still celebrates a save the user was not present for — completion is a server event', () => {
        // Completed Friday morning by a Terra backfill, app next opened Saturday
        // lunchtime. At the old 24h window this user got nothing, ever.
        const row = {
            ...baseRow,
            status: 'completed',
            sessions_done: 2,
            completed_at: new Date(NOW - 30 * HOUR).toISOString(),
        };
        expect(deriveRescueOffer(row, NOW)?.state).toBe('saved');
    });

    it('retires the saved state once the window is past', () => {
        const row = {
            ...baseRow,
            status: 'completed',
            completed_at: new Date(NOW - SAVED_VISIBLE_MS - 1000).toISOString(),
        };
        expect(deriveRescueOffer(row, NOW)).toBeNull();
    });

    it('never surfaces expired or unknown statuses', () => {
        expect(deriveRescueOffer({ ...baseRow, status: 'expired' }, NOW)).toBeNull();
        expect(deriveRescueOffer({ ...baseRow, status: 'weird' }, NOW)).toBeNull();
        expect(deriveRescueOffer(null, NOW)).toBeNull();
    });

    it('a completed row without completed_at is not a fresh save', () => {
        const row = { ...baseRow, status: 'completed', completed_at: null };
        expect(deriveRescueOffer(row, NOW)).toBeNull();
    });

    it('defaults requirement type to sessions for rows created before templates existed', () => {
        const row = { ...baseRow, requirement_type: null, label: null };
        const offer = deriveRescueOffer(row, NOW);
        expect(offer?.requirementType).toBe('sessions');
        expect(offer?.label).toBeNull();
    });
});

describe('rescueDayIndexFor', () => {
    // Wed 2026-07-22 local; today = Thu 2026-07-23 → todayIndex 3 (Mon=0).
    const now = new Date('2026-07-23T10:00:00');

    it('maps yesterday to its weekday slot in the current strip', () => {
        expect(rescueDayIndexFor('2026-07-22', 3, now)).toBe(2); // Wednesday
    });

    it('maps the Monday of this week to slot 0', () => {
        expect(rescueDayIndexFor('2026-07-20', 3, now)).toBe(0);
    });

    it('returns null for a missed day before this week — the strip only shows this week', () => {
        expect(rescueDayIndexFor('2026-07-19', 3, now)).toBeNull(); // last Sunday
    });

    it('handles the Monday edge: yesterday was last week', () => {
        const monday = new Date('2026-07-20T09:00:00'); // Mon, todayIndex 0
        expect(rescueDayIndexFor('2026-07-19', 0, monday)).toBeNull();
    });

    it('is defensive about garbage input', () => {
        expect(rescueDayIndexFor(null, 3, now)).toBeNull();
        expect(rescueDayIndexFor('', 3, now)).toBeNull();
        expect(rescueDayIndexFor('not-a-date', 3, now)).toBeNull();
    });
});
