/**
 * Integrity tests for the specific-activity catalog (constants/activityCatalog.ts)
 * — the identity layer over the coarse scoring buckets. These lock the
 * invariants the picker and storage rely on: stable unique slugs, every entry
 * mapping to a real pickable bucket, and search finding entries by alias.
 */

import { ACTIVITIES } from '@/constants/activities';
import {
    ACTIVITY_CATALOG,
    CATALOG_BY_SLUG,
    CATALOG_GROUPS,
    genericEntryForBucket,
    searchCatalog,
    toSelection,
} from '@/constants/activityCatalog';

describe('activity catalog', () => {
    it('has unique slugs', () => {
        const slugs = ACTIVITY_CATALOG.map(a => a.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('maps every entry to a real, pickable scoring bucket', () => {
        for (const a of ACTIVITY_CATALOG) {
            const bucket = ACTIVITIES[a.bucket];
            expect(bucket).toBeDefined();
            // gym is the locked slot and sleep is wearable-only — neither is a
            // valid catalog target; a pick must power a selectable ring.
            expect(a.bucket).not.toBe('gym');
            expect(bucket.hideFromPicker).not.toBe(true);
        }
    });

    it('covers every entry with a display group', () => {
        const grouped = new Set(CATALOG_GROUPS.flatMap(g => g.buckets));
        for (const a of ACTIVITY_CATALOG) {
            expect(grouped.has(a.bucket)).toBe(true);
        }
    });

    it('resolves a generic entry for every pickable bucket (legacy migration)', () => {
        const pickableBuckets = Object.values(ACTIVITIES)
            .filter(a => !a.hideFromPicker && a.type !== 'gym')
            .map(a => a.type);
        for (const bucket of pickableBuckets) {
            const entry = genericEntryForBucket(bucket);
            expect(entry).not.toBeNull();
            expect(entry!.bucket).toBe(bucket);
        }
    });

    it('finds activities by label, alias keyword and bucket, case-insensitively', () => {
        expect(searchCatalog('padel').map(a => a.slug)).toContain('padel');
        expect(searchCatalog('PADDLE').map(a => a.slug)).toContain('padel');   // keyword alias
        expect(searchCatalog('ping pong').map(a => a.slug)).toContain('table-tennis');
        expect(searchCatalog('sports').every(a => a.bucket === 'sports')).toBe(true);
        expect(searchCatalog('')).toHaveLength(ACTIVITY_CATALOG.length);
        expect(searchCatalog('xyzzy')).toHaveLength(0);
    });

    it('round-trips selections with the denormalised bucket', () => {
        const padel = CATALOG_BY_SLUG['padel'];
        expect(toSelection(padel)).toEqual({ slug: 'padel', label: 'Padel', bucket: 'sports' });
    });
});
