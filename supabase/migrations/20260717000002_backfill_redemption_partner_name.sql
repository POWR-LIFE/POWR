-- Companion to backfill_redemption_checkout_url: pre-2026-06-09 redemptions of
-- brand rewards (no partners row, only rewards.brand_name) got partner_name
-- null from the original backfill, which only joined partners. Match the
-- edge function's snapshot precedence: partner.name, else reward.brand_name.
update public.redemptions r
   set partner_name = coalesce(p.name, rw.brand_name)
  from public.rewards rw
  left join public.partners p on p.id = rw.partner_id
 where rw.id = r.reward_id
   and r.partner_name is null
   and coalesce(p.name, rw.brand_name) is not null;
