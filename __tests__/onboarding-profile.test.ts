/**
 * Tests for the onboarding profile-step logic (lib/onboarding/username.ts):
 * username normalization, validity, the "can continue" gate, the auto-suggested
 * handle, and the availability rule that lib/api/user.ts#isUsernameAvailable runs.
 */

import {
    MAX_USERNAME,
    MIN_USERNAME,
    canSubmitProfile,
    isHandleFree,
    isUsernameValid,
    normalizeUsername,
    suggestUsernameBase,
} from '@/lib/onboarding/username';

describe('normalizeUsername', () => {
    it('lowercases and strips disallowed characters', () => {
        expect(normalizeUsername('Jamie Smith')).toBe('jamiesmith');
        expect(normalizeUsername('J@mie!')).toBe('jmie');
        expect(normalizeUsername('café_runner')).toBe('caf_runner');
    });

    it('keeps letters, numbers and underscores', () => {
        expect(normalizeUsername('powr_user_99')).toBe('powr_user_99');
    });

    it('caps length at MAX_USERNAME', () => {
        const long = 'a'.repeat(MAX_USERNAME + 10);
        expect(normalizeUsername(long)).toHaveLength(MAX_USERNAME);
    });

    it('returns empty string for all-invalid input', () => {
        expect(normalizeUsername('!!! ??? ...')).toBe('');
    });
});

describe('isUsernameValid', () => {
    it('requires at least MIN_USERNAME characters', () => {
        expect(isUsernameValid('a'.repeat(MIN_USERNAME - 1))).toBe(false);
        expect(isUsernameValid('a'.repeat(MIN_USERNAME))).toBe(true);
    });

    it('rejects over-long handles', () => {
        expect(isUsernameValid('a'.repeat(MAX_USERNAME + 1))).toBe(false);
    });
});

describe('canSubmitProfile', () => {
    it('is true only with a name and an available, valid username', () => {
        expect(canSubmitProfile('Jamie', 'jamie', 'available')).toBe(true);
    });

    it('is false without a display name', () => {
        expect(canSubmitProfile('   ', 'jamie', 'available')).toBe(false);
    });

    it('is false when the username is too short', () => {
        expect(canSubmitProfile('Jamie', 'ab', 'available')).toBe(false);
    });

    it('is false until availability is confirmed', () => {
        expect(canSubmitProfile('Jamie', 'jamie', 'checking')).toBe(false);
        expect(canSubmitProfile('Jamie', 'jamie', 'taken')).toBe(false);
        expect(canSubmitProfile('Jamie', 'jamie', 'idle')).toBe(false);
    });
});

describe('suggestUsernameBase', () => {
    it('derives a handle from the display name', () => {
        expect(suggestUsernameBase('Jamie Smith')).toBe('jamiesmith');
    });

    it('falls back to the email local-part when there is no name', () => {
        expect(suggestUsernameBase('', 'jamie@powr.life')).toBe('jamie');
    });

    it('returns empty when neither is usable', () => {
        expect(suggestUsernameBase('', null)).toBe('');
        expect(suggestUsernameBase('', undefined)).toBe('');
    });
});

describe('isHandleFree', () => {
    it('is free when no profile holds the handle', () => {
        expect(isHandleFree(null, 'user-1')).toBe(true);
        expect(isHandleFree(undefined, 'user-1')).toBe(true);
    });

    it('is free when the only holder is the current user (re-saving own handle)', () => {
        expect(isHandleFree({ id: 'user-1' }, 'user-1')).toBe(true);
    });

    it('is taken when another user holds it', () => {
        expect(isHandleFree({ id: 'user-2' }, 'user-1')).toBe(false);
    });
});
