import { countsLine, eventPushCopy, ukDay } from '@/supabase/functions/_shared/eventPushCopy';

// The one-off event pushes (announcement, day one, finale night). A gym can
// now pick which activities count, so the pushes must say so rather than
// promise "every verified workout".

const NOW = Date.parse('2026-09-25T09:00:00Z');
const base = {
    event_name: 'October Clash',
    gym_name: 'ONE LDN',
    prize: 'A free month',
    starts_at: '2026-09-27T23:00:00Z',     // Mon 28 Sep, midnight UK
    ends_at: '2026-10-04T23:00:00Z',       // Mon 5 Oct, midnight UK: last day Sun 4 Oct
    doors_open_at: '2026-10-05T17:00:00Z', // 6pm UK
    venue_only: false,
    activities: null as string[] | null,
    attendance: 25,
};

describe('countsLine', () => {
    it('says every verified workout when nothing is picked', () => {
        expect(countsLine(base, 'ONE LDN')).toBe('Every verified workout counts');
    });

    it('says only the gym when only sessions there count', () => {
        expect(countsLine({ ...base, venue_only: true }, 'ONE LDN')).toBe('Every session at ONE LDN counts');
    });

    it('names a single activity', () => {
        expect(countsLine({ ...base, activities: ['running'] }, 'ONE LDN')).toBe('Runs count');
    });

    it('lists several in the order the portal shows them', () => {
        expect(countsLine({ ...base, activities: ['walking', 'cycling', 'running'] }, 'ONE LDN'))
            .toBe('Runs, rides and walks count');
    });

    it('keeps HIIT in capitals', () => {
        expect(countsLine({ ...base, activities: ['hiit'] }, 'ONE LDN')).toBe('HIIT workouts count');
    });

    it('never names something it does not know', () => {
        expect(countsLine({ ...base, activities: ['sleep'] }, 'ONE LDN')).toBe('Every verified workout counts');
    });
});

describe('eventPushCopy', () => {
    it('announces a pick of activities', () => {
        const { title, body } = eventPushCopy('event_announced', { ...base, activities: ['cycling', 'running'] }, NOW);
        expect(title).toBe('New at ONE LDN: October Clash');
        expect(body).toBe(`Starts ${ukDay(base.starts_at)}. Runs and rides count. A free month for 1st. Tap to join.`);
    });

    it('announces a gym-only event as before', () => {
        const { body } = eventPushCopy('event_announced', { ...base, venue_only: true }, NOW);
        expect(body).toBe(`Starts ${ukDay(base.starts_at)}. Every session at ONE LDN counts. A free month for 1st. Tap to join.`);
    });

    it('kicks off with what counts and the last day', () => {
        const { title, body } = eventPushCopy('event_kickoff', { ...base, activities: ['cycling', 'running'] }, NOW);
        expect(title).toBe("October Clash: it's on 🏁");
        expect(body).toBe(`Runs and rides count until ${ukDay('2026-10-04T22:59:00Z')}. The board is open.`);
    });

    it('asks people to check in on the finale night for the bonus', () => {
        const { body } = eventPushCopy('event_doors_open', base, NOW);
        expect(body).toBe('Doors open 6pm at ONE LDN. Check in with POWR when you arrive for +25 POWR.');
    });
});
