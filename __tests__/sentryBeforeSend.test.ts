/**
 * beforeSend filter in lib/sentry.ts: offline postgrest rejections are dropped,
 * server-side postgrest errors are normalized so they group, and everything
 * else passes through untouched (fail open).
 *
 * The postgrest error shapes here mirror what postgrest-js actually produces
 * (PostgrestBuilder: on a fetch rejection it fabricates a PLAIN
 * `{ message, details, hint, code }` object with `code: ''` and the fetch
 * error's name+message; server failures carry a real code like 23505/PGRST116).
 */
jest.mock('@sentry/react-native', () => ({
    init: jest.fn(),
    setTag: jest.fn(),
}));

import type { ErrorEvent } from '@sentry/core';
import { beforeSend } from '@/lib/sentry';

function eventFor(thrown: unknown): { event: ErrorEvent; hint: { originalException: unknown } } {
    // Minimal shape of the event Sentry synthesizes for a non-Error rejection.
    return {
        event: {
            exception: {
                values: [{
                    type: 'Error',
                    value: 'Object captured as exception with keys: code, details, hint, message',
                }],
            },
        } as ErrorEvent,
        hint: { originalException: thrown },
    };
}

describe('sentry beforeSend', () => {
    it('drops a postgrest transport failure (RN offline)', () => {
        const { event, hint } = eventFor({
            message: 'TypeError: Network request failed',
            details: 'TypeError: Network request failed\n  at ...',
            hint: '',
            code: '',
        });
        expect(beforeSend(event, hint)).toBeNull();
    });

    it('drops web fetch transport failures and aborts', () => {
        for (const message of [
            'TypeError: Failed to fetch',
            'TypeError: Load failed',
            'AbortError: Aborted',
        ]) {
            const { event, hint } = eventFor({ message, details: '', hint: '', code: '' });
            expect(beforeSend(event, hint)).toBeNull();
        }
    });

    it('keeps and normalizes a server-side postgrest error', () => {
        const { event, hint } = eventFor({
            message: 'duplicate key value violates unique constraint "one_gym_session_per_day"',
            details: 'Key (user_id, day)=(…) already exists.',
            hint: '',
            code: '23505',
        });
        const sent = beforeSend(event, hint);
        expect(sent).not.toBeNull();
        expect(sent!.exception!.values![0].type).toBe('PostgrestError');
        expect(sent!.exception!.values![0].value).toBe(
            'duplicate key value violates unique constraint "one_gym_session_per_day" [23505]',
        );
        expect((sent!.extra as { postgrest: { code: string } }).postgrest.code).toBe('23505');
    });

    it('keeps a codeless non-network postgrest error (fail open)', () => {
        const { event, hint } = eventFor({
            message: 'JSON object requested, multiple (or no) rows returned',
            details: '',
            hint: '',
            code: '',
        });
        const sent = beforeSend(event, hint);
        expect(sent).not.toBeNull();
        expect(sent!.exception!.values![0].value).toBe(
            'JSON object requested, multiple (or no) rows returned',
        );
    });

    it('never touches real Error instances, even network-shaped ones', () => {
        const err = new TypeError('Network request failed');
        const { event, hint } = eventFor(err);
        const sent = beforeSend(event, hint);
        expect(sent).toBe(event);
        expect(sent!.exception!.values![0].type).toBe('Error');
    });

    it('passes through events with no originalException', () => {
        const { event } = eventFor(null);
        expect(beforeSend(event, undefined)).toBe(event);
        expect(beforeSend(event, { originalException: null })).toBe(event);
    });

    it('passes through objects missing any postgrest key', () => {
        const { event, hint } = eventFor({ message: 'nope', code: '' });
        expect(beforeSend(event, hint)).toBe(event);
    });
});
