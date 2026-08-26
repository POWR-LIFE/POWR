import {
    APPROVED_CARD_TTL_MS,
    creatorInviteCardState,
    type CreatorInviteEligibility,
} from '@/lib/api/creatorInvite';

const base: CreatorInviteEligibility = {
    program_enabled: true,
    already_creator: false,
    converted: 3,
    threshold: 3,
    window_days: 90,
    eligible: true,
    request_status: null,
    request_id: null,
    requested_at: null,
    decided_at: null,
};

describe('creatorInviteCardState', () => {
    it('hides when there is no data or the programme is off', () => {
        expect(creatorInviteCardState(null)).toBe('hidden');
        expect(creatorInviteCardState(undefined)).toBe('hidden');
        expect(creatorInviteCardState({ ...base, program_enabled: false })).toBe('hidden');
    });

    it('asks when the server says eligible and nothing has been filed', () => {
        expect(creatorInviteCardState(base)).toBe('eligible');
    });

    it('never asks below the bar — eligibility is the server\'s call, not the count', () => {
        expect(creatorInviteCardState({ ...base, converted: 2, eligible: false })).toBe('hidden');
        // and not the client's either: a stale `eligible` beats the numbers
        expect(creatorInviteCardState({ ...base, converted: 99, eligible: false })).toBe('hidden');
    });

    it('shows the pending state once a request is filed', () => {
        expect(creatorInviteCardState({ ...base, request_status: 'pending' })).toBe('pending');
    });

    it('stays quiet after a decline', () => {
        expect(creatorInviteCardState({ ...base, request_status: 'declined', eligible: false })).toBe('hidden');
        // even if the server has re-opened eligibility after the cooldown, the
        // card waits for the member to qualify afresh rather than nagging
        expect(creatorInviteCardState({ ...base, request_status: 'declined', eligible: true })).toBe('hidden');
    });

    it('shows "you\'re in" for two weeks after approval, then retires', () => {
        const now = Date.parse('2026-08-26T12:00:00Z');
        const approved = { ...base, already_creator: true, request_status: 'approved' as const, decided_at: '2026-08-25T12:00:00Z' };
        expect(creatorInviteCardState(approved, now)).toBe('approved');
        expect(creatorInviteCardState(approved, now + APPROVED_CARD_TTL_MS)).toBe('hidden');
        expect(creatorInviteCardState({ ...approved, decided_at: null }, now)).toBe('hidden');
    });

    it('hides for creators who came in by hand-invite (no request row)', () => {
        expect(creatorInviteCardState({ ...base, already_creator: true, eligible: false })).toBe('hidden');
    });
});
