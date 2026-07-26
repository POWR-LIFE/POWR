// ─── Activity-revision signal ────────────────────────────────────────────────
// One counter, bumped whenever the app learns that activity data may have moved
// server-side. Both halves of the Progress screen key off it.
//
// Why a shared signal rather than each consumer subscribing separately: the
// Progress screen stores its data in two incompatible places. The radials and
// week rings come from the ['activity','overview'] query cache; the D/W/M
// breakdown charts live in component useState behind *Loaded guards, which
// invalidateQueries cannot reach. Wiring only the cache would have fixed the
// radials and left the heatmap and day bars showing pre-claim numbers beside
// them — a screen disagreeing with itself, which is worse than one that is
// uniformly stale. Driving both from the same counter makes that impossible.
//
// The three sources mirror usePoints, including the unconditional foreground
// bump. That one is load-bearing: focusManager (lib/queryClient.ts) only
// refetches queries that are already STALE, so with a 60s staleTime a user who
// backgrounds the app, earns points, and returns within a minute would otherwise
// see the points total move while the rings kept their pre-claim values.
//
// Known limit: both buses are in-process, so a Terra webhook credit or a headless
// background geofence claim emits nothing here. Those are covered only by the
// foreground bump on the user's next return — which is exactly why it exists.

import { AppState, type AppStateStatus } from 'react-native';

import { onSessionCompleted } from '@/context/GeofenceContext';
import { onPointsChanged } from '@/lib/pointsEvents';

let _revision = 0;
const _listeners = new Set<() => void>();

function bump(): void {
    _revision++;
    _listeners.forEach((l) => {
        try {
            l();
        } catch (err) {
            console.warn('[activityRevision] listener threw:', err);
        }
    });
}

/**
 * Force a refresh of everything keyed off the revision. For pull-to-refresh,
 * which otherwise cannot reach the breakdown charts' component state.
 */
export function bumpActivityRevision(): void {
    bump();
}

export function getActivityRevision(): number {
    return _revision;
}

export function subscribeActivityRevision(listener: () => void): () => void {
    _listeners.add(listener);
    return () => {
        _listeners.delete(listener);
    };
}

// Wired once at module load, matching how lib/queryClient.ts registers its own
// AppState bridge. Module scope rather than a provider so a non-React emitter
// can reach it and provider nesting order can't matter.
onSessionCompleted(bump);
onPointsChanged(bump);
AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') bump();
});
