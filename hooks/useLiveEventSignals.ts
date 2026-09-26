import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useLiveEvents } from '@/hooks/useLiveEvents';
import type { LiveEvent } from '@/lib/api/liveEvents';
import { supabase } from '@/lib/supabase';

/**
 * The live-event lifecycle, pushed rather than polled.
 *
 * Every status change on a live event (the cron's go-live / lock, the
 * admin's Settle → Reveal, hide/unhide) is broadcast by a DB trigger on
 * the public Realtime topic `live-event:<slug>` (migration 20260826210000).
 * This hook — mounted once, above the tabs — listens for it and:
 *
 *   1. invalidates every live-event query, so whichever screen is showing
 *      (header, board, ticket, Home card) re-renders with the new state on
 *      its next render rather than its next 60s poll;
 *   2. on the REVEAL specifically, takes the app to THAT event's board with
 *      a success haptic — the whole room is staring at a sealed board when
 *      the admin presses the button, and the ask is that the phones turn
 *      over by themselves, not after a close-and-reopen. Only for events
 *      the viewer is on the board of: with several events running, someone
 *      else's reveal must not pull an unrelated phone away.
 *
 * The 60s board poll in useLiveEvent stays as the fallback for a socket
 * that never connected; focusManager (lib/queryClient) covers a phone that
 * was in a pocket — invalidation marks the queries stale, and the return
 * to foreground refetches them.
 *
 * Payloads carry only what get_live_event already returns to every signed-in
 * user (status, hidden, revealed_at) — never the display token.
 */

type LifecycleSignal = {
    event_id: string;
    slug: string;
    status: LiveEvent['status'];
    hidden: boolean;
    revealed_at: string | null;
    at: string;
};

type Handler = (signal: LifecycleSignal) => void;

// One channel per slug for the life of the JS runtime, never removed.
//
// ⚠ supabase.channel(topic) is a CACHE LOOKUP, not a factory, and .on()
// throws on an instance that is already joined (see the single-device
// watcher in context/AuthContext.tsx for the full story). A broadcast topic
// has to match the server's exactly, so the per-attempt-sequence trick used
// there isn't available here. The safe shape is therefore: create each
// topic once, dispatch through a module-level handler set that effects add
// to and remove from, and never ask the client for a topic twice. Events
// are rare and one-at-a-time, so a channel that outlives its event costs
// nothing.
const channels = new Map<string, RealtimeChannel>();
const handlers = new Map<string, Set<Handler>>();

function dispatch(slug: string, payload: unknown) {
    const set = handlers.get(slug);
    if (!set || !payload || typeof payload !== 'object') return;
    const signal = payload as LifecycleSignal;
    set.forEach(h => {
        try {
            h(signal);
        } catch {
            /* one bad handler must not stop the others */
        }
    });
}

function ensureChannel(slug: string) {
    if (channels.has(slug)) return;
    const topic = `live-event:${slug}`;

    // A cached instance we don't know about (dev Fast Refresh re-ran this
    // module but the client kept its channels): reuse it rather than call
    // .on() on a joined channel. Its listener dispatches through the OLD
    // module's handler map, so signals are lost until a full reload — a dev
    // only cost, and better than the throw.
    const cached = supabase.getChannels().find(c => c.topic === `realtime:${topic}`);
    if (cached) {
        channels.set(slug, cached);
        return;
    }

    const ch = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'lifecycle' }, msg => dispatch(slug, msg.payload))
        .subscribe();
    channels.set(slug, ch);
}

export function useLiveEventSignals() {
    const queryClient = useQueryClient();

    // The same list Home and League read — shares the cache, adds no poll.
    const { events } = useLiveEvents();
    const slugsKey = events.map(e => e.slug).join('|');

    // Per event, what "already revealed" means for THIS runtime, so a reveal
    // that happened before the app opened never yanks the user to League, and
    // a Re-settle → Reveal (new revealed_at) does exactly once. Plus which
    // boards the viewer is on (joined, or a global event everyone is in).
    const knownRevealedAt = useRef(new Map<string, string | null>());
    const onBoard = useRef(new Set<string>());
    useEffect(() => {
        onBoard.current = new Set(
            events.filter(e => e.viewer.joined || e.scope === 'global').map(e => e.slug),
        );
        for (const e of events) knownRevealedAt.current.set(e.slug, e.revealed_at ?? null);
    }, [events]);

    useEffect(() => {
        if (!slugsKey) return undefined;
        const detach: (() => void)[] = [];

        for (const slug of slugsKey.split('|')) {
            ensureChannel(slug);

            const handler: Handler = signal => {
                void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
                void queryClient.invalidateQueries({ queryKey: ['liveEventBoard'] });
                void queryClient.invalidateQueries({ queryKey: ['liveEventInvites'] });

                const isReveal =
                    signal.status === 'revealed' &&
                    !!signal.revealed_at &&
                    signal.revealed_at !== knownRevealedAt.current.get(slug);
                if (!isReveal) return;
                knownRevealedAt.current.set(slug, signal.revealed_at);

                // Only steer a phone that is actually being looked at, by
                // someone on this board. Everyone else gets the fresh state
                // from the invalidation above.
                if (!onBoard.current.has(slug)) return;
                if (AppState.currentState !== 'active') return;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                router.navigate({ pathname: '/(tabs)/league', params: { event: slug } });
            };

            let set = handlers.get(slug);
            if (!set) {
                set = new Set();
                handlers.set(slug, set);
            }
            set.add(handler);
            const own = set;
            detach.push(() => {
                own.delete(handler);
            });
        }

        return () => detach.forEach(d => d());
    }, [slugsKey, queryClient]);
}
