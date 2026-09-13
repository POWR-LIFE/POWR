/**
 * Tests for the onboarding home-gym step logic (lib/onboarding/gym.ts):
 * map-coordinate guard, displayed-list selection, marker capping, selection
 * toggle, button label, and the gym_requests payload that
 * lib/api/gyms.ts#createGymRequest inserts.
 */

import {
    buildGymRequestPayload,
    continueLabel,
    displayedGyms,
    gymMarkerSetKey,
    gymMarkers,
    hasGymCoords,
    toggleSelection,
} from '@/lib/onboarding/gym';

describe('hasGymCoords', () => {
    it('accepts real coordinates', () => {
        expect(hasGymCoords({ lat: 51.5074, lng: -0.1278 })).toBe(true);
    });

    it('rejects the null-island (0,0) placeholder', () => {
        expect(hasGymCoords({ lat: 0, lng: 0 })).toBe(false);
    });

    it('accepts a real axis even when the other is 0', () => {
        expect(hasGymCoords({ lat: 51.5, lng: 0 })).toBe(true);
    });

    it('rejects non-finite coordinates', () => {
        expect(hasGymCoords({ lat: NaN, lng: 1 })).toBe(false);
        expect(hasGymCoords({ lat: Infinity, lng: 1 })).toBe(false);
    });
});

describe('displayedGyms', () => {
    const nearby = [{ dbId: 'a' }, { dbId: 'b' }];

    it('shows nearby when there is no active search (null)', () => {
        expect(displayedGyms(null, nearby)).toBe(nearby);
    });

    it('shows search results once present, even when empty', () => {
        expect(displayedGyms([], nearby)).toEqual([]);
        const results = [{ dbId: 'c' }];
        expect(displayedGyms(results, nearby)).toBe(results);
    });
});

describe('gymMarkers', () => {
    it('keeps only gyms with usable coordinates', () => {
        const list = [
            { lat: 51.5, lng: -0.1 },
            { lat: 0, lng: 0 },
            { lat: NaN, lng: 1 },
        ];
        expect(gymMarkers(list)).toHaveLength(1);
    });

    it('caps the number of markers', () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ lat: 51 + i / 1000, lng: -0.1 }));
        expect(gymMarkers(many)).toHaveLength(25);
        expect(gymMarkers(many, 10)).toHaveLength(10);
    });
});

describe('gymMarkerSetKey', () => {
    const a = { id: 'a-0' }, b = { id: 'b-0' }, c = { id: 'c-0' };

    it('is stable for the same set — a repeated query remounts nothing', () => {
        expect(gymMarkerSetKey([a, b])).toBe(gymMarkerSetKey([{ id: 'a-0' }, { id: 'b-0' }]));
    });

    it('changes when membership changes', () => {
        const base = gymMarkerSetKey([a, b]);
        expect(gymMarkerSetKey([a, b, c])).not.toBe(base);
        expect(gymMarkerSetKey([a])).not.toBe(base);
        expect(gymMarkerSetKey([])).not.toBe(base);
    });

    it('is order-sensitive (the drawn set is an ordered list)', () => {
        expect(gymMarkerSetKey([a, b])).not.toBe(gymMarkerSetKey([b, a]));
    });

    it('is a short key fragment, safe to prefix a React key with', () => {
        expect(gymMarkerSetKey([a, b, c])).toMatch(/^[0-9a-z]{1,8}$/);
    });
});

describe('toggleSelection', () => {
    it('selects a new gym', () => {
        expect(toggleSelection(null, 'gym-1')).toBe('gym-1');
        expect(toggleSelection('gym-1', 'gym-2')).toBe('gym-2');
    });

    it('deselects when tapping the already-selected gym', () => {
        expect(toggleSelection('gym-1', 'gym-1')).toBeNull();
    });
});

describe('continueLabel', () => {
    it('reads CONTINUE once a gym is chosen, SKIP otherwise', () => {
        expect(continueLabel('gym-1')).toBe('CONTINUE');
        expect(continueLabel(null)).toBe('SKIP FOR NOW');
    });
});

describe('buildGymRequestPayload', () => {
    it('builds a trimmed insert row tied to the user', () => {
        const { row, error } = buildGymRequestPayload(
            { name: '  PureGym Shoreditch ', locationText: '  London  ' },
            'user-1',
        );
        expect(error).toBeNull();
        expect(row).toEqual({
            user_id: 'user-1',
            name: 'PureGym Shoreditch',
            location_text: 'London',
            note: null,
        });
    });

    it('null-coalesces blank optional fields', () => {
        const { row } = buildGymRequestPayload({ name: 'Gym X', locationText: '   ', note: '' }, 'user-1');
        expect(row).toMatchObject({ location_text: null, note: null });
    });

    it('rejects a blank gym name with an error and no row', () => {
        const { row, error } = buildGymRequestPayload({ name: '   ' }, 'user-1');
        expect(row).toBeNull();
        expect(error).toBe('Please enter a gym name.');
    });
});
