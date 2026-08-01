/**
 * Tests for wearable freshness (lib/health/wearableStatus.ts).
 *
 * This is the signal that would have caught the June 2026 Whoop trimmed-scope
 * outage — connections that stayed authorised while delivering nothing for five
 * weeks. The two requirements pull against each other: catch a genuinely dead
 * connection, but never shout at someone who just didn't wear their watch.
 */

import {
    formatSyncAge,
    hoursSinceUpload,
    wearableFreshness,
    wearableSilentCopy,
    WEARABLE_SILENT_HOURS,
    WEARABLE_STALE_HOURS,
} from '@/lib/health/wearableStatus';

const NOW = new Date('2026-08-01T12:00:00Z');
const agoHours = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('hoursSinceUpload', () => {
    it('measures elapsed hours', () => {
        expect(hoursSinceUpload(agoHours(5), NOW)).toBeCloseTo(5);
    });

    it('returns null for never-delivered and for garbage timestamps', () => {
        expect(hoursSinceUpload(null, NOW)).toBeNull();
        expect(hoursSinceUpload('not-a-date', NOW)).toBeNull();
    });

    it('clamps a provider clock running ahead of ours to 0 (never "synced in 3h")', () => {
        expect(hoursSinceUpload(agoHours(-3), NOW)).toBe(0);
    });
});

describe('wearableFreshness', () => {
    it('is none without a live connection — the 95% case renders nothing', () => {
        expect(wearableFreshness({ connected: false, lastUploadAt: agoHours(500), now: NOW }))
            .toBe('none');
    });

    it('is fresh for a recent delivery', () => {
        expect(wearableFreshness({ connected: true, lastUploadAt: agoHours(2), now: NOW }))
            .toBe('fresh');
    });

    it('goes stale exactly at the threshold, not before', () => {
        expect(wearableFreshness({
            connected: true, lastUploadAt: agoHours(WEARABLE_STALE_HOURS - 0.1), now: NOW,
        })).toBe('fresh');
        expect(wearableFreshness({
            connected: true, lastUploadAt: agoHours(WEARABLE_STALE_HOURS), now: NOW,
        })).toBe('stale');
    });

    it('stays merely stale through a weekend off-wrist, up to the silent threshold', () => {
        expect(wearableFreshness({
            connected: true, lastUploadAt: agoHours(WEARABLE_SILENT_HOURS - 0.1), now: NOW,
        })).toBe('stale');
    });

    it('goes silent at the banner threshold', () => {
        expect(wearableFreshness({
            connected: true, lastUploadAt: agoHours(WEARABLE_SILENT_HOURS), now: NOW,
        })).toBe('silent');
    });

    it('treats never-delivered as silent — the exact shape of both real outages', () => {
        // Auth succeeded, no data ever arrived. A connected/disconnected dot
        // would show green here; that is the bug this module exists to fix.
        expect(wearableFreshness({ connected: true, lastUploadAt: null, now: NOW }))
            .toBe('silent');
    });
});

describe('formatSyncAge', () => {
    it('reads coarsely, not as a precise clock', () => {
        expect(formatSyncAge(null)).toBe('no data yet');
        expect(formatSyncAge(0.2)).toBe('synced just now');
        expect(formatSyncAge(1.5)).toBe('synced 1h ago');
        expect(formatSyncAge(6.7)).toBe('synced 6h ago');
        expect(formatSyncAge(30)).toBe('synced yesterday');
        expect(formatSyncAge(24 * 5)).toBe('synced 5d ago');
    });
});

describe('wearableSilentCopy', () => {
    it('states the observation, never the inference', () => {
        const copy = wearableSilentCopy('Whoop', 24 * 9);
        expect(copy.body).toContain('hasn’t sent POWR any data in 9 days');
        // "Disconnected" would be a claim we cannot support — we can't tell a
        // broken grant from an unworn watch, and we'd be wrong every rest day.
        expect(`${copy.title} ${copy.body} ${copy.cta}`.toLowerCase())
            .not.toContain('disconnect');
    });

    it('handles never-delivered without printing "NaN days"', () => {
        const copy = wearableSilentCopy('Garmin', null);
        expect(copy.body).toContain('since you connected it');
        expect(copy.body).not.toContain('NaN');
    });
});
