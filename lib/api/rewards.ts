import { supabase } from '@/lib/supabase';

export type IntegrationType = 'POOL' | 'API_VALIDATED' | 'AFFILIATE';

export interface PartnerSummary {
  id: string;
  name: string;
  partner_code: string;
  logo_url: string | null;
  category: string;
  checkout_url_template: string | null;
}

export interface Reward {
  id: string;
  partner_id: string | null;
  title: string;
  description: string | null;
  powr_cost: number;
  category: string;
  integration_type: IntegrationType;
  code_expiry_days: number;
  active: boolean;
  featured_on_home: boolean;
  partner: PartnerSummary | null;
  offer: string | null;
  hero_image_url: string | null;
  brand_color: string | null;
  url: string | null;
  partner_blurb: string | null;
  value_label: string | null;
  image_url: string | null;
  promo_code: string | null;
  discount_type: 'percentage' | 'fixed_amount' | null;
  discount_value: number | null;
  brand_name: string | null;
  max_redemptions_per_user: number | null;
}

export interface RedemptionResult {
  ok: true;
  code: string;
  checkout_url: string | null;
  expires_at: string;
  redemption_id: string | null;
  integration_type: IntegrationType;
}

export type RedemptionErrorCode =
  | 'INSUFFICIENT_POINTS'
  | 'OUT_OF_STOCK'
  | 'REWARD_INACTIVE'
  | 'REWARD_NOT_FOUND'
  | 'PARTNER_MISCONFIGURED'
  | 'CODE_GENERATION_FAILED'
  | 'TX_FAILED'
  | 'REDEMPTION_LIMIT_REACHED'
  | 'UNKNOWN';

export class RedemptionError extends Error {
  code: RedemptionErrorCode;
  extra?: Record<string, unknown>;
  constructor(code: RedemptionErrorCode, message?: string, extra?: Record<string, unknown>) {
    super(message ?? code);
    this.code = code;
    this.extra = extra;
  }
}

export async function fetchRewards(): Promise<Reward[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, partner_id, title, description, powr_cost, category, integration_type, code_expiry_days, active, offer, hero_image_url, brand_color, url, partner_blurb, value_label, image_url, promo_code, discount_type, discount_value, brand_name, max_redemptions_per_user, partners(id, name, partner_code, logo_url, category, checkout_url_template)')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('powr_cost', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    partner: Array.isArray(r.partners) ? r.partners[0] : r.partners,
  })) as Reward[];
}

export async function redeemReward(rewardId: string): Promise<RedemptionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new RedemptionError('UNKNOWN', 'Not authenticated');

  const { data, error } = await supabase.functions.invoke('redeem-reward', {
    body: { reward_id: rewardId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    // supabase-js surfaces FunctionsHttpError with context; try to read body
    const ctx: any = (error as any).context;
    const payload = ctx?.body ?? (await ctx?.json?.().catch(() => null));
    const code = (payload?.error as RedemptionErrorCode) ?? 'UNKNOWN';
    throw new RedemptionError(code, error.message, payload);
  }
  if (!data?.ok) {
    throw new RedemptionError((data?.error as RedemptionErrorCode) ?? 'UNKNOWN');
  }
  return data as RedemptionResult;
}

export interface RedemptionHistoryRow {
  id: string;
  reward_id: string;
  code: string;
  powr_spent: number;
  status: 'active' | 'used' | 'expired' | 'refunded';
  redeemed_at: string;
  expires_at: string;
  rewards: { title: string; partners: { name: string; partner_code: string; logo_url: string | null } };
}

export async function fetchRedemptionHistory(): Promise<RedemptionHistoryRow[]> {
  const { data, error } = await supabase
    .from('redemptions')
    .select('id, reward_id, code, powr_spent, status, redeemed_at, expires_at, rewards(title, partners(name, partner_code, logo_url))')
    .order('redeemed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as any;
}

// ─── Wallet ─────────────────────────────────────────────────────────────────

/**
 * A redeemed reward as it lives in the user's wallet. Reads the denormalised
 * receipt columns on `redemptions` (snapshotted at redeem time) rather than
 * joining `rewards`/`partners`, so a code still renders after its reward is
 * deactivated.
 */
export interface WalletEntry {
  id: string;
  reward_id: string;
  code: string;
  powr_spent: number;
  status: 'active' | 'used' | 'expired' | 'refunded';
  redeemed_at: string;
  expires_at: string | null;
  integration_type: IntegrationType;
  reward_title: string | null;
  partner_name: string | null;
  reward_image_url: string | null;
  reward_hero_image_url: string | null;
  checkout_url: string | null;
}

/** Display state for a wallet entry, derived from status + expiry. */
export type WalletStatus = 'ready' | 'used' | 'expired';

export function walletEntryStatus(
  entry: Pick<WalletEntry, 'status' | 'expires_at'>,
  now: number = Date.now(),
): WalletStatus {
  if (entry.status === 'used') return 'used';
  if (entry.status === 'expired') return 'expired';
  if (entry.expires_at && new Date(entry.expires_at).getTime() < now) return 'expired';
  return 'ready';
}

/**
 * Split wallet entries into "ready to use" and "past" (used/expired), pure so it
 * can be unit-tested. Ready entries surface soonest-to-expire first; past
 * entries stay newest-first.
 */
export function partitionWallet(
  entries: WalletEntry[],
  now: number = Date.now(),
): { ready: WalletEntry[]; past: WalletEntry[] } {
  const ready: WalletEntry[] = [];
  const past: WalletEntry[] = [];
  for (const e of entries) {
    if (e.status === 'refunded') continue;
    (walletEntryStatus(e, now) === 'ready' ? ready : past).push(e);
  }
  ready.sort((a, b) => {
    const ax = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
    const bx = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
    return ax - bx;
  });
  past.sort((a, b) => new Date(b.redeemed_at).getTime() - new Date(a.redeemed_at).getTime());
  return { ready, past };
}

export async function fetchWallet(): Promise<WalletEntry[]> {
  const { data, error } = await supabase
    .from('redemptions')
    .select('id, reward_id, code, powr_spent, status, redeemed_at, expires_at, integration_type, reward_title, partner_name, reward_image_url, reward_hero_image_url, checkout_url')
    .neq('status', 'refunded')
    .order('redeemed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WalletEntry[];
}

/**
 * Per-reward redemption counts for the current user, used by the rewards list to
 * surface "N in wallet" and to grey out rewards that have hit their admin cap.
 * `nonRefunded` mirrors the cap counting in the redeem-reward edge function.
 */
export async function fetchMyRedemptionSummary(): Promise<Record<string, { active: number; nonRefunded: number }>> {
  const { data, error } = await supabase
    .from('redemptions')
    .select('reward_id, status');
  if (error) throw error;
  const out: Record<string, { active: number; nonRefunded: number }> = {};
  for (const r of (data ?? []) as { reward_id: string; status: string }[]) {
    const e = out[r.reward_id] ?? { active: 0, nonRefunded: 0 };
    if (r.status === 'active') e.active += 1;
    if (r.status !== 'refunded') e.nonRefunded += 1;
    out[r.reward_id] = e;
  }
  return out;
}

export async function fetchFeaturedReward(): Promise<Reward | null> {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, partner_id, title, description, powr_cost, category, integration_type, code_expiry_days, active, featured_on_home, offer, hero_image_url, brand_color, url, partner_blurb, value_label, image_url, promo_code, discount_type, discount_value, brand_name, max_redemptions_per_user, partners(id, name, partner_code, logo_url, category, checkout_url_template)')
    .eq('featured_on_home', true)
    .eq('active', true)
    .single();
  if (error) return null;
  return { ...data, partner: Array.isArray(data.partners) ? data.partners[0] : data.partners } as Reward;
}

const REWARD_FIELDS = 'id, partner_id, title, description, powr_cost, category, integration_type, code_expiry_days, active, featured_on_home, offer, hero_image_url, brand_color, url, partner_blurb, value_label, image_url, promo_code, discount_type, discount_value, brand_name, max_redemptions_per_user, partners(id, name, partner_code, logo_url, category, checkout_url_template)';

export async function fetchFeaturedScheduledReward(): Promise<Reward | null> {
  const now = new Date().toISOString();

  // Check the schedule table for an active slot
  const { data: slot } = await supabase
    .from('featured_reward_schedule')
    .select('reward_id')
    .lte('starts_at', now)
    .gt('ends_at', now)
    .order('starts_at', { ascending: false })
    .limit(1)
    .single();

  if (slot?.reward_id) {
    const { data, error } = await supabase
      .from('rewards')
      .select(REWARD_FIELDS)
      .eq('id', slot.reward_id)
      .eq('active', true)
      .single();
    if (!error && data) {
      return { ...data, partner: Array.isArray(data.partners) ? data.partners[0] : data.partners } as Reward;
    }
  }

  return null;
}

/**
 * Smart featured reward selection — priority order:
 * 1. Active time-boxed schedule slot (featured_reward_schedule table)
 * 2. Permanent pin (featured_on_home = true on the reward itself)
 * 3. Smart rotation based on unlock status:
 *    - All rewards unlocked: cycle all, highest points first
 *    - No rewards unlocked: show closest redeemable reward (lowest pts needed)
 *    - Mixed: prioritize unlocked rewards, cycle them by highest points first
 *
 * Admins can control the hero card without a new app build:
 *  - Pin a reward permanently via the "Featured on Home" toggle in RewardManager
 *  - Schedule timed campaigns via the Featured Schedule admin page
 */
export async function fetchSmartFeaturedReward(balance: number): Promise<Reward | null> {
  try {
    // 1. Permanent pin — set via admin panel Hero Card section
    const pinned = await fetchFeaturedReward();
    if (pinned) return pinned;

    // 2. Smart rotation fallback
    const rewards = await fetchRewards();
    if (rewards.length === 0) return null;

    // Categorize rewards
    const unlocked = rewards.filter(r => balance >= r.powr_cost);
    const locked = rewards.filter(r => balance < r.powr_cost);

    const dayIndex = Math.floor(Date.now() / 86_400_000);
    let featured: Reward | null = null;

    if (unlocked.length === rewards.length) {
      // All rewards unlocked → cycle all, highest points first
      const sorted = [...unlocked].sort((a, b) => b.powr_cost - a.powr_cost);
      featured = sorted[dayIndex % sorted.length];
    } else if (locked.length === rewards.length) {
      // No rewards unlocked → show closest (minimum pts needed)
      const sorted = [...locked].sort((a, b) => a.powr_cost - b.powr_cost);
      featured = sorted[0];
    } else {
      // Mixed → prioritize unlocked, cycle them by highest points
      const sortedUnlocked = [...unlocked].sort((a, b) => b.powr_cost - a.powr_cost);
      featured = sortedUnlocked[dayIndex % sortedUnlocked.length];
    }

    return featured;
  } catch (e) {
    console.warn('[fetchSmartFeaturedReward] error:', e);
    return null;
  }
}
