import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
    fetchActiveLiveEvent,
    fetchEventLeaderboard,
    fetchInviteProgress,
    fetchLiveEventBySlug,
    joinLiveEvent,
    type EventLeaderboard,
    type InviteProgress,
    type LiveEvent,
} from '@/lib/api/liveEvents';

/**
 * The current live event (or null when none is configured) plus the viewer's
 * invite progress. Event config changes server-side take effect on refetch —
 * nothing about an event is baked into the app.
 *
 * `slug` (from a promo-page QR deep link) pins a specific event so someone
 * registering for several upcoming events lands on the one they scanned;
 * an unknown/ended slug falls back to the active event rather than a
 * dead end.
 */
export function useLiveEvent(slug?: string) {
    const queryClient = useQueryClient();

    const eventQuery = useQuery<LiveEvent | null>({
        queryKey: ['liveEvent', slug ?? 'active'],
        queryFn: async () => {
            if (slug) {
                const pinned = await fetchLiveEventBySlug(slug);
                if (pinned) return pinned;
            }
            return fetchActiveLiveEvent();
        },
        staleTime: 60_000,
    });

    const inviteQuery = useQuery<InviteProgress | null>({
        queryKey: ['liveEventInvites'],
        queryFn: fetchInviteProgress,
        staleTime: 60_000,
        enabled: !!eventQuery.data,
    });

    // The board is server-driven state — standings while live and visible,
    // nothing score-shaped while locked, frozen results after reveal. ~60s
    // poll while the tab is mounted (spec §5); no realtime infra needed.
    const boardQuery = useQuery<EventLeaderboard | null>({
        queryKey: ['liveEventBoard', eventQuery.data?.id],
        queryFn: () => fetchEventLeaderboard(eventQuery.data!.id),
        enabled: !!eventQuery.data && eventQuery.data.status !== 'scheduled',
        refetchInterval: 60_000,
        staleTime: 30_000,
    });

    const joinMutation = useMutation({
        mutationFn: (eventId: string) => joinLiveEvent(eventId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
        },
    });

    return {
        event: eventQuery.data ?? null,
        loading: eventQuery.isPending,
        invites: inviteQuery.data ?? null,
        board: boardQuery.data ?? null,
        boardLoading: boardQuery.isPending,
        join: (eventId: string) => joinMutation.mutateAsync(eventId),
        joining: joinMutation.isPending,
        refresh: () => {
            void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
            void queryClient.invalidateQueries({ queryKey: ['liveEventInvites'] });
            void queryClient.invalidateQueries({ queryKey: ['liveEventBoard'] });
        },
    };
}
