/**
 * The points-history filter axis: buckets must partition a member's rows so
 * every entry is reachable from exactly one bucket, no bucket is ever offered
 * empty, and each carries the count and net the picker displays.
 */

import type { PointTransaction } from '@/lib/api/points';
import {
  bucketOf,
  buildLedgerFilters,
  findLedgerFilter,
  matchesLedgerFilter,
} from '@/lib/ledgerFilters';

function tx(overrides: Partial<PointTransaction> = {}): PointTransaction {
    return {
        id: Math.random().toString(36).slice(2),
        amount: 100,
        type: 'earn',
        source: null,
        description: null,
        created_at: '2026-07-01T10:00:00Z',
        session_id: null,
        activity_type: null,
        multiplier: 1,
        ...overrides,
    };
}

const keys = (rows: PointTransaction[]) => buildLedgerFilters(rows).map((f) => f.key);

describe('bucketOf', () => {
    test('routes a session-backed row to its activity', () => {
        expect(bucketOf(tx({ activity_type: 'gym' }))).toBe('activity:gym');
    });

    test('routes a shared-challenge row to Together, over its activity', () => {
        // The row already renders with the people icon and a TOGETHER badge —
        // the bucket has to agree with what the member can see.
        expect(bucketOf(tx({ activity_type: 'running', source: 'shared_challenge' }))).toBe('together');
        expect(bucketOf(tx({ source: 'shared_challenge_bonus' }))).toBe('together');
    });

    test('falls back to the transaction type when no activity is attached', () => {
        expect(bucketOf(tx({ type: 'redeem', amount: -500 }))).toBe('type:redeem');
        expect(bucketOf(tx({ type: 'bonus', source: 'vault_release' }))).toBe('type:bonus');
        expect(bucketOf(tx({ type: 'earn' }))).toBe('type:earn');
    });

    test('ignores an activity_type that is not in the catalogue', () => {
        // Wearables can surface types the app has no config for; those must not
        // mint a bucket with no label.
        expect(bucketOf(tx({ activity_type: 'pilates' }))).toBe('type:earn');
    });
});

describe('buildLedgerFilters', () => {
    test('offers only buckets the member actually has', () => {
        expect(keys([
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'running' }),
            tx({ type: 'redeem', amount: -500 }),
        ])).toEqual(['all', 'activity:running', 'activity:gym', 'type:redeem']);
    });

    test('orders each group by row count, so real training sits at the top', () => {
        // Gym is 5th in the catalogue but the member's most frequent — it leads.
        expect(keys([
            tx({ activity_type: 'walking' }),
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'running' }),
            tx({ activity_type: 'running' }),
        ])).toEqual(['all', 'activity:gym', 'activity:running', 'activity:walking']);
    });

    test('breaks count ties on catalogue order, so the list is deterministic', () => {
        expect(keys([
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'walking' }),
            tx({ activity_type: 'running' }),
        ])).toEqual(['all', 'activity:walking', 'activity:running', 'activity:gym']);
    });

    test('sorts activities before other points, Together ahead of type buckets on a tie', () => {
        const result = keys([
            tx({ type: 'streak' }),
            tx({ activity_type: 'gym' }),
            tx({ source: 'shared_challenge' }),
            tx({ type: 'bonus' }),
        ]);
        expect(result).toEqual(['all', 'activity:gym', 'together', 'type:bonus', 'type:streak']);
    });

    test('groups buckets for the sheet sections', () => {
        const filters = buildLedgerFilters([
            tx({ activity_type: 'gym' }),
            tx({ source: 'shared_challenge' }),
            tx({ type: 'redeem', amount: -10 }),
        ]);
        expect(filters.map((f) => [f.key, f.group])).toEqual([
            ['all', 'all'],
            ['activity:gym', 'activity'],
            ['together', 'other'],
            ['type:redeem', 'other'],
        ]);
    });

    test('carries a full label for the sheet and a tight one for the header chip', () => {
        // 'HIIT / Classes' is the catalogue label; the chip cannot wear it.
        const filters = buildLedgerFilters([
            tx({ activity_type: 'hiit' }),
            tx({ type: 'redeem', amount: -500 }),
        ]);
        expect(filters.map((f) => [f.label, f.shortLabel])).toEqual([
            ['All', 'All'],
            ['HIIT / Classes', 'HIIT'],
            ['Rewards', 'Rewards'],
        ]);
    });

    test('counts and nets each bucket', () => {
        const filters = buildLedgerFilters([
            tx({ activity_type: 'gym', amount: 120 }),
            tx({ activity_type: 'gym', amount: 80 }),
            tx({ type: 'redeem', amount: -500 }),
        ]);
        expect(findLedgerFilter(filters, 'activity:gym')).toMatchObject({ count: 2, net: 200 });
        expect(findLedgerFilter(filters, 'type:redeem')).toMatchObject({ count: 1, net: -500 });
    });

    test('All carries whole-history totals, spends included', () => {
        const filters = buildLedgerFilters([
            tx({ amount: 100 }),
            tx({ type: 'redeem', amount: -40 }),
        ]);
        expect(findLedgerFilter(filters, 'all')).toMatchObject({ count: 2, net: 60 });
    });

    test('returns All alone for an empty history, so the screen can hide the control', () => {
        const filters = buildLedgerFilters([]);
        expect(filters.map((f) => f.key)).toEqual(['all']);
        expect(filters[0]).toMatchObject({ count: 0, net: 0 });
    });

    test('every row is reachable from exactly one bucket', () => {
        const rows = [
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'running', source: 'shared_challenge' }),
            tx({ type: 'streak' }),
            tx({ type: 'penalty', amount: -50 }),
            tx({ type: 'adjustment', amount: -10 }),
            tx({ activity_type: 'pilates' }),
        ];
        const buckets = buildLedgerFilters(rows).filter((f) => f.key !== 'all');
        for (const row of rows) {
            expect(buckets.filter((f) => matchesLedgerFilter(row, f.key))).toHaveLength(1);
        }
    });

    test('bucket counts account for every row exactly once', () => {
        const rows = [
            tx({ activity_type: 'gym' }),
            tx({ activity_type: 'gym' }),
            tx({ source: 'shared_challenge' }),
            tx({ type: 'redeem', amount: -20 }),
        ];
        const filters = buildLedgerFilters(rows);
        const buckets = filters.filter((f) => f.key !== 'all');
        expect(buckets.reduce((sum, f) => sum + f.count, 0)).toBe(rows.length);
        expect(buckets.reduce((sum, f) => sum + f.net, 0)).toBe(findLedgerFilter(filters, 'all')!.net);
    });
});

describe('findLedgerFilter', () => {
    test('returns null for a bucket the member no longer has', () => {
        // Guards the screen against a stale selection surviving a refetch.
        expect(findLedgerFilter(buildLedgerFilters([tx({ activity_type: 'gym' })]), 'activity:yoga'))
            .toBeNull();
    });
});
