// The live reward catalogue as the emails show it — one query, shared by the
// weekly summary and the re-engagement email so both pick rewards the same way.

import type { WeeklyRewardTile } from "./emails/weekly-summary.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

/** Strip trailing zeros: 15.00 → "15", 12.50 → "12.5". */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, "");
}

/** Reward discount badge, mirroring the app's RewardCard buildDiscountLabel. */
export function discountLabel(
  r: { value_label?: string | null; discount_type?: string | null; discount_value?: number | string | null },
): string {
  const v = r.discount_value != null && r.discount_value !== "" ? Number(r.discount_value) : null;
  if (r.discount_type === "percentage" && v != null && !Number.isNaN(v)) return `${trimNum(v)}% OFF`;
  if (r.discount_type === "fixed_amount" && v != null && !Number.isNaN(v)) return `£${trimNum(v)} OFF`;
  return (r.value_label ?? "").trim();
}

export interface RewardCatalogue {
  /** Up to 3 highest-value rewards, one per brand (the showcase logo tiles). */
  top: WeeklyRewardTile[];
  /** Every redeemable reward, cheapest first, one per brand. */
  byCost: WeeklyRewardTile[];
}

/** Active, in-stock, unexpired rewards with a POWR price. */
export async function loadRewardCatalogue(supabase: Client): Promise<RewardCatalogue> {
  const { data: rewardRows } = await supabase
    .from("rewards")
    .select("brand_name, title, powr_cost, image_url, hero_image_url, value_label, discount_type, discount_value, stock, expires_at")
    .eq("active", true)
    .gt("powr_cost", 0)
    .order("powr_cost", { ascending: true });
  const nowMs = Date.now();
  // deno-lint-ignore no-explicit-any
  const allRewards: WeeklyRewardTile[] = ((rewardRows ?? []) as any[])
    .filter((r) =>
      r.powr_cost != null &&
      (r.stock == null || r.stock > 0) &&
      (r.expires_at == null || new Date(r.expires_at).getTime() > nowMs)
    )
    .map((r) => ({
      brand: (r.brand_name ?? null) as string | null,
      title: (r.title ?? null) as string | null,
      cost: r.powr_cost as number,
      image: (r.image_url ?? r.hero_image_url ?? null) as string | null, // logo
      hero: (r.hero_image_url ?? r.image_url ?? null) as string | null,   // cover
      valueLabel: discountLabel(r),
    }));

  const brandKey = (r: WeeklyRewardTile) => (r.brand ?? r.title ?? String(r.cost)).toLowerCase();

  const top: WeeklyRewardTile[] = [];
  const seenTop = new Set<string>();
  for (const r of [...allRewards].sort((a, b) => b.cost - a.cost)) {
    if (seenTop.has(brandKey(r))) continue;
    seenTop.add(brandKey(r));
    top.push(r);
    if (top.length >= 3) break;
  }

  const byCost: WeeklyRewardTile[] = [];
  const seenAsc = new Set<string>();
  for (const r of allRewards) {
    if (seenAsc.has(brandKey(r))) continue;
    seenAsc.add(brandKey(r));
    byCost.push(r);
  }

  return { top, byCost };
}

/** Rewards a balance already covers, best value first. */
export function rewardsReadyFor(byCost: WeeklyRewardTile[], balance: number): WeeklyRewardTile[] {
  return byCost.filter((r) => r.cost <= balance).sort((a, b) => b.cost - a.cost);
}
