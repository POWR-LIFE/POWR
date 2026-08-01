/**
 * Tests for the webhook's device-freshness extraction
 * (supabase/functions/_shared/deviceFreshness.ts).
 *
 * This stamps terra_connections.last_upload_at, which the home wearable chip and
 * the stale-wearable banner both read. Getting it wrong is quietly expensive: a
 * timestamp that never ages makes the chip permanently green and reintroduces
 * exactly the blind spot the feature exists to close.
 */

import {
    DATA_TYPES,
    extractDeviceFreshness,
    freshnessPatch,
} from '@/supabase/functions/_shared/deviceFreshness';

const NOW = Date.parse('2026-08-01T12:00:00Z');
const rec = (last_upload_date?: string, name?: string) => ({
    device_data: { ...(last_upload_date ? { last_upload_date } : {}), ...(name ? { name } : {}) },
});

describe('DATA_TYPES', () => {
    it('includes daily — the whole reason this is separate from last_event_at', () => {
        // last_event_at deliberately excludes 'daily' to keep terra-poll working.
        // If this clock inherited that exclusion, a Strava user (no sleep, no
        // activity for days) would read as silent while syncing perfectly.
        expect(DATA_TYPES.has('daily')).toBe(true);
        expect([...DATA_TYPES].sort()).toEqual(['activity', 'body', 'daily', 'sleep']);
    });

    it('excludes lifecycle events — an auth-only connection has delivered nothing', () => {
        expect(DATA_TYPES.has('auth')).toBe(false);
        expect(DATA_TYPES.has('deauth')).toBe(false);
    });
});

describe('extractDeviceFreshness', () => {
    it('takes the latest last_upload_date across the batch', () => {
        const out = extractDeviceFreshness({
            data: [
                rec('2026-08-01T09:00:00Z'),
                rec('2026-08-01T11:30:00Z'),
                rec('2026-08-01T10:00:00Z'),
            ],
        }, NOW);
        expect(out.last_upload_at).toBe('2026-08-01T11:30:00.000Z');
    });

    it('picks up the device name', () => {
        const out = extractDeviceFreshness({ data: [rec('2026-08-01T09:00:00Z', 'Forerunner 265')] }, NOW);
        expect(out.device_name).toBe('Forerunner 265');
    });

    it('falls back to now when the provider omits device_data (Strava)', () => {
        const out = extractDeviceFreshness({ data: [{ metadata: {} }] }, NOW);
        expect(out.last_upload_at).toBe('2026-08-01T12:00:00.000Z');
        expect(out.device_name).toBeNull();
    });

    it('clamps a future provider timestamp to now — must still be able to go stale', () => {
        const out = extractDeviceFreshness({ data: [rec('2026-08-02T12:00:00Z')] }, NOW);
        expect(out.last_upload_at).toBe('2026-08-01T12:00:00.000Z');
    });

    it('ignores unparseable dates rather than writing Invalid Date', () => {
        const out = extractDeviceFreshness({ data: [rec('yesterday-ish')] }, NOW);
        expect(out.last_upload_at).toBe('2026-08-01T12:00:00.000Z');
    });

    it('survives a malformed payload with no data array', () => {
        expect(extractDeviceFreshness({}, NOW).last_upload_at).toBe('2026-08-01T12:00:00.000Z');
        expect(extractDeviceFreshness(null, NOW).last_upload_at).toBe('2026-08-01T12:00:00.000Z');
    });
});

describe('freshnessPatch', () => {
    it('omits device_name when unknown, so a nameless payload cannot wipe it', () => {
        expect(freshnessPatch({ last_upload_at: 'X', device_name: null }))
            .toEqual({ last_upload_at: 'X' });
    });

    it('writes device_name when the payload carried one', () => {
        expect(freshnessPatch({ last_upload_at: 'X', device_name: 'Venu 3' }))
            .toEqual({ last_upload_at: 'X', device_name: 'Venu 3' });
    });
});
