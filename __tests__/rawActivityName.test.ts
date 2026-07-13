import { formatRawActivityName } from '@/lib/rawActivityName';

describe('formatRawActivityName', () => {
    it('passes through informative Terra names unchanged', () => {
        expect(formatRawActivityName('Padel Tennis', 'sports')).toBe('Padel Tennis');
        expect(formatRawActivityName('Strength Training', 'gym')).toBe('Strength Training');
    });

    it('prettifies snake_case Health Connect names', () => {
        expect(formatRawActivityName('boot_camp', 'hiit')).toBe('Boot Camp');
        expect(formatRawActivityName('rock_climbing', 'gym')).toBe('Rock Climbing');
        expect(formatRawActivityName('swimming_open_water', 'swimming')).toBe('Swimming Open Water');
    });

    it('keeps acronyms uppercased', () => {
        expect(formatRawActivityName('hiit', 'gym')).toBe('HIIT');
    });

    it('suppresses names that repeat the bucket', () => {
        expect(formatRawActivityName('gym', 'gym')).toBeNull();
        expect(formatRawActivityName('Running', 'running')).toBeNull();
        expect(formatRawActivityName('hiit', 'hiit')).toBeNull();
        // matches the bucket's display label rather than its key
        expect(formatRawActivityName('Walking', 'walking')).toBeNull();
    });

    it('suppresses uninformative provider placeholders', () => {
        expect(formatRawActivityName('other', 'gym')).toBeNull();
        expect(formatRawActivityName('Activity', 'gym')).toBeNull(); // Whoop unspecified
        expect(formatRawActivityName('Unknown', 'gym')).toBeNull();
        expect(formatRawActivityName('exercise_57', 'gym')).toBeNull(); // HC unmapped int
    });

    it('handles null/empty input', () => {
        expect(formatRawActivityName(null, 'gym')).toBeNull();
        expect(formatRawActivityName(undefined, 'gym')).toBeNull();
        expect(formatRawActivityName('   ', 'gym')).toBeNull();
        expect(formatRawActivityName('___', 'gym')).toBeNull();
    });
});
