import type { ActivityType } from '@/constants/activities';
import { supabase } from '@/lib/supabase';

export interface ShareVenue {
  name: string;
  /** Best-effort label from `partners.locations[idx]` — typically a place name. */
  locationLabel: string | null;
  category: string;
}

export interface ShareReward {
  id: string;
  title: string;
  brandName: string | null;
  partnerName: string | null;
  valueLabel: string | null;
  offer: string | null;
}

export interface ShareProfile {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
}

interface BaseShareSummary {
  pointsBalance: number;
  lifetimeCount: number;
  monthCount: number;
  currentStreak: number;
  /** Mon–Sun booleans for non-manual sessions this week */
  weekActiveDays: boolean[];
  reward: ShareReward | null;
  profile: ShareProfile;
}

export interface CheckInSummary extends BaseShareSummary {
  mode: 'check-in';
  sessionId: string;
  type: ActivityType;
  startedAt: string;
  durationMin: number;
  /** Points earned in this specific session */
  sessionPoints: number;
  venue: ShareVenue | null;
}

export interface StatsSummary extends BaseShareSummary {
  mode: 'streak';
  longestStreak: number;
}

export type ShareSummary = CheckInSummary | StatsSummary;

// ─── Check-in summary (per-session) ────────────────────────────────────────

export async function fetchCheckInSummary(sessionId: string): Promise<CheckInSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: session, error: sErr } = await supabase
    .from('activity_sessions')
    .select('id, type, started_at, duration_sec, partner_id, partner_location_idx, point_transactions(amount)')
    .eq('id', sessionId)
    .single();
  if (sErr || !session) throw sErr ?? new Error('Session not found');

  const sessionPoints = ((session as any).point_transactions ?? [])
    .reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);

  const aggregates = await fetchAggregates(user.id, session.type as ActivityType);

  // Venue resolution — only if geofence detection populated partner_id
  let venue: ShareVenue | null = null;
  const partnerId = (session as any).partner_id as string | null;
  if (partnerId) {
    const { data: partner } = await supabase
      .from('partners')
      .select('name, category, locations')
      .eq('id', partnerId)
      .maybeSingle();
    if (partner) {
      const idx = (session as any).partner_location_idx ?? 0;
      const locs = (partner as any).locations as Array<{ name?: string }> | null;
      const loc = Array.isArray(locs) ? locs[idx] : null;
      venue = {
        name: partner.name,
        locationLabel: loc?.name ?? null,
        category: partner.category,
      };
    }
  }

  // Best reward the user can currently redeem with their balance
  const reward = await fetchHighestAffordableReward(aggregates.pointsBalance);

  return {
    mode: 'check-in',
    sessionId: session.id,
    type: session.type as ActivityType,
    startedAt: session.started_at,
    durationMin: Math.round(session.duration_sec / 60),
    sessionPoints,
    venue,
    ...aggregates,
    reward,
  };
}

// ─── Stats summary (no specific session — for streak/profile shares) ────────

export async function fetchStatsSummary(): Promise<StatsSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Lifetime count = all activity sessions; monthCount likewise
  const aggregates = await fetchAggregates(user.id, /* type */ null);

  // Highest currently affordable reward — a flex
  const reward = await fetchHighestAffordableReward(aggregates.pointsBalance);

  // Longest streak from user_streaks
  const { data: streakRow } = await supabase
    .from('user_streaks')
    .select('longest_streak')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    mode: 'streak',
    longestStreak: streakRow?.longest_streak ?? aggregates.currentStreak,
    ...aggregates,
    reward,
  };
}

// ─── Auto-select: geofence check-in if recent, else streak ──────────────────

export async function fetchAutoSummary(): Promise<ShareSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 7);

  const { data: recent } = await supabase
    .from('activity_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'gym')
    .eq('verification', 'geofence')
    .gte('started_at', windowStart.toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) return fetchCheckInSummary(recent.id);
  return fetchStatsSummary();
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function fetchAggregates(
  userId: string,
  type: ActivityType | null,
): Promise<BaseShareSummary> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const lifetimeQ = supabase
    .from('activity_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (type) lifetimeQ.eq('type', type);

  const monthQ = supabase
    .from('activity_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString());
  if (type) monthQ.eq('type', type);

  const [profileRes, lifetimeRes, monthRes, streakRes, weekRes, balanceRes, authRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, username, avatar_url, cover_url')
      .eq('id', userId)
      .maybeSingle(),
    lifetimeQ,
    monthQ,
    supabase
      .from('user_streaks')
      .select('current_streak')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('activity_sessions')
      .select('started_at')
      .eq('user_id', userId)
      .neq('verification', 'manual')
      .gte('started_at', monday.toISOString()),
    supabase
      .from('point_transactions')
      .select('amount'),
    supabase.auth.getUser(),
  ]);

  const profile = profileRes.data;
  const metaAvatarUrl = (authRes.data.user?.user_metadata?.avatar_url as string | undefined) ?? null;
  const weekActiveDays = [false, false, false, false, false, false, false];
  for (const s of (weekRes.data ?? []) as Array<{ started_at: string }>) {
    const d = new Date(s.started_at).getDay();
    weekActiveDays[d === 0 ? 6 : d - 1] = true;
  }

  return {
    pointsBalance: (balanceRes.data ?? []).reduce((sum, t) => sum + t.amount, 0),
    lifetimeCount: lifetimeRes.count ?? 0,
    monthCount: monthRes.count ?? 0,
    currentStreak: streakRes.data?.current_streak ?? 0,
    weekActiveDays,
    reward: null, // populated by caller
    profile: {
      displayName: profile?.display_name ?? null,
      username: (profile as any)?.username ?? null,
      avatarUrl: profile?.avatar_url ?? metaAvatarUrl ?? null,
      coverUrl: (profile as any)?.cover_url ?? null,
    },
  };
}

async function fetchUnlockedReward(preBalance: number, balance: number): Promise<ShareReward | null> {
  const { data } = await supabase
    .from('rewards')
    .select('id, title, brand_name, value_label, offer, powr_cost, partners(name)')
    .eq('active', true)
    .gt('powr_cost', preBalance)
    .lte('powr_cost', balance)
    .order('powr_cost', { ascending: false })
    .limit(1);
  return mapReward((data ?? [])[0]);
}

async function fetchHighestAffordableReward(balance: number): Promise<ShareReward | null> {
  if (balance <= 0) return null;
  const { data } = await supabase
    .from('rewards')
    .select('id, title, brand_name, value_label, offer, powr_cost, partners(name)')
    .eq('active', true)
    .lte('powr_cost', balance)
    .order('powr_cost', { ascending: false })
    .limit(1);
  return mapReward((data ?? [])[0]);
}

function mapReward(r: any): ShareReward | null {
  if (!r) return null;
  const partnerName = Array.isArray(r.partners) ? r.partners[0]?.name : r.partners?.name;
  return {
    id: r.id,
    title: r.title,
    brandName: r.brand_name ?? null,
    partnerName: partnerName ?? null,
    valueLabel: r.value_label ?? null,
    offer: r.offer ?? null,
  };
}
