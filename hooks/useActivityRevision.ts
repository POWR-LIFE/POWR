import { useSyncExternalStore } from 'react';

import { getActivityRevision, subscribeActivityRevision } from '@/lib/activityRevision';

/**
 * Subscribes to the shared activity-revision counter — see lib/activityRevision.
 *
 * Consumers that hold data in component state (the breakdown tabs) put this in
 * their reset-effect deps so a bump re-runs the fetch for the visible period.
 * Consumers on the query cache invalidate on a change instead.
 */
export function useActivityRevision(): number {
    return useSyncExternalStore(subscribeActivityRevision, getActivityRevision, getActivityRevision);
}
