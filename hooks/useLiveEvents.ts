import { useQuery } from '@tanstack/react-query';

import { fetchActiveLiveEvent, type LiveEvent } from '@/lib/api/liveEvents';
import { designEvents } from '@/lib/dev/multiEventDesign';

/**
 * Where the viewer stands decides what they see first: an event you're in
 * outranks one you could join, and scoring now outranks scoring later.
 */
function relevance(e: LiveEvent): number {
    return (e.viewer.joined ? 0 : 2) + (e.status === 'scheduled' ? 1 : 0);
}

/**
 * Every event the viewer can currently see, most relevant first. Feeds the
 * Home carousel and the League switcher; the full per-event payload (board,
 * invites) still comes from useLiveEvent(slug).
 *
 * The server only knows how to pick ONE event today, so the list is that event
 * (plus design samples in dev — see lib/dev/multiEventDesign). Swapping the
 * queryFn for a list RPC is the only change this hook needs.
 */
export function useLiveEvents() {
    const { data, isPending } = useQuery<LiveEvent[]>({
        // Under the ['liveEvent'] prefix on purpose: join, reset and the realtime
        // lifecycle signal all invalidate that prefix, so the list follows them.
        queryKey: ['liveEvent', 'list'],
        queryFn: async () => {
            const events = designEvents(await fetchActiveLiveEvent());
            return [...events].sort(
                (a, b) =>
                    relevance(a) - relevance(b) ||
                    new Date(a.window_start_at).getTime() - new Date(b.window_start_at).getTime(),
            );
        },
        staleTime: 60_000,
    });
    return { events: data ?? [], loading: isPending };
}
