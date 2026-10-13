/**
 * In-store redemption, member side: the calls behind the wallet's in-store
 * card and the live voucher screen (app/in-store.tsx). Everything goes through
 * SECURITY DEFINER RPCs scoped to the signed-in member
 * (supabase/migrations/20261013120100_in_store_redemption.sql).
 *
 * Opening a voucher never uses the reward up. Only a staff scan, a staff
 * swipe or the shop's till barcode does.
 */
import { supabase } from '@/lib/supabase';
import { WALLET_COLUMNS, type WalletEntry } from '@/lib/api/rewards';
import type { BarcodeFormat, InStoreCheck } from '@/shared/inStore';

export interface InStoreSite {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number;
}

export interface InStoreInfo {
  reward_id: string;
  where: 'in_store' | 'both';
  check: InStoreCheck;
  requires_stand: boolean;
  window_minutes: number;
  barcode_format: BarcodeFormat;
  sites: InStoreSite[];
}

export interface InStoreVoucher {
  voucher_id: string;
  redemption_id: string;
  secret: string;
  status: 'open' | 'swiped' | 'confirmed';
  /** Open but past its window: reads as "closed", reopen for a fresh one. */
  closed: boolean;
  opened_at: string;
  expires_at: string;
  server_now: string;
  step_seconds: number;
  check: InStoreCheck;
  window_minutes: number;
  reward_title: string | null;
  brand_name: string | null;
  site_name: string | null;
  at_shop: boolean;
  member_label: string;
  member_since: string | null;
  swiped_at: string | null;
  confirmed_at: string | null;
  confirmed_by: 'staff' | 'manager' | null;
  confirm_site_name: string | null;
}

export type InStoreErrorCode =
  | 'NOT_SIGNED_IN'
  | 'NOT_FOUND'
  | 'ALREADY_USED'
  | 'NOT_ACTIVE'
  | 'EXPIRED'
  | 'NOT_IN_STORE'
  | 'STAND_REQUIRED'
  | 'STAND_OTHER_SHOP'
  | 'STAND_INVALID'
  | 'CLOSED'
  | 'UNKNOWN';

export class InStoreError extends Error {
  code: InStoreErrorCode;
  /** STAND_OTHER_SHOP names both sides, e.g. "POWR Store · POWR" vs "QA InStore Test". */
  standShop: string | null;
  rewardShop: string | null;
  constructor(code: InStoreErrorCode, message?: string, detail?: { stand_shop?: string; reward_shop?: string }) {
    super(message ?? code);
    this.code = code;
    this.standShop = detail?.stand_shop ?? null;
    this.rewardShop = detail?.reward_shop ?? null;
  }
}

type VoucherResult = { voucher?: InStoreVoucher; error?: InStoreErrorCode; stand_shop?: string; reward_shop?: string };

async function voucherRpc(name: string, args: Record<string, unknown>): Promise<InStoreVoucher> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new InStoreError('UNKNOWN', error.message);
  const result = (data ?? {}) as VoucherResult;
  if (result.error) throw new InStoreError(result.error, undefined, result);
  if (!result.voucher) throw new InStoreError('UNKNOWN');
  return result.voucher;
}

/** In-store settings and shops, keyed by reward id. Online-only rewards are absent. */
export async function fetchInStoreInfo(rewardIds: string[]): Promise<Record<string, InStoreInfo>> {
  if (!rewardIds.length) return {};
  const { data, error } = await supabase.rpc('member_in_store_rewards', { p_reward_ids: rewardIds });
  if (error) throw error;
  const out: Record<string, InStoreInfo> = {};
  for (const row of (data ?? []) as InStoreInfo[]) out[row.reward_id] = row;
  return out;
}

export async function fetchWalletEntry(redemptionId: string): Promise<WalletEntry | null> {
  const { data, error } = await supabase.from('redemptions').select(WALLET_COLUMNS).eq('id', redemptionId).maybeSingle();
  if (error) throw error;
  return (data as WalletEntry | null) ?? null;
}

export function openInStoreVoucher(
  redemptionId: string,
  opts: { lat?: number; lng?: number; accuracy?: number | null; standCode?: string; standKey?: string } = {},
): Promise<InStoreVoucher> {
  return voucherRpc('in_store_open_voucher', {
    p_redemption_id: redemptionId,
    p_lat: opts.lat ?? null,
    p_lng: opts.lng ?? null,
    p_accuracy_m: opts.accuracy ?? null,
    p_stand_code: opts.standCode ?? null,
    p_stand_key: opts.standKey ?? null,
  });
}

export function inStoreVoucherStatus(voucherId: string): Promise<InStoreVoucher> {
  return voucherRpc('in_store_voucher_status', { p_voucher_id: voucherId });
}

export function swipeInStoreVoucher(voucherId: string): Promise<InStoreVoucher> {
  return voucherRpc('in_store_swipe_voucher', { p_voucher_id: voucherId });
}

/** Great-circle metres; plenty for "is this member at the shop". */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.3 mi" / "350 m"-style distance in miles, as the UK app shows elsewhere. */
export function formatDistance(metres: number): string {
  const miles = metres / 1609.344;
  if (miles < 0.1) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** Sites sorted nearest first, each tagged with distance and whether the member is inside it. */
export function sitesByDistance(sites: InStoreSite[], fix: { lat: number; lng: number; accuracy?: number | null } | null) {
  return sites
    .map((site) => {
      const d = fix ? metresBetween(fix, site) : null;
      const slack = Math.min(Math.max(fix?.accuracy ?? 0, 0), 100);
      return { site, distance: d, here: d != null && d <= site.radius_m + slack };
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
}
