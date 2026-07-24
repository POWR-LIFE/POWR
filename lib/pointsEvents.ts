// ─── Points-changed event bus ────────────────────────────────────────────────
// Fires synchronously in the JS thread whenever something may have changed the
// user's points/level server-side outside the geofence claim path — a foreground
// push (level_up, reward_unlocked, a session/wearable receipt) or a foreground
// health-sync earn. usePoints subscribes and invalidates its ['points'] query so
// the on-screen "X pts to next level" readout can never lag a server-driven
// notification (e.g. a "You're now Cardio Goblin" push arriving while the home
// counter still shows the cached "1 pt to go").
//
// Mirrors GeofenceContext.onSessionCompleted: a plain module-level bus, so any
// module (React or not) can emit without reaching for a QueryClient, and without
// depending on provider nesting order.

type PointsChangedListener = () => void;

const _listeners = new Set<PointsChangedListener>();

export function onPointsChanged(listener: PointsChangedListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export function emitPointsChanged(): void {
  _listeners.forEach((l) => l());
}
