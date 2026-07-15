/**
 * deriveLevelUps — the ledger's reconstruction of where lifetime earned
 * crossed level boundaries. Level thresholds under test (constants/levels):
 * L2 at 500, L3 at 1,200.
 */

import { deriveLevelUps } from '@/lib/levelHistory';
import type { PointTransaction } from '@/lib/api/points';

function tx(id: string, amount: number, createdAt: string): PointTransaction {
    return {
        id,
        amount,
        type: amount > 0 ? 'earn' : 'redeem',
        source: null,
        description: null,
        created_at: createdAt,
        session_id: null,
        activity_type: null,
        multiplier: 1,
    };
}

test('emits an event on the credit that crosses a boundary', () => {
    // Newest first: +300 (b), then +300 (a). Chronologically a→b; b crosses 500.
    const events = deriveLevelUps(
        [tx('b', 300, '2026-07-02T10:00:00Z'), tx('a', 300, '2026-07-01T10:00:00Z')],
        600,
    );
    expect(events).toEqual([
        { level: 2, txId: 'b', createdAt: '2026-07-02T10:00:00Z', totalEarnedAt: 600 },
    ]);
});

test('collapses a multi-level jump to the final level, like the celebration', () => {
    const events = deriveLevelUps([tx('big', 1300, '2026-07-01T10:00:00Z')], 1300);
    expect(events).toEqual([
        { level: 3, txId: 'big', createdAt: '2026-07-01T10:00:00Z', totalEarnedAt: 1300 },
    ]);
});

test('anchors a truncated window on totalEarnedNow instead of assuming zero', () => {
    // Only one +300 credit is visible but lifetime is 1,400 — so 1,100 was
    // earned before the window and the visible credit crosses 1,200.
    const events = deriveLevelUps([tx('t', 300, '2026-07-01T10:00:00Z')], 1400);
    expect(events).toEqual([
        { level: 3, txId: 't', createdAt: '2026-07-01T10:00:00Z', totalEarnedAt: 1400 },
    ]);
});

test('debits never trigger or shift level-ups', () => {
    // totalEarned counts credits only, so the -200 must not drag the running
    // total back below a boundary it already crossed.
    const events = deriveLevelUps(
        [
            tx('c', 100, '2026-07-03T10:00:00Z'),
            tx('spend', -200, '2026-07-02T12:00:00Z'),
            tx('b', 500, '2026-07-02T10:00:00Z'),
            tx('a', 100, '2026-07-01T10:00:00Z'),
        ],
        700,
    );
    expect(events).toEqual([
        { level: 2, txId: 'b', createdAt: '2026-07-02T10:00:00Z', totalEarnedAt: 600 },
    ]);
});

test('no boundary crossed → no events', () => {
    expect(deriveLevelUps([tx('a', 100, '2026-07-01T10:00:00Z')], 100)).toEqual([]);
});
