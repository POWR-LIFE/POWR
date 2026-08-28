import {
    DEFAULT_SELECTIONS,
    countObservedTypes,
    observedLabelList,
    preselectFromObserved,
} from '@/lib/onboarding/activities';
import { routeAfterActivities } from '@/lib/onboarding/flow';

describe('countObservedTypes', () => {
    it('counts pickable session types and drops sleep/unknown/garbage', () => {
        expect(countObservedTypes([
            { type: 'running' }, { type: 'running' }, { type: 'sleep' }, { type: 'nonsense' }, { type: null }, { type: 'cycling' },
        ])).toEqual({ running: 2, cycling: 1 });
    });
});

describe('preselectFromObserved', () => {
    it('is exactly the defaults (gym) when nothing was observed', () => {
        expect(preselectFromObserved({}, { max: 3 })).toEqual(DEFAULT_SELECTIONS);
    });

    it('puts observed buckets first, most sessions first, then fills with gym', () => {
        const picks = preselectFromObserved({ running: 1, cycling: 4 }, { max: 3 });
        expect(picks.map(p => p.bucket)).toEqual(['cycling', 'running', 'gym']);
    });

    it('caps at max — observed wins over the gym default', () => {
        const picks = preselectFromObserved({ running: 2, cycling: 2, walking: 5 }, { max: 3 });
        expect(picks.map(p => p.bucket)).toEqual(['walking', 'running', 'cycling']);
    });

    it('does not double-tick gym when it was observed', () => {
        const picks = preselectFromObserved({ gym: 3, walking: 1 }, { max: 3 });
        expect(picks.map(p => p.bucket)).toEqual(['gym', 'walking']);
    });
});

describe('observedLabelList', () => {
    it('joins only the observed picks, in English', () => {
        const picks = preselectFromObserved({ running: 1, cycling: 4 }, { max: 3 });
        expect(observedLabelList(picks, { running: 1, cycling: 4 })).toBe('cycling and running');
        expect(observedLabelList(picks, {})).toBe('');
    });
});

describe('routeAfterActivities', () => {
    it('shows the home-gym step only when gym was picked', () => {
        const gym = { slug: 'gym', label: 'Gym', bucket: 'gym' };
        const running = { slug: 'running', label: 'Running', bucket: 'running' };
        expect(routeAfterActivities([gym])).toBe('/onboarding-gym');
        expect(routeAfterActivities([running])).toBe('/onboarding-health');
        expect(routeAfterActivities([])).toBe('/onboarding-health');
    });
});
