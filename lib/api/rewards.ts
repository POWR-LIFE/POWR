import { supabase } from '@/lib/supabase';

export type IntegrationType = 'POOL' | 'API_VALIDATED';

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
    .select('id, partner_id, title, description, powr_cost, category, integration_type, code_expiry_days, active, offer, hero_image_url, brand_color, url, partner_blurb, value_label, image_url, promo_code, discount_type, discount_value, brand_name, partners(id, name, partner_code, logo_url, category, checkout_url_template)')
    .eq('active', true)
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
