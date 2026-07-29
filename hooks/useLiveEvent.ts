import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
    fetchActiveLiveEvent,
    fetchInviteProgress,
    joinLiveEvent,
    type InviteProgress,
    type LiveEvent,
} from '@/lib/api/liveEvents';

/**
 * The current live event (or null when none is configured) plus the viewer's
 * invite progress. Event config changes server-side take effect on refetch —
 * nothing about an event is baked into the app.
 */
export function useLiveEvent() {
    const queryClient = useQueryClient();

    const eventQuery = useQuery<LiveEvent | null>({
        queryKey: ['liveEvent'],
        queryFn: fetchActiveLiveEvent,
        staleTime: 60_000,
    });

    const inviteQuery = useQuery<InviteProgress | null>({
        queryKey: ['liveEventInvites'],
        queryFn: fetchInviteProgress,
        staleTime: 60_000,
        enabled: !!eventQuery.data,
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
        join: (eventId: string) => joinMutation.mutateAsync(eventId),
        joining: joinMutation.isPending,
        refresh: () => {
            void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
            void queryClient.invalidateQueries({ queryKey: ['liveEventInvites'] });
        },
    };
}
