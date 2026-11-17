import { seriesDay, seriesSpan } from '@/lib/api/series';

// Read at call time, so the tests can switch the locale (jest.mock is hoisted above the import).
let mockLocale = 'en-GB';
jest.mock('@/lib/i18n', () => {
    const actual = jest.requireActual('@/lib/i18n');
    return { __esModule: true, ...actual, getFormatLocale: () => mockLocale };
});

// Round 01: 15 Nov 00:00 → 1 Dec 00:00 UTC; its last day is 30 Nov.
const START = '2026-11-15T00:00:00Z';
const LAST = '2026-11-30T12:00:00Z';

describe('How to win dates', () => {
    afterEach(() => { mockLocale = 'en-GB'; });

    it('writes a one-month round with the month once', () => {
        expect(seriesSpan(START, LAST)).toBe('15–30 Nov');
        expect(seriesDay(LAST)).toBe('30 Nov');
    });

    it('puts the month where the locale does', () => {
        mockLocale = 'en-US';
        expect(seriesSpan(START, LAST)).toBe('Nov 15–30');
        mockLocale = 'fr-FR';
        expect(seriesSpan(START, LAST)).toBe('15–30 nov.');
    });

    it('names both months when a round crosses one', () => {
        // Round 02: 15 Dec → 31 Dec stays in one month; one that runs into January doesn't.
        expect(seriesSpan('2026-12-15T00:00:00Z', '2026-12-31T12:00:00Z')).toBe('15–31 Dec');
        expect(seriesSpan('2026-11-28T00:00:00Z', '2026-12-05T12:00:00Z')).toBe('28 Nov – 5 Dec');
    });
});
