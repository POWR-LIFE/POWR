import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';

import { fetchActiveLiveEvents, type LiveEvent } from '@/lib/api/liveEvents';

/**
 * Where the viewer stands decides what they see first: an event you're in
 * outranks one you could join, and scoring now outranks scoring later.
 */
function relevance(e: LiveEvent): number {
    return (e.viewer.joined ? 0 : 2) + (e.status === 'scheduled' ? 1 : 0);
}

// A venue event with a radius also reaches people near the venue. The last
// known fix is plenty for "within a few km": no prompt, no fresh GPS read,
// and rounded to ~1 km before it leaves the phone.
const NEAR_MAX_AGE_MS = 6 * 60 * 60 * 1000;

async function roughPosition(): Promise<{ lat: number; lng: number } | null> {
    try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        const pos = await Location.getLastKnownPositionAsync({ maxAge: NEAR_MAX_AGE_MS });
        if (!pos) return null;
        const round = (n: number) => Math.round(n * 100) / 100;
        return { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
    } catch {
        return null;
    }
}

/**
 * Every event the viewer can currently see, most relevant first. Feeds the
 * Home carousel, the League switcher and the lifecycle signals; the full
 * per-event payload (board, invites) still comes from useLiveEvent(slug).
 *
 * The server decides visibility: everyone-events for all, venue events only
 * for that venue's people (members, recent visitors, nearby) and anyone
 * already registered.
 */
export function useLiveEvents() {
    const { data, isPending } = useQuery<LiveEvent[]>({
        // Under the ['liveEvent'] prefix on purpose: join, reset and the realtime
        // lifecycle signal all invalidate that prefix, so the list follows them.
        queryKey: ['liveEvent', 'list'],
        queryFn: async () => {
            const events = await fetchActiveLiveEvents(await roughPosition());
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
