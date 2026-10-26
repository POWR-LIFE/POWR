import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { fetchMyDrop, openMyDrop, type MyDrop, type OpenDropResult } from '@/lib/api/drop';
import { backfillWalkingDays, syncWalkingNow } from '@/lib/health/walkingSync';

const KEY = ['drop', 'today'] as const;

/** Background step syncs for the card, at most this often. */
const SYNC_EVERY_MS = 60 * 1000;
let lastSyncAt = 0;
/** The Drop day whose missed days have been backfilled (and read again since). */
let backfillStartedFor: string | null = null;
let settledFor: string | null = null;

/**
 * Today's Drop from the server, which counts steps from the day's walking row.
 * For members with the Drop on, the card shows the server's numbers at once,
 * then syncs in the background and reads again — so the numbers follow the
 * walk without anyone waiting on a sync. The open itself needs no sync: the
 * card only offers it once the server's own count meets the target.
 *
 * The day's first read also backfills days the app missed: today's target is
 * set from the last 14 days, and the server re-plans a sealed day for its
 * first 15 minutes, so the backfill lands before the target freezes. Until it
 * has, `settled` is false (the Comeback welcome waits for it). Members without
 * the Drop are left alone: Home doesn't sync steps for them.
 */
export function useDrop(): {
    drop: MyDrop | null;
    isPending: boolean;
    /** Today's target has settled from the backfilled history. */
    settled: boolean;
    refresh: () => Promise<void>;
    open: () => Promise<OpenDropResult>;
} {
    const queryClient = useQueryClient();
    const { data, isPending } = useQuery({
        queryKey: KEY,
        queryFn: async () => {
            const drop = await fetchMyDrop();
            if (drop?.status !== 'sealed') return drop;
            if (backfillStartedFor !== drop.day) {
                backfillStartedFor = drop.day;
                lastSyncAt = Date.now();
                Promise.all([backfillWalkingDays().catch(() => {}), syncWalkingNow().catch(() => {})])
                    .finally(() => {
                        settledFor = drop.day;
                        queryClient.invalidateQueries({ queryKey: KEY });
                    });
            } else if (Date.now() - lastSyncAt > SYNC_EVERY_MS) {
                lastSyncAt = Date.now();
                syncWalkingNow()
                    .catch(() => {})
                    .finally(() => queryClient.invalidateQueries({ queryKey: KEY }));
            }
            return drop;
        },
        staleTime: 30 * 1000,
    });

    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: KEY });
    }, [queryClient]);

    const open = useCallback(async () => {
        const result = await openMyDrop();
        queryClient.invalidateQueries({ queryKey: KEY });
        if (result.ok) {
            // The prize landed in the balance, the Vault or the Wallet.
            queryClient.invalidateQueries({ queryKey: ['points'] });
            queryClient.invalidateQueries({ queryKey: ['vault'] });
            queryClient.invalidateQueries({ queryKey: ['wallet'] });
        }
        return result;
    }, [queryClient]);

    const drop = data ?? null;
    const settled = !drop || drop.status !== 'sealed' || settledFor === drop.day;
    return { drop, isPending, settled, refresh, open };
}
