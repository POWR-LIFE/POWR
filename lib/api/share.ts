import * as FileSystem from 'expo-file-system/legacy';

import type { ActivityType } from '@/constants/activities';
import { getLevelInfo } from '@/constants/levels';
import { getSessionUser, supabase } from '@/lib/supabase';

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
  referralCode: string | null;
}

interface BaseShareSummary {
  pointsBalance: number;
  /** Lifetime points earned — the XP the level ladder is keyed on. */
  totalEarned: number;
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
  /**
   * A throwback share from points history. Aggregates are anchored to the end
   * of the session's day rather than now, so the card reads as a snapshot of
   * that moment — and present-tense panels (streak, affordable reward) are
   * suppressed because they can't be reconstructed for a past date.
   */
  historical: boolean;
}

export interface StatsSummary extends BaseShareSummary {
  mode: 'streak';
  longestStreak: number;
}

/** The challenge fields the home screen hands to the share screen via route params. */
export interface ChallengeShareInput {
  challengeTitle: string;
  challengeDescription: string;
  categoryLabel: string;
  tier: 'easy' | 'medium' | 'hard';
  points: number;
  displayValue: number;
  displayGoal: number;
  unit: string;
}

export interface ChallengeShareSummary extends BaseShareSummary, ChallengeShareInput {
  mode: 'challenge';
}

export interface LevelUpSummary extends BaseShareSummary {
  mode: 'level-up';
  /**
   * A throwback share of a past level-up (from the points-history row).
   * Aggregates are anchored to the crossing moment, so the card shows the
   * level — and the numbers — as they stood right then. Same suppression
   * rules as historical check-ins: no live streak, no reward lookup.
   */
  historical: boolean;
}

export type ShareSummary = CheckInSummary | StatsSummary | ChallengeShareSummary | LevelUpSummary;

// ─── Check-in summary (per-session) ────────────────────────────────────────

export async function fetchCheckInSummary(
  sessionId: string,
  opts?: { historical?: boolean },
): Promise<CheckInSummary> {
  const historical = opts?.historical ?? false;
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  // Scoped on user_id as well as the session id: the aggregates below are the
  // CALLER's, so without this an admin opening someone else's session id would
  // render that session's details (raw_gps included) against their own stats.
  const { data: session, error: sErr } = await supabase
    .from('activity_sessions')
    .select('id, type, started_at, duration_sec, partner_id, partner_location_idx, raw_gps, point_transactions(amount)')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();
  if (sErr || !session) throw sErr ?? new Error('Session not found');

  const sessionPoints = ((session as any).point_transactions ?? [])
    .reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);

  // Historical shares anchor to the close of the session's day, so the
  // session's own points (credited after started_at) still count.
  let asOf: Date | undefined;
  if (historical) {
    asOf = new Date(session.started_at);
    asOf.setHours(23, 59, 59, 999);
  }

  const aggregates = await fetchAggregates(user.id, session.type as ActivityType, asOf);

  // Venue resolution: prefer partner_id column, fall back to raw_gps for older sessions
  let venue: ShareVenue | null = null;
  const partnerId = (session as any).partner_id as string | null;
  const rawGps = (session as any).raw_gps as { partnerName?: string; partnerId?: string } | null;

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
  } else if (rawGps?.partnerId) {
    const { data: partner } = await supabase
      .from('partners')
      .select('name, category, locations')
      .eq('id', rawGps.partnerId)
      .maybeSingle();
    if (partner) {
      venue = {
        name: partner.name,
        locationLabel: (partner as any).locations?.[0]?.name ?? null,
        category: partner.category,
      };
    } else if (rawGps.partnerName) {
      venue = { name: rawGps.partnerName, locationLabel: null, category: 'gym' };
    }
  }

  // Best reward the user can currently redeem with their balance. Present-tense
  // by definition (there is no historical catalog), so throwbacks skip it.
  const reward = historical ? null : await fetchHighestAffordableReward(aggregates.pointsBalance);

  return {
    mode: 'check-in',
    sessionId: session.id,
    type: session.type as ActivityType,
    startedAt: session.started_at,
    durationMin: Math.round(session.duration_sec / 60),
    sessionPoints,
    venue,
    historical,
    ...aggregates,
    // user_streaks only stores the live value — a reconstructed "streak as of
    // then" would drift from the canonical logic, so throwbacks drop it.
    ...(historical ? { currentStreak: 0 } : null),
    reward,
  };
}

// ─── Stats summary (no specific session — for streak/profile shares) ────────

export async function fetchStatsSummary(): Promise<StatsSummary> {
  const user = await getSessionUser();
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

// ─── Challenge summary (completed weekly challenge) ─────────────────────────
// The challenge itself is evaluated client-side (useWeeklyChallenges), so its
// details arrive as route params; here we only enrich them with the member's
// profile + lifetime/streak aggregates so the card matches the streak/check-in
// shares.

export async function fetchChallengeSummary(
  challenge: ChallengeShareInput,
): Promise<ChallengeShareSummary> {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const aggregates = await fetchAggregates(user.id, /* type */ null);

  return {
    mode: 'challenge',
    ...challenge,
    ...aggregates,
  };
}

// ─── Level-up summary (the moment a level boundary is crossed) ──────────────
// The card derives the level itself from totalEarned via getLevelInfo, which
// at share time already reflects the freshly crossed boundary. For throwbacks,
// `asOf` is the crossing transaction's timestamp (inclusive), so the as-of
// totalEarned lands exactly on the level that was reached.

export async function fetchLevelUpSummary(opts?: { asOf?: Date }): Promise<LevelUpSummary> {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const historical = opts?.asOf !== undefined;
  const aggregates = await fetchAggregates(user.id, /* type */ null, opts?.asOf);

  return {
    mode: 'level-up',
    historical,
    ...aggregates,
    ...(historical ? { currentStreak: 0 } : null),
  };
}

// ─── Auto-select: geofence check-in if recent, else streak ──────────────────

export async function fetchAutoSummary(): Promise<ShareSummary> {
  const user = await getSessionUser();
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

export type VaultDepositRow = { amount: number; released_at: string | null };

/**
 * Vault POWR still counting toward level for a share card — the vault half of
 * the canonical earned basis (get_my_points_summary.total_earned).
 *
 * A deposit counts while unreleased. For a historical card (`asOf`), a deposit
 * released AFTER the card's date was still unreleased then, so it counts; once
 * released it lands in the ledger as a positive 'vault_release' row (already in
 * the credits sum), so counting it here too would double it. `Math.max` guards
 * against a stray non-positive amount.
 */
export function vaultTowardLevel(
  deposits: VaultDepositRow[],
  asOf?: Date | null,
): number {
  const asOfMs = asOf ? asOf.getTime() : null;
  return deposits.reduce((sum, d) => {
    const releasedByCardDate = d.released_at != null
      && (asOfMs === null || new Date(d.released_at).getTime() <= asOfMs);
    return releasedByCardDate ? sum : sum + Math.max(d.amount, 0);
  }, 0);
}

async function fetchAggregates(
  userId: string,
  type: ActivityType | null,
  /**
   * Point-in-time anchor for historical shares. Every date-windowed number
   * (lifetime, month, week, points) is computed as of this moment instead of
   * now — so a throwback card shows the stats (and therefore the level) the
   * member had back then. Omit for live shares.
   */
  asOf?: Date,
): Promise<BaseShareSummary> {
  const anchor = asOf ?? new Date();

  const monthStart = new Date(anchor);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const dayOfWeek = anchor.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const lifetimeQ = supabase
    .from('activity_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (type) lifetimeQ.eq('type', type);
  if (asOf) lifetimeQ.lte('started_at', asOf.toISOString());

  const monthQ = supabase
    .from('activity_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString());
  if (type) monthQ.eq('type', type);
  if (asOf) monthQ.lte('started_at', asOf.toISOString());

  const weekQ = supabase
    .from('activity_sessions')
    .select('started_at')
    .eq('user_id', userId)
    .neq('verification', 'manual')
    .gte('started_at', monday.toISOString());
  if (asOf) weekQ.lte('started_at', asOf.toISOString());

  const txQ = supabase
    .from('point_transactions')
    .select('amount')
    .eq('user_id', userId);
  if (asOf) txQ.lte('created_at', asOf.toISOString());

  // Vault POWR still counting toward level (unreleased) — part of the canonical
  // lifetime-earned basis. Both reads scope on user_id like every other query
  // here: RLS is NOT sufficient, since both tables carry an "admins can read
  // all" policy and an unfiltered sum would total the whole platform's POWR.
  const vaultQ = supabase
    .from('vault_deposits')
    .select('amount, created_at, released_at')
    .eq('user_id', userId);
  if (asOf) vaultQ.lte('created_at', asOf.toISOString());

  const [profileRes, lifetimeRes, monthRes, streakRes, weekRes, balanceRes, vaultRes, authRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, username, avatar_url, cover_url, referral_code')
      .eq('id', userId)
      .maybeSingle(),
    lifetimeQ,
    monthQ,
    supabase
      .from('user_streaks')
      .select('current_streak')
      .eq('user_id', userId)
      .maybeSingle(),
    weekQ,
    txQ,
    vaultQ,
    getSessionUser(),
  ]);

  const profile = profileRes.data;
  const metaAvatarUrl = (authRes?.user_metadata?.avatar_url as string | undefined) ?? null;
  const weekActiveDays = [false, false, false, false, false, false, false];
  for (const s of (weekRes.data ?? []) as Array<{ started_at: string }>) {
    const d = new Date(s.started_at).getDay();
    weekActiveDays[d === 0 ? 6 : d - 1] = true;
  }

  // Level basis must match get_my_points_summary.total_earned = positive ledger
  // (ALL types) + vault still counting toward level. Spends stay out of earned
  // so redemptions can't pull a member back down the ladder.
  const transactions = balanceRes.data ?? [];
  const creditsEarned = transactions.reduce((sum, t) => sum + Math.max(t.amount, 0), 0);

  const vaultPending = vaultTowardLevel(
    (vaultRes.data ?? []) as VaultDepositRow[],
    asOf,
  );

  return {
    pointsBalance: transactions.reduce((sum, t) => sum + t.amount, 0),
    totalEarned: creditsEarned + vaultPending,
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
      referralCode: (profile as any)?.referral_code ?? null,
    },
  };
}

// ─── Publishing a card as a link ────────────────────────────────────────────

const SITE = 'https://powr.life';

/** "20 Jun", with the year only once it stops being obvious. */
function shortDate(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? null : { year: 'numeric' }),
  });
}

/** The sentence a member sends with the link. */
export function buildShareHeadline(summary: ShareSummary): string {
  if (summary.mode === 'check-in') {
    const where = summary.venue ? ` at ${summary.venue.name}` : '';
    const detail = [
      summary.historical ? shortDate(new Date(summary.startedAt)) : null,
      summary.durationMin > 0 ? `${summary.durationMin} min` : null,
      summary.sessionPoints > 0 ? `+${summary.sessionPoints} pts` : null,
    ].filter(Boolean).join(', ');
    let line = `Checked in${where} on POWR${detail ? ` — ${detail}` : ''}.`;
    if (summary.currentStreak > 1) line += ` Day ${summary.currentStreak} of my streak.`;
    return line;
  }
  if (summary.mode === 'challenge') {
    return `Challenge complete on POWR: ${summary.challengeTitle} (+${summary.points} pts).`;
  }
  if (summary.mode === 'level-up') {
    const { current } = getLevelInfo(summary.totalEarned);
    return summary.historical
      ? `Hit Level ${current.level} — ${current.name} — on POWR.`
      : `Just hit Level ${current.level} — ${current.name} — on POWR.`;
  }
  return summary.currentStreak > 0
    ? `${summary.currentStreak}-day streak on POWR — ${summary.monthCount} sessions this month.`
    : `${summary.monthCount} sessions this month on POWR.`;
}

/** Bold line of the link preview — the member's level, which the card shows. */
export function buildShareTitle(summary: ShareSummary): string {
  const { current } = getLevelInfo(summary.totalEarned);
  const who = summary.profile.displayName ?? summary.profile.username ?? 'A POWR member';
  return `${who} — Level ${current.level}, ${current.name}`;
}

/** Grey line beneath it. */
export function buildShareSubtitle(summary: ShareSummary): string {
  return `${buildShareHeadline(summary)} Tap to get POWR and earn rewards for every workout.`;
}

/**
 * Uploads the captured card and records the row that https://powr.life/s/<id>
 * renders its Open Graph tags from, returning that URL.
 *
 * An attached image *is* the message — WhatsApp, iMessage and X only draw a
 * tappable preview when they are handed a URL they can scrape. So the card gets
 * published, and the member shares a link to it rather than the file itself.
 */
export async function publishShareCard(summary: ShareSummary, imageUri: string): Promise<string> {
  return publishShareImage(imageUri, {
    title: buildShareTitle(summary),
    subtitle: buildShareSubtitle(summary),
    referralCode: summary.profile.referralCode,
  });
}

export interface ShareImageMeta {
  /** Bold line of the link preview (og:title). */
  title: string;
  /** Grey line beneath it (og:description). */
  subtitle: string | null;
  /** Attributes the tap to the member: humans bounce to /app?ref=<code>. */
  referralCode: string | null;
  /**
   * Where a human who taps the preview should land, as a path under
   * powr.life — e.g. the event a prize belongs to. Must begin with `/app`
   * (the DB constraint and the OG function both enforce it, so a card can
   * never become an open redirect). Omit for the default /app?ref= bounce.
   */
  appPath?: string | null;
}

/**
 * The one publishing path every card shares: uploads the captured image to
 * the public `share-cards` bucket, records the `share_cards` row the
 * /s/<id> page renders from, and returns that URL. Card-specific wording and
 * landing come in via `meta`.
 */
export async function publishShareImage(imageUri: string, meta: ShareImageMeta): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  // Owner's folder satisfies the storage policy; the random suffix is what keeps
  // a card unguessable in a public bucket.
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;

  const base64 = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const { error: uploadError } = await supabase.storage
    .from('share-cards')
    .upload(path, bytes, { contentType: 'image/jpeg' });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from('share_cards')
    .insert({
      user_id: user.id,
      image_path: path,
      title: meta.title,
      subtitle: meta.subtitle,
      referral_code: meta.referralCode,
      app_path: meta.appPath ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  return `${SITE}/s/${data.id}`;
}

/** Caption + link. The link is what makes the post tappable and attributable. */
export function buildShareMessage(summary: ShareSummary, shareUrl: string): string {
  return `${buildShareHeadline(summary)}\n${shareUrl}`;
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
