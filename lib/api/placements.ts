import { supabase } from '@/lib/supabase';
import type { Reward } from './rewards';

// =============================================================
// Reward Placements — location/time-targeted reward surfacing.
//
// "Invisible geofence": the resolver returns which placements apply to the
// current user right now (inside a coarse fence, in the flight window,
// matching prefs, under the daily cap). The client merges them into the
// existing vault (see applyPlacements / pickHeroPlacement) to boost the
// placed reward, and the background notifier surfaces a nearby offer.
// =============================================================

export type PlacementVisibility = 'boost' | 'exclusive';
export type PlacementEventType = 'surfaced' | 'presence_confirmed' | 'redeemed' | 'notified';

export interface ResolvedPlacement {
  placement_id: string;
  reward_id: string;
  visibility: PlacementVisibility;
  priority: number;
  paid: boolean;
  partner_id: string | null;
  distance_m: number;
}

/**
 * Ask the backend which placements apply at the given coarse coordinates.
 * Day/hour are sent from the DEVICE clock so time-targeting matches the
 * user's actual local time (mirrors per-user-local broadcast delivery).
 */
export async function resolveContextualPlacements(
  lat: number,
  lng: number,
): Promise<ResolvedPlacement[]> {
  const now = new Date();
  const { data, error } = await supabase.rpc('resolve_reward_placements', {
    p_lat: lat,
    p_lng: lng,
    p_local_dow: now.getDay(),   // 0 = Sunday … 6 = Saturday
    p_local_hour: now.getHours(),
  });
  if (error) throw error;
  return (data ?? []) as ResolvedPlacement[];
}

/**
 * Record a funnel moment. Fire 'surfaced' when a placed reward is shown,
 * 'redeemed' when it's redeemed. This log powers frequency caps, billing,
 * and the attribution dashboard. Best-effort: never throws into the UI.
 */
export async function logPlacementEvent(
  placementId: string,
  eventType: PlacementEventType,
  coords?: { lat: number; lng: number },
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase.from('reward_placement_events').insert({
      placement_id: placementId,
      user_id: userId,
      event_type: eventType,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
  } catch {
    // Non-critical telemetry — swallow so it never disrupts the reward flow.
  }
}

/**
 * Sort key for a placement — lower sorts first: paid beats unpaid, then
 * higher priority, then nearer. The single source of truth for ordering,
 * shared by the vault list boost AND the hero-card takeover.
 */
export function placementRank(p: ResolvedPlacement): number {
  return (p.paid ? 0 : 1_000_000) + (100_000 - p.priority) * 1_000 + Math.min(p.distance_m, 999);
}

/**
 * Choose the single placement that should take over the hero card. Only
 * placements whose reward is actually in the vault (present in `rewardIds`)
 * are eligible — a placement for a reward the user can't see shouldn't seize
 * the hero. Returns the best-ranked one, or null (→ keep the normal hero).
 */
export function pickHeroPlacement(
  rewardIds: Set<string>,
  placements: ResolvedPlacement[],
): ResolvedPlacement | null {
  let best: ResolvedPlacement | null = null;
  for (const p of placements) {
    if (!rewardIds.has(p.reward_id)) continue;
    if (best === null || placementRank(p) < placementRank(best)) best = p;
  }
  return best;
}

export interface MergedRewards {
  /** Rewards reordered so placed ones lead (paid → priority → distance). */
  rewards: Reward[];
  /** reward_id → the placement that surfaced it, for the "Sponsored" tag + logging. */
  placementByRewardId: Map<string, ResolvedPlacement>;
}

/**
 * Merge resolved placements into the base vault WITHOUT hiding anything.
 * 'boost' placements move a reward the user can already see to the front;
 * rewards with no placement keep their normal relative order behind them.
 *
 * 'exclusive' placements are recognised and tagged, but surfacing rewards
 * that are otherwise hidden is a later increment (needs a hidden-reward
 * fetch path); for now they behave like a boost if the reward is present.
 */
export function applyPlacements(
  rewards: Reward[],
  placements: ResolvedPlacement[],
): MergedRewards {
  // Best placement per reward (resolver already ordered; keep the first seen).
  const placementByRewardId = new Map<string, ResolvedPlacement>();
  for (const p of placements) {
    if (!placementByRewardId.has(p.reward_id)) placementByRewardId.set(p.reward_id, p);
  }

  const rank = (r: Reward): number => {
    const p = placementByRewardId.get(r.id);
    return p ? placementRank(p) : Number.POSITIVE_INFINITY;
  };

  const boosted: Reward[] = [];
  const rest: Reward[] = [];
  for (const r of rewards) (placementByRewardId.has(r.id) ? boosted : rest).push(r);
  boosted.sort((a, b) => rank(a) - rank(b));

  return { rewards: [...boosted, ...rest], placementByRewardId };
}
